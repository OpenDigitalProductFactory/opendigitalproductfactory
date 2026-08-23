---
title: UX budget — primary purpose regions always count
date: 2026-08-23
status: active
owner: platform
backlogItem: BI-0147EB89
---

# UX budget — primary purpose regions always count

**Backlog:** `BI-0147EB89` · **Decisions:** `DI-B2D851A5AF86` (count), `DI-A5C301A8C39C` (packaging; operator chose one PR)

**For agentic workers:** execute this plan as one independently reviewable backlog item — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus this completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Hiding a page's purpose behind `<details>` no longer reduces `defaultVisibleWords`. `/workforce` shows the coworker roster on arrival, with copy a person would write.

## Backlog coverage

Atomic: one BI, one PR. The metric change and the `/workforce` restore are not independently shippable — shipping the page without the measurer lets the next agent re-hide it; shipping the measurer without the page leaves the owner one click from the roster. Operator ratified one PR (2026-08-23).

## What landed

1. **Measurer.** `data-dpf-purpose-key` regions (the keys already named in ratified page-purpose contracts as `defaultVisibleKeys`) stay in the measured scope when wrapped in collapsed disclosure. Secondary unmarked asides still excise. New axis `buriedPrimaryRegion` (0/1) plus a blocking `primary-region-reachable` check on cockpit and list shells.
2. **`/workforce`.** Unwrap `OwnerFirstDisclosure` around `RosterView`. Lead copy restored to two sentences. Search is the marked next action. Roster and filters carry `roster-list` / `roster-filters` purpose keys. `returnTo` is `/workforce` rather than the admin overview.
3. **Ratchet.** `buriedPrimaryRegion` is a max-polarity axis; a 0→1 hide of a marked purpose region fails a pre-existing route. Missing baseline field reads as 0.

## Not in this PR

- `/customer` is the other measured game (CRM grid behind "All CRM detail"). Same class, not this surface. Follow-up on `BI-0147EB89` or a child.
- `axeViolations: 2` is frozen on 149 of 200 routes — shared chrome, not a `/workforce` budget. Do not re-baseline it as acceptable.
- `BI-05DDEBC2` (prose-lint counting TypeScript generics) stays open.

## Verification

- `vitest run lib/ux-budget/ux-budget.test.ts lib/ux-budget/ratchet.test.ts` — wrapping a purpose-key roster in `<details>` does not drop the word count; burying it fails the cockpit check and the ratchet.
- Live `/workforce` after merge: coworker names visible on arrival; Find-a-coworker is the next action; one click opens an identity.

## Risks

The `/workforce` word count and ARIA snapshot will rise versus the gamed 121-word baseline. That is an honest freeze, not a re-baseline of the hide. The UX route sweep on this PR must record the unhidden page; do not lower the freeze back to 121.
