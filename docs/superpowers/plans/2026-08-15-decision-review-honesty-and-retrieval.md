---
title: Decision review honesty and doctrine retrieval — implementation plan
authoredAt: 2026-08-15
authoredBy: operator
epic: EP-0AF96937
---

# Decision review honesty and doctrine retrieval

Three defects found while draining a live operator review queue on 2026-08-15.
They present as one symptom — "the AI keeps asking me things it should already
know, and asking twice" — but have separate causes, so they are separate BIs on
one branch.

## Backlog coverage

- Decision: decomposed
- Parent: BI-F5F2869D
- Dependencies: BI-932C2A81 depends on BI-F5F2869D landing first — clustering must not re-impose the domain split that fix removes.
- Rationale: one branch because all three touch the same retrieval/presentation path and share the relevance primitive; splitting them would force three rebases over the same files.
- Mappings:
  - honest-unresolved-reason -> BI-38658E6B
  - domain-as-prior -> BI-F5F2869D
  - semantic-review-clustering -> BI-932C2A81

## Evidence

Measured on the live install, not inferred:

| Interaction | Question | Recorded outcome |
|---|---|---|
| DI-B4E7DCC2D028 | lapsed subscription after our billing error | `escalate`, `coverageGap:false`, confidence 0.35, 3 on-point sources |
| DI-3A99C3561FA0 | onboard an MSP as certified reseller | `escalate`, `approve` (+1), semantic, confidence 0.50 |
| DI-789B4B99CA9B | toasters to Alaskan fishermen | `recommend`, `decline` (−1), semantic, confidence 0.60 |

13 unresolved rows presented as 6 cards representing 3 actual decisions.

## 1. BI-38658E6B — the queue invented a reason

`normalizeReason()` coerced any absent or unrecognised `unresolvedReason` to
`principle-gap`, rendered as "Clarify operating policy". DI-B4E7DCC2D028
recorded `coverageGap:false` with a promoted ruling on the same question already
in the corpus, and was still told to write that doctrine.

After BI-7E1F128A made confidence relevance-weighted, the advice is
misdirecting: more stance material can move the score by zero.

`deriveUnresolvedReason()` reads what the gate recorded, most-specific-first —
recorded reason wins, `coverageGap:true` is the only signal that keeps the
doctrine wording, conflict outranks confidence, `relevanceMethod:"lexical"`
reports the embedding layer, and an empty payload reports "Reason not recorded".

**May NOT do:** invent a reason, or keep "clarify policy" as a catch-all.

## 2. BI-F5F2869D — domainClass was a gate, not a prior

`isMaterialApplicable` was exact equality on `domainClass`, and the material
query narrowed the same way. Relevance ranks only what survives that filter.

DI-3A99C3561FA0's six sources exclude `stances/ruling-di-5bc09b3e5683` — the
owner's own ruling on MSP partnering — plus the markets and go-to-market
stances, all filed under `plan-readiness` while the question arrived as
`risk-assessment`. The decision escalated with its answer in the corpus.

This breaks the "remember this" loop: rulings are filed under the domainClass of
the interaction answered, and `evaluate_org_business_decision` takes domainClass
as a caller argument, so the same question asked twice cannot retrieve its own
ruling.

Approach scored through `principle_decide` rather than chosen unilaterally:
`additive-domain-tags` won at margin 3.079, high confidence, no commandment
conflict. It is also the direction the 2026-07-11 stance-onboarding design named
at §a3 and never implemented.

Matching is additive over the dormant `domains[]` field; the Prisma query
mirrors the predicate exactly; `promoteStanceMaterial` tags new `ruled` material
cross-domain; a narrow idempotent migration backfills existing rulings.

**May NOT do:** lower `minimumConfidenceForRecommendation` (that would paper
over a retrieval defect with a policy change), widen lower-tier material, or let
an untagged material leak into an unrelated domain.

## 3. BI-932C2A81 — clustering was exact-lexical

`review-identity.ts` collapsed only byte-identical questions, so paraphrases
each took a card and answering one left its siblings open.

`clusterDecisionReviewRowsSemantic` raises the bar rather than abandoning it: a
high cosine floor (0.92), no clustering across `profileId`, clustering across
`domainClass` (or it would undo §2), and degradation to exact-lexical identity
when embeddings are unavailable. The capture action re-derives clusters
server-side from the same function, never from the client, so what a card
promises to close is what closes. The card discloses the other wordings it will
resolve.

**May NOT do:** take cluster membership from the client, delete or merge
`DecisionInteraction` rows (they stay as audit history), or widen what one
answer resolves during an embedding outage.

## Verification

- 515 tests green across `lib/decision`, `lib/decision-perspective`,
  `lib/founder-review`, `lib/actions`, and the review route.
- Pre-commit guards: secret scan, private-identity scan, migration safety,
  scoped typecheck.
- Outstanding: functional verification on the live install requires the
  migration applied and the portal image rebuilt. Until then §2 is proven by
  unit test only, and the live queue would still escalate the MSP question.

## Out of scope

BI-ED117C82 (boot re-embed self-heal and an in-product repair path for a
partially embedded corpus) is filed and not addressed here. It matters more
after §2 and §3, because both degrade to lexical when embeddings are missing.
