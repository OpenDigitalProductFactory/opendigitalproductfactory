---
title: "My Work and Work Rooms"
area: workspace
order: 3
relatedCode:
  - apps/web/app/(shell)/workspace/my-queue/page.tsx
  - apps/web/app/(shell)/workspace/cases/[caseKey]/page.tsx
  - apps/web/components/workspace/WorkCaseAttentionLens.tsx
  - apps/web/components/workspace/WorkCaseDetailView.tsx
---

## Overview

**My Work** is the Workspace view of active company work available to you. Each item opens a **Work Room**: a focused place where authorized people and AI coworkers coordinate toward a named outcome.

A Work Room is not an unbounded chat channel. It has a work boundary: purpose, outcome, scope, accountability, authority, sensitivity, measures, timing, and a closure rule. The platform keeps the underlying governed Work Case and its evidence; the room presents that structure in language suited to doing the work.

## What You See First

The top of a Work Room answers four questions:

1. What outcome does this room own?
2. What needs attention now?
3. Who is accountable and who is participating?
4. What is the next action?

Source identifiers, integration status, and projection confidence remain available under **Room details**. They do not displace the outcome or the people doing the work.

## Activity and Participants

The **Activity** stream distinguishes messages, asks, coworker handoffs, work changes, decisions, artifacts, governed actions, verification, receipts, and cycle transitions. A message is an update; it is not proof that the outcome was achieved.

People and AI coworkers appear together as named participants. Their room role and current work state are separate:

- **Accountable** owns the room outcome.
- **Contributor** performs or coordinates work.
- **Reviewer** verifies work or an outcome.
- **Observer** follows the room without changing it.

AI coworkers remain governed participants. Joining a room does not expand their authority, and a visible presence signal does not grant permission.

## Finite and Standing Rooms

- A **finite room** closes when its bounded outcome and closure rule are satisfied.
- A **standing room** supports recurring work. Each cycle still has its own objective, measures, stop conditions, and structured outcome.

Completion produces an Outcome Packet from governed decisions, artifacts, actions, receipts, evidence, and unresolved work. Conversation alone cannot complete a room.

## Incomplete or Unavailable Rooms

If a room boundary is incomplete, the page identifies the missing elements instead of inventing them. If the source is unavailable, the last available projection is marked clearly and the page gives one recovery direction. If an AI coworker's current status is unavailable, the participant panel says so and directs you back to the room's next action instead of implying that the coworker is still working.

If you do not have access, the internal room title, participants, source references, and sensitivity details are not shown. External customer case pages remain customer-safe case summaries; they do not expose internal Work Room controls or participants.
