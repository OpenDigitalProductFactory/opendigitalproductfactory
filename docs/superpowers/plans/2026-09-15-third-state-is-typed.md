---
status: draft
---

# Plan — the third state is typed

**Spec:** [`docs/superpowers/specs/2026-09-15-third-state-is-typed-addendum-design.md`](../specs/2026-09-15-third-state-is-typed-addendum-design.md) (§10 addendum to the 2026-06-05 unified-delivery-surfaces spec)
**Backlog:** `EP-A480A6F7` — filed 2026-09-15. Phase 2.1 `BI-FF63D266`, 2.2 `BI-C77D920A`, 2.3 `BI-09D11444`; phase 3 `BI-9F6AFFA0`; phase 4 `BI-174DB909`, `BI-77CFC7BF`, `BI-AF9E4906`. See the spec's §9 for the full table.
**Status:** phase 1 delivered; phases 2–4 not started.

## Phase 1 — declare the vocabulary, make it expressible (delivered)

The narrowest change that is still load-bearing: nothing decides differently, but the distinction becomes something code can read instead of something a model has to infer from English.

1. `apps/web/lib/shared/outcome-disposition.ts` — the closed five-member union, `RETRY_POSTURE` as a total `Record`, and `isVerdict` / `isNonVerdict` / `countsAsFailure`. Pure, no imports, so anything may depend on it. Placed beside `action-result.ts`, whose binary shape is the reason the third state has no home.
2. `ToolResult.disposition?: OutcomeDisposition` — **additive and optional**. `success` keeps its meaning and every existing caller is untouched; absent means the tool has not declared one.
3. `GOVERNED_REJECTION_DISPOSITION: Record<GovernedExecuteRejection, OutcomeDisposition>` in `mcp-governed-execute.ts` — the classification, at the seam every governed tool call passes through. Five of the thirteen rejections are not refusals.
4. `rejectionResult` sets the disposition, and stops wording an `inconclusive` outcome as "rejected". `error` and `success` are deliberately unchanged: the scheduler's run-verdict classifier keys on `error === "approval_required"` (BI-4F64C5D3), so this adds a signal rather than moving one.
5. `approvalPendingResult` declares `awaiting-person`.

### Why `success` was not changed to a union

It is returned by ~414 tools and consumed by the MCP REST route, the JSON-RPC route, the agentic loop, the call-efficiency scan and the operations map. Changing its type is a platform-wide edit with no way to stage it, and the compile errors would be in call sites that are all individually correct. The optional field gives every consumer that needs the distinction a way to read it, at the cost of one convention: a caller that branches on `success` alone is now knowingly ignoring a signal, which is a reviewable fact rather than an invisible one.

### Verification

- `pnpm --filter web exec vitest run lib/shared/outcome-disposition.test.ts` — 9 passed.
- `pnpm --filter web exec vitest run lib/mcp-governed-execute app/api/mcp/call lib/tak/scheduled-task-runs lib/operate/mcp-call-efficiency` — 120 passed, 3 skipped, 0 failed.
- `pnpm --filter web exec tsc --noEmit` — exit 0.
- **The compile-time guarantee was exercised, not assumed.** A fourteenth member was injected into `GovernedExecuteRejection` and `tsc` rejected it:
  `error TS2741: Property 'some_new_reason_nobody_classified' is missing in type '{ … }' but required in type 'Record<GovernedExecuteRejection, …>'`. The injection was reverted; the tree carries thirteen.

## Phase 2 — close the collapse sites

In cost order. Each is a behaviour change and needs its own backlog item and its own PR.

1. **`change-review/semantic-review-background.ts:213`** — `inconclusive` is persisted as `"failed"`, against AGENTS.md §4's "never a FAIL against the diff". The correct target status already exists in the A2A vocabulary the same file uses eight lines above. Blast radius: everything reading `TaskRun.status` for review outcomes, so it pairs with phase 3.
2. **`nonprod/environment-lease-pool-policy.ts:66`** — `queued` and `blocked` collapse to one boolean. The caller cannot tell "wait, capacity will free" from "this will never be admitted", which is the lease-wait behaviour the resilient-concurrent-development spec depends on.
3. **`explore/feature-build-types.ts:724`** — `PhaseGateResult { allowed: boolean; reason?: string }`. The widest one: it governs ideate→plan→build→review→ship and cannot say "waiting on a reviewer" at all. Likely wants the full `{ disposition, reason }` shape plus typed reason codes, which makes it the largest piece of work here.

## Phase 3 — enum the run-status columns

`TaskRun.status` (`build-delivery.prisma:1059`) carries its nine-member A2A vocabulary in a doc comment above a `String`, against §8. `ScheduledAgentTask.lastStatus` (`ai-coworker.prisma:1200`) says `// ok | error` and #5335 already writes `"proposed"` to it.

Forward-only migration, inline backfill. Must land after phase 2.1 or in the same change, since the enum is what stops the collapse recurring.

## Phase 4 — total the partial maps, and type the shape stops

- Every map keyed by `ReadinessCode` is `Partial<Record<…>>` (27-member union; `readiness-guidance.ts:161,199`, `initiative-readiness-tool-grants.ts:434,447`), so a new code compiles silently. Making them total is mechanical and is what turns §9's guarantee from a convention back into a compile error.
- `WorkShapeStopCondition.kind` gains a disposition, and the existing prose — "stops and escalates", "the room stops for reshaping", "refused; the lane is WIP 1" — migrates from the free-text `condition` into it.
- `refusal-codes.ts`'s `ReadonlySet<string>` becomes a total map over the governed rejection union, so it cannot go stale.

## Non-goals

- Changing what any gate decides.
- Collapsing the eight domain vocabularies into one flat enum. They are correctly domain-specific and need a shared mapping, not a shared name.
