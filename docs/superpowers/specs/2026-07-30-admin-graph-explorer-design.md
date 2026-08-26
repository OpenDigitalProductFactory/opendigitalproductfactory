---
title: Admin Graph Explorer — visual exploration of the unified graph mirror
date: 2026-07-30
backlog: BI-89A149A9
epic: EP-CODE-GRAPH
status: active
---

# Admin Graph Explorer

## Problem

Neo4j gave DPF a browser for visually exploring its own corpus: query for a node,
click it, expand its neighbourhood, see the shape of what is connected to what. It
was used for exploration and for demonstrating the breadth of the platform's
knowledge. BET-5 (BI-A1E864A5) retired Neo4j into the Postgres mirror
`graph_node` / `graph_edge` — a faithful port of the *traversal* surface
(`packages/db/src/pg-graph.ts` reimplements the `neo4j-graph.ts` exported surface
function for function) but not of the *exploration* surface. Nothing replaced the
browser.

## Substrate (measured 2026-07-30 on the live install)

`graph_node` — 24,602 rows across 12 labels:

| Label | Count | Label | Count |
| --- | --- | --- | --- |
| CodeSymbol | 7,268 | ArchiMate\_\_DataObject | 532 |
| PrismaField | 6,540 | EaElement | 532 |
| CodeFile | 4,215 | CodeRoute | 459 |
| ExternalModule | 2,696 | InfraCI | 453 |
| TestFile | 1,278 | PrismaModel | 397 |
| | | CodeTool | 231 |
| | | Portfolio | 1 |

`graph_edge` — 31,904 rows across 15 relationship types, led by IMPORTS
(10,764), DEFINES (7,665), HAS_FIELD (6,540), TESTED_BY (1,986).

The mirror is therefore already a cross-corpus graph: code, data model,
architecture ontology, and infrastructure in one adjacency structure.

## Gap analysis — what already renders a graph

| Surface | Component | Reads | Covers |
| --- | --- | --- | --- |
| `/inventory`, `/platform/tools/discovery` | `RelationshipGraph`, `TopologyGraph` | Prisma domain tables | Products, portfolios, taxonomy, network topology |
| `/ea/views` | `EaCanvas` (React Flow) | `EaElement` | EA ontology only |
| `/ea/data-model` | ERD | Prisma introspection | Data model only |
| Build Studio | `ProcessGraph` | Per-build task graph | One build |

None reads `graph_node` / `graph_edge`. The code graph — the largest corpus at
4,215 indexed files — had no visual surface at all, and no surface let an operator
cross from a route to the file that implements it to the data model it touches.

## Research & Benchmarking

**Open source, data models read not just feature lists.**

- *Neo4j Browser* — the interaction being restored. Its load-bearing property is
  not the Cypher box but the *expand-on-click* loop: seed a small set, then grow
  it one relationship at a time. Adopted. Its raw-query box is **rejected** — it
  presupposes a query language the operator no longer has, and exposing free-form
  SQL over the mirror would be a new injection surface for no gain over a search
  box plus facets.
- *Apache AGE / pgRouting* — model graph traversal as recursive CTEs over
  relational rows, exactly the shape of `pg-graph.ts`. Confirms the storage
  choice; the *pattern rejected* is unbounded `WITH RECURSIVE` for interactive
  queries, because it has no tractable early stop on a hub node. See Decisions.
- *Cytoscape.js / Gephi* — both treat "load everything then filter" as viable
  only under ~10k elements with a compiled layout. At 24.6k nodes with a
  JS force loop, that is not viable; both projects' own guidance is to
  sample or query first. Adopted as the reason for the render cap.

**Commercial.**

- *LinkedIn Krmt / Sourcegraph code graph* — code-intelligence products converge
  on symbol search as the entry point, never a whole-repo picture. Adopted.
- *Neo4j Bloom* — replaces Cypher with saved "perspectives" (curated
  category + relationship vocabularies) so non-authors can explore. Adopted as
  the domain grouping and the humanized label vocabulary.
- *LucidScale / Ardoq* — architecture tools that surface a corpus census before
  any diagram. Adopted as the first-paint element.

**Anti-pattern identified.** Showing storage labels (`ArchiMate__DataObject`,
`PrismaField`) directly to an operator. Every product above maintains a display
vocabulary layer; DPF had none for the mirror, so one was added.

**Gap this design fills.** No surveyed tool spans source code *and* enterprise
architecture *and* infrastructure in one adjacency view, because no other product
mirrors all three into one store. That is DPF-specific and is the reason the
explorer is worth having rather than three per-domain viewers.

## Design

`/admin/graph-explorer`, read-only, gated on `view_admin`.

**Query-first.** First paint shows the corpus census (per-domain node counts) and
a search field. Nothing is drawn until the operator names a starting point.

**Layers.**

| Layer | Module |
| --- | --- |
| Display vocabulary | `apps/web/lib/graph/explorer-vocabulary.ts` |
| Queries | `apps/web/lib/graph/explorer-queries.ts` |
| Server actions | `apps/web/lib/actions/graph-explorer.ts` |
| Client surface | `apps/web/components/admin/GraphExplorer.tsx` |
| Canvas | `apps/web/components/inventory/RelationshipGraph.tsx` (generalized) |
| Purpose contract | `apps/web/lib/ux-budget/purpose-contracts/graph-explorer.ts` |

## Decisions

**D1 — Iterative expansion, not a recursive CTE.** `expandGraphNeighbourhood`
issues one bounded query per hop and applies the node cap *between* hops. A
`WITH RECURSIVE` walk cannot stop early: from a hub node on `IMPORTS` (10,764
edges) it would materialize a large fraction of the corpus before any `LIMIT`
applied. The iterative form also rides the existing `(src_key, rel_type)` and
`(dst_key, rel_type)` indexes directly.

**D2 — Generalize `RelationshipGraph`, do not fork it.** A second force-layout
canvas would be a parallel utility (AGENTS.md §10 checklist item 3). The existing
component gained optional `title` / `nodeLegend` / `linkLegend` / `emptyMessage` /
`hint` / `onFocusChange` props whose defaults reproduce the previous `/inventory`
behaviour exactly.

**D3 — Domains, not labels, in the default view.** Twelve raw labels and fifteen
relationship types exceed the 3–5 default-choice budget. They group into five
domains (Code, Data model, Architecture, Infrastructure, Portfolio); the raw
facets with live counts sit behind an "Advanced filters" disclosure. Scored on
`human_cognitive_load` via `principle_decide` — interaction `DI-A17E11DDE13C`,
`query-first-census-then-expand` recommended at high confidence (composite 10.84,
margin 6.52) over `render-whole-graph` (4.32) and `raw-cypher-style-query-box`
(3.14). Evidence: `docs/ux-fit/2026-07-30-admin-graph-explorer.ux-fit.json`.

**D4 — Seeds are never filtered out.** The label filter constrains what expansion
pulls in, not what the operator explicitly asked for. Asking for a `PrismaModel`
seed while filtering to `CodeFile` neighbours is a legitimate query.

**D5 — Clipping is stated, never silent.** When the node or edge cap binds, the
result carries `truncated: true` and a notice naming the three ways to narrow the
view. A silently clipped graph reads as a complete one.

**D6 — First ratified purpose contract.** The purpose-identity ratchet
(`scripts/build-page-purpose.ts`) grandfathers pre-existing draft routes but
refuses to grandfather a new one. `CONTRACT_MODULES` was empty — every route in
the repo is a grandfathered draft — so this route ships the registry's first
`intent-ratified` contract, and its module is the reference shape for the next.

## Caps

| Constant | Value | Why |
| --- | --- | --- |
| `MAX_SUBGRAPH_NODES` | 400 | The force layout is O(n²) per tick |
| `MAX_EDGES_PER_HOP` | 4000 | One hub node cannot stall a hop |
| `MAX_SUBGRAPH_EDGES` | 2000 | Bounds the payload to the canvas |
| `MAX_EXPAND_DEPTH` | 3 | Beyond three hops the picture stops being legible |

## Canvas legibility and idle cost (added 2026-08-01, BI-C2B6396B)

The caps above assume the canvas stays readable up to `MAX_SUBGRAPH_NODES`. Live
verification after this route shipped showed it did not: a single one-hop
expansion reached **111 nodes / 230 links** and collapsed into a knot in the middle
of the canvas with labels stacked on top of one another. Two causes, both in
`RelationshipGraph`:

**Fixed force constants.** Repulsion was `min(3, 80 / d²)` — already negligible at
30px and effectively zero at 60px — while the link spring pulled every edge toward
a flat 100px regardless of how many nodes shared the canvas. For ~110 nodes in
800×500 the ideal separation is about 60px, where repulsion contributed ~0.02 per
frame against a spring an order of magnitude stronger. The knot was the
equilibrium those constants described.

The forces are now expressed relative to `k = sqrt(area / n)`, the
Fruchterman-Reingold ideal separation, so the layout self-scales with occupancy.
`k` is clamped to [34, 130]: unclamped, a three-node graph would compute a ~365px
ideal and fling its nodes into the corners.

**Unconditional label drawing.** Every node with `size >= 6` painted its name, in
node order, with no overlap test. Labels are now a separate pass with greedy
overlap rejection, ordered hovered/focused first and then by size, so the
important labels always win their space. A skipped label is not lost — hovering
its node reveals it.

**Seeding is deterministic.** Start positions derive from a hash of the node id
rather than `Math.random()`. The same graph now lays out the same way every time,
which makes the picture stable across reloads and reproducible in tests, and it
removes a latent trap: two nodes seeded to exactly the same point have no defined
repulsion direction and stay fused forever.

### The animation loop stops

`tick()` re-armed `requestAnimationFrame` unconditionally. Once the simulation
cooled, `simulate()` returned immediately but `draw()` kept repainting an unchanged
canvas at ~60fps for as long as the page was open. That pinned a renderer thread on
both `/inventory` and `/admin/graph-explorer`, and it is why CDP
`Page.captureScreenshot` timed out against this route — any agent driving this
surface had to fall back to `get_page_text`.

The loop now stops at rest and paints one final frame. Restarting is safe and
automatic because every input that changes the picture re-runs the effect:
`filteredData` covers data and filter changes, and `draw`'s identity changes with
hover, focus, dimensions, and the link legend. A resize additionally re-heats the
layout part-way, because it moves the centre and changes `k`.

## Security

Every server action asserts `view_admin`. Operator text is bound as a positional
parameter and `LIKE` wildcards are escaped; no user input is concatenated into
SQL. There is no write path and no free-form query surface.

## Minimum Architectural Alignment Checklist

1. **Deployment contracts** — none affected. No public API response shape, install
   path, host-coupled default, service boundary, or self-upgrade step changes.
2. **Canonical identity** — not identity-bearing; the explorer reads the mirror
   and introduces no parallel identity.
3. **No parallel utilities** — verified by grep and `search_code_graph` before
   implementation; see the gap-analysis table and D2.
4. **This rulebook** — no rule is re-homed. AGENTS.md is unchanged; the operator
   documentation lives in `docs/user-guide/admin/index.md`.

## Knowledge and portfolio domains (BI-3045CC18, 2026-08-04)

The first cut demonstrated the *technical* substrate only. Two of the things a
demonstration most wants were effectively absent: the knowledge corpus was not in
the mirror at all, and Portfolio was a single node.

### The scope question was already answered by the substrate

The open question recorded against this work was whether the mirror is a *code and
architecture* graph or a *whole-platform* graph. Measured before building, the
substrate had already answered it:

- `explorer-vocabulary.ts` already declared a `portfolio` domain with `Portfolio`,
  `DigitalProduct` and `TaxonomyNode` descriptors.
- `graph-sync.ts` already exported `syncPortfolio`, `syncTaxonomyNode` and
  `syncDigitalProduct`.
- The mirror already carried 569 customer-scoped `InfraCI` nodes with
  `customerAccountId` / `customerSiteId` — business data, not code.

So the mirror was already a whole-platform graph by declaration. What was missing
was not a decision but a **backfill**: `syncPortfolio` and `syncTaxonomyNode` had
zero callers, and `syncDigitalProduct` fired only on create/update, so nothing
predating the explorer was ever mirrored. The governing pattern is that a domain is
only as complete as its rebuild script — every populated domain had one
(`neo4j-rebuild-ea.ts`, `neo4j-rebuild-documents.ts`) and every empty one did not.

Scored through the kernel (`principle_decide`, high confidence, no commandment
conflict), with *Ground New Work In Existing Platform* and *Audit Existing Schema
Before Adding Large Features* the strongest contributors.

### What landed

`packages/db/src/rebuild-knowledge-and-portfolio-graph.ts`, run against the live
install:

| Domain | Before | After |
| --- | --- | --- |
| Knowledge | 0 | 359 nodes, 640 `LINKS_TO` edges |
| Portfolio | 1 | 818 nodes (4 Portfolio, 323 DigitalProduct, 491 TaxonomyNode) |

Totals moved from 24,225 / 32,597 to 25,397 / 34,220.

### One label per wiki node, not two

An EA node carries both `EaElement` and its concrete `ArchiMate__*` type, and the
census sums per-label counts — which is why the read side needs a hard-coded skip
for `EaElement` to avoid double-counting. Wiki pages therefore carry exactly **one**
label, `Wiki__<PageKind>`, so the knowledge domain needs no such special case. A
`Wiki__` prefix rule keeps an uncurated page kind inside the knowledge domain
rather than in the architecture-flavoured unknown bucket.

Nodes are keyed by `WikiPage.id`, not `slug`: the model is unique on
`(organizationId, slug)`, so a slug is ambiguous between a kernel page and each
organization's overlay of it. This matches `EaElement`, also keyed by its cuid.

### Backfill upserts and prunes; it does not clear

`clearGraphByLabel` deletes every edge touching a label before reinserting. For the
portfolio spine that is actively unsafe: EA elements carry edges onto
`DigitalProduct` nodes and only the EA rebuild recreates them, so clearing here
would silently drop cross-domain edges this script cannot restore. The writers are
idempotent UPSERTs, so re-sync suffices; the prune is scoped to the `Wiki__` label
prefix and to the `LINKS_TO` / `OVERRIDES` relationship types this script owns.

### Known limits

- **No structural edge from knowledge to code or data.** `WikiPage` has FKs only to
  its organization, its kernel page, its links, revisions and sources. The
  "route → file → model → the decision that governed it" path is therefore still
  broken at the last hop; closing it needs derived links, not a backfill, and is a
  separate piece of work.
- **`OVERRIDES` is implemented but unexercised** — no page currently sets
  `kernelPageId`, so the backfill wrote 0 override edges.
- 127 of 359 pages are isolated (no `LINKS_TO`); the connected 232 average 3.57
  links, with `Founder Kernel` the largest hub at 27.

### UX budget, re-measured

Adding a sixth census tile adds visible words on arrival, so the budget was
re-measured rather than assumed. The tile renders label + count only — the domain
description is a `title` tooltip, exactly as the five existing tiles already do, so
it contributes no visible text. Against the `detail` shell's caps the route has
wide headroom: 174 baseline default-visible words versus a 450 cap, and
`deferred-detail` is only required above 300. The ratified purpose contract's
`triggeringNeed` and `prerequisites` were updated to name the corpus accurately.

## The arrival picture (BI-F9AA0872, 2026-08-05)

Query-first was the right call and is unchanged — the corpus is ~25k nodes and
drawing it whole is not viable. The consequence not reckoned with was that the page
opened **empty**: to see anything you had to already know a search term, so someone
being *shown* the platform had no way in, and the scale was conveyed as a number
rather than as a picture.

### The wished-for slice does not exist

The preferred option recorded on the backlog item was "a route → its implementing
file → the model it touches". Measured, that path is not constructible:
`schema.prisma` has **zero inbound edges**, and `PrismaModel` nodes are reachable
only from it or from each other. No route or application file reaches a data model.

Measured cross-domain edges — the complete list:

| Bridge | Edges |
| --- | --- |
| infra → portfolio | 562 |
| code → data | 397 |
| portfolio → infra | 291 |

The graph is a set of weakly-connected islands. That is why the default view is a
**curated** seed rather than a sample: a random sample lands between the islands and
looks like unconnected dust, demonstrating the opposite of what is wanted.

### Seeds are resolved by rule, not hardcoded

A hardcoded node key is an install-specific fact that would silently render an empty
canvas on any other install. Each slice names a rule instead —

| Slice | Rule |
| --- | --- |
| Data model | The file that defines the most data models. |
| Knowledge | The most-linked page in the knowledge corpus. |
| Portfolio | The busiest portfolio node. |

— resolved against whatever the install holds, with the node key used only as a
deterministic tie-break. Slices resolve independently and one that resolves to
nothing is **dropped**, so a fresh install with no knowledge corpus still gets a
data-model picture rather than an empty frame or an error.

### Small on purpose

The first attempt used a 120-node cap per slice and drew 268 nodes on arrival —
accurate, but not the "small, hand-picked slice" this is meant to be. At 40 per
slice the arrival picture is 108 nodes / 357 links and still spans five domains.

Measured on the live install, arrival at rest: mean nearest-neighbour **46.4px**,
**0** nodes off-canvas, 44 labels drawn with **0** overlapping pairs, layout at rest
after 228 frames, occupying 733px of the 800px canvas.

### UX budget

The caption is one line — "A sample across Data model, Knowledge, Portfolio. Search
to explore anything else." — because arrival words are the scarce resource. The
canvas was already a `default-visible` region in the ratified contract, so no new
region appears; the route keeps wide headroom against the `detail` shell's 450-word
cap and the 300-word `deferred-detail` threshold.

## Cross-domain edges: the doc-impact projection (BI-0E019B95, 2026-08-06)

The corpus was in the mirror but disconnected. This closes the first real bridge, and
the substrate audit that preceded it corrected three assumptions worth recording,
because two of them were written into the backlog item by me and were wrong.

### What the audit actually found

The item proposed three "cheap" derivations. Measured against the live install:

| Proposed | Reality |
| --- | --- |
| `principleConsumerContexts` → governed route | **Not a route link.** The values are open-ended *domain* slugs (`engineering-flow`, `data-model`, `ui`), and `PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES` is an authoring vocabulary — "new contexts are added by authoring without a schema change". There is no slug→route registry to mirror. |
| `WikiPageSource` → code | **Not code.** `RawSource` is external bibliographic provenance — `web-article`, `standard`, `framework`, with `url` / `doi` / `license`. Not repo paths. |
| doc-impact derivation | **Real, and already committed.** |

So the item's premise — that knowledge→code link data already exists and is merely
unmirrored — is **false for the wiki corpus**. No structural link exists from `WikiPage`
to code, and inventing one is a separate, genuinely-inferential piece of work.

### What was real

`apps/web/lib/docs/doc-impact.generated.json` is a committed, guard-regenerated manifest
holding 529 doc→code and 87 doc→route links. `doc-impact-graph.ts`,
`doc-impact-graph-sync.ts` and `rebuild-doc-impact-graph.ts` already project it into the
mirror — and `graph:rebuild-doc-impact` had **exactly one reference in the repository: its
own definition**. Nothing ever called it, so the mirror held zero `DocPage` nodes.

That is the same failure mode BI-3045CC18 found in the portfolio spine: a complete writer
with no caller. The fix is again a backfill, not a design.

Projected on the live install: **183 `DocPage` nodes, 616 `IMPACTS` edges** —
464 `CodeFile → DocPage` and 85 `CodeRoute → DocPage`.

### The traversal now works

Seeding `/admin/storefront/inbox` draws Route → Source file → Doc page across `Implements
route` and `impacts`. "A route → the file that implements it → the documentation that
governs it" is traversable in the UI.

### Two vocabulary decisions

**Doc pages join the `knowledge` domain rather than getting a seventh tile.** An operator
asking "what explains this?" does not care which store it came from. They keep a distinct
label and colour because the substrates genuinely differ — wiki pages are rows, doc pages
are files the code cites.

**`DocImpactSource` is an additive marker and must not be counted.** The projection stamps
it onto `CodeFile` nodes it shares with the code graph, and the census sums per-label
counts — the same double-count that forced a hard-coded `EaElement` skip. That skip is now
`ADDITIVE_MARKER_LABELS`, enumerated and tested, so the next additive marker cannot
silently inflate a tile. Verified live: Knowledge reads 542 (358 wiki + 183 doc) while Code
stays 39,380, with the 504 markers excluded.

### Still open

`Wiki__*` nodes remain at **zero** cross-domain edges, and no route reaches a
`PrismaModel` — `schema.prisma` still has no inbound edges. The route→file→**model** hop
and the wiki→code hop are both unbuilt, and both need derivation rather than backfill.

## Projections need an invoker (BI-FEDFABF6, 2026-08-26)

The mirror is written by several projections. The code graph and the EA/discovery sync
have their own indexers, so they stay current. The knowledge corpus, the portfolio
spine and the doc-impact bridge are projected by rebuild scripts whose **only reference
in the repository was their own `package.json` definition** — nothing ever called them.

### Measured on a freshly provisioned install

| Domain | Nodes | Has an indexer? |
| --- | --- | --- |
| code (`CodeSymbol`/`CodeFile`/…) | 38,592 | yes |
| EA / ArchiMate | 607 | yes |
| knowledge (`Wiki__*`) | **0** | **no** |
| portfolio / `DigitalProduct` / `TaxonomyNode` | **0** | **no** |
| `DocPage` + `IMPACTS` | **0 / 0** | **no** |

Every domain with a caller is populated; every domain without one is empty. This is the
same defect BI-3045CC18 and BI-0E019B95 each reported separately, reproduced from
scratch — which is what established it as a class rather than two incidents.

Nothing fails and nothing logs. The explorer renders a confident wrong answer.

### Boot is the trigger

`instrumentation.register()` runs after migrations, after every self-upgrade, and on
first start of a new install — exactly when the source data moves relative to the
mirror. A schedule would also work but adds a cadence to tune and misses the
fresh-install case entirely.

`apps/web/lib/graph/refresh-projections.ts` holds the refresh. Three properties make a
boot caller safe, each pinned by a test verified to fail against a straight-line
implementation:

- **Isolated** — one projection failing does not stop the others; a partially-current
  mirror beats one that stopped at the first error.
- **Never throws** — a stale mirror is bad, an unbootable portal is worse.
- **Owned-scope only** — doc-impact clears only `DocPage`, the single label it owns.

It is skipped under measurement runtime, like the self-heal block beside it, because a
sweep portal measures a frozen baseline and background writers racing the crawl are a
known source of same-tree pass/fail nondeterminism.

### Importing a rebuild script must not run it

`rebuild-knowledge-and-portfolio-graph.ts` executed `main()` at module scope and then
disconnected the shared Prisma client. Importing it from the portal would have run a
full rebuild as a side effect of an import and closed the connection under its caller.
It now exports `rebuildKnowledgeAndPortfolioGraph` and guards the CLI entry behind an
`argv` check.

### Still open

Nothing reports projection freshness, so an empty or destroyed domain remains
indistinguishable from a true answer (BI-A73954F7). That is the observability step and
belongs after this one; a drift guard belongs after both — shipped earlier it would sit
permanently red and be disabled.

## Follow-ups

- Derive knowledge → code/data edges so the "decision that governed this route"
  path closes. No FK exists for it today (see Known limits above). This is also
  what would let the arrival picture show one connected story instead of three
  islands side by side.
- Saved views ("perspectives") are deliberately out of scope for the first cut.
