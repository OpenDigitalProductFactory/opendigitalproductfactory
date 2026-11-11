---
status: active
Backlog: BI-01C83BCF
Profile: fix
---

# Finance follow-up expense guidance

## Reproduction and diagnosis

The retained real-provider Finance answer in TR-CHAT-1125d7b10a0bf85180084c610ca2cd1b
did not know the native expense workflow and invented mandatory-looking information.
The request and answer survived reload; useful-answer acceptance failed.
The current Finance context provider contains tax, recurring and invoice data,
but no native expense-entry guidance, including its no-tax-profile early return.

## Existing design and bounded repair

Extend the page-owned context provider, reusing the native expense form's
`shell.finance.expenseEntryDetails` and `expenseProfileRequired` catalog entries,
`getLocaleContext`, and `/finance/my-expenses/new`. The existing owner expense
navigation and Finance contextual-opening specs remain accurate: this is the
distinct generative follow-up gap. No new workflow, schema, provider or tool.

1. Reproduce missing native guidance through `getRouteDataContext` with and
   without a tax profile. Include a resolved pseudo-locale control. The source
   graph is ready but has no linked tests for this provider; bounded source search
   found the route-context suites and existing opening-briefing controls.
2. Supply shared-catalog expense guidance before the tax-profile branch, labelled
   as static workflow knowledge. State the profile prerequisite without claiming
   the current person's profile was checked. Retain financial reads, tax guidance,
   live-data authority, claim/approval actions and deterministic opening behavior.
3. Run affected route-context and opening-briefing tests, both typechecks,
   architecture/style and derived-artifact checks; independently review the frozen
   signed change and pass canonical merged-code verification before a regular PR.
   Coordinate one ordinary canonical release with the existing release owner.

## Business acceptance and boundaries

After canonical deployment, exercise a permitted guidance-only native Finance
request and verify its useful saved answer once after reload. It must name the
native route and actual required/optional information, distinguish draft from
approval, and avoid fabricated live balances. Do not create or submit an expense,
journal, payment, setting, contact or employee-profile fixture in production.
Source tests and a merged PR do not satisfy this served acceptance.

Normal Small implementation admission IRD-73E7584D8E0A and fresh own path claims
cover this clean worktree on b0b4d583c3b44e652655c1c932ad2e7c12e4fd7e.
The former native build is abandoned; no restart or competing source writer was
created.

## Observed source verification

Three regressions failed before correction because the native route was missing;
twelve existing controls passed. The corrected six-suite run passes102tests,
including route inheritance, registry and deterministic briefing controls.
Production/test typechecks, application boundaries, style and whitespace checks
pass. The existing documentation index is fresh without a generated-file change.
Independent review, canonical integration, protected publication, deployment and
served useful-answer acceptance remain pending.
