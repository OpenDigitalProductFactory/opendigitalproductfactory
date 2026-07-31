---
title: Admin Graph Explorer — visual exploration of the unified graph mirror
date: 2026-07-30
backlog: BI-89A149A9
epic: EP-CODE-GRAPH
status: implemented
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

## Follow-ups

- `WikiPageLink` already models the knowledge-corpus link graph but is not in the
  mirror, so the WWMD / WWWD / WSID corpus is not yet explorable here. Mirroring
  it is the natural next domain.
- Saved views ("perspectives") are deliberately out of scope for the first cut.
