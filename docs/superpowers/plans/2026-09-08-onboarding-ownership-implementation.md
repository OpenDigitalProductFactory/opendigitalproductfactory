---
status: active
---

# Onboarding ownership — implementation plan

**Backlog item:** `BI-4B5E3443` (parent)  
**Design:** `docs/superpowers/specs/2026-09-08-onboarding-ownership-design.md` (merged PR #5220)  
**Symptom it repairs:** `BI-71F441A4` — 43 live Workrooms, none executing, four stacked causes  
**Objectives:** OBJ-ONB-ROLES-DERIVED, OBJ-ONB-BIND-AT-SETUP, OBJ-ONB-IMPORT-ASSISTED, OBJ-ONB-READY-REFUSES, OBJ-ONB-OWNER-FROM-DAY-ZERO (design §1.1)

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
before any success claim, and `dpf-pr-with-dco` for handoff. Claim every slice
with a declared shape (`delivery-small` or `delivery-medium` as the row says).

## Current state

Every claim below is a grep hit on `main` at `dfcae2e8637`.

- **The ladder has the hook and nothing feeds it.** `resolveRoomOwner`
  (`apps/web/lib/work-management/room-owner-ladder.ts:68`) descends explicit →
  shape driver → `archetypePrincipalRef`. The third input is `string | null`
  with no Prisma column, no seed and no writer; both production callers hardcode
  `null` (`apps/web/lib/authority/coordination-bindings.ts:67`,
  `apps/web/lib/attention/sources/workroom-stall.ts:161`). There is no
  role→principal model anywhere in `apps/` or `packages/`.
- **The shape rung answers with a role, not a principal.** The delivery shapes
  (`apps/web/lib/work-management/delivery-shapes.ts`) drive with `role:author`,
  `role:design-checklist-reviewer` and `role:portfolio-owner` on status-change
  stages. `resolveShapeDriver` returns that role ref, `parseAccountablePrincipalRef`
  (`drive-resolution.ts:107`) classifies it `role`, and the drive plan pauses on
  `role_stage`. Every `role:*` in the standing, coworker-standing and
  orchestration shapes sits on a governed-decision stage — an approver — so
  design §3.1's exclusion leaves the derived inventory at exactly the three
  delivery roles above. That is the correct, small answer; the test in phase 1
  pins it by name so a registry change is a visible test change.
- **Coordination authority is narrowed twice.** `planCoordinationBindings`
  defaults to `STANDING_SHAPES` (`coordination-bindings.ts:60`) and then skips
  any driver that is not `agent:` (`:72`). `reconcileCoordinationBindings`
  (`apps/web/lib/queue/functions/workroom-drive-data.ts:66`) calls it with no
  argument. A "coordination binding" is an `AuthorityBinding` row with
  `scopeType="workroom"`, `resourceType="work-shape"`, `resourceRef=<shapeKey>`
  (`packages/db/prisma/schema/core-identity.prisma:290`; eligibility in
  `apps/web/lib/work-management/coordinator-eligibility.ts:64`).
- **A room needs an EXPLICIT overseer to execute.** `evaluateWorkroomShapeConformance`
  (`workroom-shape-conformance.ts:210`) emits `missing_explicit_coordinator`
  unless `selectExplicitRoomCoordinator` finds one; a derived owner only earns
  `derived_coordinator_only`. Nothing at claim, create or adopt writes one;
  `appoint_room_coordinator` (`appoint-room-coordinator.ts:53`) is the only
  writer, by hand, after the stall.
- **Setup has no workforce-ownership step.** `SETUP_STEPS`
  (`apps/web/lib/actions/setup-constants.ts:6`) runs `business-context` (where
  `RosterImport` creates employees, `BusinessContextForm.tsx:388`) straight into
  `ai-providers`. Completion is projection-driven: `completeSetupStepFromEvidence`
  (`apps/web/lib/onboarding/setup-progress-service.server.ts:37`) writes
  `PlatformSetupProgress.completedAt` when no step is pending, then runs
  `runSetupCompletionSeeds` (`setup-completion-seeds.ts:30`), whose
  `seedArchetypeWorkforce` seeds employment types, not people.
- **Spreadsheet import exists without provenance.** `roster-import.ts`
  (mapper), `POST /api/onboarding/roster` (preview), `POST /api/onboarding/roster/import`
  (confirm), `importRoster` (`roster-import-actions.ts:37`). `ProposedEmployee`
  has no source fields and nothing is persisted about where a row came from.
  `brand/extraction/url-adapter.ts` already records
  `sources: [{ kind, ref, capturedAt }]` — the pattern to copy.
- **Public-page fetch exists and is guarded.** `fetchPublicWebsiteEvidence`
  (`apps/web/lib/public-web-tools.ts:372`) behind `assertAllowedPublicUrl` (`:191`)
  and `assertSafeOutboundUrl` (`apps/web/lib/security/safe-fetch.ts`, https only,
  private hosts refused).
- **Install readiness is commit-ancestry only.** `resolveLiveInstallReadiness`
  (`apps/web/lib/verify/preflight-service.ts:63`) feeds `computePreflightVerdict`,
  shared with `pnpm verify:preflight`. The admin surface is
  `/admin/diagnostics` over `GET /api/diagnostics/preflight` (ten steps).

## Atomic deliverables and backlog coverage

Each row is one clean revert. Order is the dependency order; phases 4, 5 and 6
can proceed in parallel once phase 2 has landed.

| # | Backlog item | Shape | Deliverable | Design | Depends on |
|---|---|---|---|---|---|
| 1 | `BI-1D6F5AE4` | small | `deriveRoleInventory(shapes)`: union of `role:*` drivers over the full registry, governed-decision stages excluded, shapes-per-role attached; `listWorkShapes()` exposes the union | §3.1 | — |
| 2 | `BI-8FDC274A` | medium | `ArchetypeRoleBinding` model + migration; ladder resolves a `role:*` driver through the binding (third rung); `planCoordinationBindings` over the full registry with role→agent resolution; `bindArchetypeRole` writes binding + coordination bindings in one transaction | §3.2, §3.3 | 1 |
| 3 | `BI-36FC2981` | small | Claim, create and adopt write the ladder's owner as the explicit Process Overseer at birth | §3.2, §7 | 2 |
| 4 | `BI-0F44A284` | medium | Setup step `workforce-ownership` after `business-context`; `/workforce/ownership` lists roles with binding in place; setup cannot complete with a silently unbound role | §3.2, §4, §5 | 1, 2 |
| 5 | `BI-40751F49` | medium | Assisted proposals: provenance on spreadsheet rows; public-page candidates carrying source URL + retrieval date; one confirm step creates records | §3.4, §6 | — |
| 6 | `BI-CB525EC6` | small | `resolveOwnershipReadiness`; preflight step 11 + `/admin/diagnostics` gaps with a link to bind; `verify_live_install_readiness` returns `ownership` and BLOCKED on gaps | §3.5 | 1, 2 |
| 7 | `BI-71F441A4` | — (existing) | Live acceptance on the dev install and reconciliation of the 43 stalled rooms through the readiness path, no room touched | §7 | 3, 4, 6 |

Objective baseline for the parent: the AC table in design §1.1. Acceptance for
the parent is design §7, verified on the live install: a fresh archetype setup
binds every derived role, install verification refuses while one is unbound,
and the first Workroom claimed afterwards resolves an owner with authority and
advances on its first drive cycle.

## Phase 1 — RED then GREEN: the inventory is derived (`BI-1D6F5AE4`)

Touched files: new `apps/web/lib/work-management/role-inventory.ts` (+ test);
`apps/web/lib/work-management/work-shapes.ts` (export the union through
`listWorkShapes()`, which already exists — no new export of `ALL_SHAPES`).

RED: a synthetic shape naming `role:new-owner` on a status-change stage adds
exactly one entry; the same role on a governed-decision stage adds nothing; the
inventory over the live registry equals `author`, `design-checklist-reviewer`,
`portfolio-owner`, each with its delivery shape keys. GREEN: the pure function.
Reuse the governed-decision exclusion by calling `resolveShapeDriver`'s rule, not
by re-implementing it — extract that predicate from `room-owner-ladder.ts` if it
is not already exported.

Verification: `vitest run` on the two files; `check-module-size` unchanged
(new module, not a grown one).

## Phase 2 — RED then GREEN: bindings populate the ladder and seed authority (`BI-8FDC274A`)

Touched files: `packages/db/prisma/schema/work-coordination.prisma` (new model
`ArchetypeRoleBinding`: `organizationId`, `role`, `principalRef`, `status`
active|revoked, `boundByUserId`, `provenance Json?`, unique `(organizationId, role)`,
FK indexes so `check-fk-index-coverage` stays green); forward-only migration;
`room-owner-ladder.ts` (input `roleBindings: ReadonlyMap<string, string>` or
equivalent; a `role:*` driver resolves through it with `source: "archetype"`; an
unbound role resolves `null` and the result names the unbound role);
`coordination-bindings.ts` (default `listWorkShapes()`; resolve `role:*` through
the bindings before the `agent:` check); `workroom-drive-data.ts`
(`reconcileCoordinationBindings` loads the org's bindings and passes them);
`workroom-stall.ts:161` (same); new `apps/web/lib/authority/bind-archetype-role.ts`
(+ test): one `$transaction` that upserts the binding and creates the
`AB-WORKROOM-<SHAPE>-<AGENT>` rows for every shape naming the role, never
re-granting a suspended row (the existing reconcile rule); person binding writes
no `AuthorityBinding`; revoke flips status and leaves authority rows for the
operator to suspend (a visible row, design §6).

RED first: ladder tests (bound → principal, source archetype; unbound → null +
role named), planner tests (delivery shape with `role:author` bound to `agent:X`
yields one binding per delivery shape naming author; standing shapes unchanged),
binding-write tests against a real Prisma client in the integration lane — the
enum/transaction behaviour is exactly what a mocked client cannot catch
(BI-D36E2916).

Verification: unit tests; `pnpm --filter db exec prisma migrate diff` clean; the
migration applies against the dev install's data state on `/ops/self-upgrade`.

Risk: the ladder's shape rung changes meaning for a `role:*` driver (from
"return the role" to "resolve or null"). `drive-resolution.ts:281-290` treats a
`role` kind as a human stage and pauses on `role_stage`; after this phase a
bound role reaches the `agent` branch and an unbound one reaches
`missing_explicit_coordinator` with the role named. Pin both with tests.

## Phase 3 — the room is born owned (`BI-36FC2981`)

Touched files: `apps/web/lib/work-capsules/governed-work-claim.ts` (claim),
`create_workroom` and `adopt_worktree` handlers in
`apps/web/lib/mcp/packs/work-capsules-pack.ts` (delegating to a shared
`apps/web/lib/work-management/born-owned.ts`, + test), reusing
`persistWorkroomParticipantAssignment` and the coordinator role write from
`appoint-room-coordinator.ts:105` rather than a second writer.

After the room row and its shape claim exist, resolve the ladder with the org's
bindings; when it yields a concrete principal, persist the explicit coordinator
participant with `enteredReason` naming the rung ("bound at setup for
role:author"). When it yields `null`, create the room unowned exactly as today.

Verification: pure planner tests; then one live claim on the dev install after
phase 2 deploys — the room's `processOverseer` reads `explicit`, conformance
carries no blocking deviation, and the first drive cycle advances. Record it on
`BI-71F441A4`.

## Phase 4 — setup binds the roles (`BI-0F44A284`)

Touched files: `setup-constants.ts` (`workforce-ownership` after
`business-context`; `STEP_ROUTES` → `/workforce/ownership`; label "Who Owns
What"); new route `apps/web/app/(shell)/workforce/ownership/page.tsx` +
`OwnershipStep.tsx` client component; server actions
`apps/web/lib/actions/ownership.ts` (`bindRole`, `leaveUnbound`, `revokeRole`)
over `bindArchetypeRole`; `setup-progress-service.server.ts` (the step completes
from evidence only when every derived role is bound or recorded as a named gap);
COO setup guidance prompt names the step; `setup-completion-seeds.ts` unchanged.

UX: the page lists roles, one row each, with the shapes that need it as the
reason. Picker offers employees created in this setup and coworkers whose
`Agent.role`/profession matches, coworker as the default. "Leave unbound" is an
explicit choice that writes a gap row. A coworker binding reads as a coworker.
Prototype in HTML first; commit a MEASURED `*.ux-fit.json` on the branch
BEFORE the gate runs (the gate reads the diff against `origin/main`). Tokens
only, no hardcoded colours.

Verification: `vitest run` on the projection and actions; `pnpm --filter web build`;
UX verification on the dev install through the real setup flow (this install is
past setup, so also verify the page outside setup — that is the pre-existing
install path, design §3.5).

## Phase 5 — assisted proposals with provenance (`BI-40751F49`)

Touched files: `roster-import.ts` (`ProposedEmployee.source`),
`roster-import-actions.ts` (`importRoster` persists provenance), new
`apps/web/lib/onboarding/public-source-roster.ts` (+ test: fixture leadership
page → candidates with title + `sourceUrl` + `retrievedAt`; no people → zero
candidates and a clear message), new `POST /api/onboarding/roster/public-source`
(admin-only, URL through `assertAllowedPublicUrl` and `assertSafeOutboundUrl`,
fetch via `fetchPublicWebsiteEvidence`, no credentials ever), `RosterImport.tsx`
(file input and URL input feed the same confirmation list).

Only name, the title that justified the proposal, and the source are kept
(design §3.4); nothing else from the page is stored. Nothing is created until
the installer confirms.

Verification: parser and guard tests (http, private IP and credentialed URLs
refused); live on the dev install: a confirmed proposal appears as an employee
carrying its source; an unconfirmed one leaves no record. Sensitivity: this
slice reads external pages — run the UX-fit and the security review on the
route.

## Phase 6 — readiness refuses (`BI-CB525EC6`)

Touched files: new `apps/web/lib/verify/ownership-readiness.ts` (+ test);
`apps/web/app/api/diagnostics/preflight/route.ts` (step 11 "Ownership");
`apps/web/app/(shell)/admin/diagnostics/page.tsx` (render gaps, link to
`/workforce/ownership`); `apps/web/lib/verify/preflight-service.ts` (attach an
`ownership` block; `computePreflightVerdict` untouched); `build-ops-pack.ts:316`
(the tool answers BLOCKED with the gaps when any exist); `scripts/dpf-verify-preflight.ts`
prints the same block.

`resolveOwnershipReadiness(orgId)` → `{ ready, gaps: [{ role, shapeKeys, reason }] }`
with `reason` = `unbound` or `ai-binding-missing-authority`. This is also the
reconciliation path for an install that predates the design: it enumerates the
gaps and binding them clears the stall without touching the rooms.

Verification: unit tests (unbound → gap; AI-bound without authority → gap;
person-bound → ready); live: before any binding the tool and the page name the
roles; after binding both report ready.

## Phase 7 — live acceptance and the 43 rooms (`BI-71F441A4`)

No code. On the dev install after phases 3, 4 and 6 deploy: run the ownership
page, bind the three roles (author to the standing delivery coworker, the two
reviewer roles to a person), confirm `verify_live_install_readiness` flips from
BLOCKED to CAN-TEST, run one drive cycle and confirm the previously stalled rooms
resolve an owner. Record delivery + acceptance evidence on `BI-4B5E3443`, close
`BI-71F441A4`.

## Completion gate for the whole plan

- Every AC in design §1.1 has a unit test or a live evidence record cited on the
  parent.
- `verify_live_install_readiness` on the dev install returns CAN-TEST with an
  empty `ownership.gaps`.
- A freshly claimed small item's Workroom reports one explicit Process Overseer
  and its first drive cycle advances (AC-ONB-FIRST-ROOM-EXECUTES).
- Zero rooms on the install refuse on `missing_explicit_coordinator` or
  `coordinator_authority_binding_ineligible` for want of a binding.

## Risks and rollback

- **Ladder semantics change** (phase 2): a `role:*` driver no longer surfaces
  as a role ref. Blast radius is every reader of `resolveRoomOwner` (two) and
  the drive plan's `role_stage` branch. Rollback is the phase-2 PR revert; the
  migration is additive and leaves an unused table.
- **Setup projection gains a blocking step** (phase 4): an install mid-setup on
  upgrade sees one more pending step. `createSetupProgress` seeds all steps, so
  older progress rows lack the key; treat a missing key as pending, and let
  `skipStep` record a named gap rather than a silent skip.
- **External fetch** (phase 5): bounded to https, allowlisted, no credentials,
  no storage beyond name/title/source. Revert is one PR.
- **Coordination bindings widen** to the full registry: only shapes with a
  bound AI role gain rows, seeded `active` under the existing never-re-grant
  rule; revoke is a status change on a visible row.

## Traceability

Four-way trace per deliverable, in the coverage record's own vocabulary:
requirement = design objective, contract = design section, flow = plan phase,
verification = design acceptance criterion.

| Deliverable | Requirement | Contract | Flow | Verification |
|---|---|---|---|---|
| role-inventory (`BI-1D6F5AE4`) | OBJ-ONB-ROLES-DERIVED | spec:3.1 | plan:phase-1 | AC-ONB-DERIVED-INVENTORY |
| role-bindings (`BI-8FDC274A`) | OBJ-ONB-BIND-AT-SETUP, OBJ-ONB-OWNER-FROM-DAY-ZERO | spec:3.2, spec:3.3 | plan:phase-2 | AC-ONB-FIRST-ROOM-EXECUTES |
| born-owned (`BI-36FC2981`) | OBJ-ONB-OWNER-FROM-DAY-ZERO | spec:3.2 | plan:phase-3 | AC-ONB-FIRST-ROOM-EXECUTES |
| setup-step (`BI-0F44A284`) | OBJ-ONB-BIND-AT-SETUP, OBJ-ONB-READY-REFUSES | spec:3.2, spec:4, spec:5 | plan:phase-4 | AC-ONB-SETUP-STEP, AC-ONB-UNBOUND-VISIBLE |
| assisted-proposals (`BI-40751F49`) | OBJ-ONB-IMPORT-ASSISTED | spec:3.4, spec:6 | plan:phase-5 | AC-ONB-SPREADSHEET, AC-ONB-PUBLIC-SOURCE |
| readiness-refuses (`BI-CB525EC6`) | OBJ-ONB-READY-REFUSES | spec:3.5 | plan:phase-6 | AC-ONB-READINESS-REFUSAL, AC-ONB-UNBOUND-VISIBLE |
| live-acceptance (`BI-71F441A4`) | OBJ-ONB-OWNER-FROM-DAY-ZERO | spec:7 | plan:phase-7 | AC-ONB-FIRST-ROOM-EXECUTES |

Evidence per acceptance criterion:

| AC | Phase | Evidence |
|---|---|---|
| AC-ONB-DERIVED-INVENTORY | 1 | `role-inventory.test.ts` synthetic-shape case |
| AC-ONB-SETUP-STEP | 4 | UX verification on the dev install; projection test |
| AC-ONB-SPREADSHEET | 5 | `importRoster` provenance test; live confirm |
| AC-ONB-PUBLIC-SOURCE | 5 | `public-source-roster.test.ts`; live confirm |
| AC-ONB-READINESS-REFUSAL | 6 | `ownership-readiness.test.ts`; live tool + page |
| AC-ONB-FIRST-ROOM-EXECUTES | 3, 7 | live claim + drive cycle recorded on BI-71F441A4 |
| AC-ONB-UNBOUND-VISIBLE | 4, 6 | diagnostics page links to the binding surface |

## Backlog coverage

Recorded with `record_plan_backlog_coverage`, decision `decomposed`, against the
plan blob at commit `3cd40ee68128` (receipt `cmtta2qii2g3d01o9exv6j6qj`,
2026-09-08). Scope baseline `baseline-6d81c867-035a-4b5b-bd64-fb4d49a8202e`
(spec-approval receipt `initiative-e0f86daa-eb92-4f39-b263-9d354e940f48`). The
receipt is re-recorded whenever this file changes; the live receipt id is on the
parent item.

| Deliverable key | Backlog item | Depends on |
|---|---|---|
| role-inventory | `BI-1D6F5AE4` | — |
| role-bindings | `BI-8FDC274A` | role-inventory |
| born-owned | `BI-36FC2981` | role-bindings |
| setup-step | `BI-0F44A284` | role-inventory, role-bindings |
| assisted-proposals | `BI-40751F49` | — |
| readiness-refuses | `BI-CB525EC6` | role-inventory, role-bindings |
| live-acceptance | `BI-71F441A4` | born-owned, setup-step, readiness-refuses |
