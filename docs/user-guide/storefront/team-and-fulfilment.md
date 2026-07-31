---
title: "Team And Fulfilment"
area: storefront
order: 6
---

## Use This Doc For

- `/storefront/team`
- `/storefront/tables`
- `/admin/storefront/team`

## Workflow

1. Review who delivers, supports, or owns the storefront work.
2. Make staffing or assignment changes with the customer journey in mind.
3. Re-check booking, enquiry, or fulfilment flows after team updates.

## Staff vs Tables & Capacity

For a Restaurant (and other capacity businesses), the **Team** page lists only
people — your staff. Physical tables are a separate scarce resource, so they get
their own **Tables & Capacity** page (`/storefront/tables`):

- **Team** — the people who work here. Add, edit, or deactivate staff.
- **Tables & Capacity** — your tables and their live state (available, occupied,
  turning soon, blocked), how many parties are waiting, and one clear next
  action for the next service period. Add, edit, schedule, or block tables here,
  not under Team.

Use **Add table** to record its owner-facing label, seats, and service area.
Open an existing table to change its status, capacity, area, or internal blocked
reason. The readiness answer and floor/list state refresh after a successful
save, so the host does not need to reload the page while a guest is waiting.

The availability editor supports recurring weekday hours and dated available or
blocked windows. Public booking consumes these rules, active holds, and existing
bookings through the same capacity service. Cancelling a booking or letting a
hold expire releases its allocation rather than leaving the table unavailable.

Under "Tables right now" you can switch between two views of the same live
capacity:

- **Floor plan** (the default) — a graphical layout of your tables, each shaped
  by its seats and coloured by its state, so you can see at a glance which tables
  are open and which are turning soon (with the minutes until they free up).
  Tables cluster into sections (window, bar, booths, patio) inferred from their
  names, so the plan is legible without any extra setup. Pan and zoom to explore.
- **List** — the same tables as a scannable list.

Tables are never shown as "providers" and never mixed into the Staff list.
Blocked reasons and internal allocation references stay in the owner workspace;
the customer booking experience receives only a safe availability explanation.

## What To Watch

- visible storefront promises with no matching fulfilment owner
- scheduling or delivery changes that are not reflected in team setup
- internal team edits made without downstream customer impact review
- a Restaurant's tables appearing under Staff, or capacity that does not match
  the Workspace readiness answer or public booking availability
