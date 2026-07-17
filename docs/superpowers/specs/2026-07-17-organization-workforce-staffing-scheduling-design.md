# Organization workforce staffing and scheduling — design

| Field | Value |
| --- | --- |
| Status | Design review complete; ready for a later implementation plan after the founder decisions in §16 |
| Date | 2026-07-17 |
| Scope | Organization-level workforce staffing and scheduling across industries and jurisdictions |
| Source | Founder `/goal` objective, 2026-07-17 |
| Decision record | `DI-C8BF6362B44C` (`principle_decide`; high confidence) |
| Proposed backlog item | `BI-WORKFORCE-STAFFING-SCHEDULING` (not yet filed; exact intake in §17) |
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
constraint packs; they do not fork the platform data model.

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

## 9. AI Staffing Coworker authority progression

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

## 10. Learning preferences safely

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

## 11. Communications and calendar ingestion

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

## 12. Credentials, privacy, fairness, and governance

### 12.1 Credentialing

Eligibility reads existing `PersonLicenseRecord`, credential, training, and policy
completion authorities. The coordinator sees “eligible”, “expired”, or “review
required” plus the governing requirement—not a medical or personal document.
Issuer, subject, validity, status/revocation, verification event, and provenance
must be retained. For future portable credentials, align the interchange adapter
with [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
rather than inventing a competing credential format; DPF's internal record remains
canonical until such an adapter is explicitly adopted.

### 12.2 Privacy and access

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

### 12.3 Employment AI boundary

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

## 13. UX and information architecture

### 13.1 Canonical homes

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

### 13.2 First viewport

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

### 13.3 Employee experience

Employees can declare availability, request time off, state preferences, review
proposed/confirmed assignments, acknowledge or decline where policy permits,
correct candidate facts, understand why a change occurred, and reach a human.
The product must distinguish “available”, “preferred”, “requested leave”, and
“approved leave” visually and in text.

### 13.4 Last-minute change and repair

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

## 14. Integration and coexistence contracts

### 14.1 External WFM authority mode

An organization with an incumbent WFM can designate it as assignment authority.
DPF mirrors versioned demand/assignments, adds governed explanations and
cross-domain context, and sends only explicitly approved commands through an
outbox. Conflict resolution is source-aware; DPF never claims a mirrored record
is native authority. Provider adapters map to the same canonical contract and
must not leak provider enums into the core model.

### 14.2 Specialized DPF domains

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

## 15. Verification and acceptance model

The later implementation plan must define, at minimum:

1. **Domain invariants:** authority separation, optimistic concurrency, event
   history, timezones/DST, overlap, stale proposal rejection, idempotency.
2. **Constraint goldens:** U.S./EU examples, leave, credentials, rest, max hours,
   crew/skill/location coverage, unknown-policy fail-closed, waivable vs
   non-waivable exceptions.
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

## 16. Founder decisions required before implementation planning

The architecture is resolved; these owning-scope choices are intentionally not
fabricated:

1. **Initial operating model:** which archetype/location should provide the first
   golden workflow—fixed shifts, field crews, appointment coverage, or on-call?
   Recommend fixed shifts plus one field-crew case to prove the horizontal model.
2. **Publication authority:** which existing role/capability is allowed to approve
   and publish an organization schedule, and may this be delegated by scope?
3. **Employee acknowledgement:** is acknowledgement informational by default, or
   can employees decline proposed assignments before publication?
4. **Incumbent authority posture:** should the first release support external WFM
   authority mode, or only preserve the adapter contract until a customer needs it?
5. **Jurisdiction starter packs:** which employing jurisdictions receive reviewed
   rule packs first? No reliable implementation can start until the first install's
   `employsIn` and work-location jurisdiction are populated.
6. **Solver packaging spike:** authorize evaluation of OR-Tools in a bounded
   self-hosted service versus self-hosted Timefold before dependency adoption.

These are business/product authority choices. They belong to the founder/operator,
not the DPF kernel or an external coding agent.

## 17. Exact backlog intake and planning readiness

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
| Initial triage | Design complete; hold implementation planning until §16 decisions 1, 2, 5, and 6 are answered |

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

## 18. Standards and references

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

## 19. Architecture and UX review record

The 2026-07-17 design review applied the DPF architecture and UX-fit review
contracts after the main sweep to `70a8f3ee9`.

### 19.1 Architecture review

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
named in §17 are owning-scope decisions, not hidden implementation assumptions.

### 19.2 UX-fit review

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
