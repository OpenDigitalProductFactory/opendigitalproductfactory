---
title: "Coworker Proactivity"
area: ai-workforce
order: 6
relatedCode:
  - apps/web/app/(shell)/coworker-decisions/proactivity/page.tsx
  - apps/web/components/proactivity/ProactivityRosterList.tsx
  - apps/web/lib/proactivity/proactivity-roster.ts
---

## What This Covers

**Proactivity** is how much a coworker acts on its own before it involves you. The consolidated view lives at **Coworker Decision Engine → Coworker proactivity**, and lists every coworker with the level it currently acts at, **grouped by business area** — customers and sales, your team, operations and delivery, and platform and back office — so the roster reads as a few navigable sections instead of one long list.

## How the Defaults Are Set

You don't start from a blank slate. Each coworker's default level is **derived from your industry's risk posture** — a plumbing company and a hospital get different starting points. A row marked *"From your industry"* is running that derived default; *"You set this"* means you changed it.

## The Levels

- **Reactive** — asks you before most things. You see the most.
- **Balanced** — handles routine work and logs it; brings real business choices to you.
- **Assertive** — acts and tells you after. You see the least.

## The Two Hard Floors

No proactivity setting can bypass them:

- **Money leaving the business** always comes to you.
- **Anything that goes public** always comes to you.

## What You Can Do

- **Confirm** the derived levels if they look right.
- **Adjust** any coworker in place — the change saves immediately and takes effect on its next scheduled work.
- A coworker may also **propose** its own adjustment after a repeated pattern; you accept, keep, or narrow it from the ["Needs you" inbox](../workspace/attention-inbox.md).

---

*Part of the [cognitive-load redesign](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md). The per-coworker control also appears on each coworker's profile; this page is the one-place confirm/adjust view.*
