---
title: "Business Operations"
area: workspace
order: 1
---

## Overview

**Operations** is the day-to-day business home inside the platform. Its stable
address remains `/workspace`, so existing bookmarks continue to work. It gives
you a cross-cutting view of what is happening now without requiring you to open
every business area. It also hosts managed documents when an operator needs the
maintained copy of a guide, note, policy, or imported source.

## Operations and Performance

The main rail separates two different decisions:

- **Operations** answers “what is happening now, what conflicts exist, and what
  should happen next?” It contains current work, queues, physical resources, and
  immediate actions. The resource cards are also exposed as an accessible list,
  so the same current-state facts are available without relying on the spatial
  layout alone.
- **Performance** answers “how is the business doing over time, and what is
  driving the result?” It is available only to authorized owners and operations
  managers. The dashboard reads precomputed local-business-day snapshots so it
  does not slow current Operations work. Use the period choices to compare days,
  open a metric's **How this is calculated** disclosure to inspect its definition,
  version, source owner, and model-level lineage, or follow **Open source
  operations** to investigate the underlying work. The **Trends** section lets
  you switch among the headline measures; its chart has a **View trend as a
  table** alternative with the same period values. The **Owner brief** ranks the
  largest observed changes, identifies headline gaps that deserve review, and
  says plainly when connected lineage cannot yet prove why a result changed. It
  never labels movement good or bad without a target and business context. The
  freshness badge uses the oldest contributing source update, so one current
  metric cannot hide a stale sibling; a failed refresh keeps the previous valid
  result instead of replacing it with zeroes. Metrics whose canonical source is
  not connected say **Not available** and explain what is missing. **Export this
  period** downloads only aggregate metrics for the selected period, not customer,
  employee, booking, or physical-resource records.

Performance is a separate main destination, not a tab inside Operations. Simple
navigation keeps the day-to-day Operations surface and hides the manager view;
Full navigation exposes both when the signed-in role is permitted.

## Spatial operations for tables and rooms

Operations changes its primary visual model to match the business instead of
forcing every physical resource into the same card grid.

- Restaurants open into a compact **Host stand** that keeps the ranked waiting
  queue, two-dimensional floor plan, server load, active turns, and reservations
  to watch in one bounded working area. The floor shows table position,
  availability, service state, and server load; **Table list** exposes the same
  facts without relying on position or color alone.
- The restaurant coworker recommends a compatible table and explains capacity,
  timing, and server-load tradeoffs, but the host must choose **Confirm seating**
  before anything changes. The embedded floor is locked against accidental pan
  and zoom during service so selecting a table does not move the drawing.
- Hotels and other room-based businesses use a **Room rack** first: rooms run
  down the page and dates run across it, so continuous availability, arrivals,
  departures, and assignment conflicts remain visible together.
- **Floor & wing** answers a different question: where a room is and what needs
  attention nearby. **Accessible list** provides the complete semantic
  alternative for keyboard, assistive-technology, and dense scanning needs.

Room operations deliberately keep four state axes separate. **Occupancy** says
whether the space is vacant, reserved, occupied, or due to turn. **Readiness**
tracks cleaning and inspection. **Inventory** says whether the room may be sold
or assigned. **Privacy** warns whether staff may enter. Text labels accompany
color throughout, because a room can be occupied, dirty, sellable, and subject
to a do-not-enter restriction at the same time.

When the room view is marked **Demonstration**, it is an honest preview of the
operational grammar, not live hotel data. Live assignment, housekeeping, and
maintenance commands remain unavailable until the business's durable room
provider is connected.

## The ward, for a shelter

An animal rescue opens **Operations > Ward** to answer the two questions a
shelter asks all day: where an animal is, and how much room is left.

- The board states **occupied of total** and **free** before anything else, then
  draws the units grouped by your own ward names. A free run is an outline you
  can see rather than a number you have to work out.
- **List** shows the same units as a table when you want the area and state per
  row. It carries every unit the map does.
- A unit held out of service — a deep clean, a repair — shows its reason and is
  **not** counted as free.
- If the shelter is holding animals with no kennel recorded, the board names
  them and says the free count covers only the animals it can place.

Two states are deliberately different. A shelter that has recorded **no
housing** sees "No housing recorded yet" and no free count at all, because
having told the system about no kennels is not the same as having no room. A
shelter whose units are all full sees a free count of zero.

The same figures appear on the Operations home as **Animals in care** and
**Kennels**, so the number you quote in a capacity conversation is the number
the board is drawing.

## Confirming an operational suggestion

An AI coworker can suggest an assignment, but the suggestion is not a completed
business action until the durable operations provider confirms it.

- **Assigning…** means the command is pending. Keep the page open while the
  current version and availability constraints are checked.
- **Confirmed** means the assignment was durably committed.
- **The operation changed** means another operator or process changed the same
  current state first. Operations rolls back the optimistic selection, shows
  safe alternatives when the provider returns them, and lets you retry against
  the latest version.
- **Command unavailable** means the current archetype has no durable command
  provider connected. The platform deliberately does not pretend the suggestion
  was applied.
- A rejected or failed command leaves the business state unchanged.

## Which installation you are on

Operations no longer opens with a panel describing this installation. The
arrival signal is now a short badge beside the logo, for example
**NORTHWIND DEV**, naming the company that operates this installation and the
job it does.

A production installation shows no badge. Production is the unmarked default, so
a badge always means "this is not production" — which is the one fact that stops
you acting on the wrong installation. If the platform cannot work out what this
installation is, it shows no badge rather than guessing.

Select the badge to open [what this installation is](../operations/index.md#what-this-installation-is),
where the full detail and the controls live.

## Correcting the identity

Open **Change what this installation is** to set its main job, its environment,
and the production installation it is paired with.

Choose **Show me the impact** first. The preview lists the fields you are
changing, what each stance becomes, any brake that gets looser, and the evidence
that stops describing this install. Nothing is saved until you confirm that
preview, and editing a field afterwards asks you to look again.

The installer owns the environment for this host. If the installer already set
one, your choice here is recorded but the installer's value stays in force, the
panel says so, and the record is marked **Needs review** until the two agree.
Re-run the installer with `--environment-class` to change the value in force.

## Key Concepts

- **Tiles** — Summary cards for each platform area showing the metrics most relevant to your role. Tiles update in real time and act as shortcuts into the area they represent.
- **Activity Feed** — A chronological stream of recent actions across the platform, filtered to things you're involved in or watching.
- **Calendar** — Upcoming dates pulled from your backlog items, leave requests, deadlines, and any scheduled events in the areas you have access to.
- **Managed Documents** — Maintained documents with lifecycle state, versions, references, and publication status.
- **"Needs you" inbox** — The one place for business decisions that need you now. Routine technical recovery stays with your digital team, while money leaving the business and public actions always come to you.
- **Workrooms** — Active, access-controlled places where people and AI coworkers coordinate toward a named outcome. A Workroom is the friendly Workspace view over a governed Work Case.

## What You Can Do

- See a consolidated current-state snapshot across the business from one screen
- Click a tile to jump directly into the relevant area
- Review recent activity from colleagues and digital coworkers without leaving your workspace
- Access your calendar for today's events and upcoming deadlines
- Open [Managed Documents](documents.md) to review document state, versions, and references
- Open [My Work and Workrooms](work-rooms.md) to see the outcome, accountable participants, current attention, activity, and next action for active company work. Room access is checked before internal context loads; participant details explain each person or AI coworker's role, current work, authority, and sponsorship. Connected communication channels link back to the same canonical room and cannot treat message delivery as completed work. Each room also states the pace it works at — how persistently the coworker follows up, whether it asks before acting, and why — which quietens outside your operating hours without ever changing what the coworker is allowed to do.
- Use your digital coworker to get a personalized briefing on what needs your attention
- Select the installation badge beside the logo to open [what this installation is](../operations/index.md#what-this-installation-is) and correct it
- Open the ["Needs you" inbox](attention-inbox.md) to review plain-language decision cards, weekly batches, and the full technical record when needed
- Approve or decline a coworker action that is held waiting on you, with the exact record and the time left shown on the card
