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
  managers. If historical sources are not configured, it says so instead of
  displaying placeholder zeroes.

Performance is a separate main destination, not a tab inside Operations. Simple
navigation keeps the day-to-day Operations surface and hides the manager view;
Full navigation exposes both when the signed-in role is permitted.

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

## Key Concepts

- **Tiles** — Summary cards for each platform area showing the metrics most relevant to your role. Tiles update in real time and act as shortcuts into the area they represent.
- **Activity Feed** — A chronological stream of recent actions across the platform, filtered to things you're involved in or watching.
- **Calendar** — Upcoming dates pulled from your backlog items, leave requests, deadlines, and any scheduled events in the areas you have access to.
- **Managed Documents** — Maintained documents with lifecycle state, versions, references, and publication status.
- **"Needs you" inbox** — The one place for business decisions that need you now. Routine technical recovery stays with your digital team, while money leaving the business and public actions always come to you.

## What You Can Do

- See a consolidated current-state snapshot across the business from one screen
- Click a tile to jump directly into the relevant area
- Review recent activity from colleagues and digital coworkers without leaving your workspace
- Access your calendar for today's events and upcoming deadlines
- Open [Managed Documents](documents.md) to review document state, versions, and references
- Use your digital coworker to get a personalized briefing on what needs your attention
- Open the ["Needs you" inbox](attention-inbox.md) to review plain-language decision cards, weekly batches, and the full technical record when needed
