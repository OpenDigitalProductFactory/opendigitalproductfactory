# Spatial Operational Views — the geometry, editor, and map layer for the twin (design spec)

**Status:** draft · 2026-07-21
**Epic:** EP-SPATIAL-OPERATIONAL-VIEWS (proposed) — extends EP-LIVING-BUSINESS-VIZ
**Author:** platform (via Claude Code, operator Mark)
**Parents:**
- [Operational Twin Framework — one grammar, every archetype](2026-07-12-operational-twin-framework-design.md) — established `deriveTwinProfile(archetype)`, the 13-template registry, and the twin grammar kit. This spec adds the layer that spec deliberately deferred: **true coordinate geometry, an authoring editor, and a geographic map renderer.**
- [The Living Business — value-stream workforce visualization](2026-07-11-living-business-workforce-visualization-design.md) — §3.1–3.3 physical/non-physical taxonomy and the operating-twin doctrine.
- [Workspace-Home Primitive Registry](2026-05-24-workspace-home-primitive-registry-design.md) — registered the `geo-map` primitive (still unbuilt); this spec builds it.
- [Field Dispatch — cross-archetype capability](2026-06-13-field-dispatch-capability-design.md) — `FieldDispatchProfile.routeMode: schematic|geocoded|optimized` and the provider-swappable geocoding boundary this spec renders against.

---

## 1. Problem

The operator asked for what restaurant, warehouse, salon, field-service, factory, sales, and network software all give their users and DPF does not: **a graphical facsimile of the physical operation** — a restaurant floor where you see which tables are open (and which free up soon), a warehouse you plan by, a salon with stylists at their stations, a map with your techs and your customers, a factory with conveyors and production lines showing throughput and bottlenecks, a sales territory, and network devices with real physicality. Two lifecycles: **configure** the space (set up how the business is laid out) and **operate** it (watch live state on that layout).

The twin framework already decided *which* spatial view every archetype gets (FLOOR, TERRITORY, YARD, …) and *what nouns* it binds. But the shipped kit renders each zone as a **titled card container in a CSS grid** — a semantic abstraction, not a geometric layout. Concretely, from the current substrate:

- `ResourceUnitData` (`apps/web/components/twin/types.ts`) carries `key/label/state/owner/sublabel` — **no `x`/`y`/geometry**.
- `TwinZone.tsx` is a flowed card holding a `ResourceUnitGrid` — **not a floor plan or a map**.
- The only coordinate-persisted canvas in the platform is the **EA React Flow canvas** (`EaView.canvasState` JSON) — powerful, but bound to Enterprise Architecture modeling.
- There is **no map/geospatial renderer anywhere** — `Address.latitude/longitude` exists but is only used for haversine distance math, never plotted. `geo-map`/`customer-map` are registered keys with no implementation.
- Network topology (`TopologyGraph.tsx`) is a hand-rolled Canvas 2D force-sim that **computes positions per render and persists none** — hence "no physicality for the network devices."
- There is **no `Table`/`Seat`/`Station`/`Bay`/`Rack`/`Bin`/`Zone`/`Dock` geometry model** in Prisma, and no factory/production-line template at all.

So the gap is exactly and only the **geometric layer**: positions, an editor to author them, renderers that draw space (interior plans and real maps), and live-status binding onto positioned entities. Everything above it (which template, which nouns, the cog, the queues, the feed) is done.

## 2. Goal

A **Spatial Operational Views** layer that upgrades every `physical === true` twin from card-grid to true facsimile, without a bespoke build per archetype, by adding four things to the existing twin substrate:

1. **A geometry model** — persisted positions for placed units and zones, in one of three coordinate spaces, reusing the `canvasState` JSON pattern rather than a new column per shape type.
2. **Three renderers, selected by space kind** — one cartesian-interior renderer (floor plans, yards, bays, seat maps), one geographic renderer (territory/field/sales maps), one node-graph renderer (factory production lines + network topology). Two of the three already have a substrate in-tree.
3. **An authoring editor** — the "end users can configure the layout" capability the twin spec had ruled out, now founder-directed: drag/drop/resize/snap placement in configure mode, with priming from user input so most operators never start from a blank canvas.
4. **Live-status binding** — the same positioned entities, in operate mode, colored and animated from the existing `LivingBusinessSnapshot` + `agent-event-bus`, including a short forward-availability horizon (table free in ~10 min, bay opens after this job).

Non-negotiable constraint carried from the operator's platform stance (**fully-local-by-choice**): the map renderer must work with **no third-party API key and no cloud dependency** — self-hostable, offline-capable tiles.

## 3. The unifying model — one Scene, three spaces

Every spatial view is the same shape: **a Scene of positioned entities, each bound to a live status, in one of three coordinate spaces, viewed in one of two modes.** This is the primitive. It attaches to the twin, it does not replace it.

```
Scene
├─ spaceKind: "cartesian-interior" | "geographic" | "node-graph"
├─ mode: "configure" | "operate"
├─ zones:      polygon/rect regions (dining, kitchen; territory sectors; racking aisles)
├─ placements: entity ⟶ geometry
│     cartesian → { x, y, w, h, rotation, shapeKind }
│     geographic → { lng, lat }  (or a GeoJSON feature for a route/territory)
│     node-graph → { x, y } + connectors[] (conveyors / cabling / routes)
├─ underlay:   optional floor-plan image | map tiles | none
└─ statusBinding: placement.entityRef ⟶ live state (color, badge, forward-horizon)
```

`spaceKind` is a new derived attribute on each physical twin template — it is not authored per install:

| spaceKind | Templates | Renderer | Substrate today |
|---|---|---|---|
| **cartesian-interior** | FLOOR, STORE, BAYS, BOOK, ROOMS, VENUE, COUNTER, DOCK, YARD | React Flow (custom nodes = tables/chairs/bays/racks; group nodes = zones) | **Exists** — `@xyflow/react` v12 + `canvasState` persistence pattern (EA canvas, ProcessGraph) |
| **geographic** | TERRITORY (+ any twin with sited work) | MapLibre GL JS + Protomaps PMTiles | **New dependency** — nothing in tree; builds the specced `geo-map` |
| **node-graph** | FACTORY/LINE *(new)*, network topology | React Flow with animated, throughput-weighted edges | **Exists** — React Flow + `AnimatedEdge.tsx`; topology gains persistence |

The single most important architecture decision: **do not add Konva or a second canvas engine.** React Flow is already the platform's coordinate-persisting canvas, already themed to `--dpf-*`, already carries the `canvasState` save pattern and the `AnimatedEdge`/custom-node vocabulary. A floor plan *is* a React Flow graph with free-drag custom nodes, group nodes as zones, and edges suppressed; a factory line *is* a React Flow graph with edges shown and weighted. One engine covers cartesian **and** node-graph. Konva is reconsidered only if a future high-density seat map (a stadium VENUE, thousands of seats) proves React Flow's DOM-node ceiling — recorded as a deferred escape hatch, not a v1 dependency.

## 4. Technology decisions

### 4.1 Cartesian + node-graph → React Flow (`@xyflow/react` v12, already installed)
- Custom node types per resource noun (`TableNode`, `ChairNode`, `BayNode`, `RackNode`, `SeatNode`, `DeviceNode`, `StationNode`) — thin wrappers over the twin `ResourceUnit` visual, gaining a draggable frame + resize handles in configure mode, status color in operate mode.
- Zones as React Flow **group/parent nodes** (children clip to the zone); territory-less interiors need no ELK — layout is user-authored, so the ELK worker is used only where an auto-arrange affordance is offered (e.g. "auto-grid these 20 tables").
- Factory/topology: edges shown, `AnimatedEdge` reused, edge stroke width/color driven by throughput; a bottleneck is the max-utilization edge/node, surfaced as the single highlighted constraint (grammar rule: one bottleneck, not analyst density).
- Persistence: the EA `canvasState` shape generalized (see §5).

### 4.2 Geographic → MapLibre GL JS + Protomaps PMTiles
- **MapLibre GL JS** — open-source (BSD) fork of Mapbox GL; no token, no account, bundled from our own `node_modules`. This is the only mainstream vector-map engine with no mandatory cloud tie.
- **Protomaps PMTiles** — the entire planet as a **single `.pmtiles` file** on static storage (≈120 GB full planet; a country/region extract is a few GB), served with HTTP range requests and no tile server. Ships as a bundled service asset behind the same "bundled services active by default" doctrine as the local model runner; an install can point at a region extract to stay small. Fully offline-capable (IndexedDB cache via `map-gl-offline` / `maplibre-offline-pmtiles`).
- Geocoding/routing stay behind the **existing `FieldDispatchProfile` provider boundary** (`routeMode: schematic|geocoded|optimized`) — the map renders whatever the profile resolves; `schematic` (no provider) draws pins on a relative canvas so a no-provider install still gets a usable territory view. No new geo provider contract — this spec renders the one field-dispatch already defined.
- Overlays: customer/job pins, tech/van live positions, territory **sectors as GeoJSON polygons**, route lines, and a heat layer for sales-territory density (MapLibre native fill/heatmap layers; deck.gl deferred unless density demands it).

### 4.3 Priming (so the blank canvas is rare)
The operator should almost never start from nothing. Priming sources, in order of leverage:
- **Floor-plan image underlay** — operator uploads a photo/PDF/CAD-export of their floor; it becomes a scaled background raster the operator drops tables/stations onto. (Reuses the existing file-upload/parse path.)
- **Address → pins** — `Address.latitude/longitude` and `CustomerSite` already exist; a TERRITORY map primes with every customer site and today's jobs plotted on first open.
- **Capacity → auto-grid** — a twin that already knows "24 tables / 60 seats" or "N bays" or `CareResource` rooms auto-lays a labeled grid the operator then nudges into their real shape.
- **Import from existing resource records** — `RentableUnit` (YARD bays), `CareResource` (BOOK/ROOMS rooms/chairs), `CustomerSiteNode`/`InfraCI` (topology devices) seed placements with their known identity + status, needing only positions.
- **Onboarding hook** — the archetype onboarding flow captures "how many tables / chairs / bays / rooms" and hands the counts to auto-grid, so the facsimile is populated before the operator ever opens the editor.

## 5. Data model — geometry as a projection, positions as JSON

Following the twin framework's non-goal discipline ("no new domain tables — twin state remains a projection") **as far as it can go, and no further**: live *state* stays a projection (`LivingBusinessSnapshot`), but *authored geometry is durable operator input* and must persist. It gets exactly one small model, mirroring the proven `EaView.canvasState` pattern rather than a column per shape.

```prisma
model OperationalSceneLayout {
  id           String   @id @default(cuid())
  orgId        String                     // tenant scope
  twinTemplate String                     // "FLOOR" | "TERRITORY" | ... (denormalized for query)
  spaceKind    String                     // "cartesian-interior" | "geographic" | "node-graph"
  locationId   String?                    // optional: CareLocation / CustomerSite / site scope
  label        String                     // "Main dining room", "North territory", "Line 2"
  layoutState  Json                       // SceneLayout: zones[], placements[], underlayRef, viewport
  underlayRef  String?                    // uploaded floor-plan asset id, if any
  version      Int      @default(1)
  updatedAt    DateTime @updatedAt
  createdAt    DateTime @default(now())
  @@index([orgId, twinTemplate])
}
```

- `layoutState` holds the whole scene geometry as one JSON blob (`{ viewport, zones, placements }`) — the same "positions live in one JSON, not in columns" decision the EA-2 spec already validated (the `x/y/width/height` columns were *dropped* there in favor of `canvasState`). Positions are operator input, not business truth, so JSON is right; querying by position is never needed.
- `placements[i].entityRef` is a typed pointer (`{ kind: "care-resource" | "rentable-unit" | "infra-ci" | "table" | "seat" | ..., id }`) to the domain record that supplies identity + live status. **Geometry references entities; it does not own them.** A table's reservations, a van's GPS, a device's health all stay in their existing models; the scene only stores where to draw them.
- For **geographic** scenes, per-resource lat/lng that isn't already on `Address` (e.g. a mobile van's live position) comes from the field-dispatch snapshot, not this table — this table stores only authored geometry (territory polygons, static site pins the operator repositioned).
- Migration safety: additive new model, no tightening; data-safe by construction (§AGENTS.md migration rules).

This is the **one net-new table** (§8 revisits the twin spec's "no new tables" non-goal — it applies to *state*, and geometry is *input*, so this is consistent, not a violation).

## 6. Archetype → space kind → renderer (the coverage map)

Derived directly from `deriveTwinProfile` (already assigns the template); this spec adds the `spaceKind` column and the renderer. No archetype is left without a view.

| Twin template | spaceKind | Renderer | Flagship archetypes | Operator's live question |
|---|---|---|---|---|
| **FLOOR** | cartesian-interior | React Flow floor plan | restaurant (food-hospitality) | which tables are open / free up soon |
| **BOOK** | cartesian-interior | React Flow stations + day-grid | hair/nail salon, barber, spa, dental/medical, tutoring, fitness | which stylist/chair/room is free, gap-fill |
| **YARD** | cartesian-interior | React Flow bay layout | equipment/production rental | which asset is ready in which bay |
| **DOCK** | cartesian-interior | React Flow racking + dock doors | 3PL, e-commerce fulfilment, cold-chain, cross-dock | dock/rack/pick-face plan and load |
| **STORE** | cartesian-interior | React Flow floor + POS lanes | retail, florist, artisan goods | floor + back-room + pickup state |
| **BAYS** | cartesian-interior | React Flow lifts/bays/benches | auto repair, auto glass | which bay + tech, awaiting-parts |
| **ROOMS** | cartesian-interior | React Flow occupancy board | pet boarding, animal shelter, inpatient | room/kennel/bed occupancy + turnover |
| **VENUE** | cartesian-interior | React Flow seat/space map (Konva escape hatch if huge) | event venue | seat/space holds vs double-booking |
| **COUNTER** | cartesian-interior | React Flow counters/stations | municipality, utility, permits | queue at which counter, SLA |
| **TERRITORY** | **geographic** | **MapLibre + Protomaps** | trades, moving/logistics, security posts, mobile automotive, HOA/property, construction job-sites, field prof-svcs, **sales territory** | where are my people and my customers |
| **FACTORY/LINE** *(new)* | **node-graph** | React Flow + throughput edges | manufacturing (future archetype) | throughput and where the bottleneck is |
| — network topology | node-graph | React Flow (topology, persisted) | it-managed-services, platform infra | device physicality + blast radius |
| TENANTS / PIPELINE / PROGRAMS | *(board — no geometry)* | existing twin kit | SaaS, banking, legal, media, nonprofit | *not spatial — unchanged* |

Two items are genuinely net-new beyond "render the existing template geometrically":
- **FACTORY/LINE** — there is no manufacturing archetype today; the template + a manufacturing archetype are a coordinated addition (the archetype via `dpf-add-archetype`, the template here). Sequenced last unless the operator prioritizes it.
- **Sales territory** — folds into TERRITORY (it is a geographic map of accounts/prospects by owner), not a new renderer.

## 7. UX — configure vs operate, and the ≤6-zone / ≤5-quest ceiling

- **Configure mode** — palette of the twin's resource nouns, drag onto the scene, resize/rotate/snap-to-grid, draw zones, optionally place an uploaded floor-plan underlay, name things. Autosave (debounced, the EA canvas 1.5s pattern). This is the "set up how the business works" lifecycle.
- **Operate mode** — read-mostly; the same scene, entities colored by live status (open/occupied/soon-free/blocked), the cog's proposed allocation highlighted, tap-to-confirm (HITL, WWWD-gated for business-judgment allocations per twin spec §5.1). This is "use it operationally."
- **Forward-availability horizon** — FLOOR/ROOMS/YARD/VENUE carry the short "free in ~N min / opens after this job" horizon the twin spec already amended in (§4), now rendered *on* the positioned entity (a table pulsing amber = turning soon).
- Progressive-disclosure ceiling from the twin doctrine holds: ≤6 zones, ≤5 quests visible; a big operation summarizes rather than showing every atom.
- The customer-facing read-only variant (restaurant guests seeing open tables) is the **operate-mode scene rendered on the `/portal` external surface** with status only and no attributed presence/feed — same renderer, redacted binding.

## 8. Non-goals (and the two twin-spec non-goals this spec deliberately amends)

- **No 3D / game engine** — the parent's §5 stands. Factory throughput is a 2D node-graph, not a 3D digital twin. (3D remains a much-later ambition, explicitly out.)
- **No second canvas engine** — React Flow for cartesian + node-graph; MapLibre only for geographic; Konva a deferred escape hatch, not a dependency.
- **No new geo provider contract** — renders the existing `FieldDispatchProfile` boundary.
- **Amends twin non-goal "no editor for arranging twins by hand":** founder-directed reversal — operators *do* author their own layout geometry (this is the whole point of "editable"). The non-goal was right for *arranging which twin an archetype gets* (still derived, never authored); it was never meant to forbid an operator placing their own tables. Scope of authoring = geometry within a derived template, not template selection.
- **Amends twin non-goal "no new domain tables":** that rule governs live *state* (still a projection). Authored *geometry* is durable operator input and gets exactly one table (`OperationalSceneLayout`, §5). This is consistent with the rule's intent, not an exception to it.

## 9. Plan (phased; maps to the backlog in §11)

- **P0 — foundation (pure + schema).** `spaceKind` derivation added to `twin-profile.ts` (pure, extend the OVSM test pattern so every archetype resolves a spaceKind); `SceneLayout` TypeScript contract; `OperationalSceneLayout` migration; entity-ref resolver. Source-only gates.
- **P1 + P2 run in parallel (operator decision, 2026-07-21).** FLOOR (interior) and TERRITORY (map) ship concurrently — FLOOR proves the editor pattern on the flagship restaurant example; TERRITORY delivers the highest cross-archetype leverage (one map serves trades, moving, security, HOA, construction, sales). Both are **prime-heavy + light-adjust** in this release (operator decision): auto-grid from known counts, import addresses/sites, then drag-to-nudge — *not* the full authoring editor, which lands in P3.
- **P1 — cartesian renderer + operate/light-configure (React Flow).** The floor-plan renderer + configure(light)/operate modes + autosave, generalized from the EA canvas. **FLOOR** end-to-end: auto-grid tables/zones from counts + nudge, operate with live open/soon-free status, customer-facing read-only variant.
- **P2 — geographic renderer (MapLibre + Protomaps).** Build the specced `geo-map`; bundle a region PMTiles asset + offline cache; render **TERRITORY** for field-service (techs + customers), priming from `CustomerSite`/`Address`. Unblocks trades/moving/security/HOA/construction/sales.
- **P3 — full editor + remaining cartesian templates.** The full drag/resize/rotate/snap authoring experience + floor-plan image underlay + resource-record import; then BOOK, YARD, DOCK, STORE, BAYS, ROOMS, COUNTER, VENUE as template bindings (each a binding, not a build), in install-demand order.
- **P4 — node-graph: network topology physicality + FACTORY/LINE.** Persist topology device positions (give network devices the physicality they lack) under the same `SceneLayout`; add the FACTORY/LINE template + throughput/bottleneck edges (coordinated with a manufacturing archetype if the operator prioritizes it).
- **P5 — certification + simulator.** Golden-journey per spaceKind (configure → operate → cog-confirm); Business Activity Simulator emits per-template spatial scenarios so every view demos live.

## 10. Verification & docs impact

- P0 is source-only (pure derivation + migration + tests → worktree gates + shared sandbox for migration apply).
- P1–P4 are UI-bearing: UX-Fit decision per renderer family; docs in `docs/user-guide/` per landed template family (how to lay out your floor / your territory); evidence via the shared local-CI sandbox and the governed self-upgrade path, never a direct portal rebuild.
- New dependency review: MapLibre GL JS + PMTiles go through `tool-evaluation` (license, bundle size, offline story, no-cloud attestation) before P2 lands.
- This spec satisfies the Spec/Plan/Doc gate for the design phase of EP-SPATIAL-OPERATIONAL-VIEWS.

## 11. Backlog decomposition (proposed; filed in the live backlog per §6 of AGENTS.md)

Epic **EP-SPATIAL-OPERATIONAL-VIEWS** (extends EP-LIVING-BUSINESS-VIZ), with independently-shippable items:

1. **P0 · `spaceKind` derivation + `SceneLayout` contract** — extend `deriveTwinProfile`; pure + tests. *(medium)*
2. **P0 · `OperationalSceneLayout` model + migration + entity-ref resolver.** *(medium)*
3. **P1 · React Flow cartesian renderer + configure/operate modes + autosave.** *(large)*
4. **P1 · FLOOR end-to-end (restaurant) incl. customer-facing read-only + forward-availability horizon.** *(large)*
5. **P2 · `geo-map`: MapLibre + Protomaps bundled service + offline cache + tool-evaluation.** *(large)*
6. **P2 · TERRITORY renderer (field service: techs + customers), primed from CustomerSite/Address.** *(large)*
7. **P3 · Priming toolkit (floor-plan image underlay, capacity→auto-grid, resource-record import, onboarding hook).** *(large)*
8. **P3 · Remaining cartesian templates (BOOK, YARD, DOCK, STORE, BAYS, ROOMS, COUNTER, VENUE) as bindings.** *(xlarge → decompose per template family)*
9. **P4 · Network topology persisted physicality (positions under SceneLayout).** *(medium)*
10. **P4 · FACTORY/LINE template + throughput/bottleneck edges** *(large; coordinate with a manufacturing archetype)*.
11. **P5 · Certification golden-journeys per spaceKind + simulator scenarios.** *(medium)*

## 12. Decisions & open questions

**Resolved by operator (2026-07-21):**
1. **Editor depth in v1 → prime-heavy + light-adjust.** Auto-grid + import + drag-to-nudge first; full drag/resize/rotate/snap authoring in P3.
2. **First-ship → FLOOR and TERRITORY in parallel.** FLOOR proves the editor on the flagship example; TERRITORY delivers cross-archetype leverage. Both funded concurrently (P1 + P2).

**Still open (leaning noted; not blocking):**
3. **PMTiles distribution** — bundle a region extract per install locale (small, offline) vs full-planet on shared storage. Leaning region-extract-by-locale to keep installs light and fully offline.
4. **Sales territory ownership** — render inside TERRITORY with an "accounts" variant, or a CRM-owned sibling surface reusing the geographic renderer? Leaning TERRITORY variant — one renderer.
