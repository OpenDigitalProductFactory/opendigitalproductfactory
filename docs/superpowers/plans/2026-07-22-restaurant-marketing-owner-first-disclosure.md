# Restaurant marketing: owner-first progressive disclosure + funnel de-dup

- **BIs:** BI-8AB9C904 (owner-first progressive disclosure before publish actions),
  BI-CC580161 (Restaurant marketing shows software-platform campaign artifacts).
- **Epic:** EP-UX-COGLOAD (Live UX cognitive-load audit follow-up).
- **Date:** 2026-07-22.

## Design grounding

**Source of truth:** the merged archetype-scoping engine for `/customer/marketing`
(PR #3406, `apps/web/lib/marketing/archetype-fit.ts`, `next-decision.ts`,
`draft-builder.ts`, `subroutes.ts`, and `docs/platform-usability-standards.md`).
BI-CC580161's core — no software-platform artifacts as active work, food/hospitality
vocabulary, archetype-fit warning/block before Approve/Send/Publish, and the
first-viewport owner decision — already landed on `main` via #3406. This change
**extends** that substrate rather than creating a new contract; the older competing
PR #3404 is redundant and should be closed.

What #3406 did **not** deliver, and this change adds (BI-8AB9C904):

1. **Progressive disclosure.** The overview still rendered the full dense stack
   (strategy focus, latest recommendation, clarification prompts, proof,
   `MarketingStrategyOverview`, `ApprovalQueuePanel`) immediately after the decision
   card — ~1,200 words and 49 actions before the owner chooses a job.
2. **Deferred publish/review.** Empty publish/review queues were shown to a
   brand-new owner. They are now deferred until there is archetype-fit work.
3. **One owner-first question.** The first viewport now leads with a single
   archetype-flavoured question ("What booking demand do you want to improve —
   fill slow nights, private dining, catering, seasonal menus?").
4. **Funnel de-dup.** Two adjacent nav layers both read "Funnel".

## Changes

- **`apps/web/lib/marketing/disclosure.ts` (new, pure/testable):**
  - `buildMarketingDisclosure(snapshot)` → `{ hasArchetypeFitCampaign,
    reviewableCount, showPublishReview, publishReviewOpenByDefault, quarantinedCount }`.
    A campaign counts as fit only when `assessArchetypeFit(...).severity === "ok"`;
    platform-leak / off-archetype briefs and drafts are counted as quarantined and
    never unlock the queues. Publish/review is deferred until there is a fit campaign
    or real review work (drafts / inbound).
  - `buildMarketingOwnerQuestion(category, playbook)` / `marketingOwnerJobs(...)` →
    the owner-first question, grounded in the archetype playbook. Food/hospitality
    gets the BI-CC580161 acceptance vocabulary; other archetypes derive jobs from
    their playbook's campaign types.
- **`apps/web/app/(shell)/customer/marketing/page.tsx`:** first viewport = owner
  question + one recommended next step + primary launcher. Strategy/assumptions/proof
  moved behind a collapsed `<details data-testid="marketing-advanced-strategy">`.
  Publish/review rendered only when `showPublishReview`, inside a `<details>` that is
  open when drafts are waiting; otherwise a `marketing-publish-deferred` placeholder.
  A `marketing-quarantine-banner` surfaces when off-archetype/imported-test artifacts
  are present, marking them unusable until reset/replaced.
- **Funnel de-dup:** `portal-navigation-model.ts` customer-funnel gains
  `sectionNavLabel: "Sales Funnel"` (CRM deal-stage funnel); the Marketing subnav's
  `Funnel` becomes `Marketing Funnel` (`marketing-nav.ts`).

## Tests

- `apps/web/lib/marketing/disclosure.test.ts` — quarantine of off-archetype
  artifacts, deferral of publish/review until fit work exists, open-by-default when
  drafts wait, and the food/hospitality owner question.
- `apps/web/app/(shell)/customer/marketing/page.test.tsx` — Restaurant snapshot opens
  with one owner-first question, defers strategy behind disclosure, quarantines
  off-archetype artifacts, shows no software-founder copy in the always-visible shell,
  and reveals the review/publish queue only when archetype-fit work exists.
- `apps/web/lib/govern/permissions.test.ts` — updated for the "Sales Funnel" label.

## Verification

- `disclosure.test.ts` 6/6, `page.test.tsx` 4/4, nav/permissions/nav-model 48/48 pass
  via the junctioned worktree (`DPF_SKIP_TYPECHECK=1`). The DB-backed marketing tests
  (`subroutes`, `campaigns`, `archetype-scoping`, …) are blocked in the worktree by the
  ungenerated Prisma client (unchanged by this PR) and run in CI.

## Out of scope / follow-ups

- `next-decision.ts` counts all campaign briefs (fit or not) for the "has a campaign"
  branch; the disclosure layer is fit-aware and compensates. A future pass could make
  the decision itself fit-aware.
