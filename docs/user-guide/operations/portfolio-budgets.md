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

## Setting a budget

Choose **Set budget** on a portfolio's row. The proposed figure is the points that
portfolio delivered last quarter. Accept it or change it, and say why. The reason
and your name are recorded with the budget. A change adds a new version and keeps
the old one; nothing is overwritten.

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
