---
title: "The \"Needs You\" Inbox"
area: workspace
order: 2
relatedCode:
  - apps/web/lib/attention/owner-projection.ts
  - apps/web/components/attention/OwnerDecisionCards.tsx
  - apps/web/components/attention/AttentionInbox.tsx
---

## Overview

The **"Needs you" inbox** is the one place for decisions that need *you*, right now — kept deliberately separate from the work backlog. It answers a different question than the backlog does:

| | Backlog | "Needs you" inbox |
| --- | --- | --- |
| Holds | Work to **schedule** — features, bugs, chores | Business decisions to **make now** — money, public actions, and judgment calls |
| Answers | "What should we build next?" | "What needs *me*, and why can't my digital team finish it?" |
| Cadence | Planned, prioritized, eventually built | Blocking, time-sensitive, perishable |
| Lives on | Operations | Your Workspace |

Folding "a human must decide this now" into the backlog is a category error: the two have different owners, cadence, and half-lives. The inbox gives time-sensitive decisions their own home so they don't get buried under planned work.

## Key Concepts

- **Only owner decisions reach the daily count.** Routine platform recovery, missing credentials, stalled builds, and service health stay with your digital team. They appear only if they create a real business choice for you.
- **Money and public actions always come to you.** A proactivity setting can change how routine work is handled, but it cannot bypass approval when money leaves the business or something goes public.
- **Every card explains the decision.** The top of the card gives a short question, why it matters, what happens if you do nothing, the recommendation, and no more than three plain choices. It never invents a confidence score.
- **Technical detail is preserved.** Open **Technical detail** to see the original title, source, work fields, linked identifiers, detection details, and builder actions. That information is moved one click down, not deleted.
- **A projection, not another queue.** The inbox is a read-only view *over* each area's own records; it is not a second backlog or ticket tracker. Acting on an item updates the record in its home area.
- **An empty inbox is a good day.** When nothing needs a decision, the inbox shows **"You're all caught up"** — and, when relevant, a short summary of what your digital team is handling on its own. An empty inbox is reassurance, not an unfinished list.

## What Shows Up Here

- **Approvals** — bills and expense claims awaiting sign-off, outbound messages pending review, and regulatory submissions with a filing deadline.
- **Business judgment** — a coworker cannot continue safely without your choice.
- **Bounded coworker proposals** — a coworker recommends taking more initiative within a stated limit; you can accept it, keep the current level, or ask for a narrower limit.
- **Friday review** — low-urgency research and improvement suggestions are grouped together instead of interrupting the daily inbox.

## What You Can Do

- **Review the business decision** using the plain action on the card. Builder-only links never appear as the main owner action.
- **Accept, keep, or narrow a proactivity boundary** without leaving the workspace.
- **Open Technical detail** when a builder or specialist needs the full source record.
- **Clear or snooze the Friday review** as one batch, or review an item individually.
- Ask your [digital coworker](../getting-started/ai-coworker.md) for a briefing on what is in the inbox and why.

Deadline-bearing items show a plain tag such as **Due today** or **Due in 3 days**. Impact tags use words such as **Costs money**, **Goes public**, and **Reversible**.

---

*Derived from the [Attention Surface foundation](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-06-23-human-attention-surface-design.md) and the [cognitive-load redesign](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md). This user guide is the owner-facing view; the specs hold the full rationale and non-goals.*
