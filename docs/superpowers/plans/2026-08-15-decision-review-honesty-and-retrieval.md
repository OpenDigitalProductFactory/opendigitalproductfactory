---
title: Decision review honesty and doctrine retrieval — implementation plan
authoredAt: 2026-08-15
authoredBy: operator
epic: EP-0AF96937
---

# Decision review honesty and doctrine retrieval

Four defects found while draining a live operator review queue on 2026-08-15.
They present as one symptom — "the AI keeps asking me things it should already
know, and asking twice" — but have separate causes, so they are separate BIs on
one branch.

## Backlog coverage

- Decision: decomposed
- Parent: BI-F5F2869D
- Dependencies: BI-932C2A81 depends on BI-F5F2869D landing first — clustering must not re-impose the domain split that fix removes. BI-ED117C82 underwrites both: each degrades to lexical when a page is unembedded.
- Rationale: one branch because all three touch the same retrieval/presentation path and share the relevance primitive; splitting them would force three rebases over the same files.
- Mappings:
  - honest-unresolved-reason -> BI-38658E6B
  - domain-as-prior -> BI-F5F2869D
  - semantic-review-clustering -> BI-932C2A81
  - embedding-coverage-self-heal -> BI-ED117C82

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

## 4. BI-ED117C82 — a self-heal that was never wired

`reconcilePublishedWikiEmbeddings` has carried a comment since BI-D4C1E05E
saying it is "the fleet self-heal wired into portal boot". It was not wired to
anything: the only callers were `scripts/reembed-wiki-store.ts` and its tests.
Live on 2026-08-15, a published org stance carried no vector (16 of 17 embedded)
on a portal booted long after the page was authored.

Two fixes:

- **Honesty.** With the provider down every page fails for one reason, and the
  run returned `embedded:0, failed:[]` — indistinguishable from a healthy corpus
  needing nothing. It now detects the outage up front and reports
  `providerUnavailable`, listing the pages it could not reach.
- **Wiring.** `reconcileWikiEmbeddingsOnBoot` runs deferred and non-blocking on
  the nodejs runtime, scans the full corpus rather than a bounded slice, and
  logs coverage as a NUMBER. It never throws out of the boot hook.

This underwrites §2 and §3: an unembedded stance degrades relevance to lexical,
and the BI-7E1F128A fail-safe then escalates by design, so a silent embedding
gap reaches the operator as "the AI keeps asking me things it should know".

**May NOT do:** block boot, loop/retry inside the hook (retry belongs to the
next boot or the maintainer script), or log a clean pass it did not achieve.

## 5. BI-F5F2869D part two — the escalation carried no signal (re-scope)

Shipping §2 fixed retrieval and changed nothing the operator sees: verified live
on DEPLOYED_SHA 94def5a4b, DI-7533BB032BA1 recorded SEVEN sources including the
owner's own MSP ruling and still escalated at 0.50.

Re-scoped on operator intent: the goal is NOT more autonomous approvals.
Reviewing non-aligned propositions is desirable — it is where new ideas surface,
and approving whatever matches recorded doctrine would make the business only
ever do what it already does. The defect is that a NOVEL proposition and an
ALREADY-RULED question both produce an identical `escalate` at 0.50.

Cause: `evaluator.ts` normalises relevance across every material the resolver
returned, but only the applicable subset is scored, so the material holding
relevance 1.0 can sit outside the scored set. Confirmed arithmetically —
`bestDirectionalWeight` 0.60 with `overridePenalty` 0 and all seven applicable
materials `support`, so no neutral bystander took the maximum.

Three changes: re-normalise within the scored set; add `settledByRuling` to
separate aligned from settled (a `ruled` stance dominating the relevant
material); and spend the recovered headroom on legibility — approval acts only
when settled, otherwise it escalates as `aligned-not-settled`, rendered as
"New proposition" rather than a doctrine gap.

`directional-outcome.ts` is a pure extraction: `evaluator.ts` crossed the
800-LOC ceiling, so the WWWD verdict ladder was lifted whole. Behaviour is
unchanged and the existing suite proves it.

**May NOT do:** lower `minimumConfidenceForRecommendation`, approve on alignment
alone, touch the decline path, or stretch an explicit zero-relevance set to 1
(that turns a coverage `defer` into a confident verdict — caught by test).

## Verification

- Tests green across `lib/decision`, `lib/decision-perspective`,
  `lib/founder-review`, `lib/actions`, `lib/wiki`, and the review route. The
  embedding-unavailable fallback is exercised by the suite, not assumed.
- Pre-commit guards: secret scan, private-identity scan, migration safety,
  scoped typecheck, derived-artifact regeneration.
- Outstanding: functional verification on the live install requires the
  migration applied and the portal image rebuilt. Until then §2 is proven by
  unit test only, and the live queue would still escalate the MSP question.

## Still open

The BI also asks for an in-product repair path — an admin action or MCP tool for
a partially embedded corpus — because `dpf-portal-1` ships neither the
maintainer script nor `tsx`, and `dpf-postgres-1` exposes no host port, so
today the documented repair cannot be run from inside or outside the container.
The boot hook narrows the window but does not close that gap; it remains on
BI-ED117C82.
