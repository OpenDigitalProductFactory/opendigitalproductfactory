---
status: draft
date: 2026-09-06
backlog_item: BI-IMP-9DA35549
workroom: WC-C285A230
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
the existing client-independent platform contract. Formal scope approval is the review requested
for this artifact, not an additional deliverable that must assert its own approval. Persisted
independent receipts determine readiness.

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

### Ingestion ordering implementation direction (2026-10-12)

BI-BF20F828 / WC-D7F044F1 retains this section's acceptance requirements. At
source `33a345a51be247db1f38a4672203ffb2c9e7eb5b`, `WorkroomActivity` maps to
`WorkCapsuleActivity` and contains a cuid and `recordedAt`, but no ingestion
sequence. The source inventory finds 22 production `create`/`createMany` call
sites; changing the shared activity helper alone would leave other writers out.
The existing cycle adapter serializes through `WorkItem FOR UPDATE`.

Decision `DI-D6F136AEAF94` selects database-owned ordering within these existing
models over consolidating every application writer before enforcing ordering.
The recorded platform consult is usable, high confidence and autonomy eligible,
with no commandment conflict. Standards alignment, a durable shared fix and
existing-model grounding contribute most. This selects a design direction; it
does not approve a migration or establish concurrency, performance or acceptance.

Extend the owning Workroom with a transactional ingestion counter and its
activity rows with an immutable per-room sequence. A database-owned insert
boundary must allocate and persist the counter and row in one transaction,
including direct inserts and bulk writers. Do not use a bare PostgreSQL sequence
as a commit-order watermark. PostgreSQL documents that sequence allocation is
not rolled back; row locks instead remain held through transaction completion.
References: [sequence functions](https://www.postgresql.org/docs/current/functions-sequence.html)
and [explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html),
consulted 2026-10-12. DPF already uses PostgreSQL triggers for existing-model
invariants; this direction introduces no ledger, scheduler or consumer service.

Before schema implementation, enumerate all writer lock orders, including
Workroom-first updates, WorkItem-first dispatch and multi-room `createMany`.
The sequence boundary must not introduce the reverse of an existing lock order.
Readers freeze committed highwater separately from the cycle output transaction;
they must not hold a WorkItem lock while waiting on an activity writer that can
need that same WorkItem. Serialize review output and cursor advancement under
the existing cycle lock and compare the expected checkpoint revision. The
frozen boundary is immutable across replacement. Missing durable parent binding
is an explicit refusal, never a fabricated coordinator or work item.

Capture committed highwater and eligible rows under one documented, compatible
MVCC snapshot protocol. With READ COMMITTED, each read must remain bounded by
the persisted highwater; with a fixed snapshot, the counter and rows must both
be visible in that snapshot. A pre-existing REPEATABLE READ snapshot must never
acknowledge a counter whose rows it cannot see. A replacement reuses the frozen
boundary rather than sampling a newer counter.

The checkpoint preserves the per-room highwater vector, each room's last
consumed position, and deterministic sparse-room rotation. Per-room sequence
numbers are not a global cursor. Reaching a 200-row page or 1,000-row cycle cap
must retain every unseen eligible row for continuation without advancing its
room cursor. Qualify reader and replacement behavior at both caps with a delayed
writer and unequal room activity rates.

The initial source audit confirms room-first scheduling and PR binding writers
(`workroom-drive-scheduling`, `pull-request-binding-runtime`, and
`pull-request-merged-binding`), and room-first terminal transitions and shape
rebinding. The employment actuator also calls the shared activity helper inside
its caller's employment-event transaction; that outer transaction belongs in
the lock-order audit. The canonical cycle adapter locks `WorkItem`, not
`Workroom`. These observations are not an exhaustive proof of safe ordering.
The current async-operation writer uses one-row `createMany` with
`skipDuplicates`; a replay must not be mistaken for a new source event. Test
the counter and cursor semantics after a duplicate conflict explicitly. Never
assume consecutive allocated integers prove absence of retention or input gaps.
Opposing multi-room insert order must either be serialized consistently or fail
and retry the whole owning transaction with a bounded, documented policy; a
partial replay of just the activity insert would lose the caller's atomicity.

The forward-only migration must preserve every existing payload and reference,
label any deterministic historical ordering as migration ordering rather than
recovered chronology, and prevent an old writer from supplying an arbitrary
sequence. Inspect live population and query plans before choosing backfill and
index operations. Existing retention may delete expired rows: a cursor gap or
denied/deleted source must remain visible and cannot count as reviewed evidence.
Corrections append with original/supersedes identity and a new ingestion sequence.

The implementation reuses `Workroom.activitySequence` and
`WorkroomActivity.sequence` from BI-62514632 / PR 6294. WWMD reconciliation
`DI-7588F40259CF` supersedes the separate ignored 64-bit candidate selected by
`DI-633825E30706`: one canonical counter and trigger serve both log readers and
review ingestion. Existing integer JSON and `afterSequence` contracts remain.
The ingestion adapter exposes decimal strings and explicitly orders by the
qualified numeric column, never the projected text alias.

The hardening migration preserves every assigned position, rejects supplied
insert positions and makes sequence/room identity immutable. Under table locks,
legacy NULL rows receive positions after each room's committed maximum in
deterministic timestamp/ID order. This is newly ingested retained evidence, not
recovered chronology. Rooms without enough integer headroom retain NULL rows
and unknown legacy coverage; the migration neither discards history nor wraps
the counter. Existing integer capacity remains a compatibility limit requiring
a separately qualified public cursor upgrade before exhaustion. Empty pages,
legacy rows and allocation gaps retain `retention-unverified` coverage.

The source adapter stores `workroomReviewIngestion` in the existing cycle's
WorkItem evidence. Initialization commits before source reads or analysis; the
output message and consumed positions then commit under the same parent lock,
with a canonical JSON revision comparison and exact replay identity. Each turn
reads at most 200 rows from one rotated room and retains the 1,000-row cycle
budget. A later governed cycle carries consumed positions and rotation forward.
The invoking handler supplies its existing authorization; this adapter creates
no role, owner, permission or scheduler. Oversized evidence must use the existing
offloaded references. A fully consumed frozen vector returns completion without
another analysis or output; this never certifies retention coverage.
Unit and synthetic-load results do not qualify the database
transaction or establish operational acceptance.

Required database qualification uses concurrent real PostgreSQL transactions:
one delayed writer, a second writer, a highwater reader, rollback, multi-room
bulk inserts in opposing orders, and concurrent reviewer replacements. Prove
late commits remain eligible in the next cycle, failed output cannot advance
the cursor, replay returns the same output identity, and stale revisions fail.
Exercise the declared 200/page and 1,000/cycle limits, sparse-source rotation,
10,000-room/100,000-event workload, tenant boundaries and retention gaps. No
source fixture, decision score or merged PR substitutes for those results.

At least 20% of this slice consolidates the shared activity projection, cursor
validation and cycle/output transaction rather than adding per-caller state.
The approved delivery plan's Phase 2 and AC-04/05/06/10/11/12 still govern.

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

The exact informative application text is maintained in the following canonical homes. These
paragraphs are the reviewable reference amendments for this delivery, not placeholders for an
unspecified future rewrite. They add no normative standard version or qualification claim.
Normative adoption remains a separate Standards Steward decision under BI-636638A6.

| Canonical home | Amendment |
| --- | --- |
| [PAAW/Four-Portfolio standard §9.6](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md) | Informative application: inherited obligations, durable continuity, cadence and trace through independent subsequent assessment |
| [JSI application note following §8.3](../../architecture/job-specific-intelligence.md) | Effective profile/method attribution; analyst and assessor competence; precommitted population and opportunity window; independence and target-profile transfer under §§8.2, 11.5 and 13 |
| [Profile catalog §2 application note](../../architecture/four-portfolio-archetype-standard-profile-catalog.md) | Concrete profile fields, conflict handling, development/bookkeeping/pet-rescue/campground evidence, and separate definition/occurrence coverage |
| Existing DPF skills and instruction owners | Add compact capture/recovery and triage procedures at their existing boundaries; avoid global prompt duplication |

Use IP-953EE / BI-636638A6 for standards publication. This source calls the operating standard
PAAW/Four-Portfolio; the earlier “PAAS” wording is not treated as a separate standard.

## 12. Delivery slices and acceptance

**OBJ-COVERAGE:** Apply a common review contract with explicit, deterministic domain and archetype extensions to every eligible workroom, without claiming unexercised coverage.

**OBJ-RECOVERY:** Preserve fresh evidence and safe continuation across executor loss, interrupted publication, missing workspaces and missed review cycles without relying on conversation memory.

**OBJ-LEARNING:** Turn correctly attributed cross-workroom observations into independently assessed, governed improvements whose effects are verified on comparable subsequent work.

**OBJ-OPERATION:** Make the review and recovery process understandable to its owner and bounded in resource use, with honest coverage, remaining work and one actionable next step.

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

| Acceptance | Objectives | Observable proof |
| --- | --- | --- |
| AC-01 | OBJ-COVERAGE | Default coverage: every registered source definition is resolved, explicitly unsupported or not exercised; aliases cannot double-count |
| AC-02 | OBJ-COVERAGE | Profile inheritance: common + facets + category + leaf + org constraints resolve deterministically; conflicting/removing obligations are surfaced |
| AC-03 | OBJ-COVERAGE | Domain fit: development, bookkeeping/standing operations, pet rescue and campground examples use their own evidence and critical-failure criteria |
| AC-04 | OBJ-RECOVERY | Fresh context survives: kill executor and reviewer with conversation unavailable; replacement reconstructs exact safe next step from durable artifacts |
| AC-05 | OBJ-RECOVERY | Recovery safety: missing/dirty paths, competing claims, crash around publication and terminal-parent/stalled-child fixtures preserve evidence and prevent blind replay |
| AC-06 | OBJ-LEARNING | Honest trends: retry replay, late events, denominator changes, sparse cohorts and a 5,000-record cap produce correct recurrence/coverage labels |
| AC-07 | OBJ-LEARNING | Independence: change author cannot supply its own passing assessment; held-out evidence and role boundaries remain enforced |
| AC-08 | OBJ-LEARNING | Verified application: one common and one scoped change show exact deployed versions and later comparable outcomes; insufficient evidence stays inconclusive |
| AC-09 | OBJ-OPERATION | UX: owners can locate next action, scope, evidence and recovery state without interpreting raw transport logs; keyboard and theme checks pass |
| AC-10 | OBJ-OPERATION | Bounded operation: pilot-scale delta/load test meets declared budgets, resumes cursor after interruption and exposes remaining backlog without starvation |
| AC-11 | OBJ-LEARNING | Authority: read-only reviewer cannot repair, publish, expand grants, inspect another tenant or treat transcript instructions as authority |
| AC-12 | OBJ-RECOVERY | Reviewer continuity: missed cadence and reviewer failure produce visible due work; replacing executor does not start duplicate cycles |

Acceptance fixtures may prove mechanics; synthetic data does not prove business efficacy.
The September 8 operational cleanup cancelled 149 stalled children of terminal builds through
governed MCP and verified none remained in that cohort. This supersedes the older 135-child
snapshot; it does not establish prevention or resolve unrelated recovery candidates. The
September 9 requested sweep observed 429 persisted rooms and 24 nonterminal rooms linked to done
backlog items. Preserve their evidence and reconcile current activity before any disposition.

## 13. Readiness and next action

This draft remains subject to independent scope review. Its four objectives and twelve
acceptance statements in section 12 remain unchanged. The continuation below reconciles
delivery evidence and the next work; it supplies no independent approval, replacement
baseline, implementation admission or historical task settlement.

**Continuation checkpoint, 2026-10-28.** The parent BI-IMP-9DA35549 is awaiting
acceptance. AC-01 is the only full acceptance case established by the retained evidence;
AC-02 through AC-12 and all four objectives remain incomplete. Backlog delivery closure
and this initiative's operational proof are separate facts. Closing a non-contractual
delivery item does not prove the observations required by section 12.

The registered-definition traversal for AC-01 is recorded by
RV-WORKROOM-CATALOGUE-AC01-RECOVERY135-20261025: 20 canonical definitions, four complete
pages, a final null cursor and one alias deduplicated. Its population digest is
`6a153d2fcb6defbff5ffdacfae0bf3ed7aeecf67e0641e1131f642141deff877`.
This establishes definition coverage only; occurrence performance and organization
applicability were not exercised. Preserve this proof without rerunning it to inflate
coverage. Later source tests, deployments and bounded UX checks retain their own scope.

**Delivery history and current authority.** BI-11458908 is done. Its earlier definition
catalogue was delivered through PR 6579; the later occurrence-context work remains
unpublished. The Workroom Overseer archived WC-D8C2180C and released its 14 scope items
on 2026-10-28. Parent room WC-D3C188F5 and the earlier WC-4CF7C38C are also archived.
Their source, receipts, failures and original review identities remain historical
evidence. A later note or lease timestamp does not reopen a terminal room.

The normal design claim for the existing parent created WC-C285A230 on
`doc/workroom-acceptance-continuation`, from published main
`1875e443e5ea2bdd3b35dcbe37c2a47d8be7883b`. Decision IRD-53073796159F allowed
design with Large/low classification and no unmet requirements. Its single document
scope is this spec. This binding replaces the editing location, not the prior baseline
or another executor's authority. The new room's unresolved funding projection supplies
no additional spending authority.

**Retained occurrence-context increment.** The preserved source is
`4333fad810440277626cec79913954b1c94d939c`, tree
`d631d6b7d09cfd71158097f0c39d21d4f0c9e9b0`, on
`fix/workroom-profile-integration`. Its published branch remains
`eca480f7b87f7bf3ccc8202aca1d9c9e1c71c020`; no open PR contains the later work.
The retained three-dot delta is 13 files, 638 additions and 5 deletions, from
`dadeb04727b42114a2c043be36436530096cd90e`. It was not imported into the new
design branch.

That increment obtains booking organization, storefront, archetype and composition
facts only after current canonical content admission for the exact selected Workroom.
Private handoff recovery reuses the decision only for the same selected row. The
existing workforce authority also applies. Missing, denied, thrown or absent-room
admission withholds the lookup. Conflicting or incomplete source facts remain unknown;
inactive and removed entries are excluded.

These are inputs to profile resolution. They do not establish active declaration
applicability or compose governed facet, category, leaf and organization obligations.
Full AC-02 still requires the deterministic composition, explicit conflict/removal
handling and historical profile provenance described in section 5, followed by admitted
installed verification. The source authorization cases contribute to AC-11, and the
existing localized Details disclosure contributes to AC-09; neither completes those
cases. The disclosure must continue to distinguish unknown applicability and
not-exercised assessment, without adding a passed-review label.

The retained source has 454 affected tests across 28 files and both TypeScript checks
passing. Its isolated Windows cancellation contract has 12 passing cases and one
failure. The failure occurred while replacing the admitted state with RUNNING, before
the child-ready marker and before cancellation was requested. No canonical gate
evidence was acquired for this source. The underlying EPERM cause and any connection
to the older readiness failure remain unproved.

BI-B3DEC077 owns the proposed controlled destination-handle diagnostic with the existing
Windows owner. Its design is published, but its experiment remains unrun: a truthful
research failure leaves implementation denied. BI-2664971A owns the separately routed
qualification-research admission repair, according to the coordinator's native binding
readback. Neither policy work nor a controlled diagnostic result would by itself prove
the original failure's cause or authorize a blind fixture retry.

**Incremental coverage and integration.** The
[existing delivery plan](../plans/2026-09-12-cross-workroom-learning-delivery-plan.md)
retains the original child mappings. A bounded live coverage read found 15 open items,
no in-progress items, six awaiting acceptance and seven triaging in EP-C00F61F4.
All open work-type partitions were complete. Adjacent BI-80BECE1E covers definition
identity and occurrence tracing; BI-4B208A34 covers selected target/preview verification.
Neither inspected body covers this exact unpublished occurrence-context increment.
This is a scoped overlap result, not proof that the entire backlog is empty.

Reconcile an existing open delivery owner before filing any corrective increment. If
no exact coverage exists, capture one narrow follow-up under the existing epic with
its proportional canonical design and actual admission. Preserve the completed child's
history; do not rebind its occupied branch, reopen its terminal room or borrow its old
implementation claim. The parent remains the home of the full objectives and criteria.

Integration must preserve current-main safeguards. The comparison against published
main `a6137100ce4aa783cfcc5896773d2d0bb284ba19` found nine additions in three
overlapping paths: the gateGoverned/executor projection and localized load-trend label.
A whole-file replacement from the retained branch would lose those changes. Reconcile
the current base again when actual delivery admission exists. Reuse canonical identity,
admission, profile composition and disclosure, retaining section 12's refactoring share.

**Captured source-facts increment: BI-D02868D7.** This Medium platform feature is
triaging under EP-C00F61F4. It succeeds only the unpublished occurrence-context scope,
not the completed definition catalogue. The parent keeps its four objectives and
twelve full acceptance cases; no old baseline or implementation claim is inherited.

The chosen design extends the existing selected-room loader and localized Details
disclosure. A second registry or policy composer would duplicate authority and is
rejected. Treating booking facts as applicable obligations is also rejected: source
facts are inputs, while governed composition remains separate work. No schema
migration is proposed. Actual source impact and compatibility must be rechecked
under a fresh admitted delivery binding before implementation.

The increment has five observable acceptance checks:

- I1: Missing, denied, thrown or absent exact-room content admission performs no
  subject lookup, including private recovery. A reused admission decision is valid
  only for the same selected row; existing workforce source authority still applies.
- I2: Admitted lookup resolves only the selected booking's organization, storefront,
  archetype and composition facts. One relation read takes 33 to detect a 32-entry
  ceiling; provenance is bounded to 128 KiB. Conflicts, incomplete, denied or
  unavailable facts remain unknown; removed and inactive entries are excluded.
- I3: Existing localized Details shows attributable source facts, applicability
  unknown and assessment not-exercised. It adds no controls, passed-review label or
  review-cycle write. Verify changed rendered behavior, keyboard access and themes
  on the containing installed revision under actual admission.
- I4: A fresh normally admitted delivery binding reconciles current main and
  preserves its gateGoverned/executor projection and load-trend localization.
  Retained source is evidence, not an import instruction or scope claim. Exact
  changed-tree checks, protected publication and installed observations retain
  separate attribution.
- I5: Completed-child history and parent section 12 criteria remain unchanged.
  Source-fact evidence contributes to AC-02, AC-09 and AC-11 without claiming their
  full completion. Governed facet/category/leaf/organization obligations,
  historical profile composition and the full forbidden-action matrix stay outside
  this increment.

BI-B3DEC077 and its supported failure disposition remain delivery prerequisites;
BI-2664971A owns the separate qualification-admission repair. Neither a policy
change nor a controlled sensitivity result proves the original EPERM cause.
Current research, design, plan coverage, exact scope and implementation admission
remain required. No new review may replace or settle an original held execution.
Documentation readiness is a separate publication step and does not prevent
admitted source/criteria/overlap planning.

Creation suggestions BI-C020360A, BI-756C899D and BI-4A06271B were read: they concern
stakeholder-coverage invalidation, effective progress clocks and execution
continuation briefs respectively. Their existing owners retain those mechanisms;
none of the inspected bodies supplies this exact occurrence source-facts outcome.


### Research & Benchmarking for BI-D02868D7

Primary sources inspected on 2026-10-29 UTC. These are architectural comparisons, not claims that external products have been installed or tested.

| Comparator | Observed model | Adopt for this increment | Reject or leave outside scope |
| --- | --- | --- | --- |
| [Backstage entity descriptor](https://backstage.io/docs/features/software-catalog/descriptor-format/) — open source | Entity envelope separates metadata/spec from processor-produced relations. Relations use typed canonical target references. The documentation explicitly separates display ownership from runtime authorization. | Resolve the canonical source and relationships rather than treating a display label as authority. Keep displayed facts distinct from the selected-room permission decision. | A second catalog, importing descriptor ownership as access permission, or copying its entity schema into DPF. |
| [OpenMetadata table JSON schema](https://github.com/open-metadata/OpenMetadata/blob/main/openmetadata-spec/src/main/resources/json/schema/entity/data/table.json) — open source | Structured fields include qualified entity names, typed references and explicit optional profiles; nested columns have a declared schema. | Use explicit identities and typed bounded facts, with absence represented rather than guessed. | Broad lineage ingestion, editable metadata catalogs and an extra profile store. A table schema is a comparison, not a complete DPF authorization design. |
| [Atlassian Assets attributes](https://support.atlassian.com/assets/docs/what-are-attributes/) — commercial | Attributes distinguish system names and display names and support object references; object keys identify individual objects. | Keep readable labels alongside attributable source identity within Details. | Letting free-text labels substitute for exact booking identity, or expanding to schema/object editing controls. |
| [ServiceNow Identification and Reconciliation API](https://www.servicenow.com/docs/r/api-reference/rest-apis/c_IdentifyReconcileAPI.html) — commercial | Central reconciliation identifies configuration items and restricts updates to authorized data sources; source-native keys identify contributed records. | Preserve source identity and treat conflicting source facts explicitly. Reuse the existing owning authority. | Building an ingestion/reconciliation engine or silently selecting precedence to manufacture applicability. This increment is read-only. |

[W3C PROV-DM](https://www.w3.org/TR/prov-dm/) distinguishes entities, activities, agents and derivation. Its derivation discussion cautions that usage plus generation alone does not establish derivation. Apply that distinction to evidence: reading a booking establishes source attribution, not a reviewed outcome. This is conceptual alignment; no PROV serialization or conformance claim is made.

This increment concerns authorized catalog facts and disclosure, not a new delivery lifecycle or agent process. BMAD is therefore not the nearest comparator for this narrow addition; the existing parent lifecycle design remains authoritative.

This comparison supplies author research for the source-facts increment only. It
does not approve the parent scope, satisfy independent review, settle the Windows
failure, or attest installed acceptance. The actual child delivery binding must
resolve its own shape, research receipt and plan coverage before implementation.

**Next ordinary steps.** Preserve this source reconciliation, obtain the actual
immutable design identity, and follow the current governed design/coverage obligations.
Do not request a replacement for any unsettled original review or infer its settlement
from a new Workroom. Resolve the diagnostic's admitted route through its existing
owners. Only an admitted delivery increment may integrate source and run the justified
verification sequence; protected publication and qualified installation then precede
the remaining operational acceptance exercises.

The owner-facing next-action view should show the responsible owner, the specific
missing evidence and the next supported action. Keep definition coverage, source tests,
deployment and full operational acceptance visibly distinct. Use the existing
Overview/Details hierarchy, shared disclosure and keyboard/theme behavior; technical
identities belong in Details. Unchanged waits remain quiet, while an actual failure,
new required decision or verified outcome updates the existing view.
