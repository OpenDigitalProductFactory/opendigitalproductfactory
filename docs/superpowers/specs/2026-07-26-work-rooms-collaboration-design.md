# Work Rooms: Outcome-Bound Collaboration Over Governed Work Cases

Date: 2026-07-26

Status: Proposed design; operator direction accepted, implementation pending

Epic: EP-2984B02B

Umbrella backlog item: BI-29BF297B

Work Capsule: WC-7FA22391

Implementation plan: `docs/superpowers/plans/2026-07-26-work-rooms-collaboration.md`

## 1. Decision

DPF will introduce **Work Room** as the friendly, user-facing collaboration experience for a governed **Work Case**.

A Work Room is an active place where authorized people and AI coworkers work toward an explicit outcome. It is not a new canonical work object, chat product, message store, identity system, or authorization model. It is a typed projection over DPF's existing Work Case, WorkItem, WorkCapsule, TaskRun, AgentThread, DecisionInteraction, Principal, AuthorityBinding, communication, context, presence, and receipt substrate.

The first implementation will converge the existing `/workspace/cases/[caseKey]` route. It will not create a parallel `/workspace/rooms` home, a new global navigation item, or a `WorkRoom` Prisma model.

This preserves the architectural distinction:

- **Work Case** is the governed, durable company work record.
- **Work Room** is the active collaboration experience around that record.
- **Conversation** is source material inside the room.
- **Outcome Packet** is the structured result of a room or bounded work cycle.
- **Work Capsule** is a durable execution segment attached to the work.

## 2. Why this exists

DPF already has the underlying work-management concepts, but the current Work Case detail surface reads as a case inspector: status, assignment, evidence, source references, and comments. It does not yet feel like a place where employees and AI coworkers are visibly doing work together.

Free-form chat is too weak a boundary. A case-administration screen is too passive. A broad workspace is too general. Work Room supplies the missing experiential layer:

- a clear purpose and outcome;
- an explicit participation, authority, sensitivity, and context boundary;
- visible human and AI coworker activity;
- finite work or continuous work organized into bounded cycles;
- durable decisions, artifacts, actions, evidence, and unresolved work;
- one canonical room even when interaction arrives through DPF, mobile, Teams, Slack, email, or another channel.

## 3. Product vocabulary

| Term | User meaning | Canonical implementation meaning |
| --- | --- | --- |
| Workspace | A broad, long-lived area where a person sees and enters company work | Existing `/workspace` area and its attention/work lenses |
| Work Room | A focused active place where authorized participants collaborate toward an outcome | Presentation/read-model projection over one Work Case |
| Work Case | The durable governed company work record | Existing Work Case projection and policy envelope |
| Conversation | Human/AI communication that helps work progress | `WorkItemMessage`, `AgentMessage`, `TaskMessage`, or normalized channel event |
| Work Cycle | A bounded episode of work inside a standing room | Projection over a child `WorkItem`, `WorkCapsule`, and/or `TaskRun`, selected by the source registry |
| Outcome Packet | The structured result at cycle or room completion | Projection over case state, decisions, artifacts, actions, receipts, evidence, unresolved work, and carry-over |
| Work Capsule | A scoped execution segment | Existing `WorkCapsule`; never renamed to room |

User-facing copy should prefer **Work Room**, **room**, **current cycle**, **outcome**, **participants**, **activity**, and **next action**. Diagnostic and audit surfaces may expose Work Case, Work Capsule, TaskRun, source references, and A2A status.

## 4. Research and benchmarking

### 4.1 Block Buzz

Buzz describes a self-hostable workspace where humans and agents share rooms, and every message, reaction, workflow step, approval, and git event enters one signed event log. Agents are members with their own identity and channel membership, and a branch can become a room containing patches, CI, review, and the merge decision.

Adopt:

- humans and AI agents appear as peers in the participant experience;
- one focused room holds the activity and evidence for one collaboration context;
- room creation is lightweight and has an explicit name, description, and privacy boundary;
- activity is searchable and attributable;
- an external event can enter the room without changing the room's identity.

Do not adopt:

- a single event log as the canonical representation of every business object;
- chat history as the durable outcome record;
- key/channel membership as a substitute for DPF's Principal, authority, sponsor, sensitivity, and policy intersections;
- a shell-capable agent trust model for ordinary company work.

Sources: [Buzz repository](https://github.com/block/buzz), [agent vision](https://github.com/block/buzz/blob/main/VISION_AGENT.md), [project/forge vision](https://github.com/block/buzz/blob/main/VISION_PROJECTS.md), [security model](https://github.com/block/buzz/blob/main/SECURITY.md).

### 4.2 Zulip

Zulip uses channels for audience boundaries and topics for focused conversations. It explicitly recommends topics rather than creating a separate channel for every project, and its conversation links remain stable through rename, move, or resolution.

Adopt:

- separate the durable audience boundary from the bounded work episode;
- make room and cycle links stable;
- let people follow or attend to the focused work without subscribing to every broad area;
- support resolve/archive semantics without breaking references.

Reject:

- treating a topic's message stream as sufficient work state.

Sources: [Zulip channels](https://zulip.com/help/introduction-to-channels), [permanent conversation links](https://zulip.com/help/link-to-a-message-or-conversation).

### 4.3 Slack

Slack channels organize communication, while canvases hold information that needs more structure than a message. Slack's 2025 move from special channel canvases to ordinary canvases attached as tabs is a useful convergence lesson: the structured artifact should remain independently governed and attach to the conversation rather than become a bespoke duplicate.

Adopt:

- attach durable outcome/context artifacts to the room;
- keep activity updates in the conversation while preserving an independently inspectable structured artifact;
- use permissions and default-view choices intentionally.

Reject:

- making the channel or canvas the authority for DPF work state.

Sources: [Slack channels](https://slack.com/help/articles/1500000019361-Keep-work-organized-with-channels), [Slack canvases](https://slack.com/help/articles/203950418-Use-a-canvas-in-Slack), [channel canvas convergence](https://slack.com/help/articles/21290478840979-Feature-change-notice--Channel-canvases).

### 4.4 Microsoft Teams and Loop

Teams channel pages and Loop components allow people with channel access to co-edit shared material. Loop components stay synchronized across Teams, Outlook, OneNote, and other surfaces, while access still follows the containing collaboration context.

Adopt:

- one canonical outcome artifact may be projected or embedded across channels;
- channel interaction should deep-link to the same DPF room;
- sensitivity and access remain visible at the collaboration boundary.

Reject:

- assuming channel membership alone is sufficient authority for consequential action;
- creating provider-specific copies of the room.

Sources: [Loop in Teams channels](https://support.microsoft.com/en-US/teams/teams-channels/manage-pages-and-loop-components-in-channels), [Loop components](https://support.microsoft.com/en-us/loop/get-to-know-loop-components), [Loop workspaces](https://support.microsoft.com/en-us/loop/get-started-with-microsoft-loop).

## 5. Architectural fit

The governing principles are:

- `principles/one-data-model`: Work Room cannot compete with Work Case.
- `principles/principal-convergence`: every person, coworker, service, and external identity resolves through `Principal` and `PrincipalAlias`.
- `principles/selective-memory-not-total-recall`: durable state contains salient structured knowledge, not raw transcripts.
- `principles/structured-handoffs-not-conversation-history`: completed work emits a structured handoff/outcome packet.
- `principles/research-and-use-standards` and `principles/design-research-required`: benchmark actual systems and cite the adopted pattern.

The design extends these accepted DPF specifications:

- `2026-06-27-work-management-architecture-design.md`
- `2026-06-04-multi-agent-collaboration-visibility-design.md`
- `2026-05-15-employee-communication-fabric-design.md`
- `2026-05-17-portal-context-overlay-hive-mind-work-surface-design.md`
- `2026-06-29-layer-scoped-work-capsules-design.md`

### 5.1 Substrate verification ledger

| Need | Existing source of truth | Work Room use |
| --- | --- | --- |
| Work identity and state | Work Case projection over `WorkItem` and source registry | Room identity, state, attention, next action |
| Human/AI identity | `Principal`, `PrincipalAlias`, `User`, `Agent` | Participant identity and display |
| Accountability | `Principal.sponsorPrincipalId`, `authorityMode`, Work Case accountability | Accountable person and coworker sponsor |
| Authority and sensitivity | `AuthorityBinding`, grants, Work Case policy envelope | Admission, visible fields, allowed actions |
| Presence | `WorkItemPresence` | Active-now participant projection; never authority |
| Human work communication | `WorkItemMessage` | Room activity source |
| Coworker communication and lineage | `AgentThread`, `AgentMessage`, parent threads | Visible coworker collaboration |
| Execution | `TaskRun`, `WorkCapsule` | Current work and cycle execution |
| Context | `PortalContextEnvelope`, source references | Compact server-resolved room context |
| Decisions | `DecisionInteraction` | Durable decision references |
| Evidence and audit | `ReceiptEnvelope`, runtime verification, external evidence | Timeline and outcome proof |
| External channels | `CommunicationChannelBinding`, `CommunicationChannelSession`, delivery attempts | Transport continuity and deep links |

**Verdict:** the substrate exists. Work Room is an extension and convergence effort. A new table, enum, or event store is not justified for the first slice.

## 6. The Work Room contract

The initial contract is a pure TypeScript read model under `apps/web/lib/work-management/`. Names below are conceptual; implementation may refine them while preserving the invariants.

```ts
type WorkRoomMode = "finite" | "standing";

interface WorkRoomView {
  roomKey: string;            // stable Work Case key
  caseRef: WorkCaseRef;
  title: string;
  purpose: string;
  mode: WorkRoomMode;
  state: WorkCaseState;
  outcome: WorkRoomOutcomeView;
  boundary: WorkRoomBoundaryView;
  currentCycle: WorkRoomCycleView | null;
  participants: WorkRoomParticipantView[];
  activity: WorkRoomActivityView[];
  work: WorkRoomWorkView;
  context: WorkRoomContextView;
  receipts: ReceiptEnvelope[];
  sourceRefs: WorkCaseSourceRef[];
}
```

`WorkRoomMode` is a projection vocabulary, not a new database string enum. The source registry derives it from the backing work type or typed configuration. Unknown or incomplete source data produces an explicit `boundary.incomplete` signal rather than a guessed mode.

Every visible field must carry or be traceable to a source reference. The browser cannot invent audit facts.

## 7. Demarcation: the room boundary

A room is valid only when its boundary is understandable. The boundary contains:

1. **Purpose:** why this room exists.
2. **Outcome:** the result or ongoing condition the room is responsible for.
3. **Scope:** included and explicitly excluded work.
4. **Participants:** admitted principals, their roles, and why they are present.
5. **Accountability:** one accountable human or role; AI coworkers retain named sponsorship.
6. **Authority:** permitted action classes and approval requirements.
7. **Sensitivity:** classification ceiling, redaction behavior, and channel eligibility.
8. **Context:** bounded source records, documents, decisions, and memory references.
9. **Measures:** finite success criteria or standing health measures.
10. **Time boundary:** due/stop condition for finite rooms; cadence and review date for standing rooms.
11. **Closure rule:** close, renew, split, archive, or carry over.

The room header shows a compact boundary summary. Full policy and source references stay behind progressive disclosure.

### 7.1 Admission and discovery

- A user who lacks discover permission must not learn that the room exists.
- A user with discover but not content permission may see a redacted existence/owner/status projection only when policy explicitly allows it.
- A user with room access sees only fields allowed by the policy envelope and source-specific authorization.
- Presence does not grant access.
- A channel session does not grant authority.
- Assignment does not automatically grant access to source records outside the room's authorized context.

Effective action authority is the intersection of principal authority, room/case policy, source-record policy, route/tool grant, channel policy, sensitivity, and any step-up requirement.

## 8. Finite and standing rooms

### 8.1 Finite room

A finite room exists to achieve one bounded outcome. It uses the Work Case lifecycle and closes when the result is reviewed and the outcome packet is complete.

Examples:

- resolve a customer complaint;
- decide a vendor exception;
- deliver a feature;
- investigate an incident;
- approve a policy change.

### 8.2 Standing room

A standing room owns an ongoing operational responsibility. It does not run as one endless conversation. It contains bounded **work cycles**.

Examples:

- weekly cash-position review;
- continuous service reliability;
- launch readiness;
- inventory exceptions;
- regulatory watch;
- customer renewal health.

A standing room has a persistent charter:

- purpose and ongoing outcome;
- accountable principal;
- admitted roles and authority;
- sensitivity ceiling;
- cadence and review date;
- health measures;
- renewal, split, and archive rules.

It must also have either one current cycle or an explicit idle/healthy state. "Active forever" is invalid.

### 8.3 Work cycle

Every active cycle contains:

- trigger;
- objective;
- accountable principal;
- opened-at and expected review/stop point;
- scoped context references;
- stop conditions;
- success or health measure;
- linked WorkItem/WorkCapsule/TaskRun;
- outcome packet;
- carry-over decision.

The first implementation should project a cycle from existing child `WorkItem`, `WorkCapsule`, or `TaskRun` records according to source-registry rules. A persistent cycle model is allowed only after an implementation slice proves a named invariant cannot be enforced with these records.

## 9. Outcome Packet

Conversation is not completion. Closing a finite room or a standing-room cycle produces a structured Outcome Packet:

```ts
interface WorkRoomOutcomePacket {
  outcomeState: "achieved" | "partially-achieved" | "not-achieved" | "cancelled";
  summary: string;
  decisionRefs: WorkCaseSourceRef[];
  artifactRefs: WorkCaseSourceRef[];
  actionRefs: WorkCaseSourceRef[];
  receiptRefs: WorkCaseSourceRef[];
  evidenceRefs: WorkCaseSourceRef[];
  unresolvedWork: Array<{
    summary: string;
    ownerRef: string | null;
    disposition: "carry-over" | "new-case" | "deferred" | "accepted";
  }>;
  accountablePrincipalRef: string;
  verifiedByRef: string | null;
  completedAt: string;
  nextReviewAt: string | null;
}
```

This is initially a typed projection and receipt output. Persist it only through an existing canonical artifact/evidence/activity seam unless ordering, sealing, retention, or cross-source reconstruction cannot be guaranteed.

The transcript remains replayable source material under context and retention policy. It is never silently promoted wholesale into the Outcome Packet or long-term memory.

## 10. Participation model

Participants are projected from assignment, presence, coworker collaboration, TaskRun lineage, and authority:

| Participant state | Meaning |
| --- | --- |
| Accountable | Human or role accountable for the room outcome |
| Working | Human or AI principal currently executing bounded work |
| Contributing | Participant providing input or artifacts |
| Reviewing | Participant verifying or approving an outcome |
| Waiting | Participant has an outstanding ask |
| Observing | Read-only participant allowed to follow |

Each participant row may show:

- display name and human/AI/system kind;
- room role;
- active/idle/away derived from `WorkItemPresence` recency;
- current work summary from TaskRun/capsule state;
- why the participant entered;
- sponsor for AI coworkers;
- authority summary such as "can propose", "can act with approval", or "read only".

Participant presence is quiet by default. The rail expands when there are multiple participants, an active coworker handoff, a pending ask, or an access issue. Humans do not select and task secondary AI coworkers from this rail; the active coworker coordinates peers and the UI shows that collaboration.

## 11. UX and information architecture

### 11.1 UX fit decision

**Decision: fits-with-guardrails.**

- **Owning area:** Workspace.
- **Route family:** `/workspace/my-queue` and `/workspace/cases/[caseKey]`.
- **Primary persona:** founder/operator or employee coordinating sensitive work with colleagues and AI coworkers.
- **Navigation layer:** local page structure and contextual actions only.
- **Reuse/convergence:** refactor `WorkCaseDetailView`, `workspace-case-loader`, Work Case presenters, `StatusBadge`, report-kit, WorkItem comments, participant projection, and portal context primitives.
- **Source truth:** Work Case read model plus the canonical sources in §5.1.
- **AI boundary:** informational controls do not start work; actions that start coworker work require preview, context summary, expected next step, and confirmation.

### 11.2 First viewport

The first viewport answers four questions:

1. What outcome does this room own?
2. What needs attention now?
3. Who is accountable and who is working?
4. What is the next governed action?

It contains:

- back link to **My Work**;
- Work Room title, state, mode, sensitivity, and source label;
- outcome statement or health condition;
- current cycle summary for standing rooms;
- accountable participant and compact participant presence;
- next action and blocking reason;
- due/review date.

Internal A2A status and raw source IDs move out of the primary header into diagnostics.

### 11.3 Room body

Desktop target:

- center: activity stream with typed events and conversation;
- right contextual panel: Participants, Context, Work, Decisions, Outcome;
- outcome/next-action strip remains visible without turning the page into a dashboard.

Narrow target:

- one column;
- outcome and next action first;
- participants as a compact expandable row;
- panels become accessible disclosure sections;
- composer remains reachable without obscuring outcome state.

The page uses existing `--dpf-*` theme variables and report-kit primitives. No hardcoded colors or new card dialect.

### 11.4 Activity grammar

The activity stream distinguishes:

- message;
- ask/input required;
- coworker joined/left/handoff;
- work started/paused/completed;
- decision proposed/resolved;
- artifact added;
- governed action;
- observed external event;
- verification/receipt;
- cycle opened/closed/carried over.

Messages are visually quieter than decisions, actions, artifacts, and outcome transitions. The room cannot imply that message volume equals progress.

### 11.5 Empty, failure, and permission states

| State | Required behavior |
| --- | --- |
| Boundary incomplete | Show missing purpose/outcome/accountable owner with one authorized repair action |
| No activity | Explain the room is ready and show the next governed action |
| No current cycle in standing room | Show healthy-idle or "open next cycle"; never a blank transcript |
| No participants beyond owner | Show owner and explain how coworkers/people enter through assignment or governed work |
| Permission denied | Do not expose title, participants, source refs, or sensitivity details |
| Source unavailable | Show an honest partial projection with source-health signal and recovery |
| Provider/channel unavailable | Keep DPF room usable; show delivery degradation and retry/fallback evidence |
| Coworker unavailable | Preserve context and offer approved fallback or reassignment |
| Unresolved external identity | Quarantine the event and give an operator identity-resolution path |

## 12. Channel continuity

DPF owns the room. External clients are adapters.

Flow:

1. Adapter authenticates and normalizes an inbound event.
2. `PrincipalAlias` resolves the sender.
3. `CommunicationChannelSession` resolves transport context.
4. The dispatcher attaches the event to the canonical Work Case/WorkItem/TaskRun context.
5. Policy resolves visibility, authority, sensitivity, step-up, and allowed response.
6. The event appears in room activity as an observed channel event or governed action.
7. Delivery and action receipts return to the same room.

An external conversation may span multiple TaskRuns. The channel session points to the most recent active run while the Work Case remains the durable room anchor.

Teams, Slack, email, mobile, and future adapters may show concise room summaries and action cards, but:

- they do not copy the Work Room into provider-specific canonical state;
- they deep-link to the same DPF room for full context;
- sensitive actions use `auth-required`/step-up;
- provider-specific capability gaps return explicit unsupported status;
- replay and duplicate delivery are idempotent;
- channel delivery receipts prove transport, not authorization.

Provider implementation continues under the Employee Communication Fabric. The Work Room slice owns only the canonical attachment/projection contract.

## 13. Governed actions

Consequential room operations route through the existing Work Case action registry and policy envelope:

- claim;
- request input or authorization;
- respond/resume;
- propose/decide;
- delegate/handoff;
- verify/complete/cancel;
- open/complete/carry over a cycle;
- renew/split/archive a standing room.

Cycle-specific verbs should first be expressed as registered Work Case actions or typed action metadata. Do not add a new DB enum. Each consequential action enforces the current boundary and emits a receipt. Raw source changes appear as observed events and are labeled as such.

## 14. Security and privacy

- Enforce object-level authorization server-side before loading the room.
- Use Principal/PrincipalAlias for every identity-bearing participant or external sender.
- Intersect authority; never union grants across participant, agent, route, tool, and channel scopes.
- Keep sponsor/accountable-human visibility for AI work.
- Apply sensitivity before context assembly, rendering, notification, export, and external delivery.
- Redact or omit unauthorized activity rather than reveal it through counts, titles, participant names, or search.
- Treat inbound channel text and attachments as untrusted.
- Keep prompt digests compact and ephemeral; retain stable source references for audit.
- Preserve terminal sealing for finite rooms and completed cycles.

## 15. Metrics and observability

Measure whether rooms produce outcomes, not chatter:

- time from room open to first accountable action;
- time blocked by person/system/authorization/decision;
- cycle lead time and outcome rate;
- carry-over rate and age;
- percentage of closed cycles with complete Outcome Packets;
- participant handoff latency;
- coworker action approval/denial/failure rate;
- channel delivery and step-up success rate;
- unauthorized/redacted access decisions;
- projection confidence and incomplete-boundary rate.

Room events and receipts retain OpenTelemetry-compatible trace references. Raw trajectories remain drill-down evidence, not headline metrics.

## 16. Refactoring commitment

At least 20 percent of implementation capacity is reserved for convergence:

- extend `WorkCaseDetail`/presenters instead of adding a parallel room loader stack;
- separate DB loading, projection, and rendering;
- reuse participant and context projections;
- move raw A2A/source fields out of primary UX;
- centralize activity-event presentation metadata;
- retire duplicated status, label, and source formatting encountered in the slice;
- keep channel/provider logic behind the existing communication adapter contract.

The refactor budget is measured in the plan and PR evidence, not treated as optional cleanup.

## 17. Non-goals

- Replacing Work Case, WorkItem, WorkCapsule, TaskRun, or AgentThread.
- Building a general-purpose Slack/Teams clone.
- Creating a `WorkRoom` table in the first implementation.
- Creating one room for every chat or every automated task.
- Exposing raw internal agent reasoning as room content.
- Allowing humans to manually orchestrate secondary coworkers from the participant rail.
- Shipping new Teams/Slack provider capabilities in the first Work Room PR.
- Adding a global navigation item before live UX evidence proves a distinct room index is needed.

## 18. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Friendly naming hides governance | Keep Work Case diagnostics and source attribution behind disclosure; make boundary and receipts visible |
| Room becomes another dashboard | One canonical detail route, outcome-first viewport, local disclosure only |
| Continuous room becomes endless chat | Require bounded cycles and renewal/archive review |
| Duplicate data model | Projection-first rule and named invariant gate before persistence |
| Presence is mistaken for authority | Separate presence, participation, assignment, and authorization in types and copy |
| AI coworker appears ambient or magical | Show identity, sponsor, reason, work summary, authority, and receipts |
| External channel leaks sensitive context | Sensitivity-aware dispatch, compact summaries, step-up, and DPF deep links |
| Message volume overwhelms outcome | Typed event hierarchy and separate Outcome panel/packet |
| Existing Work Case UX regresses | Characterization tests before refactor plus live route verification |

## 19. Acceptance criteria

The design is implemented when:

1. `WorkRoomView` is a typed, source-attributed projection over existing Work Case substrate.
2. `/workspace/cases/[caseKey]` presents the Work Room experience without a duplicate route home.
3. The first viewport communicates outcome, attention, accountability, participation, and next action.
4. Finite and standing rooms share one contract; standing work uses bounded cycles.
5. Closure produces a structured Outcome Packet.
6. Humans and AI coworkers are visible governed participants.
7. Unauthorized users cannot discover or infer protected room data.
8. External channel events attach to the same canonical room through communication adapters.
9. Conversation remains source material; decisions, artifacts, actions, evidence, and outcomes remain structured.
10. UI, accessibility, failure-state, and live-route evidence pass the implementation plan's completion gate.
11. At least 20 percent of implementation effort demonstrably converges existing Work Case/component seams.

## 20. Architecture review (advisory)

- **Alignment summary:** well aligned with the Work Case projection architecture, with guardrails.
- **Important:** persistent room/cycle fields could become a second work model. **Edit adopted:** projection-first contract and named-invariant gate before any migration.
- **Important:** room membership could bypass principal authority. **Edit adopted:** participation, presence, assignment, access, and action authority are separate projections; authority is intersected server-side.
- **Important:** an external channel could become a second source of truth. **Edit adopted:** channel sessions are transport context attached to the canonical Work Case/TaskRun, with DPF deep links and receipts.
- **Minor:** Work Room could add a second Workspace navigation family. **Edit adopted:** reuse `/workspace/cases/[caseKey]`; no global or section navigation change in phase 1.
- **Standards researched:** Buzz, Zulip, Slack, Microsoft Teams/Loop, A2A alignment already adopted by the Work Case architecture, and DPF kernel principles named in §5.
- **Escalated decisions:** none. The operator selected the projection approach and the existing substrate removes the remaining architectural fork.
