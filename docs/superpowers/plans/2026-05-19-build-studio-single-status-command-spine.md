# Build Studio Single Status Command Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate Build Studio status narration by making the top command card the single source-backed operator action surface and turning the Progress tab into evidence.

**Architecture:** Reuse the existing progress projection as the primary truth model. Pass the projection into workflow-action derivation, keep build-row derivation as a loading fallback, and update the UI so only one component owns the operator action/failure-axis heading. Add small evidence improvements for source-currency staleness and dispatch root-cause extraction.

**Tech Stack:** Next.js 16, React client components, Prisma-backed Build Studio projections, Vitest, DPF theme CSS variables.

**Backlog:** `BI-0B41B4E3`.

**Spec:** [2026-05-19-build-studio-single-status-command-spine-design.md](../specs/2026-05-19-build-studio-single-status-command-spine-design.md).

---

## File Structure

- Modify `apps/web/lib/build/progress-visibility.ts` only if a small exported type alias is needed.
- Modify `apps/web/components/build/build-studio-workflow-actions.ts` so recovery actions can consume `BuildProgressVisibility` from **both** `deriveBuildStudioWorkflowAction` and `deriveWorkflowStageGuidance`.
- Modify `apps/web/components/build/BuildStudio.tsx` to derive `workflowAction` after `progressVisibility` state is available, pass the projection to the action card, and forward it to `WorkflowStageInspector`.
- Modify `apps/web/components/build/WorkflowStageInspector.tsx` to accept `progressVisibility` and thread it into `deriveWorkflowStageGuidance` so the stage-inspector title/next-approval copy matches the top card.
- Modify `apps/web/components/build/BuildStudioWorkflowActionCard.tsx` to render `Build Status` and source badges.
- Modify `apps/web/components/build/BuildProgressOperationalPanel.tsx` to remove the duplicate `Operational status` heading and keep task progress/evidence.
- Modify `apps/web/components/build/BuildSandboxCard.tsx` to show source-currency checked age and stale warning past the 5-minute threshold defined in the spec.
- Modify `apps/web/lib/build/dispatch-attempts.ts` to prefer classified root-cause lines over CLI prologue lines, with the tightened axis-matcher rules from the spec.
- Update the matching tests beside each touched file; add `WorkflowStageInspector.test.tsx` if it does not already cover the projection-derived guidance path.

## Task 1: Projection-Backed Command Status

- [ ] Add a failing test in `build-studio-workflow-actions.test.ts` where task summaries are generic but progress projection has a `usage-limit` dispatch-derived heading.
- [ ] Add a paired test that asserts the spec invariant: with the same fixture, both `deriveBuildStudioWorkflowAction` and `deriveWorkflowStageGuidance(...).workflowAction` return `failureAxis === progressVisibility.statusHeading.failureAxis`.
- [ ] Add a degradation test: projection null → action still derives from build row (no skeleton, no throw).
- [ ] Update `deriveBuildStudioWorkflowAction` to accept optional `progressVisibility`.
- [ ] Update `deriveWorkflowStageGuidance` to accept and forward `progressVisibility`.
- [ ] In implementation recovery, use the projection's `failureAxis` and `operatorAction` when present, respecting the precedence ladder in the spec (axis null → fall back; copy null → fall back).
- [ ] Pass `progressVisibility` from `BuildStudio.tsx` to the action card **and** to `WorkflowStageInspector`.
- [ ] Verify the focused workflow-action tests pass.

## Task 2: One Visible Operator Status

- [ ] Add or update component tests so `BuildStudioWorkflowActionCard` renders `Build Status`.
- [ ] Update `BuildProgressOperationalPanel.test.tsx` to assert the panel no longer renders `Operational status` or the operator-action text.
- [ ] Update the action card and progress panel accordingly.
- [ ] Keep DB/Chat/Sandbox/Dispatch/Verification evidence visible.

## Task 3: Source Currency Age

- [ ] Add a `BuildSandboxCard` test for `checkedAt` within the 5-minute window (no stale badge) and a paired test past it (stale badge visible).
- [ ] Define the threshold as a single named constant inside `BuildSandboxCard` (e.g., `SOURCE_CURRENCY_STALE_MS = 5 * 60 * 1000`) so future tuning is one-line.
- [ ] Render a source-currency checked badge with relative age and a stale warning past the threshold inside `BuildSandboxCard`.
- [ ] Do not add a live refresh action in this slice; that requires a server action/MCP observer follow-up.

## Task 4: Dispatch Root Cause Quality

- [ ] Add a failing dispatch-attempt test with `Reading prompt from stdin...` before a Codex usage-limit error.
- [ ] Add a prologue-corpus fixture test that asserts no axis matcher fires on any prologue line (`Reading prompt from stdin`, `OpenAI Codex`, `codex `, plus any others discovered in current dispatch logs).
- [ ] Tighten `lineMatchesFailureAxis` per the spec:
  - `test-failure`: require `test` AND one of `fail|error| × ` (not bare `fail`).
  - `typecheck-failure`: require `error TS` or `typecheck` (drop bare `typescript`).
  - `out-of-scope-noise`: drop the bare `workspace` substring; keep `out-of-scope`.
- [ ] Update root-cause extraction to skip prologue lines and prefer lines matching the classified failure axis.
- [ ] Preserve redaction, excerpt bounds, and root-cause hash behavior.

## Task 5: Verification And Handoff

- [ ] Run focused Vitest for the touched tests.
- [ ] Run `pnpm --filter web typecheck`.
- [ ] If dependencies/environment allow, run `pnpm --filter web exec next build`.
- [ ] Rebuild or start the Docker-served portal from this branch for `/build` UX verification when the root portal target is available. Drive the portal: select the affected build, confirm the top card shows the projection-derived failure axis, confirm the Progress tab no longer carries an operator-action heading, confirm the stage inspector matches, confirm the source-currency stale badge appears when `checkedAt` is older than 5 minutes, and confirm the dispatch root-cause line is the classified line — not the CLI prologue. Per `structural-verification-is-not-functional`, structural test passes alone do not close this slice.
- [ ] Commit with DCO and push the branch.

---

## Execution Status

Implemented on `feat/build-studio-command-spine` (commit `8d2e334e`). Focused Vitest, `pnpm --filter web typecheck`, and `pnpm --filter web exec next build` passed at that point. Outstanding work introduced by this revision of the plan:

- **`WorkflowStageInspector` was not threaded with `progressVisibility`** — the inspector still re-derives stage guidance from the build row, recreating the second-narrator split inside the stage detail panel. Tasks 1 above now cover this.
- **Source-currency staleness has no defined threshold** in the original implementation; Task 3 now nails it to 5 minutes via a named constant.
- **Dispatch axis matchers are too loose** for `test-failure` / `typecheck-failure` / `out-of-scope-noise`; Task 4 tightens them.
- **Full `/build` UX verification remains pending.** The temporary worktree server reached authentication but could not connect to Docker Postgres from the host. Per kernel principle [`structural-verification-is-not-functional`](../../../../docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md), this slice is not complete until the live portal has been driven through the scenarios listed in Task 5.
