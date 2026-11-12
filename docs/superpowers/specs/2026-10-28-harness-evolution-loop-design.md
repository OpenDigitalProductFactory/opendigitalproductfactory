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
| AC-6 | OBJ-3 | Slice 3: a room's candidate edit is probed by the WorkPattern experiment runtime (as the `trace-replay-v1` fixture kind) as a baseline-versus-candidate pair on that room's hermetic replay fixture, with no network route to a grader or rubric, within the room's caps, and the verdict (ADOPT or KEEP_BASE) is recorded on the room. |
| AC-7 | OBJ-4 | Slice 3: an ADOPT verdict changes the room's harness only through governed change (a shape version bump or a seed PR via `seed-pull-request.ts`), and every outcome writes an EXPERIENCE record keyed by room, shape and layer to the work-pattern effective ledger, which later runs in the same shape read. |
| AC-8 | OBJ-4 | Slice 3: the aggregator proposes an edit for the shape or core layer only when the same edit has won its probe in at least two rooms. |
| AC-9 | OBJ-5 | Slice 4: a weekly rollup lists each targeted miss key's recurrence per room and shape before and after its edit landed. |
| AC-10 | OBJ-6 | Every candidate carries the room's decision scope (falling back to the layer's: WWMD for ring 0), and a tool miss whose refusal code means missing authority (`authority_denied`, `approval_required`, `permission_denied`, `grant_missing`, `workroom_access_denied`) is hinted `gpp-permit`. |
| AC-11 | OBJ-6 | Slice 2: before any edit is written, the room runs `principle_decide` in the candidate's scope over KEEP_BASE and every probed variant, each option carrying the features its replay measured, and records the decision id on the verdict; an option the scope does not support is KEEP_BASE, and a scope that cannot answer (no recommendation, low confidence, insufficient signal, or no route) produces a kernel-gap record instead of an edit. |
| AC-12 | OBJ-6 | Slice 3: adoption executes under a GPP permit scoped to the edit's action and room, and the run asks no person; a `gpp-permit` candidate's edit is the permit grant itself, probed like any other edit. |
| AC-13 | OBJ-6 | Slice 3: an edit that replaces always-on advisory prose with a gate, permit or decision vector records the prose characters retired and the vector added in its EXPERIENCE record, and keeps the prose's rationale as advisory text the vector cites. |
| AC-14 | OBJ-3 | Slice 2: every probe records, for the baseline and each variant on the same recorded trace, the outcome (intents completed), the load per rung (human units, AI units, code-carried units, tokens) and the gate burden (refusals per success, recovery turns, share of refusals naming the exact next call). |
| AC-15 | OBJ-3 | Slice 2: a variant that raises human load is never ADOPT, whatever its outcome; a variant that lowers the outcome, moves load up the ladder, or raises refusals per success without an outcome gain is KEEP_BASE; a variant that moves no load down and gains no outcome is KEEP_BASE. |
| AC-16 | OBJ-3 | Slice 2: between passing variants of equal or better outcome and no more human load, the gate inside the tool wins, then a refusal naming the next call, then a permit; an ADOPT that moves load into code carries the condition that the code is verified against the real host before it lands. |
| AC-17 | OBJ-1 | Slice 2: at least one live ring-0 candidate from slice 1's records completes a probe on the dev install, and its verdict (`harness-evolution-verdict` activity) is visible on the room with its deltas, its scope decision id and its variants. |
| AC-18 | OBJ-2 | Slice 2: every miss, candidate, cross-room recurrence and verdict records its executor (Claude, Codex, Grok, Build Studio, in-platform coworker, human or unknown); a miss two or more executors share is a `core` edit, and one executor's miss is that executor's layer (`executor:<name>`). The tool miss key `tool:<toolName>:<refusal code>` is the one key detectors converge on. |
| AC-19 | OBJ-5 | Slice 2: a candidate is probed only when it passes the BI-CE564FBB operating criteria: it recurs in two or more distinct runs, its shape repeats at least the weekly floor, it clears the cost-per-occurrence floor, it is not parked after two consecutive KEEP_BASE verdicts, its room is not inside its control limits, and the probe's spend does not exceed frequency × cost × horizon; every skipped candidate is recorded with its reason. |

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

### Slice 2 — probe and scope verdict, per room

Founder direction for this slice, 2026-10-28:

> "We want to move human cognitive load to AI cognitive load then into code,
> so part of the assessment on improvements is this. We have GPP as another
> wrinkle, which makes gate to tool an additional burden, but for better
> results ideally. The use of WWMD, WWWD, and WSID comes into key improvement
> territory with this effort too."

**The probe.** A room's tool candidate (`tool:<name>:<code>`) is replayed on
the room's own recorded calls of that tool, successes included, inside the
lookback window (`probe.ts`):

- The calls group into **intents**. An intent is one thread's run of calls,
  closed by a success.
- The baseline is the trace as recorded.
- Each variant is a deterministic model of one edit, applied to the same
  calls under one pair key:

| Variant | What the edit does | How the replay applies it |
| --- | --- | --- |
| `in-tool-resolution` | The tool resolves, expands or rewrites the input itself | Each target refusal becomes a code-carried unit; the intent's first call succeeds |
| `named-next-call` | The refusal names the exact next call | One refusal, then the intent's closing call; an intent that never succeeded still does not |
| `gpp-permit` | A narrow permit for this action in this room (permit-gap codes only) | The call succeeds. While permits are minted by an approval, each single-use grant costs one human unit (BI-6B610D94) |

The probe is hermetic: no network, no model call, no grader. The trace is
real recorded data, so the replay is a real-data check of the edit's model.
An edit that moves load into code still owes a check of that code on the
real host before it lands. That is recorded as the condition
`verify-encoded-rule-on-real-host`; a gate that measures the wrong thing is
worse than prose.

**The three axes** (AC-14):

1. **Outcome:** intents completed out of intents.
2. **Load by rung:** human units, AI units, code units and tokens.
   - Human units: approval cards routed to a person (`approval_required`),
     the room's human miss activity (`status-override`,
     `workroom-drive-attention`), and DecisionInteraction rows escalated to a
     person that name the room.
   - AI units: model-turn calls, with their tokens.
   - Code units: refusals resolved inside a tool with no model turn.
3. **Gate burden:** refusals per success, recovery turns after a first
   refusal, and the share of refusals that named the exact next call. A
   refusal names it when its result carries `data.nextAction` or
   `data.recovery`, or when its message names another tool.

**The rules** (AC-15, AC-16) run in `judgeVariant`:

- A variant that raises human load fails, whatever its outcome.
- A variant also fails if it lowers the outcome, moves load up the ladder,
  or raises refusals per success with no outcome gain.
- A variant that moves no load down and gains no outcome fails as `no-gain`.
- Among passing variants of equal or better outcome and no more human load,
  the order of preference is the gate inside the tool, then a named next
  call, then a permit.

**The scope decides** (AC-11, `scope-verdict.ts`). The room calls
`principle_decide` through the in-process executor, the path Build Studio's
decision service uses.

- **Routing.** WWMD maps to `decisionDomain: platform-development`, and WWWD
  to `org-business`. WSID is answered by `evaluate_profession_decision`,
  which this loop does not call yet. A WSID candidate therefore records the
  kernel gap `scope-route-unavailable`.
- **Options.** The options are KEEP_BASE and every variant. Each carries
  measured features:
  - `human_cognitive_load` and `operator_effort`: costs, high is worse;
  - `speed_to_value`: the completion rate;
  - `evidence_density`;
  - `reversibility`.

  So the scope reasons over vectors, not prose.
- **Verdict.** The decision id goes on the verdict. The hard rules still
  veto the scope's pick.
- **Kernel gaps.** An unanswerable scope files a kernel gap through
  `createOrTouchImprovementSignal` (`sourceType: "kernel-gap"`, keyed on
  scope and miss key). Unanswerable means no recommendation, low confidence
  or insufficient signal. Each day the gap persists counts as a recurrence;
  once it recurs enough it reaches the backlog through the signal's own
  threshold. A question answered once in doctrine is not asked again. A scope
  that could not be reached at all is recorded as `scope-unavailable`
  KEEP_BASE, not as a doctrine gap.

**Worth probing at all** (AC-19; BI-CE564FBB). Harness² got most of its
gain from the first round: K=1 at about 8× tokens. K=5 cost about 40× and
added only +3.3. So a candidate is screened before any replay is spent. The
criteria live in `improvement-criteria.ts`, a local stub with BI-CE564FBB's
defaults, until that item's typed configuration lands. The placeholders below
are owned by this slice and retire when that configuration merges (#6895): the
stub then re-exports `continual-improvement/operating-criteria`, with no change
at the call sites.

A candidate is skipped when any of these holds:

- it recurred in fewer than 2 distinct runs or sessions (`single-run`);
- its shape runs under the weekly floor (`shape-too-rare`; placeholder 3 a
  week, since the item names no number);
- the refusal plus its recovery turns cost under the floor
  (`below-floor`; placeholder 1 AI turn);
- it has two consecutive KEEP_BASE verdicts (`parked-after-keep-base`);
- its room sits inside its control limits (`inside-control-limits`; not yet
  evaluated, and an unevaluated room is never skipped);
- the probe's spend would exceed frequency × cost × a 4-week horizon
  (`spend-exceeds-savings`).

The screen runs in two steps. Runs, shape repetition and parking need no
trace, so they are checked first. Cost and savings are checked after the
room's trace is read and before any replay. K starts at 1 and rises only when
K=1 kept the base on a miss in the top cost decile. The TaskRun records each
skipped candidate with its reason next to the verdicts.

**On the room** (AC-17). Each probed candidate gets one
`harness-evolution-verdict` activity per room, miss key and day. It carries
the verdict, the chosen variant, the deltas, the baseline, every variant's
assessment and reasons, the scope decision id and the kernel-gap signal.

Activity candidates have no deterministic edit model yet, so they are listed
as `no-variant-model`, not guessed. Probes stop at `maxProbeReplays`, at most
four replays per probe; the remainder is listed as `probe-budget`.

**Spend.** Recorded on the TaskRun:

- probe replays;
- scope decisions;
- tokens, which stay zero because replays are deterministic and the consult
  is kernel scoring. The slice-3 editor is the first spender.

**First real-data probe** (read-only dry run, 2026-10-28). WC-76590268 is a
`delivery-medium` room with 7 days of `record_workroom_evidence` calls: 87
calls, 55 refused `authority_denied`, 32 intents, all of them eventually
completed. Its refusal message names no next call. The run's inputs and this
table are recorded as evidence on BI-B8DAEB71, and its scope consult is
DecisionInteraction DI-60AFDA89DD6D (`in-tool-resolution` recommended,
composite 2.845, margin 0.131). It ran `probe.ts` read-only over that room's
ToolExecution rows; it is not the live verdict AC-17 requires.

| Option | AI units | Code units | Human units | Refusals per success | Judgement |
| --- | --- | --- | --- | --- | --- |
| Baseline | 87 | 0 | 2 | 1.72 | — |
| In-tool resolution | 32 | 55 | 2 | 0 | Pass; real-host check required |
| Named next call | 47 | 0 | 2 | 0.47 | Pass |
| Permit grant | 32 | 0 | 17 | 0 | Fail: raises human load, because permits are still minted by approval |

### Executors are a layer, not a separate loop

Founder direction, 2026-10-28:

> "We have codex installed on this system, and it too is running into all
> sorts of odd obstacles… Lets make sure that internal and external ai work is
> part of the improvement scope."

A room's trajectories include turns by Claude, Codex (and its guardian
assessor), Grok, Build Studio, in-platform coworkers and people. They all run
on the same core loop, with the executor as one more layer.

- **Executor of a turn.** `executorOf` derives it from the call's agent:
  - `AGT-EXT-CLAUDE`, `AGT-EXT-CODEX` and `AGT-EXT-GROK` are the external
    agents;
  - `build-specialist` and `AGT-WS-BUILD` are Build Studio;
  - any other platform agent is an in-platform coworker.

  A miss-kind activity that a person causes is `human`.
- **Layer.** A candidate counts its misses per executor:
  - Two or more executors sharing a miss make it a `core` edit, such as a
    tool contract or a gate.
  - A miss from one executor is that executor's layer (`executor:codex`,
    `executor:claude`, `executor:build-studio` and so on). There, the edit is
    that executor's harness: a Codex permission profile, a Claude hook, or a
    coworker stage brief or prompt.

  A cross-room recurrence pools its executors the same way, so a miss Codex
  hits in one room and Build Studio hits in another is promoted to the core.
- **Verdict.** It carries the target refusals per executor and the executor
  layer the edit belongs to.
- **One miss key.** `tool:<toolName>:<refusal code>` is the shared key for a
  tool miss. Detectors that file the same miss many times should converge on
  it, as the MCP-efficiency, work-pattern-observer and surface detectors do on
  `surface_open` (about 16 filings, BI-049409BF).

**First probe candidates seen on all three surfaces** (session mining,
BI-2C73B434):

- a readiness refusal on claim;
- approval and deny retry loops;
- evidence receipt and locator rejections;
- lease expiry;
- work that ends without its governed write.

The last one includes 545 runs that "executed zero times" and 804
Build Studio runs marked completed with zero tools (BI-A8679D84, BI-4A394B21).

In-platform coworker misses are fully visible on the server, in ToolExecution
and TaskRun, so their rooms probe as fully as external-agent rooms. Codex's
guardian assessor runs about nine assessor turns per working turn
(BI-1B0D1416). That is AI load the probe counts as AI units once those turns
reach ToolExecution.

**What the WorkPattern runtime does not yet carry.** This slice uses that
runtime's semantics: a baseline cell and variant cells on one hermetic
fixture under one pair key. It does not run inside the runtime, which today
cannot take a deterministic trace replay:

- every cell is a model call (`work-pattern-build-replay.ts`,
  `work-pattern-experiment-runtime.ts`);
- the scheduler requires two or more model variants;
- experiments are created only by a human review action;
- the promotion policy supports only `build.implement`.

Folding the trace replay in as a fixture kind (`trace-replay-v1`), with its
own activity key and policy, is slice 3's adoption path. There ADOPT verdicts
become WorkPattern promotions with replicated pairs.

**What the DecisionInteraction ledger offers today.** It barely links to
rooms. In the 7 days to 2026-10-28, no row carried a `taskRunId`. In 30 days,
34 of 671 rows named a Workroom only in the question text, and none was
escalated to a human. The probe reads it anyway, counting room-named human
escalations, and reports the thin link instead of overstating it. Carrying
the room's identity on DecisionInteraction is a follow-on.

**Measurement gaps a verdict must not hide.** Until Codex's guardian turns
reach ToolExecution (BI-1B0D1416) and DecisionInteraction carries the room's
identity, a room's AI load and human escalations can be undercounted, which
weakens AC-15's human-load veto for exactly those rooms. Slice 2 adopts
nothing: its verdicts are advisory records, and the permit variant cannot
steer (BI-6B610D94). Slice 3 must not compose an ADOPT from a room whose load
sources were partial; closing both gaps is part of slice 3's entry criteria.

### Slice 3 — compose, library and promotion

- **Editor.** A bounded editor writes one edit to the room's harness per
  ADOPT candidate, under the Harness² Appendix H rules:
  - The edit traces to the candidate's trajectory moments.
  - Component priority: gate, hook or script first, then a skill with a
    trigger line, then a sub-agent, then always-on prose last. Any always-on
    text added cuts an equal amount, because `check-instruction-plane-size.mjs`
    is shrink-only.
  - It never changes the deliverable's shape.
  - It never invents authority, identifiers or citations.
  - Facts copied from the library are hypotheses and are re-verified.
  - Where it can be avoided, the editor and the judge are not the worker's
    model family.
- **Replicated probe** (AC-6). The trace replay becomes the WorkPattern
  `trace-replay-v1` fixture kind, so an edit is re-probed as replicated
  baseline-versus-candidate pairs on the room's hermetic fixture, with no
  network route to a grader or rubric, within the room's caps.
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

## Continual improvement as a standing operation (BI-CE564FBB)

Amendment, 2026-10-28. The founder, on the same day:

> "We need to turn this into its own AI coworker and responsibility in the
> platform to operate continuously. In ITIL and 6-sigma terms, this is
> continuous improvement. Here, we need to automate this as much as possible
> as a way of operation, not extraneous activity."

He also wrote that "all rooms need to have this type of activity", and that
the diminishing returns in the material call for specific operating criteria.

This amendment turns the loop above into a standing operation with three
parts:

1. **One owner.** WWMD DI-942BE30F1B00 chose a new cross-cutting specialist.
   It rejected extending the delivery-flow coordinator, and it rejected
   letting room overseers act with no owner.
2. **An improve activity on every work shape.** Every room inherits it.
3. **Operating criteria.** These are typed configuration, set by the
   Harness² returns curve.

It follows two standards:

- the ITIL 4 Continual Improvement practice, which supplies the continual
  improvement model and the register;
- Lean Six Sigma DMAIC, which supplies the control charts that separate
  common-cause variation from special-cause variation.

**OBJ-7:** Continual improvement is a standing platform operation: one accountable coworker owns the register end to end, and every Workroom, whatever its shape, executor or archetype, inherits an improve activity from its work shape with no opt-in and no per-room setup.

**OBJ-8:** Improvement effort is spent only where its return justifies it, under typed operating criteria (eligibility, Pareto ranking on the human → AI → code ladder, K=1-first budgets, stop rules, control limits), and every cycle records what it worked, what it skipped and why.

| Criterion | Objectives | Statement |
| --- | --- | --- |
| AC-20 | OBJ-7 | Every shape in the work-shape registry resolves the standard improve activity: deterministic, model judgement gated by the criteria, owned by the Continual Improvement Manager, executed by the room's own `coordinator`, recording misses from every executor. A test fails if any shape resolves none. A room resolves it from its declared shape alone. |
| AC-21 | OBJ-7 | The Continual Improvement Manager (AGT-908, `continual-improvement-manager`) is seeded on every install with its registry entry, roster entry, matching grants, model floor and persona. It owns `harness-evolution-loop-daily`, and an install seeded earlier is re-pointed on its next seed. Its coordination binding is derived from the `continual-improvement-register` standing shape. |
| AC-22 | OBJ-8 | The operating criteria are typed configuration with the defaults below. Every value is clamped, a layer may override them, and a weighting that breaks the human > AI > code order is refused. |
| AC-23 | OBJ-8 | Each cycle's ledger lists the misses it found eligible, the misses it worked, and every skipped miss with its reason. The TaskRun records that ledger. |
| AC-24 | OBJ-8 | A miss key's per-period counts are judged on a c-chart. Common cause (inside the limits and under target) gets no edit. Special cause (a point beyond the limit, or a run above the centre line) or a rate above target is acted on. Each verdict schedules control checks at 7 and 14 days. |
| AC-25 | OBJ-7 | On the DEV install, one full DMAIC cycle runs on a ring-0 room with no human step: a recurring miss, an eligible candidate, a probe, a verdict and a scheduled control check. |

### The owner: Continual Improvement Manager (AGT-908)

- **Owns:**
  - the register: miss → candidate → probe → verdict → recurrence check;
  - the operating criteria;
  - the control charts;
  - cross-room promotion;
  - the weekly rollup (BI-61E412F2).
- **Accountable for closure, not detection.** It merges duplicate detections
  (BI-049409BF) and reopens a fix that recurs (BI-D33412EA).
- **Runs on the typed job.** Slice 1's `harness-evolution-loop-daily` moves
  from the AI Ops Engineer to this coworker. Orchestration stays code.
- **Grants (8).** `registry_read` (reaches `wiki_query` and
  `principle_decide`), `backlog_read`, `backlog_write`, `work_room_read`,
  `work_room_write`, `workroom_evidence_write`, `spec_plan_read` and
  `agent_control_read`. It has no merge, release or grant authority.
- **Supervisor.** HR-300.
- **Model floor.** `adequate`, cost-minimised. Its loop is deterministic, and
  its own turns must not outspend the weak and local models the criteria
  favour.
- **Authority binding.** It comes from the existing derivation
  (`lib/authority/coordination-bindings.ts`, BI-E0728215). The new standing
  shape `continual-improvement-register` names AGT-908 as the driver of its
  agent stages:
  - define;
  - measure;
  - improve;
  - control.

  The shape proposes the driver, and the binding grants it. Adoption is the
  `decide` stage, a governed decision (`harness-edit-adoption`). It lands as
  governed change until GPP permits can steer (BI-6B610D94).
- **Decisions.** Every edit is decided through WWMD, WWWD or WSID by its
  scope. A question no scope can answer becomes a kernel gap, not a question
  to a person.

### The improve activity on every shape

The improve activity is resolved by the registry
(`work-shapes.ts`: `getWorkShapeImproveActivity`,
`resolveRoomImproveActivity`). It comes from the family that registers the
shape, so it is not written into each literal (WWMD DI-D7C2BBE33693, margin
6.1).

Three reasons for that:

- It is one core in every room.
- It sits outside the binding contract (`readWorkShapeDefinitionContract`),
  so no shape version bumps and no live room has to rebind.
- A new shape carries it the day it is registered.

| Family | Layer | Scope |
| --- | --- | --- |
| delivery shapes | `ring-0` | WWMD |
| standing operations | `platform-operations` | WWMD |
| anchor compliance, acceptance verification, post-implementation review | `assurance` | WWMD |
| orchestration cycles | `orchestration` | WWMD |
| coworker standing (general, operate) | `business-operations` | WWWD |
| coworker standing (craft) | `craft` | WSID |

The activity is the same everywhere:

- **Mode.** It is `deterministic`. Model judgement is `criteria-gated`.
- **Owner.** AGT-908.
- **Executor role.** `coordinator`: the room's Process Overseer
  (BI-3913EB49). No second overseer is created.
- **Executors.** Claude, Codex, Grok, Build Studio, in-platform coworkers and
  people.
- **Signals.** Tool failure, miss activity and flow bottleneck.
- **Control metrics.** Misses per run, human touches per run and refusals per
  success.

`validateImproveActivity` refuses four kinds of declaration:

- one that turns improvement off or makes it model-first;
- one that hands ownership to a person;
- one that names a second executor role;
- one that drops an executor's misses.

### Operating criteria

The criteria live in `apps/web/lib/continual-improvement/operating-criteria.ts`
(`resolveImprovementCriteria`). Slice 2 consumes this module; its local stub
`improvement-criteria.ts` re-exports it. These are the defaults:

| Step | Rule | Default |
| --- | --- | --- |
| Define | Distinct runs or sessions in the window | ≥ 2 (`single-run`) |
| Define | Shape repetition | ≥ 3 a week (`shape-too-rare`) |
| Define | Cost per occurrence, AI-turn equivalent | ≥ 1 (`below-floor`) |
| Prioritize | Rank by | expected savings × ladder weight × bias |
| Prioritize | Ladder weights | human 3, AI 2, code 1 (order enforced) |
| Prioritize | Vital few | top 20% of eligible, at least 1 (`outside-pareto-cut`) |
| Budget | K | 1; 2 only after KEEP_BASE in the top cost decile; max 2 |
| Budget | Probe spend | ≤ expected savings, frequency × cost × 4-week horizon (`spend-exceeds-savings`) |
| Budget | Cycle probe cap | from the task budget (`budget-exhausted`) |
| Stop | Parking | 2 consecutive KEEP_BASE verdicts (`parked-after-keep-base`) |
| Stop | Control limits | c-chart, 3σ; run of 8 above the centre line (`inside-control-limits`) |
| Bias | Weak or local model | × 1.5 |
| Bias | Sparse harness | × 1.25 |
| Control | Recurrence checks | 7 and 14 days after the verdict |

Every value is clamped, and `layers[<layer>]` overrides it for one layer.
`rankAndSelect` returns the cycle ledger: `eligible`, `worked`, and `skipped`
with a reason for each.

Two of these numbers are calibration, not doctrine: the weekly repetition
floor and the cost floor. BI-CE564FBB names the rule but not the number. The
loop starts from these values and tunes them from its own ledger.

### Gate burden and rung

Three rules order the edits the loop prefers:

1. A check inside the tool beats a refusal.
2. A refusal that names its next call beats a bare deny.
3. Any of those beats a permit, and a permit beats prose.

An edit that raises human load is never adopted. This amendment adds no new
gate. It adds three tests:

- one in the registry (every shape carries the activity);
- one for the criteria;
- one for the owner seed.

It also adds one standing-shape row to existing conformance suites.

### Delivery

AC-20 through AC-24 ship as three stacked PRs. Each is under the reviewer
size limit:

1. the operating criteria (AC-22, AC-24), with this amendment;
2. the improve activity (AC-20);
3. the CI Manager seed (AC-21).

The register shape that carries the AGT-908 coordination binding is the
rest of AC-21, tracked as BI-F47DD4CF. It ships once BI-90F0863B makes
review summarise frozen-generator outputs, because its regenerated drive
golden is 56 KB. BI-CE564FBB stays open until that binding lands.

Slice 2 wires the cycle ledger into the TaskRun (AC-23). AC-25 closes on the DEV install once slice 2
(BI-B8DAEB71) merges and the install upgrades. The evidence is recorded on
BI-CE564FBB.

## Not taken from Harness²

- **No unbounded search.** Every room and run is capped.
- **No central rewriting.** Rooms own their harness; the aggregator only
  promotes.
- **No client cron.** DI-E6FA02FCC221.

## Delivery and backlog

| Slice | Item | Covers |
| --- | --- | --- |
| 1 | BI-49BC21C1: room-scoped candidates on ring-0 rooms, typed aggregator, budget and spend, decision scope and permit-gap hint | AC-1 – AC-5, AC-10 |
| 2 | BI-B8DAEB71: per-room three-axis probe, scope verdict, kernel gaps, executor layer, verdict on the room | AC-11, AC-14 – AC-19 |
| 3 | Child of BI-49BC21C1: compose under GPP permits, scoped EXPERIENCE library, prose-to-vector accounting, cross-room promotion (depends on BI-6B610D94) | AC-6, AC-7, AC-8, AC-12, AC-13 |
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
