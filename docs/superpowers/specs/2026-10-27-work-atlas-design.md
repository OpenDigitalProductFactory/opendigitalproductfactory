---
status: draft
backlog_item: BI-B3D87B06
workroom: WC-6EFDA731
---

# Work Atlas: every workroom in one picture

| | |
|---|---|
| Date | 2026-10-27 |
| Backlog / Workroom | BI-B3D87B06 (triaging) / WC-6EFDA731 |
| Requested by | Owner, 2026-10-27: at scale there is no single, elegant, graphical, at-a-glance place to see all work, its progress and current activity; the archetype matters and day-to-day operations are the crux |
| Extends | [Workroom flow map and measurement](2026-10-02-workroom-flow-map-and-measurement-design.md) (L0–L3, flow states, stage = queue) · [Portfolio work activity](2026-09-07-portfolio-work-activity-design.md) (PWA-01…08) · [Workrooms human operations](../plans/2026-10-13-workrooms-human-operations.md) (BI-65D75876) |
| Prototype | [assets/2026-10-27-work-atlas-prototype.html](assets/2026-10-27-work-atlas-prototype.html) (illustrative data, labelled as such) |
| Verified against | `origin/main` at `1d080dfb46f`; live install via DPF MCP on 2026-10-27 (298 workrooms in population, 48 backlog items in progress, 353 awaiting acceptance) |

## 1. Problem

The owner runs hundreds of workrooms at once and has no single place to see them together. A single Claude Code session shows a step checklist (done, in progress, pending) and a live "currently doing" line. That works well for one unit of work and does not work for 300.

The pieces exist but are spread across about fourteen surfaces, and each one answers part of the question:

| Surface | Shows | Missing for an at-scale glance |
|---|---|---|
| `/ops/workrooms` (Work in progress) | Liveness, operator groups (attention / working / waiting / history), held rooms, portfolio activity tree | Text rows only. Reads at most 200 rooms (`WorkroomActivitySection.tsx:25`). No stage per room |
| `/area/[key]` | Five flow tiles, shape drill-in, rooms per step | Aggregates only. No individual rooms, nothing about what is happening now |
| `/workspace/cases/[caseKey]` | `WorkroomFlowMap` lanes, per-stage state, time against baseline | One room at a time |
| `/workspace` home | Archetype hero value stream (`ValueStreamStrip`), attention | Most stages read 0 until their queues are bound (BI-AF50DBD5). No room-level view |
| `/build`, `/build/work` | Build phase rail, task progress, live feed, needs-you counts | Build Studio and delivery rooms only. A separate home |
| `/ea/workrooms`, `/portfolio`, `/platform/ai/operations-map`, `/ops/dev-loop`, `/workspace/my-queue` | Coordination, placement, AI topology, runtime heartbeats, personal attention | Each covers one dimension only |

**Gap.** No surface lays out every room's current stage, health and live activity as one spatial picture that can be zoomed from the whole estate down to a single room's checklist. The stage checklist exists only on the single-room page. Fleet views are lists, tiles and trees, and a list stops being readable at a glance somewhere past 50 rows.

## 2. Principles the design is held to

- **Disclose, do not add a surface.** This is the kernel principle `disclose-before-you-add-a-surface`. The Atlas becomes the lead of the existing `/ops/workrooms`. It adds no new top-level route, and existing pages remain the places it links to.
- **Overview first, zoom and filter, then details on demand** (Shneiderman, 1996). These map onto the flow-map spec's L0–L3.
- **Calm by default** (ISA-101 high-performance HMI). Grey means the room is moving on its own. Saturated colour, together with a distinct shape, is reserved for states a person must act on. A grey screen is a healthy estate.
- **One meaning per visual channel** (Healey & Enns). Colour and shape mean health. Position means portfolio, shape or stage. Motion means "changed just now" and nothing else.
- **Never colour alone** (WCAG 1.4.1). Each state has its own glyph: square, diamond, barred square, hatched outline, faint fill.
- **Truthful.** States come from governed sources: `liveness.ts`, `workroom-flow-state.ts` and the drive receipts. A room with no signal looks different from a room that is idle by design. Unplaced rooms get their own visible group and are never quietly counted as Foundational (PWA-01).

## 3. Design

The prototype shows each part working on illustrative data for three archetypes.

### 3.1 Today's question (L0, per archetype)

One sentence at the top answers the archetype's `primaryOperatingQuestion` (flow-map spec §9) using live numbers. For DPF: "What is waiting on a person, and for how long? 37 rooms are waiting on a person. The oldest has waited 3d at Repair (usually 23h)." This extends the existing L0 callout and does not add a second one.

### 3.2 Triage counts that double as filters

There are five counts, each shown with the glyph it uses on the map:

- Needs a person
- Stuck or held
- Working now
- Waiting its turn
- No recent signal

Selecting one dims every other room in both lenses. These are the operator groups `/ops/workrooms` already has, with "no signal" separated out of history. No new vocabulary is introduced.

### 3.3 Glyph map, "By portfolio" lens (L1)

- **Layout.** Each room is one 14 px cell. Cells are grouped by the four portfolios plus "Not yet placed", then by delivery shape (`readDeclaredWorkShapeKey`), with an "Unshaped" bucket for rooms that have none.
- **Order.** Within a shape, cells sort worst first: stuck, needs a person, no signal, working, waiting, finished today. Rooms that need attention therefore gather at the left edge of every row.
- **Scale.** 300 rooms fit in one viewport without scrolling. This is a Datadog host map made into a governance map.
- **Group headers.** Each header carries worst-child counts, for example "118 rooms · 18 need you · 7 stuck", following Argo CD's rollup rule.
- **Group rows.** Selecting a group name expands it in place into rows. Each row shows:
  - the title;
  - a stage pip rail (done, current, still to do), where the current pip takes the room's health colour;
  - the current action or the reason it is waiting;
  - a 12-tick activity sparkline.
- **Paging.** Rows page at 8 with an "N more" line. This meets PWA-02: hundreds of rows are never rendered at once, and expansion survives a refresh.

### 3.4 "By stage" lens (L1, aging work in progress)

This lens shows the same rooms by where they are and how long they have been there:

- **Columns** are the archetype's stage families. For DPF they are Shape, Build, Check, Merge and Accept, mapped from the delivery-shape stage keys.
- **Dots.** Each room is a dot. Its height is the time it has spent in its current stage divided by that stage's P50, on a log scale.
- **Bands** mark usual, past P85, and far past.

This is Vacanti's aging-WIP chart. It would have made the §2.2 incident in the flow-map spec (200 rooms piled at one gate) visible on the first morning. P50 and P85 come from the stage = queue telemetry (`QueueMetricSnapshot`, `lib/queue/flow-metrics.ts`).

### 3.5 Day-to-day operations: a rhythm, not a progress bar

Standing rooms (`standing-rooms.ts`, scheduled stewards, stream sweeps) repeat. They do not advance through stages, so a stage rail misrepresents them. Each one is drawn as its last 14 runs:

- filled for on time;
- amber for late;
- outlined red for missed;

plus the time until its next run.

A missed cycle is then as visible as a stuck project. "Day-to-day operations are the crux" gets its own band instead of being lost among projects. Sources: the drive's `awaiting-trigger` state, the room's schedule and its run receipts.

### 3.6 Room inspector (L2/L3, details on demand)

Selecting any cell, dot or row opens a side panel in the shape of Claude Code's checklist:

- **Stages.** Each shows as done (check), current (spinner; amber if it needs a person, red if held) or still to do (dashed). This is a compact rendering of the `buildWorkroomFlowMap` state.
- **Live line.** The current action from the latest `WorkroomActivity` summary, with elapsed time.
- **Callouts.** For a room needing a person, it names who and what. For a held room, it names the cause and the recovery recorded by the drive; `HeldWorkroomsList` already carries both.
- **Facts.** Accountable person, portfolio, and time at this step against usual.
- **Actions.** "Open room" goes to the existing `/workspace/cases/[caseKey]`. "Show in flow map" goes to the area shape map.

This is the existing PWA-03 inspector restyled, not a new inspector.

### 3.7 Just now

A short feed lists the last six state changes across the estate. A cell that changes during a refresh pulses once. The pulse respects `prefers-reduced-motion`, and a Pause control is offered (WCAG 2.2.2). Updates reuse `/api/agent/system-stream` (SSE) or fall back to a 30 s refetch of the atlas projection.

### 3.8 Archetype shaping

Nothing new is declared. The Atlas reads fields that already exist:

| Atlas part | Source |
|---|---|
| Question | `workspace-home/profiles.ts` → `primaryOperatingQuestion` |
| Stage families and unit | `deriveOperationalValueStream()` → `loadBearingStageKeys`, `capacityUnit` |
| Default lens and leading group | `ActivationProfile.portfolios` primary scope. A software platform leads with Manufacturing and Delivery; a restaurant or HVAC contractor leads with its service stream |
| Standing operations | `standing-rooms.ts` for the archetype |

The layout is tailored per business. A restaurant sees its service day by channel, an HVAC firm sees its service area and technician board, and a vet practice sees its book, farm round or ward. Practice focus, service channels, customer segment and location refine these layouts further. The state glyphs never change between businesses. The full design is in [Work Atlas: tailoring the picture to the business](2026-10-27-work-atlas-archetype-tailoring-design.md), and the prototype's business switch and refinement chips demonstrate it.

## 4. Data: one bounded projection built from what exists

An **atlas projection** is a server loader that returns one compact tuple per non-archived room. It needs no new tables.

| Field | Source |
|---|---|
| `capsuleId`, `title`, `portfolioRole` (null → "Not yet placed") | `Workroom` |
| `shapeKey`, `stageKeys[]`, `stageIndex` | `readDeclaredWorkShapeKey` + `readStoredWorkroomDriveState` |
| `health` (one of the six atlas states) | `liveness.ts` + `workroom-flow-state.ts` |
| `ageInStageMs`, `stageP50Ms`, `stageP85Ms` | drive trail + `QueueMetricSnapshot` |
| `nowLine`, `lastActivityAt` | latest `WorkroomActivity` |
| `accountable` | `room-workforce.server.ts` |
| `kind` (project or standing) | `WorkroomSource` + standing-room registry |
| `spark[12]` | `WorkroomActivity` counts per bucket |

At about 120 bytes per room, 1,000 rooms is about 120 KB. That removes the 200-room read cap for the overview; rows stay paged. The same projection also serves an MCP read (`view: "atlas"` on `list_workrooms`), so agents and the UI see one picture. This follows the principle that platform function never depends on a client.

Rendering is plain SVG/HTML on `--dpf-*` tokens. Status colours go through `statusColors.ts`, and the counts use report-kit. **No new chart library** is added, in line with the design research runbook's rule that dependencies are absorbed, not adopted.

## 5. Data gaps the Atlas will show rather than hide

- **Portfolio placement** is null on most rooms (BI-C30A4694, BI-FB6389E0). "Not yet placed" will start as the largest group. That is accurate and puts useful pressure on placement.
- **Rooms carry no archetype** (BI-C30A4694). On a single-organization install the archetype is the organization's, which is enough for v1. A grid spanning several archetypes waits for that item.
- **Stage P50 per shape** needs a workroom emitter into queue telemetry (the flow-map F-items). Until that exists, the stage lens falls back to absolute age with no bands and says so.
- **Collaboration shape** (BI-EA6B9A77) is a different axis from delivery shape. The Atlas groups by delivery shape only.

## 6. One home per question: refactoring the existing surfaces

The owner's concern (2026-10-27): a new view that leaves the old ones in place creates contradictory pictures of the same work. The Atlas only succeeds if it replaces things as well as adding them. Every surface listed in §1 therefore gets an explicit outcome, and the delivery item that replaces something retires it in the same PR.

**Rule 1 — one vocabulary.** The atlas health states are defined once, next to `workroom-flow-state.ts`:

- needs a person
- stuck or held
- working
- waiting its turn
- no recent signal
- finished

Today, `workroom-operator-summary.ts` (attention / working / waiting / history), Build Studio's rail ("Needs you / Working / Waiting / Parked") and `DeliveryTaskHub` (needs-attention / working / waiting / ready / complete) each have their own grouping. All three become adapters over the one definition. A guard test fails any new local grouping of rooms by health.

**Rule 2 — one projection.** Every room-level count and list reads from the atlas projection (§4) or from `buildWorkroomFlowMap` for a single room. No surface computes "rooms needing attention" on its own.

**Rule 3 — one home for each question.** Other surfaces answer their own question and then link into the Atlas, using a URL filter such as `?portfolio=…&state=…&shape=…`, instead of drawing their own room lists.

| Surface | Outcome | What changes |
|---|---|---|
| `/ops/workrooms` lead band, operator groups, `WorkroomInventory` | **Replaced** | Becomes the triage counts and the glyph map. The text inventory becomes the paged group rows |
| `PortfolioActivityTree` | **Absorbed** | Its projection (`projectPortfolioActivityPage`) feeds the group rows and the inspector. The separate tree component is retired |
| `HeldWorkroomsList` ("Shared recovery issues") | **Absorbed** | Becomes the "Stuck or held" filter plus the inspector's cause and recovery callout. The separate section is retired |
| `/area/[key]` Work view | **Kept, narrowed** | Keeps the five flow tiles and the shape map (L2, the destination of "Show in flow map"). Its room-per-step lists link to the Atlas filtered by portfolio and stage instead of listing rooms itself |
| `/workspace/cases/[caseKey]` | **Kept as destination** | L3 detail. The inspector and this page share `buildWorkroomFlowMap`, so the checklist cannot disagree with the detail |
| `/workspace` home L0 callout | **Kept, shared** | Uses the same question component as the Atlas header and links into it. It is not a second computation |
| `/build` fleet rail and `FleetDensityBar` | **Converged** (owner decision pending, §10) | Its counts adopt the shared vocabulary. Recommendation: the build list becomes the Atlas filtered to Build Studio rooms; build detail, ProcessGraph and the live feed stay |
| `/build/work` `DeliveryTaskHub` | **Converged** | Its grouping adopts the shared vocabulary and its room list becomes an Atlas filter. `WorkCapsuleLaunchPanel` (launching work) stays |
| `/ea/workrooms` | **Kept, narrowed** | Definitions and architecture only, per the portfolio-convergence plan. Open-room counts link to the Atlas |
| `/portfolio` | **Kept** | Budgets, health and flow comparison. Room counts link to the Atlas |
| `/workspace/my-queue` | **Kept as a lens** | The same projection filtered to "needs a person" and assigned to the viewer |
| `/platform/ai/operations-map`, `/ops/dev-loop`, `/workforce` | **Kept** | These cover different subjects: AI routing, runtime targets, roster. They link to rooms where relevant |
| MCP `list_workrooms` | **Extended** | `view: "atlas"` returns the same projection, so agents and people see one picture |

Navigation keeps its existing `work_activity` entry. Any route that is retired redirects to the matching Atlas filter, so bookmarks and agent links keep working. The user guide for Work in progress is updated in the same PR as each change, following the AGENTS.md §4 requirement that docs change in the same branch.

## 7. UX design authority

The platform's own UX coworkers take part in this work, not only the generic design guidance used so far:

| Party | Role here | State today |
|---|---|---|
| **UX Design Critic** (`ux-design-critic`, offer `offer-ux-design-critique`) | Advisory critique of the prototype and later the served page, covering hierarchy, density and cognitive load | In its curation stage, with no gating authority. The critique corpus has **0 calibrated entries** and 0 for `/ops/workrooms` (queried 2026-10-27), so any critique it gives now is ungrounded |
| **UX Accessibility** (`ux-accessibility-agent`, AGT-903) | WCAG 2.2 AA, keyboard, contrast and token review on A2/A3 | Available at code review |
| `dpf-ux-fit-review` skill + `principle_decide` (`human_cognitive_load`) | Measured UX-fit evidence before the PR is handed off | Required gate for A2/A3 |

**Is engaging the critic useful, too late, or obsolete?** It is useful, and now is the right point, but its first contribution is calibration rather than verdicts. Because the corpus is empty, the best use is to have the critic draft findings on this prototype and have the owner give each one a verdict (agree, disagree, or reword). Those verdicts become the first calibrated entries for `/ops/workrooms`, so the critique at A2/A3 is grounded in the owner's own judgement. It is not too late, because nothing has been built yet. It is not obsolete, because without a calibrated corpus every later UX gate on this page falls back to generic rubric advice.

## 8. Research and benchmarking

| Source | Adopted | Rejected |
|---|---|---|
| Datadog Host Map (docs.datadoghq.com/infrastructure/hostmap) | One cell per unit, group-by, the whole fleet on one screen | Continuous metric fill; ours is categorical health |
| Argo CD application tiles | Separate stage and health axes, worst-child rollup, click a tile to see its tree | Sync/health jargon |
| ActionableAgile aging WIP (Vacanti) | Stage columns, age against percentile bands | A separate analytics tool |
| Grafana state timeline / status history | Rhythm strip for standing rooms | A full timeline per project, which does not scale past dozens |
| Buildkite pipeline list, GitHub Actions graph | Row with status plus a history strip; a stage rail for one unit | A DAG for the whole fleet |
| Linear project updates | Plain health words and a written "latest" line | A table as the overview |
| ISA-101 high-performance HMI | Grey baseline, colour only for abnormal states, a four-level display hierarchy | — |
| Agent fleet UIs (Devin, Codex dashboards, Claude Code sidebar) | Triage buckets (needs you / blocked / working / review) | Flat lists that top out at a few dozen items. None of these shows hundreds of agents graphically, which is the gap this design fills |

Anti-patterns avoided:

- more than six status colours;
- animating every active room;
- step-count percent-complete bars (stage and age are used instead);
- treemap area as the progress signal;
- horizon charts for a non-technical operator;
- yet another separate dashboard.

## 9. Delivery outline (the plan follows approval)

0. **A0 Shared vocabulary and calibration.** Define the atlas health states once and turn the three existing groupings into adapters over them, with a guard test against local health groupings. In the same item, engage the UX Design Critic on the prototype and record the owner's verdicts as the first calibrated entries for `/ops/workrooms`.
1. **A1 Atlas projection.** The loader, plus MCP `view: "atlas"` on `list_workrooms`. Unit tests cover the health collapse and the bounded size.
2. **A2 Glyph map and triage filters** as the lead of `/ops/workrooms`. Needs UX-fit evidence (`docs/ux-fit/`).
3. **A3 Room inspector checklist.** Restyle the PWA-03 inspector with the stage list and the live line.
4. **A4 Rhythm strip for standing rooms.**
5. **A5 Stage lens.** Depends on the workroom queue emitter. Falls back to absolute age until it exists.
6. **A6 Business layouts and the Just now feed.** Split in the [tailoring spec](2026-10-27-work-atlas-archetype-tailoring-design.md) §8:
   - **A6a:** layouts from the twin template, which need no new data.
   - **A6b:** refinements. Waits on the facet decision (BI-7EE5681A).

The items are filed (2026-10-28): A0 BI-930A4C88, A1 BI-7ACC31F9, A2 BI-3791FDD8, A3 BI-94C9AFC1, A4 BI-D8A6F0F2, A5 BI-AC930585, A6a BI-B0D8394B and A6b BI-7EE5681A. The phased plan is [Work Atlas implementation plan](../plans/2026-10-28-work-atlas-implementation.md). Every item that replaces something in §6 retires or redirects it in the same PR and updates the user guide; an item is not done while the old view still draws its own copy. The UX-fit, accessibility and `principle_decide` (`human_cognitive_load`) gates apply to A2 and A3, and the critic's findings on the served page are recorded against the calibrated corpus.

## 10. Owner decisions and open questions

1. **Decided (owner, 2026-10-27):** the Atlas leads `/ops/workrooms`. The `/workspace` home keeps its existing L0 callout, which links into the Atlas.
2. **Open:** does Build Studio's `/build` fleet rail fold into the Atlas as a filter, retiring a separate home, or stay as a delivery-only view?

## 11. Governed scope manifest

**OBJ-ONE-PICTURE:** An operator sees every non-archived workroom on the install, and which ones need them, on one screen at `/ops/workrooms`, with no row cap on the overview.

**OBJ-ONE-VOCABULARY:** Every surface that counts or groups workrooms by health uses one shared classification, so no two pages disagree about the same room.

**OBJ-ONE-PROJECTION:** People and agents read the same bounded atlas projection, so the portal and `list_workrooms` return the same picture.

**OBJ-DISCLOSE:** From the overview an operator can open a group's rows and a room's step checklist, live action and blocker without leaving the page, and that checklist agrees with the room detail page.

**OBJ-RHYTHM-AND-AGE:** Standing operations show their recent runs, and project rooms show their age at a step against that step's usual time, falling back honestly when no usual time is measured.

**OBJ-NO-PARALLEL-VIEWS:** Each surface the Atlas replaces is retired or redirected in the same change that replaces it, with the user guide updated in that change.

**OBJ-BUSINESS-LAYOUT:** Each business sees its work in a layout derived from its archetype's twin template, refined by recorded operating refinements once they exist, while the state glyphs never change between businesses.

**OBJ-UX-AUTHORITY:** UX-fit, accessibility and cognitive-load evidence, and critique calibrated by the owner's verdicts, gate the user-facing steps.

| Acceptance ID | Objective IDs | Acceptance statement |
| --- | --- | --- |
| AC-ONE-PICTURE | OBJ-ONE-PICTURE | On the served target, `/ops/workrooms` leads with the day's question, five triage counts and one glyph cell per non-archived room, with no 200-room cap. |
| AC-ONE-VOCABULARY | OBJ-ONE-VOCABULARY | One exported classifier yields the six atlas states; the operator summary, Build Studio rail and delivery task hub derive membership from it, and a guard test fails a new local health grouping. |
| AC-ONE-PROJECTION | OBJ-ONE-PROJECTION | The portal loader and `list_workrooms` with `view: "atlas"` return identical tuples for the same install, within about 120 bytes per room. |
| AC-DISCLOSE | OBJ-DISCLOSE | Selecting a cell shows the room's stages, current step, live action and, for need or stuck rooms, who must act or the recorded cause; a parity test proves it matches `buildWorkroomFlowMap`. |
| AC-RHYTHM | OBJ-RHYTHM-AND-AGE | Every standing room shows its last 14 recorded runs as on time, late or missed, with missed distinct from late without colour. |
| AC-AGE | OBJ-RHYTHM-AND-AGE | The stage lens bands a room's age by its stage queue P50 and P85 when telemetry exists, and otherwise labels the column as absolute age with no bands. |
| AC-RETIRE | OBJ-NO-PARALLEL-VIEWS | After the step that replaces them, the lead band, operator groups, `WorkroomInventory`, `HeldWorkroomsList` and `PortfolioActivityTree` no longer render, and their old links resolve to the matching Atlas filter. |
| AC-LAYOUT | OBJ-BUSINESS-LAYOUT | The layout shown equals `deriveTwinProfile`'s template for the install's archetype, a fixture test per shipped template asserts glyphs identical to TENANTS, and unplaceable rooms appear under "Not yet placed". |
| AC-REFINE | OBJ-BUSINESS-LAYOUT | Once organization refinements are recorded, the layout's lanes, panels and standing checks follow them, and no per-leaf refinement field is added. |
| AC-UX | OBJ-UX-AUTHORITY | UX-fit evidence under `docs/ux-fit/`, an accessibility review and a `human_cognitive_load` decision are recorded for the map and the inspector, and the critique corpus holds owner-verdicted entries for `/ops/workrooms`. |
