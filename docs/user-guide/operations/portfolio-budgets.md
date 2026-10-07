---
title: "Portfolio Budgets and Capacity"
area: operations
order: 3
---

## Use This Doc For

- `/ops/demand`, the **Budget and capacity** panel below the demand board

## Overview

Each portfolio gets a budget for the quarter, in investment points. A small item is
1 point, medium 3, large 8 and extra-large 20; an agreed estimate replaces the
size's default. The panel sets that budget against two things the platform
measures: the work each portfolio has committed, and how much it has actually
delivered over the last six weeks.

## Reading the panel

There is one row per portfolio, plus an **Unallocated** row for work that reaches
no portfolio.

- **Budget** shows the points set for this quarter, or "No budget set". A missing
  budget is never shown as zero.
- **Reserved** counts points held for items approved for funding that have not
  started. **In flight** counts work under way. **Delivered this quarter** counts
  work that reached done. Each item is counted once.
- **Capacity to quarter end** is a range: the portfolio's weekly delivered points
  (the 15th to the 85th percentile of the last six weeks), times the weeks left.
  It reads "estimated" until the install has four weeks of delivery history.
- **Commitment against capacity** states in words and numbers how far committed
  work exceeds that range, and how many weeks of work it is at the current pace.
- **Traced** is the share of delivered points that carry a Workroom or pull
  request. A low share means work is happening where the platform cannot see it,
  so the other figures are low by that much. The panel also counts merged changes
  that name no backlog item at all.
- **AI tokens, AI spend and AI run time** come from Build Studio's phase runs,
  beside the points and never converted into them. Use under a subscription reads
  "subscription: $0 recorded, N tokens", because a subscription records no cost
  per call. It does not mean the use was free.

## Which portfolio an item counts against

The panel, the budget proposal and admission all decide an item's portfolio the
same way, so a budget and the work that uses it always line up:

1. A portfolio the item names directly wins: its own portfolio, its digital
   product's, its taxonomy node's, its AI coworker's, or its epic's.
2. Otherwise, platform and common work counts as **Foundational**. The item is
   not changed; the rule is applied each time the figures are read.
3. Anything else stays **Unallocated** and is shown as such.

The budget proposal shows how much of each portfolio's delivery came from rule 2,
as `attributedByRule` with the basis `platform-default`.

## Setting a budget

Choose **Set budget** on a portfolio's row. The proposed figure is the points that
portfolio delivered last quarter. Accept it or change it, and say why. The reason
and your name are recorded with the budget. A change adds a new version and keeps
the old one; nothing is overwritten.

For a first quarter, when last quarter's delivery does not reflect how work is
spread now, ask your AI coworker to propose budgets from a recent stretch of
delivery instead, for example the last 90 days. It uses `propose_portfolio_budgets`
with `trailingDays`, which scales those days' delivered points to the length of the
quarter. The proposal comes with a suggested reason that marks the budget as
provisional and revisable. Nothing is set until a person accepts each figure, and
a later change replaces it while keeping the history.

## Choosing who answers for each portfolio

Open **Show the tie-out**: below the budgets, **Who answers for each portfolio** lists one accountable person per portfolio, or "Not set".
That person owns the portfolio's automatic work: the builds the platform starts on its own, the workrooms those
builds open, and the approvals they ask for.

- To choose or change the person, select **Change**, pick them, say why, and save. You need platform-management
  permission. Only a person with an active account can be chosen, never an AI coworker.
- While a portfolio has nobody, its work goes to the Foundational portfolio's person, then to the organization's
  top accountable person. The line above the list names who that is right now. If nobody is chosen anywhere, it
  names the install's first administrator: choose someone.

## Confirming an epic's portfolio

When an epic's portfolio has been proposed but no person has confirmed it, the
panel lists it. Confirm the high-confidence proposals together, or confirm them
one at a time.

## How budgets steer work

- Approving an item for funding reserves its points against its portfolio's
  budget. Going over the budget needs a person and a recorded reason; an
  autonomous approval is refused.
- A portfolio starts new work while its points in flight fit its allowance: two
  weeks of its measured delivery, never less than one large item (8 points).
- Admission starts in **shadow** mode. Every decision to admit, warn or refuse is
  recorded on the item and nothing is blocked. The operator switches to
  **enforce** with `set_backlog_delivery_budget` (`wipAdmissionMode`) once the
  recorded decisions look right.

The panel reports and steers. It never starts work itself.
