# WWWD decision content discrimination — 2026-08-12 (BI-7E1F128A)

## Problem

`evaluate_org_business_decision` returned an identical confidence (0.6333) and
`escalate` outcome for opposite decisions — a blatantly off-mission one and a core
on-mission one — even after the org published directly-relevant WWWD stances. The
recorded stance was selected but did not change the verdict, so the headline
promise ("your coworkers decide per your business") was not delivered.

## Root cause (confirmed)

`apps/web/lib/decision-perspective/evaluator.ts` → `scoreProfileCoverage`:
confidence was `average(effectiveWeight)` of every material whose `domainClass`
matched, minus risk/override penalties. `scorePerspectiveMaterial` reads only
weight/freshness/evidence/review/promotion; the QUESTION TEXT was passed through
but never read; `resolveProfileMaterial` fetched materials by `profileId +
domainClass` only. So two decisions in the same domain (both `risk-assessment`,
`medium` risk) pulled the same materials → identical confidence + escalate.

## Fix — content-aware directional scoring

Source of truth: the existing WWWD substrate (`org-business-gate` → `evaluator` →
`material`). No new contract; a relevance signal is composed in. WWMD (the
build-studio gate, which shares `evaluateDecisionPerspective`) is untouched — the
new path activates ONLY when a relevance map is supplied, which happens only on
the WWWD (organizationId) path.

- **`stance-relevance.ts`** (new): `computeStanceRelevance(question, materials)`
  scores how relevant each stance is to the question — semantic cosine over
  embeddings of the question vs each material `summary`, min-max normalised within
  the applicable set (robust to the embedding model's absolute-similarity
  baseline), with a lexical token-overlap fallback when the embedding model is
  unavailable (the gate is fail-closed, so it must keep a content signal on a cold
  install). Injectable `embed` for tests.
- **`evaluator.ts`**: the async gate computes relevance for WWWD (fail-soft) and
  passes a `relevanceByMaterialId` map into the synchronous evaluator. When
  present, `scoreProfileCoverage` weights each material by relevance and reads its
  `direction`: `supportMass`/`opposeMass`, `alignmentScore = (support − oppose) /
  (support + oppose)` ∈ [-1,1], and confidence = strongest-relevant-directional-
  weight × |alignment| − penalties. Outcome is directional and asymmetric on
  safety: a relevant `oppose` stance recommends DECLINING at any non-critical risk
  (saying "no" to an off-stance idea is low-consequence); a relevant `support`
  stance governs at low/medium risk (the published stance IS the owner's standing
  decision) but a high-risk approval still escalates; `mixed`/`none`/below-
  threshold escalates.
- **`types.ts`**: result gains `alignmentScore`, `stanceAlignment`
  (approve/decline/mixed/none), `relevanceMethod`.
- **`org-decision-pack.ts`**: the MCP response surfaces the directional verdict.

## Verification

- New tests: `stance-relevance.test.ts` (semantic + lexical fallback +
  normalisation) and `evaluator.test.ts` directional cases — a relevant `oppose`
  stance → confident DECLINE, a relevant `support` stance → confident APPROVE,
  opposite verdicts with different confidence; and the legacy (no-relevance) path
  still returns the identical-confidence + escalate it did before (the documented
  bug), proving WWMD is unchanged.
- Full `lib/decision-perspective/` suite green (253 tests).
- Live: after deploy, re-run `evaluate_org_business_decision` for the toaster
  (off-mission → confident decline) and MSP-partner (on-mission → confident
  approve) and confirm materially different scores + directions.

## Follow-ups (out of scope, noted)

The taxonomy mismatch the BI also flags (stance categories vs the `domainClass`
enum; no mission/market-alignment axis) is a separate concern — this fix makes the
existing domain content-discriminating; a dedicated market-alignment axis can
layer on later.

Design-Grounding-Decision: extends the existing decision-perspective evaluator; no
new contract.
