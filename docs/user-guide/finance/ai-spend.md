---
title: "AI Spend"
area: finance
order: 8
---

## Purpose

The AI Spend workspace brings AI providers into Finance as supplier
commitments. Use `/finance/spend/ai` to see which active providers are linked
to suppliers, which commercial details are still drafts, what monthly
commitment is recorded, how included allowances are being used, and which
finance work items remain open.

Provider authentication and technical health still belong in the AI Workforce
provider pages. A healthy provider connection does not prove that its contract,
allowance, invoice, or payment record is complete.

## How The Finance Bridge Starts

After a provider is configured, the platform can seed a finance bridge:

1. find or create an active supplier for the provider
2. create or update the provider's finance profile as **seeded**
3. reuse a compatible draft or active supplier contract when possible, or
   create a monthly **draft** contract
4. open a finance work item for missing plan, commitment, allowance, or billing
   details

This makes the commercial gap explicit without inventing values. Draft
contracts are counted as needing setup; active contracts contribute to the
managed commitment view.

## Activate A Contract

Before activation, confirm the plan name, committed amount, currency, billing
cadence, contract dates, renewal date, billing source, and at least one
allowance. Activation changes the contract to **active**, replaces its
allowance rows with the reviewed values, and resolves matching setup work
items. It does not purchase a plan, change provider credentials, or verify an
external invoice.

Use the supplier detail and provider Finance Bridge together when several
providers share a commercial contract. The overview merges provider-specific
and shared supplier contracts so finance ownership is visible without
duplicating the commitment.

## Record A Subscription Payment

The subscription-payment action records a commercial event that has already
occurred. It finds or creates the supplier and active finance profile, creates
or updates an active contract, records a paid bill for that billing cycle,
creates a completed outbound payment and allocation when one does not already
exist, advances the next billing date, and closes related setup work items.

The operation is designed to reuse an existing bill/payment for the same
supplier, contract, and billing period. Even so, confirm the external charge,
amount, date, payment method, and reference first. Recording it in DPF does not
charge the card or initiate a bank transfer.

## What Subscriptions Really Cost

A subscription is not free. Its monthly fee buys the work the plan can do
before its usage limits reset. Open **Subscription costs** at the top of
`/finance/spend/ai` to see each plan's recorded fee divided by the capacity it
actually delivers:

- **Fee:** the active subscription contract recorded by **Record A
  Subscription Payment**. A quarterly or annual payment is spread per month.
  One fee covers every provider the plan lists, so their use is pooled.
- **Capacity:** the last 30 days of use, cut into the plan's reset windows
  (5 hours for the Claude and ChatGPT/Codex plans). A window in which the
  plan hit its limit shows what one window holds. Long lockouts lower that
  figure, so a plan that resets generously costs less per unit than one that
  locks you out for days.
- **Result:** about $X per million tokens, with a likely range and a
  confidence. Confidence is high after 5 or more limited windows over 14 or
  more days. If the plan never hit its limit, the figure is the most it
  costs, and the real figure is probably lower.

Each subscription call is recorded at this estimate, not $0, so budgets see
it. The daily allowance for paid AI governs money spent per call, so it
neither counts nor refuses subscription use (decision DI-223FEAA53080). A plan
with no recorded fee is still counted at $0, and the section names it so its
payment can be recorded.

## Allowance Evaluation

Daily evaluation reviews active contracts and their included allowance. It can
open work items when allowance details are missing, when use is low for a
time-limited commitment, or when remaining allowance is critically low. These
are decision signals, not commands to increase usage or spend. Review provider
telemetry, business need, and contract terms before acting.

## Recovery And Evidence

Do not activate a contract with placeholder commercial values merely to remove
a setup warning. Correct the contract record with the source agreement and
preserve why it changed. A recorded paid bill and payment have reporting
consequences and no general undo, so investigate duplicates before creating
another cycle record.

Keep the provider invoice or receipt, contract and allowance terms, billing
portal link, payment reference, usage snapshot source, evaluator flags, and the
decision taken on each finance work item.

## Related Routes

- `/platform/ai/providers/[providerId]` — provider setup and Finance Bridge
- `/finance/spend` — supplier, bill, expense, and AI-spend hub
- `/finance/suppliers/[id]` — supplier detail and linked AI contracts
- `/finance/bills` and `/finance/payments` — recorded subscription settlement

## Related Help

- [Accounts payable](accounts-payable.md)
- [Banking and reconciliation](banking-and-reconciliation.md)
- [Reporting and close](reporting-and-close.md)
