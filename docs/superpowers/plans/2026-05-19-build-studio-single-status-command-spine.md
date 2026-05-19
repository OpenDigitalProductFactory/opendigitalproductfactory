# Build Studio Single Status Command Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate Build Studio status narration by making the top command card the single source-backed operator action surface and turning the Progress tab into evidence.

**Architecture:** Reuse the existing progress projection as the primary truth model. Pass the projection into workflow-action derivation, keep build-row derivation as a loading fallback, and update the UI so only one component owns the operator action/failure-axis heading. Add small evidence improvements for source-currency staleness and dispatch root-cause extraction.

**Tech Stack:** Next.js 16, React client components, Prisma-backed Build Studio projections, Vitest, DPF theme CSS variables.

**Backlog:** `BI-0B41B4E3`.

**Execution status:** Implemented on `feat/build-studio-command-spine`. Focused Vitest, `pnpm --filter web typecheck`, and `pnpm --filter web exec next build` passed. Full `/build` UX verification remains pending until the portal is rebuilt or otherwise served from this branch with working DB connectivity; the temporary worktree server reached authentication but could not connect to Docker Postgres from the host.

---

## File Structure

- Modify `apps/web/lib/build/progress-visibility.ts` only if a small exported type alias is needed.
- Modify `apps/web/components/build/build-studio-workflow-actions.ts` so recovery actions can consume `BuildProgressVisibility`.
- Modify `apps/web/components/build/BuildStudio.tsx` to derive `workflowAction` after `progressVisibility` state is available and pass the projection.
- Modify `apps/web/components/build/BuildStudioWorkflowActionCard.tsx` to render `Build Status` and source badges.
- Modify `apps/web/components/build/BuildProgressOperationalPanel.tsx` to remove the duplicate `Operational status` heading and keep task progress/evidence.
- Modify `apps/web/components/build/BuildSandboxCard.tsx` to show source-currency checked age and stale warning.
- Modify `apps/web/lib/build/dispatch-attempts.ts` to prefer classified root-cause lines over CLI prologue lines.
- Update the matching tests beside each touched file.

## Task 1: Projection-Backed Command Status

- [ ] Add a failing test in `build-studio-workflow-actions.test.ts` where task summaries are generic but progress projection has a `usage-limit` dispatch-derived heading.
- [ ] Update `deriveBuildStudioWorkflowAction` to accept optional `progressVisibility`.
- [ ] In implementation recovery, use the projection's `failureAxis` and `operatorAction` when present.
- [ ] Pass `progressVisibility` from `BuildStudio.tsx`.
- [ ] Verify the focused workflow-action test passes.

## Task 2: One Visible Operator Status

- [ ] Add or update component tests so `BuildStudioWorkflowActionCard` renders `Build Status`.
- [ ] Update `BuildProgressOperationalPanel.test.tsx` to assert the panel no longer renders `Operational status` or the operator-action text.
- [ ] Update the action card and progress panel accordingly.
- [ ] Keep DB/Chat/Sandbox/Dispatch/Verification evidence visible.

## Task 3: Source Currency Age

- [ ] Add a `BuildSandboxCard` test for stale source-currency `checkedAt`.
- [ ] Render a source-currency checked badge and stale warning inside `BuildSandboxCard`.
- [ ] Do not add a live refresh action in this slice; that requires a server action/MCP observer follow-up.

## Task 4: Dispatch Root Cause Quality

- [ ] Add a failing dispatch-attempt test with `Reading prompt from stdin...` before a Codex usage-limit error.
- [ ] Update root-cause extraction to skip prologue lines and prefer lines matching the classified failure axis.
- [ ] Preserve redaction, excerpt bounds, and root-cause hash behavior.

## Task 5: Verification And Handoff

- [ ] Run focused Vitest for the touched tests.
- [ ] Run `pnpm --filter web typecheck`.
- [ ] If dependencies/environment allow, run `pnpm --filter web exec next build`.
- [ ] Rebuild or start the Docker-served portal from this branch for `/build` UX verification when the root portal target is available.
- [ ] Commit with DCO and push the branch.
