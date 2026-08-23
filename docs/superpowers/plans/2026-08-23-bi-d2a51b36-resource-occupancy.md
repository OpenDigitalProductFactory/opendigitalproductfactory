# BI-D2A51B36 — Canonical animal housing occupancy

| Field | Value |
| --- | --- |
| Backlog item | `BI-D2A51B36` |
| Epic | `EP-5102F494` |
| Workroom | `WC-B0DD2B2F` |
| Branch | `feat/bi-d2a51b36-resource-occupancy` |
| Status | Design complete; implementation planned |
| Governing decision | `DI-C955877F245D` — `canonical-resource-occupancy`, high confidence, autonomy eligible |

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Second Chance Animal Rescue can answer two questions from its existing Animals management route:

1. Where is each animal now, including a kennel, ward, or foster home?
2. How much safe housing capacity is available before another intake is accepted?

Kennels and foster homes remain one capacity system. Moves preserve history. A blocked or full unit cannot receive another animal. The solution extends canonical `Resource`; it does not clone the hospitality resource stack or introduce an animal-only scheduling substrate.

## Scope and acceptance

- Configure both `kennel` and `foster-home` resource kinds for the pet-rescue and animal-shelter activation profiles, with `capacityUnit: "animals"`.
- Widen canonical `ResourceDomain` for animal-welfare resources.
- Add a subject-polymorphic, append-preserving `ResourceOccupancy` ledger beside `Resource`.
- Enforce one current occupancy per `(organization, subjectKindSlug, subjectRef)`, positive quantity, chronological history, organization identity, resource lifecycle, blocked-state, and capacity invariants.
- Provide generic canonical Resource create/update commands and use the shared repository from both hospitality mirroring and animal-welfare management. Do not add an `animal-resources` route.
- Project current location and movement history for each `AdoptableAnimal` from `subjectKindSlug="animal"` plus stable `animalRef`.
- Show free capacity by housing kind and accepted animal size, blocked units with reasons, animals without housing, and a direct move/release action on `/storefront/animals`.
- Keep housing management inside the existing internal Storefront > Animals route. Do not add global or section navigation.
- Preserve current care and hospitality behavior.

Out of scope: intake/legal holds (`BI-7111AF0C`), daily-care rounds (`BI-5A25EC37`), foster-person CRM, adoption workflow, veterinary workflow, supplies, funding, events, and Workspace tiles.

## Research and benchmarking

The design uses open-source reference implementations as evidence, not as code dependencies.

- [Animal Shelter Manager](https://github.com/sheltermanager/asm3) is the mature reference. Its [current manual](https://sheltermanager.com/repo/asm3_help.pdf) treats adoption, transfer, and foster as movements with return dates and a current location. Adopt: location as a time-ordered movement history. Reject: its domain-specific monolith; DPF keeps occupancy subject-polymorphic.
- [RefuPet / Hackapet](https://github.com/hackapet-project/petsync_web_V2) keeps shelter operations and animal records in one mobile-capable system. Adopt: one operator surface for the animal and its operational state. Reject: a separate application or route family for housing.
- [Open Animal Rescue](https://github.com/leethobbit/OAR) is a self-hostable rescue manager for small shelters. Adopt: small-rescue operability and local control. Reject: copying a rescue-specific data model when canonical DPF resources already exist.
- [albdangarcia/animal-shelter](https://github.com/albdangarcia/animal-shelter) preserves animal lifecycle history and uses atomic transactions for multi-record state changes. Adopt: a move closes the prior placement and opens the next in one transaction. Reject: letting a UI-only status update stand in for the history ledger.

No external runtime package is added.

## Design grounding

### Existing specifications and plans reviewed

- `goal-objective.md` for `EP-5102F494`, including the dependency order and subject-agnostic constraint.
- `BI-D2A51B36` in full.
- `docs/platform-usability-standards.md`.
- `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md`.
- `apps/web/components/ui/report-kit/README.md`.
- The merged `BI-2C80E6EA` plan and substrate at `origin/main`.

### Code substrate reviewed

- `packages/db/prisma/schema/resource-scheduling.prisma`: canonical `Resource`, availability, capacity pools, and booking allocations.
- `packages/db/prisma/schema/verticals-storefront.prisma`: `AdoptableAnimal` and its stable `animalRef`.
- `apps/web/lib/resource-scheduling/admin-resource-profile.ts`: activation-profile resource validation.
- `apps/web/app/api/storefront/admin/hospitality-resources/**`: legacy hospitality bridge and table-specific attributes.
- `apps/web/app/(shell)/storefront/animals/page.tsx` and `AnimalsManager.tsx`: the existing canonical internal Animals route.
- `packages/storefront-templates/src/archetypes/nonprofit-community.ts`: animal-welfare process profile.

### Source of truth

- Housing unit identity, capacity, availability, and block reason: `Resource`.
- Current and historical placement: `ResourceOccupancy`.
- Animal identity and size: `AdoptableAnimal` keyed through stable `animalRef`.
- Allowed housing kinds and capacity ceilings: archetype `processProfile.resourceKinds`.
- Capacity readout: a pure projection over active resources, current occupancies, and animal size.

### Architecture decision

`DI-C955877F245D` compared three options:

1. Add canonical subject-polymorphic `ResourceOccupancy`.
2. Widen the booking-oriented `ResourceCapacityAllocation` into open-ended residence.
3. Add animal-only `AnimalHousingPlacement`.

The kernel selected option 1 with composite `12.153`, margin `6.040`, high confidence, no commandment conflict, and autonomy eligibility. It preserves booking allocation semantics and avoids the next vertical cloning housing placement again.

## Data design

`ResourceOccupancy` carries:

- organization-scoped resource relation;
- open subject identity (`subjectKindSlug`, `subjectRef`);
- positive `quantity`;
- `startedAt`, nullable `endedAt`, and optional transition reason;
- idempotency key and version/audit timestamps.

Database constraints and indexes:

- one active row per organization + subject identity via a partial unique index;
- positive quantity;
- `endedAt >= startedAt` when closed;
- FK-leading indexes for current-resource capacity reads and subject history;
- composite FK to `Resource(id, organizationId)` and FK to `Organization`.

Application transaction:

1. Resolve the subject and destination under the same organization/storefront.
2. Read the destination Resource and current occupancy under serializable isolation.
3. Reject retired, blocked, wrong-domain, wrong-kind, size-incompatible, or full resources.
4. Close the prior occupancy and open the destination occupancy atomically; a null destination releases the subject.
5. Retry only PostgreSQL serialization conflicts within a small bounded retry count.

No backfill is possible or required because no existing animal location field exists. Rollback is forward-only: stop new commands and ship a compensating migration/code change; do not drop occupancy history after production use.

## UX fit review — animal housing operations

- Decision: `fits-with-guardrails`
- Owning area: Storefront
- Route family: canonical internal `/storefront/animals`; no new page route
- Primary persona: shelter coordinator deciding where an animal is housed and whether safe intake capacity remains
- Navigation layer touched: contextual actions only
- Reuse/convergence: existing Animals manager, shared form primitives, report-kit `StatCard`, `StatusBadge`, `EmptyState`, and progressive disclosure; no new dashboard/card dialect
- Source truth: `Resource`, `ResourceOccupancy`, `AdoptableAnimal`, and the archetype process profile
- Empty/failure behavior: explain that housing units must be added before assignment; distinguish no units, all units blocked/full, no matching size, failed save, and permission failure
- AI boundary: no prompt send
- Required plan/spec edits:
  - Make free capacity and animals without housing visible before catalog/photo editing.
  - Keep housing-unit setup behind a contextual disclosure while the move action stays reachable.
  - Use stable field labels, visible pending/success/error state, 44px targets, and token-only styling.
- Evidence before merge:
  - schema/migration invariants and concurrency tests;
  - route tests for auth, configuration, blocked/full/size mismatch, move, release, and history;
  - component tests for honest empty/error states and reachable primary actions;
  - measured `/storefront/animals` UX budget manifest;
  - governed browser exercise at desktop and narrow viewport with seeded kennel, foster, blocked, full, and unassigned cases.
- Captured in: this plan and `docs/ux-fit/2026-08-23-animal-housing-operations.ux-fit.json`

## Delivery phases

### Phase 1 — Red: schema and invariant tests

Deliverable: failing tests describe the canonical enum/model, partial uniqueness, constraints, relations, indexes, and activation-profile housing kinds.

Paths:

- `packages/db/src/resource-occupancy-model.test.ts`
- `packages/storefront-templates/src/archetypes/archetypes.test.ts`

Verification: affected DB and storefront-template Vitest targets fail for the missing model/profile behavior before production edits.

### Phase 2 — Green: forward-only occupancy substrate

Deliverable: Prisma schema plus migration for `ResourceOccupancy` and `animal_welfare`, with no data rewrite.

Paths:

- `packages/db/prisma/schema/resource-scheduling.prisma`
- `packages/db/prisma/schema/core-identity.prisma`
- `packages/db/prisma/migrations/20260823012000_resource_occupancy/migration.sql`
- `packages/storefront-templates/src/archetypes/nonprofit-community.ts`

Verification: Prisma format/generate/validate, migration safety and timestamp collision checks, clean-schema replay, upgrade replay from current main, physical index/FK/constraint assertions, and phase-one tests green.

### Phase 3 — Red/green: shared repositories and generic routes

Deliverable: one canonical admin-resource repository and one occupancy command service, consumed by generic Resource routes and the hospitality mirror path.

Paths:

- `apps/web/lib/resource-scheduling/admin-resource-repository*`
- `apps/web/lib/resource-scheduling/resource-occupancy*`
- `apps/web/app/api/storefront/admin/resources/**`
- `apps/web/app/api/storefront/admin/resource-occupancies/route*`
- `apps/web/app/api/storefront/admin/hospitality-resources/**`

Verification: affected repository and route tests cover validation, auth, domain/profile resolution, optimistic concurrency, full/blocked/retired resources, size compatibility, moves, release, history, and serialization retry.

### Phase 4 — Red/green: housing read model and Animals UX

Deliverable: a pure capacity/location projection and a refactored `/storefront/animals` operator surface.

Paths:

- `apps/web/lib/animal-welfare/housing*`
- `apps/web/app/(shell)/storefront/animals/page.tsx`
- `apps/web/components/storefront-admin/AnimalsManager*`
- `apps/web/app/api/storefront/admin/animals/[id]/route.ts`

Verification: capacity summary tests cover type, size, blocked, full, and unassigned states; component tests prove clear next actions and settled mutation feedback; existing animal catalog/media behavior remains.

### Phase 5 — Generated artifacts, governed UX, and completion gate

Deliverable: all generated companions, UX measurement, documentation impact, and exact-tree evidence are current.

Verification:

- regenerate route manifest, route audience, route shells, route purpose, doc index, and architecture counts after the concurrent generated-file lease is released;
- run affected Vitest suites, typechecks, Prisma checks, migration guards, schema guards, prose guard, style-drift guard, doc anchors, and `pnpm run pregate:preflight`;
- acquire the governed nonproduction environment and measure `/storefront/animals` at desktop and narrow viewport;
- commit the measured UX-fit manifest with exact UI-impacting file scope;
- obtain independent semantic review of the stable commit;
- run exact-tree local integration CI, push, open a ready PR, enable squash auto-merge, run `pnpm pr:health`, and verify the merged commit has one parent.

## Backlog coverage

Decision: `atomic`.

The schema, command transaction, capacity projection, and operator workflow are one safety invariant. Shipping any subset independently would either create unused substrate or expose a placement UI without enforced capacity/history. The goal also requires one PR per epic item. All work maps to `BI-D2A51B36`; no independent delivery boundary is left only in this document.

Coverage receipt: blocked. `record_plan_backlog_coverage` resolved the immutable
provider blob at commit `835a30eddf5376702d234eada11ab3240afe7e96`, then returned
`traceability-incomplete` because `BI-D2A51B36` has no
`initiative_scope_baseline`. The server states that the baseline is not reachable
from an MCP session. Its suggested `BI-B9403248` anchor is not live; the verified
live remediation item is `BI-0996913C` ("Make plan-coverage baseline remediation
reachable and live-anchor safe"). This plan's atomic mapping remains the durable
fallback record; it is not represented as a successful coverage receipt.

## Risk and rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| Concurrent moves overfill a unit | serializable transaction, partial uniqueness, capacity recheck, bounded conflict retry | disable mutation route; ship compensating command fix without deleting history |
| Generic occupancy becomes an untyped polymorphic orphan | closed subject-kind validation at the route/repository boundary and stable semantic refs | reject unsupported kinds; preserve ledger rows for audit |
| Hospitality behavior regresses during refactor | keep legacy clone compatibility and existing route tests; shared repository changes canonical write/read only | revert adapter consumption while retaining additive schema |
| New route/UI drifts from portal UX | no new page/nav, existing primitives, measured UX budget, desktop+narrow browser test | remove contextual controls while retaining substrate behind APIs |
| Migration collides with concurrent main | timestamp-collision check immediately before commit and rebase/update from origin/main | rebump migration directory through `git mv` before publication |
| Generated route files overlap WordPress work | wait for `WC-38FD13D8` terminal release, refresh from merged main, regenerate once | do not co-claim or hand-merge generated JSON |

## Documentation and gate decisions

- Documentation impact: this plan plus generated architecture counts and route/doc indexes. No user guide update until the workflow is proven in the governed preview.
- Data impact: additive enum value and table; no backfill; no destructive DDL; rollback by forward compensating migration.
- Seed contribution fit: adds the already-required foster-home resource kind to the animal-welfare process profile; it does not add demo records or pet-rescue-only platform behavior outside that profile.
- Refactoring budget: shared canonical resource/occupancy repositories and replacement of hand-rolled Animals form/status patterns are the deliberate ~20% convergence work.
