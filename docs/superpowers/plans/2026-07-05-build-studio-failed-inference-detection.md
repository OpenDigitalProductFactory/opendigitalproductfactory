# Plan — Build Studio failed-inference detection, honest surface, sanitize + retry

**BI:** BI-F0005EB0 (large, bug) · **Epic:** EP-BS-UX-HARDENING
**Sibling (shipped):** BI-A2F3FA9D (escalate-to-human terminal UI, PR #2608). This is the
other half of the epic's reliability tail.

## Problem (live repro on FB-54088DED)

The "Start a new build" box auto-seeds an ideate conversation. The **first** ideate
assistant turn FAILED — the `AgentMessage.content` was literally
`API Error: Unable to connect to API (ConnectionRefused)` — and that raw error was
stored as an ordinary assistant chat message. The build then sat in `ideate` with no
further activity, presenting as the calm **"Waiting on evidence"** custodian state
(intent `accent`), never an error. A manual re-prompt recovered it; scout research then
also stalled 34+ min. The non-technical target user gets no signal the AI call errored
and no recovery path — the UI implies *they* must act.

### Root cause (grounded)

- **Raw error leaks into chat content.** `apps/web/lib/actions/agent-coworker.ts:2036`
  sets `responseContent = "Research encountered an issue: " + ideateResult.error` and the
  single persist site (~`:2186`, `prisma.agentMessage.create({ content: responseContent })`)
  writes it verbatim — no error flag. Separately, a provider can return the error string
  *as the completion content* (no exception), which is stored the same way.
  (Note: thrown route errors already get friendly copy via
  `describeToolRouteFailure` in `agentic-loop.ts:105` — so the leak is specifically the
  ideate-research branch and the returned-as-content case, not the throw path.)
- **No structured failure signal.** `AgentMessage` (schema.prisma:4291) has no
  `isError`/`status`/`kind` field. `BuildProgressVisibility`
  (`apps/web/lib/build/progress-visibility.ts`) loads the thread's assistant messages
  (newest-first, take 50) but has no failed-inference detection.
- **Custodian has no failed-inference branch.** `build-studio-custodian.ts` classifies
  into `technicalRecovery` vs `blockedByEvidence` (`action.disabledReason != null`) vs
  quiet. An inference failure has no `disabledReason`, so it falls to `blockedByEvidence`
  → "Waiting on evidence" (accent), never "Blocked" (danger).
- **No auto-retry.** Ideate (`dispatchIdeateResearch`) and scout
  (`dispatchScoutResearch`, caught non-fatally at agent-coworker.ts:1861-1897, flag
  cleared regardless) give up on the first failure with no backoff.

## Definition of done (BI's four parts)

(a) Detect a failed-inference turn → a distinct FAILED-INFERENCE signal.
(b) Surface a clear danger **"The AI call failed — Retry"** state, not "Waiting on evidence".
(c) Auto-retry ideate/scout inference with backoff before parking.
(d) Never persist a raw provider error string as a user-visible assistant message.

## Design decision — detection mechanism (no migration)

`AgentMessage` has no error column. Three options were weighed:
1. **Add a nullable `deliveryStatus` column** — robust but a Prisma + EA-mirror migration.
2. **BuildActivity marker** — structured, no migration, but only covers build-scoped turns.
3. **Content classifier (chosen)** — a pure module that recognizes inference-failure
   content by signature. Chosen because the failure most often *manifests as content*
   (the provider returns the error string, or the ideate branch interpolates it) — there is
   no exception to hang a flag on — and because (d) will make all *new* failures use one
   canonical message the classifier also recognizes. It needs no migration, is fully
   unit-testable, and covers legacy rows. A `deliveryStatus` column can be a later
   ratchet if prose-matching proves insufficient; it is deliberately deferred.

The signature list + canonical message live in ONE module so the write (sanitize) and read
(detect) sides cannot drift.

## Phases

### Phase 1 — pure `inference-failure` module (foundation, ships alone)

**New:** `apps/web/lib/build/inference-failure.ts`
- `CANONICAL_INFERENCE_FAILURE_MESSAGE` — one friendly, retry-oriented string.
- `INFERENCE_FAILURE_SIGNATURES` — regexes: `ConnectionRefused`, `ECONNREFUSED`,
  `Unable to connect to API`, `^API Error:`, `All endpoints failed`,
  `No endpoint available`, `No eligible endpoints`.
- `isInferenceFailureContent(text): boolean` — matches a signature or the canonical message.
- `sanitizeAssistantContent(raw): { content: string; wasFailure: boolean; errorExcerpt: string | null }`
  — failure → `{ content: CANONICAL, wasFailure: true, errorExcerpt: raw.slice(0,240) }`;
  else passthrough.
- `detectFailedInferenceTurn(messages: {role,content,createdAt}[]): { errorExcerpt, observedAt } | null`
  — true iff the **newest assistant** message is an inference failure (messages are already
  newest-first). A newer successful turn ⇒ recovered ⇒ null.
- `isTransientInferenceError(err): boolean` — connection/timeout/all-endpoints-failed → retryable.

**Verify:** exhaustive unit tests (`inference-failure.test.ts`) — each signature; canonical
round-trips (`isInferenceFailureContent(sanitize(raw).content) === true`); recovered-turn ⇒
null; normal content ⇒ passthrough/null.

### Phase 2 — stop persisting raw errors (d)

**File:** `apps/web/lib/actions/agent-coworker.ts`
- Ideate error branch (`:2036`): replace `"Research encountered an issue: " + error` with
  `CANONICAL_INFERENCE_FAILURE_MESSAGE` (drop the raw interpolation).
- Persist site (`:2186`): run `responseContent` through `sanitizeAssistantContent` before
  `agentMessage.create` — catches the returned-as-content case from any path.

**Verify:** the pure sanitizer is covered in Phase 1; add a focused test asserting the
ideate-error branch maps a raw `ConnectionRefused` to the canonical message (extract the
branch into a tiny pure helper if the action is not unit-testable in isolation).

### Phase 3 — detect + surface the signal (a)

**Files:** `apps/web/lib/build/progress-visibility.ts` (+ `-types.ts` if the type moves)
- Add `failedInference: { errorExcerpt: string | null; observedAt: string | null } | null`
  to `BuildProgressVisibility`; add a matching param to
  `buildProgressProjectionFromParts` (optional, defaults null — tests construct literals).
- In `getBuildProgressVisibility`, call `detectFailedInferenceTurn(chatMessages)` (already
  loaded newest-first) and populate the field.

**Verify:** `progress-visibility.test.ts` — newest assistant message is a raw error ⇒
`failedInference != null` with the excerpt; a newer success ⇒ null.

### Phase 4 — custodian danger branch (b)

**File:** `apps/web/components/build/build-studio-custodian.ts`
- Add a `failedInference` check reading `progressVisibility.failedInference`, evaluated
  **before** `blockedByEvidence` so it wins over "Waiting on evidence". Emit: title
  "The AI call didn't go through.", `statusLabel: "AI call failed"`, `intent: "danger"`,
  `primaryLabel: "Retry"`, `primaryAction: "coworker"` with a retry prompt that re-asks the
  coworker to proceed (the manual recovery that worked in the repro). Feed the
  `statusSignal: "blocked"` into `resolveProactivityPlan`.

**Verify:** `build-studio-custodian.test.ts` — a build whose `progressVisibility.failedInference`
is set yields a `danger`/"AI call failed" prompt with a Retry action, and does NOT return the
"Waiting on evidence" prompt.

### Phase 5 — auto-retry ideate/scout with backoff (c) — DEFERRED to a follow-up BI

**Status: deferred.** Phases 1–4 fully deliver the core gap — a failed inference is now
detected, surfaced as an honest danger **Retry** state, and raw provider errors are never
persisted. Proactive auto-retry is deferred because doing it *safely* is nuanced enough to
warrant its own focused change: `dispatchIdeateResearch` has a **10-minute CLI timeout**, so a
naive retry-on-any-transient-error would risk turning one slow hang into 20–30 minutes — the
opposite of the fix. The follow-up must retry ONLY fast-fail connection errors
(`ConnectionRefused`/`ECONNREFUSED`/`Unable to connect`) and explicitly exclude the CLI
timeout, wrapped at the dispatch layer (`ideate-dispatch.ts`/`scout-dispatch.ts`), not inside
the 2000-line action. Filed as **BI-0EB136FD** under EP-BS-UX-HARDENING.

_(Original Phase 5 sketch retained below for the follow-up.)_

**Files:** `apps/web/lib/actions/agent-coworker.ts` (ideate + scout dispatch sites),
optionally `apps/web/lib/integrate/scout-dispatch.ts`.
- Add a small pure `withInferenceRetry(fn, {attempts, baseDelayMs, isRetryable, sleep})`
  (inject `sleep`/clock so it is unit-testable) in the Phase-1 module.
- Wrap `dispatchIdeateResearch` and `dispatchScoutResearch` in `withInferenceRetry` (2–3
  attempts, exponential backoff), retrying only when `isTransientInferenceError`. On final
  failure, fall through to the sanitized canonical message (Phase 2) + the surfaced signal
  (Phase 3) — i.e. park honestly, not silently.

**Verify:** unit-test `withInferenceRetry` with a fake clock (fails N-1 then succeeds; gives
up after N with the transient classifier). This phase edits the large action file; if it
proves too invasive/risky to do safely, ship Phases 1–4 (which fully deliver the honest
error state + Retry path — the core gap) and file a follow-up BI for proactive auto-retry.

## Risks & rollback

- **Blast radius** is contained: one new pure module + read-side field + one custodian
  branch + two persist-site edits. No schema migration. CI Typecheck is authoritative
  (worktree tsc runnable with `--max-old-space-size=8192`; no macOS `timeout`).
- **agent-coworker.ts is a very large file** — Phases 2 & 5 edit it. Keep edits minimal and
  localized; prefer extracting a tiny pure helper over inline logic so behavior is tested off
  the module, not through the 2000-line action.
- **False positives** (classifying a legitimate message that merely *mentions*
  "ConnectionRefused") — mitigated by anchoring signatures (`^API Error:`, exact provider
  phrases) and only firing when the signature IS the message, plus the canonical round-trip.
- **Rollback:** revert the PR. Detection/surface are additive and presentational; the persist
  sanitizer only rewrites content already destined to be an error string. No data migration.

## Out of scope

- A structured `AgentMessage.deliveryStatus` column (deferred ratchet; note in PR).
- Global retry in `routing/fallback.ts` (kept targeted to the two named surfaces).
- The `buildExecState` overwrite-vs-merge smell near agent-coworker.ts:2042 (pre-existing).
