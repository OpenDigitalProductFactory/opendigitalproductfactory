---
status: active
---

# Pet Rescue operating system and Help recovery implementation plan

**Design:** [2026-08-25-pet-rescue-operating-system-and-help-recovery-design.md](../specs/2026-08-25-pet-rescue-operating-system-and-help-recovery-design.md)  
**Integration item:** `BI-7A38F667` · **Epic:** `EP-5102F494`  
**Workroom:** `WC-16B8E810` · **Branch:** `feat/pet-rescue-operating-system`  
**Packaging:** one governed Workroom, one source worktree, one shared nonproduction lease, one PR

## Outcome

Second Chance Animal Rescue opens DPF to an animal-welfare operating cockpit and can move one
durable animal record from intake through housing, care and placement without losing prior
custody, care, capacity, finance or adoption history. Help always resolves to a valid guide or a
truthful recovery page. Existing workroom-definition discoverability, Pet Rescue value-stream
alignment and public-site wording remain regression-tested baseline capabilities; this plan does
not fork them into a second builder surface.

## Delivery and test discipline

Every phase starts with a failing behavior test and ends at an operator-visible or contract-visible
seam. Schema changes are additive, organization-scoped and migration-tested from existing
`AdoptableAnimal` data. Each slice receives its own signed commit for review and clean rollback,
but all commits publish through one PR. No implementation claims completion from a mocked surface.

Approximately twenty percent of the implementation budget is reserved for reusable substrate:
the subject/location extension on `WorkEngagement`, a shared subject reference contract, bounded
source-state projections, and the canonical Help resolver. Rescue-specific routes consume those
contracts instead of embedding another workflow, scheduler, ledger or identity silo.

## Phase 1 — animal-welfare authority and shared subject references

**Maps to:** `BI-4F8A484C`, prerequisite for `BI-7111AF0C`, `BI-97290291`, `BI-5A25EC37`,
`BI-A442F129`

Files:

- `apps/web/lib/govern/permissions.ts` and permission tests
- occupation/capability narrowing registry and conformance tests
- `apps/web/lib/animal-welfare/subject-ref.ts` (new)

Steps:

1. Write failing tests for the dedicated animal-welfare read/operate capability, organization
   isolation, clinical and finance narrowing, and human approval of consequential transitions.
2. Add the smallest capability and the occupation-aware narrowing policy; do not borrow an
   unrelated operations or customer grant.
3. Extract a versioned `{ subjectKind, subjectRef, organizationId }` contract used by care, work,
   finance and workspace projections. Reject unknown versions and cross-organization references.

**Observable:** a permitted shelter operator can read the rescue workspace; an unpermitted or
cross-organization principal gets no animal existence or field disclosure.

## Phase 2 — durable animal identity, custody and migration

**Maps to:** `BI-4F8A484C`, `BI-7111AF0C`

Files:

- `packages/db/prisma/schema/verticals-storefront.prisma`
- additive migration under `packages/db/prisma/migrations/`
- `apps/web/lib/animal-welfare/animal-profile.ts` (new)
- `apps/web/lib/animal-welfare/custody.ts` (new)
- repository and migration tests

Steps:

1. Write failing state-machine tests for admission, legal hold, quarantine/care stages, outcome,
   return and re-admission. Prior episodes and events must survive every transition.
2. Add `AnimalProfile`, `AnimalCustodyEpisode`, `AnimalCustodyEvent` and the optional unique link
   from `AdoptableAnimal`. Add bounded list/timeline indexes and database invariants.
3. Backfill one profile per existing public listing using identity facts only. Prove idempotent and
   resumable migration; do not fabricate custody, health, housing or placement history.
4. Implement typed transactional commands and public projection serialization allowlists.

**Observable:** an existing public animal has one stable operational identity; a returned animal
opens a new custody episode while the completed placement and earlier episode remain visible.

## Phase 3 — capacity-aware intake and housing integration

**Maps to:** `BI-D2A51B36`, `BI-7111AF0C`

Files:

- existing `apps/web/lib/ward/` store/projection
- new animal-welfare intake command/read-model files
- `/workspace/rescue/intake` route and focused components/tests
- `/workspace/ward` integration tests

Steps:

1. Pin failing tests that intake and ward read the same `Resource` and
   `ResourceCapacityAllocation` facts, including blocked units, unknown capacity and concurrent
   occupancy conflict.
2. Add admit/stage/hold/outcome command handlers through the authority guard. Capacity override and
   legal-hold release require explicit human approval and reason.
3. Build a bounded intake exception queue and connect every row to animal detail and canonical ward.

**Observable:** intake cannot place two animals in one-capacity housing for the same interval, and
an operator sees unplaced, held and capacity-blocked animals by name rather than as a misleading
zero.

## Phase 4 — subject care, veterinary coordination and recurring rounds

**Maps to:** `BI-97290291`, `BI-5A25EC37`

Files:

- `packages/db/prisma/schema/verticals-care.prisma`
- `packages/db/prisma/schema/ai-coworker.prisma`
- additive migration and generated client
- `apps/web/lib/animal-welfare/care.ts` and `daily-care.ts` (new)
- `/workspace/rescue/care` and animal-detail care components/tests

Steps:

1. Write failing tests for corrected/superseded care facts, appointment subject linkage, recurring
   commitments, completion, missed/exception states and authorization/redaction.
2. Add generic `CareRecord`; use the existing `CareAppointment` subject seam rather than a human
   `PatientProfile` or animal JSON blob.
3. Refactor `WorkEngagement` with optional subject and location references. Reuse recurrence and
   activity history; add no rescue scheduler.
4. Build today's rounds, medication/welfare exceptions and appointment views with keyboard-safe
   completion and correction flows.

**Observable:** the operator can see what each animal needs today, complete an allowed round,
correct a fact without erasing history, and escalate a missed or exceptional commitment.

## Phase 5 — adoption, placement and return continuity

**Maps to:** `BI-A442F129`

Files:

- animal-welfare Prisma models/migration for application and placement
- `apps/web/lib/animal-welfare/adoption.ts` (new)
- existing storefront inquiry and adoption-waiting-list adapters
- `/workspace/rescue/adoptions` and animal-detail placement components/tests

Steps:

1. Write failing transaction tests for inquiry-to-application, screening, visit, approval,
   reservation, placement, cancellation and return.
2. Add organization-scoped application and placement records linked to canonical contacts,
   `StorefrontInquiry` provenance and `AnimalProfile`.
3. Enforce that active placement needs an approved application, closes public availability, and
   cannot bypass a legal hold. A return closes the placement and opens a new custody episode.
4. Render a bounded adoption queue with PII-minimized list projection and permissioned detail.

**Observable:** the full inquiry-to-placement trace is navigable, and return history is preserved.

## Phase 6 — restricted stewardship and animal-cost attribution

**Maps to:** `BI-E861E8B8`

Files:

- `packages/db/prisma/schema/finance.prisma`
- `packages/db/prisma/schema/verticals-storefront.prisma`
- additive migration and finance posting/report tests
- `apps/web/lib/finance/pet-rescue-finance.ts`
- `/workspace/rescue/stewardship` composition/tests

Steps:

1. Write failing tests for unrestricted/temporary/permanent restriction, donation-to-fund linkage,
   posted subject cost, currency scoping and finance-field denial.
2. Add a generic fund record and optional fund/subject dimensions on canonical journal lines. Do
   not reuse municipal `FundBudgetLine` or add a rescue ledger.
3. Extend posting and reporting through finance-owned services; reject unposted or cross-currency
   amounts from stewardship totals.
4. Render restricted balance, donation and bounded cost-per-animal readouts with finance capability
   checks and `asOf`.

**Observable:** a posted expense and restricted donation reconcile through the existing general
ledger while animal-welfare-only users cannot read finance detail.

## Phase 7 — Pet Rescue workspace and durable drill-ins

**Maps to:** `BI-7A38F667`

Files:

- `apps/web/lib/workspace-home/profiles.ts`
- `apps/web/lib/workspace-home/registry.ts`
- new bounded rescue cockpit loader/projection
- `apps/web/components/workspace-home/` Pet Rescue composition/tests
- durable `/workspace/rescue/*` routes and UX-budget manifests

Steps:

1. Write failing leaf-before-category profile tests and source-state aggregation tests. An
   unavailable source must not become zero.
2. Add Pet Rescue navigation for Animals, Intake, Care, Adoptions, Capacity and Stewardship without
   builder terminology in Simple mode.
3. Compose the first viewport from bounded per-source projections with `available`, `empty` or
   `unavailable`, `asOf`, cursor limits and a drill-in for every signal.
4. Use report-kit primitives, shared status intent and tokens; verify keyboard order, 44px targets,
   narrow/wide and light/dark layouts.

**Observable:** the opening page answers “which animal or care commitment needs attention now?”
and every answer opens the exact queue behind it.

## Phase 8 — resilient contextual Help

**Maps to:** `BI-AE7C386B`

Files:

- `apps/web/lib/docs-route-map.ts`
- `apps/web/lib/docs-route-map.server.ts`
- `apps/web/components/docs/ContextualDocsButton.tsx`
- `apps/web/app/(shell)/docs/[[...slug]]/page.tsx`
- resolver, component and direct-route tests

Steps:

1. Write failing tests for exact key, alias, nearest area index, global index, empty package,
   unknown direct URL, safe source-route encoding and permission boundaries.
2. Refactor route entries to stable doc keys and implement one server resolver returning
   `{ href, requestedKey, resolvedKey, recoveryKind }`.
3. Make Header Help consume only resolved destinations. Render recovery context and search on a
   valid docs page; do not call the shell's record `notFound()` for missing content.

**Observable:** the original upper-left Help path and an unknown/renamed doc URL both land on valid,
contextual documentation with a clear recovery notice, never the record-not-found card.

## Phase 9 — regression alignment, evidence and one-PR publication

**Maps to:** all covered BIs; follow-up `BI-D664DE6F` remains intentionally outside release scope.

Steps:

1. Regression-test the already-delivered architecture/workroom definition perspective, portfolio
   grouping, Pet Rescue three-stream architecture and nonprofit public-site copy separation. Do not
   duplicate those surfaces.
2. Run Prisma format/generate/validate, migration-from-existing-data tests, affected Vitest suites,
   lint/typecheck and query-plan checks for bounded list/timeline/cockpit reads.
3. Run UX-fit and blast-radius reviews, refresh from `origin/main`, then run the repository's local
   merged-code CI gate exactly once before push/PR.
4. Claim the single shared nonproduction lease only after the integrated tree is stable. Exercise
   Help, intake, housing, care, adoption, return, stewardship, partial-source behavior and the
   online-only lost-connectivity contract. Capture narrow/wide and light/dark evidence.
5. Record objective evidence, obtain independent semantic review, verify DCO, open one PR and keep
   it attended until all required checks are green.

## Backlog coverage

| Deliverable | Item | Depends on | Verification seam |
|---|---|---|---|
| Operational animal identity | `BI-4F8A484C` | Phase 1 | migration, serializer and detail tests |
| Housing/capacity integration | `BI-D2A51B36` | Phase 2 | ward/intake integration tests |
| Veterinary and clinical history | `BI-97290291` | Phases 1–2 | care-record/appointment tests |
| Custody and intake | `BI-7111AF0C` | Phases 1–3 | state-machine and legal-hold tests |
| Recurring daily care | `BI-5A25EC37` | Phases 1–4 | recurrence/completion/exception tests |
| Adoption and return | `BI-A442F129` | Phases 1–3 | application/placement transaction tests |
| Restricted funds and animal cost | `BI-E861E8B8` | Phase 2 | finance posting/reconciliation tests |
| Resilient Help | `BI-AE7C386B` | independent | resolver and running-route tests |
| Integrated rescue cockpit | `BI-7A38F667` | Phases 1–8 | partial-result UI and live walkthrough |
| Offline rounds capture | `BI-D664DE6F` | `BI-5A25EC37`, `BI-4F8A484C` | deferred successor; not in this PR |

The coverage decision is `decomposed`: the existing child items remain independently traceable and
revertible, while the operator-directed publication boundary is one PR. The plan-coverage receipt
must map every baseline objective to at least one row above before implementation starts.

## Rollback and release boundary

- Database expansion is additive; application rollback retains unused tables and nullable links.
- Public listing remains readable during backfill and never exposes internal fields.
- Each domain slice is a signed, clean-revert commit; the PR is merged only as an integrated unit.
- The first release is online-only. No browser persistence or optimistic offline completion is
  allowed. Offline capture and conflict-safe replay are tracked by `BI-D664DE6F`.
- A failed shared-runtime walkthrough releases the lease and stops publication; it does not trigger
  a second sandbox or an installed-runtime patch.
