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

- [x] Add a failing test where task summaries are generic but progress projection has a `usage-limit` heading. — landed in `8d2e334e`.
- [x] Paired invariant test: both `deriveBuildStudioWorkflowAction` and `deriveWorkflowStageGuidance(...).workflowAction` return `failureAxis === progressVisibility.statusHeading.failureAxis`. — landed in `628fc741`.
- [x] Degradation test: projection null → action still derives from build row. — landed in `628fc741`.
- [x] Update `deriveBuildStudioWorkflowAction` to accept optional `progressVisibility`. — `8d2e334e`.
- [x] Update `deriveWorkflowStageGuidance` to accept and forward `progressVisibility`. — `628fc741`.
- [x] In implementation recovery, use the projection's `failureAxis` and `operatorAction` when present, respecting the precedence ladder. — `8d2e334e`.
- [x] Pass `progressVisibility` from `BuildStudio.tsx` → action card AND `WorkflowStageInspector` (via `ProcessGraph`). — `628fc741`.
- [x] Verify the focused workflow-action tests pass. — 21/21 green.

## Task 2: One Visible Operator Status

- [x] `BuildStudioWorkflowActionCard` renders `Build Status` — tested in `BuildStudioWorkflowActionCard.test.tsx` (2 assertions).
- [x] `BuildStudioHeaderLayout.test.tsx` updated from legacy `Studio Control` to `Build Status` — `628fc741`.
- [x] `BuildProgressOperationalPanel.test.tsx` asserts the panel no longer renders `Operational status` or operator-action text. — `8d2e334e`.
- [x] Action card and progress panel updates. — `8d2e334e`.
- [x] DB/Chat/Sandbox/Dispatch/Verification evidence remains visible.

## Task 3: Source Currency Age

> **Implementation note.** Threshold and helper landed at the truth-model layer (`apps/web/lib/build/progress-visibility-types.ts`), not inside the sandbox card. The card consumes `getTruthSourceAge` and `BUILD_TRUTH_STALE_THRESHOLD_MS`. The spec was updated to match — do not relocate the constant back into the card during this task.

- [x] Define the threshold as a single named constant — landed as `BUILD_TRUTH_STALE_THRESHOLD_MS = 5 * 60 * 1000` in `progress-visibility-types.ts`. Shared with the rest of the build truth model so one surface can't call "stale" what another calls "fresh."
- [x] Render a source-currency checked badge with relative age and a stale warning past the threshold inside `BuildSandboxCard`.
- [x] `BuildSandboxCard` test for `checkedAt` within the 5-minute window vs past it.
- [ ] Do not add a live refresh action in this slice; that requires a server action/MCP observer follow-up. (Pure scope guardrail — leave unchecked.)

## Task 4: Dispatch Root Cause Quality

> **Status:** prologue-skip path is in place (`isCliPrologueLine` plus `extractRootCauseSummary`'s "axis line first, prologue-skipped first-line second" preference). This continuation pass also pins the prologue corpus and tightens the per-axis matchers so benign `fail`, `typescript`, and `workspace` text no longer classify as root cause.

- [x] Failing test with `Reading prompt from stdin...` before a Codex usage-limit error. — `8d2e334e`.
- [x] Skip prologue lines in `extractRootCauseSummary` and prefer the classified axis line. — `8d2e334e` (`isCliPrologueLine` runs before the fallback first-line pick).
- [x] Preserve redaction, excerpt bounds, and root-cause hash behavior. — `sanitizeDispatchOutput`/`normalizeRootCauseForHash` unchanged.
- [x] Add a prologue-corpus fixture test that asserts no axis matcher fires on any prologue line (`Reading prompt from stdin`, `OpenAI Codex`, `codex `, plus TypeScript/workspace prompt prologues).
- [x] Tighten `lineMatchesFailureAxis` in `apps/web/lib/build/dispatch-attempts.ts`:
  - `test-failure`: require `test` AND one of `fail|error| × `.
  - `typecheck-failure`: require `error TS` or `typecheck`.
  - `out-of-scope-noise`: drop the bare `workspace` substring.

## Task 5: Verification And Handoff

- [x] Run focused Vitest for the touched tests. — 55/55 in the reviewed focus suite green after the final rebase; the prior broader `components/build` sweep was green after `628fc741`.
- [x] Run `pnpm --filter web typecheck`. — clean after the final rebase.
- [x] Run `pnpm --filter web exec next build`. — passed after the final rebase; only pre-existing Turbopack/NFT trace warnings remain.
- [x] Commit with DCO and push the branch. — `8d2e334e` and `628fc741` are signed off; this continuation pass is included in the final signed handoff commit.
- [ ] **Open.** Rebuild or start the Docker-served portal from this branch for `/build` UX verification when the root portal target is available. Drive the portal: select the affected build, confirm the top card shows the projection-derived failure axis, confirm the Progress tab no longer carries an operator-action heading, confirm the stage inspector matches, confirm the source-currency stale badge appears when `checkedAt` is older than 5 minutes, and confirm the dispatch root-cause line is the classified line — not the CLI prologue. Per `structural-verification-is-not-functional`, structural test passes alone do not close this slice.

---

## Execution Status

Resolved on `feat/build-studio-command-spine`:

- **`8d2e334e`** — projection-backed command status; relabel to `Build Status`; Progress tab deduplication; initial source-currency UI; dispatch prologue skip.
- **`628fc741`** — `WorkflowStageInspector` threaded with `progressVisibility` (closes the second-narrator gap that originally remained); single-narrator invariant test + degradation test added; `BuildStudioHeaderLayout.test.tsx` updated from `Studio Control` → `Build Status` (cleanup of pre-existing failure from the relabel). 113/113 build-component tests pass; `pnpm --filter web typecheck` clean.

Outstanding before this slice closes:

- **Task 4 — dispatch axis matcher tightening + prologue-corpus fixture.** Implemented in this continuation pass. `lineMatchesFailureAxis` now rejects CLI prologue lines and no longer treats bare `fail`, bare `typescript`, or bare `workspace` as a root-cause match.
- **Live `/build` UX verification.** The temporary worktree server reached authentication but could not connect to Docker Postgres from the host. Per kernel principle [`structural-verification-is-not-functional`](../../founder-kernel/wiki/principles/structural-verification-is-not-functional.md), this slice is not complete until the live portal has been driven through the Task 5 scenarios. Suggested path: full Docker rebuild from this branch (`docker compose up --build` against the governed portal target), then drive `/build?buildId=FB-71FB3A53` (the original observed build) and capture screenshots of the four invariants into `output/playwright/`.

Recommended next-commit sequence:

1. Push the branch.
2. Run the live `/build` drive against the rebuilt Docker portal; record evidence.
3. Open a PR against `main` only after step 2.
