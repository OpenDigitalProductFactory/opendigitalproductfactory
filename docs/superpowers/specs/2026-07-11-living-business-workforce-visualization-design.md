# The Living Business — value-stream workforce visualization (design spec)

**Status:** draft · 2026-07-11
**Epic:** EP-LIVING-BUSINESS-VIZ (to be filed) — the read-side companion to EP-BUSINESS-ACTIVITY-SIM
**Author:** platform (via Claude Code, operator Mark)
**Related:**
- [[living-business-workforce-activity]] concept — this spec *is* the read-side viz that concept named.
- [Business Activity Simulator](2026-07-04-business-activity-simulator-design.md) — the write-side; its **P4** ("observability + viz") wires into this surface.
- [Value-stream architecture platform](2026-06-12-value-stream-architecture-platform-design.md) — the OVSM model and the EA `/ea/value-streams` render precedent.
- [`docs/architecture/archetype-business-value-streams.md`](../../architecture/archetype-business-value-streams.md) — the per-archetype "how this business actually works" narrative.
- **Interactive prototype:** [`assets/2026-07-11-living-business-workforce-visualization-prototype.html`](assets/2026-07-11-living-business-workforce-visualization-prototype.html) — open it; it is the primary artifact of this spec.

---

## 1. Problem

The main workspace view (`apps/web/app/(shell)/workspace/page.tsx` → `OperatorCockpit` + `PlatformWorkspaceHome`) and the AI-coworker operations view (`/ops`) are **card-and-list surfaces**. They are informationally correct but not *compelling*: they render the business as a backlog, not as a living thing. A non-technical owner cannot look at them and *feel* how their business is running — where demand is entering, where work is piled up, which AI coworker is doing what right now, and what the whole machine is producing.

There is also no surface that renders the platform's central abstraction — the **operational value stream** — as the thing it actually is: a moving production line with humans and AI coworkers working it, supporting activities feeding it, and money, bills, taxes, and market weather all bearing on it.

We already model every piece of this (value stream, coworkers, live activity events, the finance spine, market/competitive intelligence). What is missing is the **read-side composition** that binds them into one animated, game-like paradigm.

## 2. Goal

**"The Living Business"** — a game-like, animated visualization that becomes the centerpiece of the main workspace, rendering the archetype's value stream as a living production line:

- The **primary value stream** is the main "route" (Railroad Tycoon), running left→right through the six canonical stages.
- **Work flows along it** as animated units — leads, orders, jobs, invoices — that transform as they are processed (SimCity/Factory belt).
- **Personas** (the human staff of the archetype business) are seated at their home stages; **AI coworkers** dock at stages and visibly perform activities, hand work off, and escalate (Civilization units).
- **Supporting activities** are the infrastructure underlayer feeding the stages — Trust & Compliance, Operate & Improve, and firm infrastructure (Finance/HR/Procurement), where **bills and taxes** surface as utility meters that fill and must be paid.
- **Market highlights and competitive news** are the ambient "weather" above the board, shown when relevant.
- A HUD carries the operator's **"what needs you now"** as quest markers pinned to the stages that raised them.

The paradigm must degrade to a calm, static, accessible state under `prefers-reduced-motion`, follow the `--dpf-*` token system exactly (no hardcoded colors), and support live / replay / speed / zoom controls so it reads at a glance in "City" view and rewards attention in "District" view.

### Design principle (load-bearing)
**Render real state; animate real events. Never a decorative simulation on live data.** Every moving element maps to a real record or a real event: a unit is an in-flight work item, a docking coworker is an `agent-event-bus` `tool:start`, a filling meter is an accruing `Bill`/`TaxRemittanceRun`. In demo/test, the **Business Activity Simulator** supplies the events through the *same* contract — so demo and production differ only in the event source, never in the rendering.

## 3. The paradigm — five layers

The board composes as five stacked layers, from sky to substrate:

| Layer | Metaphor | What it shows | Real source |
|---|---|---|---|
| **1. Sky — market weather** | Weather + news ticker | Demand climate (sunny/storm), competitive moves, supplier/price alerts | `market-research.ts`, `MarketingBattlecard`, attention signals |
| **2. The stream — primary activities** | Railroad route / assembly line | 6 chevron stage-districts; load-bearing stages glow; per-stage KPI; work-unit tokens flowing and **evolving** (Spore) — color + size mature demand → in-service → settled | `deriveOperationalValueStream()` stages, `metricBindings`; work items from the finance spine + field-dispatch lifecycle + `workforce-activity` |
| **2b. The buffers — flow between stations** | Factory/MES + value-stream mapping | Between every two stages: **WIP queue depth + wait time**; the **bottleneck** buffer is flagged; a **lead-time ladder** under the stream contrasts value-added vs waiting → **flow efficiency** | derived from `workforce-activity` `enteredAt`/`updatedAt` (queue = count waiting; wait = now − enteredAt); bottleneck = longest wait; `metricBindings` `lead-time`/`utilization` |
| **3. The workers — crews** | Civ units + a staffed station | Each stage's **crew**: the value stream's **orchestrator lead + delegating specialist coworkers** (dense, ~18–21 on shift), pulsing when active + a live activity line; an **in-tile work bench** of the jobs actually being processed; personas seated (muted) | `agent_registry.json` / `Agent` (`valueStream`, `kind`, `delegatesTo`) via `CoworkerService`; `agent-event-bus` events; personas from `workspace-home/profiles.ts` |
| **4. The utility band — support activities** | SimCity utility grid | Trust & Compliance, Operate & Improve, and Finance/HR/Procurement as meters feeding the stages; **bills due** + **tax remittance** as fill-gauges | cross-cutting OVSM stages + `trustGates`; `Bill`, `BillApproval`, `TaxRemittanceRun`, `Invoice` |
| **5. The HUD — operator cockpit** | Quest log | "What needs you now" as quest markers with one-click actions; archetype identity; time/speed/zoom controls; flow + revenue KPIs | `OperatorCockpit` attention queue (`lib/attention/outside-in.ts`), `business-approvals` |

### Interaction model
- **Ambient loop** — slow rail energy, gentle station pulse, unit drift. Paused under reduced-motion (static state shown instead).
- **Event bursts** — a coworker docking, a unit clearing a stage, a handoff arc, a bill meter ticking up: each is a discrete, real event.
- **Zoom (Civ-like)** — *City* (the whole stream at a glance) → *District* (one stage's coworkers, queue, and metric; the prototype dims non-load-bearing districts). *Unit* view (one work item's journey) is a documented follow-up.
- **Time (SimCity-like)** — *Live* vs *Replay 24h* with 0.5×–4× speed, driven from the event timeline; in test, driven by the simulator.
- **Drill-through** — clicking a district routes to that stage's real surface (Settle → `/finance`, Deliver → dispatch/kitchen ops); clicking a coworker opens the coworker panel.

### 3.1 Two lenses — the value stream AND the operational floor
The value-stream layers above are one lens: *how work flows*, deliberately archetype-agnostic (every business has attract→…→retain). It is the right lens for flow, bottlenecks, and lead time — but by design it does **not** show the concrete operational reality of a specific business, and it looks broadly the same for a restaurant, a plumber, and a SaaS. Operators need the second lens too:

**The operational floor — a living digital twin, bespoke per archetype.** It renders the business's *actual entities, capacity, and layout*, with real constraints visible. For a restaurant that means: the **floor plan** with tables sized by party (2/4/6-top) and **individual seats** filling; per-table **state** (open · reserved · seated/coursing · check/turning · bussing) and course progress; the **waitlist** of parties (size + wait, a 6-top blocked with no 6-top free); the **kitchen pass** with stations and tickets (dine-in **and** online) being cooked; **online-order inflow**; and a **stock / 86 board** where limited ingredients cap which dishes are sellable. **Staff are represented by the work they own, not by decorative headcount** — the fidelity is "if they're on shift, show what they're doing" (Host → sequencing the waitlist, Server Maria → T1/T3/T9 + refire, AI expo → flagged the late T14), not modelling every micro-role (bus-boys, runners) as avatars shuttling around. A staffer with no live work reads as idle; a task always shows its owner. Live **capacity** is explicit — *14/18 tables, 52/62 seats, 0 six-tops free*. Every other archetype gets its own twin (field-service: a map of trucks/jobs/territories + parts stock; SaaS: tenants/seats/usage + infra health; rental: a fleet yard of assets in/out/overdue + maintenance bay).

The two lenses share the **same** `LivingBusinessSnapshot` + event plane; the floor just projects the *entity/capacity* facet where the value stream projects the *flow* facet. An operator toggles **Value stream ⇄ Floor**, or the floor is the City-view default with the value stream a click away. **Honest scope note:** the floor needs a light **floor/capacity model per archetype** (tables, seats, stations, bays, territories) that is mostly **net-new** — layered on existing data (`capacityUnit`, `schedulingDefaults`, reservations, `itemTemplates`/inventory, orders, field-dispatch, roster) rather than invented from nothing. Prototype: [`assets/2026-07-11-living-business-restaurant-floor-prototype.html`](assets/2026-07-11-living-business-restaurant-floor-prototype.html).

**The floor is where the operator acts, not just watches.** The twin is the natural home for the small, high-frequency operational decisions, with the AI coworker doing the reasoning and the human confirming (progressive-disclosure, human-in-the-loop). First interactions, in the prototype:
- **Seat a waiting party** — tap a party on the waitlist; a **host "cog"** recommends the table using **typical staying time (dwell)**: an open table that fits with the least wasted seats, or — if none is open — the occupied table that will **free soonest and *when*** (ETA derived from each table's course/state remaining time). Tap the suggested/eligible table to seat them; **seating capacity updates live** (tables, seats, six-tops free). Tap a *Check/Bussing* table to turn it.
- **Reservations queue** — upcoming bookings each get a suggested table *held* for their time, predicted from expected turn times, so an 8:30 six-top isn't stranded behind a full room.
This is the first instance of a general pattern — the twin surfaces a constraint (a party of 6 with no six-top free), the coworker proposes the resolution (combine T12+T13, or "T5 turns in ~35m"), the operator taps to confirm. The dwell/turn model is `schedulingDefaults` + observed service times; the same shape recurs per archetype (dispatch the next job to the nearest free tech; assign the returned asset to the next reservation).

**Second twin — field-service dispatch** ([`assets/2026-07-11-living-business-field-service-dispatch-prototype.html`](assets/2026-07-11-living-business-field-service-dispatch-prototype.html)) proves the pattern generalizes. It renders a **territory map of where the fleet physically is**: a central **yard** depot, and vans that are **yard-based vs home-garaged** (garaged vans start in their own neighborhood, not the yard — a real dispatch consideration), tech markers colored by status, jobs/emergencies pinned by zone. The **dispatch queue** is the exact analogue of the restaurant waitlist: tap a queued job → the cog suggests the **nearest available tech by travel time** (respecting yard-vs-home basing), or the on-site tech that frees soonest + travel → tap to dispatch; the van animates en-route and a pin drops. Same constraint→proposal→confirm loop, same `LivingBusinessSnapshot`, different entities (`field-dispatch` lifecycle, appointments from `schedulingDefaults`, parts stock on truck vs yard).

**Third twin — rental yard** ([`assets/2026-07-11-living-business-rental-yard-prototype.html`](assets/2026-07-11-living-business-rental-yard-prototype.html)): the physical fleet as bays — **ready in the yard**, **returns & inspection**, **maintenance bay**, and an **out-on-rent** board with due dates/overdue. The **reservations queue** is the same interaction again: tap a reservation → the cog suggests the best asset of that class (ready now, or one clearing inspection by the reservation time) → tap to allocate; tap a returned asset to clear it back to the ready line. Three twins, one interaction grammar.

### 3.2 Physical archetypes get a spatial "now" twin; non-physical get other paradigms

> **How ALL archetypes are accommodated** — one grammar, ~12 templates, and a derived `TwinProfile` (the OVSM/media/field-dispatch derive-with-override family) — is designed in the companion spec: [**Operational Twin Framework**](2026-07-12-operational-twin-framework-design.md), which also carries the per-category vertical-market research (21 categories benchmarked against their market-leading solutions).
**Load-bearing principle (operator-directed):** every archetype whose work happens in *physical space* gets an operational twin that is the **representation which best reflects "now"** for that business — a floor, a map, a yard, a board of rooms — defaulting to live current state. Archetypes whose work is **not** physical don't get a spatial twin; they get a paradigm fit to their substrate (a tenant/usage board, a pipeline, a portfolio). Both remain read-side projections of the same `LivingBusinessSnapshot`; only the *primary* facet differs. Classifying the 21 archetype categories:

| Physical → spatial "now" twin | The twin |
|---|---|
| food-hospitality | restaurant floor — tables/seats, kitchen pass, waitlist *(built)* |
| trades-maintenance · moving-and-logistics · security-services | territory/route map — fleet, jobs, dispatch *(field-service built)* |
| asset-rental | yard — assets in/out/maintenance/returns *(built)* |
| automotive-services | shop — bays/lifts, work-orders on the ramp |
| beauty-personal-care · pet-services | stations/chairs (or kennels/grooming) + the appointment book |
| healthcare-wellness | rooms/exam chairs + patient flow *(PHI-guarded)* |
| fitness-recreation | floor + class/equipment capacity |
| retail-goods | store floor + shelves/stock + POS lanes *(hybrid w/ online)* |
| hoa-property-management · real-estate-construction | property/units or job-sites map + work orders |
| live-events-venues | venue map — seating/stage + run-of-show |
| education-training · public-sector | rooms/counters + schedule/queue board *(hybrid w/ online)* |

| Non-physical → other paradigm | The paradigm |
|---|---|
| software-platform | tenants/seats/usage + infra-health board |
| banking-financial-services | accounts/portfolio + transaction/exception board |
| professional-services | matters/engagements pipeline + utilization |
| media-production | productions pipeline/timeline (project gantt) |
| nonprofit-community | programs/donors/impact board |

Hybrids (retail, education, healthcare) run the physical twin for the in-person facet and the board paradigm for the digital one, toggled like the value-stream ⇄ floor lens. The value-stream lens is universal — it applies to *every* archetype, physical or not — and is the shared second lens behind whichever primary one fits.

### 3.3 It is an *operating digital twin* — a shared human + AI awareness surface
The right name for this lens is an **operating digital twin**: a live, continuously-reconciled model of the business's operation *as it is right now*. The load-bearing word is **operating** — this is not a dashboard the operator watches from outside. It is the surface that **both the humans and the AI coworkers inhabit**, are aware of, and act on **together**.

- **AI coworkers are first-class inhabitants, not a backend.** The seating "cog," the expo's late-ticket flag, the dispatch/allocation suggestions, the auto-seat/auto-dispatch — every one of those *is* an AI coworker being **aware of the live twin state and proposing or acting on it**. They read the same `now` (queue depth, capacity, dwell/turn times, stock), reason over it, and their moves render on the twin where a human can see them.
- **Awareness is bidirectional and real-time.** The human acts (seat a party, dispatch a tech, allocate an asset, override a suggestion) and the AI coworkers *see it* and re-reason; an AI coworker acts or flags and the human *sees it* and can intervene. The twin is the medium through which they stay mutually aware — neither is operating blind to the other.
- **Presence and attribution.** The twin shows *who is here* (operator + staff + the AI coworkers on shift) and *who did what* (each action attributed to a human or a named coworker), so a human isn't just seeing state change — they're seeing their teammates, human and AI, at work. Multiple humans and multiple AI coworkers co-present and interacting is the normal case (operator + host + AI-host + AI-expo on the restaurant floor).
- **Grounding = the shared event plane.** What makes co-awareness real rather than cosmetic: the twin's state is the `LivingBusinessSnapshot`, and *both* human actions and AI-coworker actions flow through the **same** `agent-event-bus` event stream (`tool:start`, `plan:update`, `collaboration:*`, plus human action events). One event plane, observed by both parties, is precisely what makes them aware of each other. Human-in-the-loop stays intact: the AI proposes and acts within its grants (§8), the human confirms or overrides, and every move is on the record.
- **Why it matters for DPF.** This is the concrete, human-legible face of "AI coworkers and humans doing the work together." The coordination plumbing stays backstage (§17); what the operator sees is a living place where their business runs and their AI teammates are visibly at work beside them.

Implementation-wise nothing new is required to *claim* this — the cog suggestions already are AI coworkers reasoning over twin state — but the twin should **make the awareness visible**: a presence row (humans + AI coworkers on shift, each with what they're attending to) and a shared, attributed activity feed (who did what, human or AI, in real time). The flagship restaurant twin demonstrates both.

## 4. Data bindings (bind, do not invent)

The visualization is a **projection**, not a new data model. A single read projection — proposed `apps/web/lib/workspace-home/living-business-snapshot.ts` — composes the existing sources into a `LivingBusinessSnapshot`:

```
LivingBusinessSnapshot {
  archetype:  { id, name, capacityUnit, demandSignature }        // StorefrontConfig.archetypeId → ArchetypeDefinition
  stages:     OperationalValueStreamStage[]                        // deriveOperationalValueStream(archetype)
  workers:    { agentId, displayName, kind, stageKey, state, activity }[]  // Agent + agent-event-bus live state
  units:      { id, stageKey, kind, state, enteredAt }[]           // finance spine + field-dispatch + workforce-activity
  utilities:  { billsDue, taxRemittance, compliance, improve }     // Bill/BillApproval, TaxRemittanceRun, trustGates
  market:     { climate, items[] }                                 // market-research.ts, MarketingBattlecard
  quests:     AttentionItem[]                                      // OperatorCockpit / outside-in ranking
}
```

The **live event plane** is `apps/web/lib/tak/agent-event-bus.ts` (`tool:start`, `plan:update`, `collaboration:*`, `taskrun:stalled`) surfaced to the client over SSE. The snapshot is the initial paint; events animate deltas. This is the exact seam the simulator's P4 targets, so the read-side and write-side converge on one contract.

**Nothing here is net-new domain data.** The one net-new artifact is the *composition* projection + the client rendering. (Confirmed against the schema audit: value stream, agents, activity events, `Bill`/`TaxRemittanceRun`, `MarketingBattlecard`, and market research all already exist.)

## 5. Technology recommendation

**Recommendation: build v1 on the stack already in the repo — `@xyflow/react` for the stream graph + Canvas 2D for the animated unit/energy layer + CSS keyframes, all driven by `--dpf-*` tokens. Add no new rendering dependency.**

Rationale:
1. **No Tool Evaluation Pipeline tax.** `@xyflow/react` (^12.11.2) and `recharts` are already dependencies; a game engine (PixiJS/Phaser/three) would trigger the §9 tool-evaluation gate for a v1 that does not yet need particle-density rendering.
2. **Proven in-repo precedent to reuse, not invent:**
   - `apps/web/components/build/ProcessGraph.tsx` + `AnimatedEdge.tsx` + `process-graph.css` — animated dashed bezier edges (`pg-dash-travel`), running pulse rings (`pg-pulse-ring`), done/error flashes, **already `prefers-reduced-motion`-gated**. This is the motion language; the prototype mirrors it.
   - `apps/web/components/ea/ValueStreamStageNode.tsx` — chevron value-chain stage nodes (`clipPath`) with layout in `value-stream-layout.ts`. This is the stage geometry.
   - `apps/web/lib/ea/value-stream-views.ts` + `archetype-value-stream-projection.ts` — the existing "render the OVSM as a graph" surface.
3. **Theme + accessibility come free** with DOM/SVG + tokens: light/dark/branding via `--dpf-*`, `role`/`aria`, keyboard focus, and a reduced-motion static mode — hard to get right in a pure-canvas game engine.
4. **The prototype proves the envelope.** The attached prototype runs the full paradigm — flowing units, docking coworkers with live activity, handoff arcs, utility meters, market ticker, quests, City/District zoom, live/replay/speed, light/dark — on Canvas + DOM + tokens with zero new deps, at interactive frame rates for the low-hundreds of units a single install produces.

**Division of labor in v1:**
- **DOM/`@xyflow/react`** — stage-districts, coworker cards + live activity, HUD, meters, ticker, quests. Accessible, themeable, testable.
- **Canvas 2D** — the ambient animated layer only: rail energy, unit tokens, handoff arcs, pulse rings. Redrawn from the same world-state the DOM reads.

**Upgrade path (deferred, only on evidence of need):** if a future multi-archetype demo or a high-volume install pushes unit counts past what Canvas 2D holds at 60fps, promote the animated layer to **PixiJS** behind the *same* `LivingBusinessSnapshot` + event contract — a swap of the render layer, not the data plane. PixiJS would then go through the §9 Tool Evaluation Pipeline. Three.js / full isometric 3D is explicitly **not** recommended: the value stream is a legible 2D sequence; 3D adds cost and occlusion without adding meaning.

## 6. Research & Benchmarking

Per §10, comparing data models (not feature lists) of open-source leaders and commercial products.

### Open-source
- **React Flow / `@xyflow`** (already adopted). Data model: `Node[]` + `Edge[]` with custom node/edge types and a controlled viewport. **Adopt:** node+edge graph as the stage substrate; custom `ValueStreamStageNode`; animated edges for flow. **Reject:** its free-form drag-to-edit editor UX — the value stream is a *curated* sequence, not an operator-drawn canvas; we lock layout and animate, we don't let the owner rewire their business by dragging.
- **d3 / visx / d3-force.** Data model: data-join + force/layout simulations. **Adopt nothing wholesale** (d3 is not a dep; adding it repeats React Flow's job). **Anti-pattern identified:** force-directed layout for a value stream — force graphs cluster by connectivity and lose sequence; a stream's meaning *is* its order (attract→…→retain), so a settling force layout would actively destroy the read.
- **PixiJS / Phaser** (game engines). Data model: scene graph + ticker + sprite batching. **Adopt (as the deferred upgrade path only):** ticker-driven ambient sim + a batched sprite layer when unit density demands it. **Reject for v1:** heavy dep, weak theming/a11y story, and a Tool-Eval gate for capability we do not yet need.
- **OpenTelemetry / Grafana / Jaeger service graphs.** Data model: spans/edges with rate + latency + error attributes animating a topology. **Adopt:** the "live event stream → animated graph, node color = health, edge = traffic" pattern — directly analogous to `agent-event-bus` → docking coworkers + flowing units.

### Commercial
- **Celonis / UiPath Process Mining** (the closest analog). Data model: an event log projected to a process graph with per-edge throughput, variants, and conformance. **Adopt:** per-stage throughput/metric bindings and the event-log→graph projection idea (our OVSM already carries `metricBindings`). **Reject:** their information density and analyst framing — correct for a process engineer, cognitively hostile to a small-business owner; we keep City view to ≤6 stages + ≤5 quests (progressive disclosure, §12 UX-fit).
- **Datadog / New Relic service maps.** Data model: live topology, animated request traffic, node health. **Adopt:** animated traffic along the route + node-health coloring semantics kept distinct from the accent.
- **Salesforce / HubSpot pipeline & Kanban.** Data model: opportunities in ordered stage columns. **Reject as the primary paradigm:** static columns render a *snapshot*, not a *living* machine — no motion, no geography, no supporting-activity substrate, no coworkers. Kanban is a good *District* drill-in, not the City view.
- **Factory automation / MES / value-stream mapping (VSM)** — the strongest operational analogy, and the one we lean on hardest. These are not products with a public data model to read; they are a *discipline*. The VSM data box carries, per process, **cycle time (C/T)**, and between processes an **inventory triangle** (WIP waiting) plus a **wait time**; the **lead-time ladder** at the bottom contrasts value-added (process) against non-value-added (waiting) to yield **flow efficiency**, and the longest wait names the **bottleneck / constraint** (Theory of Constraints). MES/SCADA dashboards add live WIP-per-buffer and throughput. **Adopt (v1):** the *buffer between tiles is first-class* — each rail shows WIP queue depth + wait time, the bottleneck rail is flagged, and a lead-time ladder + flow-efficiency figure sits under the stream. This is exactly "the stuff you see in value streams," and it maps to real data: `workforce-activity` work items carry `enteredAt`/`updatedAt`, so queue depth (count waiting at a stage) and wait time (now − enteredAt) are *derived*, not invented; stage `metricBindings` already include `lead-time`, `no-show-rate`, `utilization`. **Reject:** the full VSM notation set (data boxes, push/pull arrows, kaizen bursts) as default — it's for a process engineer; the layman sees queue counts, waits, one bottleneck, and one flow-efficiency number.

### Simulation games (the four the operator named)
Not products we integrate — proprietary, no data model to read — so these informed the *metaphor*, while the software above informed the *implementation*. Each named game maps to one idiom:
- **Railroad Tycoon** → the value stream as a **route** carrying units station to station, with visible **handoffs** and **buffers** between stops. *(the rails + between-tile queue/wait)*
- **SimCity** → the **utility grid**: supporting activities (Finance/HR/Compliance) as infrastructure feeding the primary line, with **bills & taxes as utility meters** that fill and must be paid. *(the support/utility band)*
- **Civilization** → **units with state** advancing across a map, **city→district zoom**, and a **turn/time** control. *(work-unit tokens; District zoom is P3; live/replay time is P2)*
- **Spore** → work that **evolves as it advances** — a lead matures into an order, a job, an invoice, a paid receipt, changing form at each stage. *(units evolve in color **and size** along the stream: small blue "new demand" → accent "in service" → larger green "settled"; the fuller creature-morph is a P3 enhancement.)* This idiom was under-used in the first cut and is now explicit.
Factorio (added by us) supplies the **conveyor + throughput/bottleneck** reading that dovetails with the VSM/MES analogy above.

### Gaps this design fills
1. A single surface that renders the OVSM as a *living* thing rather than an ArchiMate diagram (`/ea/value-streams`) or a backlog (`/ops`).
2. The **read-side** the Business Activity Simulator's P4 was designed to feed but which had no design doc.
3. The one net-new composition — a `LivingBusinessSnapshot` — aggregating bills/taxes/market/competitive signals that today live in separate models with no unified operator-facing home (the gap the schema audit flagged).

## 7. Phased plan

Aligned to the simulator so read-side and write-side land together.

- **P1 — the board, snapshot-only (static live paint).** `LivingBusinessSnapshot` projection + the DOM/Canvas board component, rendering current state on load. Registers as a workspace-home contribution (`resolveWorkspaceHomeContribution`) so it slots into `VerticalWorkspaceHome` per archetype. Ships with the prototype's City view, stages, coworkers, personas, utility meters, market ticker, and quests bound to real reads. No live event stream yet (poll-refresh). Reduced-motion + light/dark + a11y from day one.
  - **Increment — live workforce activity in the snapshot (DELIVERED, BI-FB233706).** The presence row + attributed feed now reflect **real coworker work**: `activeAwarePresence` / `activeWorkToFeed` (`apps/web/lib/twin/live-workforce-activity.ts`) join active/working `TaskRun`s to the workforce roster, so each coworker shows *what they are doing now* (task title as focus), stalled loops are marked *unresponsive* (the generalized form of the self-upgrade cognitive-load fix, BI-D0F4C6FB), and the feed leads with real coworker activity before demand events. A **`partner`** actor kind (reseller/franchisee) is added to the twin actor model + `ActorMark` (populating a real partner source is a follow-up). Pure + unit-tested; fail-soft in `loadLivingBusinessProjection`. This is the snapshot-level realization of the live human+AI plane §4 named as deferred; the SSE **animation** of these same deltas remains P2.
- **P2 — live events.** Subscribe the board to `agent-event-bus` over SSE; animate deltas (docking, handoffs, unit transitions, stalls). This is the join point with the simulator's P4 emit. The presence/feed shapes it animates are already the real ones (increment above), so P2 is the streaming layer, not new data.
- **P3 — drill + zoom.** District zoom with per-stage queue + coworker roster; drill-through routing to each stage's real surface; Unit-journey view.
- **P4 — the demo/test toggle.** The multi-archetype switcher (test-instance-only, gated exactly as the simulator §9 specifies) so one test install can showcase all archetypes; wire the simulator as the driving event source for demos.

## 8. Non-goals
- Not an editor — the operator does not rewire their value stream by dragging (that is EA's `/ea` surface).
- No new domain tables — this is a projection + rendering layer.
- No game engine in v1 — Canvas 2D + `@xyflow/react` + CSS; PixiJS is a deferred, evidence-gated upgrade.
- No 3D / isometric-3D.
- Multi-archetype switching is test-only; a real install is exactly one archetype (mirrors the simulator's §9).

## 9. Open questions
1. **Home placement** — does the Living Business board *replace* `PlatformWorkspaceHome` as the default body, sit *above* the `OperatorCockpit`, or become a dedicated `/workspace` hero with the cockpit as its HUD? (Leaning: hero body of `VerticalWorkspaceHome`, cockpit folded into the HUD rail, so there is still one "what needs you now" surface — consistent with BI-8C3EB52C's single-attention-surface decision.)
2. **Event volume** — at what live unit count does Canvas 2D need the PixiJS upgrade? Instrument P2 to answer with evidence, not guess.
3. **Persona fidelity** — seat personas from `workspace-home/profiles.ts` only, or also from `CoworkerService.personas` / route personas? (Start with profiles.ts; it carries the `primaryOperatingQuestion` framing.)

## 10. Verification & docs impact
- **UX-fit (§12, enforced):** this adds a route/hero + metric components → requires a recorded `UX-Fit-Decision` (run `dpf-ux-fit-review`, score on `human_cognitive_load`) before implementation lands. The City-view ≤6-stage / ≤5-quest progressive-disclosure default is the cognitive-load answer to carry into that decision.
- **Docs surface:** on implementation, update `docs/user-guide/` (operator "reading your Living Business" help) and `docs/architecture/` (the read-side of the value-stream/activity architecture). This spec + the prototype satisfy the §6 Spec/Plan/Doc gate for the design phase.
- **Build gate:** implementation phases follow §5 — unit tests for the projection, `next build`, and UX verification of the board against the running app via the shared local-CI sandbox lease.
