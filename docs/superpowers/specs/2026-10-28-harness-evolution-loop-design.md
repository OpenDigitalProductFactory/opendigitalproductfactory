---
status: draft
---

# Workroom-owned harness evolution — Slice 6 "Evolution lab" of the Governed Hermes learning loop

| Field | Value |
| --- | --- |
| Date | 2026-10-28 |
| Backlog | BI-49BC21C1 (epic EP-C00F61F4, improvement is a platform facility) |
| Extends | [Governed Hermes learning loop](2026-05-15-governed-hermes-learning-loop-design.md) §6.5, §8.4, Slice 6; [Workroom flow map and measurement](2026-10-02-workroom-flow-map-and-measurement-design.md) §8 |
| WWMD decision | DI-E6FA02FCC221: platform-only, not a client cron |
| Source pattern | Harness² (Google Research, arXiv 2610.14224; github.com/google-research/harness2) |

This design delivers the Hermes spec's Slice 6 and fixes the shape it takes.
The Hermes spec described a sandboxed experiment flow for skills. This design
keeps the flow and changes two things:

- **What is improved:** a Workroom's *harness*. That means its work shape
  version, stage briefs, role grants, the skills and tools bound to it, and the
  coworker prompts. Harness² edits the same kind of files around a frozen
  model.
- **Who improves it:** the room that owns that harness, not a central job.

## Founder direction (2026-10-28)

> "The workrooms are mainly responsible for the specific improvements in there,
> that's the pattern. Each ai coworker and each human interaction amounts to
> what needs improvement. The variability per archetype will add nuances, but
> the core aspects are the same. Development of features on the platform, being
> self-improvement at ring 0 so to speak, is just the first aspect, which we
> own. The archetype and ancillary areas that are associated with the platform
> itself are layers on top."

This design reads that as five rules:

1. **The unit of improvement is the Workroom.** Every coworker turn and every
   human interaction in a room is a trajectory. A recurring miss in the room is
   that room's improvement signal.
2. **There is one core loop.** Signal schema, probe and compose rules,
   KEEP_BASE and budget caps are the same in every room.
3. **Layers add variation without forking the core.** Ring 0 (platform
   development) comes first and is ours. Archetype layers (a vet clinic's
   intake room, a SOC room) and ancillary layers sit on top. Each adds its own
   facts and probes and uses the same core.
4. **The library is scoped by room, shape and layer.** An edit is promoted
   upward (room → shape → archetype → core) only when it wins its probe in more
   than one room. The paper found libraries overfit and transfer weakly (+0.5
   to +2.9), so a single room's win stays in that room.
5. **The daily platform job aggregates; it does not improve.** It rolls up room
   records, spots cross-room recurrences for promotion and enforces budget. It
   never rewrites a room's harness from outside.

A further direction from the founder on the same day:

> "A few key aspects on the improvements is use of WWMD, WWWD and WSID to
> guide decisions. The GPP standard was implemented for the most part to
> re-factor this as advisory prose, and to make sure we are getting specific
> permissions for specific actions without needing to ask a human for
> guidance. This prose to vector maintenance and improvements is a key aspect
> that the research doesn't currently tackle."

It adds three rules:

6. **Each edit is decided in its owning scope.** WWMD decides platform edits,
   WWWD decides business and archetype edits, and WSID decides craft edits.
   This follows `decisions-belong-to-their-scope`.
7. **Authority comes from a permit, not a person.** A room adopts an edit under
   a narrow GPP permit for that specific action. An approval card is not the
   path.
8. **Prose-to-vector is a first-class improvement.** The loop does more than
   add text. It moves enforcement out of advisory prose into vectors: gates,
   permits and decision vectors. The prose stays as the advisory reasoning
   behind them. Harness² does not model this; it edits only text.

## Why

Detection already exists; closure does not. On 2026-10-28 detectors had filed
about 1,370 improvement items (MCP efficiency 117, tool stabilization 110,
convention 28, crash/PIR 1,112), and about 28 were done. Mining 86 Claude
sessions found about 15 recurring plumbing failures. They are filed as sibling
items under EP-C00F61F4 and are ring-0 signals.

Harness² shows what closes the gap:

- Edits around a frozen model lifted GLM5 from 64.2 to 75.7 on WorkBuddy.
- The probe carries the result. Without probes the ablation fell from 73.4 to
  63.2, below baseline.
- The library was worth 3.1 points.

DPF's own first attempt confirms the probe matters. A cheap candidate edit,
trigger lines for 49 skills, was rejected (KEEP_BASE) once a probe found zero
invocations, a shrink-only ratchet and an invariant coupling two fields.

The rooms already produce the evidence. In the seven days to 2026-10-28, 136
active rooms declared a delivery shape:

| Shape | Rooms |
| --- | --- |
| delivery-medium | 62 |
| delivery-small | 50 |
| delivery-large | 16 |
| delivery-xlarge | 6 |
| delivery-break-fix | 2 |

Failed tool executions carrying a room's `capsuleId` recur inside single rooms.
`record_workroom_evidence` was refused `authority_denied` 55 times in
WC-76590268, and in seven or more other rooms. That is a room signal and,
because it recurs across rooms, also a promotion candidate.

## Why typed orchestration

The prompt-only daily review `mcp-efficiency-aiops-YYYYMMDD` ends `error` on
most days since 2026-09-02 with "required governed tool create_backlog_item
executed zero times" (BI-A8679D84). The coworker narrates the call instead of
making it. The typed kinds `decision-engine-review`, `demand-scoring-steward`
and `acceptance-sweep` run `ok`.

So both orchestration levels are code:

- the room-level derivation;
- the daily aggregate.

Model judgement is confined to the bounded editor and composer steps of
slice 2, each with its own budget.

## Objectives

**OBJ-1:** Every ring-0 delivery Workroom carries its own improvement record: its recurring misses, drawn from its own coworker turns and human interactions, become room-scoped candidate harness edits recorded on the room with the trajectory evidence behind them.

**OBJ-2:** The loop is one core with layers: signal schema, probe and compose rules, KEEP_BASE and budget are identical in every room, and archetype and ancillary layers add facts and probes without forking that core.

**OBJ-3:** A room adopts a harness edit only when a hermetic probe on that room's recorded traces shows it beating the unmodified baseline; KEEP_BASE is recorded as a first-class outcome on the room.

**OBJ-4:** Outcomes go to a library scoped by room, shape and layer; later runs in rooms of the same shape read it, and an edit is promoted upward only when it wins its probe in more than one room, through governed change.

**OBJ-5:** A daily platform aggregator, with no client installed, rolls up room records, names cross-room recurrences for promotion, enforces the budget and records spend; a weekly rollup shows each targeted signal's recurrence before and after adoption.

**OBJ-6:** Each edit is guided by the doctrine of its owning scope (WWMD, WWWD or WSID), adopted under a narrow GPP permit for that specific action rather than a person's approval, and preferred when it converts advisory prose into an enforced vector while keeping the prose as its reasoning.

## Acceptance

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-5 | `harness-evolution-loop` is a member of `SCHEDULED_AGENT_TASK_KINDS`, the scheduler's deterministic dispatcher runs it with no model call, and every install's seed creates the daily task with an accountable owner. |
| AC-2 | OBJ-1 | For each active room whose declared shape is a ring-0 delivery shape, a miss key that recurs at least `minRecurrence` times in the window (a failed tool execution carrying the room's `capsuleId`, keyed by tool and refusal code, or a miss-kind room activity) becomes a candidate carrying the room, its shape version, the layer `ring-0`, the actor (coworker or human), a component hint and up to five trajectory references. |
| AC-3 | OBJ-1 | A room with candidates gets one `harness-evolution-candidate` activity per UTC day, idempotent on `(harness-evolution, <capsuleId>:<day>)`, so the candidates are visible on the room's own timeline. |
| AC-4 | OBJ-5 | Each run writes one proactive TaskRun per UTC day whose `progressPayload` holds the clamped budget (rooms, candidates per room, total candidates, probe replays, token cap) and the spend; the run's artifact lists cross-room recurrences (the same shape key and miss key in at least two rooms) as promotion candidates, and the configured ring-0 platform queue with each missing or terminal item's reason. |
| AC-5 | OBJ-2 | The candidate derivation takes the layer and the miss-kind table as data, so an archetype layer supplies its own shapes and miss kinds without a second code path. |
| AC-6 | OBJ-3 | Slice 2: a room's candidate edit is probed by the WorkPattern experiment runtime as a baseline-versus-candidate pair on that room's hermetic replay fixture, with no network route to a grader or rubric, within the room's caps, and the verdict (ADOPT or KEEP_BASE) is recorded on the room. |
| AC-7 | OBJ-4 | Slice 3: an ADOPT verdict changes the room's harness only through governed change (a shape version bump or a seed PR via `seed-pull-request.ts`), and every outcome writes an EXPERIENCE record keyed by room, shape and layer to the work-pattern effective ledger, which later runs in the same shape read. |
| AC-8 | OBJ-4 | Slice 3: the aggregator proposes an edit for the shape or core layer only when the same edit has won its probe in at least two rooms. |
| AC-9 | OBJ-5 | Slice 4: a weekly rollup lists each targeted miss key's recurrence per room and shape before and after its edit landed. |
| AC-10 | OBJ-6 | Every candidate carries the room's decision scope (falling back to the layer's: WWMD for ring 0), and a tool miss whose refusal code means missing authority (`authority_denied`, `approval_required`, `permission_denied`, `grant_missing`, `workroom_access_denied`) is hinted `gpp-permit`. |
| AC-11 | OBJ-6 | Slice 2: before proposing an edit, the editor runs `principle_decide` in the candidate's scope and records the decision id on the candidate; an edit the scope does not support is KEEP_BASE without a probe. |
| AC-12 | OBJ-6 | Slice 3: adoption executes under a GPP permit scoped to the edit's action and room, and the run asks no person; a `gpp-permit` candidate's edit is the permit grant itself, probed like any other edit. |
| AC-13 | OBJ-6 | Slice 3: an edit that replaces always-on advisory prose with a gate, permit or decision vector records the prose characters retired and the vector added in its EXPERIENCE record, and keeps the prose's rationale as advisory text the vector cites. |

## Design

### One core, layered

The core is three things, written once:

- the miss-event schema;
- the candidate derivation;
- the budget clamp.

A **layer** is data: a name, the shape keys it covers and a miss-kind table.
Ring 0 is the first layer. It covers the `delivery-*` shapes in
`lib/work-management/work-shapes.ts` (`WorkShapeDefinition`). An archetype
layer later passes its own shape keys and miss kinds to the same functions.
The shape version is the experiment unit, as in the flow-map design §8: a
room's declared `workShape` ref (`delivery-medium@1.0.0`) is recorded on every
candidate. A countermeasure that ships as a version bump then shows before and
after on the same queue key.

### The room loop

Each room owns four steps. The paper calls them propose, probe, compose and
library.

1. **Signal and candidate** (slice 1, deterministic). The room's misses in the
   window are grouped by miss key. Keys that recur become candidates, recorded
   on the room.
2. **Propose and probe** (slice 2). A bounded editor writes one edit to the
   room's harness per candidate. The WorkPattern runtime replays the room's
   traces against baseline and candidate.
3. **Compose** (slice 3). Winning edits that do not conflict are composed into
   one governed change for the room's shape.
4. **Library** (slice 3). Each outcome, ADOPT or KEEP_BASE, becomes an
   EXPERIENCE record scoped by room, shape and layer.

### Slice 1 — room-scoped candidates and the aggregator

**Rooms.** Active rooms are those not archived, with status in `working`,
`ready`, `blocked`, `verifying`, `ready-for-review` or
`ready-for-promotion`, and updated inside the window. A room whose declared
shape key is in the layer's shape set is in that layer. Rooms are read
newest-updated first, up to `maxRooms`.

**Misses.** Every miss is a trajectory moment with an id:

- *Coworker turns:* failed `ToolExecution` rows whose `parameters.capsuleId`
  is the room. The miss key is `tool:<toolName>:<code>`, where the code is the
  refusal code before the first colon of `result.error`, cut to 60
  characters.
- *Room activity:* `WorkCapsuleActivity` rows of a miss kind. The ring-0 table
  is below.

| Activity kind | Actor | Component hint |
| --- | --- | --- |
| `command-rejected` | coworker | stage brief |
| `runtime-verification-failed` | coworker | gate, hook or script |
| `provider-blocked` | coworker | role grant |
| `error` | coworker | unclassified |
| `status-override` | human | stage brief |
| `workroom-drive-attention` | human | stage brief |

Tool misses hint `skill-tool`, because a tool's contract or its description is
the first place to look. The exception is a refusal code that means missing
authority (`authority_denied`, `approval_required`, `permission_denied`,
`grant_missing`, `workroom_access_denied`). Those hint `gpp-permit`: the room
lacks a specific permission for a specific action, and a person's approval is
the wrong fix. The hint is advisory. Slice 2 confirms it through
`improvement-flywheel/routing-answer.ts`.

**Decision scope.** Each candidate records the scope whose doctrine guides
it. That is the room's own `decisionScope` when it has one; otherwise it is
the layer's default. Ring 0 defaults to WWMD. On 2026-10-28, 135 active rooms
recorded `wwmd`, 1 recorded `wsid` and the rest recorded none.

**Candidates.** A miss key that recurs at least `minRecurrence` times
(default 2) in the window becomes a candidate. It carries:

- room, shape ref and layer;
- miss key and actor;
- recurrence and last-seen time;
- component hint;
- up to five trajectory references.

A room keeps at most `maxCandidatesPerRoom`, highest recurrence first. Ties
break on newest, then on miss key, so the same data gives the same order. A
key below threshold is counted, not recorded. Every candidate traces to a
named trajectory moment by construction; this is the Harness² editor rule,
applied before any spend.

**Room record.** A room with candidates gets one
`harness-evolution-candidate` `WorkCapsuleActivity` row. Its
`commandScopeKey` is `harness-evolution` and its `commandKey` is
`<capsuleId>:<YYYY-MM-DD>`. The existing unique index on that pair makes a
same-day retry a no-op. The candidates are visible where the room's work is.

**Aggregator.** The typed `ScheduledAgentTask` kind `harness-evolution-loop`
is dispatched by `runDeterministicScheduledTaskKind` to
`executeHarnessEvolutionLoopTask`. The seed creates
`harness-evolution-loop-daily` for `platform-engineer` (AI Ops Engineer),
daily at 04:17 UTC, owned through `findTaskOwnerUserId`. `taskConfig` is
written on create only.

Each run does five things:

1. Derives candidates for every ring-0 room within budget and records them on
   the rooms.
2. Groups candidates by shape key and miss key across rooms. A group in two or
   more rooms is a **cross-room recurrence**: a promotion candidate for the
   shape layer, pending probe wins in each room (AC-8).
3. Reads the open `workroom-flow-bottleneck` improvement signals for ring-0
   shapes (flow-map §8). These are shape-level evidence beside the
   room-level candidates.
4. Reports the configured ring-0 platform queue (`taskConfig.seedItemIds`,
   the EP-C00F61F4 siblings) with each missing or terminal item's reason.
5. Writes one proactive `TaskRun` per UTC day. Its `repeatedPatternKey` is
   `harness-evolution:<day>`, its `progressPayload` holds budget and spend,
   and a `harness-evolution-aggregate` `TaskArtifact` sits under it.

The aggregator never edits a room's harness.

**Budget and spend.** The caps live in `taskConfig` and are clamped in code:

| Cap | Range | Default |
| --- | --- | --- |
| `maxRooms` | 1–200 | 50 |
| `maxCandidatesPerRoom` | 1–10 | 3 |
| `maxCandidates` (whole run) | 1–200 | 50 |
| `maxProbeReplays` | 0–200 | 20 |
| `tokenCap` | 0–2,000,000 | 200,000 |
| `lookbackDays` | 1–30 | 7 |
| `minRecurrence` | 2–20 | 2 |

Slice 1 records zero tokens and zero replays rather than omitting them. The
upstream repository has no spend cap (its issue #4).

**No schema change.** One activity kind joins `WORK_CAPSULE_ACTIVITY_KINDS`.
TaskRun, TaskArtifact, WorkCapsuleActivity, ToolExecution, ImprovementSignal
and ScheduledAgentTask already have every field this slice reads or writes.

### Slice 2 — propose and probe, per room

- **Editor.** A bounded editor writes one edit to the room's harness per
  candidate, under the Harness² Appendix H rules:
  - The edit traces to the candidate's trajectory moments.
  - Component priority: gate, hook or script first, then a skill with a
    trigger line, then a sub-agent, then always-on prose last. Any always-on
    text added cuts an equal amount, because `check-instruction-plane-size.mjs`
    is shrink-only.
  - It never changes the deliverable's shape.
  - It never invents authority, identifiers or citations.
  - Facts copied from the library are hypotheses and are re-verified.
- **Probe.** A harness-text variant kind for the WorkPattern experiment
  runtime, keyed on `promptOrSkillDigest`, runs a factorial
  baseline-versus-candidate pair on the room's hermetic replay fixture
  (`work-pattern-experiment-fixture.ts`, `build/work-pattern-build-replay.ts`,
  `queue/functions/work-pattern-experiment.ts`).
- **Hermetic.** Probes have no network route to graders or rubrics; the paper
  saw an agent download its own grading rubric. Private-data classes follow
  the memory shape contracts spec (Hermes §15.2 Q3).
- **Judge.** The judge weighs delivery, conformance, fidelity, consistency
  and fitness, not length. Where it can be avoided, the editor and the judge
  are not the worker's model family.
- **Spend.** Replays and tokens count against the room's and the run's caps.

### Slice 3 — compose, library and promotion

- **Compose.** A room's ADOPT edits land through governed change: a shape
  version bump for shape-owned harness, or `skills/seed-pull-request.ts` for
  skills and prompts. Room-owned coworker controls (PR #5263) stay the room's.
  Nothing writes a live harness directly.
- **Library.** `work-pattern-effective-ledger.ts` gains an EXPERIENCE record
  keyed by room, shape and layer. Each record names the weakness, the
  trajectory moments, the probe contrast and what was dropped.
- **Promotion.** The aggregator proposes an edit for the shape layer when it
  has won in two or more rooms of that shape, and for the core when it has
  won across shapes.

### Decision guidance, permits and prose-to-vector (slices 2–3)

The rest of the loop is steered, in this order:

1. **Scope first.** The editor reads the candidate's `decisionScope` and runs
   `principle_decide` there before it writes anything:
   - WWMD for platform harness;
   - WWWD for a business or archetype room;
   - WSID for craft.

   The decision id goes on the candidate. A scope that does not support the
   edit ends the candidate as KEEP_BASE, with no probe spent. That applies
   the commandment `consult-scopes-before-asking` to the loop itself.
2. **Permit, not approval.** Adoption runs under a GPP permit scoped to the
   edit's action and room. A `gpp-permit` candidate is the case where the edit
   *is* a permit: for example, the narrow grant that would stop
   `record_workroom_evidence` being refused `authority_denied` in a room
   where that write is the room's own work. It is probed like any edit,
   replaying the room's traces with and without the grant.
   - **Dependency.** GPP cannot steer yet. Permits are minted by an approval,
     not consulted before one, and their lineage is unsealed (BI-6B610D94,
     BI-035BE8D1, BI-E458A9CB). Until those land, slice 3 records the permit
     an edit needs and routes adoption through the governed PR path. It does
     not invent an authority channel.
3. **Prose to vector.** An edit class of its own. It replaces enforcement
   that lives in always-on advisory prose with a vector the platform
   enforces: a gate, a permit, a decision vector or a shape stop condition.
   The prose stays as the advisory reasoning the vector cites; GPP keeps
   advisory text as reasoning and permits as authority. The EXPERIENCE record
   counts the prose characters retired and the vector added. Retiring
   always-on prose is how the loop keeps `check-instruction-plane-size.mjs`
   shrinking while behaviour gets stricter. The selection judge treats an
   equal-contrast edit that retires prose as the better one.

### Slice 4 — weekly rollup

The rollup lists recurrence per miss key, room and shape before and after each
adoption. The target is a miss that stops recurring.

## Not taken from Harness²

- **No unbounded search.** Every room and run is capped.
- **No central rewriting.** Rooms own their harness; the aggregator only
  promotes.
- **No client cron.** DI-E6FA02FCC221.

## Delivery and backlog

| Slice | Item | Covers |
| --- | --- | --- |
| 1 | BI-49BC21C1: room-scoped candidates on ring-0 rooms, typed aggregator, budget and spend, decision scope and permit-gap hint | AC-1 – AC-5, AC-10 |
| 2 | Child of BI-49BC21C1: per-room editor guided by its scope, plus harness-edit probe variant | AC-6, AC-11 |
| 3 | Child of BI-49BC21C1: compose under GPP permits, scoped EXPERIENCE library, prose-to-vector accounting, cross-room promotion (depends on BI-6B610D94) | AC-7, AC-8, AC-12, AC-13 |
| 4 | Child of BI-49BC21C1: weekly before/after rollup | AC-9 |

This design stays `draft` until an independent reviewer passes its
spec-approval gate.

## Design grounding

**Specs:**

- the Hermes learning loop (§6.5, §8.4, Slice 6, §15.2);
- the workroom flow map (§8, cron `workroom-flow-review`);
- [continuous improvement flywheel](2026-04-05-continuous-improvement-flywheel-design.md);
- [coworker memory shape contracts](2026-05-14-coworker-memory-shape-contracts-design.md).

**Code:**

- `apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts`
- `apps/web/lib/actions/agent-task-scheduler-deterministic.ts`
- `apps/web/lib/demand/scoring-steward-task.ts`
- `apps/web/lib/work-management/work-shapes.ts` (`readDeclaredWorkShapeKey`)
- `apps/web/lib/work-capsules.ts` (`WORK_CAPSULE_ACTIVITY_KINDS`)
- `apps/web/lib/work-capsules/work-capsule-activity-store.ts`
- `apps/web/lib/operate/mcp-call-efficiency/report.ts` (the `result.error` projection)
- `apps/web/lib/tak/work-pattern-effective-ledger.ts`
- `apps/web/lib/tak/work-pattern-experiment-types.ts`
- `packages/db/src/seed-demand-scoring-steward.ts`

**Live state:** read 2026-10-28 and quoted under "Why".
