# Plan — Lead capture + triage on the Engagement substrate (BI-7906DAC0)

Date: 2026-07-06. Epic: EP-B51FA3BC. Build-order slice 3 of the parity gap matrix.

## Substrate finding (dpf-verify-substrate-first)

The platform already HAS a lead model: `Engagement` carries the full lead lifecycle
(`new → contacted → qualified/unqualified → converted`, `convertedToId`), and
`qualifyEngagement` IS Salesforce lead-convert (creates the opportunity, links
contact+account, stamps converted). No new model. What was missing:

1. A **manual capture door** — engagements only arrived from storefront signals; leads that
   arrive as "Dan Warfield at Managing Digital, dan@…" had nowhere to land.
2. **Triage controls** — the Engagements tab listed rows read-only; no contacted /
   disqualify / qualify actions.

## Design

- `createLead` action (`apps/web/lib/actions/leads.ts`): one call lands the trio —
  account (exact-name reuse → dedup-gate likely-duplicate reuse → create prospect),
  contact (email identity: reuse or create), engagement (status new, source manual).
  Lead capture must never mint duplicate accounts, hence the reuse ladder.
- `updateEngagementStatus`: the two triage transitions (contacted / unqualified).
- `NewLeadButton` (Engagements header): first/last/email/company/note dialog.
- `EngagementTriageActions` (each row): Mark contacted · Qualify → opportunity (existing
  `qualifyEngagement`) · Disqualify; only valid transitions render; qualify disabled until
  an account is linked.

## Verification

leads.test.ts: trio creation, exact-name reuse, likely-duplicate reuse, contact-identity
reuse, validation, triage transition. Live check post-deploy: capture a test lead, walk
new → contacted → qualified and see the opportunity appear on the pipeline.
