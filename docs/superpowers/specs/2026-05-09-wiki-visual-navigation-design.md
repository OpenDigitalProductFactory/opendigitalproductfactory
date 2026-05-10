# EP-WIKI-005: Visual Navigation of the Kernel Wiki

| Field | Value |
|-------|-------|
| **Epic** | EP-WIKI-005 |
| **Builds on** | [EP-WIKI-001 — Platform Kernel Wiki + Per-Org Overlay](2026-05-09-platform-kernel-wiki-design.md) |
| **Builds on** | [EP-WIKI-004 — PPR Retrieval Over the Wiki-Link Graph](2026-05-09-wiki-ppr-retrieval-design.md) (provides the relevance ranking that powers the in-context sidebar and atlas highlight) |
| **Reuses** | [Phase EA-2 — EA Graph Canvas (2026-03-12, implemented)](2026-03-12-phase-ea2-canvas-design.md) — React Flow + ELK toolchain, custom node/edge patterns |
| **Reuses** | [EA Reference Value Stream Projection (2026-03-14, implemented)](2026-03-14-ea-reference-value-stream-projection-design.md) — pattern of materializing a normalized model into a visual view |
| **Status** | Draft (research follow-up) |
| **Created** | 2026-05-09 |
| **Author** | Mark Bodman + Claude (design partner) |
| **Inspiration** | Obsidian graph view; Roam Research bidirectional links; Quartz static-site graph; HippoRAG 2 PPR-weighted subgraph visualization |

---

## 0. Relationship to Existing Infrastructure

DPF already runs a mature canvas stack — wiki visualization should reuse it, not duplicate it.

| Component | Where it lives today | What the wiki reuses |
|-----------|---------------------|----------------------|
| `@xyflow/react` v12 (React Flow) | `apps/web/package.json` | Canvas renderer for tier 2 and tier 3 below |
| `elkjs` v0.11.1 | `apps/web/package.json` | Layout engine (`layered`, `mrtree`, `force`) for both tiers |
| Custom node patterns | `apps/web/components/ea/EaElementNode.tsx`, `BpmnTaskNode.tsx`, `ValueStreamStageNode.tsx`, `StructuredValueStreamNode.tsx` | Pattern reference for `WikiPageNode` variants per `pageKind` |
| Custom edge patterns | `apps/web/components/ea/EaRelationshipEdge.tsx`, `apps/web/components/build/AnimatedEdge.tsx` | Pattern reference for `WikiOverrideEdge`, `WikiSourceCitationEdge`, `WikiReflectionLineageEdge` |
| Canvas state persistence | `EaView.canvasState Json` | The atlas can persist user-pinned layouts the same way; tier-2 mini-graphs are ephemeral |
| Reference-model projection | `packages/db/src/reference-model-projection.ts`, `EaView.scopeType = "reference_model_projection"` | Pattern reference, **not adopted directly** — see §5 for why the kernel atlas is its own route, not an `EaView` projection |

No new visualization library is introduced. No new layout engine. The wiki canvas is `apps/web/components/wiki/` co-located with the existing `apps/web/components/ea/` and `apps/web/components/build/` canvases — three siblings, one shared toolchain.

---

## 1. Problem

EP-WIKI-001 designed the data layer (kernel + overlay, `WikiPageLink`, sources, ingest, lint). EP-WIKI-004 designed the relevance layer (PPR over the link graph). Neither addresses how a human navigates the kernel.

The default failure mode of personal-wiki UIs is the **hairball graph** — Obsidian, Roam, and similar tools visualize all pages and edges at once and become unusable past ~500 nodes. The kernel is intended to compound — at scale it will be thousands of pages — so a global force-directed view is the wrong default.

The right strategy maps to where the user is when they ask the question:

- *"What's relevant to what I'm doing right now?"* — most common; needs a ranked list, not a graph.
- *"How does this page relate to its neighbors?"* — second-most-common; a small bounded graph helps.
- *"What's the shape of the kernel as a whole?"* — least common but high signal for kernel maintainers; needs structural revelation, not navigation.

EP-WIKI-005 specifies three surfaces matched to those three needs.

---

## 2. Three-Tier Strategy

| Tier | Where | Surface | Primary use |
|------|-------|---------|-------------|
| **1 — In-context sidebar** | Any product, portfolio, or domain page | Ranked list (no graph) | "What's relevant here?" |
| **2 — Page-local mini-graph** | Wiki page detail (`/wiki/[slug]`) | Bounded React Flow graph (≤30 nodes) | "How does this page connect?" |
| **3 — Kernel atlas** | `/wiki` route | Pageable graph with cluster-by-`pageKind`, table view, and search | "What's the shape of the kernel?" |

Each tier is independent. The same data (`WikiPage`, `WikiPageLink`, `WikiPageSource`, kernel/overlay flags) feeds all three through different projections. A user never has to leave their primary task to use tier 1; they go to a wiki page for tier 2; they go to `/wiki` for tier 3.

**Volume of use**, in expected order: tier 1 ≫ tier 2 > tier 3.

---

## 3. Tier 1 — In-Context Sidebar (no graph)

The most-used wiki surface should not be a graph at all. It should be a small ranked list embedded in the existing right-hand sidebar of product/portfolio/domain pages.

### 3.1 What it shows

Top 5–7 wiki pages relevant to the current page, queried via `searchByPPR()` (EP-WIKI-004) seeded by:
- The page's title and slug (entity name).
- The route's domain context (already in `route-context-map.ts`).
- The user's recent agent conversation messages on this page (last 3 turns), if any.

Each row shows:
- **Page title** (linked to `/wiki/[slug]`).
- **`pageKind` chip** — `stance ★`, `heuristic ⬤`, `decision ◆`, `entity ▢`, `summary ▭`, `runbook ▬`, `index ◇`.
- **Kernel/overlay badge** — kernel pages carry a small "K" or founder mark; overlay pages are unbadged.
- **Provenance count** — "3 sources" with hover-card showing the citing `RawSource` titles.
- **Freshness state** — amber dot if `validation_state ≠ current` per [TAK §12.5](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md).

`stance` and `heuristic` rows are **always elevated to the top** regardless of PPR score. The kernel exists to surface judgment, and judgment-flavored pages deserve top billing whenever they're at all relevant.

### 3.2 Where it goes

New component: `apps/web/components/wiki/WikiContextSidebar.tsx`. Mounted inside the existing right-hand sidebar shell on:
- `/portfolio/product/[id]/*`
- `/portfolio/[...slug]/*`
- Any agent conversation thread (replaces nothing; appears alongside conversation context).

Mobile: collapses to a "Wiki" tab in the page footer. Same data, single column.

### 3.3 Implementation

- Server component fetches via `searchByPPR({ query, organizationId, seeds, limit: 7 })`.
- Result revalidates on route change and on agent message events (existing React query invalidation pattern).
- No new state, no client-side graph rendering, no new dependencies.

---

## 4. Tier 2 — Page-Local Mini-Graph

A small, bounded graph rendered above-the-fold on `/wiki/[slug]` showing the page's 1-hop neighborhood.

### 4.1 What it shows

- **Center node** — the current page.
- **Out-link nodes** — pages this page links to (`WikiPageLink WHERE fromPageId = X`). Up to 12.
- **In-link nodes** — pages that link to this page (`WikiPageLink WHERE toPageId = X`). Up to 12.
- **Override link** (if applicable) — dashed edge to the kernel page this overrides (`kernelPageId`).
- **Source citation chips** — small icons attached to the center node, one per `WikiPageSource`. Click expands to a side panel with the cited `RawSource`.

Hard cap: 30 nodes total. If more neighbors exist, cluster the lower-PPR-scored ones into a single "+N more" node that expands the atlas with these as the seed set.

### 4.2 Layout

ELK `layered` direction:
- Override edge always points up (kernel above, overlay below).
- In-links flow right-to-center; out-links flow center-to-right. Mirrors how reading flows.
- `pageKind = stance` and `heuristic` neighbors get extra spacing — they're the kernel's judgment surface and shouldn't be visually crowded.

### 4.3 Visual encoding

Per §6 below. Stance pages render as filled stars; heuristics as filled circles; entities as rectangles; decisions as diamonds; summaries as light rectangles; runbooks as elongated rectangles; indices as open diamonds. Kernel = dark; overlay = accent. Override edges dashed; source-citation chips faint; reflection-derived edges curly (per [EP-WIKI-003](2026-05-09-wiki-importance-and-reflection-design.md)).

### 4.4 Implementation

- New component: `apps/web/components/wiki/WikiLocalGraph.tsx`.
- New node components: `WikiPageNode.tsx` (with `pageKind` variant prop), `WikiCitationBadge.tsx`.
- New edge components: `WikiLinkEdge.tsx`, `WikiOverrideEdge.tsx`, `WikiReflectionEdge.tsx`.
- Read-only. No drag, no edit. Click a node → navigate to that page (full reload of `/wiki/[slug]`, refreshes the local graph for the new page).
- Layout cached per `(slug, kernelVersion)` in Redis with 1-hour TTL; invalidated on revision write to any node in the cached subgraph.

---

## 5. Tier 3 — Kernel Atlas at `/wiki`

The dedicated route for kernel maintainers and visual learners. Single page, three modes selectable via tabs.

### 5.1 Mode A — Cluster view (default)

Force-directed graph with cluster constraints by `pageKind`. Stances cluster together (top), heuristics next, then entities, decisions, summaries, runbooks, indices. Overlay pages render lighter; kernel pages bolder. Override edges visible but de-emphasized so the kernel structure reads first.

### 5.2 Mode B — Pagekind table

Same data, sortable table grouped by `pageKind`. Columns: title, slug, kernel/overlay, source count, last revision, freshness. For list-thinkers and for the cases where the user already knows the slug.

### 5.3 Mode C — Time-travel atlas

Cluster view with a slider at the top exposing the **bi-temporal `asOf`** parameter from [EP-WIKI-002](2026-05-09-wiki-bi-temporal-revisions-design.md). Sliding back shows the kernel as it was at any prior point — pages that didn't exist yet are absent; pages whose `worldValidTo` has passed at the current `asOf` are shown but greyed; revisions reflect the chosen point in system-time.

This is the surface that delivers on the "what did Mark believe in 2024 vs 2026?" promise.

### 5.4 Search integration

Search box at the top of all three modes runs `wiki_query` (EP-WIKI-001 §8). Results highlight matching nodes:
- Mode A — matched nodes get a halo; non-matched dim to 30%; PPR-weighted edges from matches stay full opacity.
- Mode B — table filters to matches.
- Mode C — same as A, but grey-dim already includes time-travel exclusions.

Click a search result → drops into the page detail view (tier 2) for that page.

### 5.5 Why not an EaView projection

The reference-model projection pattern (`EaView.scopeType = "reference_model_projection"`, see §0) was considered. Rejected because:
- The wiki and EA serve different mental models. EA views are about architectural intent (relationships between elements); the wiki is about distributed judgment (relationships between concepts and evidence). Mixing them muddies both.
- `EaElement` carries `notationId` (ArchiMate / BPMN / etc.) — wiki pages don't fit a notation.
- Wiki has stronger lifecycle semantics (`pageKind`, kernel/overlay, revisions) that wouldn't survive the round-trip through `EaElement.properties`.

The atlas reuses the React Flow + ELK toolchain but lives at `/wiki`, with its own data path direct to `WikiPage` + `WikiPageLink`. No `EaView` rows.

### 5.6 Implementation

- New route: `apps/web/app/(shell)/wiki/page.tsx`.
- New components: `apps/web/components/wiki/WikiAtlas.tsx`, `WikiAtlasClusterView.tsx`, `WikiAtlasTableView.tsx`, `WikiAtlasTimeTravel.tsx`.
- Subgraph fetched per-tenant via `getWikiSubgraph({ organizationId, asOf? })` — same shape as the EP-WIKI-004 subgraph cache, reused.
- Force-directed layout via `elkjs` `force` algorithm with cluster constraints; falls back to `mrtree` if the tenant graph exceeds 1000 nodes (clearer at scale).

---

## 6. Visual Encoding

Standardized across tiers 2 and 3.

### 6.1 Node shape by `pageKind`

| `pageKind` | Shape | Why |
|------------|-------|-----|
| `stance` | Filled star ★ | Judgment kernel — must be visually distinct |
| `heuristic` | Filled circle ⬤ | Rules of thumb — solid, decisive feel |
| `entity` | Rectangle ▢ | Neutral concept page |
| `decision` | Diamond ◆ | DEC-* records — branching point in time |
| `summary` | Light rectangle ▭ | Lower visual weight than entity to discourage summary-only pages |
| `runbook` | Elongated rectangle ▬ | Procedural feel |
| `index` | Open diamond ◇ | Table-of-contents pages |

### 6.2 Color by kernel/overlay

- **Kernel** (`isKernel = true`): saturated brand color (founder palette — TBD, likely a deep blue or black).
- **Overlay** (`organizationId IS NOT NULL`): organization accent color (configurable per `Organization`).
- **Override**: overlay node + dashed edge to its kernel parent. Override nodes inherit overlay color; the dashed edge inherits kernel color.

### 6.3 State outlines

- **Stale** (`validation_state = stale`): amber outline, 2px.
- **Drift detected** (`kernel-drift` lint finding open): amber outline + small ⚠ icon top-right.
- **Draft** (`status = "draft"`): dashed node border.
- **Archived** (`status = "archived"`): 50% opacity, grey monochrome.

### 6.4 Edge types

| Edge | Style | Source |
|------|-------|--------|
| Wikilink (`WikiPageLink`) | Solid, 1.5px | The default edge |
| Override | Dashed, 2px, kernel-color | `WikiPage.kernelPageId` |
| Source citation | Faint, 1px, dotted, with paper icon midpoint | `WikiPageSource` |
| Reflection lineage | Curly/wavy, 1.5px | EP-WIKI-003 reflection-derived-from |

Source-citation edges are **off by default** in tier 3 (toggle to enable) — they would dominate the visual otherwise. They're always shown in tier 2 because the page-local view is bounded.

---

## 7. Time-Travel and Search

### 7.1 Time-travel slider

Driven by EP-WIKI-002's `asOf` query parameter. Slider increments by week. Below ~6 months of history, a "snap to revision" mode jumps between actual revision points. Above 6 months, free-slide.

The slider lives in tier 3 mode C only. Tier 2 has a smaller "View as-of…" dropdown (presets: now, 1 month ago, 3 months ago, 1 year ago, custom). Tier 1 is always current.

### 7.2 Search across all tiers

Search input at the top of `/wiki` (tier 3) is the canonical search UI. The same query path (`wiki_query` → `searchByPPR` → recognition-memory pre-filter → PPR re-rank, per EP-WIKI-004) backs the in-context sidebar.

---

## 8. Tooling

No new dependencies. Reuse:

- `@xyflow/react` v12 — canvas (already used by EA and build canvases).
- `elkjs` v0.11.1 — layout (already used by EA canvas).
- Existing Tailwind + shadcn/ui primitives — sidebar, table, tabs, slider, badge.
- Existing React Query patterns for fetching and invalidation.

Open question: do we need `graphology` for in-process PPR (already proposed in EP-WIKI-004 §2)? **Yes**, but that's an EP-WIKI-004 dependency, not new here. EP-WIKI-005 consumes the PPR result; it doesn't compute it.

---

## 9. Performance and Scale

The hairball-graph trap is the chief failure mode. Counters:

| Tenant size | Tier 3 default mode |
|-------------|--------------------|
| < 50 pages | Mode A cluster view, full graph |
| 50 – 500 pages | Mode A with `pageKind` clusters collapsed by default; expand on click |
| 500 – 2000 pages | Mode B (table) default; Mode A available but "this view may be dense — search first?" prompt |
| > 2000 pages | Mode B default; Mode A behind a "load full graph" button; render via `mrtree` not `force` |

Tier 2 always shows ≤30 nodes regardless of tenant size — the cap is on display, not on data. The "+N more" affordance routes overflow into tier 3 search.

Subgraph cache (per EP-WIKI-004) is the perf-critical path. Force-directed layout for 2000 nodes in `elkjs` runs in ~800ms; cache the layout result keyed by `(orgId, kernelVersion, asOf, hash(subgraphMembership))` to avoid recomputation.

---

## 10. Risks

- **Hairball at scale.** Mitigated by the progressive-disclosure rules in §9; mitigated further by Mode B table being default at 500+. The PPR-weighted halo on search makes large graphs useful in spite of size.
- **`pageKind` shape vocabulary leaking visual noise.** Eight shapes is borderline — keep them only where the difference is meaningful. Stance/heuristic/decision/entity must be distinct; summary/runbook/index could collapse into one rectangle variant if the seven-shape system feels busy in user testing.
- **Time-travel UI confusion.** Sliding back through bi-temporal data is conceptually rich and easy to misread. Mitigations: large "AS-OF: 2024-08-13" header banner whenever the slider is off "now"; clear visual greying of past-`worldValidTo` nodes; one-click "back to now" button.
- **Mobile non-experience.** Graphs aren't usable on mobile. Tier 1 (sidebar list) covers mobile fully. Tier 2 collapses to in-link/out-link lists with the citation panel intact. Tier 3 is desktop-only with a "Best viewed on desktop" notice; the table mode is mobile-functional.
- **Per-tenant theming for overlay color.** If `Organization.brandColor` doesn't exist, default to a single neutral accent. Cross-tenant atlas comparison is out of scope.
- **Color-blind accessibility.** Kernel-vs-overlay encoded only by color is insufficient. Pair color with the "K" badge per §3.1 and a small icon overlay on overlay nodes; never use color alone to distinguish kernel from overlay.

---

## 11. Out of Scope (separate future specs)

- **Multi-user real-time collaboration on the atlas.** Same exclusion as Phase EA-2.
- **Export to PNG/PDF/SVG.** Useful for printing / sharing but a tooling concern, not a navigation concern.
- **Cross-tenant kernel comparison.** Visualizing how multiple orgs' overlays diverge from the kernel — privacy and governance model is a separate spec.
- **Embedded canvas inside agent conversation panel.** Tier 1 sidebar is the agent surface for now; an inline agent-driven mini-canvas is a follow-up.
- **AI-suggested layouts.** ELK does the work; "make this graph prettier" via LLM is a research toy and out of scope.
- **3D / VR navigation.** Not while we have flat-design problems still unsolved.
- **Edit-mode atlas.** All three tiers are read-only. Editing happens on `/wiki/[slug]` page detail through the existing wiki edit flow (EP-WIKI-001 §8 `wiki_propose_edit`).
