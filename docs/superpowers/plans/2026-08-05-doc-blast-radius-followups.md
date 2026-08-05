# Doc blast-radius follow-ups — implementation plan

> Covers **BI-6C112948**, **BI-3E5969DF**, **BI-6868891B**. Parent epics
> `EP-DOCS-SYSTEM` (first two) and `EP-CI-GATES` (third). Shipped as one PR to
> keep merge churn down; the three changes touch disjoint files.

## Context

Three merged PRs closed one half of the doc blast-radius problem and named the
other half:

| PR | What it did |
| -- | ----------- |
| [#3871](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3871) | Repaired stale BET-5 datastore prose; widened the doc-impact corpus to the whole published site; added the Retired Substrate Guard |
| [#3980](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3980) | Added the `gate-coverage-matches-blast-radius` kernel principle |
| [#4004](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4004) | Derived doc-impact edges from links docs already contain (27 → 155 code edges) |

The through-line: **a green check meant "the part I looked at is fine" while being
read as "this is fine."** Two places that gap still exists, plus one gate whose
documented fix could not be evaluated at all.

## Substrate verified before planning

Per `dpf-verify-substrate-first`, and it changed the plan twice:

- **`Document` / `DocumentReference` Prisma models exist** (`packages/db/prisma/schema.prisma:6493`).
  No new model is needed.
- **The graph mirror is Postgres, not Neo4j.** BET-5 replaced Cypher with the
  `graph_node` / `graph_edge` tables; `packages/db/src/graph-sync.ts` is the write
  side and `pg-graph.ts` the read side. The projection target is the mirror tables,
  reached through the existing upsert primitives — not hand-written SQL.
- **A doc-staleness detector ALREADY EXISTS** — `scripts/build-docs-staleness.mjs`
  (BI-AA5DFEA2), a git-timestamp signal refreshed weekly by
  `refresh-docs-staleness.yml`. BI-3E5969DF was filed as though the field were
  empty. It is not, and that reframed the work from "build a detector" to "measure
  what the detectors we have can actually see" — which is what the BI's own
  measure-before-gating instruction asks for anyway.

## BI-6C112948 — project doc↔code edges into the graph mirror

**Hard constraint: the CI gate stays database-free.** `policy-guards-pr` in
`.github/workflows/ci.yml` has no `services:` block (only `test-web` and
`test-packages` do), so a DB-backed gate cannot run there. The generated JSON
manifest remains the contract the gate reads; this projection is a downstream
consumer and never a prerequisite.

That constraint is enforced structurally, not by comment:

| File | Role | Imports |
| ---- | ---- | ------- |
| `packages/db/src/doc-impact-graph.ts` | pure planner: manifest → nodes + edges | **nothing** |
| `packages/db/src/doc-impact-graph-sync.ts` | writes the plan to the mirror | `graph-sync` (→ Prisma) |
| `packages/db/src/rebuild-doc-impact-graph.ts` | full-rebuild runner | both, plus `fs` |

The split is load-bearing. A single module importing `graph-sync` transitively
pulls in the generated Prisma client, so a planner test would need a database —
which is the thing the constraint forbids. This was caught by the first test run
failing on a missing Prisma client, not by review.

### Key space: reuse the code graph's, do not mint a parallel one

The first version of this keyed nodes by bare paths (`apps/web/lib/x.ts`) and
invented `SourceFile` / `Route` labels. **Querying the live mirror proved that
wrong**: the Code Intelligence Graph (EP-CODE-GRAPH) already holds those exact
files and routes — 4,215 `CodeFile` and 459 `CodeRoute` nodes — keyed
`source-code:<path>` and `source-code:route:<route>` by `buildCodeFileKey` in
`apps/web/lib/integrate/code-graph/neo4j-projection.ts`.

Parallel nodes would have split every file across two identities: `IMPORTS` /
`TESTED_BY` hanging off one and `IMPACTS` off the other, with no traversal able to
cross between them. That is a single-source-of-truth violation that no test would
have caught, because both halves would have looked internally consistent.

Final shape:

| Node | Key | Label | Owner |
| ---- | --- | ----- | ----- |
| Source file | `source-code:<path>` | `DocImpactSource` (additive) | shared with code graph |
| Route | `source-code:route:<route>` | `DocImpactSource` (additive) | shared with code graph |
| Doc page | `doc-impact:<path>` | `DocPage` | this projection |

Endpoints carry the **additive** `DocImpactSource` label rather than claiming
`CodeFile`. `graph-sync`'s upsert UNION-merges labels, so a file the code graph
indexes becomes one node labelled both; a file it does not index (`.sh`, `.yml`,
`.prisma` appear in the manifest but are outside the code graph's extractors) is
labelled honestly instead of counterfeited as a `CodeFile` with no checksum, which
would pollute the code-structure queries filtering `props->>'graphKey'`.

The rebuild runner therefore clears **only** `DocPage`. `clearGraphByLabel`
detaches every edge touching the deleted nodes and every `IMPACTS` edge ends at a
DocPage, so the previous edge set goes without touching a code-graph node.
Clearing `CodeFile` would have deleted 4,215 of them.

Edges run **src → dst the way blast radius runs** — from the thing that changed to
the doc needing review. `IMPACTS` is deliberately **not** added to
`IMPACT_RELATIONSHIP_TYPES` in `pg-graph.ts`; that list drives infrastructure
impact analysis and would start surfacing markdown pages mid-traversal.

### Functional verification

Run against the dev database (`dpf-dev-postgres-1`), not merely reasoned about:

```
Synced 337 nodes and 268 IMPACTS edges
```

95 DocPage, 242 DocImpactSource, 268 IMPACTS — and **48 source nodes came back
carrying BOTH `DocImpactSource` and `CodeFile`**, confirming shared identity rather
than duplication. The payoff query crosses the two graphs in one walk:

| file | docs | imports |
| ---- | ---- | ------- |
| `apps/web/lib/integrate/build-orchestrator.ts` | 2 | 20 |
| `apps/web/lib/routing/pipeline-v2.ts` | 2 | 9 |

That join is impossible under the parallel-node design.

## BI-3E5969DF — measure before gating

The BI is sized large and expected to decompose after a spike. **This PR delivers
the spike and nothing else** — `scripts/measure-doc-staleness-coverage.mjs`, an
advisory measurement that exits 0 no matter what it finds, following
`audit-time-bombs.yml`'s precedent of measuring the static design's noise before
choosing a dynamic one.

The finding, from committed artifacts only:

> **95 of 612 published doc pages (15.5%) carry a doc-impact edge. The other 517
> (84.5%) carry none** and are invisible to the gate by construction. `professions`
> (204 pages) and `founder-kernel` (125 pages) are at 0% and 1.6%.

This inverts the BI's framing in a way worth recording. The BI anticipated an
over-report problem; the corpus has an **under-reach** problem. The existing
timestamp detector reports 3 candidates not because the docs are fresh but because
it can only ever look at pages that link a repo file. Precision is not the binding
constraint — coverage is.

**Recommendation carried in the report: do not gate yet.** Widening edges (the
cheap #4004 direction) beats sharpening signal until coverage is defensible.
Decomposition of the remainder should wait on that decision.

The measurement is refreshed by the existing weekly `refresh-docs-staleness.yml`
rather than added to PR policy guards — gating on it now would contradict its own
recommendation and fail CI whenever anyone adds a doc.

## BI-6868891B — Seed Fit gate re-trigger

`ci.yml` declares `pull_request:` with no `types:`, so it defaults to
opened/synchronize/reopened. `edited` and `labeled` never fire, so a gate that
tells an author to add a `Seed-Fit-Decision:` trailer would never read it — only a
push would, which also re-STALEs a pregate record keyed to the old SHA.

**The obvious fix is unsafe and the PR must not ship it.** Adding `types:` to
`ci.yml` re-runs the whole pipeline on a body edit; skipping the heavy jobs to
avoid that cost posts a `skipped` conclusion that branch protection treats as
satisfied, **overwriting the real result already on that SHA**. A PR whose Unit
Tests genuinely failed would go green because someone fixed a typo in the
description. That is a merge-gate bypass of exactly the kind this epic is closing.

Shipped instead: `.github/workflows/policy-guards-recheck.yml` — a separate
workflow, narrow trigger (`types: [edited, labeled, unlabeled]` only, with
`synchronize`/`opened` deliberately absent so it never duplicates ci.yml), a
distinct check name, and its own concurrency group so a burst of edits cannot
cancel a real CI run. It posts an advisory verdict so the author can confirm their
trailer is right without pushing. The binding required check still comes from
`ci.yml`'s `Policy Guards (PR)`, and this workflow cannot overwrite it.

## Verification

- `packages/db/src/doc-impact-graph.test.ts` — 7 tests, no database.
- `scripts/measure-doc-staleness-coverage.test.mjs` — 10 tests, registered in the
  hand-enumerated `docs-impact-gate` list in `scripts/lib/ci-policy-guards.mjs`
  (a test that is not named there never runs).
- Planner run against the real manifest to confirm the 337/268 counts.
- `gen-doc-impact.mjs --check`, `check-docs-impact.mjs`, `check-doc-links.mjs`,
  and `check-doc-reference-integrity.mjs` all pass.

## Environment note (not a platform defect)

The first rebuild run failed with `duplicate key value violates unique constraint
"graph_edge_pkey"`. The cause was **not** the projection: `graph_edge.id` is
`generated by default as identity`, and the dev database had `max(id) = 304,206`
while its identity sequence sat at `2` — a restore that loaded rows with explicit
ids and never reset the sequence. In that state *every* graph-mirror edge write
fails, including `syncDigitalProduct` and `syncDocumentReference`, and because
`graph-sync` projections are fire-and-forget they fail **silently**.

The live database was checked and is healthy (sequence `338,201` ahead of
`max(id) 336,990`), so this is a local dev-environment artifact, not a shipped
defect. Repaired locally with `setval`. Worth knowing because any future restore
from a dump will reproduce it and the symptom will point at the wrong code.
