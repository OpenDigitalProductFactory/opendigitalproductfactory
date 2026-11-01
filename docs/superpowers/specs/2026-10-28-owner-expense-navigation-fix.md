---
status: active
---

# Owner expense navigation repair

BI-46F5486E; WC-579E6A08; DOC-82684072.

## Reproduction

At base 4c290ad54d46c650f1fc954d175cb478dbab761d, Finance Spend promises personal expenses but links to the claims-review list. Served owner navigation directly to My Expenses showed its empty state; clicking New Expense Claim opened the existing form. No expense was submitted.

## Atomic ordered repair

1. Reuse My Expenses for personal entry and retain a distinct review route.
   Keep the card metric personal too: count submitted claims through the authenticated user's employee relation (unique userId), with an explicit My submitted claims label. A missing profile produces zero personal claims, regardless of colleagues' submissions. Independent client review of58e78d9b found the previous organization-wide metric mismatched the new destination; focused scope/auth regressions failed before this correction.
2. Explain title, line date, category, description and positive amount; receipt URL and notes are optional in the existing form. Explain draft versus approval submission. Expose missing employee-profile prerequisites without creating identities or widening access.
   Keep preparation detail collapsed by default. A source-render guard for the linked-profile entry header reproduced 18 visible words against its existing14-word budget; shorten the optional-receipt summary to preserve14 while retaining all required-field/submission help inside the native disclosure. Keep review-page header copy plus personal-entry link within the prior combined word count. This source-render check does not substitute for served route measurement. Hold PR auto-merge until the corrected head has fresh evidence.
3. Preserve existing claimant and manager authorization actions. Verify navigation, empty states, missing-profile and denied access, authorized fixture save/readback, desktop and narrow layouts.
4. Obtain UX critique CE-EB8821DD, run affected tests, package typecheck and governed delivery checks, then protected DCO PR and canonical deployment before served acceptance.
   Served CI run41005523559 on source1c1dd2ba measured216routes and reported only deliberate accessibility-structure drift for the review-page paragraph/link and entry-page native preparation disclosure. Words122/125 remain below existing127/137 limits; actions, fields, choices and axe counts did not regress. Following the checked-in `.github/workflows/ux-route-sweep.yml` manual `update_baseline` engineering path, native workflow41007056379 on the same immutable source emitted artifact12956526203. Copy only those two ariaSnapshot fields into the existing204-route baseline; preserve all numerical/axe limits and the other202entries, and do not add the artifact's12unrelated new routes. Independently review the exact committed diff before publication. Measurement emission is not an enforcing UX pass or live-owner acceptance; pre-existing advisories remain visible. Use the existing published-correction procedure for affected checks and protected GitHub integration, never relabel the earlier source's PASS as certifying this changed tree.

## Boundaries

No new ledger, schema, recovery engine or production financial fixtures. Finance coworker recovery stays with BI-D0D2FF0D and the earlier repair queue; its Finance acceptance scenario was appended there. Performance and Workrooms remain separately governed by their existing BIs. All delivery and saved-result checks remain unrun.
