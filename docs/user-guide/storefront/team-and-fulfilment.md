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

Use **Add table** to record its owner-facing label, seats, service area, and
physical shape. For tables that can be joined, use one combination group and
select only real neighboring tables. Open an existing table to change its
status, capacity, area, shape, combination rules, or internal blocked reason.
The readiness answer and floor/list state refresh after a successful save.

The availability editor supports recurring weekday hours and dated available or
blocked windows. Public booking consumes these rules, active holds, and existing
bookings through the same capacity service. Cancelling a booking or letting a
hold expire releases its allocation rather than leaving the table unavailable.

Under "Tables right now" you can switch between two views of the same live
capacity:

- **Floor plan** (the default) — a graphical layout of your tables, each shaped
  from its saved table record and labeled with its current state. Status text
  accompanies color, and turning tables show when they are expected to free.
  Choose **Adjust layout** to place tables in their real positions and save the
  authored floor without changing reservations.
- **List** — the same live facts as a scannable alternative when the drawing is
  unavailable or a list is easier to operate.

Use `/workspace` during service. A restaurant opens directly into the compact
**Host stand** console, even when simple navigation is enabled. It keeps the
ranked waiting queue, floor, live pulse, AI seating recommendation, active
turns, reservations to watch, and server load in one bounded working area.
Late reservations show the capacity they still hold so the host can confirm
guest status before releasing it. Each pane scrolls
independently when demand is high; the hostess does not have to scroll the page
to find the floor.

The floor is locked against accidental pan and zoom during service, so tapping
a table selects it instead of moving the drawing. Switch **Floor** to **Table
list** in the same center pane when a list is faster or the drawing is
unavailable. **Orders, calls and messages** opens the existing attention
surface as an overlay inside the console, keeping takeout and customer contact
in reach without displacing the floor. The rest of Operations remains in the
disclosure directly below the host console.

To seat a party:

1. Start with the AI-ranked party selected at the top of **Waiting now**, or
   choose another party.
2. Review the coworker's recommended compatible table and its capacity,
   timing, and server-load explanation.
3. Tap a different table on the floor or in **Table list** when service judgment
   calls for it.
4. Explicitly choose **Confirm seating**. The coworker never seats a party
   without host approval.
5. Advance the table through seated, ordered, paid, clearing, and cleared as
   service progresses.

To move an active party, choose **Move party**, select a compatible destination,
review the change, and confirm. If another host changes the floor first, DPF
does not make a partial assignment: it refreshes the facts and offers current
alternatives.

Tables are never shown as "providers" and never mixed into the Staff list.
Blocked reasons and internal allocation references stay in the owner workspace;
the customer booking experience receives only seat capacity, service area, and
an availability estimate. It does not receive guest names, staff identity,
internal table ids, notes, or blocked reasons.

## What To Watch

- visible storefront promises with no matching fulfilment owner
- scheduling or delivery changes that are not reflected in team setup
- internal team edits made without downstream customer impact review
- a Restaurant's tables appearing under Staff, or capacity that does not match
  the Workspace readiness answer or public booking availability
