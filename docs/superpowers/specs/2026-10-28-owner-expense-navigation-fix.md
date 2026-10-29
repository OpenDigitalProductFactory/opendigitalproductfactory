---
status: active
---

# Owner expense navigation repair

BI-46F5486E; WC-579E6A08; DOC-82684072.

## Reproduction

At base 4c290ad54d46c650f1fc954d175cb478dbab761d, Finance Spend promises personal expenses but links to the claims-review list. Served owner navigation directly to My Expenses showed its empty state; clicking New Expense Claim opened the existing form. No expense was submitted.

## Atomic ordered repair

1. Reuse My Expenses for personal entry and retain a distinct review route.
2. Explain title, line date, category, description and positive amount; receipt URL and notes are optional in the existing form. Explain draft versus approval submission. Expose missing employee-profile prerequisites without creating identities or widening access.
3. Preserve existing claimant and manager authorization actions. Verify navigation, empty states, missing-profile and denied access, authorized fixture save/readback, desktop and narrow layouts.
4. Obtain UX critique CE-EB8821DD, run affected tests, package typecheck and governed delivery checks, then protected DCO PR and canonical deployment before served acceptance.

## Boundaries

No new ledger, schema, recovery engine or production financial fixtures. Finance coworker recovery stays with BI-D0D2FF0D and the earlier repair queue; its Finance acceptance scenario was appended there. Performance and Workrooms remain separately governed by their existing BIs. All delivery and saved-result checks remain unrun.
