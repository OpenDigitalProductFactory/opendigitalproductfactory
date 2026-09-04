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

From **Platform > Workrooms**, select a room ID to open this same canonical Workroom. Rooms tied to backlog work open that backlog case; rooms without a backlog item open their Work Capsule case, so the inventory never leads to a dead route.

## What You See First

The top of a Workroom answers four questions:

1. What outcome does this room own?
2. What needs attention now?
3. Who is accountable and who is participating?
4. What is the next action?

Below that header, **Room definition** names the reusable room pattern and its version.
**This room** identifies whether you are seeing one occurrence, a standing stream, or its
active cycle. **Overview** is the default and keeps the room boundary and shape in view.
Open **Details** for cycles, activity, participants, context, evidence, receipts, and
technical references. A business room does not need a repository, worktree, or pull
request; those appear only when development work actually produces them.

Source identifiers, integration status, and projection confidence remain available under
**Room details** inside **Details**. They do not displace the outcome or the people doing
the work.

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

Open **Details**, then **Participants**, to see why each person or coworker is in the room,
what they are working on, their authority summary, and an AI coworker's accountable
sponsor. Coworkers created by the active thread's governed lineage appear automatically;
the room does not provide an unrestricted coworker picker.

Open **Details**, then **Process Overseer**, to see whether the room is following its declared
activity shape. The panel names the coordinator, whether that assignment was explicit or derived,
the current and next expected stage, the latest conformance result, any intervention reason, and a
stable reconciliation reference. A derived coordinator is shown as compatibility-only: it helps
older rooms remain understandable but is not treated as proof that active oversight is configured.

For a shaped room, missing role, evidence, stage, budget, stop-condition, or authority information
pauses the affected lifecycle transition before work is persisted. An AI coordinator must also have
the required job-specific qualification and delegated authority. When either is unknown, the room
asks for attention instead of assuming eligibility. Rooms without a declared activity shape keep
their legacy behavior and the panel reports oversight as not applicable.

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

## Pace and Priority

Every room shows the pace it is working at, in a **Pace and priority** section that stays
closed until you open it. It answers one question: why is the coworker in this room
behaving the way it is.

Inside, the room states:

- **Pace** — whether the coworker stays quiet, follows up, or pushes and escalates, and
  whether it advises, asks first, or acts alone.
- **Where that came from** — a policy floor, the room's own choice, the shape of the work,
  the coworker's own setting, or the platform default.
- **Priority** — whether this work leans toward quality, cost, or speed.
- **Checking** — whether work here is verified before it counts as done.
- **Why** — the specific reason for each change, in plain terms.

The pace is worked out from the room, not just from the coworker. Three things move it:

- **The shape of the work.** An escalation pushes harder because someone is waiting. Work
  that faces outward — anything leaving the business under its own name — is verified
  before it goes. Standing corpus curation stays in the background.
- **What the business does.** A business whose demand is emergency-driven, or whose
  capacity is lost rather than delayed when it goes unused, warrants earlier attention.
- **The clock.** When the business is closed, follow-up quietens down. When an obligation
  is due soon, it speeds up.

Two rules keep this safe.

**Closing time changes how loudly a coworker follows up. It never changes what a coworker
is allowed to do.** An out-of-hours room is quieter; its approval requirements are exactly
what they were during the day.

**Some work is never quietened.** Security incidents, platform and queue health, and a
field appointment already running late keep their pace when the business is closed,
because those problems get worse while nobody is looking.

If a room has nothing of its own to say about pace, it says so — "Running on defaults" —
rather than implying a decision nobody made.

### Changing it

Open **Pace and priority** and the settings are there, under what the room is currently
doing. Three choices, in the order that matters:

1. **What kind of work is this?** — the shape. This decides what may happen in the room at
   all, so it is the one worth getting right.
2. **How hard should it push?** — quiet, follows up, or pushes.
3. **May it act without asking?** — advises only, asks first, or acts alone.

Anything you set here applies to everyone working in that room, and you can clear it again
to go back to following the work.

One rule is worth knowing before you use the third setting: **stricter always applies.**
Choosing a looser option cannot give a coworker more freedom than its own permissions
already allow. If a coworker is only permitted to propose, setting the room to "acts alone"
leaves it proposing. The room can restrain a coworker; it cannot promote one.

### Setting a default for every room

Most businesses want one answer for most rooms. Under **Priority & Models** in the AI
section, *How work rooms behave* sets the default: how hard rooms push, and whether they
may act without asking.

It is deliberately separate from the per-coworker settings on the same page, because a room
and a coworker are different questions. "How does this coworker behave" and "how does work
in a room behave" have different answers, and the room default only governs work happening
in a room.

The order of precedence, strongest first:

1. A policy floor — regulated work, for instance — which nothing overrides.
2. What the room itself declares.
3. What the work actually is: its shape, the business it serves, and the clock.
4. **Your default for rooms.**
5. The coworker's own settings, then the organisation's, then the platform's.

Your default sits below what the work is on purpose. A blanket preference about rooms
should not overrule the shape of the job in front of you.

## Giving a Room Its Shape

A room can be opened **with a shape** — a short statement of how decisions inside it are
meant to route. The shape is what sets the room's pace and priority, so it is the single
most useful thing to get right when the room is created.

| Shape | Use it when |
| --- | --- |
| **Specialist alignment** | a qualified specialist should check the work before the accountable person sees it |
| **Approval sign-off** | someone prepares the evidence and an accountable person signs it off |
| **Outward review** | the result leaves the business under its own name, so it is reviewed and verified first |
| **Change, consequential** | a change is confirmed before it takes effect |
| **Escalation** | something is blocked and needs the accountable owner to unblock it |
| **Craft stewardship** | ongoing background curation by people who know the craft |

Setting the shape changes how the room behaves. An **escalation** room pushes harder,
because someone is waiting. An **outward review** room verifies before anything leaves. A
**craft stewardship** room stays quiet, because it is background work.

If a room is not given a shape, the platform will work one out where the room says enough
about itself — a standing profession room is craft stewardship, a readiness check is an
approval sign-off. Where the room does not say enough, it stays **unshaped** and simply
runs on defaults. It will not invent a shape, because a made-up shape would change how the
room behaves for reasons nobody chose.

Most rooms created before this existed are unshaped. Giving them a shape is worthwhile for
any room where pace or verification actually matters.

## Incomplete or Unavailable Rooms

If a room boundary is incomplete, the page identifies the missing elements instead of inventing them. If the source is unavailable, the last available projection is marked clearly and the page gives one recovery direction. If an AI coworker's current status is unavailable, the participant panel says so and directs you back to the room's next action instead of implying that the coworker is still working.

If you do not have access, the internal room title, participants, source references, and sensitivity details are not shown. External customer case pages remain customer-safe case summaries; they do not expose internal Workroom controls or participants.
