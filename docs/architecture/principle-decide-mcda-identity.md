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
