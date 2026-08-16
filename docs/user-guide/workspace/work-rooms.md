---
title: "My Work and Workrooms"
area: workspace
order: 3
relatedCode:
  - apps/web/app/(shell)/workspace/my-queue/page.tsx
  - apps/web/app/(shell)/workspace/cases/[caseKey]/page.tsx
  - apps/web/components/workspace/WorkCaseAttentionLens.tsx
  - apps/web/components/workspace/WorkCaseDetailView.tsx
  - apps/web/components/workspace/workroom/WorkroomCycles.tsx
  - apps/web/components/workspace/workroom/WorkroomParticipants.tsx
  - apps/web/lib/work-management/room-channel-continuity.ts
  - apps/web/lib/work-management/room-channel-ingress.ts
  - apps/web/lib/work-management/room-participation.ts
  - apps/web/lib/work-management/workspace-case-loader.ts
  - apps/web/lib/work-management/workspace-room-access.ts
---

## Overview

**My Work** is the Workspace view of active company work available to you. Each item opens a **Workroom**: a focused place where authorized people and AI coworkers coordinate toward a named outcome.

A Workroom is not an unbounded chat channel. It has a work boundary: purpose, outcome, scope, accountability, authority, sensitivity, measures, timing, and a closure rule. The platform keeps the underlying governed Work Case and its evidence; the room presents that structure in language suited to doing the work.

## What You See First

The top of a Workroom answers four questions:

1. What outcome does this room own?
2. What needs attention now?
3. Who is accountable and who is participating?
4. What is the next action?

Source identifiers, integration status, and projection confidence remain available under **Room details**. They do not displace the outcome or the people doing the work.

## Activity and Participants

The **Activity** stream distinguishes messages, asks, coworker handoffs, work changes, decisions, artifacts, governed actions, verification, receipts, and cycle transitions. A message is an update; it is not proof that the outcome was achieved.

People and AI coworkers appear together as named participants. Their room role and current work state are separate:

- **Accountable** owns the room outcome.
- **Coordinator** keeps the room on-task to its outcome—curating who is in the room, sequencing turns, and driving to a decision, close, or escalation. A room has exactly one Coordinator; it may be the same person or coworker as the Accountable, or a different one. When no one is named, the Accountable coordinates by default.
- **Contributor** performs work in the room.
- **Reviewer** verifies work or an outcome.
- **Observer** follows the room without changing it.

AI coworkers remain governed participants. Joining a room does not expand their authority, and a visible presence signal does not grant permission.

An admitted coworker can **read the room's message feed and post into it**, and appears as present while it works. Whether a coworker may read or post is decided per room, scoped to that room's outcome and sensitivity—being admitted to one room grants nothing in another. A coworker working the room's underlying task (for example an external CLI session on the room's build) is admitted to that room as it joins.

A room can also **call in new participants on demand**: a member with action rights (typically the Coordinator) can invite another coworker or a person into the room, either to participate or read-only. The invitee is admitted only to that room, for that room's outcome—never granted anything elsewhere.

Across rooms, you can see **where each AI coworker is engaged**—which active rooms it is in and its role in each (including where it coordinates). This 360 view helps manage how coworkers are used and recognise the routine patterns worth pre-positioning them for.

An authorized coworker can also open a relevant product surface from the room's work type, resources, or task intent—even when no browser page is rendered. These silent/headless surfaces use the same semantic fields, validation, and governed actions as the human browser or mobile view. Room membership still does not expand authority: the surface catalog and every action apply the human role, coworker grants, room/work context, token scope, and approval rules together.

Open **Participants** to see why each person or coworker is in the room, what they are working on, their authority summary, and an AI coworker's accountable sponsor. Coworkers created by the active thread's governed lineage appear automatically; the room does not provide an unrestricted coworker picker.

## Access and Other Channels

Room access has separate discovery, content, and action boundaries. Assignment or an explicit room policy admits a principal; a presence heartbeat never does. Sensitivity clearance is checked on the server before messages, participants, or context load. A person without content access receives the same not-found experience as an unknown room.

When an existing communication adapter attaches a Teams, Slack, email, or other external conversation to a Workroom, DPF remains the canonical context:

- concise notifications carry a link back to the internal room and its canonical Work Case reference;
- the channel binding resolves the external subject to one `Principal` before an inbound event can attach;
- a stable provider event identifier prevents duplicate room activity;
- sensitive actions pause for stronger authentication instead of completing in chat;
- sent or delivered status proves transport only, not that governed work completed;
- if an adapter cannot receive or interact, the channel reports a degraded state while the DPF room remains usable.

Unresolved external identities or room attachments are quarantined from room activity. Provider-specific setup and capabilities remain part of Employee Communication administration, not the Workroom itself.

## Finite and Standing Rooms

- A **finite room** closes when its bounded outcome and closure rule are satisfied.
- A **standing room** supports recurring work. Each cycle still has its own objective, measures, stop conditions, and structured outcome.

Completion produces an Outcome Packet from governed decisions, artifacts, actions, receipts, evidence, and unresolved work. Conversation alone cannot complete a room.

In a standing room, the **Current cycle** panel shows the objective, trigger, review point, measure of done, and stop conditions before the general activity stream. When no cycle is active, the room says that it is healthy and idle rather than implying that recurring work is complete.

**Completed cycles** are ordered by completion time. Open a completed cycle to read its Outcome Packet, durable-record count, verification state, and unresolved work. Each unresolved item has an explicit disposition: carry it into the next cycle, open a separate case, defer it, or accept it. Retrying carry-over does not create duplicate work.

## Incomplete or Unavailable Rooms

If a room boundary is incomplete, the page identifies the missing elements instead of inventing them. If the source is unavailable, the last available projection is marked clearly and the page gives one recovery direction. If an AI coworker's current status is unavailable, the participant panel says so and directs you back to the room's next action instead of implying that the coworker is still working.

If you do not have access, the internal room title, participants, source references, and sensitivity details are not shown. External customer case pages remain customer-safe case summaries; they do not expose internal Workroom controls or participants.
