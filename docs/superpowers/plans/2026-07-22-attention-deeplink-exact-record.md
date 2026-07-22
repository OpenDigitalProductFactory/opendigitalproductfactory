# BI-1336126B — Attention approval cards deep-link to the exact record

Part of **EP-UX-COGLOAD** (live cognitive-load audit follow-up). Focused,
one-concern change; the epic's other first-slice items ship separately
(#3377 mobile overflow, #3378 Simple mode, #3380 login redirect).

## Design grounding

- **Source of truth reviewed** — `apps/web/lib/attention/sources/business-approvals.ts`
  (the approval AttentionItem producers), `apps/web/lib/attention/owner-decision.ts`
  (`ownerChoices` / `isOwnerSafeHref` — the card action projector), and the
  id-keyed detail routes `app/(shell)/finance/bills/[id]`,
  `finance/expense-claims/[id]`, `compliance/submissions/[id]` (each resolves by
  internal `id` via `getBill` / `getExpenseClaim` / `getSubmission`, matching the
  list-row links).
- **Decision** — extend the existing attention producers; no new contract.

## Problem (live evidence)

On the running install the `/workspace` cockpit card action **Review bill**
linked to `/finance/bills` — the generic list — with a real `BILL-2026-0001`
awaiting approval. The owner, asked to review that specific bill, had to re-find
it in the list. The expense and regulatory approval cards had the same list-level
links.

## Change

Deep-link the three approval sources that have an id-keyed detail route to the
exact record:

- bill → `/finance/bills/{id}`
- expense claim → `/finance/expense-claims/{id}`
- regulatory submission → `/compliance/submissions/{id}`

The producers now select the internal `id` and build the href from it (both the
card `action.href` and `deepLink`). All three routes start with `/finance` or
`/compliance`, so `isOwnerSafeHref` still admits them. Sources without an
owner-safe detail route (outbound draft → `/customer/marketing`, research
proposal → `/admin/research`) keep their section route.

## Follow-up noted

The bill **detail** page has no approve/reject control for `awaiting_approval`
status; the working approval surface is the external `/s/approve/[token]` page,
and the in-portal `/finance/ap/approvals/[token]` link built by
`submitBillForApproval` is a dead route. Deep-linking to the detail preserves the
decision context now; an in-portal approve action for `awaiting_approval` bills is
a separate finance-UX gap (candidate BI).

## Verification

Unit: `apps/web/lib/attention/sources/business-approvals.test.ts` asserts each
card deep-links to `/{route}/{id}` and never the bare list. Typecheck of the
changed producer confirmed clean via a direct `tsc --noEmit` against the root
install (the shared local-CI sandbox is drift-blocked — BI-7FEEBA8E — so the full
prod-build/unit gate runs on CI).
