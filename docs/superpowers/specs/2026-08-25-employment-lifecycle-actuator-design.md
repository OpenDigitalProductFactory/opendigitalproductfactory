---
status: active
---

# Employment lifecycle actuator — design

- **Epic:** `EP-862820FD` — Employment lifecycle actuator: make an employment event do the work
- **Backlog items:** `BI-C61CEEA9` (classification), `BI-9252B9EA` (jurisdiction), `BI-28EFA338` (definitions), `BI-2624B7EA` (spawn), `BI-B506AD2E` (co-employment control), `BI-D78DC392` (referral), `BI-828F8EC9` (provisioning)
- **Budget:** ~80% refactor and integration, ~20% new capability. Six of the seven items extend an existing spine; only the classification axis is genuinely net-new substrate.
- **Decision scope:** `wwwd`. Every determination this design coordinates is a customer's decision about their own workforce, not a platform-development decision.

---

## 1. Problem

DPF's workforce spine holds 58 models. It covers requisition through offer, onboarding checklists, time, leave, staffing, reviews, pay runs, payslips, deduction elections and terminations. `EmploymentEvent` records every lifecycle transition against a closed 16-value type union, guarded by a `LIFECYCLE_TRANSITION_MATRIX` that validates every status move.

Nothing subscribes to it.

Hiring a person appends a row and creates checklist items that a human then works by hand. No account is created, no group assigned, no licence granted, no device issued, no payroll enrolment triggered. Terminating a person writes a `TerminationRecord` and revokes nothing.

The record model is not the gap. Benchmarking against Rippling (§3) shows that what its users name as the loved capability is not its employee records — it is that an employment event *acts*. DPF has the event, the state machine, the checklist and the approval chain. It has no actuator.

Three business facts make a naive actuator actively unsafe rather than merely incomplete, and all three must land in this design rather than after it:

1. **Not every worker is an employee.** `EmploymentType` is a free-text label table. There is no representation of the difference between an employee, a contractor engaged directly, a contractor supplied by an agency, a worker employed through an EOR, or a volunteer.
2. **Directing a contingent worker like an employee creates liability.** Joint-employer and misclassification tests turn on conduct — behavioural control, financial control, integration into the organisation, permanence. An actuator that treats every worker identically does not merely risk this; it manufactures the evidence automatically, at scale, with a timestamped audit trail.
3. **The rules differ by jurisdiction.** `Organization.employsIn` already declares where staff work. No worker resolves to a jurisdiction, so no rule can be looked up.

---

## 2. Current state — verified, not assumed

Every row checked against the tree at `63c858add9` on 2026-08-25.

### 2.1 What exists and is load-bearing

| Capability | Where | State |
|---|---|---|
| Workforce spine | `packages/db/prisma/schema/workforce.prisma` | 58 models. Full ATS, time, leave, staffing, review, payroll, termination |
| Lifecycle state machine | `apps/web/lib/workforce/workforce-types.ts:1` | `WorkforceStatus` (7 values), `EmploymentEventType` (16 values), `LIFECYCLE_TRANSITION_MATRIX`, `validateLifecycleTransition` — all closed and enforced |
| Accountable-approver walk | `apps/web/lib/workforce/approval-routing.ts` (BI-HCM-004) | Live. Manager-chain walk, typed skip reasons, transient `on-leave` handling via `onBehalfOf`, fail-loud on `no-manager-set` / `chain-exhausted` / `reporting-loop` |
| Workroom definition/occurrence boundary | `docs/architecture/workroom-vocabulary-boundary.md`, `WORK_CASE_SOURCE_REGISTRY` | Shipped under `BI-80BECE1E` (PR #4648). Definitions own a stable key, positive version, finite-or-standing mode, decision scope. Business instances need no repository, worktree, PR or CI evidence |
| Jurisdiction policy spine | `RegulatoryAutonomyPolicy`, `JurisdictionCriteriaProfile` (`decision-governance.prisma:69`, `:545`) | Live. Both keyed on `(industry, jurisdiction, jurisdictionBasis, activityClass)`. Carry `maxAutonomyLevel`, `humanControlRequired`, `requiredEvidence` |
| Employment jurisdiction declaration | `core-identity.prisma:584` `Organization.employsIn` | Live. Schema comment already states employment law keys off this dimension, separately from `sellsTo` and `operatesIn` |
| Adverse-impact rail | `ProtectedMonitoringObservation` (`decision-governance.prisma:583`) | Live. Deliberately structurally separate from scoring; joined only by an opaque `evaluationRef`. Built for four-fifths and NYC LL144 ratios |
| Occupation curricula | `OccupationProfile.onboardingCurriculumId`, `.moverCurriculumId` | Live. Joiner and mover curricula are already modelled per occupation |
| Connector kernel | `apps/web/lib/integrations/kernel/` | Live. Frozen definition schema, dotted capability namespace, capability-indexed registry, encrypted credential envelope, typed errors, audit with canonical arg hashing |

### 2.2 What is absent

| Gap | Evidence |
|---|---|
| Any consumer of `EmploymentEvent` that acts | Consumers are `actions/workforce.ts`, `workforce-types.ts`, `people-supplier-configs.ts`, `legacy-coverage-baseline.ts`, `table-classification.ts` — all read, write or display |
| Worker classification with legal meaning | `EmploymentType` is `{ name String, status String }`. Zero occurrences of co-employment, misclassification or contingent-worker vocabulary in `apps/web/lib`, `packages/db` or `docs` |
| A worker's governing jurisdiction | `WorkLocation` has `locationType`, `timezone`, optional `Address`. No jurisdiction column anywhere on the worker path |
| A workforce entry in the source registry | 13 source keys registered — `task-node`, `backlog-item`, `work-capsule`, `approval`, `data-control-operation`, `manual-task`, `scheduled`, `engagement`, `opportunity`, `booking`, `storefront-booking`, `activity`, `field-service-job`. None is a workforce shape |
| A referrer relationship | `RecruitingSource.type` accepts the string `referral`. Nothing records who referred whom |
| Outbound provisioning | SCIM appears twice in the tree: a token in a keyword list, and a UI label reading "Manual today, SCIM-ready next" (`identity/applications/page.tsx:57`) |

### 2.3 Corrections to assumptions carried into this work

**The lifecycle vocabulary is not missing.** A reasonable first assumption is that an actuator needs a new event taxonomy. It does not: `EmploymentEventType` is already a closed 16-value union and `LIFECYCLE_TRANSITION_MATRIX` already refuses illegal moves. This design adds a *subscriber*, not a state machine. Adding a second one would be the defect.

**A workflow engine is not needed.** `BI-80BECE1E` shipped the definition/occurrence seam one day before this design was written. `docs/architecture/workroom-vocabulary-boundary.md` states that a Workroom definition already declares outcome, trigger classes, authority, review, escalation, completion rules, default participants, planned sub-room composition and event-triggered spawn rules — and that later work must deepen that registry rather than create a parallel template subsystem. The employment lifecycle is therefore a set of registry entries. Building an automation engine beside the registry is the exact parallel-surface defect that document exists to prevent.

**The approval model is not missing either.** `approval-routing.ts` already resolves the accountable approver, already refuses to invent a fallback, and already distinguishes a transient absence from a handoff. The referral conflict-of-interest rule is one additional skip reason in that walk, not a second router.

---

## 3. Research & benchmarking

Three market positions, and what DPF takes from each.

### 3.1 Rippling — the actuator thesis

Rippling's architecture is one bet: a single unified data model, the Employee Graph, that every module reads and writes, so a change in one module propagates without crossing a seam. Its 600-plus pre-built SSO integrations are the outer ring; the graph is what makes them cheap, because identity resolution is solved once rather than per integration. Reviewers consistently name the automation — hire once, and payroll, benefits, device and access all follow — rather than any record type, with onboarding automation scoring 94% on G2.

**Adopt:** the thesis that an employment event must act, and that the value sits in the propagation rather than the records.

**Reject:** uniform treatment of every worker in the automation path. Rippling's automation is classification-blind by design — the workflow that provisions a new hire is the workflow, and worker type is a data attribute rather than a gate on the action. For a platform that intends to be the customer's system of record for contingent labour as well as employment, that is the one thing not to copy.

### 3.2 Workday — worker as the supertype

Workday does not model an employee and bolt contingent labour on. `Worker` is the supertype; `Employee` and `Contingent Worker` are distinct worker types beneath it, and reports and integrations address `Worker`. Contingent workers are grouped into types that bundle the limited set of services they should receive, with distinct business-process configuration per type.

**Adopt:** worker as the spine and classification as a typed axis that bundles consequences. This is the shape §7.1 implements, and it validates keeping one graph rather than two.

### 3.3 SAP Fieldglass — separation as the co-employment answer

Fieldglass is a vendor management system for the external workforce, sold explicitly alongside SuccessFactors rather than inside it. Its own positioning is the interesting part: it minimises co-employment risk by *not mingling employee and contractor data*, on the stated grounds that mingling blurs the lines of employment and leaves the organisation exposed. The integration story is "separate systems, total workforce view."

**This is the sharpest tension in the design.** The market's answer to co-employment is architectural separation into two applications. DPF absorbs; it cannot take that answer without abandoning its thesis.

**Adopt:** the underlying insight — that employee and contingent processes must not be the same process.

**Reject:** achieving that separation with a second system. DPF achieves it as a **classification-gated process boundary inside one graph**: one worker spine, one directory, one room surface, and a control that refuses to run an employee-shaped step against a contingent worker.

**Stated trade-off.** Two systems make the boundary structural — you cannot accidentally run an employee process against a contractor, because the contractor is not in that system. One graph with a gate makes the boundary *enforced rather than structural*, which is strictly weaker if the gate is incomplete. This design accepts that trade only because the gate is placed at the point of action rather than at the point of display, and because a bypassed gate is a §1 refusal rather than a warning. If the control in §7.5 degrades to advisory, the trade is no longer sound and the design should be revisited.

### 3.4 Standards

**SCIM** (RFC 7643 / 7644) is the one genuinely ubiquitous standard on this path, and it is a *provisioning* standard, not an employment one. It shapes the capability namespace in §7.7.

There is no ubiquitous employment-law standard, and there will not be one — jurisdictional employment rules are inherently local. This is why §7.2 treats jurisdiction as a resolvable key over a policy spine that already exists, and jurisdictional rule content as seeded data rather than code.

---

## 4. The central design decision

> **The platform never determines a worker's classification. It makes the determination explicit, jurisdiction-scoped, evidenced, and consequential — and refuses actions that contradict it.**

This mirrors the standing payroll boundary — prepare the artifact, never move the money — and it is the correct posture for three independent reasons.

**Authority.** Classification is a customer business decision. AGENTS.md §11 is explicit that a customer's business question routes through the WWWD Decision Perspective Gate and must not be settled by `principle_decide`, which is the platform-development surface.

**Liability.** Misclassification exposure sits with the employer. A platform that asserts a classification would be assuming a liability it cannot carry and offering an assurance it cannot honour.

**Correctness.** The classification tests are multi-factor, fact-dependent, and contested in litigation. A confident automated answer would frequently be wrong, and would be wrong in the specific way that is most damaging: documented, timestamped and apparently authoritative.

What the platform *does* do is the part that has real value and no such exposure: it makes the determination a first-class recorded fact with an author and evidence, resolves the jurisdiction whose rules apply, surfaces the factors for periodic re-confirmation when the facts of an engagement drift, and — the consequential half — refuses to execute actions that contradict what was recorded.

---

## 5. Objectives

1. **OBJ-ELA-001** — An employment event spawns the governed Workroom instance its definition prescribes, exactly once, or produces named operator work.
2. **OBJ-ELA-002** — Every worker carries a typed classification and a resolved employment jurisdiction, both explicit, neither guessed.
3. **OBJ-ELA-003** — An action that would direct, schedule, review or provision a worker contrary to their classification in their jurisdiction is refused at the point of action, with the lawful alternative named.
4. **OBJ-ELA-004** — A referral is an evidenced relationship carrying conflict-of-interest, bonus-vesting and adverse-impact consequences.
5. **OBJ-ELA-005** — Lifecycle steps address connector capabilities rather than named systems, so an uncovered capability is a visible integration decision rather than an anonymous failure.

---

## 6. Acceptance

| Acceptance | Objectives | Requirement | Evidence |
|---|---|---|---|
| AC-ELA-001 | OBJ-ELA-002 | `WorkerClassification` is a Prisma enum with a generated union; every `EmploymentType` row maps to exactly one classification. | test |
| AC-ELA-002 | OBJ-ELA-002 | A classification determination without a recorded human author is invalid; no code path derives one. | test |
| AC-ELA-003 | OBJ-ELA-002 | A worker resolves to an employment jurisdiction, or to a typed unresolved reason. `global` is never a silent default. | test |
| AC-ELA-004 | OBJ-ELA-002 | The resolved jurisdiction is accepted directly as the `jurisdiction` key by `RegulatoryAutonomyPolicy`; no translation layer is added. | test |
| AC-ELA-005 | OBJ-ELA-001 | Five definitions are registered in `WORK_CASE_SOURCE_REGISTRY`; no second registry, route, API or queue is added. | gate |
| AC-ELA-006 | OBJ-ELA-001 | A workforce instance projects definition and occurrence identity with no repository, worktree, PR or CI evidence present. | test |
| AC-ELA-007 | OBJ-ELA-001 | Each of the 16 `EmploymentEventType` values has an explicit disposition — spawn, update, or inert with a recorded reason. | test |
| AC-ELA-008 | OBJ-ELA-001 | Spawning is idempotent under event replay and under two concurrent writers of the same transition. | test |
| AC-ELA-009 | OBJ-ELA-001 | An event for a worker with unresolved classification or jurisdiction produces operator work, never a partial instance. | test |
| AC-ELA-010 | OBJ-ELA-003 | Direction, scheduling, review enrolment and mandatory-training assignment each check classification and jurisdiction before executing. | test |
| AC-ELA-011 | OBJ-ELA-003 | A refusal names the classification, the jurisdiction, the rule and the lawful alternative; it never degrades to a warning or a no-op. | test |
| AC-ELA-012 | OBJ-ELA-003 | The same action is permitted in one jurisdiction and refused in another for the same classification, proving jurisdiction is read. | test |
| AC-ELA-013 | OBJ-ELA-004 | A referrer cannot approve their own referral; the exclusion is a skip reason in the existing chain walk. | test |
| AC-ELA-014 | OBJ-ELA-004 | The referral record holds no foreign key to any scoring model; monitoring reaches `ProtectedMonitoringObservation` only by opaque ref. | test |
| AC-ELA-015 | OBJ-ELA-005 | A step declares a capability identifier; connector selection is by capability, never by hardcoded connector key. | test |
| AC-ELA-016 | OBJ-ELA-005 | An instance cannot reach completion with a dated revocation outstanding. | test |
| AC-ELA-017 | OBJ-ELA-005 | Provisioning is exercised against the contract harness under auth-failure, rate-limited, token-expired and malformed-response scenarios. | test |
| AC-ELA-018 | all | Migrations apply cleanly against a populated database; existing rows are mapped or marked explicitly unresolved, never guessed. | test |

---

## 7. Design

### 7.1 Worker classification (`BI-C61CEEA9`)

`WorkerClassification` becomes a Prisma enum with a generated TypeScript union, per AGENTS.md §8. It is distinct from `EmploymentType`, which is retained as the organisation's own display label and gains a required reference to a classification. An existing installation's labels are mapped, not replaced.

```
employee | contractor-direct | contractor-agency | temp-agency-worker
| eor-employee | volunteer | intern | board-member
```

Following Workday's bundling model, each classification declares **typed consequences rather than prose**: whether payroll withholding applies, whether the org may direct and schedule the worker, whether leave and benefits accrue, whether the worker enters review cycles, and whether they appear in the org chart as a reporting line or as an engaged party.

`volunteer` is not an afterthought. For the nonprofit and community archetypes it is the majority classification, and it carries the sharpest constraints — an unpaid worker directed like an employee is a wage claim.

Engagement term is modelled here. A contingent worker has a definite term with an extension history, which is a materially different fact from an employee's `endDate`: an extension is a re-determination trigger, because duration is itself one of the factors that turns a contractor into an employee.

**Worked example.** A six-month direct contract engagement is `contractor-direct` with a definite term. She receives a login and a Principal, appears in rooms she is a party to, and does real work. She is not enrolled in the review cycle, does not accrue leave, is not assigned mandatory training, and appears in the org chart as an engaged party rather than a reporting line. Extending her to twelve months does not silently continue — it opens a classification review.

### 7.2 Jurisdiction resolution (`BI-9252B9EA`)

`WorkLocation` gains a jurisdiction slug validated against the same `PROFESSION_JURISDICTIONS` vocabulary `Organization.employsIn` already uses. A resolver answers *which employment jurisdiction governs this worker*, walking worker → work location → jurisdiction.

Jurisdiction is multi-dimensional and this claims exactly one dimension: the employment basis. Sales-tax, data-residency and marketing-consent bases already resolve from their own `Organization` columns and are untouched.

Failure is loud, matching the posture `approval-routing.ts` already sets. An unresolvable jurisdiction — no work location, location without jurisdiction, or a location jurisdiction absent from the org's `employsIn` set — is surfaced as operator work naming the reason. It is never defaulted to `global`, because a silent default here produces a confidently wrong legal answer, which is worse than no answer.

The resolved slug is accepted directly as the `jurisdiction` key by `RegulatoryAutonomyPolicy` and `JurisdictionCriteriaProfile`. No translation layer is introduced; if the vocabularies do not already align, that is a defect to fix at the source rather than bridge.

### 7.3 The five Workroom definitions (`BI-28EFA338`)

Registered in `WORK_CASE_SOURCE_REGISTRY`, deepening the registry `BI-80BECE1E` established rather than creating a parallel template subsystem:

| Definition key | Mode | Trigger classes |
|---|---|---|
| `worker-onboarding` | finite | `hired`, `offer_accepted`, `onboarding_started` |
| `worker-change` | finite | `manager_changed`, `department_changed`, `position_changed` |
| `worker-offboarding` | finite | `offboarding_started`, `terminated` |
| `worker-classification-review` | standing | periodic; engagement-drift signals |
| `referral-intake` | finite | application referral recorded |

All five sit at `defaultDecisionScope: "wwwd"` and coordinate `portfolioRole: "forEmployees"`. Each declares what the definition contract requires: outcome, trigger classes, finite-or-standing policy, authority, review, escalation and completion rules, and accountable and contributing roles without pre-assigning a person to every future instance.

Authority resolves through `approval-routing.ts`. Its fail-loud unresolved posture and transient `onBehalfOf` handling carry over unchanged.

`OccupationProfile.onboardingCurriculumId` and `.moverCurriculumId` are the per-occupation content these definitions compose. The curricula already exist; the rooms give them somewhere to run.

### 7.4 Event to instance (`BI-2624B7EA`)

The single edge the epic exists to build: a subscriber on `EmploymentEvent` that spawns the instance its definition prescribes.

Idempotency is on `(event, definition)` via `Workroom.idempotencyKey`, which already carries a unique constraint. Event replay and two writers racing the same transition both yield one instance.

`leave_started`, `leave_ended`, `activated` and `reactivated` update an open instance rather than spawning a new one. Every one of the 16 event types has an explicit disposition — spawn, update, or deliberately inert with a recorded reason. None is unhandled by omission, because an unhandled event in an actuator is a silent failure to act.

An event whose worker has no resolvable classification or jurisdiction does not spawn a partial instance. **A half-provisioned worker is worse than an unprovisioned one**: the org believes onboarding happened, and the missing half is discovered by the worker on their first day, or by an auditor.

`LIFECYCLE_TRANSITION_MATRIX` remains the single authority on legal transitions. This adds no second state machine.

### 7.5 The co-employment control (`BI-B506AD2E`)

The gate that makes §3.3's trade sound.

A Workroom step that would direct, schedule, review or integrate a worker checks classification and resolved jurisdiction *before it runs*. The check routes through `RegulatoryAutonomyPolicy`, which is already keyed on the right tuple and already carries `maxAutonomyLevel`, `humanControlRequired` and `requiredEvidence`. This adds activity classes — `worker-direction`, `worker-classification`, `worker-provisioning` — and the seeded policy rows behind them. No parallel policy model.

A refusal is a stop, not a workaround (AGENTS.md §1). It names the classification, the jurisdiction, the governing rule, and **the lawful alternative** — a contractor is not assigned mandatory training; they are sent a statement-of-work amendment — so the operator can act rather than route around it.

The placement matters. The gate sits at the point of action, not at the point of display. Hiding a button while leaving the action reachable is not a control; it is a UI convention that an API call ignores.

`worker-classification-review` is the standing counterpart. Classification is not a fact recorded once at hire: engagements drift, and duration, increased direction and emerging exclusivity are exactly the factors that change the answer. The standing definition surfaces the determination for re-confirmation when those signals appear.

### 7.6 Referral (`BI-D78DC392`)

An application records its referring worker, distinct from the `RecruitingSource` category. Three consequences follow, each reusing an existing mechanism:

**Conflict of interest** is one additional skip reason in the `approval-routing.ts` walk. The referrer cannot approve their own referral. The existing chain-exhausted and reporting-loop failures continue to fail loud.

**Bonus** is a tenure-gated payroll consequence, not an ad-hoc payment: a `referral-intake` instance stays open to its vesting milestone, then emits a pay component line. It never moves money.

**Monitoring** reaches `ProtectedMonitoringObservation` through its existing opaque `evaluationRef`, where collection is lawful and consented. The structural separation is preserved exactly — the referral relationship must never become a scoring input and must not share a foreign key with one. Referral pipelines reproduce the existing shape of a workforce, which is precisely the adverse-impact risk that rail was built to measure.

A referral by a contingent worker is attributable but does not imply the referrer may participate in the hiring decision.

### 7.7 Provisioning by capability (`BI-828F8EC9`)

A lifecycle step declares a capability — `directory.user.create`, `directory.group.assign` — and the connector registry resolves which connector serves it. Selection is by capability, never by hardcoded connector key. The registry already indexes by capability and already rejects duplicate capability keys at construction.

EP-24741BBF supplies the directory target. This design consumes it and must not fork it.

Revocation is date-bound. An offboarding step scheduled for a termination date executes on that date, and the instance stays open and accountable until it does. An instance cannot reach completion with an unexecuted revocation outstanding — an offboarding that closes while access remains live is the failure mode this design most needs to prevent.

Every step is classification-gated before execution, so provisioning a contingent worker follows that worker's lawful path.

An unresolved capability is an honest, actionable gap. It names the missing capability and opens the integration decision — absorb, generate a connector on demand, or record the step as manual — rather than failing anonymously. Connectors not yet on the kernel cannot serve capabilities; that migration is integration-strategy work outside this epic.

---

## 8. Boundaries

- **The platform never determines a classification.** §4.
- **The platform never moves money.** A referral bonus emits a pay component line. Unchanged from the standing payroll boundary.
- **The platform never decides a customer's business question through `principle_decide`.** All five definitions are `wwwd`.
- **No second state machine, no second registry, no second approval router, no second policy spine.** Each is a §1 check applied at this design's altitude.

---

## 9. What this design does not do

- It does not seed jurisdictional employment rule content. The spine takes rules as data; populating them per jurisdiction is separate, ongoing, and partly a customer responsibility.
- It does not build global payroll or EOR jurisdiction depth. That remains provider-led.
- It does not build benefits enrolment. `EmployeeDeductionElection` models the payroll consequence of a benefit, not the enrolment of one; the gap is real and is not claimed here.
- It does not add an org-configuration sandbox. Rippling ships one and it is a genuine gap; it is not on this path.
- It does not migrate the thirteen off-kernel connectors. §7.7 depends on that work without owning it.

---

## 10. Named deviation

**`EmployeeProfile` is the wrong name for the spine this design generalises.** Once the model holds contractors and volunteers, `Worker` is the correct domain noun, and §3.2 confirms that is the shape the reference implementation uses.

The model carries approximately ninety relations and is the accountability anchor for compliance, policy, control ownership, backlog, epics, builds and finance. Renaming it is a large mechanical refactor with no functional gain and a wide blast radius.

**Decision:** keep `EmployeeProfile` as the physical model; establish **Worker** as the domain vocabulary in code comments, room copy and operator-facing surfaces. This is recorded as debt rather than accepted silently, and should be registered via `register_tech_debt` when the first item lands so the divergence between the physical name and the domain vocabulary stays visible rather than becoming folklore.
