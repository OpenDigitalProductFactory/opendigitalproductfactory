---
status: active
---

# Employment lifecycle actuator — implementation plan

- **Design:** [`2026-08-25-employment-lifecycle-actuator-design.md`](../specs/2026-08-25-employment-lifecycle-actuator-design.md)
- **Epic:** `EP-862820FD`
- **Status:** active (see frontmatter). The sequencing decision in §2 is ratified — `DI-DC833C327A44`, confidence high, margin 5.86, no commandment conflict.

---

## 1. Deliverables

Seven deliverables, one per backlog item. Every one names the acceptance criteria it discharges, so plan coverage is checkable rather than asserted.

| Key | Deliverable | Item | Discharges | Depends on |
|---|---|---|---|---|
| D1 | Worker classification axis | `BI-C61CEEA9` | AC-ELA-001, -002, -018 | — |
| D2 | Employment jurisdiction resolution | `BI-9252B9EA` | AC-ELA-003, -004, -018 | — |
| D3 | Five Workroom definitions in the source registry | `BI-28EFA338` | AC-ELA-005, -006 | — |
| D4 | Employment event spawns a Workroom instance | `BI-2624B7EA` | AC-ELA-007, -008, -009 | D1, D2, D3, D5 |
| D5 | Classification and jurisdiction control | `BI-B506AD2E` | AC-ELA-010, -011, -012 | D1, D2 |
| D6 | Referral as an evidenced relationship | `BI-D78DC392` | AC-ELA-013, -014 | D1, D3 |
| D7 | Lifecycle steps resolve to connector capabilities | `BI-828F8EC9` | AC-ELA-015, -016, -017 | D4, D5, EP-24741BBF |

Each is independently shippable in the sense that matters: it lands as one PR against `main`, passes the build gate on its own, and leaves the system correct. D4 and D7 are the only two that change observable behaviour for an operator.

---

## 2. Sequencing — and the one decision in it

```
wave 1   D1 classification    D2 jurisdiction    D3 definitions      (parallel)
wave 2   D5 control                                                  (safety gate)
wave 3   D4 spawn                                                    (the actuator)
wave 4   D6 referral          D7 provisioning                        (parallel)
```

**The control ships before the actuator, not after it.** This is deliberate and is the only sequencing choice in the plan that is not simply dependency order. It was settled through the platform decision surface rather than by author preference: decision `DI-DC833C327A44` recommends control-first at high confidence with a margin of 5.86 against a 0.2 tie threshold, no commandment conflict, and no principle that flips under sensitivity.

The natural instinct is to build the actuator first — it is the item with visible value — and add the classification gate once rooms exist to gate. That ordering opens a window in which employment events spawn rooms that enrol workers in curricula, schedules and review cycles with no classification check. For a contingent worker, that window does not merely produce a wrong record; it produces exactly the timestamped conduct evidence that §3.3 of the design identifies as the liability. A gate that arrives second has already failed at the thing it exists for.

D5 is a pure check function plus seeded policy rows. It is fully testable before any room spawns, which is what makes this ordering cheap.

D3 does not depend on D1 or D2 because registering definitions changes no behaviour until D4 subscribes. It is placed in wave 1 to parallelise, not because it is urgent.

---

## 3. Deliverable detail

### D1 — Worker classification axis (`BI-C61CEEA9`)

**Change surface**

- `packages/db/prisma/schema/workforce.prisma` — `WorkerClassification` enum; `EmploymentType` gains a required classification reference; engagement term and extension history.
- Generated TypeScript union per the enum generator recipe in the data-model stewardship runbook.
- `apps/web/lib/workforce/` — classification consequence resolver, returning typed values (withholding, directable, accrues-leave, enters-review, org-chart-placement), not prose.
- Determination record carrying author principal and evidence.

**Migration.** Forward-only, backfill SQL inline in the same migration file. Existing `EmploymentType` rows are mapped by label to a classification. Any label that does not map deterministically is written as `employee` **only if** the installation has no contingent-worker labels at all; otherwise it is left unmapped and surfaced as operator work. Guessing here writes a legal claim into the database.

**Verification.** Unit tests per classification consequence set; migration applied against a populated database copy, not a clean schema.

### D2 — Employment jurisdiction resolution (`BI-9252B9EA`)

**Change surface**

- `packages/db/prisma/schema/workforce.prisma` — `WorkLocation.jurisdictionSlug`, validated against `PROFESSION_JURISDICTIONS`.
- `apps/web/lib/workforce/` — resolver returning a jurisdiction or a typed unresolved reason (`no-work-location`, `location-without-jurisdiction`, `jurisdiction-not-in-employs-in`), mirroring the `UnresolvedReason` shape `approval-routing.ts` already establishes.

**Migration.** Existing locations become explicitly unresolved. No location is assigned a jurisdiction by inference from its address, timezone or the organisation's first `employsIn` entry.

**Verification.** A test per unresolved reason; a test proving the resolved slug is accepted directly as the `RegulatoryAutonomyPolicy` `jurisdiction` key with no translation.

### D3 — Five Workroom definitions (`BI-28EFA338`)

**Change surface**

- `apps/web/lib/work-management/source-registry.ts` — five entries appended to `WORK_CASE_SOURCE_REGISTRY`.
- Room projection policies for the finite four and the standing one, composed from the existing `FINITE_ROOM_PROJECTION` / `STANDING_ROOM_PROJECTION` constants.

**Constraint.** AC-ELA-005 is a gate: no schema, route, API, queue or parallel registry. If a definition cannot be expressed in the registry's existing entry shape, that is a finding to raise against the definition contract — not a licence to add a second registry.

**Verification.** Contract tests failing before registration and passing after; a served-UX check that a workforce instance renders business-first on Overview with no repository, worktree, PR or CI evidence present.

### D5 — Classification and jurisdiction control (`BI-B506AD2E`)

**Change surface**

- New activity classes `worker-direction`, `worker-classification`, `worker-provisioning` on the existing `RegulatoryAutonomyPolicy` spine.
- Seeded policy rows per shipped jurisdiction.
- A check invoked at the point of action by direction, scheduling, review enrolment and mandatory-training assignment.
- Typed refusal carrying classification, jurisdiction, rule and lawful alternative.

**Constraint.** The check is called by the action path, not the render path. A test must prove that an action invoked directly — bypassing any UI — is still refused.

**Verification.** A refusal test per classification; AC-ELA-012's paired test showing the same action permitted in one jurisdiction and refused in another, which is the only test that proves jurisdiction is actually read rather than decoratively stored.

### D4 — Employment event spawns a Workroom instance (`BI-2624B7EA`)

**Change surface**

- A subscriber on `EmploymentEvent` writes, mapping each of the 16 `EmploymentEventType` values to spawn, update-open-instance, or inert-with-reason.
- Idempotency via `Workroom.idempotencyKey`.
- Operator work emitted on unresolved classification or jurisdiction.

**Constraint.** `LIFECYCLE_TRANSITION_MATRIX` remains the sole authority on legal transitions. The subscriber reads the event; it does not re-validate or re-decide the transition.

**Verification.** Replay test; concurrent-writer test proving one instance under a race; unresolved-input test proving operator work rather than a partial instance; an exhaustiveness test over all 16 event types that fails when a new event type is added without a disposition.

That last test is the one worth insisting on. An actuator whose new event types silently do nothing degrades into the log it replaced.

### D6 — Referral as an evidenced relationship (`BI-D78DC392`)

**Change surface**

- `Application` gains a referring-worker reference, distinct from `sourceId`.
- One additional skip reason in `approval-routing.ts` — the referrer is skipped for their own referral.
- `referral-intake` vesting emits a pay component line.
- Monitoring write to `ProtectedMonitoringObservation` via opaque `evaluationRef`, gated on a recorded consent basis.

**Constraint.** A schema test must assert the referral record holds no foreign key to any scoring model. The structural separation is the guarantee; a relation added later for convenience would silently destroy it.

**Verification.** Self-approval exclusion test; orphan-referrer rejection test; the schema separation assertion.

### D7 — Lifecycle steps resolve to connector capabilities (`BI-828F8EC9`)

**Change surface**

- Steps declare a dotted capability identifier; resolution through the existing capability-indexed connector registry.
- Dated revocation execution; completion blocked while one is outstanding.
- Unresolved capability emits a named gap with three dispositions — absorb, generate on demand, record as manual.

**Dependency.** EP-24741BBF supplies the directory target. Connectors not yet migrated onto the connector kernel cannot serve capabilities; that migration is integration-strategy work outside this epic and is a hard prerequisite for any capability those connectors would serve.

**Verification.** Provisioning exercised against `services/integration-test-harness` under auth-failure, rate-limited, token-expired and malformed-response scenarios; a test proving the employee path executes and the contingent path refuses; a test proving an instance cannot complete with a dated revocation outstanding.

---

## 4. Build gate per deliverable

Every deliverable passes all four before it is complete:

1. Affected-package `vitest`.
2. `pnpm --filter web build` with zero errors — the only place TypeScript errors surface.
3. UX verification against the running app for D3, D4, D6 and D7, which all change an operator-visible surface. D1, D2 and D5 are non-visual and record a no-UX-change reason.
4. Migration applied cleanly for D1, D2 and D6 — against populated data, not a clean schema.

Documentation impact is part of done for each: D1 and D2 change the data-model stewardship surface; D3 deepens `docs/architecture/workroom-vocabulary-boundary.md`'s implemented-projection section; D5 adds activity classes that belong in the decision-governance documentation.

---

## 5. Risks

**The gate is enforced rather than structural.** §3.3 of the design accepts this trade against the two-system market answer. It holds only while the check sits at the point of action and a refusal is a stop. If either weakens, the trade is void. D5's bypass test is the tripwire.

**Jurisdictional rule content is unbounded.** The spine takes rules as data, but someone must write them. Shipping the spine with one jurisdiction populated and the rest unresolved is honest; shipping it with a `global` default that silently permits everything would be worse than not shipping it. AC-ELA-003 is what prevents that.

**D7 depends on an epic in flight.** EP-24741BBF is closing the `User` / `Principal` split. If it slips, D7 slips. D1 through D6 do not depend on it and deliver value without it — a governed, classification-aware, jurisdiction-scoped lifecycle with manual steps is materially better than the checklist that exists today.

**Classification mapping on migration.** D1's backfill touches a field with legal meaning. The plan deliberately refuses to guess and surfaces unmapped labels as operator work; the cost is that an installation with messy labels has manual work on upgrade. That cost is correct.

---

## 6. Not in this plan

Jurisdictional rule content authoring; global payroll and EOR depth; benefits enrolment; an org-configuration sandbox; the migration of the thirteen off-kernel connectors. Each is named in the design's §9 as a known, unclaimed gap.
