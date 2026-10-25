---
status: active
---

# Coordinated Workrooms — every room has an owner, and someone watches every room

## Stall-query repair (BI-70B2ED84, 2026-09-21)

Observed: ten concurrent stall-attention reads accumulated for up to twenty
minutes while the portal displayed its loading skeleton. Cancelling nine reads
and reloading restored Operations; health checks alone had remained green.

The existing activity trail remains authoritative. Filter terminal/archived
rooms before ranking their ticks, compute the first advancing tick once per
room, then count refusal ticks before that boundary. This replaces a correlated
full-history scan per tick with grouped relational operations. No table, index,
writer, grant, or new attention policy is introduced. Missing/null actions still
reset a streak; pause and escalation share the existing threshold of four.

Acceptance: PostgreSQL fixtures cover resets, mixed actions, terminal exclusion,
and growing histories; the query plan has no correlated subplan; 40,000 ticks
finish within a five-second statement budget. Preserve descending streak order
and the 100-room limit. Run the PostgreSQL suite with
`DPF_SQL_TEST_DATABASE_URL` pointing to the governed verification target (the
suite forces read-only transactions and uses CTE fixtures). Verify the deployed
portal after the canonical release. Temporary cancellation is not deployment.

Implementation sequence: reproduce the old plan and timeout, replace only the
query aggregation, run source and real PostgreSQL checks, publish through the
protected PR path, then include the merged fix in the coordinated release.

Read-only verification on 2026-09-21: the old 40,000-tick fixture exceeded its
five-second statement timeout; the replacement has no correlated subplan and
finishes within budget. The replacement over the live history ranked 67,141
rows and returned 73 stalled rooms in 161 ms. This verifies the SQL, not its
deployment. The PostgreSQL regression suite also runs automatically against
the existing CI database when `CI=true`.

**Epics:** `EP-WORKFORCE-TRANSITION` · `EP-WORK-CONVERGENCE` · `EP-32B0E693` (capability completeness)
**Predecessor:** [Proactive Workrooms](2026-08-29-proactive-workrooms-design.md) — that design made rooms *wake*; this one makes them *owned and coordinated*
**Kernel consult:** `DI-306B742EFD74` — `derive-with-explicit-override`, composite 12.061, margin
4.817, **high** confidence, `structuredCoverage: strong`, `semanticFallbackRatio: 0`,
autonomy-eligible with no blockers. Two earlier attempts timed out; §4.1 records why, because the
cause is a live defect in the steering engine and worth keeping.
**Operator direction:** recorded verbatim in §3.

> **A room without an owner is a folder with a cron attached. The proactivity substrate is
> complete and it is idling, because conformance correctly refuses to run work nobody
> answers for — and there is no way to say who does.**

---

## 1. What is actually true today

Code-verified against `main` at `867c7e8be`, or live-queried from the reference install.

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | **A live room has been paused for want of an owner, on every tick, unnoticed.** `WC-A69BCABB` wakes every 15 minutes, resolves its shape, projects a cycle, and halts: `conformance_pause` / `missing_explicit_coordinator: An executable room requires exactly one explicit Process Overseer.` 26 consecutive ticks at time of writing. | `get_workroom WC-A69BCABB`, `workspaceState.workroomDrive` |
| 2 | **Nothing surfaced that pause to anybody.** No attention item, no digest, no escalation. A room can be stalled indefinitely and the only way to learn it is to read that one room. | `activities` are `workroom-drive` rows on the room itself; no attention source reads them |
| 3 | **There is no governed way to appoint a room's owner.** `persistWorkroomParticipantAssignment` is a complete, correct writer with **zero callers**. `invite_room_participant` admits a participant but never sets the `coordinator` role. Derived coordinators are deliberately never written. | `room-participant-assignment.server.ts`; `room-messaging-pack.ts`; `room-participant-assignment.ts:6` |
| 4 | **The coordination hierarchy already exists as data and is entirely dormant.** 9 orchestrators — `coo-orchestrator` (cross-cutting) plus one per IT4IT value stream — each carrying `delegates_to` (downward) and `escalates_to` (upward) chains that terminate at human `HR-*` roles. All `defined`; none `active`. | `packages/db/data/agent_registry.json` |
| 5 | **Workforce coverage is uneven and unmeasured.** 86 agents, 30 active. `deploy`, `release` and `governance` value streams have **zero** active agents; `evaluate` has 2 of 12. | same registry |
| 6 | **Nesting is modelled but unused for coordination.** `WorkroomRelation` ships with `contains` / `spawned-from` / `depends-on` / `blocks` / `contributes-to`. Nothing derives a coordinator, an escalation path, or a status rollup from it. | `work-coordination.prisma`; `room-relations.ts` |
| 7 | **No archetype declares which coworkers it needs.** `establish-coworker.ts` has no archetype awareness, and no module maps an archetype to a required roster. Staffing is per-install and manual. | `apps/web/lib/coworker-lifecycle/`; `packages/storefront-templates/src/` |
| 8 | **The archetype this install believes it is does not exist.** The operator describes the business as open-source management. The `software-platform` category contains exactly one leaf — the generic `software-platform` — and that is what the install runs. | `packages/storefront-templates/src/archetypes/software-platform.ts` |
| 9 | **The standing-room set is gated on category, not leaf.** `operatesASourceRepository` keys on `archetype.category`, so every leaf in the category gets the source-operations rooms identically. | `packages/storefront-templates/src/standing-rooms.ts` |
| 10 | **Four capabilities in this program shipped complete and unconnected.** The work-shape registry (zero consumers), the `workShape` claim (no write path), the drive's room selection (capped before filtering), and now room ownership (writer with no caller). Each shipped green. | this program's own history, `BI-FAFEB5C2` / `BI-A967717A` / `BI-72B3FB40` / this design |

## 2. The gap, stated once

Findings 1–10 are one gap: **the platform can decide what work should happen and can wake a
room to do it, and it cannot say who is responsible for anything.**

Ownership is the missing axis. Without it a room cannot execute (finding 1), a stall cannot be
noticed (finding 2), nesting cannot mean delegation (finding 6), and a workforce cannot be
sized against demand (findings 5, 7).

Finding 10 is the pattern worth naming: this program keeps building the mechanism and not the
seam. It is not carelessness in any single instance — each piece was tested and correct. It is a
decomposition habit that consistently defers the connection, and the design below is deliberately
shaped so every slice ends at a *joined* seam rather than a finished component.

## 3. The organizing model

Recorded from operator direction, 2026-09-03, because the design is downstream of it:

- Each room has an **owner** — the main coordinator, the task master — who makes sure the
  sub-agents and the process are working properly.
- The **COO** is that role broadly: making sure all rooms are progressing and keeping things on
  track.
- For a given room, the main coordinator is **the specialist for that area, aligned per portfolio**.
- Workrooms are **nested**, decomposing into more discrete specialists who manage more discrete
  workrooms with their own outcomes.
- The nesting is akin to human organization design — except the prime responsibility sits with an
  AI coworker, which **communicates upward as needed, and orders and tracks downward**.
- **Employees may engage at any level.**
- The COO's need is different in kind from a room owner's: it is **status tooling** — broadcast an
  ask, check status, know schedules and workload, flag bottlenecks.

Two things follow that the substrate does not yet express. First, ownership is *derivable* — "the
specialist for that area, aligned per portfolio" is a rule, not a per-room decision. Second, the
COO is *not* a bigger room owner; it is a different surface over all rooms.

## 4. Approach: derive the owner, let it be overridden, never guess

The room's coordinator resolves through one ladder, highest wins:

```
1. Explicit appointment      a governed write — a human or the COO named this owner
2. Work-shape declaration    the shape's first agent-owned stage accountablePrincipalRef
3. Archetype profile         the specialist this archetype aligns to that portfolio
4. Orchestrator registry     the value-stream orchestrator, as backstop
5. Unowned                   surfaced as unowned; the room does not execute
```

Layer 5 is load-bearing and is not a failure mode: a room that cannot resolve an owner is
**reported**, never assigned to a plausible-looking coworker. Guessing an owner would put an
unaccountable agent in charge of consequential work, which is worse than a stalled room — and
the current behaviour (pause + refuse) is already correct, it is simply invisible.

This mirrors the collaboration-shape precedent exactly — declared beats derived, derivation
returns **null** rather than guessing — and the work-posture ladder, where hard policy outranks a
room declaration outranks derivation.

### 4.1 Decision status — ratified, and what the two timeouts revealed

Ratified as `DI-306B742EFD74`: **derive-with-explicit-override**, margin 4.817 over
explicit-appointment-only (7.244) and orchestrator-hierarchy-only (5.969), high confidence, no
commandment conflict. Strongest contributors: *Research and Use Standards*, *Classify ambiguous
requests before acting*. The kernel and the reasoning below agree; the reasoning is kept because it
is reviewable.

Explicit appointment for every room was rejected because the operator's model says the owner
follows from area and portfolio — hand-appointing each room encodes one rule as N decisions, and
finding 1 shows what a single missing appointment costs. Orchestrator-registry-only was rejected
because one owner per value stream cannot express "the specialist for that area": every
`foundational` room would report to the same coworker whether it concerns credentials, payables or
dependencies.

**The two earlier timeouts were a defect, not weather** ⟦runtime: 2026-09-03, `BI-D8D1371B`⟧.
`principle_decide` is deterministic MCDA and did not fail as scoring. Its *retrieval* stalled:
principles are scored either `structured` (from the caller's feature dimensions) or `semantic`
(from an embedding), `apps/web/lib/inference/embedding.ts` allows 30s per embedding attempt, and
the decide pack sets **no overall budget** — so 2–4 embedding calls can hang past any client
timeout before the existing fallback is ever reached.

Two consequences worth carrying into how this platform makes decisions at all:

- **Rich feature vectors are not just better inputs, they are the path that avoids the fragile
  one.** The ratified call supplied 14 dimensions per option and scored fully structured
  (`semanticFallbackRatio: 0`); a probe supplying one dimension fell to semantic scoring where 39
  of 49 commandments contributed exactly zero.
- **A degraded ruling can look like a healthy one.** When embeddings fail fast the call succeeds,
  reports its verdict, and most of the kernel is inert — flagged in `signalQuality`, but not in the
  headline. Read `structuredCoverage` and `semanticFallbackRatio` before trusting a ruling.

## 5. The COO layer

The COO is a coworker (`AGT-ORCH-000`, already defined) plus a surface it reads and acts through.
Its cross-room needs are status and recovery coordination. The October 25 amendment below supersedes the earlier report-only interpretation; specialists retain execution authority.

| COO need | Substrate today | Gap |
| --- | --- | --- |
| Are all rooms progressing? | none — liveness ≠ progress | **cross-room progress view**: owner, last cycle, last action, ticks since it advanced |
| Flag bottlenecks | `list_at_risk_queues`, `get_queue_status` (work queues, not rooms) | rooms paused, unowned, or repeating one action; finding 1 must become visible |
| Know workload | `get_coworker_room_engagement` (per coworker, presence-scoped) | aggregate: rooms per owner, concentration, unstaffed portfolios |
| Know schedules | `ScheduledAgentTask` + drive cadence, unjoined | next wake per room, obligations due, deadline bands |
| Broadcast an ask | `post_room_message` (one room) | fan-out down the `contains` tree with tracked acknowledgement |
| Escalate upward | `escalates_to` in the registry, dormant | wire the chain so a stalled room reaches its orchestrator and then a human |

**The authority boundary:** the COO owns recovery follow-through through existing Workroom and task facilities. It does not become a second execution path or override a room's authority. The room drive dispatches stages and the declared independent reviewer decides gates. A report, ask or handoff is not completion: the COO follows the resulting obligation until verified resolution, a declared durable wait or a necessary human decision. See the October 25 amendment for the current delivery and acceptance contract.

**A stalled room must page someone.** Finding 2 is the proof this is not decoration: a correct,
safe, well-designed refusal ran unnoticed 26 times. The bottleneck signal is the difference
between a governed system and an inert one.

## 6. The common / archetype / instance split

The demarcation from the predecessor design applies unchanged, and this work is the first real
test of it because ownership has content at all three layers.

| Layer | Owns | Example |
| --- | --- | --- |
| **Platform** (every archetype) | the ownership ladder, the relation-derived hierarchy, escalation/delegation wiring, the COO surface and its tools, unowned reporting | "a room resolves exactly one owner or is reported unowned" |
| **Archetype** (every install of that archetype) | which standing rooms this kind of business needs, which portfolio each sits in, and **which specialist owns which portfolio's rooms** — plus the coworker roster the archetype requires | "an open-source management business needs a contribution-flow room owned by a code-review specialist" |
| **Instance** (this install) | which coworker fills each role, which repository, thresholds, and any explicit appointment that overrides the derivation | "that specialist is `change-reviewer`; the repo is *ours*" |

**The archetype layer gains a second responsibility here.** Today it declares rooms (§ standing
rooms). It must also declare the **roster**: which coworker archetypes this business kind requires,
so staffing is derivable and coverage is measurable. Finding 5 — three value streams with zero
active agents — is invisible precisely because nothing declares what *should* be staffed.

### 6.1 The open-source management archetype

Finding 8 is a scoping problem, not a detail. The operator's business is open-source management;
the catalogue has a generic Software Platform leaf and nothing else, and the source-operations
rooms are gated on the *category* (finding 9), so today every software-platform install would get
them identically.

That is wrong in both directions: a SaaS product company in the same category does not run
contributor intake or DCO enforcement, and an open-source management business needs rooms this
design has not enumerated (licence and provenance, community and contributor relations, release
signing, upstream/downstream coordination, security disclosure handling).

So the archetype work is: **add `open-source-management` as a leaf** under `software-platform`,
move the source-operations gate from category to leaf, and declare that leaf's room set and
required roster. This design does not enumerate that room set beyond the obvious candidates —
that enumeration is its own pass, with the operator, and inventing it here would be exactly the
"author per archetype" failure the derivation discipline exists to prevent.

## 7. Safety

- **Ownership never widens authority.** The coordinator coordinates; it does not acquire the
  authority of the stages it oversees. Conformance already refuses `coordinator_evaluator_overlap`
  and `coordinator_approver_overlap`, and appointment must not become a route around either.
- **Derivation may name an owner; it may never name an approver.** The human-owned stages of every
  standing shape stay human, at every layer of the nesting.
- **Unowned is reported, never guessed** (§4).
- **The COO cannot execute** (§5) — it reads, asks, and escalates.
- **Escalation terminates at a human.** The registry's chains already end at `HR-*` roles; the
  wiring must preserve that rather than looping between orchestrators.
- **Appointment is a governed write** with `consequence: "authority"`, as `invite_room_participant`
  already declares.

## 8. Research and benchmarking

- **Holacracy — nested circles and the Lead Link.** Circles decompose into sub-circles, each with a
  Lead Link accountable for the circle's purpose, assigned *by* the broader circle rather than
  elected within it. DPF **adopts** the two load-bearing ideas: accountability attaches to the
  circle (room), and it is conferred from above rather than self-claimed — which is precisely the
  derivation ladder in §4. DPF **rejects** Holacracy's governance meetings and role-election
  machinery: our equivalent must be derivable and machine-checkable, not the output of a meeting.
- **Incident Command System — span of control and delegation.** ICS assigns one Incident Commander,
  delegates to section chiefs as the incident grows, and holds span of control to roughly 3–7
  reports. DPF **adopts** single-point accountability per unit and explicit delegation as the unit
  subdivides, and **adopts span of control as a measurable** — it is exactly the "workload and
  bottleneck" signal §5 needs, and gives the COO a threshold rather than a vibe. DPF **rejects**
  ICS's fixed rank structure: our specialists are derived per portfolio, not slotted into a
  standing chart.
- **Kubernetes owner references and the controller manager.** Every object may carry an owner
  reference; garbage collection and status rollup follow it, and one controller-manager process
  supervises many controllers. DPF **adopts** the owner-reference-as-data pattern (ownership is a
  queryable edge, not convention) and the supervisor-over-controllers shape for the COO. DPF
  **rejects** cascading deletion semantics: sealing a parent room must never delete a sub-room's
  history, which `PAAW-WORK-032` already forbids.

**Standards basis.** Single-point accountability per unit of work, with delegation recorded and
escalation terminating at a human, is the NIST AI RMF *Govern* function applied to an agent
workforce: an automated actor may hold responsibility only where a named human accountability
path exists. The registry's `escalates_to` chains already encode that; this design connects them.

## 9. Decomposition

Every slice ends at a **joined seam** — a thing that is observable on the install — rather than a
finished component. That is a direct response to finding 10.

| Slice | Layer | Content | Observable when done |
| --- | --- | --- | --- |
| **A** | Platform | Governed appointment: a tool that calls the existing writer and sets the `coordinator` role, with the authority consequence. | `WC-A69BCABB` leaves `conformance_pause` and its next tick advances a stage |
| **B** | Platform | The ownership ladder (§4) with unowned reporting; derivation from shape and orchestrator registry. | rooms resolve owners without appointment; unowned ones are listed |
| **C** | Platform | Bottleneck signal: paused, unowned, and non-advancing rooms become attention items that reach a human. | finding 1 could not happen silently again |
| **D** | Platform | Relation-derived hierarchy: `contains` yields the delegation tree; `escalates_to` wires upward to a human. | a stalled sub-room escalates to its parent's owner, then to `HR-*` |
| **E** | Platform | COO surface: cross-room progress, workload and span-of-control, schedules, broadcast-with-acknowledgement. | one view answers "is everything progressing, and where is it stuck" |
| **F** | Archetype | Archetype roster contract: which coworkers a business kind requires; coverage measurable against it. | findings 5 and 7 become a number per install |
| **G** | Archetype | `open-source-management` leaf; move the source-ops gate from category to leaf; declare its room set and roster **with the operator**. | this install runs its own archetype, not the generic one |
| **H** | Instance | Appoint owners for the live standing rooms; activate `coo-orchestrator`. | the room set runs with named owners |

A–C are the critical path to a room that actually executes. D–E make the COO real. F–G are the
archetype half. H is configuration.

## 10. Non-goals

- Not a new work ledger, not a second hierarchy — `WorkroomRelation` and the agent registry are
  the sources of truth.
- Not an org chart editor. Ownership derives; appointment is the exception, not the interface.
- Not autonomy for the COO — it reads, asks, escalates (§5).
- Not enumerating the open-source-management room set here (§6.1); that is a pass with the operator.
- Not changing what a shape's human-owned stages require, at any nesting depth.

## 11. Related

- [Proactive Workrooms](2026-08-29-proactive-workrooms-design.md) — rooms wake; this makes them owned
- [Work Posture](2026-08-22-workroom-work-posture-design.md) — the tighten-only ladder this mirrors
- [Workroom vocabulary boundary](../../architecture/workroom-vocabulary-boundary.md) — sub-rooms and the five relations
- [Work shapes and the decision gate](../../architecture/work-shapes-and-the-decision-gate.md) — the Process Overseer requirement this satisfies
- [DPF-PAAW](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md) §6, §9.5


## October 25 amendment: COO operational follow-through

**Backlog:** BI-4B48E7FE. Delivery slices: BI-756C899D (truthful progress) and
BI-C43FD3E5 (owned recovery supervision). **Status:** approved founder direction;
independent design review, implementation and served-runtime acceptance are pending.
This section supersedes the report-only interpretation in section 5 and the COO
persona's fixed Advisor/Phase 2 maturity switch. It does not assert deployment.

The founder approved making the COO responsible for seeing that platform,
business and cross-area work advances, including internal coworkers and external
execution surfaces. Workrooms were introduced after the original COO approach.
A role prompt that forbids background work and a weekly report that ends by
asking the owner to decide cannot implement that responsibility.

### Evidence and existing owners

The October 25 investigation in WC-32CD2D80 read the live development install.
WC-03D88204 retained a provider hold from October 19 and repeated
provider-held/capacity-wait observations while its conclusion said in motion.
The deployed drive calculated conclusion and hold before learning that dispatch
was held, then changed only the reason. Its stall clock recognized pause and
escalate, so other no-progress observations cleared the clock. These are confirmed
projection defects, not proof that every waiting room is broken.

BI-12A083B4 is delivered history for the conclusive-stop invariant; this repair
extends its existing owners. BI-IMP-9DA35549 owns learning and execution continuity;
BI-BF20F828 owns resumable review evidence. BI-CB690D61 established common
recoverability doctrine and does not claim fault injection of every adapter.
BI-D95FD249 separately owns scheduled delivery-author evidence authorization;
a supervisor must route that recorded blocker rather than approve old envelopes,
widen grants or reimplement its mandate. BI-65D75876 delivered the operator
Workroom composition; extend its loader and disclosure patterns.

### Objectives

**OBJ-COO-PROGRESS:** Distinguish verified progress, authorized execution, durable
waiting and owned blockage from scheduler activity.

**OBJ-COO-RECOVERY:** Make the COO accountable for recovery follow-through through
existing room coordinators, tasks, receipts and escalation boundaries.

**OBJ-COO-EXTERNAL:** Preserve the same obligation when an external executor,
conversation, credential or server process disappears.

**OBJ-COO-LEGIBILITY:** Give the human one clear view of outcomes and necessary
decisions, with current design, strategy and operating guidance aligned.

### One control loop, three responsibilities

The existing Workroom drive remains the lifecycle and dispatch authority.
The room's Process Overseer owns local stage conformance, blocker resolution
and escalation. The COO owns the cross-room recovery obligation and checks that
the assigned response produced evidence. The human owns strategic decisions,
changes to authority and other acts the existing action-specific policy reserves.

A supervisor may select an existing supported recovery action and request it
through the governed executor under current authority. It cannot manufacture
authority, become its own independent reviewer, transfer ownership silently or
turn a notification into a completed recovery.

The lifecycle is observe -> classify -> assign/request -> acknowledge -> recover
or wait -> verify. It reuses Workroom state and activity, ScheduledAgentTask and
TaskRun, existing request/receipt identities and the canonical room relations.
There is no second workflow engine, private chat task list or parallel work ledger.

### Progress and effective outcomes

Calculate the observed dispatch outcome before deriving conclusion, hold,
attention and user-facing state. Provider hold, lease contention, unavailable
reviewer, failed scheduling and successful enqueue need distinct truthful results.
Enqueue confirms a task exists; it does not confirm work started or completed.

Retain no-progress age across reason changes, heartbeats, repeated enqueue and
capacity waiting. Clear it only on a new completing evidence receipt or a
verified stage/graph-marking advancement. A new cycle has its own identity.
Legacy rooms with no usable progress anchor report unknown age; do not backdate
to updatedAt, which is also written by scheduler ticks.

Quiet posture, the next standing cycle, inactive delivery awaiting acceptance,
a recorded dependency and a genuine human decision are legitimate waits. Each
wait names its owner, trigger and next check or deadline. Waiting must not be
reported as abandonment or successful execution. A bounded execution window is
not itself a promise that a stage advanced.

### Durable supervision and recovery authority

Use the existing standing-room/task dispatch path for COO supervision, with the
same canonical COO identity as direct conversations. Changing optional briefing
cadence must not disable an already authorized Workroom recovery obligation.
Hard policy and explicit pauses still win; no activity is silently activated
merely because the installation is development.

The recovery state belongs to the affected Workroom and is keyed by room,
shape run, stage/graph iteration and last confirmed progress. It contains:

- the observed blocker and evidence references;
- local recovery owner and COO follow-through owner, both resolved principals;
- exact supported recovery request and its immutable task/receipt identity;
- acknowledgement deadline, next check and observable unblocking trigger;
- bounded attempts, last confirmed effect and any uncertain outcome;
- result evidence, verification disposition and any necessary human decision.

A transactional compare-and-set on the existing checkpoint revision fences
concurrent supervisors. Re-read current authority, admission, stage, budget and
request identity before every consequential action. A stored request grants no
authority. A lost response is reconciled through its existing result/receipt;
never issue a fresh request merely because the first result is not visible.

The first response may be a mechanical supported repair, an authorized coworker
request, a durable dependency wait or an actual human decision. Missing admission,
competent owner, required grant or reachable executor is a named blocker.
Resolve the recorded owner/offer or escalate the concrete authority decision;
do not guess a specialist from its display name or grant broad administration.
An assignment is acknowledged by an accepted task/receipt, not by prose.
At its deadline the same obligation is reconciled and, within the current budget,
retried or routed through the existing escalation policy. Closing requires
readable result evidence and the affected outcome's verification.

### Internal and external execution

Codex, Claude, Grok and embedded workers are adapters under the same Workroom
contract. The server owns the durable obligation; client hooks accelerate capture.
The checkpoint must retain objective, remaining acceptance, source/artifact
identity, dirty-output provenance, confirmed effects, pending intent, current
authority, blockers and next safe action, following workroom-cycle-continuity.md.
A replacement executor claims against the expected revision and reconciles before
replay. An unavailable desktop chat is explicitly unavailable; server scheduling
does not imply authority to wake or send to an arbitrary external conversation.

Provider recovery consumes an observed provider recovery signal or the existing
bounded probe/backoff policy. Capacity recovery follows actual queue capacity,
not an invented failure cause. Dependency completion rechecks the waiting stage.
No recovery cancels an independent gate, retries a possibly published effect
blindly or spends on an unapproved provider.

### Human experience and scalability

Extend the existing Workroom/portfolio projection: owner, last verified progress,
blocker, recovery action, acknowledgement/result, next check and necessary
decision. Technical evidence stays behind disclosure. The COO conversation
answers from that same durable projection. Notify once per unchanged decision;
a retry or heartbeat is not news. Completion and exhausted recovery are material
changes. Preserve a user-visible path to inspect every original item.

No full-inventory model turn every tick and no per-room query fan-out. Mechanical
classification uses the current bounded paginated inventory and due-recovery
selection; model judgment receives only changed/actionable records with a
continuation. Persist continuation after accepted processing. The initial
reconciliation budget is at most 100 candidate rooms and 10 recovery requests
per existing drive cycle; overflow remains due and explicitly incomplete,
oldest-due first. These are proposed implementation bounds, not current telemetry.
Scale beyond one install follows the existing sovereign-install control-plane
boundary; this work does not centralize peer data or mutate paired records.

### Acceptance contract

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-COO-01 | OBJ-COO-PROGRESS | Effective provider/lease/dispatch outcomes, conclusions, holds and operator projections agree; an attempted dispatch never claims confirmed execution. |
| AC-COO-02 | OBJ-COO-PROGRESS | No-progress age survives reason changes, heartbeat and retry ticks; verified advancement clears it, while legitimate waits retain their trigger and next check. |
| AC-COO-03 | OBJ-COO-RECOVERY | The COO owns cross-room follow-through through the existing authorized process: every stalled actionable item has a recovery owner, action, acknowledgement deadline, next check and independently readable result. |
| AC-COO-04 | OBJ-COO-EXTERNAL | Internal and external executors recover from durable Workroom state within existing authority; missing/unreachable runtime is explicit, and duplicate effects and blind retries are prevented. |
| AC-COO-05 | OBJ-COO-RECOVERY, OBJ-COO-LEGIBILITY | Human escalation contains a specific necessary decision or exhausted authorized recovery, and routine unchanged state does not repeatedly notify the founder. |
| AC-COO-06 | OBJ-COO-LEGIBILITY | Canonical design, architecture, strategy, COO skill/task/persona and user guidance consistently describe the current Workroom-based operating model and distinguish deployed behavior from pending acceptance. |
| AC-COO-07 | OBJ-COO-PROGRESS, OBJ-COO-RECOVERY, OBJ-COO-EXTERNAL | Served-runtime evidence proves provider recovery, interrupted external executor and resolved dependency continuation without founder nudges, plus one genuine human decision routed once. Unit/source checks alone do not close operational acceptance. |

Negative controls retain refused authority, canceled work, independent review,
explicit pause and stale-executor fences. Restart/duplicate/uncertain-effect
cases must be exercised. The observation window starts only when the canonical
release containing the repair is served. No unit test or completed backlog label
substitutes for that operational evidence.

### Research & Benchmarking

Research checked October 25, 2026; no new dependency is adopted.

- [Kubernetes controllers](https://kubernetes.io/docs/concepts/architecture/controller/):
  adopt observed-versus-desired reconciliation through the owning API; reject
  treating a scheduler wake as evidence the desired outcome was reached.
- [Temporal event history](https://docs.temporal.io/encyclopedia/event-history):
  adopt durable execution identity and recoverable confirmed-event history;
  reject another engine or an assumption of exactly-once external effects.
- [BMAD autonomous loops](https://docs.bmad-method.org/): benchmark the existing
  delivery-lifecycle comparator and explicit change/review/test stages. Adopt
  scoped work and acceptance separation; reject making a client-local loop the
  platform's recovery guarantee.
- [Camunda job workers](https://docs.camunda.io/docs/components/concepts/job-workers/):
  adopt acknowledged completion/failure and bounded retries with incidents;
  reject reporting queue activation as completion.
- [AWS Step Functions error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html):
  adopt explicit retry/catch and bounded fallback outcomes; reject uniform blind
  retries for authorization failures, uncertain publication and real human gates.

### Delivery, compatibility and rollback

The source/API/database owners are the existing Workroom, task and activity
facilities. Additive JSON projection fields must retain legacy readers and fail
closed on malformed identities. No schema migration, grant expansion or
installation teardown is implicit in this design. An implementation needing one
must state it in its independent review and migration plan.

Ship truthful progress as BI-756C899D, then supervision as BI-C43FD3E5. Reuse the
existing operator composition and review/continuity owners. At least 20 percent
of implementation effort consolidates duplicated effective-outcome, progress,
recovery and UI projections. This is the owner's task direction; funding-scope
authority remains separately resolved rather than inferred from the install.

Rollback stands down new supervision dispatch, preserves obligations/checkpoints
and existing task results, and returns to the previous release through the
governed release path. It must never clear a queue hold, lose a pending decision,
discard history or convert unverified recovery to success.
