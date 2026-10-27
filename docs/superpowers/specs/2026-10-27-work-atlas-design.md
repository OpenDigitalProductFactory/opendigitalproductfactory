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

The prototype's archetype switch shows the same layout answering "Are we ready for the next service period?" for a restaurant and "What has to be dispatched or rescued today?" for an HVAC contractor.

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

## 6. Research and benchmarking

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

## 7. Delivery outline (the plan follows approval)

1. **A1 Atlas projection.** The loader, plus MCP `view: "atlas"` on `list_workrooms`. Unit tests cover the health collapse and the bounded size.
2. **A2 Glyph map and triage filters** as the lead of `/ops/workrooms`. Needs UX-fit evidence (`docs/ux-fit/`).
3. **A3 Room inspector checklist.** Restyle the PWA-03 inspector with the stage list and the live line.
4. **A4 Rhythm strip for standing rooms.**
5. **A5 Stage lens.** Depends on the workroom queue emitter. Falls back to absolute age until it exists.
6. **A6 Archetype bindings and the Just now feed.**

Each item is filed under BI-B3D87B06 once the design is approved. The UX-fit and `principle_decide` (`human_cognitive_load`) gates apply to A2 and A3.

## 8. Open questions for the owner

1. Where does the Atlas lead: `/ops/workrooms` (recommended) or the `/workspace` home for the owner role?
2. Does Build Studio's `/build` fleet rail fold into the Atlas as a filter, retiring a separate home, or stay as a delivery-only view?
