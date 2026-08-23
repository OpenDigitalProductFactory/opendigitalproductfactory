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

## This Page Sets a Starting Point, Not the Final Answer

The level on this page is the coworker's **own** setting. It is one layer of a ladder, and
inside a Workroom it is not usually the layer that wins.

When a coworker works in a room, the pace is resolved from the **work** rather than from the
coworker's identity — because the same coworker drafting a note on a Saturday evening and
releasing a payroll run on its due date should not behave the same way. The ladder, strongest
first:

1. **Hard policy** — residency, sensitivity, and regulated ceilings. Never relaxed.
2. **The room's own declaration**, if one was made when the room was convened.
3. **Derived** from the shape of the work, what your business does, and the clock.
4. **This page** — the coworker's own saved level.
5. **Organization or activity-family default.**
6. **Platform default** — Balanced.

The rule that keeps this predictable: **a derivation can only tighten.** A room can make a
coworker more careful or more urgent than the level you set here. It can never make one act
more freely than you allowed. If your setting did not apply, the room's **Pace and priority**
panel names the layer that overrode it and why.

Outside a room — in a direct conversation, or on a coworker's own standing work — the level
on this page is the one that applies.

→ [How Governed Work Actually Runs](how-governed-work-runs.md) walks the whole ladder;
[My Work and Workrooms](../workspace/work-rooms.md) covers the per-room panel.

## The Levels

- **Quiet** — asks you before most things. You see the most.
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

## What the Dial Actually Changes

Be aware of an honest limit: **the dial only changes behaviour for a coworker
that has standing work of its own to do.** For every other coworker the setting
shapes how it behaves in a conversation with you, and nothing else — it is not a
switch that makes an idle coworker start working.

### What it does

Six coworkers currently self-drive. Each does one concrete, repeatable,
reversible piece of work on your behalf:

| Coworker | What it does without being asked |
|---|---|
| Marketing Specialist | Keeps a current acquisition campaign brief on the Campaigns page |
| Finance Controller | Reports burn, revenue, and runway — and says what is unknown |
| Inventory Specialist | Reviews stock position and flags what needs ordering |
| Documentation Specialist | Refreshes the documentation health overview |
| Platform Engineer | Reports platform posture |
| Compliance Officer | Reports obligations and control reviews falling due, and any recurrence with no next date |

The other coworkers on the roster have no standing work bound to them yet. Their
Proactivity row is real — it changes how they behave in conversation — but
turning one to Assertive will not produce work while you are away.

### When it runs

A self-driving coworker runs **weekly at Balanced** and **daily at Assertive**,
each at its own off-peak time so they do not contend. At **Quiet** it does not
self-drive at all. Changing the level takes effect on the coworker's next
scheduled run, not immediately.

**Your operating hours are read, not guessed.** When the business is closed, follow-up
quietens down and the channel drops to in-app; when an obligation's deadline is approaching,
it speeds up. This changes **cadence and channel only** — an out-of-hours coworker is quieter,
and its approval requirements are exactly what they were during the day.

**Some work is never quietened.** Security incidents, platform and queue health, and a field
appointment already running late keep their pace when the business is closed, because those
problems get worse while nobody is looking.

### How it stays current

Each run reads live records rather than a cached summary, and each task is
written to be idempotent: a coworker that already produced today's brief or
report refreshes it instead of producing a second one.

### What it will not do

- No level bypasses the two hard floors above. **Money leaving the business and
  anything that goes public always come to you**, at every level.
- A coworker running unattended **will not take a consequential action** —
  anything that spends, reaches a third party, changes who may act, or destroys
  state — without first consulting the decision kernel. That is enforced at the
  point the action is taken, not by the level you chose.
- Assertive does not widen what a coworker is allowed to do. It changes **how
  often** its standing work runs and how much of it proceeds without you; it
  never changes who is accountable, what stops the work, or which steps require
  your decision.

### What you must do

- Read what a self-driving coworker produced. Nothing it writes is acted on
  automatically.
- Decide anything it escalates. A coworker's report is an input to your
  decision, and the consequential ones require your approval by design.

---

*Part of the [cognitive-load redesign](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md). The per-coworker control also appears on each coworker's profile; this page is the one-place confirm/adjust view.*
