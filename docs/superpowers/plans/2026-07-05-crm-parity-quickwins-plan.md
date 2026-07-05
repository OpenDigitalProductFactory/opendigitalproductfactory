# Plan — CRM parity quick wins: draft-quote UI, new-opportunity UI, structured contacts

Date: 2026-07-05. Epic: EP-B51FA3BC (Sales/CRM market parity). BIs: BI-7FF2064C, BI-024FF1C2, BI-D873CD28.

## Why

The E2E engagement demo (Emma3D/Ian, Managing Digital/Dan — PRs #2596/#2609) left three
concrete gaps, all confirmed by market research (Salesforce fidelity reference + loved-CRM
sweep): quote creation and opportunity creation are coworker-only doors (no deterministic UI),
and contacts have NO create door at all — real people end up as free-text in account notes,
even though CustomerContact is a full model with the MDM dedup gate already supporting a
`customer-contact` domain.

## Scope (one PR, three slices)

1. **BI-D873CD28 — structured contacts**
   - `apps/web/lib/actions/customer-contacts.ts`: `createCustomerContact` — email-unique
     identity, MDM dedup-gated (checkCustomerContactDuplicates), `use-existing`/`confirm-new`
     resolutions, source="manual".
   - `apps/web/lib/mcp/packs/crm-contacts-pack.ts`: `create_customer_contact` coworker tool
     (grant `crm_write`) so the CSM can capture a contact conversationally.
   - `AddContactButton` on the account detail page (dialog + duplicate picker, mirroring
     NewCustomerButton).
2. **BI-7FF2064C — Draft quote button** on the opportunity detail page: dialog (line-item
   description/qty/unit price defaulted from the opportunity, valid-until default +30d)
   calling the existing `createQuote`.
3. **BI-024FF1C2 — + New Opportunity button** on the Pipeline tab: dialog (account select,
   title, expected value/currency) calling the existing `createOpportunity`.

## Non-goals

Leads (BI-7906DAC0), recurring billing (BI-8681E93C), quote external delivery (BI-8E45CCA3),
and the research-driven delight slices (activity auto-capture, deal rotting, next-step loop)
— all tracked separately under EP-B51FA3BC pending the research synthesis BI-00FBDC20.

## Verification

Unit tests per action/pack; existing page tests extended where rendering changes; deploy via
self-upgrade; then drive by clicks on the live portal against the two real customers.
