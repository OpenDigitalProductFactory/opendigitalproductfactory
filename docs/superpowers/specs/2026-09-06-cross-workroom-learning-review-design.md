---
status: draft
date: 2026-09-06
backlog_item: BI-IMP-9DA35549
workroom: WC-4CF7C38C
decision_scope: wwmd
---

# Cross-workroom review and learning: common contract and archetype profiles

## 1. Outcome and scope

Run a recurring, evidence-based review across workrooms to find failures, successful techniques,
avoidable gate friction, recovery gaps and repeated user interventions. Apply confirmed lessons at
the narrowest correct scope and verify their effect on subsequent comparable work.

The platform preserves the evidence and review continuity. A replaceable reviewer performs the
analysis, initially as an external task and later, where qualified, as an existing platform
coworker. The reviewer is itself accountable through a standing Workroom and finite review cycles.
Its conversation is a working surface, never the only copy of its cursor, findings or decisions.

This extends the [continuous-improvement flywheel](2026-04-05-continuous-improvement-flywheel-design.md)
and [PAAW competence-evolution profile](2026-08-30-paaw-competence-evolution-workroom-design.md).
It does not replace the [Process Overseer](2026-09-01-workroom-process-overseer-design.md).
The Overseer checks one room's conformance; this activity compares many rooms, finds trends and
routes improvements. Neither may certify the effectiveness of its own change.

Design only: this document does not activate a schedule, appoint a principal, authorize repairs,
publish standards, or claim that automatic recovery is implemented.

## 2. Baseline and current owners

The 6 September audits recorded 388 persisted Workrooms, 33 working rooms with terminal build
attempts, 135 stalled child TaskRuns, 46 absent paths among 240 recorded workspace paths and eight
dirty checkouts. The 33 obsolete attempts were reconciled; a subsequent recovering task reconciled
12 rooms associated with done backlog items and resumed an observation cycle. Historical counts
are scoped snapshots, not current fleet totals or proof of source loss.

The earlier 24-hour sample had 8,022 ToolExecution records, all without skillId and 6,317 without
threadId. There were 162 ImprovementProposals without verifiedAt. Null attribution is a coverage
finding; whether each field was applicable must be assessed. A 5,000-call report cap also exists.
Do not use that capped sample as the platform-wide success rate.

Canonical evidence: WC-6D62FA49 and WC-91694EF2. Existing work owners:

| Concern | Reuse |
| --- | --- |
| Cross-room capture, review and verified application | BI-IMP-9DA35549 |
| Competence evolution and standards publication | BI-41460872; BI-636638A6; reference proposal IP-953EE |
| Flow-efficiency program and report coverage | BI-7C1F43E3; BI-4BB68EB6 |
| Execution reliability and review/receipt recovery | BI-06AE6833; BI-31159978 |
| Per-room process conformance | BI-3913EB49 |

Re-read these items before implementation. Their status is not evidence that their promised
behavior is installed or effective. The development-install observations do not establish
archetype business conformance or authorize mutation of the paired installation.

## 3. Existing workroom context

The source baseline for this design is 95fd331a65d. Resolve later changes at implementation.

- `apps/web/lib/work-management/source-registry.ts` owns source definitions and versions:
  task-node, backlog-item, work-capsule, approval, manual-task, scheduled work, bookkeeping-period,
  engagement, opportunity, booking/storefront-booking, activity, coworker-engagement,
  worker-onboarding/change/offboarding/classification-review, referral-intake and field-service-job.
  Aliases must resolve to one canonical occurrence before counting.
- `room-types.ts` and the source registry distinguish finite rooms and standing rooms/cycles.
  Definition coverage and occurrence performance are separate populations.
- `work-shapes.ts` owns activity triggers, stages, grants, measures, budgets and stop conditions.
  `delivery-shapes.ts` supplies the five delivery sizes; standing and coworker shape sets supply
  operations such as obligation assurance, estate conformance, security triage and service dispatch.
- `room-shapes.ts` owns collaboration: specialist-alignment, approval-sign-off, outward-review,
  change-consequential, escalation and craft-stewardship. Collaboration and activity shapes are
  independent of archetype, duration and delivery size.
- `room-cycle-store.ts`, `room-cycle-adapter.ts` and `outcome-packet.ts` carry cycle continuity
  and outcome references. Raw chat cannot satisfy canonical decision/artifact/evidence fields.
- `ImprovementSignal` owns signal identity, recurrence and evidence; `ImprovementProposal` owns
  review, backlog linkage and verification. Backlog owns delivery. No second findings backlog.
- The [profile catalog](../../architecture/four-portfolio-archetype-standard-profile-catalog.md)
  owns core + facets + category + leaf + organization/jurisdiction/contract/deployment composition.
  Its 25-category/107-leaf count is explicitly dated; resolve the live registry for every review.

A registered definition with no occurrences is **not exercised**, not healthy and not broken.
An older room with unresolved shape is **unclassified**; review observable facts without inventing
its missing obligations. Do not assign development gates to generic business rooms.

## 4. Architecture decision and Research & Benchmarking

| Option | Strength | Limitation | Disposition |
| --- | --- | --- | --- |
| External task with private memory | Fast initial analysis | Loses continuity with the client; weak reproducibility | Reject as authority |
| All analysis embedded in runtime immediately | Native scheduling and control | Couples evolving judgment to releases and expands initial implementation | Defer as the only executor |
| Durable common contract, replaceable reviewer | Server continuity with independent cross-room analysis | Needs explicit evidence/profile contracts and qualification | Recommended; follows user direction |

The kernel call returned **no usable recommendation** because options lacked scoreable features;
it did not ratify an option. The recommendation follows the user's accepted hybrid direction and
the existing client-independent platform contract. Formal design review remains outstanding.

| Primary reference, consulted 2026-09-06 | Adopt | Reject / limit |
| --- | --- | --- |
| [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) | Correlate events across execution boundaries; identify instrumentation/profile versions | Trace headers are not authorization or proof of completed business work |
| [Temporal Events and Event History](https://docs.temporal.io/workflow-execution/event) | Durable event history and bounded execution histories support recovery | Do not install a second workflow engine or claim exactly-once side effects from logging |
| [MLflow production-trace evaluation](https://mlflow.org/docs/latest/genai/eval-monitor/running-evaluation/traces/) | Evaluate explicit trace populations with reusable evaluators and filters | Do not introduce a competing evidence store; a selected trace sample is not the whole population |

These open-source implementations inform mechanisms. DPF retains its existing contracts,
scheduler, receipts and evidence authorities.

## 5. Common default and scoped extensions

Every eligible room receives the common review contract. It covers identity, objective, owner,
shape/version, actual progress, evidence, dependency waits, authorization, resource consumption,
interruptions, recovery, user corrections and outcome. It does not require a new conversational
question or approval on each turn.

An effective profile is composed as:

```text
common review contract
  + source-definition and activity/collaboration-shape obligations
  + reusable business facets
  + category baseline
  + genuine leaf delta
  + organization / jurisdiction / contract / deployment constraints
  = versioned effective review profile for this occurrence
```

Requirements accumulate by stable requirement reference. More specific profiles may add evidence,
specialist assessment or stricter limits. They cannot silently remove a common evidence or authority
requirement. Authorized exceptions carry reason, owner, applicability, expiry/review trigger and
the controlling standard reference. Conflicting overlays produce an explicit unresolved-profile
finding; last-write-wins is forbidden.

Profile references and resolution provenance belong with the existing definition/work-shape
contract. Implement a typed extension there and in the existing catalog projection; do not create
a separate archetype registry. Each cycle freezes the effective versions/hash. A later profile
change starts a new cohort; historical observations retain their original requirements.

Each extension declares: applicability predicate; added outcomes and evidence; denominator and
exclusions; freshness/cadence; domain-critical failures; specialist/assessor eligibility; prohibited
actions; retention/access constraints; sample fixtures; inheritance rationale and promotion scope.
Display existing catalog applicability states, including specialized-profile-required. Unknown
applicability is not not-applicable.

### 5.1 Application to current room families

| Family | Common review focus | Additional checks | Never infer |
| --- | --- | --- | --- |
| Development delivery | Wait, retries, corrections, recovery, accepted outcome | Exact repo/SHA/runtime, dirty artifacts, review receipts, declared delivery-size gates | A merged PR proves installed acceptance |
| Approval / governance | Decision age, missing input, authority and owner | Correct independent approver, applicable evidence and actual authorization | Faster approval is always better |
| Scheduled / standing operations | Due cycles, missed triggers, carry-over and evidence freshness | Declared cadence/deadline, cycle stop conditions and bounded grants | A legitimately waiting room is stalled |
| Bookkeeping period | Source completeness, unresolved items, period closure | Reconciliation evidence, adjustments, required sign-off | Code tests or a closed task prove the books reconcile |
| Engagement / booking / field-service | Promise, handoff, fulfillment and rework | Capacity/skill/fit, accepted scope, service evidence | Booking created means service delivered |
| Worker lifecycle / referrals | Prerequisites, handoffs and outstanding obligations | Provisioning/revocation receipts, classification authority, vesting evidence | Room closed means access revoked or payment authorized |
| Coworker / security / estate work | Evidence quality, response time and recovery | Current grants/qualification, approved containment or accepted drift | The analyst can widen privileges or change controls |

### 5.2 Archetype examples and qualification limits

These are proposed review profiles grounded in current catalog/operating-model references.
They are not claims that specialized workrooms or adapters are already deployed.

| Profile | Domain extension | Denominator and outcome safeguard |
| --- | --- | --- |
| Common/default | Core checks, declared source/shape obligations and applicable facets | Eligible occurrences/cycles, including unsuccessful and interrupted work |
| Pet rescue / animal shelter | Intake and custody continuity, suitable kennel/foster capacity, welfare handoff, veterinary escalation and adoption evidence | Relevant intake/custody transitions; never reward throughput that worsens welfare or bypasses capacity |
| Campground | Site/rig fit, reservation conflicts, occupancy episode, seasonal versus overnight work, maintenance and meter evidence | Relevant bookings/site assignments; distinguish empty capacity from suitable capacity |
| Agriculture-ranching | Seasonal planning, field/herd/equipment context, weather freshness, input trace and human/veterinary authority | Comparable seasonal work and hazard windows; seven quiet days do not prove seasonal effectiveness |
| Field-service facets | Skill/location/parts fit, travel/arrival, inspection and customer acceptance | Comparable dispatched jobs, with license/safety requirements retained |
| Financial / clinical / public-authority facets | Protected evidence and independently qualified domain assessment | Domain-specific critical failures; aggregate speed or success cannot offset them |

Sources: [pet-rescue operating model](../../architecture/archetypes/pet-rescue-operating-model.md),
[campground operating model](../../architecture/archetypes/campground-operating-model.md), and the
[profile catalog](../../architecture/four-portfolio-archetype-standard-profile-catalog.md).
Common findings may transfer across these profiles only after checking applicability and negative
transfer. A shared missing-receipt defect can be platform-wide; a kennel-fit rule remains a domain
delta unless a shared resource-fit abstraction is demonstrated.

## 6. Recurring review Workroom

Use a standing improvement Workroom with an explicit accountable Principal, one coordinator,
qualified analyst and independent assessor. Reuse existing principal/participant identities; do
not create a new agent class. The analyst can be an external task or an eligible existing coworker.

A proposed activity-shape registration, `cross-workroom-learning-review@1.0.0`, extends the existing
registry. It is not yet a valid deployed shape key. Its absence from the inspected shape sets is
why registration is a design change, not something this task silently claims.

| Stage | Owner | Durable result / advancement |
| --- | --- | --- |
| Select evidence | Coordinator and read adapter | Scope, high-water mark, exclusions, versioned population manifest |
| Assess coverage and anomalies | Analyst | Coverage findings and fact-grounded candidates; no mutation of target rooms |
| Compare and challenge | Independent assessor | Denominators, counterexamples, competing causes and confidence |
| Route and prioritize | Accountable owner under applicable scope | Existing signal/proposal/backlog links; governed decisions where consequential |
| Observe applied change | Assessor | Exact deployed version, comparable outcomes, regression/benefit/inconclusive verdict |
| Close cycle / carry forward | Coordinator | Cursor, pending findings, next trigger and complete Outcome Packet |

Routine evidence processing advances by status. Promotion, policy/authority changes and repairs
retain their governed decisions. The room's collaboration shape is specialist-alignment for analysis;
a consequential change convenes its existing change-consequential or approval-sign-off boundary.

Default cadence: daily delta review and weekly trend/standards assessment. Event-triggered review
covers a material incident, failed recovery, major method/profile change or explicit request.
Use existing trigger classes (cadence, escalation, authority-change, evidence-decay as applicable);
do not invent a trigger enum for each event. Domain deadlines and seasonal windows refine the
cadence. The current standing driver checks every 15 minutes; that is dispatch resolution, not a
requirement to perform expensive analysis every 15 minutes.

Initial configurable budgets: 200 occurrences per page, 1,000 per cycle, at most 20 new proposal
candidates per cycle and 30 minutes elapsed analysis. Remaining work is carried forward with a
cursor; budgets never silently discard evidence or claim full coverage. High-severity findings
route through existing attention regardless of proposal budget. These are pilot ceilings, not
measured throughput promises.

If external execution is unavailable, the cycle remains due and visible with its owner and next
action. A native executor may take over only with qualification, grant and claim checks. Platform
capture continues with no client present. No simultaneous scheduler/heartbeat ownership: the pilot
may invoke the same cycle contract externally; native activation hands off the schedule explicitly.

## 7. Evidence and restart contracts

Common event projection references canonical installation/org, source definition/version,
occurrence/cycle, room, TaskRun/build where applicable, executor/Principal, exact profile, event ID,
event and ingestion time, tool/skill/instruction versions, expected and observed result, duration,
wait class, evidence refs and authorization/decision refs. Applicable-but-missing fields are unknown.
No free text from a task becomes permission or a trusted instruction.

Persist consequential transition intent before dispatch and the receipt after execution. Server
capture handles tool/transition outcomes, interruption signals and completion. Client notes capture
useful corrections/rationale but cannot own the guarantee. A telemetry outage is visible and
reconciled; whether execution can continue follows the existing action's evidence requirement.

A restart packet contains objective and remaining acceptance, source/artifact identity, preserved
dirty outputs, completed steps and evidence, last confirmed side effect, current blockers/owners,
next safe step, standing authorization, actual pending human decision, checkpoint revision and time.
Development adds repo/branch/SHA and checkout identity; business rooms add their canonical records,
commitments and handoff evidence instead of Git requirements.

Recovery re-reads the source and acquires a fenced claim against the expected checkpoint version.
A stale executor cannot continue. A missing path requires artifact/source recovery; dirty work is
preserved before resumption. After a crash around publication, reconcile the actual external result
before retry. Deduplicate publication requests where the target supports it; uncertain outcome
remains unresolved rather than claiming exactly-once delivery.

The review task uses the same packet: its cursor, profile, selected evidence, findings and pending
verification survive replacement without the original conversation.

## 8. Objective trend analysis

Separate three identities: immutable source event, independent work occurrence and recurring
problem hypothesis. Replayed events do not increase recurrence. Ten retries in one occurrence
are one affected occurrence plus ten attempts, not ten independent failures.

Every finding records observation versus hypothesis; evidence refs and counterexamples; affected
definitions/profiles; eligible and affected counts; missing/excluded counts; time window; active,
queue and dependency time; confidence; competing explanations; owner; existing-work link; proposed
change and verification plan. A repeated gate refusal is not a defect until its decision, satisfied
evidence, missing requirement and actual authority have been checked.

Compare by definition/shape/version, domain, risk, work size, executor/profile and environment.
Do not rank unlike rooms by a pooled success rate. Include successful, failed, canceled,
interrupted and still-open work; label censored durations. Exclude the reviewer's own activity from
business performance denominators and assess it separately. Sample selection and evaluator version
are fixed before judging candidate changes. Conflicts of interest require a different assessor.

Default triage watches recurrence in at least three independent occurrences across two rooms;
this is a prioritization heuristic, not statistical proof. A single critical failure can demand
action. Low-volume archetypes keep findings inconclusive until their declared opportunity window
and sample requirement are satisfied. Report uncertainty; causal claims require stronger evidence
than before/after correlation and disclose concurrent changes.

Route outcomes as skill, instruction, tool/API, design/UX, platform defect, evidence gap, expected
refusal, duplicate or no-change, each with rationale. This is a proposed typed classification,
not a new free-form database status set.

## 9. Persistence, scale and access

Extend existing room-cycle payloads for review scope, profile refs, per-source cursors, exclusions,
budgets and Outcome Packet refs. Extend typed ImprovementSignal evidence for observations,
cohorts and assessment refs; ImprovementProposal remains the review/application linkage.
Verification writes through the existing governed service. UI statuses are projections, not a
second lifecycle. Query-critical fields/indexes may require a canonical-model migration after
query-plan review; do not promise zero migrations before that review.

Use a fixed ingestion high-water mark per cycle and stable composite keyset cursors per source.
Late-arriving events enter a later cycle by ingestion sequence; corrections append with supersedes
references. Persist output identity and cursor advancement transactionally, or with the existing
idempotent durable-step mechanism. A killed cycle replays without losing or duplicating findings.
Denied/deleted evidence is recorded explicitly and cannot silently satisfy completeness.

Maintain source/definition coverage separately from sampled narrative analysis. A bounded
round-robin inventory sweep checks untouched definitions and prevents busy cohorts starving sparse
ones. Display scanned, eligible, excluded, unavailable, remaining and oldest-unreviewed age.
A capped endpoint returns incomplete; BI-4BB68EB6 supplies the existing coverage repair.

Proposed pilot ceiling: 10,000 rooms and 100,000 new evidence records per day per installation,
tested at those bounds before a production capacity claim. Delta processing is O(new evidence);
no pairwise all-room comparisons or full-history prompt injection. A larger load becomes backlog
age and explicit capacity attention, not data loss. BI-IMP-9DA35549 owns this bounded initial scale;
a beyond-ceiling delivery slice must be identified before expanding the claim.

Evidence stays within the installation/org's existing grants and retention policy. Federation
shares only approved, minimized findings/profile applicability and aggregate evidence, never raw
business conversations by default. A common software defect does not authorize cross-tenant reads.
Erasure/legal-hold handling follows the canonical evidence owner; stale findings retain permitted
provenance/tombstones, not illicit copies. The review profile declares retention before activation.

## 10. User experience

Extend the existing Workroom Overview/Details and cross-workroom list. Add no parallel dashboard
that hides the real work.

The Overview shows: outcome; actual progress; next action and owner; why waiting; last evidence;
and a compact learning summary. Details reveals exact profile composition, gates and receipts,
restart packet and findings. A business user sees “Waiting for veterinary review” or “Site does
not fit the vehicle,” while technical identifiers remain available in Details.

The cross-room review view leads with actionable trends, each showing impact, affected/eligible
counts, evidence coverage, confidence, owner, change state and post-change result. Filters separate
common, facet, category, leaf and organization scope; definition-only coverage has a separate
“not yet exercised” state. Empty data says “No evidence received,” never “No problems.”

A finding expands to two comparable examples, counterevidence, the missing/satisfied requirement,
and the proposed next action. Recovery actions have a scoped preview with expected state and
per-item results. Generic stale age cannot authorize abandonment. No bulk delete of source.

Use shared tables, status, empty-state and disclosure primitives and theme tokens. Keyboard/screen
reader users receive the same scope, denominator and next action; color alone conveys no verdict.
Notifications occur for material findings, overdue review, verified change or required decisions;
unchanged waiting conditions stay quiet.

## 11. Applying lessons and standards

An accepted finding produces an existing backlog change or scoped knowledge/method proposal.
Record baseline and candidate versions, targeted profiles, adoption/rollback owner, applicable
fixtures and post-change measures before application. Promotion follows the existing competence
loop and JSI material-change assessment. A completed BI or merged PR is delivery evidence, not
verified operational benefit.

Promote a leaf lesson to category/facet/common only after explicit applicability review and
regression checks on materially different profiles. An organization choice remains WWWD; craft
belongs in WSID; platform behavior belongs in WWMD. The analyst may propose doctrine, never
silently rewrite it. Standards Steward review batches durable lessons weekly.

Proposed amendments, kept as pointers to this application design until independently reviewed:

| Canonical home | Amendment |
| --- | --- |
| PAAW/Four-Portfolio standard §9.6 | Reference this cross-occurrence surveillance profile, inheritance, cycle continuity and verified-application trace |
| JSI §8.2 | Learning records identify effective profile, method versions and evidence scope |
| JSI §8.3 | Cross-room analyst and assessor competence includes denominator selection, uncertainty, gate interpretation and recovery; independence remains explicit |
| JSI §11.5 and §13 | Protect evaluation integrity; domain transfer and reviewer/profile changes trigger applicable revalidation |
| Profile catalog composition and applicability sections | Require common review baseline, scoped deltas, measurable domain outcomes and not-exercised coverage |
| Existing DPF skills and instruction owners | Add compact capture/recovery and triage procedures at their existing boundaries; avoid global prompt duplication |

Use IP-953EE / BI-636638A6 for standards publication. This source calls the operating standard
PAAW/Four-Portfolio; the earlier “PAAS” wording is not treated as a separate standard.

## 12. Delivery slices and acceptance

Reserve 20% of implementation effort for consolidating identity projection, event deduplication,
lifecycle/recovery classification and shared UI projection. Track refactoring within each slice;
do not use the allowance for unrelated cleanup.

1. Contract and read-only pilot: common/profile resolution, complete inventory, replayable review
   packet and independent review against preserved audit evidence.
2. Capture and continuity: server attribution and checkpoints, delta cursors, visibility for missed
   capture, safe external-reviewer replacement.
3. Application: governed signal/proposal routing, dependency linkage, versioned changes and
   post-change assessment; reuse existing recovery/receipt owners.
4. Archetype verification and native execution: qualify applicable profiles and assessor, exercise
   real domain paths in nonproduction, then activate existing standing execution where justified.

| Acceptance | Observable proof |
| --- | --- |
| AC-01 Default coverage | Every registered source definition is resolved, explicitly unsupported or not exercised; aliases cannot double-count |
| AC-02 Profile inheritance | Common + facets + category + leaf + org constraints resolve deterministically; conflicting/removing obligations are surfaced |
| AC-03 Domain fit | Development, bookkeeping/standing operations, pet rescue and campground examples use their own evidence and critical-failure criteria |
| AC-04 Fresh context survives | Kill executor and reviewer with conversation unavailable; replacement reconstructs exact safe next step from durable artifacts |
| AC-05 Recovery safety | Missing/dirty paths, competing claims, crash around publication and terminal-parent/stalled-child fixtures preserve evidence and prevent blind replay |
| AC-06 Honest trends | Retry replay, late events, denominator changes, sparse cohorts and a 5,000-record cap produce correct recurrence/coverage labels |
| AC-07 Independence | Change author cannot supply its own passing assessment; held-out evidence and role boundaries remain enforced |
| AC-08 Verified application | One common and one scoped change show exact deployed versions and later comparable outcomes; insufficient evidence stays inconclusive |
| AC-09 UX | Owners can locate next action, scope, evidence and recovery state without interpreting raw transport logs; keyboard and theme checks pass |
| AC-10 Bounded operation | Pilot-scale delta/load test meets declared budgets, resumes cursor after interruption and exposes remaining backlog without starvation |
| AC-11 Authority | Read-only reviewer cannot repair, publish, expand grants, inspect another tenant or treat transcript instructions as authority |
| AC-12 Reviewer continuity | Missed cadence and reviewer failure produce visible due work; replacing executor does not start duplicate cycles |

Acceptance fixtures may prove mechanics; synthetic data does not prove business efficacy.
The existing 135 stalled child runs remain operational demand and are not closed by this design.

## 13. Readiness and next action

This draft is ready for independent design review, not implementation. The next executor should
read this exact artifact and its linked baseline, confirm current backlog ownership, review the
common/profile contract and persistence choices, then decompose delivery under BI-IMP-9DA35549.
No operator decision is needed merely to repeat already-authorized read-only analysis.
Schedule activation, principal appointment and consequential publication use their own existing
authority contracts when the implementation is ready.
