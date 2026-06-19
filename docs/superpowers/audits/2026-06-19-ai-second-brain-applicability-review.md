# AI Second-Brain Framework — Applicability Review for DPF

**Date:** 2026-06-19
**Trigger:** Operator shared a transcript of a "5 Levels of an AI Second Brain" walkthrough and asked: review it for applicability to DPF, implement anything that aligns with our goals and matters.
**Verdict:** DPF already meets or exceeds the transcript's *mechanics* (Levels 1–4) and has the *autonomy* infrastructure for Level 5. The genuine, actionable value is in the transcript's **epistemology** — three knowledge-discipline ideas that were real gaps in the founder kernel. Those are implemented in this change; the mechanics needed nothing.

---

## 1. What the transcript covers

A five-level maturity model for a personal/team "second brain," explicitly tool-agnostic (markdown + folders, usable by any agent):

1. **Routing** — `CLAUDE.md`/`AGENTS.md` as a router over markdown folders; exact-word retrieval; "where things live" rules.
2. **Wiki + auto-memory** — indexed wiki pages with backlinks, trail-following; an auto-maintained memory file.
3. **Semantic search** — vector embeddings, chunking, similarity retrieval (with the honest caveat that chunking loses whole-document context).
4. **Knowledge graph** — typed entities + typed relationships ("Jordan works-at Acme; Acme endorsed-by Postpilot").
5. **Always-on** — crons continually syncing/refreshing memory (e.g. "GBrain").

Plus four cross-cutting principles worth more than the mechanics: *start with the end in mind* (design storage from how it'll be retrieved); *find the lowest level that fits — don't add complexity without pain*; *context vs. connections* (ingest evergreen knowledge, not ephemeral noise, but keep access to the noise); and *can your agent find it again?* (the retrieval test). The presenter's strongest claim: **"the bigger problem is getting everything out of your brain into the system,"** not retrieval.

## 2. DPF mapped to the five levels

| Level | DPF status | Evidence |
|---|---|---|
| **1 — Routing** | **Exceeds** | `AGENTS.md` (canonical rulebook + pointers from `CLAUDE.md`/`.cursor`/etc.), kernel principles addressed by slug, skills auto-discovered from `packages/dpf-skill-pack/skills/`, specs/plans under `docs/superpowers/`, backlog in Postgres. Routing is multi-surface and typed, not just folder convention. |
| **2 — Wiki + auto-memory** | **At level** | `WikiPage` + `WikiPageRevision` + `WikiPageLink` (backlinks), 8 page-kinds + principle taxonomy, kernel/per-org overlay, vector **and** Personalized-PageRank retrieval modes, `wiki_query`/`doc_*` tools. Conversation memory (`semantic-memory.ts`) exists; autonomous *consolidation* ("autoDream") is designed, not yet shipped. |
| **3 — Semantic search** | **At level** | Qdrant, 768-dim cosine, 4 collections (agent-memory, platform-knowledge, wiki-pages, documents); `search_knowledge`, `search_knowledge_base`, `doc_search`, `search_design_intelligence`; two-pass scoped→global recall with dedup. Lexical/slug retrieval kept where appropriate (code graph, profession corpus). |
| **4 — Knowledge graph** | **Exceeds** | Neo4j multi-domain graph: code graph (files/symbols/routes/tools/models/tests with confidence-tagged edges), the living architecture graph (`EAElement`/`EARelationship`, SysML + ArchiMate, cross-layer edges — EP-ARCH-GRAPH-LIVE), portfolio taxonomy, wiki backlinks, document references. `query_ontology_graph`, `run_traversal_pattern` (blast-radius, traceability, impact). Enterprise-grade. |
| **5 — Always-on** | **Infra present; autonomy partial** | Inngest job queue, schedulers, `code-graph-refresh`, `run_hive_scout_ingest`, `get_code_graph_freshness`, learning-commons routing. Refresh is mostly event-/operator-triggered; continuous memory consolidation is the open piece (pre-existing roadmap, see §5). |

**Conclusion:** the transcript is an intro-to-intermediate guide; DPF's substrate is well beyond it on every mechanical axis. Re-implementing any level's machinery would duplicate existing, more sophisticated substrate — a `verify-substrate-before-proposing-new` / `single-source-of-truth` violation.

## 3. The real gaps — the kernel's epistemology layer

The transcript's principles map onto the founder kernel (84 principles at time of review). Five were checked; three were genuine, load-bearing gaps:

| Transcript idea | Kernel coverage | Action |
|---|---|---|
| **Getting knowledge out of the head is the bottleneck** (active elicitation) | **GAP** — kernel grows by passive authoring; no elicitation principle or skill. The DAP experience-layer spec even names `elicitation` as first-class-but-unbuilt. | **Implemented** — principle + skill |
| **Start with the end in mind** — shape storage from the retrieval question | **GAP** — fragments in `selective-memory`/`trust-the-data-spine`, but no principle that says design storage from the query outward. | **Implemented** — principle |
| **Can your agent find it again?** — findability as a capture requirement | **GAP** — `wiki_lint`/`flag_stale_knowledge` exist as tooling, but no principle making findability part of the act of capture. | **Implemented** — principle |
| **Context vs. connections** — evergreen vs. ephemeral | **Covered** by [`selective-memory-not-total-recall`](../../founder-kernel/wiki/principles/selective-memory-not-total-recall.md) | None |
| **Lowest level that fits; no complexity without pain** | **Substantially covered** by [`verify-substrate-before-proposing-new`](../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md) + [`substrate-cleanup-before-substrate-addition`](../../founder-kernel/wiki/principles/substrate-cleanup-before-substrate-addition.md) | None — a near-duplicate principle would violate `principle-based-rules`/`single-source-of-truth` |

These three gaps share one theme the kernel was missing: it had memory **hygiene** (`selective-memory`) and **routing** (`learnings-belong-in-the-shared-commons`), but nothing on knowledge **acquisition**, **retrieval-shaped modeling**, or **findability** — the engineering of how knowledge enters and is found.

## 4. What this change implements

One coherent concern: the knowledge-engineering discipline (**acquire → shape for retrieval → keep findable**), grounded in established practice (knowledge-acquisition bottleneck; access-pattern-driven modeling; Morville's findability).

- **Skill** `packages/dpf-skill-pack/skills/dpf-elicit-tacit-knowledge/SKILL.md` — the "grill me" capability adapted to DPF: research what the system already knows, run a focused one-question-at-a-time interview to draw out the genuinely-tacit gap, capture it in retrieval shape, prove it's findable, then hand off to `dpf-route-learning-to-commons`. Auto-discovered by the seed loader and the `dpf-platform` plugin; cataloged in `AGENTS.md` §16.
- **Kernel principles** (`core` tier, `ai-coworker-universal`, `principlePublic: false` pending operator ratification):
  - [`elicit-tacit-knowledge`](../../founder-kernel/wiki/principles/elicit-tacit-knowledge.md) — the bottleneck is acquisition; actively elicit.
  - [`shape-knowledge-for-retrieval`](../../founder-kernel/wiki/principles/shape-knowledge-for-retrieval.md) — design storage from the retrieval question.
  - [`findability-is-part-of-capture`](../../founder-kernel/wiki/principles/findability-is-part-of-capture.md) — capture isn't done until it can be found again.
- **Raw sources** (third-party, abstract + locator per `RAW-SOURCES-LICENSE.md`): `papers/knowledge-acquisition-bottleneck`, `articles/design-from-access-patterns`, `articles/ambient-findability`.
- **Manifest** bumped: `kernelVersion` 0.2.1 → 0.3.0, `pageCount` 88 → 91, `sourceCount` 11 → 14.

Principles are `core`, not `commandment` — strong defaults, deliberately humble for newly-authored doctrine. `principlePublic: false` keeps them off the public docs site until the operator ratifies. The PR is the ratification gate; trim or retier any principle in review.

## 5. Deliberately not implemented

- **Re-building any Level 1–4 mechanism** — already present and more capable; would duplicate substrate.
- **A "simplest-mechanism" principle** — folded into existing substrate principles rather than duplicated.
- **Level 5 autonomous memory consolidation ("autoDream"), profession-corpus continuous sync, build→doctrine feedback loop** — these are real and worthwhile, but they are **pre-existing DPF roadmap** (designed in `docs/superpowers/specs/2026-04-02-agentic-architecture-patterns-design.md` and adjacent), not findings from this transcript. They are platform features, not doctrine, so they belong in the backlog/Build-Studio pipeline, not this kernel PR. Flagged here for the operator; not filed, to avoid duplicating any existing BI without a backlog sweep.

## 6. Recommended next step

Ratify (or trim) the three principles in PR review. If autonomous consolidation (Level 5) is worth pursuing, sweep the backlog for an existing autoDream/consolidation BI before filing — it may already exist.
