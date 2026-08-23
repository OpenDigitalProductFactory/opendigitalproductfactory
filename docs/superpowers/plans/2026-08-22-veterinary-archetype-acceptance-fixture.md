---
status: draft
---

# Veterinary Archetype Acceptance Fixture — Governed Implementation Plan

**Date:** 2026-08-22
**Status:** Plan authored; live backlog decomposed. Coverage receipt and independent
review remain required before implementation.
**Epic:** `EP-55AF36AC`
**Umbrella backlog item:** `BI-79449954` (`xlarge`, decomposed)
**Canonical design:**
`docs/superpowers/specs/2026-08-08-veterinary-clinic-operating-system-design.md`
**Architecture decision:** `DI-BFA0999EA4C1` — extend `DemoBusiness` with one
validated acceptance-scenario overlay and thin runner adapters
**Repository-bound design Workroom:** `WC-A31DBE53`
**Plan path:**
`docs/superpowers/plans/2026-08-22-veterinary-archetype-acceptance-fixture.md`

> **For agentic workers:** execute this plan one independently reviewable backlog item
> at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
> `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success
> claim, and `dpf-pr-with-dco` for handoff.

## 1. Outcome

DPF will have one deterministic, declarative archetype acceptance scenario that can be
projected into five existing verification surfaces:

1. the Demo Business generator and reversible load path;
2. the in-process Business Activity Simulator;
3. the live HTTP archetype exercise harness;
4. role/job/first-viewport UX verification; and
5. the archetype audit and evidence report.

Oak & Prairie Veterinary Clinic is the first deep fixture. Dr. Julia Ramirez is the
owner/operator, medical director, treating veterinarian, and accountable operator. The
fixture is not a second veterinary product model and does not fabricate product
capabilities that have not landed. It exposes missing capabilities as expected gaps with
evidence and live backlog links until the owning product BI makes those steps executable.

The contract must remain reusable: subsequent archetype tests add behavior to the same
contract instead of creating another fixture file, runner, identity, or manual audit
script.

### Objective and acceptance scope

This plan implements the fixture and verification portions of the canonical design's
`OBJ-VET-001` through `OBJ-VET-006` baseline. Its controlling acceptance references are
`AC-VET-001` through `AC-VET-008`. Expected-gap reporting may satisfy the fixture's
honesty requirement, but it never satisfies the missing product capability's acceptance
criterion.

## 2. Definition of the gap

The canonical veterinary design already defines Oak & Prairie, Julia, named staff,
clients, animals, facilities, operating scale, and golden journeys. Its clinical and
Illinois legal/compliance reviews remain pending. The platform does not yet have an
executable plan connecting that scenario to its test substrates.

Three conflicting fixture authorities are visible today:

- the veterinary design owns **Oak & Prairie / Dr. Julia Ramirez**;
- `packages/storefront-templates/src/demo-flavor.ts` owns **Meadowbrook Veterinary
  Clinic / Dr. Iris Lund**; and
- `docs/testing/archetype-audit-plan.md` contains an older companion-clinic scenario
  with different actors and assumptions.

At the same time, the simulator reads `apps/web/lib/business-activity-sim/archetype-flows.ts`
while the live harness reads `scripts/harness/scenarios/*.mjs`. The exercise playbook
already records the intended convergence, but the P4 Demo Factory work did not deliver
it. Without this plan, every new archetype exercise pays setup cost again and can test a
different business than the demo, simulator, or audit.

## 3. Non-negotiable architecture

### 3.1 One authority, several projections

```text
ArchetypeDefinition + seed + scenario-owned DemoFlavor
                         |
                         v
                 deriveDemoBusiness()
                         |
                    DemoBusiness  <---- existing canonical derived business
                         |
        AcceptanceScenarioOverlay <---- jobs, subjects, events and oracles only
                         |
                         v
             CompiledAcceptanceScenario
                /       |       |       \
       demo/load   simulator   harness   audit/UX
```

`DemoBusiness` remains the canonical derived business. The scenario definition may own
a `DemoFlavor`, but the flavor registry must re-export that object rather than copy it.
The overlay references the derived business and may not restate `companyName`, owner,
currency, timezone, or team members. A validator fails any duplicate identity field.

No new runner is introduced. Each existing surface receives a thin adapter from the
compiled scenario. Runner-specific execution state stays with its runner; archetype
meaning stays in the scenario definition.

### 3.2 Existing authority to extend

| Concern | Existing authority | Plan rule |
|---|---|---|
| Archetype definition and activation | `packages/storefront-templates/src/archetypes/*`, activation profile and process profile | Reference; never copy labels or capabilities into the fixture. |
| Derived business | `packages/storefront-templates/src/demo-business.ts` | Preserve as canonical business projection. |
| Named business flavor | `packages/storefront-templates/src/demo-flavor.ts` | Scenario-owned flavor is re-exported here; remove Meadowbrook/Iris after parity. |
| Reversible load plan | `packages/storefront-templates/src/demo-business-load.ts` and `apps/web/lib/demo/load-demo-business.ts` | Extend with adapter-owned, source-tagged rows; preserve safe load/unload guards. |
| Operational shapes | `packages/storefront-templates/src/twin-profile.ts` | Use the 13 canonical `TwinTemplate` shapes; do not invent a veterinary twin type. |
| Simulation | `apps/web/lib/business-activity-sim/*` | Compile scenario jobs/events into existing flow/oracle contracts. |
| Live exercise | `scripts/harness/archetype-exercise.mjs` | Extend the runner; scenario modules become compiled projections. |
| UX sweep | `apps/web/scripts/ux-sweep-fixture.ts` and `ux-route-sweep*` | Reuse browser/runtime capture and measurement; add scenario oracles, not another browser harness. |
| Work findings | live `Epic`, `BacklogItem`, and Workroom records | A failing step creates or links a BI before any destructive reset. |
| Runtime truth | canonical install or governed shared nonproduction lease | A worktree-local portal is not acceptance evidence. |

### 3.3 Proposed contract shape

The exact names may change during TDD if current type boundaries require it, but the
ownership and fields below are requirements:

```ts
type AcceptanceEvidenceClass =
  | "fixture-assumption"
  | "researched-fact"
  | "reviewer-gated-regulated-claim";

interface ArchetypeAcceptanceScenarioDefinition {
  schemaVersion: 1;
  scenarioId: string;
  archetypeId: string;
  seed: string;
  demoFlavor?: DemoFlavor;
  clock: { startsAt: string; timezone: string };
  requires: { required: string[]; optional: string[] };
  actors: ScenarioActor[];
  subjects: ScenarioSubject[];
  resources: ScenarioResourceRef[];
  inventory: ScenarioInventorySeed[];
  policies: ScenarioPolicyEvidence[];
  integrations: ScenarioIntegrationStub[];
  jobs: ScenarioJob[];
  events: ScenarioEvent[];
  expectedOutcomes: ScenarioOutcome[];
  uxOracles: ScenarioUxOracle[];
  cleanup: ScenarioCleanupContract;
  coverage: ScenarioCoverageClassification;
}

interface CompiledAcceptanceScenario {
  definition: ArchetypeAcceptanceScenarioDefinition;
  business: DemoBusiness;
  capabilities: ScenarioCapabilityResolution;
  stableRefs: ScenarioReferenceIndex;
}
```

Contract invariants:

- no `Date.now`, `Math.random`, ambient locale, or implicit timezone;
- every actor, subject, resource, inventory item, job step, event, and expected outcome
  has a stable scenario-local reference;
- every reference resolves and every demanded capability is classified as available,
  expected gap, external stub, or reviewer-gated;
- a job may not claim success when it stopped at an expected gap;
- regulated claims carry evidence class, source/effective date, jurisdiction,
  reviewer gate, and fixture-only disclaimer;
- cleanup enumerates every source tag/table/API touched and proves non-demo rows remain;
- the compiler produces the same digest and projections for the same definition, seed,
  and source revision.

## 4. Lessons carried forward from live testing

The Pet Rescue fresh-install exercise is not merely background. Each durable finding
changes the fixture contract or execution process below.

| Live evidence | Lesson | Required plan response |
|---|---|---|
| `BI-2C80E6EA` and merged PR #4494 | Vertical labels over a fixed commercial process are not an operating model. Subjects and resources must be canonical and vertical-neutral. | Scenario subjects reference canonical principals/profiles; housing and appointment resources reference canonical `Resource` and subject-agnostic scheduling. No veterinary-only appointment clone. |
| `BI-D2A51B36` | Housing/placement occupancy is a first-class operation. | Scenario contract includes resource occupancy windows, capacity, conflicts, release, and recovery. Oak & Prairie uses short-stay kennels and clinical rooms. |
| `BI-5E74E48C` | A catalog without physical supplies cannot exercise daily operations. | Inventory seeds distinguish physical stock, lot/expiry, temperature, recall, quarantine, reorder, waste, and retail from digital inventory. Missing authorities remain expected gaps. |
| `BI-5A25EC37` | Daily scheduled care cannot be inferred from a storefront order. | Jobs/events model feeding, medication, treatment, monitoring, and welfare/clinical rounds with qualification and completion evidence. |
| `BI-7111AF0C` | Lifecycle must start at intake and track procedures, not jump to an available/end state. | Jobs declare lifecycle transitions and expected history; validators reject unexplained state jumps. |
| `BI-97290291` | Veterinary coordination is its own accountable work, not a contact note. | Oak & Prairie includes referral/lab/records-transfer coordination and cost/provenance links, using stubs until product contracts land. |
| `BI-7A38F667` | A generic commercial Workspace can be technically functional yet irrelevant. | Every scenario declares role-specific first-viewport oracles and drill-through destinations. Julia sees care/safety exceptions before commercial metrics. |
| `BI-D49C7245` and `BI-5220C674` | Vocabulary and decision stances must derive from archetype/operating model. | Fixture assertions cover navigation/setup language, stakeholder nouns, policy defaults, and WWWD starters as well as domain data. |
| `BI-7E3F4D4F` and `BI-E861E8B8` | Some archetypes depend on events and non-sale funding. | The shared contract supports events and multiple funding/demand shapes even though Oak & Prairie's MVP uses commercial care revenue. These remain Pet Rescue regression cases. |
| `BI-A442F129` | A public CTA is not proof of the operational lifecycle behind it. | Job validation begins at the public action and continues through qualification, internal work, decision, communication, and terminal/recovery state. |
| `BI-7E7D8412` and `BI-06873BE6` | A fresh install can report ready while its only provider/background path is unusable. | Live runs start with deterministic install/provider/inference/background-job preflight and stop with a platform finding instead of misclassifying downstream jobs. |
| `BI-DB71E580` | Indefinite loading is a failure state, and structural DOM checks can create false positives. | UX oracles inspect rendered state, impose bounded waits, require actionable error/retry states, and re-test after dependency recovery. |
| `BI-86EAD856` | A managed sandbox can omit repository-relative dependencies even when the image contains them. | Preflight proves fixture/config/version closure before execution; missing closure is a platform BI, not a veterinary failure. |
| `EP-129D11FD` | Agents can otherwise declare planning or initiatives complete without durable gates. | Every run and implementation phase is anchored to a live BI/Workroom, immutable plan coverage, evidence, and terminal-state policy. |

### 4.1 Testing-process changes

Every archetype exercise follows this order:

1. capture or verify the live backlog bundle before any reset;
2. preflight canonical runtime identity, required commit, installation purpose,
   provider/inference readiness, background work, and test personas;
3. load the scenario idempotently and reconcile its digest;
4. record the pre-DPF baseline for each job;
5. execute jobs through real seeded roles and authority boundaries;
6. capture first viewport, job outcome, runtime/log/evidence, and UX states;
7. link each novel finding to a live BI before teardown;
8. unload, prove non-fixture rows were preserved, reload, and replay; and
9. retain a compact run manifest so another archetype can reuse the setup.

## 5. Oak & Prairie fixture

### 5.1 Practice and roles

The scenario definition imports the canonical facts from design §12:

- Cedar Glen, Illinois; one independent companion-animal general practice;
- Julia as owner/operator, medical director, treating DVM, DEA registrant, controlled
  reconciliation reviewer, novel-spend approver, and escalation owner;
- two associate DVMs, practice manager, four credentialed technicians, three
  assistants, three CSRs, and one kennel/clinic assistant;
- four exam rooms, surgery/dental suite, treatment area, in-house lab, radiography,
  pharmacy/controlled safe, retail wall, and six short-stay kennels;
- explicit opening hours, protected same-day urgent capacity, procedure mornings, and
  after-hours referral behavior; and
- resettable representative scale metadata without materializing 4,200 full records
  when a smaller referentially complete sample proves the same behavior.

The scale contract distinguishes:

- `declaredScale`: the fictitious operating context used for capacity and KPI
  denominators; and
- `materializedSample`: the minimum named and generated rows needed for executable
  journeys.

This prevents tests from fabricating thousands of rows merely to make a scenario look
real while still catching code that incorrectly derives business scale from sample row
count.

### 5.2 Named journey packs

| Pack | Named actors | Minimum proof |
|---|---|---|
| Preventive and recall | Dana Brooks and Max (dog) | Booking, guardian link, intake, encounter boundary, lot/expiry capture, certificate, wellness entitlement, invoice/payment, released discharge, and next recall. |
| Same-day urgent | Robert Chen and Luna (cat) | CSR safety routing, protected capacity, arrival, assessment handoff, diagnostics, estimate/consent, treatment, result/discharge release, payment, and insurance assistance. Clinical content is stubbed/reviewer-gated. |
| Species boundary | Amina Yusuf and Clover (rabbit) | Species-aware booking/resource choice and a medication-safety escalation that prevents unsupported automation. |
| Dental/procedure | Theo Morgan and Scout (dog) | Estimate/consent, procedure episode, anesthesia/treatment tasks, controlled administration, witnessed partial-vial waste, lot relief, charge candidate, sign-off, recovery, and discharge. |
| Compassionate end of life | Erin Patel and Nori (cat) | Identity/authority, explicit euthanasia and remains-choice consent, qualified approvals, medication/waste evidence, compassionate communication, and immutable record state. |
| Inventory/safety exceptions | Julia, manager, senior technician | Expiring vaccine, recalled food, failed refrigerator check, supplier backorder, and controlled discrepancy each produce containment plus accountable next action without silent stock mutation. |
| Operating exceptions | Julia and affected staff/clients | No-show waitlist fill, staff call-out/capacity rebalance, close reconciliation, pharmacy margin alert, online food order, records transfer, and APHIS timeline. |

Each pack includes success, permission-denied, qualification-denied, stale, duplicate,
out-of-order, timeout/offline, correction, and recovery cases where applicable.

### 5.3 Julia's first-viewport contract

Julia's initial Workspace view must answer, in this order:

1. What threatens animal/client safety or controlled/compliance integrity now?
2. Where is today's flow blocked or capacity unsafe?
3. Which client/animal, inventory, people, or cash exception needs Julia's decision?
4. What can a qualified teammate complete without Julia?
5. What changed since the last review and where is the owning record?

The fixture fails if the first viewport leads with generic revenue/cards while urgent
care, cold-chain, controlled discrepancy, credential, or capacity exceptions exist. It
also fails if a new veterinary dashboard duplicates Workspace attention instead of
drilling into the owning record.

Role-specific first views:

- **DVM:** correct animal and guardian/VCPR, allergies/current medication/problems,
  current encounter/results/tasks, charges/follow-up, and release boundary;
- **technician:** treatment/whiteboard queue, due/late tasks, qualification/witness,
  patient/location, stock/equipment exception, and escalation;
- **CSR/manager:** today's arrivals, urgent reserve, waitlist, guardian/consent gaps,
  payment/records handoffs, staffing/capacity, and operational exceptions; and
- **client:** animal-specific next action, released information only, estimates/consent,
  payment, discharge/result, recall, food order, and records request.

At minimum Julia and technician flows run at desktop and mobile widths. All roles run
keyboard, focus, accessible-name, loading, empty, slow, error, stale/offline,
permission-denied, and recovery assertions.

## 6. Coverage model for this and remaining archetypes

Coverage is selected from the registry and change-impact contract, never from a
hand-maintained count.

| Tier | Population | Execution | Purpose |
|---|---|---|---|
| T0 contract | Every registered archetype | Pure validation, derivation, reference integrity, deterministic digest, snapshots | Prove every archetype can produce a valid business and scenario delta. |
| T1 lightweight delta | Every registered archetype | Compile a minimal default scenario plus archetype-specific vocabulary/process assertions | Catch label-only or unsupported-capability drift cheaply. |
| T2 category sentinel | One risk-representative leaf per dynamically enumerated category | Live setup plus one owner job and one failure/recovery path | Catch setup/navigation/coworker/runtime defects shared by a category. |
| T3 operational twin shape | One sentinel for each of the 13 canonical `TwinTemplate` shapes | Simulator plus live flow/resource assertions | Catch resource, occupancy, stage, and attention defects by operating shape. |
| T4 deep fixture | Risk-selected leaves such as veterinary clinic and Pet Rescue | Full named roles/jobs, negative states, UX, replay, export/restore | Prove business-grade depth and regulated boundaries. |
| T5 external validation | Regulated/high-consequence deep fixtures | Human domain, legal/compliance, security, and usability review | Validate claims the platform and automated suite cannot authorize. |

CI chooses the smallest sufficient set from changed contracts:

- scenario/compiler changes run T0–T1 for all and all adapter contract tests;
- an archetype/category/process-profile change adds affected T2/T3 sentinels;
- shared scheduling/resource/inventory/identity/finance/compliance changes add every
  mapped T3 shape and affected T4 fixture;
- veterinary implementation changes add Oak & Prairie packs touched by the change;
- runtime/UI changes use the governed shared environment only when gate context marks
  the route/runtime impact; and
- docs-only changes regenerate/lint the doc index without booting a portal.

## 7. Delivery graph and backlog coverage

```text
BI-8424E0E6  Scenario contract + compiler
       |\
       | +-------------------+
       v                     v
BI-B39A796D              BI-757C91D4
Runner adapters          Oak & Prairie pack
       \                     /
        +---------+---------+
                  v
             BI-F49B0C85
          Role/job/UX execution
                  |
                  v
             BI-CCECF71B
          Tiered CI and rollout
```

The four traceability columns below are the exact coverage inputs for the governed
coverage receipt. Section references are local to this plan unless prefixed `Design`.

| Deliverable | Live BI | Requirements | Contract | Flow | Verification | Depends on |
|---|---|---|---|---|---|---|
| A. Canonical scenario contract/compiler | `BI-8424E0E6` | `OBJ-VET-001`, `OBJ-VET-005`; `AC-VET-001`, `AC-VET-006` | §3.3; Design §§6–7 | §8 TDD sequence | §8 Verification; `AC-VET-006` | None |
| B. Runner adapter convergence | `BI-B39A796D` | `OBJ-VET-005`; `AC-VET-001`, `AC-VET-006` | §§3.1–3.2 | §9 TDD sequence | §9 Verification; `AC-VET-001`, `AC-VET-006` | A |
| C. Oak & Prairie scenario pack | `BI-757C91D4` | `OBJ-VET-002`, `OBJ-VET-003`; `AC-VET-002`, `AC-VET-003`, `AC-VET-005` | §5; Design §12 | §10 TDD sequence | §10 Verification; `AC-VET-002`, `AC-VET-003`, `AC-VET-005` | A |
| D. Role/job/first-viewport execution | `BI-F49B0C85` | `OBJ-VET-004`; `AC-VET-004` | §§5.2–5.3; Design §8 | §11 TDD sequence | §11 Verification; `AC-VET-004` | B, C |
| E. Tiered CI/replay/rollout | `BI-CCECF71B` | `OBJ-VET-006`; `AC-VET-007`, `AC-VET-008` | §§6, 13 | §12 TDD sequence | §12 Verification; `AC-VET-007`, `AC-VET-008` | B, D |

Each row remains an independently reviewable boundary: A can ship without a live
veterinary run; B can preserve existing Restaurant behavior before Oak & Prairie; C can
ship a deterministic fixture and gap report before browser job automation; D can
produce role and UX evidence for any compiled scenario; and E can add impact selection,
replay governance and rollout after runner evidence exists.

**Coverage decision:** `decomposed`.
**Coverage receipt:** pending immutable repository artifact publication. No source
implementation may start until `record_plan_backlog_coverage` records all five mappings,
this section carries the returned receipt, and
`check_plan_backlog_coverage(BI-79449954, this path, receipt)` succeeds.

## 8. Phase A — contract and compiler (`BI-8424E0E6`)

### Deliverable

A package-owned, versioned scenario definition and compiler that extends
`DemoBusiness` without duplicating business identity.

### Expected source changes

- add `packages/storefront-templates/src/acceptance-scenario.ts`;
- add `packages/storefront-templates/src/acceptance-scenario.test.ts`;
- add `packages/storefront-templates/src/acceptance-scenario-registry.ts` only if the
  existing registry/export boundary cannot own lookup cleanly;
- update `packages/storefront-templates/src/index.ts` exports;
- extend `demo-flavor.ts` only enough to re-export scenario-owned flavor objects; and
- update package snapshots/manifests generated from the registry.

### TDD sequence

1. RED: duplicate business identity, unresolved actor/subject/resource references,
   nondeterministic clock, unknown capability, unsafe regulated claim, and missing
   cleanup each fail with stable actionable diagnostics.
2. RED: a minimal unflavored archetype compiles from `deriveDemoBusiness` without an
   overlay and remains deterministic.
3. GREEN: implement types, validator, stable reference index, capability resolution,
   digest, and compiled projection.
4. GREEN: prove every registered archetype compiles a T0 default by dynamically reading
   the canonical registry.
5. REFACTOR: consolidate hashing, stable-ref, time, and validation helpers already
   exposed in `demo-business.ts`; do not create route-local equivalents.

### Verification

- affected `@dpf/storefront-templates` Vitest files;
- property tests over registry entries, seed stability, invalid references, and time;
- snapshot review proving changes are intentional; and
- package typecheck/export check.

### Rollback

The new contract is additive in this phase. Remove its exports and tests if it cannot
compile without duplicating `DemoBusiness`; no runtime or database state is migrated.

## 9. Phase B — adapter convergence (`BI-B39A796D`)

### Deliverable

Thin scenario projections for existing demo load, simulator, live exercise, audit, and
UX fixture inputs, with Restaurant as the compatibility proof.

### Expected source changes

- add adapter modules beside their owners, for example:
  - `packages/storefront-templates/src/acceptance-scenario-load.ts`;
  - `apps/web/lib/business-activity-sim/scenario-flow-adapter.ts`;
  - `scripts/harness/scenario-adapter.mjs`;
- update `apps/web/lib/business-activity-sim/archetype-flows.ts` to consume compiled
  scenario events where present while preserving existing oracles;
- update `scripts/harness/archetype-exercise.mjs` to load compiled projections;
- convert `scripts/harness/scenarios/restaurant.mjs` into a compatibility re-export or
  delete it after parity proof;
- update `packages/storefront-templates/src/demo-business-load.ts` and
  `apps/web/lib/demo/load-demo-business.ts` for source-tagged adapter rows; and
- change audit/playbook docs to name the compiled scenario rather than restating it.

### TDD sequence

1. RED: Restaurant compiled projections equal the existing catalog/persona/demand/stock
   behavior and preserve its job matrix.
2. RED: load/unload/reload retains deterministic refs and cannot touch non-demo rows.
3. RED: simulator and HTTP adapters reject a job step they cannot represent instead of
   silently skipping it.
4. GREEN: introduce the adapters and route existing execution through them.
5. REFACTOR: remove duplicated restaurant definitions, runner-specific identity fields,
   and mirrored lifecycle rules after parity receipts exist.

### Verification

- Demo Business, load-plan, flavor, simulator-flow, and harness adapter unit tests;
- deterministic Restaurant snapshot comparison;
- live Restaurant smoke run in the canonical/shared environment;
- teardown/reload reconciliation and non-demo preservation; and
- audit of deleted definitions to prove one remaining authority.

### Rollback

Keep the compatibility adapter feature-gated until parity is proven. Revert projection
routing to the prior files without changing loaded data; teardown uses the existing
source prefix.

## 10. Phase C — Oak & Prairie pack (`BI-757C91D4`)

### Deliverable

One scenario module owning Oak & Prairie's flavor and acceptance overlay, plus a
deterministic gap report showing which journeys are executable versus blocked on the
veterinary product slices.

### Expected source changes

- add
  `packages/storefront-templates/src/acceptance-scenarios/veterinary-clinic.ts` and tests;
- update the scenario/flavor registry so `veterinary-clinic` resolves Oak & Prairie and
  Julia from that module;
- replace Meadowbrook/Iris snapshots with scenario-owned output;
- remove or redirect the legacy veterinary scenario in
  `docs/testing/archetype-audit-plan.md`; and
- add only thin load adapters required by already-existing authorities. Do not seed
  imaginary clinical, medication, or stock tables to make an unavailable capability
  appear green.

### TDD sequence

1. RED: the compiled scenario exactly matches design §12 identity, facility, hours,
   roles, scale, named actors, and journey inventory.
2. RED: every design §14 minimum journey maps to executable, expected-gap,
   reviewer-gated, or deferred status with an owning BI/contract reference.
3. RED: every regulated assertion carries evidence class and reviewer gate.
4. GREEN: author the fixture with stable refs, materialized sample, declared scale,
   events, outcomes, UX oracles, and cleanup.
5. REFACTOR: remove Meadowbrook/Iris and the older audit clinic identity; consolidate
   veterinary flavor, actor, time, and inventory fixture helpers.

### Verification

- contract, fixture, registry, flavor, and snapshot tests;
- all references and expected-gap BI links resolve;
- deterministic digest across repeated compiles;
- load/unload/load plan reconciliation for currently supported records; and
- clinical/legal assertions remain visibly blocked until required reviews exist.

### Rollback

Revert the registry entry to the generic derived veterinary demo. Fixture source tags
allow deletion of only Oak & Prairie materialized rows. Never delete signed, controlled,
financial, or non-fixture data.

## 11. Phase D — role, job, UX and safety execution (`BI-F49B0C85`)

### Deliverable

The existing exercise and UX sweep paths can authenticate each scenario role, execute
jobs, compare against a pre-DPF baseline, assert first-viewport and failure-state
contracts, and publish evidence/finding links.

### Expected source changes

- extend `scripts/harness/archetype-exercise.mjs` and focused helper modules for role
  sessions, job steps, evidence, and bounded recovery;
- extend `apps/web/scripts/ux-sweep-fixture.ts` /
  `apps/web/scripts/ux-sweep-fixture-core.mjs` to accept compiled scenario oracles;
- reuse `apps/web/scripts/ux-route-sweep*` and the existing Playwright runner;
- update `docs/testing/archetype-job-validation.md`, exercise harness docs, and
  playbook; and
- add report schema/tests under `scripts/harness` or the existing report owner, not a
  new database table.

### Required report fields

- scenario id/digest, source SHA, runtime target/image identity, installation purpose;
- actor/role, job id, pre-DPF baseline source/steps/time, DPF steps/time;
- start/end state, capability resolution, completed/blocked/failed result;
- screenshots and accessible-state evidence; route, service-call, log and evidence-record
  references;
- authority denials and reviewer gates;
- finding classification plus existing/new BI and Workroom reference; and
- teardown/replay reconciliation.

### TDD sequence

1. RED: jobs cannot pass without a recorded pre-DPF baseline or explicit
   baseline-not-applicable rationale.
2. RED: wrong role, permission, qualification, and release attempts fail closed.
3. RED: bounded loading produces actionable error/retry evidence; rendered-state checks
   do not use hidden streaming DOM as a health proxy.
4. RED: Julia's priority ordering and drill-through contract fails when a generic metric
   displaces a care/safety exception.
5. GREEN: connect role sessions, step execution, UX oracles, and evidence reports.
6. REFACTOR: consolidate login/session, bounded wait, screenshot, route, and report
   helpers exposed across the harness and UX sweep.

### Verification

- unit/contract tests for role, job, oracle, report, timeout, and BI mapping;
- canonical/shared-runtime happy, denied, failure, recovery, and replay runs;
- Julia and technician desktop/mobile visual review;
- keyboard and accessible-name/focus checks for all touched paths;
- no hardcoded colors or new duplicate dashboard/navigation surface; and
- reviewer-read evidence for every bot/automated finding before closure.

### Rollback

Job/UX execution is opt-in by scenario capability. Disable the new projection while
preserving scenario compilation and evidence already recorded. No product data rollback
is required.

## 12. Phase E — tiered CI and rollout (`BI-CCECF71B`)

### Deliverable

Dynamic, risk-weighted selection of T0–T5 coverage, deterministic replay and teardown,
and a reusable workflow for the remaining archetypes.

### Expected source changes

- add a scenario coverage selector beside the canonical archetype registry or existing
  test matrix owner;
- wire T0/T1 package tests into existing affected-test commands;
- extend the existing CI/gate matrix rather than create an independent workflow;
- generate category/twin-shape/deep-fixture coverage reports from registries;
- remove hardcoded archetype/category counts from affected docs/tests; and
- update the exercise playbook with the pickup template for the next archetype.

### TDD sequence

1. RED: a new registry archetype appears automatically in T0/T1 and an uncovered
   category/twin shape fails the coverage report.
2. RED: a change to shared scheduling/resource/inventory/identity contracts selects all
   mapped sentinels and deep fixtures.
3. RED: docs-only changes skip the portal runtime sweep while scenario/runtime changes
   cannot skip it.
4. GREEN: implement dynamic selection, reports, replay manifests, and gate integration.
5. REFACTOR: remove stale counts, duplicated test matrices, mirrored scenario rules,
   and obsolete fixture docs.

### Verification

- selector and matrix unit/property tests;
- CI dry-run fixtures for docs-only, leaf-only, category, twin-shape, and shared-substrate
  diffs;
- one full Oak & Prairie deep run plus Pet Rescue regression selection;
- setup/unload/reload/replay and export/restore evidence; and
- measured runtime/cost report proving heavy gates are impact-driven.

### Rollback

Keep selection changes isolated behind the existing gate/matrix boundary. Revert the
selector to prior affected-test behavior while retaining scenario contracts and reports.
Do not weaken a required runtime or safety gate to reduce cost.

## 13. Refactoring budget

At least 20% of each child BI's estimated effort is reserved for convergence directly
exposed by that slice:

| BI | Minimum refactor allocation | Named target |
|---|---:|---|
| `BI-8424E0E6` | 20% | Shared deterministic hashing/time/reference validation; no duplicate contract helpers. |
| `BI-B39A796D` | 30% | Remove mirrored runner scenario definitions and lifecycle rules after parity. |
| `BI-757C91D4` | 20% | Eliminate Meadowbrook/Iris and legacy audit clinic identities; consolidate fixture helpers. |
| `BI-F49B0C85` | 20% | Shared role session, bounded wait, rendered-state, evidence, and report helpers. |
| `BI-CCECF71B` | 20% | Dynamic registries/counts and one impact-selection matrix; remove stale documentation tables. |

The allocation cannot fund unrelated cleanup. Each refactor needs a failing/preservation
test, a named superseded authority, and deletion/parity evidence. If no appropriate debt
is exposed, the unused allocation returns to the BI; it is not converted into speculative
framework work.

## 14. Safety, compliance and data rules

- Scenario data is fictitious and resettable; regulated text is not presented as
  veterinary or legal advice.
- Clinical, controlled-substance, pharmaceutical/pathological/hazardous-waste, Illinois
  applicability, security, and accessibility claims remain reviewer-gated as named in
  the canonical design.
- The fixture may express a required event/outcome before its owning product capability
  exists, but the compiler and report must label it `expected-gap`; it may not seed an
  invented authority or count the step as passing.
- Tenant, animal, guardian, authority, credential, witness, consent, release, and
  source/provenance negative tests are mandatory for affected journeys.
- No teardown deletes non-fixture rows. Signed clinical facts, controlled movements,
  stock movements, consents, payments, audit/evidence, or external review receipts are
  corrected forward or retained according to their owning contracts.
- Secrets and real personal/animal records are never stored in fixture source or
  reports.

## 15. Plan-level verification and review gates

Before the plan is implementation-ready:

1. all six BIs and epic exist in the live backlog;
2. `record_plan_backlog_coverage` records the five child mappings against an immutable
   repository artifact and returns a receipt;
3. `check_plan_backlog_coverage` validates that receipt;
4. DPF architecture review confirms one authority and thin adapters;
5. data architecture review confirms scenario data does not become a parallel business
   or domain authority;
6. UX-fit review confirms Julia/role first views, progressive disclosure, failure
   states, accessibility/mobile cases, and no duplicate dashboard/navigation;
7. documentation lint/index generation passes; and
8. the docs-only branch follows DCO, independent semantic review, PR health, bot-review,
   and merge-queue requirements.

Implementation completion is proved only by the evidence listed in each child BI and
phase. A green T0 compiler test does not prove the Oak & Prairie live journey; a live
smoke run does not prove all archetypes; and an automated legal/compliance assertion is
not a substitute for the named human reviewer.

## 16. Definition of done

The umbrella `BI-79449954` is done only when:

- one scenario authority produces deterministic demo, simulator, harness, audit, and
  UX projections;
- the five child BIs are done with their own source, test, runtime, review, and PR
  evidence;
- Oak & Prairie/Julia is the only veterinary fixture identity and all design §12 packs
  have an honest executable/gap/deferred result;
- Julia and every named role can complete the implemented MVP jobs through the canonical
  runtime, including negative and recovery paths;
- T0–T5 selection covers every live registry entry, category, twin shape, and deep-risk
  fixture without hardcoded counts;
- setup, teardown, replay, export/restore, and non-fixture preservation reconcile;
- Pet Rescue findings have durable regression coverage or a recorded exclusion; and
- required veterinary, legal/compliance, controlled/waste, security, and accessibility
  reviews are attached before any regulated slice is promoted.

Until every condition is evidenced, the plan or fixture may be useful and partially
implemented, but the umbrella is not complete.
