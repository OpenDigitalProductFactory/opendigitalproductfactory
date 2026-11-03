---
title: "My Work and Workrooms"
area: workspace
order: 3
relatedCode:
  - apps/web/app/(shell)/workspace/my-queue/page.tsx
  - apps/web/app/(shell)/workspace/cases/[caseKey]/page.tsx
  - apps/web/components/workspace/WorkCaseAttentionLens.tsx
  - apps/web/components/workspace/WorkCaseDetailView.tsx
  - apps/web/components/workspace/workroom/WorkroomHeader.tsx
  - apps/web/components/workspace/workroom/WorkroomCycles.tsx
  - apps/web/components/workspace/workroom/WorkroomFlowMap.tsx
  - apps/web/components/ops/workrooms/AreaFlowPanel.tsx
  - apps/web/components/workspace-home/MainStreamHero.tsx
  - apps/web/lib/work-management/room-ai-spend.ts
  - apps/web/components/workspace/workroom/WorkroomParticipants.tsx
  - apps/web/lib/work-management/coworker-engagement-case-projection.ts
  - apps/web/lib/work-management/room-channel-continuity.ts
  - apps/web/lib/work-management/room-channel-ingress.ts
  - apps/web/lib/work-management/room-participation.ts
  - apps/web/lib/work-management/workspace-case-loader.ts
  - apps/web/lib/work-management/workspace-room-access.ts
---

## Overview

**My Work** is the Workspace view of active company work available to you. Each item opens a **Workroom**: a focused place where authorized people and AI coworkers coordinate toward a named outcome.

A Workroom is not an unbounded chat channel. It has a work boundary: purpose, outcome, scope, accountability, authority, sensitivity, measures, timing, and a closure rule. The platform keeps the underlying governed Work Case and its evidence; the room presents that structure in language suited to doing the work.

When a room carries a backlog item, its outcome is that item's outcome. The room reads it from the item each time, so editing the item's outcome updates the room. A room only shows a different outcome when someone declares one in its boundary.

From **Platform > Workrooms**, select a room ID to open its canonical case. A room tied to backlog work resolves to that backlog case while retaining the selected room in the URL. Its process, room journal, reviewer evidence, participants and workforce stay scoped to that room. Shared case messages are labelled **Case context**; case receipts do not prove completion of an individual room step. A stale selection or a room belonging to another case is unavailable rather than silently showing a different room. A room without a backlog item opens its own Work Capsule case.

A delivery room also shows its **Structure**: where its current step sits on the IT4IT value streams, for example *Integrate · Build, Integrate, & Test Stage*, and the next stage it advances to. Each step of a delivery work shape maps to one IT4IT 3.0.1 stage. Design and reproduction steps sit in Design & Develop, building and repairing in Build, Integrate & Test, merging in Accept & Publish Release, and runtime checks and acceptance in Validate Deployment. A room that has not reached a step yet shows no structure rather than a guessed one.

Coworker service engagements can also appear as Work Cases. When a requested coworker service needs approval, is accepted, or is in progress, the room opens around the engagement itself: the requested outcome is the room boundary, the provider coworker appears as a contributor, and approval context or audit references stay attached as evidence. These rooms do not show the WorkItem comment box until a WorkItem exists, because there is no task message thread to post into yet.

## What You See First

**Needs attention** includes coworker recovery as well as human decisions. It is not a count of choices the owner must make. The next step names the recorded actor separately from the person accountable for the outcome. Missing stage results remain with the stage executor; missing source or review evidence stays with the delivery or requesting coworker. An unavailable actor or action is stated rather than guessed.

A human decision shows its recorded question and condition from the room's declared process. A delivery status alone does not mean the owner must approve something, and a waiting lease does not establish progress. Open the original room to review its evidence and use its supported decision controls.

Shared recovery groups retain every room link. A shared action appears only when the rooms agree; different remedies remain on their own rows. **Technical evidence** links to the room's recorded evidence, while cycle and supervision details remain disclosed. The inventory does not preload branch, session and lease diagnostics for every row.

For development work, a verified repository observation can update the room's
pull request when it matches the room's current commit. The room journal retains
the previous link. Reusing a branch name alone does not establish current
delivery, and a merged pull request does not complete the whole initiative.

The top of a Workroom answers four questions:

1. What outcome does this room own?
2. What needs attention now?
3. Who is accountable and who is participating?
4. What is the next action?

Long names and source identifiers wrap within the header on narrow screens,
keeping the full value available.

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

### Delegation and recovery

The workforce panel's **Delegation and recovery** disclosure shows recorded parent
and child responsibility links, their coordinators, and the route to a named person.
Opening it keeps you in the selected room. The route does not grant access, approve
work or establish that someone received a notification; check the activity timeline
for actual events and decisions.

**Recovery path needs attention** means the route cannot be resolved. Open it for
the missing assignment, conflicting links or access guidance. A parent's contents
remain private unless you are admitted with sufficient clearance. Dependency links
do not make another room responsible for this one.

A room held for an hour uses the recorded recovery route for its stall notice.
Missing recipient bindings or a failed notification write leave the notice unsent
for retry. A recorded notice does not mean the blockage is resolved or the room
has completed; the room keeps its existing stage and closure rules.

### Inspecting the process

The process view separates the versioned **Intended process** from **Observed
execution** records. Select a step to see its position, reason, next action,
owner, supporting evidence, and affected work. Required evidence is not proof
that the evidence has been recorded. Where a receipt cannot be linked to an
individual step, the view reports that gap and keeps it in the room evidence.

The recent activity feed shows a bounded window. A step's latest matching evidence
remains available when newer activity pushes it outside that window, provided it
still matches the room's current source and process definition. An observed receipt
does not by itself establish that the step passed or completed.

Stage-scoped development evidence recorded for the room's current source and
process version can appear under that step's required evidence. A link means the
record was observed; it does not grant approval or verify completion. After the
room changes source or process version, older records remain in its history and
do not satisfy the current step's evidence binding. Earlier records without a
source binding remain uncorrelated.

**Observed execution** counts activity events and receipts separately. Expand a
record for its source identity, actor and timestamp. An event records what was
observed; it does not verify a step. A process pause appears in the room's
attention summary, and a step's intended advance condition does not override
the current permitted-transition check.

A recorded wait names the stage and the role or person expected to act in the
attention summary. That wait remains visible until the runner records another
action; refreshing the page does not mean the work has progressed.

When a standing room is waiting on a decision, its **Attention** card says what
is waiting and who decides. If that is you — the room's accountable owner — a
**Decide** button opens the choices (for example Accept, Patch or Defer), a
date when you defer, an optional one-line reason, and a short summary of what
the earlier stages found. Your decision is recorded as the stage's evidence and
the room moves on at its next run. Anyone else sees who decides, not the
control.

Use **Map** or **List**, search by step or owner, and filter by state. Arrow keys
move between visible steps; Home and End select the first and last. The selected
step and filters stay in the URL so returning to the room preserves context.
Selecting a step inspects it; it does not execute a transition or approve work.

**Not verified** means the view lacks proof. **Recorded** means an observation
exists without a verified completion verdict. **Cancelled** is distinct from
success. The projection check time and latest evidence time are separate; an
unknown timestamp does not imply a fresh observation.

After a minute, the process snapshot is marked stale. **Refresh state** reads
the selected room's process, definition and flow map together. Your selected
step, filters, layout, open evidence and keyboard focus stay in place. The warning
clears only when a newer server read arrives. Other room panels retain their own
snapshot. Refreshing does not resume work, approve a transition, or prove progress.
A missing or future read time remains unknown.

If your browser reports offline, **Refresh state** keeps the displayed snapshot
and announces that you need to reconnect. When the browser reports a restored
connection, refresh manually to check for changes. Reconnecting alone does not
refresh the page or establish that the server is reachable. If a request fails
or times out, the saved process snapshot remains available with a manual retry.
A changed selection asks you to reopen the case. If your session ends or room
access is removed, the protected process is hidden with a sign-in or My Work
link. A failed flow-map read is marked partial rather than retaining an old map
under a new check time.

Native reviews submitted through OAuth use the same current permission checks as other authenticated reviews. Before dispatch or recovery, the worker checks token expiry, token and client revocation, tool grants, and task ownership. A failed authority check pauses the review before a provider call; it does not grant permission or silently switch credentials.

Native reviewer runs also appear under **Observed execution** while queued or
waiting, before a final receipt exists. Expand a run or checkpoint for its recorded
state, requester or reviewer, last recorded reason, and source reference. Heartbeat
time is separate from the time the page read the record. A stale or unknown heartbeat
does not establish current activity. Missing sources and truncated history are
reported as incomplete. A completed reviewer task still needs its completion receipt;
it does not prove that the Workroom outcome is complete.

The **Activity** stream distinguishes messages, asks, coworker handoffs, work changes, decisions, artifacts, governed actions, verification, receipts, and cycle transitions. A message is an update; it is not proof that the outcome was achieved.

### Handing development work to another assistant

An assistant can request a handoff to another assistant already admitted to the
same room. The request records the destination and next action. **Waiting for
receiver** means the current executor still owns the work. **Handoff completed**
appears only after the named receiving assistant acknowledges the request for
the same human owner.

A same-mandate handoff uses existing authority and standing delegation. It does
not invite a participant or expand anyone's permissions. Restricted work, linked
builds, or changes to the room's owner, scope or authority keep their existing
controlled handover. A destination session is endorsed by the receiving assistant;
the platform does not authenticate an external chat from its session label.

**Handoff refused** gives the recorded reason. If the room or its lease changed,
the requesting assistant reads the current room and submits a fresh request.
Active or queued verification leases and an applicable review exemption must be
settled through their owning workflow before execution moves.

People and AI coworkers appear together as named participants. Their room role and current work state are separate:

- **Accountable** owns the room outcome.
- **Coordinator** keeps the room on-task to its outcome—curating who is in the room, sequencing turns, and driving to a decision, close, or escalation. An executable room requires one explicitly named Coordinator; it may be the same person or coworker as the Accountable, or a different one. Missing assignment pauses execution.
- **Contributor** performs work in the room.
- **Reviewer** verifies work or an outcome.
- **Observer** follows the room without changing it.

AI coworkers remain governed participants. Joining a room does not expand their authority, and a visible presence signal does not grant permission.

An admitted coworker can **read the room's message feed and post into it**, and appears as present while it works. Whether a coworker may read or post is decided per room, scoped to that room's outcome and sensitivity—being admitted to one room grants nothing in another. A coworker working the room's underlying task (for example an external CLI session on the room's build) is admitted to that room as it joins.

A room can also **call in new participants on demand**: a member with action rights (typically the Coordinator) can invite another coworker or a person into the room, either to participate or read-only. The invitee is admitted only to that room, for that room's outcome—never granted anything elsewhere.

You are not asked to approve every invite. A room has a **charter**: the kinds of participant it admits without asking, and the most they may do there. By default, a room whose sensitivity is public or internal admits your organization's own AI coworkers and your own assistants (Claude, Codex, Grok), up to posting and creating records. When an invite fits the charter, it goes ahead under a decision that's already on record: the room's own decision for a coworker working in it, or the consent you gave when you connected your assistant. When nothing like that applies, you're still asked.

Every other invite still comes to you for approval. That includes inviting a person, inviting into a confidential or restricted room, inviting a retired coworker, and asking for more than the charter allows. The charter only decides whether you're asked. It never grants access: the invitee still needs the clearance and permissions the room requires.

A room takes its sensitivity from the work it serves. Rooms for work on the open-source platform itself count as public, so any AI coworker can be invited to them. Rooms for your organization's own work are usually internal. A coworker joins one only once someone who manages coworkers has given it internal data access, under **Coworker data access**. Until then, an invite into such a room comes to you, and the coworker cannot read the room.

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

### Reading the flow map

When a room has a work shape, the **Shape** view opens with a picture of it, above the step list:

- **Lanes** show who does each step: AI coworkers, people, and outside touchpoints (a step that talks with a customer or supplier).
- **Steps** are boxes, left to right. A step's border and mark show its state:
  - **▶** being worked
  - **◷** waiting on a person
  - **!** blocked, with the reason (for example *missing explicit coordinator (conformance pause)*). A room that was stopped before it started any step shows this on its first step.
  - **✓** done
- **A diamond** after a step means a person decides the way out of it.
- **Under each step** is how long this room has spent there, next to the shape's **typical** time over the last four weeks. A step well over its typical time is marked **slow**. Until a step has finished at least five times, it says *not enough history yet* instead of showing a number.
- **The line above the map** describes the same shape in words: what starts it, its steps, who decides, and how it ends.

Choose a step on the map to open the same inspection as the step list. A shape that runs steps in parallel is listed as steps, not drawn as a line, until the map can draw the branches exactly.

### How work flows in each area

Each area's **Work** view opens with the same five measures, so the four portfolios can be compared:

| Measure | What it means |
|---|---|
| **In flow now** | Rooms being worked, waiting on a person, or blocked. |
| **Flow time** | How long a run takes, from its first step to its stop. This is the median over the last four weeks, with the change from the four weeks before and a weekly trend line. A delivery room is one run however many days it takes. For a recurring room, each cycle is a run. A cycle that is still open when the next one starts did not finish, so it counts as abandoned and never as a finished run. |
| **Flow efficiency** | The share of step time spent working rather than waiting. |
| **Finished per week** | Runs that reached a success stop. |
| **Cost** | Points in flight, points delivered this quarter, and the AI used by this area's rooms over the last four weeks. AI use is counted only from conversations and dispatched work that name a room, so it is never guessed. Recorded dollars are shown when a provider records a cost. Work on a subscription records no per-call cost, so it shows as subscription tokens (for example *subscription: $0 recorded, 832.3k tokens*) and never as a bare $0. |

All four measures, **in flow now**, **flow time**, **flow efficiency** and **finished per week**, have a small trend line for the last eight weeks and their change against the four weeks before. A dashed mark on a trend line shows the week a new version of a work shape started running in this area, so you can read a change in the line against the change that may have caused it. A week's **in flow** count follows the same rule as today's: a room that has ended is out of flow from when it ended, and a room parked with nothing to do (its work item inactive, or a quiet posture) is out of flow while it is parked.

Below the measures:

- **A bar** shows the mix of work in flow: features, defects, risks and debt.
- **A table** lists the area's work shapes. For each one it shows how many rooms are in flow and where most of them wait.

Choose a shape to see it drawn across all of its rooms:

- Each step shows how many rooms are there and how many are waiting.
- A version picker lets you compare the same shape before and after a change.
- Choose a step to list the rooms at that step, then open any room.

Under the picture, **Where the time goes, step by step** puts the numbers on each step:

- **A box per step** shows how many rooms are waiting there (▽) and how many are in the step. It also shows the step's usual **dwell** (how long a room stays), **process** time (how long it is actually worked) and **first pass** (how often it finished without being sent back). A step that has finished fewer than five times says *too few to measure* instead of showing a number.
- **Slower lately** or **Faster lately** appears on a step whose last seven days differ from its usual time by a quarter or more, with both times shown.
- **The timeline** lays the measured steps side by side, with process time on the upper line and waiting time on the lower line. Below it is the total of each and the shape's **flow efficiency**: the share of the time the work was actually being worked.

Below the steps, **Flow reviews** compares the shape version with how it started. Its first four weeks of step data are its **baseline**. Each work shape sets how often it is reviewed, for example every 28 days. At each review, the panel shows:

- How long a step typically takes and the flow efficiency over the four weeks before the review, each next to its baseline.
- The step where the most waiting built up, weighing rooms held by how long work typically waits there.
- For the latest review only, why most rooms at that step are held. Earlier reviews do not show a reason, because the daily step data does not record one.

A review covers every room on that shape version, in every area, because the daily step data is not split by area. Its counts can therefore be larger than the rooms you see in this area.

Until the baseline is complete, the panel says when the first review will be. A review with too few finished steps to compare says so rather than showing a number.

**Products** (`/portfolio`) shows the four portfolios side by side on the same measures. Rooms with no portfolio are shown in their own **Unplaced** column and never counted in another.

### The main value stream on your home page

Below **What needs you**, the home page shows your business's **main value stream**. This is the work of the portfolio your business type puts first. For a repair shop it might be the jobs you deliver; for a software business it is the changes you build and release.

The panel shows four things:

- **One sentence** naming where the most waiting builds up right now, and why. It weighs how many rooms are held at a step by how long work typically waits there, so two rooms stuck for days outrank five that clear in an hour. For example: *2 rooms are held at review in Small change, typically waiting 2d (waiting on a person).* A step with too few finished passes to measure is only named when no held step can be measured.
- **Four numbers**: in flow now, flow time, flow efficiency, and finished per week.
- **A work shape, drawn live.** It is the busiest of the shapes your business type puts at its delivery stage, or the busiest shape if none of those is in flow. Delivery shapes sit at the delivery stage when your business type builds and deploys on the IT4IT value streams. A software platform does; most other business types do not, so the home draws their busiest shape.

Choose a step on the map to open that step in the area's Work view, where you can see the rooms waiting there.

### When work keeps piling up

Each work shape is reviewed on its own schedule (see **Flow reviews** above). Every morning the platform records the newest review of each shape on the day it falls: the step where the most waiting built up, and why rooms were held there.

When two reviews in a row name the same step for the same reason, the platform files it once in the backlog. The item names the step, the shape, the reason and both review dates. It is assigned to whoever the work shape makes accountable for that step, and it records how the fix should be made: as a check at that step, which every room of the shape then inherits. If the same pile is named again later, the open item is updated rather than filed twice. A pile that clears between reviews is never filed, so the backlog holds only problems that persist.

## Access and Other Channels

Room access has separate discovery, content, and action boundaries. Assignment or an explicit room policy admits a principal; a presence heartbeat never does. Sensitivity clearance is checked on the server before messages, participants, or context load. A person without content access receives the same not-found experience as an unknown room.

A room's sensitivity comes from the boundary set on the room. If no boundary is set, it comes from the backlog item the room serves:

- **Platform work is public by default.** This means items scoped to the platform itself (planning scope *platform* or *common*, or the DPF portal product). DPF is open source, so any coworker cleared for public information can help with it.
- **Other work stays internal**, such as work on your own organization's products and operations.
- **An item marked *confidential* or *restricted* stays closed**, even when it is platform work. To keep a platform item private, mark it confidential. Every change to an item's sensitivity is recorded on the item.

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
- Each new run of a standing room starts fresh. Every stage has to earn its evidence again, and every decision is asked for again, so yesterday's decision never completes today's run. A run still in progress at midnight carries on where it was.
- A room started for a single piece of work, not on a schedule, runs once. When its run succeeds it stays finished; it is not started again the next day.

Completion produces an Outcome Packet from governed decisions, artifacts, actions, receipts, evidence, and unresolved work. Conversation alone cannot complete a room.

In a standing room, the **Current cycle** panel shows the objective, trigger, review point, measure of done, and stop conditions before the general activity stream. When no cycle is active, the room says that it is healthy and idle rather than implying that recurring work is complete.

If a room's cycle cannot be worked out, the cycle section says so instead of
reporting the room as idle — an idle room and a room whose cycle failed are not
the same thing, and only one of them is fine to leave alone. Everything else on
the page stays accurate and safe to act on; the reason is recorded for your
platform team rather than shown to you.

**Completed cycles** are ordered by completion time. Open a completed cycle to read its Outcome Packet, durable-record count, verification state, and unresolved work. Each unresolved item has an explicit disposition: carry it into the next cycle, open a separate case, defer it, or accept it. Retrying carry-over does not create duplicate work.

## Defining the Room

A room shows a yellow **"This room needs a clearer boundary"** panel when it has
not been told what it is for. The panel lists what is missing — most often the
intended outcome and who answers for it — and, underneath, a **Define this
room** button.

You are asked two questions first, because those two are what the panel says
must be settled before consequential work continues:

- **What does finished look like?** One sentence describing what is true when
  the room is done.
- **Who answers for it?** One person or role — someone a question can be put to,
  not a team.

Answering those two clears the blocking part of the notice. Everything else —
what is in scope, what is explicitly *not*, what the room may decide without
escalating, the most sensitive material allowed, how anyone would know it
worked, and when it stops — sits behind **Add scope, authority, measures and
closure**. Fill those in when they matter; a room with an outcome and an owner
is already bounded enough to work in.

Leaving a field blank clears it. A room where every field is blank goes back to
reporting that nobody has defined it, which is deliberate: "nobody bounded this
room" and "somebody bounded it to nothing" are different states and the panel
should not confuse them.

**Who can do this.** The same people who can change a room's pace — defining a
room sets shared state that governs what every participant may do, so it is not
a personal preference. If you cannot see the button, the case has no room
behind it yet.

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

### What "how hard should it push" now reaches

That second setting no longer governs only the room's own turns. It also sets the pace of
the **standing work its coworkers do on their own** — the recurring tasks that run without
anyone asking.

Before, that pace came from a per-coworker setting that had been removed from the product,
so a coworker's recurring work ran at a rhythm nobody could change. Now the room that
carries the work sets it, which is the same place you already decide everything else about
that work.

Two things follow from that, and both are deliberate:

- **A coworker in more than one room takes the fastest.** It has one set of recurring tasks,
  not one per room, so a room set to "pushes" is served at that pace. A quiet room does not
  slow down what another room is pushing on.
- **A finished room stops setting anything.** Once a room is complete or abandoned, its pace
  no longer counts — work that is over should not keep driving a coworker.

- **A coworker with no recurring work yet can be started by its room.** This is new. Until
  now, setting a room's pace could only change the rhythm of a coworker that was *already*
  running something — and whether it was depended on a leftover setting from before the
  per-coworker control was removed, which nobody could create any more. So some coworkers
  could be sped up or slowed down, and others could not be started at all, for reasons that
  had nothing to do with the work. Now the room carrying the work is enough: set its pace to
  "follows up" or "pushes" and the coworkers in it pick up their standing work.

If no live room carries a coworker's standing work at all, its recurring tasks keep running
as they were. Nothing is switched off behind your back.

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

One exception: **Build Studio rooms**. A Build Studio change is already checked by the build
gates (tests, the merge queue and review) before it lands, so "asks first" there would mean
asking the gates, not you. In those rooms your default decides whether work may act alone,
and the business being closed does not slow them down. A room's own declaration still wins.

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

### A shape is a model the platform checks

A shape is more than a label. It is a small engineering model of the work:

- the stages the work moves through
- who answers for each stage
- which decision moves it forward, and which authority owns that decision: the platform (WWMD),
  your business (WWWD) or the profession (WSID)
- which tools each stage may use

The platform runs the room *from* that model and checks the room *against* it. A tool the current
stage does not admit is not offered to a coworker at all, rather than offered and then asked about.
That is why one well-placed decision can replace a stream of approval prompts.

This way of working, where the model *is* the system rather than a diagram beside it, is called
model-based systems engineering. The standard that defines it for AI coworkers is the
[Gated Permissions Process](../../architecture/gated-permissions-process.md). Its
[Build Studio walkthrough](../../architecture/gated-permissions-process.md#annex-c-informative-build-studio-as-a-gpp-model)
shows the stages, decisions and tool permissions of a delivery room end to end.

## Incomplete or Unavailable Rooms

In **Define this room > More room details**, **Sensitivity limit** offers public,
internal, confidential and restricted classifications, or an explicit unset value.
An older declaration outside those classifications shows **Needs classification
review**. Editing the room's purpose or outcome preserves that declaration and
does not restore access automatically.

A platform administrator can ask their assistant to review the classification
state of that exact room. This administrative check returns no room contents.
After the administrator verifies the actual information classification, the
assistant can propose a correction with the current review reference and a reason.
The normal approval applies; if the room changed meanwhile, it must be reviewed
again. Correction retains the original declaration in the room's audit and changes
no coworker's global clearance. Existing valid classifications cannot be lowered
through this recovery operation.

If a room boundary is incomplete, the page identifies the missing elements instead of inventing them. If the source is unavailable, the last available projection is marked clearly and the page gives one recovery direction. If an AI coworker's current status is unavailable, the participant panel says so and directs you back to the room's next action instead of implying that the coworker is still working.

If you do not have access, the internal room title, participants, source references, and sensitivity details are not shown. External customer case pages remain customer-safe case summaries; they do not expose internal Workroom controls or participants.

## Who Is Accountable, and Who Is Working

Each room states the person accountable for it — the human answerable for the work — and where
that answer came from: recorded on this room, inherited from a room further up, or inherited from
the organization's recorded owner. Knowing which one it is matters, because it tells you where to
go to change it.

The header and workforce panel use the same accountability result, including
its recorded or inherited source.

The organization's recorded owner is set when the install is first set up — the owner account
is recorded unless an owner already exists — and an administrator can change it under
**Admin > Settings** (**Accountable owner · Change**). Changing it re-points every room that
inherits from the organization; rooms with their own recorded owner are unaffected.

If nobody is recorded, the room says setup is required rather than naming whoever happens to be
handy. The install's first administrator, the person who created the room and whoever holds the
lease are all available, and all of them would be a guess presented as a decision.

Accountability is answerability for the work. It is deliberately separate from who coordinates
the room and from what any AI coworker is permitted to do — a coworker doing the work does not
become accountable for it.

### Who an AI coworker's stage runs for

When a room reaches a stage an AI coworker carries out, the platform schedules that work under a
person's account. It uses the person the room was requested by or created by. Some rooms record
neither, for example rooms started from Build Studio. For those, the work runs for the room's
accountable person, found the same way as above: recorded on the room, inherited from a room
further up, or the organization's recorded owner. The room's activity says which of those it used.

If no accountable person with an active account can be named, nothing is scheduled. The room
shows as paused at that stage, with the reason that no accountable person can be named. It does
not show as dispatched. After an hour it is reported as stuck like any other paused room. Record an
accountable person on the room, or set the organization's owner, and the next drive cycle schedules
the work.

### When an account stops being used

Rooms, Build Studio builds and scheduled coworker tasks belong to an account. If that account stops
being used (a person leaves, or work was set up under a setup account by mistake), everything it
owns keeps sending its approvals to an inbox nobody reads.

An administrator can hand all of it over in one step. Ask your AI coworker to plan a handover for
that account. It shows every live room the account alone coordinates, every live build it
created and every scheduled task it owns, and who each will go to: the accountable person of the
item's portfolio, or Foundational's, or the organization's owner. Anything with nobody chosen is
listed as refused rather than guessed. Approve the handover in your inbox and exactly that list
moves; if anything changed in between, nothing moves and the plan has to be run again. Every room,
build and task records who handed it over and why.

Beneath that, the room lists the workers in it. An AI coworker reached through several tools is
one worker, not one row per tool, and any subagents it delegated appear grouped beneath it. Where
delegation was never recorded, the room says so instead of placing workers under a likely parent.
Where the platform holds no observation of what a worker is doing, the room says the state is not
recorded rather than reporting it as idle. With many workers the list is bounded and tells you how
many of the total it is showing.
## Opening a Workroom That Has No Work Item

Opening a Workroom from an operation keeps that operation and any selected
process step in the address when the room resolves to its case. In step
inspection, linked records appear as a short list; expand it to read every
identity. A link alone does not establish that the step affects that record.

Most Workrooms are attached to a work item, and opening one takes you to that
item's case. Some Workrooms are not attached to anything — they are the piece of
work themselves. Those now open as their own case rather than reporting that the
page could not be found.

A room like that shows what it holds and states what it does not. If no
objective was recorded, it says so rather than repeating the room's title as
though that were the objective, and urgency, effort and assignment read as not
recorded rather than showing a value nobody set.

These standalone rooms also show their recorded process shape, driver observations,
recent activity and reviewer evidence. A failed reviewer appears as attention
needed even when the room itself has not been marked blocked. Inspect **Observed
execution** for its recorded reason and required action. A task status or journal
entry is an observation, not proof that the room's outcome has been verified.

An unavailable evidence source or a history longer than the displayed window is
marked partial. Missing purpose and scope remain boundary gaps. Access to a room's
contents requires admission and sufficient sensitivity clearance; following a
coordination link does not grant that access.

For a review marked **auth-required**, open **Activity projection details** in the
Operations Map and select the review. Its requester must inspect the authority
saved with the request. Signing in again does not replace those saved credentials.
The inspector retains the original deadline and recovery count; the server checks
authority again before accepting recovery.

You can also inspect a reviewer under the room's **Observed execution**. Expand
its request to see the recorded state, reason, next action, requester and history.
Checkpoint rows identify the reviewing agents; completed checkpoints alone do not
prove a successful verdict. The read time and heartbeat show how fresh the view is.
For a waiting request, the shared recovery controls show its original deadline
and attempts. Only the original requester can submit recovery, and the server
rechecks saved authority. An expired window or exhausted limit cannot be reset
from the room. Intended steps remain separate from these execution observations.

Requests are labeled current, historical, or version unknown. Current means the
latest request issued for the room's recorded source commit. Older requests keep
their evidence but do not drive current attention or offer recovery here. Missing
identity is a projection gap. A working request describes server continuation,
not its previous wait. Brief checkpoint database retries reuse the provider result;
they do not spend an additional provider call. Successful sibling checkpoints are
saved before a failed branch puts the review into a wait.

Independent initiative reviews also appear in **Observed execution**. A receipt
can appear under a process step when its subject, repository and exact source
commit match the room and its evidence kind matches that version's requirement.
It identifies the reviewer, verdict and source commit. Historical or unresolved
source versions stay in the evidence history. A matching review supports the
requirement; it does not by itself prove the step or Workroom has completed.

For nested rooms, accountability follows recorded responsibility links. Competing
parents or a lineage that exceeds the read limit appear as setup gaps. They do
not silently assign the organization owner. An explicit accountable assignment
on the room or a known ancestor still takes precedence.

When a case has several Workrooms, choose a room to inspect its own process and
owners. Links from the operation view keep the selected room and navigation
context. The case does not combine coordinators from different rooms.
From Enterprise Architecture's Workrooms view, open Coordination and choose
**Find a room** to search by title or room ID, filter by operation, or filter by
room status. **Next rooms** continues through open rooms; the count is for the
displayed page. Selecting **Operation** from a room's process returns to the
same filters and page. Recorded stage waits are shown when the drive has named
the stage and responsible role.

In **Details**, expand **Review requirements** to see what this source of work
requires. Each requirement names its expected outcome, comparison population,
evidence fields and inherited sources. Technical profile identity and unresolved
references stay in a second disclosure. A profile that composes correctly has
not necessarily been assessed; organization fit and missing evidence remain
explicit. Conflicting or unsupported requirements need reconciliation.

**Did the change help?** explains when no independent assessment is available
in this view. A receipt, completed cycle or deployed change alone does not prove
improvement. Assessment requires an applied version, a comparison window and an
independent reviewer. An unknown result is not a success percentage.
