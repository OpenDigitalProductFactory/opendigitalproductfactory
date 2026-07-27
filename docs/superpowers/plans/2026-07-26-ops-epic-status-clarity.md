# `/ops` Epic Status Clarity Implementation Plan

**Backlog item:** BI-6F308164
**Epic:** EP-UX-COGLOAD
**Date:** 2026-07-26
**Delivery shape:** One atomic UI slice

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Make the existing `/ops` epic list explain its own status composition so a founder/operator does not need to switch to Grid to understand values such as `16/19`. Preserve the compact, scan-first row and progressive disclosure; do not add a route, dashboard, database field, status enum, or competing visual dialect.

## UX fit review

- **Decision:** fits-with-guardrails
- **Owning area:** Products
- **Route family:** `/ops`
- **Primary persona:** founder/operator scanning company work and deciding what remains actionable
- **Navigation layer touched:** local page presentation only
- **Reuse/convergence:** extend `EpicCard`, `BacklogItemRow`, `backlogVisibility`, and report-kit status semantics; converge the List and Grid mental models
- **Source truth:** `BacklogItem.status`, `BacklogItem.triageOutcome`, `BacklogItem.duplicateOfId`, and the existing `EpicWithRelations.items` read model
- **Empty/failure behavior:** zero-item epics remain explicit; all-terminal epics state their composition and how to reveal them
- **AI boundary:** informational interactions only; no coworker prompt is sent
- **Required guardrails:** deferred never means completed; duplicate retirement is distinguishable from postponed work; progress remains done/total; no hardcoded colors
- **Evidence before merge:** mixed-status render tests, hide/show tests, source-local type/test gate where available, production build through governed local CI, and live `/ops` checks at desktop and narrow widths

## Backlog coverage

- Decision: atomic
- Parent: `BI-6F308164`
- Deliverable: `ops-epic-status-clarity` → `BI-6F308164`
- Dependencies: none
- Receipt: `cms2os8dj07gf01qq6lb73tka`
- Rationale: the status summary, Active only semantics, deferred lifecycle labels, shared counting logic, and operator documentation form one coherent UX contract. Shipping any subset would leave the `/ops` page internally contradictory.

## Phase 1 — Test the truthful presentation contract

**Files**

- `apps/web/components/ops/backlogVisibility.test.ts`
- `apps/web/components/ops/OpsClient.test.tsx`

**Work**

1. Add a pure status-composition contract covering `triaging`, `open`, `in-progress`, `done`, and `deferred`.
2. Add mixed-status epic rendering expectations for an explicit composition such as `1 open · 1 in progress · 1 done · 1 deferred`.
3. Replace the old expectation that deferred rows are “completed items hidden.”
4. Add a deferred duplicate fixture (`triageOutcome=duplicate`) and assert that its rendered meaning differs from genuinely postponed work.
5. Cover zero-item and all-terminal epic copy.

**Verification**

- Run the targeted Vitest files and observe the new assertions fail for the expected missing behavior before implementation.

## Phase 2 — Implement one shared status vocabulary

**Files**

- `apps/web/components/ops/backlogVisibility.ts`
- `apps/web/components/ops/EpicCard.tsx`
- `apps/web/components/ops/BacklogItemRow.tsx`
- `apps/web/components/ui/report-kit/statusColors.ts` only if the existing `backlogItem` mapping is incomplete

**Work**

1. Add a pure `backlogStatusComposition` helper so counts, accessible labels, progress details, and hidden-item copy derive from one source.
2. Keep progress strictly `done / total`; add an accessible explanation that deferred work is terminal but not done.
3. Render a compact status composition in every epic row. Use responsive wrapping/progressive disclosure so title scanability remains primary.
4. Rename “Hide done” to language that matches the actual filter (`done` plus `deferred`) and update empty/hidden summaries accordingly.
5. In expanded rows, identify deferred duplicates as retired duplicates and other deferred items as deferred—not completed.
6. Reuse report-kit status semantics rather than maintaining another page-local color map where practical.
7. Refactor repeated status labeling/counting out of `EpicCard`; keep at least 20% of implementation effort on convergence and removal of misleading local logic.

**Verification**

- Re-run targeted tests to green.
- Run affected typecheck/build gates through the worktree if it becomes compile-ready; otherwise use the governed shared local-CI environment and record source-only limitations honestly.

## Phase 3 — Update operator documentation

**Files**

- `docs/user-guide/operations/index.md`

**Work**

1. Define each backlog status in operator language.
2. Explain that epic progress counts `done` only.
3. Explain that deferred is terminal for active-work filtering but may mean deferred, duplicate, or discarded depending on its triage outcome.
4. Remove the stale claim that ordinary backlog items have a due date; the live `BacklogItem` schema has no due-date or defer-until field.

**Verification**

- Run relevant documentation-reference/prose checks included in the branch gate.

## Phase 4 — Functional UX verification and handoff

**Work**

1. Verify the deployed branch through the governed shared local-CI convergence sandbox.
2. Exercise `/ops` with the real `EP-ARCH-8D4F2A` mixed-status fixture.
3. Confirm the row explains 16 done, 2 deferred, and 1 open without switching to Grid.
4. Toggle the terminal filter and confirm both deferred records reveal honest meanings.
5. Check desktop and narrow widths for overlap, truncation, and horizontal overflow.
6. Re-sweep `origin/main` and open PRs immediately before push.

**Completion gate**

- Targeted unit tests pass.
- Production build passes.
- Live `/ops` behavior passes at desktop and narrow widths.
- No migration is introduced.
- Documentation is current.
- Branch is DCO-signed, pushed, and opened as a ready-for-review PR only after all gates pass.

## Risks and rollback

- **Density risk:** four counts could overwhelm the compact epic row. Mitigation: lead with remaining actionable work, keep secondary terminal counts visually quiet, and provide a complete accessible label.
- **Semantic risk:** changing progress to include deferred would inflate completion. Mitigation: keep `done / total` canonical and label deferred separately.
- **Performance risk:** per-render filtering could multiply work across hundreds of epics. Mitigation: compute one linear composition per epic and reuse it.
- **Compatibility risk:** changing terminal-filter copy may invalidate snapshots. Mitigation: targeted tests define the new vocabulary.
- **Rollback:** revert the component/helper/docs commit; no database, migration, or persisted state changes are involved.
