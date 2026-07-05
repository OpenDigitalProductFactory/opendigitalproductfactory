# Build Studio — failed ideate/scout inference recovery

- **BI:** BI-F0005EB0 (large, bug, triage=build)
- **Epic:** EP-BS-UX-HARDENING — "happy path survives inference failures, status surfaces stay honest"
- **Date:** 2026-07-05
- **Author:** Claude (Opus 4.8)

## Problem (verified live 2026-07-04, FB-54088DED)

When a Build Studio build's **first ideate inference fails**, the raw provider error
(e.g. `API Error: Unable to connect to API (ConnectionRefused)`) is stored as an
ordinary **assistant** `AgentMessage` and the build silently stalls in `ideate`. The
custodian classifies this as the benign **"Waiting on evidence"** (accent) state — there
is no error state, no retry affordance, and no auto-recovery. A non-technical user is
dead-ended: the UI implies *they* must act, when in fact the AI call errored and was
dropped. Recovery today requires the user to manually re-prompt.

## Root cause (grounded)

1. **Persist path** — the auto-seeded ideate turn (`BuildStudio.tsx:615`, "Let's define it
   together") runs the coworker loop: `agent-coworker.ts sendMessage` →
   `executeAutonomousAgenticLoop` (`lib/tak/autonomous-work-run.ts:190`) → `runAgenticLoop`
   (`lib/tak/agentic-loop.ts`). A thrown route error becomes friendly `content` via
   `describeToolRouteFailure` (`agentic-loop.ts:1531-1546`); but a provider/CLI error that
   comes back **as a successful `result.content`** (e.g. the observed
   `API Error: Unable to connect…`) is never recognised as a failure. Either way, the
   loop returns a string and `agent-coworker.ts` persists it verbatim as an `assistant`
   message (`agent-coworker.ts:2138`). The existing `catch` only handles typed
   `NoProvidersAvailableError` / `NoEligibleEndpointsError` — a raw connection error is
   not one of them.
2. **Classification path** — the custodian
   (`build-studio-custodian.ts:121-217`) classifies stalls into `technicalRecovery`
   (`resume-implementation`/`rerun-plan-review`/`retry-build`/`reset-build`) vs
   `blockedByEvidence` (`action.disabledReason != null`). In `ideate`,
   `deriveBuildStudioWorkflowAction` returns `advance-phase` with a `disabledReason` (gate
   not met) → `blockedByEvidence` → "Waiting on evidence". **No branch inspects whether
   the last agent turn was an error.**

## Substrate we build on (verified)

- `getBuildProgressVisibility` (`lib/build/progress-visibility.ts:135`) **already** loads
  the last 50 assistant `AgentMessage` rows for the build's `threadId`
  (`progress-visibility.ts:155-169`). This is the natural seam to detect a failed-inference
  turn and expose a signal — no new query needed.
- Both `deriveBuildStudioWorkflowAction` and `deriveBuildStudioCustodianPrompt` already
  receive `progressVisibility` (`BuildStudio.tsx:257-270`), so a new signal flows to both
  with no plumbing changes at the call site.
- Action → execution wiring is a `switch (action.kind)` in
  `BuildStudioWorkflowActionCard.tsx:173-207`; adding a kind means adding one branch there.
- `FeatureBuildRow.threadId` (`lib/explore/feature-build-types.ts:504`) links the build to
  its coworker thread.

## Design

A **shared inference-error classifier** recognised at three layers. The classifier is the
heart; everything else consumes it.

### New module — `apps/web/lib/build/inference-failure.ts` (pure, unit-tested)

```ts
export type InferenceFailureKind =
  | "connection"            // ConnectionRefused / ECONNREFUSED / "Unable to connect"
  | "provider-unavailable"  // "temporarily unavailable", "providers are momentarily busy"
  | "rate-limit"
  | "config"                // "No AI provider…configured", "No eligible endpoints"
  | "empty-response";

export function classifyInferenceFailure(content: string | null | undefined): InferenceFailureKind | null;
export function friendlyInferenceFailureMessage(kind: InferenceFailureKind): string;
```

- Recognises **both** the raw provider forms (`/^API Error:/i`, `/unable to connect to
  api/i`, `/connection\s*refused/i`, `/ECONNREFUSED/`, `/fetch failed/i`) **and** the
  friendly strings `describeToolRouteFailure` already emits (so a sanitised turn is still
  classifiable — this is what keeps the custodian signal alive after we stop persisting raw
  text).
- **Conservative** matching — anchored patterns (`^`/whole-message), not substring hunts,
  so a legitimate assistant reply that merely *mentions* "error" is not misread as a
  failure. This is the primary false-positive risk and gets dedicated tests.

### Phase 1 — Classifier module + tests (ships independently)

- Create `inference-failure.ts` + `inference-failure.test.ts`.
- **Verify:** `pnpm --filter web exec vitest run apps/web/lib/build/inference-failure.test.ts`
  — asserts the observed live string classifies as `connection`; asserts friendly
  `describeToolRouteFailure` outputs classify; asserts normal chat ("I hit an error in your
  config, let me fix it") returns `null`.

### Phase 2 — Expose signal on progress-visibility

- Extend `BuildProgressVisibility` with:
  ```ts
  inferenceFailure: { failed: boolean; kind: InferenceFailureKind | null; observedAt: string | null };
  ```
- In `buildProgressProjectionFromParts`, accept an optional `lastAssistant?: { content; createdAt }`
  arg (keeps existing test literals valid — defaults to no-failure). Classify the **newest**
  assistant message; set `failed` only when it classifies **and** it is at least as recent
  as `lastObservableSignalAt` (so a fresh successful task/dispatch after the error clears it).
- In `getBuildProgressVisibility`, pass the newest element of the already-fetched
  `chatMessages` (desc-ordered) as `lastAssistant`.
- **Verify:** unit tests on `buildProgressProjectionFromParts` — failure turn → `failed:true`;
  newer task activity → `failed:false`; no assistant messages → `failed:false`.

### Phase 3 — New `retry-inference` action + honest custodian branch (closes the reported dead-end)

- `build-studio-workflow-actions.ts`:
  - Add action kind `retry-inference` (danger, `primaryLabel: "Retry the AI call"`,
    `disabledReason: null`).
  - In `deriveBuildStudioWorkflowAction`, **scoped to `ideate`/`plan`** (the coworker-chat
    deliberation phases the bug covers; build/review keep their richer exec-state recovery),
    return `retry-inference` when `progressVisibility?.inferenceFailure?.failed` — checked
    before the phase's advance-gate branch so it takes priority over "gate not met".
  - Add `retry-inference` to `statusForAction` (→ `blocked-technical`/danger) and
    `nextSentenceForAction`.
- `build-studio-custodian.ts`:
  - `const failedInference = action.kind === "retry-inference";`
  - Add to the early null-guard and to `resolveCustodianStatusSignal` (→ `"blocked"`).
  - New branch **before** `technicalRecovery`/`blockedByEvidence`: title "The AI call
    failed.", danger intent, `statusLabel: "AI call failed"`, primary
    `"Retry the AI call"` (`primaryAction: "workflow"`), details drawn from
    `friendlyInferenceFailureMessage(kind)` — **never** the raw provider string.
- `BuildStudioWorkflowActionCard.tsx`: add `retry-inference` to the `primaryLabel` pending
  map ("Retrying the AI call…") and a `handlePrimaryAction` branch that re-drives the
  failed turn (see retry wiring below).
- **Verify:** extend `build-studio-workflow-actions.test.ts` and
  `build-studio-custodian.test.ts` — an ideate build with `inferenceFailure.failed` yields
  `retry-inference`/danger "AI call failed", **not** "Waiting on evidence".

### Phase 4 — Stop persisting raw provider errors + bounded auto-retry (fix (c),(d))

- **Persist-time guard (d)** in `agent-coworker.ts` before `agentMessage.create`
  (~line 2138): if `classifyInferenceFailure(responseContent)` is non-null, replace the
  user-visible content with `friendlyInferenceFailureMessage(kind)` (raw error still logged
  server-side for engineers). The sanitised text remains classifiable, so Phase 2/3 still
  fire.
- **Bounded auto-retry (c)** — for `ideate`/scout turns, when the first loop result
  classifies as a *transient* failure (`connection`/`rate-limit`), retry the loop up to 2×
  with backoff (500ms, 1500ms) inside the same request before falling through to the
  sanitised-failure persist. Deterministic `connection` to a downed local engine may still
  fail all attempts → custodian surfaces Retry (Phase 3). Backoff/attempt count are
  constants so the retry decision is unit-testable via an injected `sleep`/attempt hook.
- **Verify:** unit test the retry helper (2 failures then success → success; 3 failures →
  sanitised failure). Manual: confirm no raw `API Error:` string is persisted.

### Retry wiring

The `retry-inference` primary button re-drives the failed turn — the same recovery the
user does manually today. Least-invasive, consistent with `decompose-now`: dispatch the
`open-agent-panel` CustomEvent with a phase-appropriate retry `autoMessage` (re-ask the
ideate/scout question). No new server action required for the button; the durable
auto-retry lives server-side in Phase 4.

## Risks & rollback

- **False positives** (normal chat misread as failure) — mitigated by conservative anchored
  patterns + dedicated negative tests. Blast radius if wrong: a build shows a spurious
  "Retry the AI call" that, when clicked, simply re-drives the turn (harmless).
- **Over-eager auto-retry** burning local GPU — bounded to 2 retries, transient kinds only,
  ideate/scout only.
- **Scope creep into build/review recovery** — explicitly avoided; `retry-inference` is
  gated to `ideate`/`plan` so it never shadows `resume-implementation`/`reset-build`.
- **Rollback:** the classifier is additive; reverting Phases 2-4 restores prior behaviour.
  Phases are independently revertable (Phase 1 has no consumers on its own).

## Definition of done (BI acceptance)

- A failed ideate/scout inference surfaces as danger **"The AI call failed — Retry"**, not
  "Waiting on evidence".
- The raw provider error string is never persisted as a user-visible assistant message.
- Transient ideate/scout inference failures auto-retry with backoff before parking.
- All new/changed vitest suites green; CI typecheck authoritative.

## Sequencing

Phases 1→2→3 land the honest surface (the reported dead-end) and are the priority. Phase 4
(persist guard + auto-retry) completes the BI. All four ship in **one PR** (one concern:
inference-failure handling) referencing EP-BS-UX-HARDENING + BI-F0005EB0; if Phase 4's
auto-retry balloons, it splits to an immediate follow-up PR with Phases 1-3 already
delivering the user-visible fix.
