---
status: active
---

# Workroom flow map and measurement: one picture, one measure, per portfolio

| | |
|---|---|
| Date | 2026-10-02 |
| Founder decision | Direction approved by the founder on 2026-10-02 (notation hybrid, stage = queue, four disclosure levels on existing routes, version-keyed improvement loop, new composing epic) |
| Epic | Proposed: EP "Workroom flow — measured, visual and improved per portfolio" (see §11; not yet filed) |
| Backlog | Proposed items F1–F7 (§11). Filing is pending: the `dpf` MCP connector was not authorized in the authoring session, so live backlog was read directly from PostgreSQL (read-only) and nothing was written |
| Composes | GPP shape notation ([2026-10-02](2026-10-02-gpp-shape-notation-and-compiler-design.md)) · shared queue flow telemetry (EP-3516E23D, [plan](../plans/2026-07-06-queue-flow-telemetry-spine-plan.md)) · Living Business twin ([2026-07-11](2026-07-11-living-business-workforce-visualization-design.md)) · portfolio-shaped areas ([2026-08-14 §9](2026-08-14-portfolio-shaped-information-architecture-design.md)) · portfolio budget and WIP ([2026-09-24](2026-09-24-portfolio-budget-and-investment-wip-design.md)) |
| Decision relied on | DI-035897A0F1D6 (WWMD): shape source of truth is the JSON-Schema superset of `WorkShapeDefinition`; iconography derives from BPMN on the `@xyflow/react` EA canvas; BPMN-subset and SysML v2 are export formats only. This spec does **not** reopen notation. It adds a measurement overlay and an actor-lane projection to that notation |
| Prototype | [assets/2026-10-02-workroom-flow-map-prototype.html](assets/2026-10-02-workroom-flow-map-prototype.html) (illustrative data, labelled as such) |
| Verified against | `origin/main` at `24e12c5601`; live install database 2026-10-02 |
| Executable-construct flags | Parallel split/join is executable since GPP Phase 3c PR-3c-2, and rework edges (incl. refuse routes) since PR-3c-3 (BI-8875C9DF, 2026-10-06), so the map may draw both. Stage deadline (timer) and sub-shape are still off and are not drawn (§4 rule "Never draw what the runtime does not execute"). Each later Phase 3c flag flip updates this row. |

## 1. Founder direction (2026-10-02)

The founder's direction, paraphrased:

- Every Workroom needs a visual process that matches its shape and GPP details.
- Every Workroom needs a value-stream definition and measurements (process time, dwell time, queue and similar) so its activities can be optimized.
- The primitives exist, but nothing lets anyone see them, measure them, or confirm the process keeps improving.
- A shape should be succinct: trigger, steps, branching, end result.
- Several notations are supported. Hybridize them into what works best here.
- The mix of AI coworker, person and customer matters, and it differs by archetype.
- The four portfolios organize this for investment and cost.
- The main operations view must lead with the archetype's main value-delivery area.
- Progressive disclosure. No pile of new interfaces: make the existing primitives targeted, useful and mainstream.

## 2. What exists today (measured, not assumed)

### 2.1 The parts are built and do not meet

| Part | Where | State |
|---|---|---|
| Work shapes: trigger, stages, governed gates, stops, measures, review point | `apps/web/lib/work-management/work-shapes.ts` and family files; 47 current + 4 frozen prior | Executed by the workroom drive. One token, sequential |
| GPP notation: 15-construct BPMN-derived catalog, shape documents, compiler | GPP shape notation spec §4–§9 | Draft; Phase 4 canvas is BI-F8D4C529 (triaging). §9.2 plans a "V-2 runtime overlay" but does not define its numbers |
| Room shape view | `components/workspace/workroom/WorkroomShape.tsx` via `lib/work-management/shape-projection.ts` | HTML strip of stage cards with status badges. No edges, no lanes, no time |
| Drive trail | `WorkCapsuleActivity` rows of kind `workroom-drive` / `workroom-drive-attention`, payload `stageKey`, `action`, `reason`, `hold.since`, `hold.stuckSince` | Written on every *news* tick (quiet ticks are skipped), so state changes are recorded at drive-tick resolution |
| Shared flow telemetry | `QueueTelemetryEvent` → `QueueMetricSnapshot` (`wait/process/cycle P50/P95`, `wip`, `throughput`, `firstPassYield`) via `lib/queue/flow-metrics.ts` | Live: 8.1M events, 341 snapshots. Emitters: CWQ work queues, compute lanes. **No workroom emitter** |
| Archetype value streams | `ActivationProfile.processProfile.valueStreams`, stages with `responsibleRole`, `trustGateKeys`, `metricBindings` | Projected only into EA diagrams (BI-224E6E82). `metricBindings` have no resolver (BI-58A9FC76) |
| Twin value-stream strip | `components/twin/ValueStreamStrip.tsx`, `lib/twin/stage-flow.ts` | Stages bind to **queue keys**. 15 of 16 pet-rescue stages have no bound queue and read 0 forever (BI-AF50DBD5) |
| Portfolio money and WIP | `PortfolioBudgetPeriod`, `investment-read-model.ts`, `tie-out.ts`, `ai-resource.ts` | Points per portfolio. AI spend reaches a portfolio only through backlog items. `TokenUsage` has no workroom key |
| Portfolio placement | `WorkCapsule.portfolioRole` | Null on most rooms (BI-C30A4694, BI-FB6389E0) |
| Graph rendering | `@xyflow/react` 12 + `elkjs` (EA canvas, Build Studio `ProcessGraph`); recharts only through report-kit `Chart`; custom SVG `AiOperationsMap` | No live workroom is drawn as nodes and edges anywhere |

### 2.2 What the drive trail already shows

This is a read-only reconstruction over the last 30 days of the live install (2026-09-02 → 2026-10-02). Each news row starts a segment that lasts until the room's next row:

| Drive action / reason | Rows | Rooms |
|---|---|---|
| `pause` / `conformance_pause` | 49,568 | 226 |
| `pause` / `executor_writeback_unavailable` | 13,427 | 12 |
| `attention` / `role_stage` | 13,351 | 412 |
| `escalate` / `conformance_escalate` | 3,903 | 6 |
| `dispatch_agent` / `agent_stage` | 649 | 12 |
| `attention` / `governed_decision` | 27 | 6 |
| `stop` / `success` | 21 | 1 |

Of the 226 conformance-paused rooms, 224 paused on one cause, `missing_explicit_coordinator`. Rooms paused per day jumped from 19–36 to about 200 on 2026-09-23, 09-24 and 09-25, then cleared. The fix shipped as BI-E8C78E80, whose title is the finding: "nothing surfaces it." A stage-by-stage map with queue counts would have shown a 200-room inventory pile at one gate on the first morning.

The trail also shows that, in the window, rooms spent overwhelmingly more time waiting (paused, or awaiting a person) than working. The ratio is not quoted as a flow-efficiency figure because the pause episode dominates it and standing rooms' idle time between cadence cycles is not separated yet (§5.2). That separation is exactly what this design adds.

**Conclusion.** The data for process time, wait time, dwell and queue already exists. What is missing is (a) one classification of it, (b) an emitter into the shared telemetry, (c) a picture, and (d) a review loop that uses the numbers.

## 3. What this design adds

1. **A hybrid notation for the *runtime* picture** (§4). GPP control-flow glyphs (decided), plus BPMN-style actor lanes (derived, not declared), plus Lean VSM data boxes and timeline ladder, plus a Camunda-Optimize-style duration heat. Also a one-line *shape signature* for text contexts.
2. **A flow-state classification and measures** (§5). A closed `WorkroomFlowState` enum over the drive trail, and Flow Framework measures defined once.
3. **Stage = queue** (§6). Every shape stage emits into the existing shared flow telemetry under a stable queue key. Snapshots, trends, Prometheus and the coworker queue-awareness pack then come for free. The twin strip binds archetype stages to the same keys, which fixes BI-AF50DBD5 through the contract rather than a special case.
4. **Four disclosure levels on existing surfaces** (§7). Glance on `/workspace`, portfolio on `/area/[key]` and `/portfolio`, shape map as a drill-in, room evidence as today. No new top-level route.
5. **An improvement loop keyed to shape versions** (§8). A shape version is the experiment unit. The review point compares versions on the same measures. A bottleneck becomes a backlog item through the existing improvement facility (EP-C00F61F4).
6. **Archetype focus** (§9). The hero stream and the "thing to worry about" come from fields archetypes already declare.

## 4. The hybrid notation

Each language contributes the one thing it does best, and nothing else:

| Concern | Borrowed from | Rendered as | Source of truth |
|---|---|---|---|
| Trigger, stage, gate, branch, stop | BPMN 2.0 via GPP catalog (DI-035897A0F1D6) | GPP §5 glyphs: trigger circle with class glyph, stage rounded rect, gate diamond carrying its authority (WWMD/WWWD/WSID) and mode (shadow/enforced), stop end-circles (success / failure / budget) | Shape document / `WorkShapeDefinition` |
| Who does the step | BPMN lanes | Three derived lanes, top to bottom: **Outside** (customer, supplier, regulator), **People** (`role:` / `person:`), **AI coworkers** (`agent:`) | Derived (§4.2), never declared separately |
| How long, how much is waiting | Lean value stream mapping (VSM) | A data box under each stage (in flight, P50 dwell, P50 process, first-pass yield) and an inventory triangle on each incoming edge (rooms waiting to enter / awaiting a person) | `QueueMetricSnapshot` per stage key (§6) |
| Where the time goes, end to end | VSM timeline ladder | A stepped line under the map: process time above, wait below, summed into flow time and flow efficiency | Same |
| Where to look first | Process-mining heatmap (Camunda Optimize, Celonis) | Stage border weight and fill step on **this shape's own baseline** (P50 dwell vs the shape's trailing 4-week P50), never an absolute scale | Same |
| What the item is | Flow Framework flow distribution | Item-type chip on the room (feature / defect / risk / debt) mapped from shape family (§5.4) | Shape family registry |
| Structure and traceability | ArchiMate / SysML v2 | Unchanged: export only, via the EA projection with shared ids (GPP spec §9.1) | EA |

Rules:

- **Never draw what the runtime does not execute.** This is GPP spec §5.4, applied unchanged. Parallel, rework, timer and sub-shape constructs appear only after their Exec flag flips (BI-8875C9DF).
- **Every state is encoded in form as well as colour.** Glyph, border weight and dash carry the meaning. Colour is a `--dpf-*` token (AGENTS.md §9). `PORTFOLIO_COLOURS` hex constants are not reused; portfolio accents move to tokens in F5.
- **Measurement never invents a verdict.** A stage with fewer than *n* = 5 exits in the window shows its count and "too few to measure", not a percentage. A measured figure carries `measured` or `estimated` provenance, as `lib/portfolio/throughput.ts` already does.

### 4.1 The shape signature (succinct text form)

One line per shape, generated from the definition. It is used where a diagram does not fit: room headers, coworker prompts, MCP tool results, notifications and backlog bodies.

```
⏱ cadence · AI sweep → AI raise → ◇ WWWD decide [owner] → ● resolved | ⊗ refused→raise
✋ claim · AI reproduce → AI repair → ◇ WWMD merge [maintainer] → AI runtime-check → ● done
```

Grammar: `trigger-glyph trigger · (lane step [→ …]) → ◇ AUTHORITY gate [principal] → ● success-stop | ⊗ failure-stop[→rework-target]`. The generator is pure, lives beside `shape-projection.ts`, and has a snapshot test over all 51 definitions. The lane prefix is the §4.2 derivation, so the signature and the map can never disagree.

### 4.2 Lane derivation

Lanes are derived, so no shape-document field is added and GPP spec §4.2 stays closed:

| Lane | A stage is in it when |
|---|---|
| AI coworkers | `accountablePrincipalRef` starts `agent:` |
| People | `accountablePrincipalRef` starts `role:` or `person:` |
| Outside | The stage's declared capability set includes a tool of GPP capability class `outward` (GPP §7.1), or its evidence includes `conversation-turn` / `org-business-answer`. The stage then draws a **touchpoint** in the Outside lane, linked to its own lane position. The stage is not moved |

The archetype difference falls out of the data, not a per-archetype rule:

- An HVAC dispatch shape has its touchpoints at booking and arrival.
- A pet-rescue adoption shape has them at screening, the home check and follow-up.
- A platform delivery shape has none until accept.

## 5. Flow states and measures

### 5.1 `WorkroomFlowState` (closed set)

| State | Meaning | Drive evidence (action / reason) | Counts as |
|---|---|---|---|
| `working` | An executor holds the stage and is acting | `dispatch_agent` / `agent_stage`, `lease_held` | Process time |
| `awaiting-person` | A person's decision or action is the next thing | `attention` / `role_stage`, `governed_decision` | Wait time (queue: people) |
| `blocked` | The room cannot proceed until a condition outside its stage clears | `pause` / any; `escalate` / any | Wait time, cause-tagged |
| `awaiting-trigger` | A standing room completed its cycle and waits for its next cadence or event | `do_not_wake` after a completed cycle; between-cycle interval of a `cadence` shape | **Excluded** from flow time. It is not demand |
| `done` | A stop condition was met | `stop` / any | Terminal; outcome = stop kind |

The mapping is a pure function: `classifyDriveSegment(action, reason, shapeTriggers)` in a new `lib/work-management/workroom-flow-state.ts`. An unmapped `(action, reason)` pair is a test failure, not a default: a parity test enumerates the drive's reason vocabulary. Cause tags on `blocked` keep the reason (`conformance_pause:missing_explicit_coordinator`, `executor_writeback_unavailable`, …), so the map can say *why* the pile exists.

Human touch time inside `awaiting-person` is not observable today, because only the decision moment is recorded. It is reported as wait, with a footnote. Capturing touch time is out of scope (§13).

### 5.2 Measures (defined once, in `flow-metrics.ts`)

| Measure | Definition | Grain | Flow Framework / VSM name |
|---|---|---|---|
| Queue (WIP) | Rooms whose current stage is S | Stage, shape, portfolio | Flow load / inventory |
| Dwell | Exit − entry of stage S, all states except `awaiting-trigger` | Stage | Lead time per step |
| Process | Sum of `working` within the dwell | Stage | Process (value-add) time |
| Wait | Dwell − process | Stage | Queue / wait time |
| Blocked share | `blocked` ÷ dwell, by cause tag | Stage | Waste by cause |
| Flow time | First stage entry → `done`, excluding `awaiting-trigger` | Room, then shape P50/P85 | Flow time |
| Flow efficiency | Σ process ÷ flow time | Shape, portfolio | Flow efficiency / value-add ratio |
| Throughput | `done`/success per week | Shape, portfolio | Flow velocity |
| First-pass yield | Stage exits not followed by a refuse or a return to an earlier stage | Stage | %C&A |
| Distribution | Share of flow load by item type (§5.4) and by investment bucket (run / grow / transform) | Portfolio | Flow distribution |
| Cost | Points (existing) + AI USD attributed to the room (F6) | Room → portfolio | Flow cost |

P50 and P85 are reported, not means: flow data is long-tailed. P85 is the planning percentile used by Kanban practice. P95 stays in the snapshot for alerts.

### 5.3 Standing vs claim shapes

Standing (`cadence`, `estate-drift`, `evidence-decay`) shapes are measured **per cycle**. A cycle starts at its trigger and ends at a stop, so the idle gap between cycles is `awaiting-trigger`. Claim shapes (`claim`) are measured per room. Without this split, every watch would report flow efficiency near zero and the measure would be noise.

### 5.4 Item type (flow distribution)

Mapped from shape family; this is a registry constant, not a new field:

- `delivery-break-fix` → defect
- other `delivery-*` → feature
- `*-watch` shapes on security, credential, policy or licence → risk
- conformance, hygiene and estate shapes → debt
- orchestration and cross-cutting shapes → excluded from distribution; they coordinate other rooms

## 6. Stage = queue (substrate)

There is no new metrics table. A shape stage is a queue in the existing contract:

| Field | Value |
|---|---|
| `queueKey` | `wr:<shapeKey>@<version>:<stageKey>` — the version is part of the key, so versions compare (§8) |
| `itemKind` | `workroom-stage` |
| `itemId` | `<capsuleId>` for claim shapes; `<capsuleId>:<cycleKey>` for standing shapes |
| `transition` | `enqueued` on stage entry; `started` on first `working`; `finished` on exit (outcome success, or failed on a refuse); `cancelled` on abandon. New additive transitions **`held`** / **`released`** bracket `blocked` and `awaiting-person` spans; `laneKey` carries the cause tag |
| `actorType` | `ai-agent` / `human` / `system` from the §4.2 lane |

**Emitter.** The drive's news-tick `persist` path calls `recordQueueTransition` when the classified state changes. This is the same fire-and-forget writer used by `actions/work-queue.ts`, so the drive never fails on telemetry.

**Rollup.** `queue-metrics-aggregator.ts` folds the stream into `QueueMetricSnapshot` and gains:

- additive nullable columns: `heldP50Ms`, `heldP95Ms`, `processShare` (Σ process ÷ Σ cycle)
- an additive `QUEUE_TRANSITIONS` entry for `held` / `released`

That is one forward-only migration adding three nullable columns, safe for any data state.

**Backfill.** A one-off, idempotent replay of the retained `WorkCapsuleActivity` drive rows (180-day retention) through the same classifier writes historical events tagged `laneKey=backfill`. Trends therefore start with history, not empty. Replay resolution equals drive-tick resolution, and the UI says so.

**Shape and portfolio rollups** are read-time sums over stage snapshots by key prefix (`wr:<shape>@`), grouped by the room's `portfolioRole`. They are not stored, so they cannot drift from the stage numbers.

**Twin binding.** `deriveTwinValueStreamBinding` gains the rule that an archetype stage's `queueKeys` include the `wr:` keys of shape stages that declare the same IT4IT/OVSM stage reference (the GPP spec §3.2 hook, BI-B8B3FB70). The strip then lights from the same snapshots. A stage with no bound room keeps `observable: false` and renders as "not yet measured", not as 0.

## 7. Progressive disclosure on existing surfaces

| Level | Question it answers | Where (existing route) | What renders | Click goes to |
|---|---|---|---|---|
| **L0 Glance** | "Is the main thing flowing, and where is it stuck?" | `/workspace` hero (`WorkspaceTwinHero` / `ValueStreamStrip`) | The archetype's hero stream (§9): one band of stages, queue count per stage, aging heat, and **one** called-out bottleneck sentence ("12 adoptions waiting on home check, oldest 6 days") | L2 for that stage |
| **L1 Portfolio** | "How is each portfolio's work flowing, and what does it cost?" | `/area/[key]?view=work` header; `/portfolio` overview 4-up | Five tiles in fixed order — flow load, flow time P50 (sparkline), flow efficiency, throughput, cost (points + AI USD) — plus a distribution bar. Same five in all four portfolios, so they compare | L2 filtered to the portfolio |
| **L2 Shape map** | "Where in this shape does time go, and who holds it?" | Drill-in panel on `/area/[key]?view=work&shape=<key>`; the same component in room detail | The §4 hybrid: lanes, glyphs, VSM data boxes, inventory triangles, timeline ladder, heat; a version picker for before/after | L3 room list for a stage |
| **L3 Evidence** | "What exactly happened in this room?" | `/workspace/cases/[caseKey]` (existing `WorkroomBody`) | `WorkroomShape` becomes the L2 component scoped to one token: the room's position, its own timeline against the shape's P50, plus the current receipts and decision panel | Existing detail |

Components:

- **`WorkroomFlowMap`** (new, one component, mounted at L2 and L3). SVG on `@xyflow/react` + `elkjs` with a fixed lane layout, reusing the EA canvas's GPP node renderers once BI-F8D4C529 ships them. Until then, it uses its own read-only nodes in the same glyph set.
- **`FlowTiles`**: composed from report-kit `KpiCard` and `Chart`; no new chart library (AGENTS.md §7).
- `ValueStreamStrip` is extended, not replaced.

The design view (GPP V-1, the EA canvas editing shape documents) stays where GPP Phase 4 puts it. This design fills its V-2 overlay with the §5 numbers, so there is one overlay definition, not two.

## 8. The improvement loop

1. **Baseline.** A shape version's first four full weeks are its baseline (P50/P85 flow time, flow efficiency, per-stage dwell).
2. **Signal.** On each `reviewPoint.everyDays`, the existing review emits a *flow review* receipt. It compares current against baseline and names the top stage by `wait × queue` (the bottleneck) and its dominant blocked cause.
3. **Countermeasure.** A sustained bottleneck (two consecutive reviews) files or updates a backlog item through the improvement facility (EP-C00F61F4, `BI-B146AB6B` routing). Dedup is keyed on `queueKey + cause`, attributed to the shape's accountable owner.
4. **Experiment.** The countermeasure ships as a shape version bump, or as a fix outside the shape. Because the version is in the queue key, L2's version picker shows before and after on the same axes. A stop condition can also change without a version bump, so the review notes "non-shape change" when the version is unchanged.
5. **Trend.** L1 sparklines carry version-change markers. A portfolio's improvement is the trend of its five tiles, with markers that explain the steps.

This is how "continuously optimizing" becomes checkable: every claimed improvement points to a version or a backlog item and to a before/after on the same measure.

## 9. Archetype focus for L0

Nothing new is declared. The hero stream and question are resolved from existing fields, in this order:

1. `workspace-home/profiles.ts` → `primaryOperatingQuestion` (the sentence the L0 callout answers).
2. `deriveOperationalValueStream()` → `loadBearingStageKeys` (stages always shown) and `capacityUnit` (the count's unit: jobs, covers, animals, tickets).
3. `productMix.primary` → which of the archetype's `processProfile.valueStreams` is the hero (the stream whose stages produce the primary product). Ties go to the stream holding the most load-bearing stages.
4. Portfolio scope `primary` in `ActivationProfile.portfolios` → which portfolio's L1 tiles sit beside L0. For most archetypes this is Goods and Services for Sale and Manufacturing and Delivery.

Examples, from existing definitions:

| Archetype | Hero stream (L0) | Callout answers | Lanes that matter |
|---|---|---|---|
| hvac-contractor | Dispatch → on-site → invoice | "What has to be dispatched or rescued today?" | People (technicians) and Outside (customer arrival window) |
| restaurant | Seat → order → serve → settle | "Are we ready for the next service period?" | People; AI only on prep and inventory |
| MSP | Incident → triage → resolve | "What is red on the customer estate?" | AI-heavy triage, People at approval gates |
| DPF itself (software platform) | Delivery shapes, claim → merge → accept | "What is waiting on a person, and for how long?" | AI build; People at merge and accept gates |

For DPF's own install, L0 is the delivery stream of the Manufacturing and Delivery portfolio. The §2.2 pile is the kind of thing it must show.

## 10. Research and benchmarking

| Source | What it does | DPF adopts | DPF rejects |
|---|---|---|---|
| **Flow Framework** (Mik Kersten; [overview](https://allstacks.com/blog/flow-metrics), [Planview guide](https://info.planview.com/rs/456-QCH-520/images/flow-metrics-business-leader-guide_ebook_rbd.pdf)) | Five business-level flow metrics: velocity, time, efficiency, load, distribution | The five metrics as the fixed L1 tile set, per portfolio. Flow time is customer-centric (entry → done) | Its four item types as a new field; DPF maps from shape family (§5.4) |
| **Lean value stream mapping** ([overview](https://concepts.dsebastien.net/concept/value-stream-mapping/), [VSM tool](https://doughnuteconomics.org/tools/value-stream-mapping)) | Data box per step, inventory between steps, timeline with process above and wait below; office processes typically 0.5–2% value-add | Data boxes, inventory triangles and the timeline ladder as the L2 measurement overlay | Hand-drawn current/future-state maps; DPF's map is generated from runtime |
| **Camunda Optimize** ([docs](https://docs.camunda.io/docs/guides/improve-processes-with-optimize/)) | Frequency and duration heatmaps overlaid on the BPMN diagram to locate bottlenecks | Duration heat on the same diagram the modeller sees (GPP V-2) | A separate analytics product and an absolute-duration scale; DPF heat is relative to the shape's own baseline |
| **Process mining (Celonis / OCEL)** | Event-log reconstruction of real flow | Reconstruct from the existing drive log, and backfill (§6) | Object-centric mining engine; DPF already knows its process model, so conformance is structural |
| **BPMN 2.0 lanes** | Responsibility partitions | Three derived lanes | Declared pools/lanes per shape (would duplicate `accountablePrincipalRef`) |

## 11. Delivery slices (proposed backlog)

Proposed epic: **Workroom flow — measured, visual and improved per portfolio.** It composes and does not duplicate:

- EP-B932453F (GPP notation and canvas): consumes its glyphs; fills its V-2.
- EP-39F60B06 (value-stream shape graph: interaction-shape measurement): different graph.
- EP-VSL-GOVERN (entity lifecycle boards): those boards read `LifecycleEvent`, while this reads rooms.
- EP-PORTFOLIO-BUDGET-WIP: consumes its points and WIP allowance.

| Key | Slice | Depends on | Shippable alone | Closes / feeds |
|---|---|---|---|---|
| F1 | `WorkroomFlowState` classifier + parity test over the drive reason vocabulary + shape signature generator (pure, tested) | — | Yes (signature visible in room header) | §4.1, §5.1 |
| F2 | Stage = queue emitter + `held`/`released` transitions + three snapshot columns (one migration) + idempotent backfill | F1 | Yes (numbers in queue health, Prometheus, coworker queue pack) | §6 |
| F3 | `WorkroomFlowMap` at L3 (room detail) replacing the HTML strip | F1, F2 | Yes | BI-C7E2E924 follow-on |
| F4 | L2 shape drill-in on `/area/[key]?view=work&shape=` with version picker | F3 | Yes | §7, §8 step 4 |
| F5 | L1 five tiles per portfolio on `/area/[key]` and `/portfolio`; portfolio colours to tokens | F2; portfolio placement BI-FB6389E0 / BI-C30A4694 for correct grouping (until then an explicit "unplaced" fifth column, never a silent default) | Yes | §7 |
| F6 | AI cost attribution to room and stage (trace `TokenUsage.traceId` → TaskRun → room; schema only if the trace path proves incomplete) | — | Yes | §5.2 cost |
| F7 | L0 hero stream: twin binding to `wr:` keys, bottleneck callout, "not yet measured" state | F2; BI-B8B3FB70 stage reference | Yes | BI-AF50DBD5, BI-58A9FC76 (partial: flow measures, not business metrics) |
| F8 | Flow review receipt at review point + bottleneck → backlog via EP-C00F61F4 routing | F2, F4 | Yes | §8 |

## 12. Objectives and acceptance

- **OBJ-SEE.** Every room and every shape renders as the §4 map, with trigger, stages, gates, stops and lanes generated from its definition.
  - AC: snapshot over all 51 definitions.
  - AC: no construct is drawn whose Exec flag is false.
- **OBJ-MEASURE.** Queue, dwell, process, wait, blocked-by-cause, flow time, flow efficiency, throughput and first-pass yield are computed once (`flow-metrics.ts`) and read by human tiles, MCP and Prometheus alike.
  - AC: parity test, so tile and MCP values are identical for the same key and period.
  - AC: unmapped drive reason fails CI.
- **OBJ-HONEST.** No measure is shown below *n* = 5; provenance is shown; backfilled history is labelled; `awaiting-trigger` is excluded.
  - AC: the fixture of a standing room with long idle gaps does not depress flow efficiency.
- **OBJ-GLANCE.** On `/workspace`, the archetype's hero stream shows non-zero live counts where rooms exist, and "not yet measured" where none do.
  - AC: replaying the 2026-09-23 drive log produces a bottleneck callout naming `missing_explicit_coordinator` at its stage, with a room count of about 200.
- **OBJ-COMPARE.** The four portfolios show the same five tiles over the same window.
  - AC: unplaced rooms appear as their own column with a count.
- **OBJ-IMPROVE.** A shape version change appears as a marker on trends, and before/after is selectable at L2.
  - AC: a sustained bottleneck files exactly one deduplicated backlog item.

## 13. Out of scope

- Editing shapes on the canvas (GPP Phase 4, BI-F8D4C529).
- Executing parallel, rework and timer constructs (BI-8875C9DF).
- Human touch-time capture inside `awaiting-person`.
- Archetype business-metric resolvers such as kennel occupancy (BI-58A9FC76 remainder).
- Build Studio's own phase flow until it is a shape document (BI-D37B2C13). It then joins automatically, because it becomes a shape.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Drive-tick resolution misstates short stages | Resolution is shown on L2; P50/P85 at stage grain only; emitter writes on state change, so post-F2 data is event-resolution, not tick-resolution |
| Telemetry volume from about 1,000 rooms | One event per state change, not per tick; the existing 90-day retention applies; the 30-day backfill is about 80k rows in total |
| A heat scale that cries wolf | Relative to the shape's own baseline, with *n* ≥ 5 |
| Portfolio rollups mislead while most rooms are unplaced | Explicit "unplaced" column; F5 acceptance depends on placement work |
| The map becomes a second shape renderer next to the EA canvas | One `WorkroomFlowMap`; node renderers shared with GPP Phase 4 once they exist; the design view stays on the EA canvas |

## 15. Documentation impact

- User guide: a page on reading the flow map and the five portfolio tiles.
- `docs/architecture/gated-permissions-process.md` Annex A: note that V-2 is defined here.
- The coworker queue-awareness pack prompt: mention the `wr:` key family.

All of these ship with the slices that make them true, not with this spec.
