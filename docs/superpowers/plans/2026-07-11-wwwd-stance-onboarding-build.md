# WWWD Company-Stance Onboarding — build plan

- **Spec:** [2026-07-11-wwwd-stance-onboarding-design.md](../specs/2026-07-11-wwwd-stance-onboarding-design.md) (merged; founder go received 2026-07-11 — "deliver on this here locally")
- **Epic:** EP-0AF96937 · Related tactical BI: BI-EBBBD275
- **Invariants every phase preserves** (simulation-backed, `stance-onboarding.simulation.test.ts`):
  unconfirmed material clears nothing; high/critical risk always escalates; confirmation upgrades
  whole class bundles (never mixed tiers in a class from our own writes); re-seeding never
  downgrades an owner-confirmed or human-ruled material.

## Phase 1 — Archetype stance-vector defaults + seeder redistribution (BI-70ADC71F) ✅ shipped (PR #2800)

- `archetype-business-context.ts`: `STANCE_VECTOR_KEYS`, `StanceVectorDefault` (+ per-industry
  overrides with authority ceilings), `resolveStanceVectors` (pure; primary archetype only).
- `seed-org-wwwd-corpus.ts`: `STANCE_VECTOR_BUNDLES` (vector → class bundle; first class = primary,
  legacy `{profileId}:{slug}` materialId so existing installs retag instead of duplicating),
  5 vector pages under `stances/<key>` (published + embedded), per-class materials at B/0.6,
  `org-supply-chain` retagged to `architecture-tradeoff`, `org-how-we-decide` echoed into
  `professional-practice`. Update clause refreshes retag fields but never grade/weight/review.
- Result: fresh org = 9 pages / 12 materials over all 4 classes (plan-readiness 4,
  risk-assessment 3, professional-practice 3, architecture-tradeoff 2).

## Phase 2 — Stance capture & promotion loop (BI-9677364B + BI-002DEB85) ✅ shipped (PR #2812)

- `lib/decision-perspective/stance-promotion.ts`: `promoteStanceMaterial` — the ONE write path that
  makes a stance gate-live; tiers `confirmed` A/0.9 and `ruled` A/1.0; never downgrades.
- `lib/actions/org-decision-capture.ts`: non-build capture for `/coworker-business` decisions —
  EscalationCapture/DeferralCapture + `humanOutcome`, optional "standing answer" that writes a
  published `stances/ruling-*` page (embedded) + `ruled` material in the decision's domainClass.
- `lib/actions/business-stance.ts`: `publishBusinessStance` — publish the draft page, embed it,
  promote `confirmed` material in the owner-picked decision area (plain-language → domainClass map
  in `lib/wiki/business-stance.ts`).
- `/wiki/review`: "Waiting on your call" section listing unresolved org-business decisions with the
  inline answer + make-standing control; stance form gains the decision-area picker + Publish.

## Phase 3 — "How you decide" setup step (BI-D6DC2432) ✅ this PR

- `SETUP_STEPS` entry `how-you-decide` after `business-context`; 5 archetype-prefilled scenario
  cards (resolveStanceVectors), Confirm-all fast path; confirm upgrades the vector's bundle via
  `promoteStanceMaterial(confirmed)`; skip leaves B/0.6. Same card components mounted in
  `/wiki/stance`. UX-Fit-Decision trailer on the PR.

## Phase 4 — Local delivery & live verification

- Merge PRs → redeploy the local live portal from clean main.
- Re-run `seedOrgWwwdCorpus` for the existing org (idempotent; new vector pages + retags land).
- Author BI-EBBBD275's two founder-ruled stances through the capture path (A/1.0, embedded).
- Re-run `evaluate_org_business_decision` live on the billing-goodwill and quality-vs-offering
  questions; expected: resolve (recommend/arbitrate per posture) instead of defer/escalate; verify
  a high-risk probe still escalates.
