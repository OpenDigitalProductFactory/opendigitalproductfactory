---
status: active
---

# Workroom-shaped areas: implementation plan

- **Backlog item:** `BI-A3E4BA47`
- **Epic:** `EP-2FB6C0CC`
- **Design:** [portfolio-shaped IA §9](../specs/2026-08-14-portfolio-shaped-information-architecture-design.md) (spec approval `initiative-776a79f8-d526-4943-a297-098d5f9f4259`, baseline `baseline-f591c7d1-d078-4890-9ea0-ac1482c32d47`)
- **Kernel decision:** WWMD `DI-3CAD53D55BC5`, portfolio spine with activity labels
- **Workroom:** `WC-B44EE408`

## Outcome

The portal menu follows what people do. Each portfolio section is a workroom area with three entries:
- **Work:** its rooms.
- **Team:** its people and AI coworkers, with their authority.
- **Setup:** the settings its work reads.

Admin shrinks to cross-cutting access and upkeep. Every phase removes more navigation than it adds, and no phase adds a table, registry or renderer.

## Order and why

Phases are ordered so each one ships on its own and the menu gets simpler at every step, not only at the end.

| Phase | Deliverable | Removes | Adds | Depends on |
|---|---|---|---|---|
| 0 | Label truth: rail label, page title and breadcrumb agree, with a guard test | 7 mismatched labels; hand-kept tile labels | One nav-model test | none |
| 1 | Dead nav components and legacy-link repointing | 4 components; 29 links to redirect aliases | A derived redirect-alias guard | none |
| 2 | Contributing & GitHub reachable in at most 3 operations | "Platform Development" under Advanced | One renamed entry | none |
| 3 | Workforce unification (spec phases 0–1): the Team section's first form | Workforce split across 3 sections | Section-to-portfolio trace map | phase 0 |
| 4 | Area **Work** view: a filtered `/ops/workrooms` per portfolio | Duplicate Backlog › Workrooms entry; the rail "Work" entry once every area has Work | Route parameter on the existing inventory | phase 3 |
| 5 | Area **Setup**, one area per PR, from the settings sweep | Admin Organization and Configuration families; Advanced tab | Setup entry per area | phase 3; ineffective controls cleared by BI-595245CC first |
| 6 | Area **Team** projection | nothing duplicated | Team entry per area over existing bindings | phase 3; BI-CB525EC6 for owner roles (degrades to an empty state) |
| 7 | Platform upkeep leaves Backlog; one home for access | Runtime & Releases tab group; duplicate access surface; "Core Admin" card | Updates & health family | phase 5 |
| 8 | Spine rollout behind the nav-mode preview, then default after the founder's walk | Six old section keys; 4+ rail entries; Admin rail entry | none | phases 3–7 |
| 9 | Tiles derived from the nav model; advanced routes behind disclosure | `ALL_TILES`, blueprints; first-row diagnostic tabs | One disclosure | phase 8 |

## Verification for every phase

- Unit tests for the changed nav model and guards, and `pnpm --filter web typecheck`.
- UX Route Budget Sweep. A phase that changes the rail re-freezes the baseline deliberately and shows lower shell word counts.
- A `docs/ux-fit/*.ux-fit.json` manifest with measured sweep numbers or a propose-n-pick decision.
- A browser walk on the running portal of the review's activity map, counting operations to outcome before and after.
- Section-scoped nav, breadcrumb and one-SectionNav ratchet unchanged.

## Traceability

Requirements are the spec's §9.7 objectives and verification is its acceptance rows. Contracts and flows name the code seam and the operator path each phase changes.

| Deliverable | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|
| phase-0-label-truth | OBJ-AREA-SPINE | contract-nav-model-labels | flow-rail-to-page-heading | AC-AREA-SPINE, AC-AREA-GUARDS |
| phase-1-dead-nav-and-legacy-links | OBJ-AREA-NO-REGRESSION | contract-redirect-alias-guard | flow-link-to-canonical-page | AC-AREA-GUARDS |
| phase-2-contributing-and-github | OBJ-AREA-SETUP | contract-admin-nav-families | flow-rail-to-connect-github | AC-AREA-OUTCOME, AC-AREA-SETUP |
| phase-3-workforce-unification | OBJ-AREA-SPINE, OBJ-AREA-TEAM | contract-shell-sections-trace-map | flow-rail-to-team-section | AC-AREA-SPINE, AC-AREA-GUARDS |
| phase-4-area-work | OBJ-AREA-WORK | contract-workroom-inventory-loader | flow-area-to-rooms-and-back | AC-AREA-WORK |
| phase-4-workrooms-one-home | OBJ-AREA-WORK | contract-ops-and-ea-nav | flow-rail-to-workrooms | AC-AREA-WORK, AC-AREA-GUARDS |
| phase-5-area-setup | OBJ-AREA-SETUP | contract-settings-area-map | flow-area-to-setup | AC-AREA-SETUP, AC-AREA-OUTCOME |
| phase-5-retire-advanced | OBJ-AREA-SETUP | contract-admin-nav-families | flow-area-to-setup | AC-AREA-SETUP |
| phase-6-area-team | OBJ-AREA-TEAM | contract-bindings-and-participants | flow-area-to-team-to-record | AC-AREA-TEAM |
| phase-7-upkeep-out-of-backlog | OBJ-AREA-SETUP, OBJ-AREA-SPINE | contract-ops-and-platform-nav | flow-rail-to-updates-and-health | AC-AREA-SETUP, AC-AREA-GUARDS |
| phase-7-access-one-home | OBJ-AREA-SETUP | contract-access-surfaces | flow-rail-to-manage-user | AC-AREA-SETUP |
| phase-8-spine-rollout | OBJ-AREA-SPINE, OBJ-AREA-NO-REGRESSION | contract-shell-sections-trace-map | flow-activity-map-top-tasks | AC-AREA-SPINE, AC-AREA-OUTCOME, AC-AREA-GUARDS |
| phase-9-derived-tiles | OBJ-AREA-SPINE | contract-workspace-tiles | flow-workspace-launcher | AC-AREA-SPINE |
| phase-9-advanced-disclosure | OBJ-AREA-NO-REGRESSION | contract-route-audience-registry | flow-section-first-row | AC-AREA-GUARDS |

## Rollback

Each phase is one PR and reverts as one unit. Routes stay, or keep a redirect with an expiry, so bookmarks survive a revert.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-A3E4BA47`
- Receipt: blocked-by: the coverage receipt is minted by record_plan_backlog_coverage at this plan's commit and lives in the MCP substrate; writing its id here would move the head that the plan review binds to
- Dependencies: phase-3 -> phase-0; phase-4 -> phase-3; phase-5 -> phase-3 and BI-595245CC; phase-6 -> phase-3 and BI-CB525EC6; phase-7 -> phase-5; phase-8 -> phases 3 to 7; phase-9 -> phase-8
- Deliverables:
  - phase-0-label-truth -> `BI-552BADE0`; depends on: none
  - phase-1-dead-nav-and-legacy-links -> `BI-454FF60F`; depends on: none
  - phase-2-contributing-and-github -> `BI-BB74D6C6`; depends on: none
  - phase-3-workforce-unification -> `BI-4BF1FF9C`; depends on: phase-0-label-truth
  - phase-4-area-work -> `BI-2EA3BB99`; depends on: phase-3-workforce-unification
  - phase-4-workrooms-one-home -> `BI-855C9B6D`; depends on: phase-3-workforce-unification
  - phase-5-area-setup -> `BI-87C05BB8`; depends on: phase-3-workforce-unification
  - phase-5-retire-advanced -> `BI-3ED24FA2`; depends on: phase-3-workforce-unification
  - phase-6-area-team -> `BI-A369B0AB`; depends on: phase-3-workforce-unification
  - phase-7-upkeep-out-of-backlog -> `BI-811C588E`; depends on: phase-5-area-setup
  - phase-7-access-one-home -> `BI-154E409C`; depends on: phase-5-area-setup
  - phase-8-spine-rollout -> `BI-A3E4BA47`; depends on: phase-7-upkeep-out-of-backlog
  - phase-9-derived-tiles -> `BI-DBA470FF`; depends on: phase-8-spine-rollout
  - phase-9-advanced-disclosure -> `BI-E8D91AF6`; depends on: phase-8-spine-rollout
