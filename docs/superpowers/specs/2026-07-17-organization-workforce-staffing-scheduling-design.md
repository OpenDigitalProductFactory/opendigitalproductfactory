# Organization workforce staffing and scheduling — design

| Field | Value |
| --- | --- |
| Status | Design review complete; ready for a later implementation plan after the founder decisions in §18 |
| Revision | 2026-07-17 second pass: added the staffing variable catalog (§9) and per-archetype staffing profiles with starter constraint packs (§10) from a seven-track research sweep |
| Date | 2026-07-17 |
| Scope | Organization-level workforce staffing and scheduling across industries and jurisdictions |
| Source | Founder `/goal` objective, 2026-07-17 |
| Decision record | `DI-C8BF6362B44C` (`principle_decide`; high confidence) |
| Proposed backlog item | `BI-WORKFORCE-STAFFING-SCHEDULING` (not yet filed; exact intake in §19) |
| Not in scope | Feature implementation, migration, implementation plan, Build Studio promotion, payroll calculation, or autonomous employment decisions |

## 1. Executive decision

DPF should add a **canonical organization staffing domain** whose records—not
calendar events, chat messages, an LLM, or a solver vendor—are authoritative for
staffing demand, shifts, and assignments. An AI Staffing Coworker should begin as
an evidence-gathering and proposal assistant. It may normalize facts, find gaps,
evaluate deterministic constraints, call an optimization adapter, explain options,
and prepare repairs, but an authorized human confirms assignments and policy
exceptions. Automation may grow only through explicit, scoped delegation after
the organization has accumulated verified outcomes.

The proposal engine should use a provider-neutral adapter. The default provider
should be a self-hosted, open-source constraint solver, with **OR-Tools CP-SAT as
the first candidate to validate**, rather than custom heuristics or LLM-only
scheduling. A managed solver and an incumbent workforce-management (WFM) system
remain optional adapters. DPF retains the canonical domain, governance, evidence,
and projection contracts in every mode.

This is not the existing platform-job scheduler. The latter owns recurring DPF
operations and is designed in
[`2026-06-21-scheduling-surface-review-design.md`](2026-06-21-scheduling-surface-review-design.md).
This design concerns people assigned to organization work.

## 2. Outcome and non-goals

### 2.1 Outcome

The capability lets an organization answer, with evidence:

1. What work coverage is required, when, where, and with which skills?
2. Who is eligible and available without violating applicable constraints?
3. Which feasible staffing options best meet the organization's declared goals?
4. Who approved the chosen assignment or exception, and what changed later?
5. Which employees need to be notified, acknowledge, correct, or escalate?

It must serve fixed shifts, appointment coverage, field crews, on-call rotations,
and demand-driven staffing without pretending those operating models are
identical. Industry archetypes configure vocabulary, default demand patterns, and
constraint packs; they do not fork the platform data model. §9 catalogues the
cross-industry variable space and §10 profiles all 21 archetype categories with
starter constraint-pack candidates.

### 2.2 Non-goals

- Payroll, wage calculation, benefits, or performance scoring.
- Replacing `LeaveRequest`, timesheets, credentials, HR identity, field dispatch,
  care scheduling, customer bookings, or external calendars.
- Inferring medical, family, union, religion, disability, or other protected or
  highly sensitive facts from communications.
- Ranking employees by a hidden generalized “fitness” or “reliability” score.
- Allowing an optimizer or AI model to confirm an assignment, deny leave, waive a
  legal constraint, or impose an adverse employment consequence by itself.
- Treating an unread message, a calendar “busy” block, or a learned pattern as an
  approved leave request.

## 3. Evidence base and current-state finding

The evidence pass used DPF MCP first, then an explicitly read-only PostgreSQL
fallback because the MCP backlog list is capped at 100 records per status. It
also inspected the repository at the branch's `origin/main` base.

### 3.1 Live backlog and runtime, 2026-07-17

- No dedicated staffing, shift-assignment, employee-availability, or workforce
  scheduling backlog item exists. Keyword queries against live `BacklogItem` and
  `Epic` state found only unrelated platform-job and marketing calendars.
- `BI-E7E06414`, **HCM payroll + performance-review execution (SAP HCM gap)**, is
  adjacent but explicitly covers payroll and performance execution, not staffing.
  It remains open/deferred under `EP-SAP-PARITY`; widening it would violate its
  vendor-parity scope.
- The live organization has two active employee profiles, one approved timesheet,
  two calendar events, no leave policy or leave request, no calendar sync, no
  service provider availability, no policy, no person-license record, and no
  communication-channel binding. `BusinessContext.employsIn` is empty.
- The live install has 9 proposed `AgentActionProposal` rows and 143
  `DecisionInteraction` rows, confirming that proposal and decision evidence are
  real substrates rather than aspirational schema.

The conclusion is precise: DPF has useful **adjacent substrate**, but neither the
live install nor the schema has a staffing authority. The design must not relabel
calendar or provider-availability records to manufacture one.

### 3.2 Reusable substrate

| Existing authority or projection | Reuse | Boundary |
| --- | --- | --- |
| `Principal`, `PrincipalAlias`, `EmployeeProfile`, `Department`, `Position`, `OccupationProfile`, `EmploymentType`, `WorkLocation` | Identity, reporting, role, occupation, location, timezone, employment context | Do not duplicate a staffing “person” table |
| `LeavePolicy`, `LeaveRequest` | Approved leave and pending leave workflow | Only approved leave becomes a hard unavailability fact; a message is not leave |
| `TimesheetPeriod`, `TimesheetEntry` | Actual hours and retrospective evidence | Actuals do not silently rewrite future preferences or policies |
| `PersonLicenseRecord`, `CredentialEntry`, training/policy completion | Eligibility and expiry evidence | Expose minimum-necessary eligibility, not private credential detail |
| `Policy`, `PolicyRequirement`, `PolicyAcknowledgment`, regulatory obligations | Human-readable policy and compliance sources | Generic policy JSON is not itself a safe executable labor-rule engine |
| `AgentGovernanceProfile`, `DelegationGrant`, `AgentActionProposal`, `DecisionInteraction` | Proposal, authority, approval, rationale, and audit | Reuse the pattern; staffing decisions need typed domain links |
| `CommunicationChannelBinding`, sessions, delivery attempts | Verified channel identity, direction, urgency, quiet hours, delivery evidence | A connector payload is evidence, never an assignment authority |
| `CalendarEvent`, `CalendarSync`, workspace calendar projections | Display, free/busy input, and external interchange | Calendar remains a projection; staffing records project into it |
| `WorkQueue`, `WorkItem`, field-dispatch and care-scheduling domains | Demand/work context and specialized downstream allocation | Do not make generic work items or vertical appointments the cross-industry staffing authority |
| `ServiceProvider`, `ProviderAvailability` | Customer-booking provider projection and slot input | It is not general employee availability |

Schema anchors are in
[`packages/db/prisma/schema.prisma`](../../../packages/db/prisma/schema.prisma),
including `EmployeeProfile` (line 389), `Organization` (3663),
`PersonLicenseRecord` (4186), `AgentActionProposal` (4995),
`CommunicationChannelBinding` (5494), `LeaveRequest` (7556),
`TimesheetEntry` (7606), `CalendarEvent` (7643), `CalendarSync` (7708),
`Policy` (8116), `ServiceProvider` (9070), `ProviderAvailability` (9108),
`WorkQueue` (11438), `WorkItem` (11461), and `DecisionInteraction` (11924).

### 3.3 Calendar and integration gaps that matter

The workspace calendar correctly merges native, synced, and projected events in
[`calendar-data.ts`](../../../apps/web/lib/workforce/calendar-data.ts). However,
its optional `employeeProfileId` is not applied to the native or projection
queries, so the present implementation must not be described as a secure
employee-specific staffing view. Native update/delete paths also require
ownership/capability hardening before private staffing projections can depend on
them. These are implementation prerequisites, not permission to expand calendar
into staffing authority.

Inbound iCal exists; Google/Outlook calendar sync routes remain incomplete. The
Microsoft 365 connector is read/preview-oriented and does not persist governed
candidate workforce facts. DPF exposes `query_employees` but no staffing,
availability, assignment, or leave MCP tool pack today.

## 4. Canonical vocabulary and authority

These concepts must remain distinct in schema, APIs, coworker language, and UI.

| Concept | Meaning | Authority and lifecycle |
| --- | --- | --- |
| Availability | An employee-declared or authorized window in which the person can or cannot be assigned | Employee/HR-owned fact; effective-dated, timezone-aware, correctable, revocable |
| Time-off intent | Evidence that a person may want time away | Candidate fact only; must be confirmed and routed into leave workflow |
| Leave request | A formal request for time off | `LeaveRequest`; pending until the configured approver decides |
| Approved leave | Authorized absence | `LeaveRequest.status=approved`; becomes a hard unavailability interval |
| Preference | A desired but normally non-binding scheduling property | Explicit or employee-confirmed; soft by default; consented, weighted, expiring |
| Staffing demand | Required coverage for a time interval, location, role/skill, work context, and quantity | Organization operations authority; may be forecast, manual, booking-derived, or work-derived, with provenance |
| Proposed shift | A tentative work interval that may be unassigned or part of a proposal set | Staffing domain; mutable until publication/confirmation |
| Confirmed assignment | An authorized binding between a person/crew and a shift | Staffing domain authority; versioned; projects to calendar and notifications |
| Calendar event | A user event, external event, or projection of another record | Calendar domain/projection only; never establishes an assignment |
| Hard constraint | A rule whose violation makes an option infeasible | Deterministic, typed, effective-dated, source-cited; solver cannot relax it |
| Soft constraint | A declared objective or preference that affects score, not feasibility | Weighted and explainable; organization or employee authority as appropriate |
| Exception | A request to depart from an organization rule that is legally waivable | Explicit record; never makes a non-waivable legal/credential rule waivable |
| Approval | An authorized human decision at a meaningful boundary | Records actor, authority, rationale, evidence snapshot, decision, and time |

“Schedule” is a view of shifts and assignments. It is not an additional source of
truth.

## 5. Proposed logical model

Names below are design-level and must be reconciled against `origin/main` during
the later implementation plan. The model adds only concepts not represented by
the verified substrate.

### 5.1 Required staffing aggregates

1. **`StaffingDemand`** — organization, source type/id, interval, timezone,
   location/work context, role/occupation, required skills or credentials,
   minimum/target quantity, priority, status, provenance, and effective version.
2. **`StaffingShift`** — demand link, interval, timezone, location/work context,
   required quantity, lifecycle (`draft`, `proposed`, `published`, `cancelled`),
   publication version, and immutable event trail.
3. **`StaffingAssignment`** — shift, principal/employee or crew reference,
   lifecycle (`proposed`, `confirmed`, `declined`, `withdrawn`, `completed`),
   decision/approver reference, acknowledgement state, source, and version.
4. **`EmployeeAvailabilityWindow`** — employee, available/unavailable kind,
   local interval/recurrence plus timezone, source, effective range, owner,
   confirmation state, and supersession link.
5. **`EmployeeSchedulingPreference`** — employee, typed preference, scope,
   weight, explicit/inferred origin, consent state, confidence, evidence refs,
   effective/expiry dates, and supersession link.
6. **`StaffingConstraintRule`** — typed predicate and parameters, hard/soft,
   applicability (jurisdiction, archetype, organization, unit, location,
   employment type), source policy/obligation URL, legal-waivability, version,
   effective dates, validation state, and reviewing authority.
7. **`StaffingProposalRun`** and **`StaffingProposalOption`** — immutable input
   snapshot/hash, solver/provider/version, time limit, deterministic constraint
   evaluation, score components, unfilled demand, violations, explanation,
   comparison, and terminal status. A proposal never mutates assignments.
8. **`StaffingExceptionRequest`** — rule, affected shift/assignment, reason,
   requested scope/expiry, approving authority, decision, and evidence. Hard
   non-waivable rules reject exception creation.
9. **`WorkforceCandidateFact`** — bounded staging record for communication or
   integration-derived intent, with subject, kind, extracted value, confidence,
   source envelope, identity resolution, review state, expiry, correction, and
   promotion target. It is never directly solver-authoritative.

### 5.2 Reuse instead of duplication

- Link employees through `EmployeeProfile`/`Principal`; do not copy names,
  managers, contacts, departments, positions, or employment status.
- Link eligibility to existing person-license, credential, policy-completion, and
  training evidence. Cache only a proposal snapshot/hash for reproducibility.
- Approved leave is read from `LeaveRequest`; staffing does not own another
  time-off table.
- Use existing action proposals/delegation/decision interactions for governance,
  adding typed staffing links where a generic JSON reference would be ambiguous.
- Project confirmed assignments to `CalendarEventView`; do not persist a second
  canonical calendar copy unless an external-sync outbox requires one.

### 5.3 Invariants

- Times are stored as instants plus the decision timezone and local-date context;
  daylight-saving gaps and folds are explicit validation cases.
- An employee cannot hold overlapping confirmed assignments unless an explicit,
  typed operating model permits it.
- A proposal references an immutable input version and rule-pack version.
- Publishing uses optimistic concurrency: stale proposals cannot overwrite newer
  assignments, demand, leave, eligibility, or availability.
- Assignment history is append-only or event-versioned; cancellation does not
  erase who was assigned previously.
- Every external event is idempotent by organization/provider/external identity.
- Protected or medical reasons are never copied into coordinator-visible
  constraints. The staffing view receives only the minimum necessary result,
  such as “unavailable” or “not eligible”.

## 6. Policy hierarchy and jurisdiction

Rules resolve in this order, while preserving their separate authorities:

1. Applicable law and regulation for the employee/work location and work type.
2. Collective-bargaining, contractual, credential, and accommodation-derived
   restrictions, exposed only at minimum necessary detail.
3. Organization policy.
4. Business-unit, location, team, or archetype overlay.
5. Employee availability and approved leave.
6. Organization objectives and confirmed employee preferences.

The **most restrictive applicable hard rule wins**. Lower layers may add
protection but cannot weaken a higher non-waivable rule. A waivable organization
rule can be bypassed only through `StaffingExceptionRequest`; the solver never
adds a penalty to a hard rule and calls the violation acceptable.

Applicability must use `BusinessContext.employsIn`, actual work location,
employee employment type, shift location/timezone, industry/archetype, effective
dates, and any regulated role. The live organization's empty `employsIn` is a
real readiness blocker: when jurisdiction or location cannot be resolved, the
system must return **requires policy review** and withhold a publishable proposal,
not assume United States defaults.

Rule packs are configuration with source URLs, effective dates, last verification,
review owner, and test cases. DPF supplies a framework and reviewed starter packs;
the deploying organization remains responsible for validating labor rules with
qualified counsel. For example, the U.S. FLSA generally uses a fixed 168-hour
workweek and overtime after 40 hours for covered non-exempt workers, while the EU
Working Time Directive addresses weekly time and daily/weekly rest. Those are
examples of overlays, not universal constants ([U.S. Department of Labor](https://www.dol.gov/agencies/whd/overtime),
[Directive 2003/88/EC](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32003L0088)).

## 7. Solver and architecture options

### 7.1 Options considered

| Option | Strengths | Costs/risks | Decision |
| --- | --- | --- | --- |
| A. DPF staffing domain + open solver adapter | Canonical schema, self-hosted privacy, deterministic constraints, provider portability, reproducible evidence | Larger initial architecture; Python/service packaging must satisfy deployment contracts | **Recommend** |
| B. Managed employee-scheduling solver as authority | Fast mature constraint catalog and operational service | Workforce-data egress, vendor lock-in, sovereignty/residency and cost limits, authority mismatch | Adapter only, explicit opt-in |
| C. External WFM/HRIS as authority | Correct for customers already committed to an incumbent WFM | No native capability for other customers; provider-specific semantics; portability loss | Supported authority mode, not platform default |
| D. `CalendarEvent`/`ProviderAvailability` + custom TypeScript or LLM heuristics | Fastest apparent route; current runtime only | Conflates projection and authority; weak feasibility guarantees; custom algorithm debt; poor auditability | Reject |

### 7.2 Kernel result

DPF `principle_decide` evaluated the four options against the closed dimension
registry with `callingPopulation=external_coding_agent` and `universal-ring`.
It recommended option A with **high confidence**, composite **12.414**, margin
**4.693**, strong structured coverage, no commandment conflict, and durable
record `DI-C8BF6362B44C`. The recommendation aligns with architecture over
shortcuts, schema grounding, operational independence, data privacy, low vendor
lock-in, and reversible proposal-mode operation.

The result is advisory, not an independent empirical benchmark: this design
authored the option feature vectors, and the universal-ring recall included broad
delivery and accessibility commandments alongside architecture principles. The
ledger and margin make the trade-off auditable; they do not replace dependency,
deployment, privacy, or functional validation.

This kernel call governs platform architecture only. Under “decisions belong to
their scope,” it does not select employees, define an organization's staffing
goals, or approve a schedule.

### 7.3 Solver boundary

The adapter accepts a normalized, versioned problem and returns candidate
solutions plus machine-readable score and violation detail. It cannot read the
database, send notifications, publish shifts, or decide exceptions. DPF performs
identity resolution, rule applicability, authorization, persistence, explanation,
and approval outside the solver.

The first implementation-planning spike should compare:

- [OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver),
  whose official employee-scheduling example demonstrates constraint-based shift
  assignment and whose status model distinguishes feasible, optimal, infeasible,
  and unknown results;
- a self-hosted [Timefold](https://docs.timefold.ai/employee-shift-scheduling/latest/user-guide/constraints)
  deployment or adapter, whose documented model separates hard, medium, and soft
  constraints and covers availability, time off, skills, work limits, fairness,
  and demand; and
- [MiniZinc](https://docs.minizinc.dev/en/stable/) only if solver-neutral modeling
  outweighs the additional integration surface.

OR-Tools is the leading default candidate, not a pre-approved dependency. The
later plan must perform license/SBOM/provenance review, container sizing,
determinism and timeout tests, ARM64/AMD64 packaging, offline operation, failure
semantics, and cross-platform deployment review. The current portal image is
Node/Alpine; silently embedding a Python dependency in it is not acceptable.
A bounded internal solver service/worker behind the adapter is the likely shape,
subject to deployment-contract review. Google's supported bindings are C++,
Python, Java, and .NET—not Node—and Google does not publish an official OR-Tools
container image, so packaging is a first-class spike rather than a footnote
([OR-Tools installation](https://developers.google.com/optimization/install/)).
Timefold Community Edition is another self-hosted candidate, implemented for
Java/Kotlin and Apache-2.0 licensed; its enterprise edition is a distinct licensed
product ([official repository](https://github.com/TimefoldAI/timefold-solver)).

## 8. Constraint and objective model

### 8.1 Hard constraints

Examples include approved leave, declared unavailability, required rest,
maximum hours where applicable, non-overlap, valid credential/training, role and
skill eligibility, location feasibility, crew composition, and an unexpired
right-to-work/employment status. Each must name its source and applicability.

Unknown data is not automatically false. For safety-critical eligibility,
unknown means infeasible/review required. For a non-critical preference, unknown
means no preference contribution.

### 8.2 Soft objectives

Examples include coverage quality, employee-confirmed preferences, fairness of
undesirable shifts, continuity, travel/time-zone burden, overtime avoidance,
cost, minimal disruption, and schedule stability. Every score is decomposed by
objective and displayed in meaningful units; no opaque composite employee score
is persisted.

“Fairness” requires an organization-approved definition and monitored outcome
metrics. It must not use protected attributes as optimization inputs except where
lawful, necessary, isolated, and reviewed for bias testing. The production
proposal does not expose protected attributes to the solver merely because an
offline fairness audit may use them under separate authority.

### 8.3 Explanation contract

For every option, the UI must show:

- demand covered/uncovered;
- hard constraints applied and any missing policy data;
- soft-objective contributions and trade-offs;
- why each proposed assignee is eligible, using minimum-necessary facts;
- what changed from the published schedule;
- solver/provider/version, input version, timeout, and status;
- alternative options, including “no feasible schedule” without fabricated fill;
- the human approval or exception required next.

## 9. Staffing variable catalog

A second research pass (2026-07-17, seven parallel citation-grounded sweeps)
covered the staffing operating models behind each of the 21 `ArchetypeCategory`
values in
[`packages/storefront-templates/src/types.ts`](../../../packages/storefront-templates/src/types.ts)
and the cross-jurisdiction scheduling-regulation space. Its structural finding:
the variable space is far larger than "shifts + leave + credentials", and
several variable families change the shape — though not the direction — of the
§5 model and §7 architecture. This section catalogues the variable families;
§10 maps them per archetype; §9.9 records the resulting model deltas.

### 9.1 Demand shapes — shift coverage is only one of five

| Demand shape | Definition | Examples | Solver posture |
| --- | --- | --- | --- |
| **Coverage floor** | Fixed contractual/statutory/safety minimum that cannot flex down | Guard post-hours (SLA), police minimum staffing, awake-overnight shelter ratios, boarding check rounds, UL 827 monitoring operators | Fill problem: unfilled interval = breach; forecast is irrelevant |
| **Forecast-driven curve** | Interval-level requirements derived from a demand forecast | Restaurant dayparts, retail foot traffic, branch teller windows, warehouse volume, contact-center queues (Erlang-C) | Match staffing to curve; balance service level vs idle cost |
| **Calendar-led fixed slots** | Named, pre-committed slots that ARE the demand | Class calendars, appointment books, recurring student–instructor lessons | Assignment problem with continuity pinning; slot change = product change |
| **Task/dispatch pipeline** | Discrete jobs/work orders/calls with skills, location, duration, dependencies | Field-service jobs, moving jobs, make-ready chains, construction trade tasks, production days, event calls | Job-shop/dispatch with travel, sequencing, and crew composition |
| **Census-derived load** | Resident/animal/case count × care-minutes conversion | Boarding census, shelter beds, residential care, caseloads | Convert census → care-hours per block; periodic mandatory tasks |

Most real organizations combine shapes: a fitness studio is fixed slots over a
forecast-driven floor layer; a veterinary clinic is appointment slots plus an
on-call coverage floor; property management is a work-order pipeline plus a
zero-notice emergency lane. `StaffingDemand` therefore needs a first-class
demand-shape discriminator (§9.9); a shift-grid-only model underfits four of
the five shapes.

### 9.2 Assignable-unit shapes

1. **Individual ↔ shift/slot** — the classic case (teller, server, stylist).
2. **Person + equipment composite** — the tech and the equipped van are one
   assignable unit whose equipment fit gates job eligibility (mobile tire rigs,
   glass racks); likewise instructor + inspected dual-control car, or a
   freelancer whose kit rents with them.
3. **Crew as atomic unit** — moving crew (truck + lead + helpers), trades
   install crews, catering call-sheet teams; crew composition rules (lead +
   helper, apprentice paired with journeyman) are internal constraints of the
   unit.
4. **Function-coverage slot** — "at least one counter-qualified and one
   yard-qualified person on site each open hour" (rental), keyholder open/close
   (retail), named-capability presence (§9.3).
5. **Rotation membership** — on-call primary/secondary chains, standby weeks,
   follow-the-sun handoffs; the schedulable object is a position in a rotation,
   not an interval of work.

### 9.3 Eligibility, presence, and pairing constraint classes

Per-person eligibility alone cannot express the recurring legal shapes found in
nearly every archetype:

- **Credential matrix with expiry** — task × credential × supervision level ×
  **jurisdiction of the job, not of the worker** (dental-hygienist supervision
  levels vary by state ([ADHA](https://www.adha.org/wp-content/uploads/2023/01/ADHA_Practice_Act_Overview_8-2022.pdf));
  locksmith work is licensed in ~13–15 states ([Locksmith Ledger](https://www.locksmithledger.com/home/article/21254499/locksmith-licensing-a-state-by-state-review));
  EPA 608/609 for refrigerant work ([EPA](https://www.epa.gov/section608/section-608-technician-certification-requirements));
  guard card + armed endorsement ([CA BSIS](https://www.bsis.ca.gov/forms_pubs/fire_fact.shtml));
  NMLS for mortgage origination ([SAFE Act](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/aboutNMLS/SitePages/SAFE.aspx));
  RBS/TABC alcohol service ([CA ABC](https://www.abc.ca.gov/education/rbs/));
  ETCP rigging ([ETCP](https://etcp.esta.org/certify/certify_rigger.html));
  safeguarding clearances with renewal clocks ([PA Act 153](https://www.cmu.edu/hr/resources/child-protection/act-153/index.html))).
  Expiry must auto-de-eligible; renewal lead-time alerts are part of staffing.
- **Named-capability presence** — someone holding a specific authority must be
  physically present: DEA-authorized key-holder when controlled substances are
  handled ([21 CFR 1301.75](https://www.ecfr.gov/current/title-21/chapter-II/part-1301/subject-group-ECFRa7ff8142033a7a2)),
  OSHA competent person on excavation days ([29 CFR 1926.651](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.651)),
  supervising dentist/vet on premises, studio teacher for child performers
  ([CA DIR](https://www.dir.ca.gov/dlse/MinorsSummaryCharts_HoursofWork.pdf)).
- **Minimum-N-together** — N people with specific authorizations simultaneously
  present: banking dual control ≥2 for vault events ([NCUA Examiner's Guide](https://publishedguides.ncua.gov/examiner/Content/ExaminersGuide/Credit%20Union%20Operations/InternalControls/ExamProcedures/Cash.htm)),
  two-person lifts, UL 827 operator minimums.
- **Pairing/ratio co-assignment** — apprentice:journeyman ratios set by state
  law (e.g., [OR plumbing OAR 918-695-0140](https://oregon.public.law/rules/oar_918-695-0140),
  [WA RCW 19.28.161](https://app.leg.wa.gov/rcw/default.aspx?cite=19.28.161));
  trainee groomers requiring a senior on shift.
- **Headcount-by-formula** — role counts computed from demand attributes:
  crowd managers ≥ ceil(occupancy/250) ([NFPA 101 guidance](https://www.nfpa.org/news-blogs-and-articles/blogs/2022/11/01/strategies-for-crowd-management-safety)),
  IATSE Yellow Card per-department local crew counts ([IATSE](https://iatse.net/wp-content/uploads/2021/06/yellowcardfaqs3.pdf)),
  awake staff per 15 residents ([22 CCR 87865.1](https://www.law.cornell.edu/regulations/california/22-CCR-87865.1)),
  catering server-per-guest ratios.

### 9.4 Time-shape and pay rules — the solver must cost schedules, not only validate them

Many scheduling "rules" are not feasibility constraints but **payable
premiums**: a feasible schedule can still be an expensive one, and §8.2's
objective decomposition must monetize these shapes.

**US fair-workweek laws** (1 state, 1 county, 9 cities as of 2026; retail,
food service, and hospitality dominate coverage, with Chicago/Berkeley/Evanston
extending to healthcare, warehouse, manufacturing, and building services):

| Jurisdiction | Notice | Rest gap | Distinctive parameters |
| --- | --- | --- | --- |
| Oregon (statewide) | 14 d | 10 h | Good-faith estimate at hire; voluntary standby list; 500+ employees ([BOLI](https://www.oregon.gov/boli/workers/pages/predictive-scheduling.aspx)) |
| Seattle | 14 d | 10 h @1.5× | Access-to-hours before external hire; 3-yr records ([OLS](https://www.seattle.gov/laborstandards/ordinances/secure-scheduling)) |
| NYC | 14 d (fast food); 72 h changes (retail) | 11 h, $100 premium | Retail on-call ban; just-cause for hour cuts >15% ([DCWP](https://www.nyc.gov/site/dca/businesses/fairworkweek-deductions-laws-employers.page)) |
| San Francisco | 14 d | — | Formula retail only; on-call unused shift pay 2–4 h; part-time parity ([SF.gov](https://www.sf.gov/information--formula-retail-employee-rights-ordinance)) |
| Chicago | 14 d | 10 h @1.25× | Covered-employee wage cap ($32.60/h from 2025-07-01); 7 industries ([BACP](https://www.chicago.gov/city/en/depts/bacp/supp_info/fairworkweek.html)) |
| Philadelphia | 14 d | 9 h, $40 flat | 250+ employees and 30+ locations |
| LA city + county (unincorp.), Emeryville, Berkeley, Evanston | 14 d | 10–11 h | Retail (LA) or multi-industry (Berkeley/Evanston); cancellation pay to 4 h ([GovDocs](https://www.govdocs.com/predictive-scheduling-laws-what-employers-need-to-know/)) |

**International analogs** widen the parameter space rather than repeating it:
EU Directive 2019/1152 (reference hours/days, right to refuse outside them,
late-cancellation compensation for on-demand workers —
[EUR-Lex](https://eur-lex.europa.eu/eli/dir/2019/1152/oj/eng)); UK Employment
Rights Act 2025 (shift-notice duty and cancellation payments from Oct 2026,
guaranteed-hours offers to zero/low-hours workers from 2027 —
[UK Gov factsheet](https://assets.publishing.service.gov.uk/media/67e429cf2621ba30ed9776d1/zero-hours-contracts.pdf));
Ireland's banded-hours regime (8 statutory bands after 12 months; zero-hours
contracts largely banned — [Citizens Information](https://www.citizensinformation.ie/en/employment/employment-rights-and-conditions/contracts-of-employment/zero-hours-contracts/));
Australian modern awards (roster-notice per award, ~3-h minimum engagements,
25% casual loading, penalty rates — [Fair Work framework](https://sprintlaw.com.au/articles/minimum-engagement-and-minimum-shift-hours-in-australia/));
Netherlands WAB (4-day call notice, 3-h minimum per call, fixed-hours offer
after 12 months — [business.gov.nl](https://business.gov.nl/regulations/on-call-employees/));
Germany §12 TzBfG (deemed 20 h/week when unset, 4-day notice, ±25/20% flex
bands — [gesetze-im-internet](https://www.gesetze-im-internet.de/tzbfg/__12.html)).

**Working-time and rest baselines**: EU WTD 2003/88/EC (11-h daily rest, 24+11-h
weekly rest, 48-h average cap with 4–12-month reference periods, 8-h night-work
average, individual opt-out flags — already in §6/§20); US state overlays such as
Illinois ODRISA one-day-rest-in-seven ([IDOL](https://labor.illinois.gov/laws-rules/fls/odrisa.html)),
California daily overtime/double-time, 7th-day rules, and meal/rest premiums
([Labor Code §510](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=510.),
[DIR](https://www.dir.ca.gov/dlse/faq_mealperiods.htm)); FLSA youth rules with
school-calendar toggles ([DOL FS#43](https://www.dol.gov/agencies/whd/fact-sheets/43-child-labor-non-agriculture));
the ACA 30-h/130-h full-time threshold with look-back measurement as
scheduling-visible state ([IRS Notice 2012-58](https://www.irs.gov/pub/irs-drop/n-12-58.pdf)).

**On-call and standby**: FLSA engaged-to-wait doctrine
([29 CFR 785.17](https://www.law.cornell.edu/cfr/text/29/785.17),
[DOL FS#22](https://www.dol.gov/agencies/whd/fact-sheets/22-flsa-hours-worked));
California reporting-time pay including telephonic call-in (*Ward v. Tilly's*,
[DIR](https://www.dir.ca.gov/dlse/faq_reportingtimepay.htm)); the CJEU
*Matzak/RJ/DJ* line under which sufficiently constrained home standby is working
time against WTD caps ([analysis](https://www.europeanpapers.eu/europeanforum/does-stand-time-count-working-time-court-justice-gives-guidance));
CBA call-out minimums of 2–4 h.

**Schedule-shape premiums**: split-shift premiums (CA), minimum-call guarantees
and recall minimums (stagehands — [IATSE Local 470 work rules](https://www.ia470.com/work-rules.htm)),
meal penalties per 30-minute increment past hour 6 (film —
[Media Services](https://www.mediaservices.com/blog/production-meal-penalties-iatses-new-rules/)),
turnaround premiums (10-h floor + 54-h weekend rest under the IATSE Basic
Agreement — [2024 MOA](https://iatse.net/wp-content/uploads/2024/07/2024-IATSE-Basic-Agreement-MOA-FINAL.pdf)),
kill fees, predictability pay.

**Overtime accounting is pluggable per employee group, not global**: FLSA
weekly-40; state daily-OT variants; the FLSA §207(k) declared work period for
police/fire (171 h/28 days law enforcement —
[DOL FS#8](https://www.dol.gov/agencies/whd/fact-sheets/8-flsa-police-firefighters));
CBA equalization ledgers; exempt professionals for whom "scheduling" is
allocation, not hour compliance ([DOL FS#17A](https://www.dol.gov/agencies/whd/fact-sheets/17a-overtime));
commissioned-employee §7(i) exemptions that scheduled hours can silently break
([DOL FS#20](https://www.dol.gov/agencies/whd/fact-sheets/20-flsa-commissions-retail)).

### 9.5 Workforce-mix and classification variables

The workforce is not a single employee pool. The model must represent, with
different scheduling authority over each: full/part-time employees; minors;
casual/zero-hours/min-max/annualized-hours contracts; agency temps
(co-employment aggregation); independent contractors; **booth renters** whose
chairs are capacity the organization does not command
([IRS Pub 4902](https://www.irs.gov/pub/irs-pdf/p4902.pdf)); freelancers whose
availability spans competing employers (hold → challenged → confirmed);
referral-hall labor (IATSE dispatch); locum/relief professionals; subcontractor
crews; H-2B seasonal workers whose lead time is measured in months
([American Immigration Council](https://www.americanimmigrationcouncil.org/report/h-2b-workers-united-states/));
and volunteers, for whom FLSA rules bar volunteering in commercial activities
or in a paid employee's own duties, and cap "nominal" stipends near 20% of
comparable wages ([DOL FS#14A](https://www.dol.gov/agencies/whd/fact-sheets/14a-flsa-non-profits),
[29 CFR 553.106](https://www.law.cornell.edu/cfr/text/29/553.106)).

Two design-defining consequences:

1. **The scheduler's interaction model is itself classification evidence.**
   Whether the platform *assigns* shifts or *offers them for claim*, and who
   controls substitutes, feeds the IRS common-law, DOL economic-reality, and
   ABC/AB5 tests ([CA LWDA](https://www.labor.ca.gov/employmentstatus/abctest/),
   [DOL](https://www.dol.gov/agencies/whd/flsa/misclassification)). The platform
   must support an offer/claim mode per workforce segment and refuse to
   force-assign contractor-mode workers or auto-schedule booth renters;
   misclassification enforcement in delivery work is active and expensive
   ([DOL $5.6M judgment](https://www.dol.gov/newsroom/releases/whd/whd20230112)).
2. **Capacity the organization does not command is still capacity.** Renters,
   freelancers, referral halls, and vendor pools need engagement/confirmation
   states and double-booking detection rather than utilization math.

### 9.6 Fairness, fatigue, and wellbeing variables

- **Contractual fairness**: seniority-based shift bidding on fixed cadences,
  overtime-equalization ledgers with make-whole remedies, vacation-pick order,
  holiday-rotation ledgers — grievance-backed obligations in unionized settings
  ([CBA clause families](https://www.myshyft.com/blog/union-contract-scheduling-compliance/)),
  retention levers elsewhere.
- **Fatigue science with usable parameters**: quick returns (<11 h between
  shifts) associate with insomnia, fatigue, and accidents
  ([SLEEP RCT](https://academic.oup.com/sleep/article/47/7/zsae086/7641764));
  12-h shifts carry ~25–38% higher injury risk than 8-h with risk rising across
  consecutive shifts ([meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC8504541/));
  IARC classifies night-shift work Group 2A ([IARC Vol. 124](https://www.iarc.who.int/news-events/iarc-monographs-volume-124-night-shift-work/));
  rota-design guidance converges on forward rotation, 2–3 (max 5) consecutive
  nights, ≥11-h gaps, ~48-h recovery after night blocks, 12-h caps
  ([HSE HSG256](https://safetyclarity.co.uk/resources/hse-guidance/hsg/hsg256));
  ANSI/API RP 755-style fatigue-risk-management adds work-set caps with logged,
  approved exceptions ([API](https://www.api.org/-/media/files/oil-and-natural-gas/refining/process%20safety/rp-755-fact-sheet.pdf)).
- **Quantified on-call norms**: Google SRE's ≥8 engineers per single-site 24/7
  rotation, ≤25% on-call time, ≤2 incidents per shift, and shadow-shift
  onboarding are exportable defaults for any rotation
  ([SRE Book](https://sre.google/sre-book/being-on-call/)); on-call burden
  measurably degrades wellbeing in veterinary practice too
  ([PMC study](https://pmc.ncbi.nlm.nih.gov/articles/PMC8578875/)).
- **Caseload caps distinct from hour caps** (counsellors ~22 client-facing
  hours/week — [guidance](https://headway.co/resources/client-caseload-full-time-therapists));
  role-scoped mandatory-overtime prohibitions (18 US states restrict mandatory
  nurse overtime — [NurseJournal](https://nursejournal.org/resources/mandatory-overtime-for-nurses/)).
- **Stability is an objective, not just a constraint**: the Shift Project links
  unstable schedules to worse sleep, distress, and turnover — with stability
  mattering more than wage level ([Shift Project](https://shift.hks.harvard.edu/consequences-of-routine-work-schedule-instability-for-worker-health-and-wellbeing/));
  the Gap stable-scheduling RCT raised sales ~7% and productivity ~5%
  ([Management Science](https://pubsonline.informs.org/doi/10.1287/mnsc.2021.4291)).
  Schedule churn already appears in §17's success metrics; these are its
  evidence base and default weights.

### 9.7 Reliability, disruption, and forecasting variables

- **Absence and no-show baselines**: BLS full-time absence rate 3.2% (4.3%
  healthcare support — [BLS](https://www.bls.gov/cps/cpsaat47.htm)); moving a
  shift to a new weekday or start time by >1 h produced 16% late/absent in a
  28M-timecard study; volunteer no-show runs ~15–30%
  ([VolunteerHub](https://volunteerhub.com/blog/when-volunteers-dont-show-up-the-real-cost-of-short-staffed-shifts))
  — coverage planning needs pool-level overbooking ratios.
- **Disruption lanes are part of the model, not exceptions**: holdover
  (post coverage), standby lists, float pools (multi-branch tellers), sub-boards
  with qualified-claim + approval (+ member notification in fitness, + legally
  ordered access-to-hours offers in covered retail), reserve capacity blocks
  (emergency trades, motor-club SLA zones) with on-call compensability
  implications, weather-day baselines (construction contracts measure delay
  against NOAA monthly norms — [analysis](https://www.mmmlaw.com/news-resources/riding-out-the-storm-how-to-best-account-for-weather-on-construction-projects/)),
  cancellation policies with minimum-call pay.
- **Forecast-to-requirement translation**: driver features (sales, traffic,
  weather, events, seasonality, school/fiscal calendars), labor standards per
  driver unit, interval granularity, and — for queue-shaped work — Erlang-C
  coverage with service-level targets, occupancy ceilings (~85–90%), and
  shrinkage factors ([Erlang-C guide](https://www.assembled.com/blog/how-to-use-erlang-c-to-plan-staffing)).
- **Horizon telescoping**: commitments are booked months out (events, builds,
  terms), firmed at 1–2 weeks (published schedules, look-aheads), executed at
  24–48 h (call sheets), with a zero-notice emergency lane — each horizon with
  different mutability and notification rules. Headcount planning (seasonal
  cohorts, H-2B lead times, tax-season hiring 4–6 months ahead) sits upstream
  of scheduling and should be a demand signal into hiring, not a staffing-domain
  fork.

### 9.8 Variable-family registry

The rule-engine parameter space distilled from the sweep. Each family is a
typed predicate/parameter template for `StaffingConstraintRule` (or an
objective term), with jurisdiction/industry/size applicability per §6.

| # | Family | Example parameterization | Example anchor |
| --- | --- | --- | --- |
| 1 | Applicability gates | industry list × global/local headcount × location count × wage cap | Chicago FWW |
| 2 | Advance schedule notice | 72 h – 14 d, per employee class | Oregon SB 828 |
| 3 | Predictability-pay schedule | premium by change type × notice tier × de-minimis | NYC $10–$75/change |
| 4 | Rest gap / clopening | 9/10/11 h + consent + premium type | Seattle 1.5×; NYC $100 |
| 5 | Daily rest minimum | 11 h per 24 h | EU WTD |
| 6 | Weekly rest / day-of-rest | 24+11 h per 7 d; 24 h per consecutive 7 d | EU WTD; IL ODRISA |
| 7 | Max average weekly hours | 48-h avg, 4–12-month reference, opt-out flag | EU WTD |
| 8 | Night-work limits | 8-h avg per 24 h + health surveillance | EU WTD; IARC 2A flag |
| 9 | Overtime thresholds | weekly 40; daily 8/12; 7th-day; double-time tiers | CA Labor Code §510 |
| 10 | Meal/rest break rules | trigger hour, duration, waivers, missed-break premium | CA IWC orders |
| 11 | Good-faith estimate | issuance + refresh triggers + contents | Seattle SMC 14.22 |
| 12 | Access-to-hours duty | internal offer window before external hire | SF FRERO |
| 13 | Reporting-time / show-up pay | half-shift min 2 h max 4 h; telephonic call-in counts | CA; *Ward v. Tilly's* |
| 14 | On-call compensability | response-window/tether/frequency test | 29 CFR 785.17; CJEU *Matzak* |
| 15 | Call-out minimum engagement | 2–4 h per call-in | CBAs; AU awards; NL/DE 3 h |
| 16 | On-call scheduling notice | ≥4 d call notice; reference hours/days + refusal right | NL WAB; DE §12 TzBfG; EU 2019/1152 |
| 17 | Guaranteed-hours ratchet | hour bands / average-hours offer after reference period | IE banded hours; UK ERA 2025 |
| 18 | Cancellation compensation | capped at lost-shift value; up to 4 h | UK ERA 2025; Emeryville |
| 19 | Minor work rules | age-band hour caps + clock windows + school toggle | FLSA/DOL FS#43 + state |
| 20 | Benefits-hour thresholds | 30 h/wk FT definition + look-back/stability periods | ACA / IRS |
| 21 | Fatigue soft constraints | consecutive nights, rotation direction, quick-return counter, recovery blocks | HSE HSG256; NIOSH |
| 22 | FRMS hours-of-service | work-set caps + exception logging/approval | API RP 755; FMCSA HOS |
| 23 | Seniority & bidding | bid cadence, ordering, bumping, vacation picks | CBAs |
| 24 | OT distribution/equalization | desired-OT lists, low-hours-first, equalization window | CBAs (APWU) |
| 25 | Premium/differential matrix | night/weekend/holiday differentials, casual loading, anti-pyramiding | AU awards; CBAs |
| 26 | Role-scoped mandatory-OT bans | prohibition + emergency exceptions + shift caps | 18-state nurse OT bans |
| 27 | Classification tests | exempt/non-exempt; IC tests as pluggable rule sets; volunteer bars | DOL/IRS/ABC; DOL FS#14A |
| 28 | Contract-type taxonomy | FT/PT, casual, min-max flex bands, annualized core+reserve, agency | NL, DE, UK, AU |
| 29 | Record-keeping & retention | schedule versions, consents, premiums, GFEs; 2–3 yr | Seattle 3 yr |
| 30 | Premium-waiver exceptions | acts of God, employee swap, standby list, no-show backfill | SF FRERO; Ontario ESA |
| 31 | Demand-to-requirement translation | drivers, labor standards, Erlang-C, occupancy ceiling, shrinkage | WFM practice |
| 32 | Swap/marketplace governance | eligibility, auto-approval compliance checks, approval chains | modern WFM products |

Families 1–20 and 23–30 are `StaffingConstraintRule` templates (hard, soft, or
cost-generating); 21–22 are fatigue scores plus sector hard caps; 31–32
parameterize demand generation and the repair/absence workflows in §15.4.

### 9.9 Model impact on §5

The catalog refines §5 without overturning it:

1. **`StaffingDemand` gains a demand-shape discriminator**
   (`coverage_floor | forecast_curve | fixed_slot | task_pipeline | census_load`)
   and support for formula-driven role counts (§9.3) and census→care-minutes
   conversion functions.
2. **Assignable units beyond the individual**: `StaffingAssignment`'s crew
   reference (§5.1.3) becomes a typed crew/composite-resource assembly, with
   co-scheduled resource links (vehicle, room, operatory, kit, equipment) so
   double-booking detection covers equipment and rooms, not only people.
3. **`StaffingConstraintRule` predicate registry** must include co-assignment/
   pairing-ratio, capability-presence, minimum-N-simultaneous,
   headcount-formula, rest-gap/turnaround-clock (propagating from prior wrap to
   earliest legal next call), schedule-shape premium (produces cost, not
   infeasibility), and per-employee-group overtime-regime selection (FLSA-40,
   daily-OT, §207(k) work periods, CBA, exempt-allocation).
4. **Engagement states for non-commanded capacity**: assignment lifecycle
   extends with offer/claim mode — `offered → claimed → confirmed → on_site` —
   as a first-class alternative to direct assignment for contractor-mode,
   renter, freelancer, and volunteer segments, both for correctness and because
   the interaction model is classification evidence (§9.5).
5. **Proposal scoring monetizes time-shape premiums** (predictability pay, meal
   penalties, minimum calls, split-shift, clopening premiums, non-billable
   overtime) as decomposed §8.2 cost components in currency units.
6. **Reliability without hidden scores**: overbooking and coverage buffers use
   pool-level no-show statistics by default. Per-person reliability scoring
   remains inside §2.2's non-goal boundary — it may exist only as an explicit,
   disclosed, organization-approved policy under §14.2 access rules and §14.3
   contestability, never as a hidden solver input.
7. **Per-horizon mutability policy** on top of §5.3's publication versioning:
   planning, committed, and execution horizons carry different change rules,
   notice obligations, and premium triggers.

## 10. Archetype and business-model staffing profiles

This section grounds the platform in the 21 `ArchetypeCategory` values and
builds on the demand–capacity matrix in
[`archetype-business-value-streams.md` §7](../../architecture/archetype-business-value-streams.md),
which characterizes booking/inventory levers; here we add the staffing side.
Starter constraint packs are **candidates** under §6 rule-pack governance:
each ships with source URLs, effective dates, a review owner, and test cases,
and the deploying organization validates them with qualified counsel.

### 10.1 Orientation matrix

| Category | Dominant staffing model | Demand shape(s) §9.1 | Assignable unit §9.2 | Defining overlays |
| --- | --- | --- | --- | --- |
| healthcare-wellness | Appointment-coverage rostering + on-call floor | fixed_slot + coverage_floor | individual + room/operatory | Licensure/supervision matrices, DEA custody, after-hours coverage duty, caseload caps |
| beauty-personal-care | Appointment rostering + walk-in overlay | fixed_slot + forecast_curve | individual (chair/station) | License scope, booth-renter capacity partition, §7(i) commission overtime, minors |
| pet-services | Census care + appointments + routes | census_load + fixed_slot + task_pipeline | individual/route | Boarding attendance & check-cadence regs, supervision ratios, lone-worker safety |
| trades-maintenance | Crew dispatch + emergency reserve | task_pipeline + coverage_floor | crew + truck | Apprentice ratios, EPA 608, competent person, prevailing wage, extreme seasonality |
| automotive-services | Solo tech+van dispatch + SLA queue | task_pipeline + coverage_floor | person+van composite | Jurisdiction-of-job licensing, EPA 609, DOT weight thresholds |
| moving-and-logistics | Crew+truck jobs and routes | task_pipeline | crew + truck | FMCSA HOS/CDL stack, misclassification enforcement, May–Sept surge |
| asset-rental | Function coverage + delivery runs | coverage_floor + task_pipeline | function slots | Forklift certification, driver pack, asset-turnaround feedback loop |
| food-hospitality | Forecast-driven stations + event call sheets | forecast_curve + task_pipeline | individual (station) | Fair-workweek laws, minors, tipped roles, alcohol certs, split shifts |
| retail-goods | Traffic floor coverage + warehouse shifts | forecast_curve + coverage_floor | individual (function) | Fair-workweek + access-to-hours, keyholder posts, minor-hazard rules, seasonal temps |
| fitness-recreation | Class slots over floor coverage | fixed_slot + forecast_curve | individual | Instructor classification, cert-gated posts, sub-board mechanics |
| education-training | Term-based recurring slots | fixed_slot | person + room/vehicle | Instructor licensing, safeguarding clearances, contractor autonomy |
| professional-services | Engagement allocation + on-call rotations | forecast_curve (allocation) + coverage_floor | individual / rotation | Exempt vs non-exempt split, conflicts walls, busy-season surge |
| software-platform | On-call rotations + support coverage | coverage_floor | rotation membership | SRE rotation norms, non-exempt compensability |
| nonprofit-community | Mixed paid+volunteer shifts, 24/7 residential | coverage_floor + census_load | individual + volunteer slots | FLSA volunteer rules, awake-overnight ratios, daily-care law, no-show overbooking |
| hoa-property-management | Work-order dispatch + on-call + turn season | task_pipeline + coverage_floor | individual + vendor pool | Habitability SLAs, vendor license/COI, portfolio load caps |
| banking-financial-services | Branch interval coverage + appointments | forecast_curve | individual + float pool | Dual control ≥2, NMLS gating, intraday granularity |
| public-sector | Rotating 24/7 plans + standby weeks | coverage_floor | rotation/squad | POST certification, §207(k) OT, CBA seniority bidding, must-serve floors |
| security-services | 24/7 post coverage + patrol tours | coverage_floor | individual (post) | Guard/armed credential matrix, no-unmanned-post, UL 827, turnover economics |
| real-estate-construction | Trade-task DAG over subcontractor crews | task_pipeline | external crews | Competent person, Davis-Bacon, inspection gates, weather baselines |
| media-production | Per-day call sheets, freelance crews | task_pipeline | person+kit, dept crews | Turnaround/meal-penalty grammar, child performers, pyro licensing |
| live-events-venues | Per-event calls (load-in/show/out) | task_pipeline + forecast_curve | department-scoped calls | Crowd-manager formula, Yellow Card counts, minimum calls, alcohol/rigging certs |

### 10.2 Appointment- and census-driven care services

**healthcare-wellness** (veterinary, dental, physiotherapy, counselling). The
appointment book is the demand signal; staffing demand derives per licensed-role
column (dentist + hygiene columns; vet + tech + reception), so a sick day
orphans a whole column rather than thinning a pool. The legality matrix is
task × license × supervision level × state: hygienist columns can run without
the dentist only in general-supervision/direct-access states
([ADHA](https://www.adha.org/wp-content/uploads/2023/03/ADHA_Direct_Access_Chart_2022-08-1.pdf));
vet-tech tasks tier by immediate/direct/indirect supervision
([AVMA MVPA](https://www.avma.org/sites/default/files/2021-01/model-veterinary-practice-act.pdf)).
Controlled substances require an authorized key-holder on site
([21 CFR 1301.75](https://www.ecfr.gov/current/title-21/chapter-II/part-1301/subject-group-ECFRa7ff8142033a7a2));
the VCPR duty makes after-hours coverage a daily resolvable fact
([AVMA](https://www.avma.org/KB/Resources/Reference/Pages/VCPR.aspx?mode=full)).
Relief/locum staffing is a first-class fallback (78% of clinics report hiring
difficulty; locums $800–$1,500+/day). Wellbeing constraints are evidence-backed:
~50% veterinary burnout, on-call ≥5 nights/month degrading wellbeing
([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8578875/)), counsellor caseload
caps ~22 client-hours/week. *Starter pack:* supervision gate; controlled-substance
custodian presence; every-day after-hours coverage resolution; clinician
face-time/caseload caps; on-call frequency bounds; (home-health extension) EVV
verifiability per visit ([Medicaid.gov](https://www.medicaid.gov/medicaid/home-community-based-services/home-community-based-services-guidance-additional-resources/electronic-visit-verification)).

**beauty-personal-care** (salon, barber, nails, spa, optician, personal
trainer). Appointment rostering with walk-in overlay and strong client→stylist
pinning; rebooking-at-checkout makes 4–8 weeks of demand partially visible.
The defining variable is the employee vs **booth renter** split: a true renter
sets their own hours, so their chair is capacity the platform must model but
never schedule ([IRS Pub 4902](https://www.irs.gov/pub/irs-pdf/p4902.pdf)).
Commission pay interacts with scheduling: FLSA §7(i) exemption breaks if
scheduled hours push the regular rate below 1.5× minimum wage
([DOL FS#20](https://www.dol.gov/agencies/whd/fact-sheets/20-flsa-commissions-retail)).
Opticianry is licensed in 22 states; personal training is certification-gated
(NCCA certs + CPR/AED) rather than licensed. *Starter pack:* license-scope
service gating; renter-autonomy guard (never auto-assign); §7(i) watchdog;
minor-hours rules; configurable 14-day publication norm; licensed-dispenser
coverage per open hour in licensed states.

**pet-services** (grooming, boarding, dog walking). Three models in one
category: grooming converts dog size/coat/temperament to groomer-minutes with
skill tiers; boarding is census-driven (animals × care-minutes per block,
holiday demand inversion, overnight attendance); walking is route work with an
extreme midday peak and travel-chain feasibility. Boarding attendance is
regulated where regimes exist: UK licensing requires at-least-daily documented
checks by competent staff ([DEFRA statutory guidance](https://www.gov.uk/government/publications/animal-activities-licensing-guidance-for-local-authorities/dog-kennel-boarding-licensing-statutory-guidance-for-local-authorities));
Colorado PACFA caps co-housed dogs per area unless constantly supervised
([PACFA](https://ag.colorado.gov/animal-welfare/pet-animal-care-and-facilities-act)).
No US state licenses groomers — competence is an internal skill-tier model.
*Starter pack:* check-round cadence as hard periodic tasks; group-supervision
ratios; census-derived minimum staff-hours per block; skill-tier gates with a
senior on shift for trainees; route/travel-chain feasibility with walker
continuity; always-on vet-access coverage.

### 10.3 Forecast-driven consumer operations

**food-hospitality** (restaurant, catering, bakery). Sales-forecast-driven
scheduling against labor-percentage targets (25–35%; NRA medians 36.5%
full-service/31.7% limited-service) layered over station coverage (line
stations, FOH posts); catering adds per-event call sheets from guest-count
ratios; bakeries run a decoupled pre-dawn production shift. This category takes
the heaviest fair-workweek exposure (§9.4), plus minors with school-calendar
windows, tipped-role assignment consequences (tip-credit/tip-pool eligibility
follows the role — [DOL FS#15](https://www.dol.gov/agencies/whd/fact-sheets/15-tipped-employees-flsa)),
alcohol-service certification gates ([CA RBS](https://www.abc.ca.gov/education/rbs/)),
split-shift premiums, and reporting-time pay. *Starter pack:* clopening rest
gap; 14-day publication with post-publish edit premiums; minor windows;
cert-gated alcohol posts; split-shift premium accrual; scheduled labor ≤ target
% of forecast per daypart.

**retail-goods** (shop, artisan, florist, wholesale/warehouse). Foot-traffic
coverage with a step-function floor — a shop never drops below a keyholder even
at zero traffic; artisan production hours flex to fill troughs; florists staff
holiday spikes with temps; warehouses run shift patterns with Q4 headcount
+15–20% planned 8–12 weeks out. Retail is the second fair-workweek pillar, and
uniquely carries **access-to-hours** duties (offer open shifts internally
before hiring — [Seattle OLS](https://www.seattle.gov/laborstandards/ordinances/secure-scheduling),
[SF FRERO](https://www.sf.gov/information--formula-retail-employee-rights-ordinance))
and NYC's retail on-call ban. Minors are barred from forklifts/hazardous
orders. *Starter pack:* keyholder open/close posts; access-to-hours ordering
before external hire; on-call-window bans where applicable; minor-hazard
exclusions; reporting-time-pay guard; seasonal ramp lead-time locks.

**fitness-recreation** (gym, yoga, sports club). Two layers: the published
class calendar is fixed, named demand (instructor × format qualification);
floor/desk staffing follows bimodal traffic. Substitution runs through
sub-boards — qualified instructors claim open classes with owner approval and
member notification — and instructor continuity is a member-facing product
attribute. The defining legal issue is instructor classification: under the
ABC test an instructor teaching the studio's core service is presumptively an
employee ([CA LWDA](https://www.labor.ca.gov/employmentstatus/abctest/)), and
whether the platform assigns or offers classes is itself evidence. Lifeguard
and CPR/AED certifications hard-gate aquatic posts with expiry
([Red Cross](https://www.redcross.org/take-a-class/lifeguarding/lifeguard-training/lifeguard-certification)).
*Starter pack:* format-qualification matrix; cert-expiry auto-unassignment;
incumbent-instructor continuity preference with member notification on subs;
split-shift premium accrual; IC-mode claim-based offers; minor desk/camp hour
windows.

### 10.4 Field dispatch and mobile crews

**trades-maintenance** (plumber, electrician, HVAC, landscaping, cleaning).
Dispatch units of 1–2 techs, larger install crews, route-based recurring work
(landscaping/cleaning), and a rotating emergency reserve. Seasonality is
extreme (HVAC call volume swings ~340% spring→summer; landscaping is the
largest H-2B user, making crew capacity visa-constrained with months of lead
time). Hard legal shapes: state apprentice:journeyman ratios as co-assignment
rules; EPA 608 for refrigerant tasks; OSHA competent person for excavation
days; prevailing-wage classification + weekly certified payroll on public work
([DOL WH-347](https://www.dol.gov/agencies/whd/forms/wh347)); FLSA on-call
compensability for tight response windows. *Starter pack:* apprentice pairing
ratios (state-parameterized); 608-certified tech on refrigerant jobs;
competent-person coverage on excavation; prevailing-wage flagging; compensable
on-call accrual rules.

**automotive-services** (auto glass, mobile mechanic/detailing/tire, roadside,
locksmith). The tech and the equipped van are one composite assignable unit —
equipment fit gates eligibility as much as skill. Demand is weather- and
incident-driven with motor-club SLA queues, so reserve capacity per zone is a
schedulable object. Regulatory gates are jurisdiction-of-job (locksmith
licensing in ~13–15 states), EPA 609 for MVAC work, and the DOT weight
switchboard: ≥10,001 lbs GVWR triggers FMCSR/HOS/medical cards; ≥26,001 lbs
triggers CDL plus the 50%/10% random testing pool
([FMCSA](https://www.fmcsa.dot.gov/regulations/hours-service/summary-hours-service-regulations)).
*Starter pack:* state-of-job license gating; EPA 609 gating; CDL/medical/testing-pool
gates by vehicle class; per-zone SLA reserve blocks; on-call rotation bounds
with compensability flags.

**moving-and-logistics** (moving, junk removal, courier, last-mile). Crew +
truck is the atomic unit; ~60%+ of US moves land May–September, staffed by a
small core plus temp/day-labor cohorts. The category is the misclassification
enforcement epicenter (DOL judgments against delivery-driver 1099 models), and
carries the full FMCSA stack: HOS 11/14/10-hour rules with 60/70-hour rolling
caps as a depletable per-driver resource, the 150-air-mile short-haul exemption
(which still demands accurate time records), CDL thresholds, and deliberate
25,999-lb truck specs. *Starter pack:* HOS-feasible driver-days; short-haul
geofence adherence; CDL + medical-card gates; two-person lift minimums; 1099
scheduling-control guardrails.

**asset-rental** (equipment hire, self-storage). Coverage-based: counter,
yard, shop, and delivery functions must be staffed through open hours by a tiny
interlocking team where one absence breaks a function; cross-training is the
resilience variable. A distinctive feedback loop couples staffing to revenue:
every returned unit consumes shop-hours before it is rentable again, so
rentable fleet on day D is a function of scheduled turnaround labor.
Self-storage runs thin/hybrid coverage (one manager across sites, remote
models). *Starter pack:* function-coverage minimums via cross-training
substitution matrix; OSHA forklift certification for yard tasks; the full
driver pack on delivery runs; turnaround-queue capacity feedback;
multi-site manager non-overlap with travel time.

### 10.5 Coverage-floor and credentialed institutions

**security-services** (guard/patrol, alarm+monitoring). Contracted post-hours
are fixed demand; the cardinal rule is that a post is never unmanned, so the
problem is credential-feasible fill under brutal turnover (~51% annual industry
average; 100–300% at contract sites) and overtime economics where ~85% of
contracts cannot bill OT. Credentials form a post × time × qualification matrix
(guard registration, armed endorsement with requalification and psychological
assessment, site clearances) with expiry-driven de-eligibility. Monitoring adds
UL 827 operator minimums. *Starter pack:* no-unmanned-post hard rule; armed-post
credential gates; expiry-driven assignment blocks; non-billable-OT minimization;
holdover caps with standby-list preference; UL 827 operator floors.

**public-sector** (small municipality, municipal utility, small police
department). Statutory must-serve floors met by rotating plans (Pitman/2-2-3,
4-on-4-off, 12-hour plans dominate); 46% of US local police departments have
fewer than 10 sworn officers, so one absence breaks minimum coverage
([BJS](https://bjs.ojp.gov/library/publications/local-police-departments-personnel-2020)).
Overtime computes against declared FLSA §207(k) work periods, not the 40-hour
week; CBA seniority bidding and OT-equalization ledgers are grievance-backed;
utilities add rotating standby weeks with callout minimums, standby pay, and
rest rules; storm work invokes OSHA extended-shift fatigue guidance. *Starter
pack:* per-shift minimum sworn/POST-certified floors; §207(k) work-period OT
accounting; seniority-bid honoring; standby-week rotation with post-callout
rest; squad weekend/OT fairness; emergency-shift fatigue caps.

**banking-financial-services** (community bank, credit union, mortgage). Branch
interval coverage at 30/60-minute granularity against forecastable traffic,
with an appointment layer. Two structural gates: **dual control** — ≥2
authorized employees for vault open/close and cash events, hardest on small
branches ([NCUA](https://publishedguides.ncua.gov/examiner/Content/ExaminersGuide/Credit%20Union%20Operations/InternalControls/ExamProcedures/Cash.htm))
— and NMLS licensing/registration gating who may take origination appointments,
per state with lapse dates. Float-pool tellers and cross-trained universal
bankers are the flexibility levers; teller turnover runs 20–30%. *Starter
pack:* dual-control pair feasibility at open/close/vault events; NMLS-gated
appointment assignment; interval minimum-coverage floors; forecast-matched
staffing with queue-SLA vs idle penalties; Saturday-rotation fairness; float
travel minimization.

### 10.6 Slot, allocation, rotation, and volunteer models

**education-training** (corporate training, tutoring, driving, music, dance).
The atomic unit is the recurring student–instructor slot over a term; demand
tracks the school calendar (exam-season peaks, September surges), and
continuity is the product. Rooms, pianos, and inspected dual-control vehicles
co-schedule with people. Instructor licensing (state driving-instructor
licenses) and safeguarding clearances with 60-month renewal clocks gate
assignability; heavy contractor use means the platform must respect declared
availability rather than force-assign. *Starter pack:* license/clearance
validity gates; vehicle co-reservation for behind-the-wheel sessions;
term-long continuity preference; contractor autonomy guard; exam-season
capacity expansion triggers.

**professional-services** (consulting, legal, agency, accounting; MSP). Two
regimes: engagement allocation for exempt professionals — utilization bands per
seniority (target 74–84%; juniors 78–88%, seniors 55–70%) as soft objectives,
bench management, conflict-of-interest walls constraining who staffs which
client — and genuinely shift-shaped MSP on-call (primary/secondary with
escalation, SLA-derived coverage). Accounting adds a deterministic seasonal
surge (55–70+ h/week Jan–Apr) warranting surge-calendar rules. For non-exempt
technicians, on-call responses are compensable hours counting toward overtime.
*Starter pack:* compensable on-call response logging; skill/stack-gated on-call
eligibility; primary+secondary coverage for P1 clients; utilization-band
objectives with sustained-overage alerts; rolling holiday/weekend on-call
fairness; busy-season consecutive-week caps with recovery weeks.

**software-platform** (small SaaS). Rotation membership is the schedulable
object. Google SRE norms give quantitative anchors: ≥8 engineers for a
single-site 24/7 rotation, ≤25% on-call time, ≤2 incidents/shift, shadow
shifts before solo duty, follow-the-sun handoffs inside both sites' business
hours ([SRE Book](https://sre.google/sre-book/being-on-call/)). Small teams
structurally violate these minima — rotation-size adequacy warnings are a
product feature, not an edge case; 62% of engineers report on-call burnout.
*Starter pack:* rotation-size warnings; per-person on-call share caps;
shadow-shift onboarding gates; handoff-hour placement; holiday-fairness ledger;
compensability logging for non-exempt support staff.

**nonprofit-community** (charity, rescue, shelters, co-op). A thin paid core
interleaved with a volunteer pool on slot signups, plus 24/7 residential
coverage and non-droppable daily-care duties (state law mandates daily animal
care; awake-overnight ratios like 1 staff : 15 residents apply in licensed
settings). The FLSA volunteer boundary is load-bearing: volunteers cannot fill
commercial-activity roles or a paid employee's duties, and per-shift stipends
approaching 20% of comparable wages manufacture employees
([DOL FS#14A](https://www.dol.gov/agencies/whd/fact-sheets/14a-flsa-non-profits)).
Supply and demand are both seasonal (kitten season Feb–Oct; ~30% of giving in
December with a January volunteer cliff). Volunteer no-show (~25%) makes
pool-level overbooking a core mechanic. *Starter pack:* daily-care coverage as
critical-alert demand; awake-overnight employee-only ratios; role-eligibility
walls between volunteers and paid duties; stipend-ceiling tracking; pool-level
overbooking by historical no-show; clearance-gated youth-contact roles.

### 10.7 Project, event, and contingent-crew models

**hoa-property-management**. Small managing core (portfolio caps of 4–12
associations per manager) orchestrating vendor pools; demand is a severity-
tiered work-order pipeline (habitability law creates de facto emergency SLAs —
~24-h emergency response in California-style regimes) plus the May–September
turn-season surge of multi-trade make-ready chains. Vendor eligibility = trade
license + current COI on the work-order date; EPA RRP applies to pre-1978
renovation. *Starter pack:* 24/7 emergency-responder coverage; SLA-clock
assignment escalation; vendor license/COI validity gates; make-ready
trade-sequence templates with surge triggers; manager portfolio load caps.

**real-estate-construction**. The builder schedules other companies' crews:
25–35 subcontractors per home, coordinated through trade-dependency DAGs,
municipal inspection gates, and the Last Planner-style 2–6-week look-ahead
where only constraint-free work enters the window
([LCI](https://leanconstruction.org/lean-topics/last-planner-system/)).
Weather is a contract object (day-for-day extensions measured against NOAA
monthly baselines). OSHA competent-person duties attach per activity;
Davis-Bacon prevailing wage and certified payroll attach on public work.
*Starter pack:* predecessor-trade + inspection gating; competent-person
presence on regulated activities; weather-threshold task blocking with
baseline-tracked delay days; wage-classification mapping on covered jobs;
equipment-specific operator certification; work-ready look-ahead discipline.

**media-production**. Per-day call sheets staffed from freelance pools booked
via deal memos and an informal hold/challenge system across competing
employers. The scheduling grammar is union-normed even off-union: 10-hour
minimum turnaround plus 54-hour weekend rest (IATSE Basic Agreement), meal
penalties accruing per 30 minutes past hour six, and the 12-hour-day fatigue
debate ("Brent's Rule"). Child performers constrain whole schedules (age-band
work-hour caps, clock windows, studio-teacher presence); pyro requires licensed
operators with permit lead times (NFPA 1126). *Starter pack:* per-person
turnaround-clock propagation (wrap → earliest legal call); meal-penalty cost
forecasting; weekend-rest protection; minor-day schedule derivation;
licensed-operator + permit gating; hold-aware double-booking guards.

**live-events-venues**. Per-event rosters built from a casual/referral pool:
load-in, show, and load-out calls with different headcounts; touring shows
arrive with Yellow Card per-department local-crew requirements. Cost rules are
time-shape penalties: 4–5-hour minimum calls, 2-hour recall minimums, meal by
hour five or premium accrual, 8-hour breaks defining day boundaries
([IATSE Local 470](https://www.ia470.com/work-rules.htm)). Life-safety and
service certifications gate roles: crowd managers ≥ ceil(occupancy/250)
(NFPA 101 regimes), state alcohol-server certification, ETCP riggers on flying
points, forklift/MEWP for load-ins. Venue turnaround between events shares one
crew pool and dock. *Starter pack:* crowd-manager formula per event;
cert-gated bar/rigging/equipment roles; Yellow Card department counts as
demand templates; minimum-call and recall cost rules; meal-window premium
accrual; cross-event crew/dock turnaround feasibility.

### 10.8 Cross-archetype findings

1. **The scheduled unit is rarely "a shift."** Five demand shapes (§9.1) and
   five assignable-unit shapes (§9.2) cover all 21 categories; a shift-grid
   model alone fits perhaps four of them. This validates §5's decision to make
   `StaffingDemand` a first-class aggregate rather than a calendar decoration,
   and drives the §9.9 discriminators.
2. **One credential/eligibility primitive serves every category** — expiring
   credentials, jurisdiction-of-job evaluation, supervision levels, clearances
   — confirming §14.1's reuse of existing license/credential authorities with a
   staffing-side eligibility projection.
3. **Presence, pairing, and N-together constraints are legal rules, not
   preferences**, and they are not expressible as per-person eligibility;
   the §9.9 predicate registry is the smallest closure that covers them.
4. **Externally-owned labor is first-class nearly everywhere**: booth renters,
   locums, freelancers, referral halls, vendor pools, subcontractor crews,
   volunteers. Confirmation-state modeling and assign-vs-offer modes are
   platform requirements, not vertical niceties — and they carry classification
   stakes.
5. **Time-shape costing is a solver requirement**: predictability pay, minimum
   calls, meal penalties, clopening premiums, split-shift premiums, and
   non-billable overtime mean §8.2's score decomposition must output currency,
   not just weighted points.
6. **Coverage floors and utilization targets are opposed objectives that
   coexist** inside single organizations (MSP day-billing vs night rotation;
   police minimums vs OT budgets; branch service levels vs idle cost).
7. **Headcount planning is upstream of scheduling** — seasonal cohorts, H-2B
   lead times, tax-season hiring, temp requisition locks — and should surface
   as demand signals toward hiring workflows rather than expanding this
   domain's scope.
8. **Implication for §18 decision 1 (golden workflow):** the research suggests
   the horizontal model is best proven by pairing one *coverage-floor*
   archetype (e.g., security-services post coverage — the strictest fill
   semantics), one *fixed-slot* archetype (e.g., a healthcare or beauty
   appointment book — supervision matrices and continuity pinning), and one
   *task-pipeline* archetype (e.g., trades field crews — composite units and
   pairing ratios). The §1 recommendation of "fixed shifts plus one field-crew
   case" remains valid; the sharper framing is to cover three of the five
   demand shapes in the first golden set. The choice remains the founder's.

## 11. AI Staffing Coworker authority progression

### Phase 1 — evidence and proposals

The coworker reads governed staffing facts, identifies missing inputs, prepares
demand, runs deterministic validation/optimization, compares options, explains
trade-offs, and creates an `AgentActionProposal`. It cannot publish or message
employees without explicit approval.

### Phase 2 — approved bounded actions

After verified usage, an authorized operator may delegate low-risk actions such
as refreshing a proposal when only demand changes, sending a draft confirmation,
or applying an explicitly approved assignment set. Delegation is scoped by
organization, location/team, action, time, and risk; every side effect remains
audited and reversible where possible.

### Phase 3 — narrow automation

Only repetitive, reversible, policy-complete cases may become auto-executable—for
example, filling an employee-requested swap that preserves every hard rule and
falls within a pre-approved policy. Adverse or consequential actions, policy
exceptions, leave decisions, schedule publication, material hour changes, and
emergency overrides remain human-authorized. Automation expansion is a governed
decision based on measured false-positive, correction, override, fairness, and
incident rates—not elapsed time.

## 12. Learning preferences safely

An explicit preference entered by the employee is authoritative for preference
purposes until it expires or is revoked. An inferred pattern is only a
`WorkforceCandidateFact`:

1. Require a minimum evidence count and confidence threshold.
2. Retain source references, extraction/model version, and inference time.
3. Present the proposed preference privately to the employee in plain language.
4. Let the employee confirm, edit, reject, pause learning, or delete it.
5. Promote only confirmed facts to `EmployeeSchedulingPreference`.
6. Apply expiry/decay and make correction propagate to future proposals.
7. Never infer sensitive reasons, protected attributes, health/accommodation
   details, union status, caregiving status, or religious observance.
8. Never learn an employee preference from a manager's override or from an
   assignment the employee merely tolerated.

The organization must disclose what is learned and why. A person can see their
preference evidence and change history. Coordinators see only scheduling effects,
not private source content.

## 13. Communications and calendar ingestion

Connectors should use provider-supported incremental/event mechanisms rather
than repeated mailbox scraping: Microsoft Graph change notifications and delta,
Gmail `watch` plus `history.list`, and Slack Events API. Notifications are
untrusted envelopes; fetch, validate, deduplicate, and process asynchronously
([Microsoft Graph change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview),
[Microsoft event delta](https://learn.microsoft.com/en-us/graph/delta-query-events),
[Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push),
[Slack Events API](https://api.slack.com/apis/connections/events-api)).

The time-off-intent flow is:

```text
provider event -> verified channel identity -> minimal source envelope
-> candidate fact (time-off-intent) -> employee confirmation/correction
-> LeaveRequest(pending) -> authorized approval
-> approved leave hard constraint -> impacted-schedule repair proposal
```

Store the minimum needed source: provider, tenant/account, immutable external ID,
sender/subject identity, received time, integrity metadata, bounded excerpt or
digest, extracted dates/timezone, confidence, and retention/expiry. Do not copy
whole mailboxes or channels. Enforce channel scopes, organization boundaries,
least privilege, quiet hours, deletion/retention, and replay protection.

External calendar events are free/busy or conflict evidence. iCalendar
([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html)), CalDAV
([RFC 4791](https://www.rfc-editor.org/rfc/rfc4791.html)), and CalDAV scheduling
([RFC 6638](https://www.rfc-editor.org/rfc/rfc6638.html)) define interchange;
they do not make a calendar event an employment assignment. Private event titles
must not be shown to coordinators when a busy mask is sufficient.

## 14. Credentials, privacy, fairness, and governance

### 14.1 Credentialing

Eligibility reads existing `PersonLicenseRecord`, credential, training, and policy
completion authorities. The coordinator sees “eligible”, “expired”, or “review
required” plus the governing requirement—not a medical or personal document.
Issuer, subject, validity, status/revocation, verification event, and provenance
must be retained. For future portable credentials, align the interchange adapter
with [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
rather than inventing a competing credential format; DPF's internal record remains
canonical until such an adapter is explicitly adopted.

### 14.2 Privacy and access

- Employee: own availability, preferences, candidate facts, assignments,
  acknowledgements, and correction history.
- Coordinator: staffing demand, coverage, minimum-necessary availability and
  eligibility outcomes for authorized teams/locations.
- Manager/approver: decisions within explicit reporting or delegated scope.
- HR/compliance: policy and exception detail under least privilege.
- Auditor: immutable evidence without operational write authority.
- Coworker/solver: purpose-limited read snapshot; no direct side effects.

Use field-level redaction, tenant and team/location scoping, purpose logging,
retention schedules, export/correction paths, and deny-by-default MCP/tool grants.
Sensitive inputs stay local by default and cannot egress to managed solvers
without informed organizational opt-in and a residency/data-processing review.

### 14.3 Employment AI boundary

NIST AI RMF organizes AI risk work around Govern, Map, Measure, and Manage and
calls for tracked privacy and fairness risks
([NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10),
[NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)).
The EU AI Act identifies employment and worker-management uses among areas that
can be high-risk and requires risk management, logging, transparency, and human
oversight where applicable
([Regulation (EU) 2024/1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689)).
U.S. anti-discrimination duties still apply when software or AI affects workers
([EEOC AI and Algorithmic Fairness Initiative](https://www.eeoc.gov/newsroom/eeoc-launches-initiative-artificial-intelligence-and-algorithmic-fairness)).

Therefore DPF must inventory each model/use, document intended purpose and
prohibited uses, test outcome disparities, monitor overrides and corrections,
provide meaningful explanations and contestability, retain decision evidence,
and keep consequential decisions under qualified human authority. “The solver
recommended it” is not a defensible rationale.

Worker fatigue is also a safety input, not merely a preference. Rule packs and
objectives should consider staffing levels, work hours, rest, night work, and
absence patterns using authoritative jurisdiction/industry guidance
([NIOSH Center for Work and Fatigue Research](https://www.cdc.gov/niosh/centers/fatigue.html),
[OSHA worker fatigue prevention](https://www.osha.gov/worker-fatigue/prevention)).

## 15. UX and information architecture

### 15.1 Canonical homes

Do not add another global navigation item or place staffing under
`/platform/schedule`. The canonical coordinator surface belongs in the existing
Business **People** domain, extending `/employee` with a **Staffing** section
(`?view=staffing` is consistent with the current flat `EmployeeTabNav`; a nested
route is acceptable if the later IA review finds the view too large). The
workspace calendar remains a read-oriented projection and deep-links back to the
staffing authority.

Role-specific entry points:

- **Coordinator/manager:** People → Staffing.
- **Employee:** People → My schedule / availability, scoped to self.
- **Approver:** existing attention inbox plus deep link to the relevant leave,
  exception, publication, or emergency-repair decision.
- **Workspace home:** at most an attention summary for coverage gaps or pending
  decisions, never a second staffing dashboard.

### 15.2 First viewport

The coordinator starts under time pressure. The first viewport must show a
date/planning window, team/location scope, coverage status, unscheduled demand,
hard conflicts, last-minute changes, and pending decisions. Primary actions are
“Prepare options”, “Compare”, and, for authorized humans, “Approve and publish”.
Avoid vanity metric tiles and solver vocabulary.

Comparison shows 2–4 options with coverage, unfilled work, hour/overtime impact,
preference/fairness effects, disruption from the current schedule, hard-rule
status, and explanation. Every color/state has text and icon alternatives; the
schedule must support keyboard operation, accessible tables/list views, locale,
and employee timezone context.

### 15.3 Employee experience

Employees can declare availability, request time off, state preferences, review
proposed/confirmed assignments, acknowledge or decline where policy permits,
correct candidate facts, understand why a change occurred, and reach a human.
The product must distinguish “available”, “preferred”, “requested leave”, and
“approved leave” visually and in text.

### 15.4 Last-minute change and repair

When leave, credential expiry, demand, or another hard fact changes:

1. Freeze/pin unaffected confirmed assignments.
2. Identify only impacted demand and assignments.
3. Produce repair options that minimize disruption before optimizing softer goals.
4. Explain displaced people, uncovered work, notification impact, and exceptions.
5. Require the appropriate approval before publication.
6. Notify only affected people and record delivery/acknowledgement.
7. Escalate if no feasible repair exists; never hide infeasibility by relaxing a
   hard rule.

An emergency override requires a named human, reason, scope, expiration, legal
waivability check, and post-event review.

## 16. Integration and coexistence contracts

### 16.1 External WFM authority mode

An organization with an incumbent WFM can designate it as assignment authority.
DPF mirrors versioned demand/assignments, adds governed explanations and
cross-domain context, and sends only explicitly approved commands through an
outbox. Conflict resolution is source-aware; DPF never claims a mirrored record
is native authority. Provider adapters map to the same canonical contract and
must not leak provider enums into the core model.

### 16.2 Specialized DPF domains

- Field dispatch owns jobs, routing, crews/resources, and field execution.
  Staffing supplies eligible people/crew coverage and receives demand/assignment
  links; neither duplicates the other.
- Care scheduling owns clinical appointments, participants, resources, and care
  invariants. Workforce staffing may cover a role or shift but does not replace a
  care appointment.
- Storefront booking owns customer availability and bookings. A provider booking
  may create staffing demand or consume published capacity through an adapter.
- Work queues/items own work execution state. They may originate demand but are
  not employee assignments by themselves.

## 17. Verification and acceptance model

The later implementation plan must define, at minimum:

1. **Domain invariants:** authority separation, optimistic concurrency, event
   history, timezones/DST, overlap, stale proposal rejection, idempotency.
2. **Constraint goldens:** U.S./EU examples, leave, credentials, rest, max hours,
   crew/skill/location coverage, unknown-policy fail-closed, waivable vs
   non-waivable exceptions; the §9.8 variable families and §10 starter packs
   are the golden-case source list — each shipped pack needs at least one
   passing and one violating fixture per rule.
3. **Solver parity:** deterministic fixtures, feasible/infeasible/unknown/timeout,
   objective decomposition, independent hard-rule validation after solve.
4. **Fairness and privacy:** access matrix, redaction, purpose logs, protected-data
   exclusion, disparity/override monitoring, correction/deletion and retention.
5. **Communications:** signature/auth validation, replay/duplicate/out-of-order
   events, identity ambiguity, confidence threshold, confirmation, provider loss,
   and data minimization.
6. **Human authority:** no publication, exception, leave decision, notification,
   or external write without a valid actor/delegation and evidence record.
7. **UX:** coordinator happy path, employee correction, approver boundary,
   no-feasible state, last-minute repair, accessibility, small viewport, and
   private-title non-disclosure.
8. **Deployment:** AMD64/ARM64, Windows/macOS/Linux contracts, offline/self-hosted
   solve, resource limits, upgrade/rollback, SBOM/license, and adapter failover.
9. **Live-install evidence:** governed nonproduction lease, canonical runtime,
   migration safety with existing data, and live happy-path verification.

Success metrics are coverage and unfilled demand, hard-violation count (must be
zero for published schedules), correction/override/decline rates, time to repair,
schedule churn, notification/acknowledgement outcomes, fairness diagnostics, and
employee-reported accuracy—not acceptance of the AI recommendation.

## 18. Founder decisions required before implementation planning

The architecture is resolved; these owning-scope choices are intentionally not
fabricated:

1. **Initial operating model:** which archetype/location should provide the first
   golden workflow—fixed shifts, field crews, appointment coverage, or on-call?
   Recommend fixed shifts plus one field-crew case to prove the horizontal model;
   §10.8 finding 8 sharpens this to covering three of the five §9.1 demand
   shapes (coverage floor, fixed slot, task pipeline) in the first golden set.
2. **Publication authority:** which existing role/capability is allowed to approve
   and publish an organization schedule, and may this be delegated by scope?
3. **Employee acknowledgement:** is acknowledgement informational by default, or
   can employees decline proposed assignments before publication?
4. **Incumbent authority posture:** should the first release support external WFM
   authority mode, or only preserve the adapter contract until a customer needs it?
5. **Jurisdiction starter packs:** which employing jurisdictions receive reviewed
   rule packs first? No reliable implementation can start until the first install's
   `employsIn` and work-location jurisdiction are populated. The §9.8 registry
   defines the parameter space a pack must fill; §10's per-archetype packs are
   the candidate contents.
6. **Solver packaging spike:** authorize evaluation of OR-Tools in a bounded
   self-hosted service versus self-hosted Timefold before dependency adoption.

These are business/product authority choices. They belong to the founder/operator,
not the DPF kernel or an external coding agent.

## 19. Exact backlog intake and planning readiness

No existing BI owns this capability. The next governed action should be to file:

| Field | Proposed exact value |
| --- | --- |
| Identifier | `BI-WORKFORCE-STAFFING-SCHEDULING` (proposed human-readable key; allow the live tool to issue the canonical ID) |
| Title | Organization workforce staffing and scheduling substrate |
| Type | `portfolio` |
| Work type | `feature` |
| Source | `user-request` |
| Priority | 2 |
| Size | `xlarge` |
| Description | Implement the canonical staffing demand/shift/assignment/availability/preference/constraint/proposal substrate, AI Staffing Coworker proposal flow, human approval boundaries, calendar/comms projections, and provider-neutral self-hosted solver adapter defined by this spec. Exclude payroll, performance scoring, and autonomous consequential employment decisions. |
| Spec | This document |
| Parent | Do not attach to `EP-SAP-PARITY`; during intake, query live epic overlap and create or choose a horizontal workforce-operations epic only if justified |
| Initial triage | Design complete; hold implementation planning until §18 decisions 1, 2, 5, and 6 are answered |

The item should then follow the normal BI → implementation plan → architecture/UX
review → Build Studio path. This design does **not** promote a build or contain an
implementation plan.

### Readiness verdict

**Conditionally ready for implementation planning.** Domain boundaries, authority,
architecture option, canonical concepts, policy hierarchy, solver boundary,
communications flow, privacy/fairness controls, UX home, and verification model
are resolved. Planning should pause only for founder decisions 1, 2, 5, and 6.
Decisions 3 and 4 can remain explicitly deferred if the first plan preserves the
contracts above.

## 20. Standards and references

- [ISO 30409:2016, Human resource management — Workforce planning](https://www.iso.org/standard/64150.html): scalable workforce-planning framework; confirmed current by ISO in 2022.
- [RFC 5545, Internet Calendaring and Scheduling Core Object Specification](https://www.rfc-editor.org/rfc/rfc5545.html); [RFC 4791, CalDAV](https://www.rfc-editor.org/rfc/rfc4791.html); [RFC 6638, CalDAV Scheduling](https://www.rfc-editor.org/rfc/rfc6638.html).
- [OR-Tools employee scheduling](https://developers.google.com/optimization/scheduling/employee_scheduling) and [CP-SAT](https://developers.google.com/optimization/cp/cp_solver).
- [Timefold employee-shift constraints](https://docs.timefold.ai/employee-shift-scheduling/latest/user-guide/constraints), [labor-law configuration](https://docs.timefold.ai/employee-shift-scheduling/latest/scenarios/configuring-labor-law-compliance), [demand-based scheduling](https://docs.timefold.ai/employee-shift-scheduling/latest/shift-service-constraints/demand-based-scheduling), and [planning window](https://docs.timefold.ai/employee-shift-scheduling/latest/user-guide/input-datasets/planning-window).
- [MiniZinc Handbook](https://docs.minizinc.dev/en/stable/).
- [U.S. Department of Labor overtime guidance](https://www.dol.gov/agencies/whd/overtime) and [EU Working Time Directive 2003/88/EC](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32003L0088).
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10), [EU AI Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689), and [EEOC AI initiative](https://www.eeoc.gov/newsroom/eeoc-launches-initiative-artificial-intelligence-and-algorithmic-fairness).
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/).
- [Microsoft Graph change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview), [event delta](https://learn.microsoft.com/en-us/graph/delta-query-events), [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push), and [Slack Events API](https://api.slack.com/apis/connections/events-api).
- [NIOSH Center for Work and Fatigue Research](https://www.cdc.gov/niosh/centers/fatigue.html) and [OSHA worker fatigue prevention](https://www.osha.gov/worker-fatigue/prevention).

Added by the 2026-07-17 archetype/variable research pass (§9–§10; per-claim
citations are inline in those sections):

- Fair scheduling and contract-hours law: [Oregon BOLI predictive scheduling](https://www.oregon.gov/boli/workers/pages/predictive-scheduling.aspx), [Seattle Secure Scheduling](https://www.seattle.gov/laborstandards/ordinances/secure-scheduling), [NYC Fair Workweek](https://www.nyc.gov/site/dca/businesses/fairworkweek-deductions-laws-employers.page), [SF Formula Retail Employee Rights](https://www.sf.gov/information--formula-retail-employee-rights-ordinance), [Chicago Fair Workweek](https://www.chicago.gov/city/en/depts/bacp/supp_info/fairworkweek.html), [EU Directive 2019/1152](https://eur-lex.europa.eu/eli/dir/2019/1152/oj/eng), [UK Employment Rights Act 2025 zero-hours factsheet](https://assets.publishing.service.gov.uk/media/67e429cf2621ba30ed9776d1/zero-hours-contracts.pdf), [Ireland banded hours](https://www.citizensinformation.ie/en/employment/employment-rights-and-conditions/contracts-of-employment/zero-hours-contracts/), [Netherlands on-call rules](https://business.gov.nl/regulations/on-call-employees/), [Germany §12 TzBfG](https://www.gesetze-im-internet.de/tzbfg/__12.html).
- US wage-hour mechanics: DOL Fact Sheets [#8 (§207(k))](https://www.dol.gov/agencies/whd/fact-sheets/8-flsa-police-firefighters), [#14A (volunteers)](https://www.dol.gov/agencies/whd/fact-sheets/14a-flsa-non-profits), [#15 (tipped)](https://www.dol.gov/agencies/whd/fact-sheets/15-tipped-employees-flsa), [#17A (exemptions)](https://www.dol.gov/agencies/whd/fact-sheets/17a-overtime), [#20 (§7(i))](https://www.dol.gov/agencies/whd/fact-sheets/20-flsa-commissions-retail), [#22 (hours worked/on-call)](https://www.dol.gov/agencies/whd/fact-sheets/22-flsa-hours-worked), [#43 (minors)](https://www.dol.gov/agencies/whd/fact-sheets/43-child-labor-non-agriculture), [#66 (Davis-Bacon)](https://www.dol.gov/agencies/whd/fact-sheets/66-dbra); [29 CFR 785.17 on-call](https://www.law.cornell.edu/cfr/text/29/785.17); [worker classification](https://www.dol.gov/agencies/whd/flsa/misclassification); [CA Labor Code §510](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=510.); [IL ODRISA](https://labor.illinois.gov/laws-rules/fls/odrisa.html); [ACA look-back (IRS Notice 2012-58)](https://www.irs.gov/pub/irs-drop/n-12-58.pdf).
- Sector hours-of-service and safety: [FMCSA HOS](https://www.fmcsa.dot.gov/regulations/hours-service/summary-hours-service-regulations), [FMCSA CDL](https://www.fmcsa.dot.gov/registration/commercial-drivers-license/drivers), [EPA Section 608](https://www.epa.gov/section608/section-608-technician-certification-requirements), [OSHA 1926.651 competent person](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.651), [OSHA 1910.178 powered industrial trucks](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178), [21 CFR 1301.75 controlled-substance custody](https://www.ecfr.gov/current/title-21/chapter-II/part-1301/subject-group-ECFRa7ff8142033a7a2), [NFPA 101 crowd management](https://www.nfpa.org/news-blogs-and-articles/blogs/2022/11/01/strategies-for-crowd-management-safety), [NCUA dual control](https://publishedguides.ncua.gov/examiner/Content/ExaminersGuide/Credit%20Union%20Operations/InternalControls/ExamProcedures/Cash.htm), [NMLS/SAFE Act](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/aboutNMLS/SitePages/SAFE.aspx).
- Fatigue and schedule-quality evidence: [IARC Monographs Vol. 124 (night shift work, Group 2A)](https://www.iarc.who.int/news-events/iarc-monographs-volume-124-night-shift-work/), [HSE HSG256 Managing Shift Work](https://safetyclarity.co.uk/resources/hse-guidance/hsg/hsg256), [ANSI/API RP 755](https://www.api.org/-/media/files/oil-and-natural-gas/refining/process%20safety/rp-755-fact-sheet.pdf), [Google SRE on-call chapter](https://sre.google/sre-book/being-on-call/), [Shift Project schedule-instability research](https://shift.hks.harvard.edu/consequences-of-routine-work-schedule-instability-for-worker-health-and-wellbeing/), [Gap stable-scheduling RCT (Management Science)](https://pubsonline.informs.org/doi/10.1287/mnsc.2021.4291), [BLS absence rates](https://www.bls.gov/cps/cpsaat47.htm).
- Union/industry scheduling grammars: [IATSE 2024 Basic Agreement MOA](https://iatse.net/wp-content/uploads/2024/07/2024-IATSE-Basic-Agreement-MOA-FINAL.pdf), [IATSE Yellow Card FAQ](https://iatse.net/wp-content/uploads/2021/06/yellowcardfaqs3.pdf), [IATSE Local 470 work rules](https://www.ia470.com/work-rules.htm), [Last Planner System](https://leanconstruction.org/lean-topics/last-planner-system/).

## 21. Architecture and UX review record

The 2026-07-17 design review applied the DPF architecture and UX-fit review
contracts after the main sweep to `70a8f3ee9`.

### 21.1 Architecture review

**Verdict: pass for design; conditional for implementation planning.**

- Authority is singular: staffing owns demand/shifts/assignments; leave,
  credentials, identity, vertical work, and calendar retain their own authority.
- New substrate is justified by the verified absence of staffing concepts and is
  bounded to nine logical aggregates; adjacent models are linked, not copied.
- The solver is isolated behind a provider-neutral, side-effect-free contract;
  deterministic validation and human governance remain in DPF.
- Jurisdiction, rule provenance, versioning, unknown-state handling, privacy,
  human authority, idempotency, concurrency, and audit invariants are explicit.
- Deployment and dependency adoption remain spikes because the current Node/Alpine
  runtime does not natively carry either candidate solver stack.
- The design does not silently absorb field dispatch, care scheduling, storefront
  bookings, work queues, external WFM, or platform-job scheduling.

No blocking architecture finding remains in the design. The four planning gates
named in §19 are owning-scope decisions, not hidden implementation assumptions.

### 21.2 UX-fit review

**Verdict: pass for design; live visual verification is intentionally deferred to
the later implementation.**

- Canonical home is Business → People → Staffing, not a new global destination,
  the workspace calendar, or the operator job schedule.
- The coordinator's first viewport centers coverage gaps, conflicts, changes, and
  pending decisions rather than a generic dashboard.
- Employee, coordinator, approver, auditor, coworker, and solver roles have
  distinct information and action boundaries.
- The critical flows include feasible comparison, infeasible explanation,
  employee correction, private-data redaction, publication approval, and
  last-minute repair.
- The UI requires accessible non-calendar alternatives, keyboard operation,
  textual state, locale/timezone clarity, and minimum-necessary explanations.
- The attention inbox and workspace home are entry points only, preventing a
  second competing work queue or staffing dashboard.

The later plan must include wireframes or an interactive prototype and live portal
verification before any UX claim can move from design intent to observed evidence.
