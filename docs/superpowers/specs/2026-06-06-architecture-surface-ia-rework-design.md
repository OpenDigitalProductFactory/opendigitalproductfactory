# Architecture Surface IA Rework — Design

| Field | Value |
| ----- | ----- |
| Status | Draft — substrate-verified + live-reproduced 2026-06-06 |
| Date | 2026-06-06 |
| Epic | EP-ARCH-NAV — Architecture surface navigation + UX rework: one coherent IA for capability map, value streams, and data architecture |
| Live backlog | MCP verified 2026-06-06: BI-034BBB24 (feature, large), BI-24DD4CE3 (bug, small), BI-4C43F8CA (bug, medium) — all triaged `build`. |
| Owning coworker | AGT-ORCH-200 (design) → Build Studio Integrate team; EA aspects steward = Enterprise Architect (`/ea`) |
| Value stream | Explore (ideate/plan) + Integrate; IT4IT §5.2.4 Define Architecture |
| WWMD | `principle_decide` 2026-06-06 (external_coding_agent) → `converge-on-ea-tool`, composite 11.79 vs 7.11 / 6.94, margin 4.69, **high confidence**, no commandment conflict |
| Cross-thread dependency | EP-DATA-ARCH Phase 3 (BI-759537CA) seeds a `Data Model` ViewpointDefinition + managed `EaView`; this IA hosts it. See `docs/superpowers/specs/2026-06-06-data-architecture-self-maintenance-design.md` (PR #1580). |

## 1. Problem

The DPF "Architecture" experience is fragmented across three disconnected surfaces, and the primary one is a dead-end:

1. **Business Capability Map** at `/portfolio/architecture` — the only surface the "Architecture" nav reaches. It lands directly on the capability map with no way to switch to any other architecture aspect, is wrapped by the portfolio product-tree rail that does not scope it, and its cards overflow/clip at desktop widths.
2. **Enterprise Architecture tool** at `/ea` (Overview / Views / Reference Models tabs; `EaView` / `EaViewElement` / `ViewpointDefinition` / `EaElement` substrate; the Enterprise Architect coworker) — **fully functional but orphaned: it has zero entries in `apps/web/lib/navigation/portal-navigation-model.ts`** and is reachable only by typing the URL.
3. **Value-stream architecture** — not a missing feature. It is an EA reference-model projection materialized via `/ea/models/[slug]` → "Load value stream view" (per `docs/superpowers/specs/2026-03-14-ea-reference-value-stream-projection-design.md`, status *Implemented*), rendered by `StructuredValueStreamNode` / `ValueStreamStageNode` on the EA canvas. It is invisible because (2) is invisible.

Net effect for the operator: "Architecture" means only the capability map; value streams "disappeared"; the EA viewpoint substrate (ArchiMate/BPMN, and the incoming live ERD) has no discoverable home. EP-DATA-ARCH is about to add a `Data Model` viewpoint whose own spec requires it to live "in the existing architecture tool without adding another dashboard or route family" — so the IA must give every viewpoint a single, discoverable host *now*, or the ERD lands in the same orphaned tool.

This is not a missing-substrate problem. Every aspect already exists. The gap is **navigation and composition**: one architecture home that hosts the aspects, plus a focused layout fix on the capability map.

## 2. Goals

1. One discoverable, uncluttered Architecture home reachable from the primary nav.
2. That home hosts, as peer aspects: **Capability Map**, **Value Streams**, **EA Views & Viewpoints** (ArchiMate/BPMN), and **Data Model / live ERD** (EP-DATA-ARCH).
3. Restore value-stream discoverability without re-implementing it.
4. Fix the capability-map card overflow/clipping and clarify (or remove) the portfolio rail association.
5. Extend the existing `/ea` EA substrate; add no parallel architecture surface — honoring the EP-DATA-ARCH constraint.
6. No hardcoded colors; reporting/list UX composed from report-kit + DPF theme tokens.

## 3. Verified Substrate

| Capability | Current substrate (verified 2026-06-06) | Design implication |
| --- | --- | --- |
| "Architecture" nav entry | `portal-navigation-model.ts` key `ea_modeler`, label "Architecture", path `/portfolio/architecture`, section `products`. | Repoint to the converged home; keep the label "Architecture". |
| EA tool routes | `/ea` (overview), `/ea/views`, `/ea/views/[id]`, `/ea/models`, `/ea/models/[slug]`, `/ea/agents`; `EaTabNav` = Overview / Views / Reference Models. | This is the home. Broaden its tab set; **no `/ea` ref exists in the nav model** (grep: 0). |
| Capability map | `/portfolio/architecture/page.tsx` → `BusinessCapabilityMap` → `BusinessCapabilityMapClient` → `CapabilityMapCanvas` (`CapabilityMapTiles.tsx`); data via `getBusinessCapabilityMapData()`. | Relocate as the "Capability Map" aspect; reuse the component as-is (after layout fix). |
| Capability map layout | `CapabilityMapTiles` nests families at `xl:grid-cols-2`, L2 children at `md:grid-cols-2`, inside a canvas squeezed by an always-open 24rem detail panel (`2xl:grid-cols-[minmax(0,1fr)_24rem]`). | Root cause of clipping; redesign the responsive grid + detail panel. |
| Portfolio rail | `/portfolio/layout.tsx` renders `PortfolioTree` (product list) around every `/portfolio/*` page, including architecture; it does not scope the capability map. | When the capability map moves out of `/portfolio`, the rail no longer wraps it. Resolves the association confusion structurally. |
| Value-stream view | EA reference-model projection: `EaView.scopeType="reference_model_projection"`, `scopeRef="<slug>:value_stream_view"`; service `packages/db/src/reference-model-projection.ts`; canvas nodes `StructuredValueStreamNode` / `ValueStreamStageNode`. | Surface a "Value Streams" aspect that lists/links these projection views and the IT4IT load/refresh action. |
| Viewpoints | `ViewpointDefinition` exists; consumed in `/ea/views/[id]`, `EaCanvas`, `ElementPalette`. No viewpoint **browser/list** UI. | Add a "Views & Viewpoints" aspect that lists `ViewpointDefinition`s + their managed views. |
| Data Model viewpoint | EP-DATA-ARCH Phase 3 seeds a `Data Model` `ViewpointDefinition` + `EaView` (`scopeType="data-model"`, `scopeRef="prisma"`). | Appears automatically under "Views & Viewpoints"; optionally a first-class "Data Model" aspect tab. **Coordinate, don't collide.** |
| BPMN notation | `packages/db/src/seed-ea-bpmn20.ts` seeds the `bpmn20` notation. | Viewpoints/views aspect renders BPMN as well as ArchiMate. |

## 4. Decision (WWMD)

`principle_decide` (external_coding_agent population, `mark-dpf-platform` profile, 20 commandment-tier principles, strong structured coverage) scored three architecturally-distinct options:

| Option | Composite | Verdict |
| --- | --- | --- |
| **converge-on-ea-tool** | **11.79** | **Recommended — high confidence, margin 4.69** |
| new-architecture-domain-home | 7.11 | Rejected |
| cross-link-minimal | 6.94 | Rejected |

Top contributors for the winner: **Single Source of Truth (0.83)**, **Research & Use Standards (0.90)**, **Ship Real Functionality (0.75)**, **No Hardcoded Colors (0.90)**. No commandment conflict.

- **Rejected — `new-architecture-domain-home`:** a brand-new top-level route family duplicates the existing `/ea` shell and directly conflicts with the EP-DATA-ARCH "no new top-level nav / no new route family" constraint. Scores worst on Architecture-Over-Shortcuts and Single-Source-of-Truth despite a clean end-state.
- **Rejected — `cross-link-minimal`:** leaves two architecture homes and gives viewpoints no single host — it papers over the IA problem (lowest Proper-Fix-Over-Quick-Fix, negative on Test-in-build).

**Decision: converge on the existing EA tool as THE architecture home.**

## 5. IA Design

### 5.1 Canonical home + nav

- Make the architecture home reachable at canonical path **`/architecture`**, implemented by relocating the existing `/ea` route group (its layout, tabs, and pages move; substrate untouched). Add permanent redirects `/ea/*` → `/architecture/*` and `/portfolio/architecture` → `/architecture`. This is a *rename of the one existing family to its canonical name*, not a second parallel surface — it honors the EP-DATA-ARCH constraint (one home) while matching the operator's mental model (the operator referred to the surface as `/architecture`).
  - *Lighter alternative if rename blast-radius is a concern at plan time:* keep `/ea/*` paths and only repoint the nav label "Architecture" → `/ea`. The aspect IA below is identical; only the URL differs. The recommended path is the rename; this fallback is documented so the plan can choose with eyes open.
- In `portal-navigation-model.ts`, repoint the `ea_modeler` entry's `path` to the home and keep label "Architecture". Remove the dead-end `/portfolio/architecture` destination (it becomes a redirect).

### 5.2 Aspect navigation (replaces `EaTabNav`)

One tab strip at the architecture home, ordered by operator frequency:

| Aspect | Route | Renders | Source |
| --- | --- | --- | --- |
| **Capability Map** | `/architecture/capabilities` | existing `BusinessCapabilityMap` (post-layout-fix) | relocated from `/portfolio/architecture` |
| **Value Streams** | `/architecture/value-streams` | list of `reference_model_projection` value-stream views + IT4IT load/refresh action; opens the EA canvas | existing projection substrate |
| **Views & Viewpoints** | `/architecture/views` | existing EA views list + a new `ViewpointDefinition` browser (ArchiMate + BPMN) | existing `/ea/views`, extended |
| **Reference Models** | `/architecture/models` | existing reference-model conformance | existing `/ea/models` |
| **Data Model** | surfaces under Views & Viewpoints; promote to its own tab when EP-DATA-ARCH Phase 3 lands | EP-DATA-ARCH `Data Model` viewpoint/view | EP-DATA-ARCH |
| Overview | `/architecture` | home summary across aspects | existing `/ea` overview |

The "Data Model" viewpoint requires **no IA change to appear** — it is a `ViewpointDefinition` and shows up in "Views & Viewpoints" automatically. Promoting it to a first-class tab is a one-line addition once BI-759537CA seeds it. This is the coordination contract with EP-DATA-ARCH: this epic owns the viewpoint *host*; EP-DATA-ARCH owns the viewpoint *content*.

### 5.3 Capability-map layout fix (BI-4C43F8CA)

Defects reproduced live (1568px, `/portfolio/architecture`):

1. **Cramped/clipped L2 & L3 cards** — `CapabilityMapTiles` produces up to four ~150px columns (families `xl:grid-cols-2` × L2 `md:grid-cols-2`) inside a canvas already narrowed by a 24rem detail panel; titles wrap to 3–4 lines and descriptions clip ("Invoicing And Accounts Receivab…", "Support And Follow-Up").
2. **Uneven band heights** — families in a 2-col row stretch to the tallest sibling, leaving large gaps; the operator's "text spills over neighboring boxes" overlap originates here at intermediate widths.
3. **Unscoped portfolio rail** — `PortfolioTree` wraps the page without scoping the map.

Fixes:

- Rework the responsive grid so card width never collapses below a legible minimum: drive families and L2/L3 with `minmax()`/auto-fit column tracks (or report-kit layout primitives) rather than fixed 2-col nesting; cap nesting depth shown inline and disclose deeper levels progressively. No hardcoded colors (the file already uses `--dpf-*` tokens + `color-mix`; keep that).
- Replace the always-open inline 24rem detail panel with a panel that does not steal canvas width at the breakpoints where clipping occurs (e.g. drawer/overlay below `2xl`, or a collapsible right rail) so the canvas keeps full width for the cards.
- Verify clean reflow at mobile (375px), tablet, and desktop (≥1536px) widths — no overlap, no clipping, even rows.
- **Rail association:** relocating the capability map out of `/portfolio` removes the confusing rail entirely (§5.1). The map is org-wide (archetype-projected), not product-scoped, so it correctly has no product rail in the architecture home. (If a product-scoped capability view is later wanted, that is the existing `/portfolio/product/[id]/architecture` route — out of scope here.)

### 5.4 Value-stream restore (BI-24DD4CE3)

No re-implementation. The "Value Streams" aspect (§5.2) lists existing `reference_model_projection` value-stream views and exposes the IT4IT "Load / Refresh value stream view" action already implemented on the reference-model detail route. Restoring the nav path to the EA home makes the existing surface discoverable again. Empty state (fresh install, no projection yet): "No value-stream view generated yet" + a load action for authorized users — never a blank canvas.

## 6. Decomposition

| Order | BI | Size | Outcome |
| --- | --- | --- | --- |
| 1 (parallel) | BI-4C43F8CA | medium | Capability-map responsive layout fix + detail-panel rework; self-contained in `CapabilityMapTiles.tsx` + page composition. Ships independently of the IA move. |
| 2 | BI-034BBB24 | large | Relocate `/ea` → `/architecture` (with redirects), aspect tab nav, repoint nav model, relocate capability map as an aspect, viewpoint browser, EP-DATA-ARCH host contract. |
| 3 | BI-24DD4CE3 | small | Surface the "Value Streams" aspect entry + empty state within the converged home (depends on #2). |

BI-4C43F8CA is independent and can land first to give the operator immediate relief; BI-24DD4CE3 is a thin follow-on once the home exists.

## 7. Research & Benchmarking

- **LeanIX (SAP) / Ardoq / Bizzdesign HoriZZon** — commercial EA tools converge capability maps, value streams, and viewpoint-filtered diagrams under a single "Architecture" workspace with a **viewpoint/report switcher**, not separate top-level destinations. Adopted: one home, aspect switcher, viewpoint as the extension axis. Rejected: their heavyweight per-diagram editors (DPF already has `EaCanvas`).
- **ArchiMate 3.2/4 "viewpoint" mechanism** (OMG) — the standard models *viewpoints* as named, stakeholder-scoped selections over one repository. DPF's `ViewpointDefinition` already implements this; the IA exposes it rather than inventing a parallel "aspect" concept. This is why the Data Model viewpoint needs no bespoke route.
- **Backstage (Spotify) software catalog** — a single catalog with pluggable "tabs" per entity; new capabilities appear as tabs, not new apps. Adopted: aspects-as-tabs, additive. Anti-pattern rejected: a second orphaned route family (the very defect this epic fixes).
- **IT4IT v3.0.1 §5.2.4 Define Architecture** — value streams, capabilities, and architecture views are one value-stream's outputs; co-locating them is standard-aligned.

## 8. UX Fit

Decision: `fits-with-guardrails`.

- Owning area: Platform / EA tooling. Route family: the existing EA tool, renamed to its canonical `/architecture` path — **no second architecture surface**.
- Navigation layer: one aspect tab strip at the home; no new top-level nav section beyond the existing "Architecture" entry.
- Reuse: existing `BusinessCapabilityMap`, `EaCanvas`, reference-model projection, `ViewpointDefinition`; report-kit for any list/table/badge/KPI in the new aspect pages.
- Empty/failure states: honest per aspect (no value-stream view yet, no viewpoints yet) — never blank.
- AI boundary: aspect/view clicks are read-only navigation; load/refresh/steward actions show a context preview and require explicit confirmation (or run as governed background jobs).
- Theme: no hardcoded colors; all surfaces on `--dpf-*` tokens.

## 9. Verification

- **Unit:** `CapabilityMapTiles` layout (no fixed narrow columns; auto-fit tracks); nav-model resolves "Architecture" → home; redirect map (`/ea/*`, `/portfolio/architecture`); aspect tab active-state.
- **Typecheck:** `pnpm --filter web typecheck` in the worktree.
- **Build:** `pnpm --filter web build` in canonical local install or shared local-CI convergence sandbox.
- **Functional (live install per §5 of AGENTS.md):** "Architecture" nav opens the home; each aspect reachable; capability map reflows cleanly at 375 / 768 / 1536+ px with no overlap/clipping; Value Streams lists/loads the IT4IT projection; Views & Viewpoints lists viewpoints; `/ea/*` and `/portfolio/architecture` redirect.
- **EP-DATA-ARCH coordination:** confirm a seeded `Data Model` `ViewpointDefinition` appears under Views & Viewpoints with no further IA change.
- **UX:** browser exercise at desktop + mobile widths; no hardcoded colors; honest empty states.

## 10. Risks

- **Redirect/blast-radius of the `/ea` → `/architecture` rename.** Mitigation: permanent redirects + a grep sweep for internal `/ea` links (e.g. `ReferenceModelDirectory`, product architecture page) before merge; the §5.1 fallback (keep `/ea` paths, repoint the label) is the de-risked option if needed.
- **Collision with EP-DATA-ARCH.** Mitigation: explicit host/content contract (§5.2) — this epic ships the viewpoint host; the Data Model viewpoint appears automatically. Sequence so the host exists before/with BI-759537CA.
- **Layout fix scope creep.** Mitigation: BI-4C43F8CA is contained to the capability-map component + its page composition; it does not depend on the IA move and ships first.
- **Runtime-bound verification.** Worktree checks are source-local only; build/redirect/UX evidence comes from the canonical local install or shared local-CI convergence sandbox.
