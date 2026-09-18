# principle_decide math identity (MCDA)

**Status:** normative for agents and reviewers  
**BIs:** BI-1D23EC26 (quality gates), BI-6006E35D (corpus densify)  
**Research:** [2026-08-10-decision-vector-science-and-corpus-adequacy.md](../superpowers/research/2026-08-10-decision-vector-science-and-corpus-adequacy.md)

## What the scorer is

| Claim | Truth |
|---|---|
| Family | **Weighted Sum Model (WSM / SAW)** — classical compensatory MCDA / MAVT |
| Alignment | \(\sum f_i v_i / \sum \|v_i\|\) over a principle’s signed sparse vector |
| Composite | \(\sum_p w_p \cdot \mathrm{align}_p\) |
| Fallback | Cosine similarity on embeddings when structured overlap is absent |

## What it is not

- **Not Saaty AHP eigendecomposition** at decide-time. AHP principal eigenvectors belong to **weight elicitation** from pairwise comparisons (BI-DF87F8D2), not option ranking.
- **Not** TOPSIS / PROMETHEE / ELECTRE (intentionally deferred for inspectability — principles-as-wiki-kind Appendix B).

## Option set input contract (BI-9889566B)

The scorer discriminates between options only as far as their inputs let it, so the option set is validated before anything reads it. `principle_decide` **refuses** the call — it does not score and then warn — when any entry in `options`:

- is not an object, or
- has no non-empty `id`, or
- reuses an `id` already used by an earlier option, or
- has no non-empty `description`.

`required` in an MCP tool inputSchema is documentation, not enforcement: nothing on the call path validates it. Before this refusal, an option that carried its identity under a different key (a caller writing `key` where the schema says `id`) arrived with `id: ""`, and every such option collapsed onto one entry of an id-keyed feature map. One feature map survived, **all options were scored with it**, every composite came back identical, `recommendation.optionId` echoed back empty and `margin` was `0.000`.

The damage was that the result still read as governed: `signalQuality.usable` was `true` and `featureCoverage.minKeys` reported the surviving map's width, so the BI-E0151DB2 abstention never fired — it correctly saw that features had arrived, not that the rest had been discarded. `uncertain / low-margin` then reads as a genuine close call rather than as scoring that could not discriminate at all.

Two things enforce this, and reviewers should expect both:

1. **The refusal** (`apps/web/lib/decision/option-input-contract.ts`) — the caller hears about the typo, matching the fail-fast treatment `ringScope` and unknown feature keys already get.
2. **A positional feature handoff** (`groundOptionsFromParams` in `evidence-grounding.ts`) — features travel to `decide()` by array position, never by caller-supplied id. Identity the caller controls cannot be assumed unique; a position always is. This holds even on a path that skips the refusal.

Option `id`s stay meaningful for the ledger (`DecisionInteraction.options`, `scoredCriteria`) and for the `evidence` map, which is keyed by option id by design.

## Autonomy gate (BI-1D23EC26)

Unattended proceed requires `signalQuality.autonomyEligible === true`, which means:

1. Recommendation present and **high** confidence  
2. **≥3 feature axes** on every option (`featureCoverageWeak` false)  
3. **Weight sensitivity** stable under ±10% one-at-a-time principle weight swings  
4. **Structured coverage** strong (semantic fallback ratio below warn threshold)  
5. **No commandment conflict**  

A recommendation with `autonomyEligible: false` is **advisory** — surface the ledger and blockers; do not auto-execute.

## Operator surfaces

- Live audit: `/coworker-decisions/decisions` (`DecisionInteraction` ledger)  
- Implementation: `apps/web/lib/decision/option-scoring.ts`, `mcda-quality-gates.ts`  
- Defaults: `PRINCIPLE_DECIDE_DEFAULTS.minFeatureKeys`, `.sensitivityEpsilon` in `packages/db/src/wiki-taxonomy.ts`

## Design grounding

- Existing specs/plans reviewed:
  - docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md (Appendix B WSM identity)
  - docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md
  - docs/superpowers/research/2026-08-10-decision-vector-science-and-corpus-adequacy.md
  - docs/superpowers/plans/2026-07-24-weight-inference-from-rulings.md
- Current code substrate reviewed:
  - apps/web/lib/decision/option-scoring.ts
  - apps/web/lib/mcp/packs/principle-decide-pack.ts
  - apps/web/lib/decision/kernel-consult-ledger.ts
  - packages/db/src/wiki-taxonomy.ts PRINCIPLE_DECIDE_DEFAULTS
  - apps/web/lib/wiki/principle-lint-detectors.ts
- Source of truth:
  - Weighted-sum MCDA (WSM) remains the scorer; autonomy is a quality-gate layer on top, not a parallel decision engine.
- Decision:
  - Ship coverage + sensitivity + autonomyEligible on the existing decide() path; densify sparse corpus vectors; do not replace WSM with AHP/TOPSIS in this PR.

Seed-Fit-Decision: global-default

Docs-Impact-Decision: internal decision-kernel quality gates and principle vector densify; runtime-kernel-commandments / AUTHORING / SCHEMA pages remain accurate without user-visible route or operator-facing doc rewrites (no new public UI, no commandment text change for operators).

<!-- index-refresh: 2026-08-10 -->

