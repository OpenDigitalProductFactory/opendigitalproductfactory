# Plan — Coworker auto-activity capture (BI-5618BADF)

Date: 2026-07-06. Epic: EP-B51FA3BC. Build-order slice 6 — "the CRM records itself",
the #1 loved-CRM mechanic from the parity research.

## Substrate audit (dpf-verify-substrate-first)

Auto-capture is ALREADY nearly complete by construction: coworker tools call the same
server actions as the UI, and `crm.ts` logs system activities on every mutation —
account create, site/CI create+update, engagement create/qualify, opportunity
create/stage-change, quote create/revise/send/accept (+ order + closed-won), and
`subscriptions.ts` logs conversion + contract creation. So coworker-driven work already
lands on account timelines.

The audit found ONE hole: **contact creation** (`createCustomerContact`, added in #2629)
wrote no timeline activity — a coworker could add a contact invisibly.

## Design

- `createCustomerContact` now writes a `note` Activity ("Contact added: <name> (<email>)")
  linked to both the account and the contact — same fail-open pattern as the other writes.
- Lead capture (`createLead`, in-flight #2640) creates the Engagement itself, which is the
  visible record on the Engagements tab; a timeline echo can join later if wanted.

## Verification

customer-contacts test asserts the captured activity (subject/account/contact linkage).
