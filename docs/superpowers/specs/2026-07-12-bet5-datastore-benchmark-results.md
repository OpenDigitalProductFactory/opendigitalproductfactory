# BET-5 datastore-hybridization benchmark — results & verdict

_EP-8DC217EB · BI-A1E864A5 · 2026-07-12 · status: **GREEN-LIT** (founder-ratified)_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §BET-5_

## Why this exists

The kernel (`principle_decide`, platform profile) was asked whether to retire Neo4j +
Qdrant onto Postgres. It recommended **`retire_after_benchmark`** (composite 3.695,
margin 1.867, high confidence, no commandment conflict) over retire-now (1.83) and
keep-both (1.75) — i.e. *retire, but prove the perf assumption first* (top contributors:
Never Assume—Verify, Architecture Over Shortcuts). This doc is that proof.

## Method

Local dev data is too sparse to benchmark (Qdrant: 87 vectors in `wiki-pages`, 0 in the
other 3 collections). So the harnesses (`benchmarks/vec_bench.py`, `benchmarks/graph_bench.py`)
run A/B against a **real `pgvector/pgvector:pg16`** container vs the **live Qdrant and
Neo4j**, on representative data:
- **Vectors:** 768-dim cosine k-NN on a **low-rank manifold** (latent 48 → random 768-d
  projection + small noise) — models real `nomic-768` text-embedding structure. Recall is
  measured against **exact brute-force** ground truth. (768-dim isotropic noise is NOT
  representative: concentration-of-measure makes recall collapse for *both* systems.)
- **Graph:** a DAG sized to the **live code-graph** (24,803 nodes / 31,708 edges),
  workloads = bounded 3-hop dependents and full transitive impact (reverse reachability).

## Results

### Graph — Neo4j → Postgres recursive CTE (live scale: 24.8k nodes / 31.7k edges)

| workload | Postgres CTE p50 | Neo4j p50 |
|---|---|---|
| 3-hop dependents | **0.07 ms** | 1.64 ms |
| full transitive impact | **0.07 ms** | 0.96 ms |

Postgres recursive CTE is **~15–20× faster** than Neo4j at the actual code-graph scale —
the graph is small enough (32k edges) to sit in memory where CTEs crush it, while Neo4j's
per-query parse/plan/bolt overhead dominates. **Retiring Neo4j is a performance improvement.**

### Vector — Qdrant → pgvector + HNSW (recall@10 vs exact)

| scale | ef_search | pgvector recall | pg p50 | Qdrant recall | qd p50 |
|---|---|---|---|---|---|
| 50k | 200 | 0.967 | 5.2 ms | 0.998 | 1.8 ms |
| 200k | 400 | 0.969 | 16.8 ms | 0.999 | 8.7 ms |

Qdrant is technically superior (higher recall, lower latency, inline index build vs
pgvector's ~124 s HNSW build at 50k). **But pgvector is comfortably adequate at DPF's
scale:** the real corpus is **87 vectors** today; even at 500–2,300× that, pgvector holds
0.95+ recall@10 in single-to-low-double-digit ms. Qdrant's edge only matters at 100k+
vectors / high QPS — orders of magnitude beyond DPF's foreseeable scale.

## Verdict

**GO on both axes.** Postgres carries the graph *faster* and the vectors *acceptably*;
neither datastore's specialized capability is load-bearing at DPF's scale. The kernel's
`retire_after_benchmark` condition is satisfied. Founder green-lit the retire.

**Founder decision (2026-07-12): take the simpler design now, keep the specialized path as
a recorded option.** The chosen architecture is **single-datastore (Postgres-only)** —
fewer moving parts, one backup/restore substrate, one operational surface. The
specialized-store path (Neo4j + Qdrant) *may* be better at large scale, but for the target
customer/user that scale is a long way off, so it is **not** adopted now — it is preserved
below as a deferred option to re-open when (and only when) scale demands it.

## Optional path — re-adopt specialized stores at scale (deferred, not now)

Recorded for possible future use. The benchmark makes the crossover concrete, so this is a
data-triggered option, not a vague "maybe later":

- **Vectors → re-adopt Qdrant when** the live corpus approaches **~100k+ vectors** *and*
  either sustained high QPS or a hard requirement for ≥0.99 recall@10 at low-single-digit
  ms. Below that, `pgvector`+HNSW holds 0.95+ recall in single-to-low-double-digit ms.
  (Today: **87 vectors** — roughly three orders of magnitude away.)
- **Graph → re-adopt Neo4j when** the code-graph/EA graph grows to where in-memory
  recursive-CTE traversal degrades (rough order: **>1M edges**, or deep unbounded traversals
  on dense graphs). At today's **~32k edges**, Postgres CTE is *faster* than Neo4j, so this
  is far off.
- **Re-open trigger:** revisit via `principle_decide` when a monitored metric (vector count,
  QPS, graph edge count, or observed p95 recall/latency regression) crosses the thresholds
  above. Until then the simpler design stands.
- **Reversibility:** the retirement keeps embeddings/graph *data* authoritative in Postgres
  (both stores are already non-authoritative projections), so re-introducing a specialized
  store later is a re-projection, not a data migration — low switching cost preserved.

## Caveats

- Synthetic data. Real `nomic` embeddings could differ slightly, but the conclusion is
  robust because DPF's real vector count is tiny; re-run `vec_bench.py` against the actual
  corpus during the migration to confirm.
- The perf answer is separate from **migration effort** — the retirement is a ~119-file
  port (`WITH RECURSIVE`/`ltree`(/AGE) for graph; `pgvector`+HNSW for vectors), gated
  behind the single-serialized-migration-author discipline and EP-CLAUDE-INSIDE-OUT
  schema-hot-zone coordination.

## Reusable harness

`benchmarks/vec_bench.py` and `benchmarks/graph_bench.py` are parameterized
(`N`/`Q`/`K`/`LATENT`/`NOISE`/`EFS`; `NODES`/`EDGES`/`SEEDS`) and run in a `python:3.12-slim`
container on the `dpf_default` network against a throwaway `pgvector` container. Re-run them
on production-scale data before cutover to re-validate.
