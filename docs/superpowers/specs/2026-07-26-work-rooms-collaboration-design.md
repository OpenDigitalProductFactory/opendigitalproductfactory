# Work Rooms: Outcome-Bound Collaboration Over Governed Work Cases

| Field | Value |
| --- | --- |
| Date | 2026-07-26 |
| Status | Accepted; review-hardened 2026-07-27; projection contract implemented in PR #3659 |
| Epic | EP-2984B02B |
| Umbrella backlog item | BI-29BF297B |
| Work Capsule | WC-7FA22391 |
| Parent architecture | [`2026-06-27-work-management-architecture-design.md`](2026-06-27-work-management-architecture-design.md) |
| Implementation plan | [`docs/superpowers/plans/2026-07-26-work-rooms-collaboration.md`](../plans/2026-07-26-work-rooms-collaboration.md) |
| Slice BIs | BI-ADDF27FE · BI-32E26F62 · BI-BA868848 · BI-B49FA786 |

## Summary

DPF will introduce **Work Room** as the friendly, user-facing collaboration experience for a governed **Work Case**. A Work Room is an active place where authorized people and AI coworkers work toward an explicit outcome inside a visible boundary. It is not a new canonical work object, chat product, message store, identity system, or authorization model. It is a typed projection over DPF's existing Work Case, WorkItem, WorkCapsule, TaskRun, AgentThread, DecisionInteraction, Principal, AuthorityBinding, communication, context, presence, and receipt substrate.

The first implementation converges the existing `/workspace/cases/[caseKey]` route. It does not create a parallel `/workspace/rooms` home, a new global navigation item, a `WorkRoom` Prisma model, or a customer-portal Work Room clone.

This preserves the architectural distinction:

| Concept | Role |
| --- | --- |
| **Work Case** | Governed, durable company work record |
| **Work Room** | Active collaboration experience around that record |
| **Conversation** | Source material inside the room |
| **Outcome Packet** | Structured result of a room or bounded work cycle |
| **Work Capsule** | Durable execution segment attached to the work |

## Contents

1. [Decision](#1-decision)
2. [Why this exists](#2-why-this-exists)
3. [Product vocabulary](#3-product-vocabulary)
4. [Research and benchmarking](#4-research-and-benchmarking)
5. [Architectural fit](#5-architectural-fit)
6. [The Work Room contract](#6-the-work-room-contract)
7. [Demarcation: the room boundary](#7-demarcation-the-room-boundary)
8. [Finite and standing rooms](#8-finite-and-standing-rooms)
9. [Outcome Packet](#9-outcome-packet)
10. [Participation model](#10-participation-model)
11. [UX and information architecture](#11-ux-and-information-architecture)
12. [Channel continuity](#12-channel-continuity)
13. [Governed actions](#13-governed-actions)
14. [Security and privacy](#14-security-and-privacy)
15. [Metrics and observability](#15-metrics-and-observability)
16. [Refactoring commitment](#16-refactoring-commitment)
17. [Surface and portal demarcation](#17-surface-and-portal-demarcation)
18. [Non-goals](#18-non-goals)
19. [Risks and mitigations](#19-risks-and-mitigations)
20. [Acceptance criteria](#20-acceptance-criteria)
21. [Open questions and deferred decisions](#21-open-questions-and-deferred-decisions)
22. [Architecture review (advisory)](#22-architecture-review-advisory)

## 1. Decision

**Adopt Work Room as a presentation / read-model projection over Work Case**, not a second work engine.

Operator-accepted constraints for the first program:

1. Reuse `/workspace/cases/[caseKey]` as the canonical room URL (`roomKey === caseKey`).
2. Projection-first: no `WorkRoom` table, no new DB string enum for room mode, no parallel loader stack under `apps/web/lib/work-rooms/`.
3. Outcome-bound collaboration: conversation is never completion.
4. Standing work uses bounded **work cycles**; "active forever" is invalid.
5. Humans and AI coworkers appear as governed peers; humans do not manually orchestrate secondary coworkers from a participant rail.
6. External channels (Teams, Slack, email, mobile) are adapters that attach to the same room; DPF remains system of record.

Implementation is sequenced in four independently shippable BIs (see plan §2):

| BI | Deliverable |
| --- | --- |
| BI-ADDF27FE | Projection contract and Work Case convergence |
| BI-32E26F62 | Outcome-first Workspace room UX |
| BI-BA868848 | Standing cycles and Outcome Packets |
| BI-B49FA786 | Participation, access, and channel continuity |

## 2. Why this exists

DPF already has the underlying work-management concepts (parent architecture Waves 0–6), but the current Work Case detail surface reads as a case inspector: status, assignment, evidence, source references, and comments. It does not yet feel like a place where employees and AI coworkers are visibly doing work together.

Free-form chat is too weak a boundary. A case-administration screen is too passive. A broad workspace is too general. Work Room supplies the missing experiential layer:

- a clear purpose and outcome;
- an explicit participation, authority, sensitivity, and context boundary;
- visible human and AI coworker activity;
- finite work or continuous work organized into bounded cycles;
- durable decisions, artifacts, actions, evidence, and unresolved work;
- one canonical room even when interaction arrives through DPF, mobile, Teams, Slack, email, or another channel.

**Problem statement for implementers:** operators open `/workspace/cases/[caseKey]` and cannot answer, in the first viewport, (1) what outcome this owns, (2) what needs attention now, (3) who is accountable and working, and (4) what the next governed action is — without scanning diagnostic fields (raw A2A status, source IDs).

## 3. Product vocabulary

| Term | User meaning | Canonical implementation meaning |
| --- | --- | --- |
| Workspace | A broad, long-lived area where a person sees and enters company work | Existing `/workspace` area and its attention/work lenses |
| My Work | The person's attention surface into rooms that need them | `/workspace/my-queue` (`WorkCaseAttentionLens`) |
| Work Room | A focused active place where authorized participants collaborate toward an outcome | Presentation/read-model projection over one Work Case |
| Work Case | The durable governed company work record | Existing Work Case projection and policy envelope |
| Conversation | Human/AI communication that helps work progress | `WorkItemMessage`, `AgentMessage`, `TaskMessage`, or normalized channel event |
| Work Cycle | A bounded episode of work inside a standing room | Projection over a child `WorkItem`, `WorkCapsule`, and/or `TaskRun`, selected by the source registry |
| Outcome Packet | The structured result at cycle or room completion | Projection over case state, decisions, artifacts, actions, receipts, evidence, unresolved work, and carry-over |
| Work Capsule | A scoped execution segment | Existing `WorkCapsule`; never renamed to room |

User-facing copy should prefer **Work Room**, **room**, **current cycle**, **outcome**, **participants**, **activity**, and **next action**. Diagnostic and audit surfaces may expose Work Case, Work Capsule, TaskRun, source references, and A2A status.

**Copy invariant:** the detail route back-link becomes **My Work** (not "Work Cases"). Attention-lens rows may say "Open room" while preserving the same `caseKey` URL.

## 4. Research and benchmarking

Design research follows `principles/research-and-use-standards` and `principles/design-research-required`: compare real systems, adopt concrete patterns, reject patterns that would fork DPF's substrate.

### 4.1 Block Buzz (open source)

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

### 4.2 Zulip (open source)

Zulip uses channels for audience boundaries and topics for focused conversations. It explicitly recommends topics rather than creating a separate channel for every project, and its conversation links remain stable through rename, move, or resolution.

Adopt:

- separate the durable audience boundary from the bounded work episode;
- make room and cycle links stable;
- let people follow or attend to the focused work without subscribing to every broad area;
- support resolve/archive semantics without breaking references.

Reject:

- treating a topic's message stream as sufficient work state.

Sources: [Zulip channels](https://zulip.com/help/introduction-to-channels), [permanent conversation links](https://zulip.com/help/link-to-a-message-or-conversation).

### 4.3 Slack (commercial)

Slack channels organize communication, while canvases hold information that needs more structure than a message. Slack's 2025 move from special channel canvases to ordinary canvases attached as tabs is a useful convergence lesson: the structured artifact should remain independently governed and attach to the conversation rather than become a bespoke duplicate.

Adopt:

- attach durable outcome/context artifacts to the room;
- keep activity updates in the conversation while preserving an independently inspectable structured artifact;
- use permissions and default-view choices intentionally.

Reject:

- making the channel or canvas the authority for DPF work state.

Sources: [Slack channels](https://slack.com/help/articles/1500000019361-Keep-work-organized-with-channels), [Slack canvases](https://slack.com/help/articles/203950418-Use-a-canvas-in-Slack), [channel canvas convergence](https://slack.com/help/articles/21290478840979-Feature-change-notice--Channel-canvases).

### 4.4 Microsoft Teams and Loop (commercial)

Teams channel pages and Loop components allow people with channel access to co-edit shared material. Loop components stay synchronized across Teams, Outlook, OneNote, and other surfaces, while access still follows the containing collaboration context.

Adopt:

- one canonical outcome artifact may be projected or embedded across channels;
- channel interaction should deep-link to the same DPF room;
- sensitivity and access remain visible at the collaboration boundary.

Reject:

- assuming channel membership alone is sufficient authority for consequential action;
- creating provider-specific copies of the room.

Sources: [Loop in Teams channels](https://support.microsoft.com/en-US/teams/teams-channels/manage-pages-and-loop-components-in-channels), [Loop components](https://support.microsoft.com/en-us/loop/get-to-know-loop-components), [Loop workspaces](https://support.microsoft.com/en-us/loop/get-started-with-microsoft-loop).

### 4.5 Linear Agents (commercial; collaboration with AI members)

Linear treats agents as native app users that can be mentioned or delegated to, expose session state, and remain visible to humans, while final accountability stays human. Its agent APIs are currently a Developer Preview, so DPF adopts the interaction pattern rather than depending on API stability. Parent Work Case architecture already adopts Linear's agent-as-delegate pattern.

Adopt for Work Room UX:

- AI participants appear as named members with visible session/work state;
- delegation is an explicit action with retained human accountability;
- agent activity is visible in the same stream as human activity, not a hidden side console.

Reject:

- equating "agent is a user in the tool" with "agent has unbounded authority";
- making the agent chat the system of record.

Sources: [Linear Agents](https://linear.app/developers/agents), [Agent Interaction](https://linear.app/developers/agent-interaction).

### 4.6 A2A task vocabulary (standard; already adopted by Work Case)

A2A separates `Message` (communication turn) from `Artifact` (deliverable), and uses durable task lifecycle states including `input-required` and `auth-required`. Work Room presentation must preserve that separation visually: messages are quieter than decisions, artifacts, governed actions, and outcome transitions.

Sources: [A2A specification](https://a2a-protocol.org/latest/specification/), parent Work Case architecture §Research.

### 4.7 Patterns adopted vs rejected (rollup)

| Pattern | Source | Disposition |
| --- | --- | --- |
| Humans + agents as peer participants | Buzz, Linear | Adopt |
| Stable room/cycle deep links | Zulip | Adopt |
| Structured artifact attached to conversation | Slack canvas, Teams Loop | Adopt |
| Channel as adapter, not SoR | Teams, Employee Communication Fabric | Adopt |
| Message vs artifact separation | A2A | Adopt |
| Event log as sole business object store | Buzz | Reject |
| Channel membership as authority | Slack/Teams default | Reject |
| Topic stream as complete work state | Zulip misuse | Reject |
| Provider-local room clone | Teams/Slack | Reject |

## 5. Architectural fit

### 5.1 Governing principles

- `principles/one-data-model`: Work Room cannot compete with Work Case.
- `principles/principal-convergence`: every person, coworker, service, and external identity resolves through `Principal` and `PrincipalAlias`.
- `principles/selective-memory-not-total-recall`: durable state contains salient structured knowledge, not raw transcripts.
- `principles/structured-handoffs-not-conversation-history`: completed work emits a structured handoff/outcome packet.
- `principles/research-and-use-standards` and `principles/design-research-required`: benchmark actual systems and cite the adopted pattern.
- `principles/consult-specs-first` / ground new work in existing platform work: this is an experience extension of Work Case Waves 0–6, not a restart.
- `principles/verify-substrate-before-proposing-new`: substrate verification ledger in §5.3 is mandatory before any migration.

### 5.2 Specs extended (do not fork)

| Spec | What Work Room reuses |
| --- | --- |
| [`2026-06-27-work-management-architecture-design.md`](2026-06-27-work-management-architecture-design.md) | Work Case projection, policy envelope, actions, receipts, A2A alignment, sponsor accountability |
| [`2026-06-04-multi-agent-collaboration-visibility-design.md`](2026-06-04-multi-agent-collaboration-visibility-design.md) | Visible multi-coworker collaboration without ambient magic |
| [`2026-05-15-employee-communication-fabric-design.md`](2026-05-15-employee-communication-fabric-design.md) | Channel adapters, sessions, delivery receipts; Work Room owns attachment/projection only |
| [`2026-05-17-portal-context-overlay-hive-mind-work-surface-design.md`](2026-05-17-portal-context-overlay-hive-mind-work-surface-design.md) | Compact server-resolved context envelopes |
| [`2026-06-29-layer-scoped-work-capsules-design.md`](2026-06-29-layer-scoped-work-capsules-design.md) | Capsule as execution segment, not room identity |
| [`2026-06-27-governed-adaptive-playbooks-design.md`](2026-06-27-governed-adaptive-playbooks-design.md) | Method improvements bind to case actions; rooms do not invent free-form writes |

### 5.3 Substrate verification ledger

| Need | Existing source of truth | Work Room use |
| --- | --- | --- |
| Work identity and state | Work Case projection over `WorkItem` + source registry (`case-types.ts`, `case-read-model.ts`, `source-registry.ts`) | Room identity, state, attention, next action |
| Case key encoding | `workspace-case-loader` / `portal-case-loader` caseKey helpers | `roomKey === caseKey`; stable deep links |
| Human/AI identity | `Principal`, `PrincipalAlias`, `User`, `Agent` | Participant identity and display |
| Accountability | `Principal.sponsorPrincipalId`, `authorityMode`, Work Case accountability (`accountability.ts`) | Accountable person and coworker sponsor |
| Authority and sensitivity | `AuthorityBinding`, grants, Work Case policy envelope (`policy-envelope.ts`) | Admission, visible fields, allowed actions |
| Presence | `WorkItemPresence` | Active-now participant projection; never authority |
| Human work communication | `WorkItemMessage` | Room activity source |
| Coworker communication and lineage | `AgentThread`, `AgentMessage`, parent threads | Visible coworker collaboration |
| Execution | `TaskRun`, `WorkCapsule` | Current work and cycle execution |
| Context | `PortalContextEnvelope`, source references | Compact server-resolved room context |
| Decisions | `DecisionInteraction` via Decision Perspective Gate | Durable decision references (WWMD/WWWD/WSID by scope) |
| Evidence and audit | `ReceiptEnvelope`, runtime verification, external evidence | Timeline and outcome proof |
| External channels | `CommunicationChannelBinding`, `CommunicationChannelSession`, delivery attempts | Transport continuity and deep links |
| Mentions / roster | `mentions.ts`, `mention-roster.ts` | Activity grammar and addressable participants |
| Stop conditions | `stop-conditions.ts`, staged transitions | Finite closure and cycle stop criteria |
| UI primitives | `report-kit`, `--dpf-*` tokens, `WorkCaseDetailView` | Composition only; no new card dialect |

**Verdict:** the substrate exists. Work Room is an extension and convergence effort. A new table, enum, or event store is not justified for the first slice.

### 5.4 Minimum architectural alignment checklist

| Check | Result for Work Room |
| --- | --- |
| Deployment contracts | No public install-path, compose, or self-upgrade contract change. Deep-link path remains `/workspace/cases/[caseKey]`. |
| Canonical identity | Participants and accountable owners resolve via `Principal` / `PrincipalAlias`; org identity remains `Organization`. |
| No parallel utilities | Extend `apps/web/lib/work-management/*` and existing workspace components; do not create `apps/web/lib/work-rooms/`. |
| Single source of truth | Work Case + source records remain authoritative; room is projection. |
| Value-stream prioritization | Does not reorder archetype load-bearing stages; room UX is work-management chrome, not industry stage ranking. |

### 5.5 Decision scope (WWMD / WWWD / WSID)

Room-level *business* decisions (approve exception, choose vendor, accept residual risk) route through the existing **Decision Perspective Gate** against the organization's WWWD (and WSID techniques where applicable). Platform-development rooms use WWMD. Work Room never invents a parallel decision ledger; it projects `DecisionInteraction` refs into activity and Outcome Packets.

## 6. The Work Room contract

The initial contract is a pure TypeScript read model under `apps/web/lib/work-management/`. Names below are conceptual; implementation may refine them while preserving the invariants. Prefer co-located files such as `room-types.ts`, `room-read-model.ts`, `room-boundary.ts`, `room-activity.ts`, `room-cycle.ts`, `outcome-packet.ts` rather than a parallel package tree.

### 6.1 Top-level view

```ts
type WorkRoomMode = "finite" | "standing";

/** Projection vocabulary only — not a DB enum. */
type WorkRoomActivityKind =
  | "message"
  | "ask"
  | "coworker-joined"
  | "coworker-left"
  | "coworker-handoff"
  | "work-started"
  | "work-paused"
  | "work-completed"
  | "decision-proposed"
  | "decision-resolved"
  | "artifact-added"
  | "governed-action"
  | "external-event"
  | "verification"
  | "receipt"
  | "cycle-opened"
  | "cycle-closed"
  | "cycle-carried-over";

type WorkRoomParticipantRole =
  | "accountable"
  | "contributor"
  | "reviewer"
  | "observer";

type WorkRoomParticipantWorkState =
  | "working"
  | "waiting"
  | "idle"
  | "unknown";

interface WorkRoomView {
  roomKey: string;            // stable Work Case key; equals caseKey
  caseRef: WorkCaseRef;
  title: string;
  purpose: string | null;
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
  projection: {
    confidence: WorkCaseProjectionConfidence;
    incompleteBoundary: boolean;
    sourceHealth: "ok" | "partial" | "unavailable";
  };
}
```

### 6.2 Nested projection shapes (normative intent)

Implementers should not invent divergent field names without updating this contract. Exact optionality may tighten in BI-ADDF27FE tests.

```ts
interface WorkRoomBoundaryView {
  purpose: string | null;
  outcome: string | null;
  scopeIncluded: string[];
  scopeExcluded: string[];
  accountablePrincipalRef: string | null;
  admittedRoleSummary: string[];
  authoritySummary: string[];
  sensitivityCeiling: string | null;
  measures: string[];
  timeBoundary: { dueAt: string | null; reviewAt: string | null; stopConditionSummary: string | null };
  closureRuleSummary: string | null;
  gaps: Array<
    | "purpose"
    | "outcome"
    | "scope"
    | "participants"
    | "accountable"
    | "authority"
    | "sensitivity"
    | "context"
    | "measures"
    | "time-boundary"
    | "closure-rule"
  >;
  sourceRefs: WorkCaseSourceRef[];
}

interface WorkRoomCycleView {
  cycleKey: string;                 // stable projection id from carrier record
  carrierKind: "work-item" | "work-capsule" | "task-run";
  carrierId: string;
  trigger: string | null;
  objective: string | null;
  accountablePrincipalRef: string | null;
  openedAt: string | null;
  expectedReviewAt: string | null;
  stopConditions: string[];
  measureSummary: string | null;
  status: "open" | "verifying" | "closed" | "carried-over";
  outcomePacket: WorkRoomOutcomePacket | null;
  sourceRefs: WorkCaseSourceRef[];
}

interface WorkRoomParticipantView {
  principalRef: string;
  displayName: string;
  kind: "person" | "agent" | "system" | "external";
  roles: WorkRoomParticipantRole[];
  workState: WorkRoomParticipantWorkState;
  presence: "active" | "idle" | "away" | "unknown";
  currentWorkSummary: string | null;
  enteredReason: string | null;
  sponsorPrincipalRef: string | null;   // required when kind === "agent"
  authoritySummary: string;             // e.g. "can propose", "can act with approval", "read only"
  sourceRefs: WorkCaseSourceRef[];
}

interface WorkRoomActivityView {
  eventId: string;                      // stable, idempotent projection key
  kind: WorkRoomActivityKind;
  occurredAt: string;
  actorRef: WorkCaseActorRef | null;
  summary: string;
  emphasis: "quiet" | "normal" | "salient";  // messages default quiet
  sourceRef: WorkCaseSourceRef;
  channel?: { provider: string; sessionRef: string | null };
}

interface WorkRoomWorkView {
  nextAction: string;
  attentionRequired: boolean;
  attentionReason: string | null;
  blockingActorKind: WorkCaseBlockingActorKind | null;
  activeCapsuleRefs: WorkCaseSourceRef[];
  activeTaskRunSummary: string | null;
}

interface WorkRoomContextView {
  refs: WorkCaseSourceRef[];
  digest: string | null;                // compact, server-built; never raw transcript dump
  sensitivityCeiling: string | null;
}

interface WorkRoomOutcomeView {
  statement: string | null;             // finite target or standing health condition
  packet: WorkRoomOutcomePacket | null; // present when room/cycle completed
  health: "on-track" | "at-risk" | "blocked" | "idle" | "unknown" | null;
}
```

`WorkRoomMode` is a projection vocabulary, not a new database string enum. The source registry derives it (see §8.4). Unknown or incomplete source data produces explicit `boundary.gaps` and `projection.incompleteBoundary` rather than a guessed mode.

### 6.3 Invariants

1. **`roomKey === caseKey`.** Same encoding helpers as Workspace/Portal case loaders; no second keyspace.
2. **Every visible field is source-attributed.** The browser cannot invent audit facts.
3. **Messages never become decisions/artifacts/outcomes** without an explicit governed action or structured source write.
4. **Terminal sealing.** Closed/cancelled finite rooms and closed cycles reject consequential writes (aligned with Work Case terminal sealing).
5. **Activity `eventId` is idempotent.** Reprojection and duplicate channel delivery must not create duplicate activity rows for the same source event.
6. **Projection confidence is explicit.** Partial source health is honest, never silently filled.

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

- A user who lacks discover permission must not learn that the room exists (same not-found posture as protected Work Cases).
- A user with discover but not content permission may see a redacted existence/owner/status projection only when policy explicitly allows it.
- A user with room access sees only fields allowed by the policy envelope and source-specific authorization.
- Presence does not grant access.
- A channel session does not grant authority.
- Assignment does not automatically grant access to source records outside the room's authorized context.

Effective action authority is the **intersection** of principal authority, room/case policy, source-record policy, route/tool grant, channel policy, sensitivity, and any step-up requirement — never a union across scopes.

### 7.2 Boundary repair

When `boundary.gaps` is non-empty, the room stays loadable for authorized principals and offers **one** authorized repair action (e.g. set purpose, assign accountable owner). Do not block the entire surface behind a multi-field wizard unless the source type requires it.

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

It must also have either one current cycle or an explicit idle/healthy state. **"Active forever" is invalid.**

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

The first implementation projects a cycle from existing child `WorkItem`, `WorkCapsule`, or `TaskRun` records according to source-registry rules. A persistent cycle model is allowed only after an implementation slice proves a named invariant cannot be enforced with these records (plan §7 invariant gate).

### 8.4 Mode derivation rules (source registry)

Mode is derived, never free-typed by the browser.

| Signal (first match wins; order is normative intent) | Mode |
| --- | --- |
| Source registry entry declares `roomMode: "standing"` (or equivalent typed config) | `standing` |
| Source type is an ongoing operational ownership class (explicit registry allowlist) | `standing` |
| Work Case has recurring cadence / review policy fields in source config | `standing` |
| Otherwise | `finite` |

Unknown sources default to **`finite`** with `projection.confidence` lowered if purpose/outcome fields are thin. Standing mode must never be guessed from chat volume, participant count, or open duration alone.

When standing, exactly one of:

- `currentCycle != null` and cycle status is open/verifying; or
- explicit healthy-idle projection with next review date and "open next cycle" action.

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
  sourceRefs: WorkCaseSourceRef[];
}
```

This is initially a typed projection and receipt output. Persist it only through an existing canonical artifact/evidence/activity seam unless ordering, sealing, retention, or cross-source reconstruction cannot be guaranteed (plan §7 gate).

The transcript remains replayable source material under context and retention policy. It is never silently promoted wholesale into the Outcome Packet or long-term memory.

**Completeness rule:** the source registry defines which packet categories are required for each source type. A closed finite room or closed cycle with a missing required category is a product defect, not a soft warning; a category may be empty only when it is not required for that source. Tests must refuse "green" completion when decisions, artifacts, or evidence were only inferred from chat text.

## 10. Participation model

Participants are projected from assignment, presence, coworker collaboration, TaskRun lineage, and authority. Durable room roles and transient work state are separate axes: one participant may be both accountable and a reviewer while currently waiting.

| Participant role | Meaning |
| --- | --- |
| Accountable | Human or role accountable for the room outcome |
| Contributor | Participant providing input, work, or artifacts |
| Reviewer | Participant verifying or approving an outcome |
| Observer | Read-only participant allowed to follow |

Work state is independently projected as `working`, `waiting`, `idle`, or `unknown`; active/idle/away presence remains a third, non-authoritative signal.

Each participant row may show:

- display name and human/AI/system kind;
- room role;
- active/idle/away derived from `WorkItemPresence` recency;
- current work summary from TaskRun/capsule state;
- why the participant entered;
- sponsor for AI coworkers;
- authority summary such as "can propose", "can act with approval", or "read only".

Participant presence is quiet by default. The rail expands when there are multiple participants, an active coworker handoff, a pending ask, or an access issue. Humans do not select and task secondary AI coworkers from this rail; the active coworker coordinates peers and the UI shows that collaboration.

### 10.1 Composer and structured input

The room composer reuses `WorkItemCommentBox` / WorkItem message paths as the default free-text activity path. Structured consequential input (respond to ask, approve/reject, complete with packet fields, open/close cycle) uses **governed action controls** with preview and confirmation — not a multi-purpose free-text prompt that mutates case state.

Informational panel controls (expand Context, filter activity) never send prompts or start coworker work.

## 11. UX and information architecture

### 11.1 UX fit decision

**Decision: fits-with-guardrails.**

| Axis | Choice |
| --- | --- |
| Owning area | Workspace |
| Route family | `/workspace/my-queue`, `/workspace/cases/[caseKey]` |
| Primary persona | Founder/operator or employee coordinating sensitive work with colleagues and AI coworkers |
| Navigation layer | Local page structure and contextual actions only |
| Reuse/convergence | Refactor `WorkCaseDetailView`, `workspace-case-loader`, Work Case presenters, `StatusBadge`, report-kit, WorkItem comments, participant projection, portal context primitives |
| Source truth | Work Case read model plus the canonical sources in §5.3 |
| AI boundary | Informational controls do not start work; actions that start coworker work require preview, context summary, expected next step, and confirmation |

**Cognitive load:** first viewport is limited to four questions (below). Progressive disclosure owns diagnostics, full policy, raw source refs, A2A status, and dense timelines.

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

The page uses existing `--dpf-*` theme variables and report-kit primitives. No hardcoded colors or new card dialect. Native browser dialogs are prohibited; use `confirmDialog` / `alertDialog` outside React transitions.

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

### 11.6 Accessibility and responsiveness

- Semantic landmarks: `main`, labeled regions for header, activity, participants, outcome.
- Activity kinds expose accessible names (not color-only differentiation).
- Keyboard-only traversal of actions, disclosures, and composer; visible focus rings.
- Touch targets at least 44px where practical.
- No horizontal overflow on common narrow widths; participant rail collapses without trapping focus.
- Live route evidence for desktop and narrow viewports is part of BI-32E26F62 / BI-B49FA786 completion, not optional polish.

### 11.7 Freshness and presence update model

Phase 1 does **not** require a dedicated realtime fabric for the room page.

| Concern | Phase 1 approach |
| --- | --- |
| Case/room data | Server-rendered load on navigation; revalidate after governed actions |
| Presence | Existing `WorkItemPresence` heartbeat/read model; idle thresholds unchanged unless a bug is found |
| Channel events | Appear on next load/revalidate; delivery receipts prove transport when adapters write |
| Long-running coworker work | Show last known TaskRun/capsule summary; optional soft refresh control is allowed |

A later realtime/SSE slice may enhance activity streaming; it is out of scope for the four mapped BIs and must not block room ship.

### 11.8 Convergence path for `WorkCaseDetailView`

Do not leave a permanent dual UX.

1. **BI-ADDF27FE:** introduce pure `WorkRoomView` projection; keep existing detail rendering working via characterized adapters.
2. **BI-32E26F62:** replace inspector composition with room composition on the same route; rename components only when imports stay coherent (`WorkCaseDetailView` may become a thin wrapper or be retired in-tree).
3. Characterization tests from the prior detail view remain green or intentionally rewritten with a recorded behavior delta.

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
- provider-specific capability gaps return explicit unsupported status (capability flags, not silent failure);
- replay and duplicate delivery are idempotent (same `eventId` / delivery key);
- channel delivery receipts prove transport, not authorization.

Provider implementation continues under the Employee Communication Fabric. The Work Room slice owns only the canonical attachment/projection contract. New Teams/Slack provider capabilities are **not** in the first Work Room PRs.

## 13. Governed actions

Consequential room operations route through the existing Work Case action registry and policy envelope.

Existing verbs (from `WORK_CASE_ACTION_VERBS`) remain the base grammar:

`claim`, `pause`, `needs-input`, `needs-auth`, `respond`, `resume`, `propose`, `delegate`, `handoff`, `escalate`, `verify`, `complete`, `cancel`.

Room/cycle operations added as **registered actions or typed action metadata** (not a new DB enum):

- open cycle / complete cycle / carry over cycle;
- renew / split / archive standing room;
- request input or authorization (maps to `needs-input` / `needs-auth` as appropriate).

Each consequential action:

1. enforces the current boundary and policy envelope;
2. emits a `ReceiptEnvelope` (governed-action vs observed-event distinguishable);
3. revalidates the room projection after success.

Raw source changes appear as observed events and are labeled as such. Cycle-specific verbs should first be expressed as registered Work Case actions or typed action metadata.

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
- Metrics and logs must not leak redacted titles, participant identities, or sensitive summaries into broadly readable telemetry attributes.

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

Room events and receipts retain OpenTelemetry-compatible trace references via existing `case-telemetry` patterns. Raw trajectories remain drill-down evidence, not headline metrics. Metric labels use opaque ids / coarse enums in default export paths; sensitive free text stays out of metric dimensions.

## 16. Refactoring commitment

At least **20 percent** of implementation capacity is reserved for convergence (measured per BI in plan evidence, not optional cleanup):

- extend `WorkCaseDetail`/presenters instead of adding a parallel room loader stack;
- separate DB loading, projection, and rendering;
- reuse participant and context projections;
- move raw A2A/source fields out of primary UX;
- centralize activity-event presentation metadata;
- retire duplicated status, label, and source formatting encountered in the slice;
- keep channel/provider logic behind the existing communication adapter contract.

Target higher (25–30%) on BI-ADDF27FE where loader/projection separation pays the most debt.

## 17. Surface and portal demarcation

| Surface | Work Room treatment |
| --- | --- |
| `/workspace/cases/[caseKey]` | **Canonical Work Room** (this design) |
| `/workspace/my-queue` | Attention lens into rooms; copy may say "Open room"; no separate room index |
| `/portal/cases/[caseKey]` | **Customer-safe case digest only** (Wave 6). Not a Work Room. No internal participants, A2A diagnostics, coworker rail, or governed employee actions. |
| Mobile companion | Deep-link into the same Workspace room when authorized; no parallel mobile room model in phase 1 |
| External channels | Summaries + action cards + deep link; not a second room |

If a future customer-collaboration room is needed, it is a separate design that still projects from the same Work Case with a stricter public envelope — not a fork of this Workspace implementation.

## 18. Non-goals

- Replacing Work Case, WorkItem, WorkCapsule, TaskRun, or AgentThread.
- Building a general-purpose Slack/Teams clone.
- Creating a `WorkRoom` table in the first implementation.
- Creating one room for every chat or every automated task.
- Exposing raw internal agent reasoning as room content.
- Allowing humans to manually orchestrate secondary coworkers from the participant rail.
- Shipping new Teams/Slack provider capabilities in the first Work Room PR.
- Adding a global navigation item before live UX evidence proves a distinct room index is needed.
- Making `/portal/cases/*` a full Work Room.
- Requiring realtime SSE/WebSocket for phase-1 ship.
- Persisting cycles/outcome packets before the plan's invariant gate fails on projection.

## 19. Risks and mitigations

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
| Mode mis-derived as standing | Registry-driven rules only; never guess from chat volume or age |
| Portal/Workspace confusion | Explicit surface demarcation (§17); portal stays customer-safe digest |
| Dual `WorkCaseDetail` / room components rot | Convergence path (§11.8); one route, one primary composition |

## 20. Acceptance criteria

The design is implemented when:

1. `WorkRoomView` is a typed, source-attributed projection over existing Work Case substrate.
2. `/workspace/cases/[caseKey]` presents the Work Room experience without a duplicate route home; `roomKey === caseKey`.
3. The first viewport communicates outcome, attention, accountability, participation, and next action.
4. Finite and standing rooms share one contract; standing work uses bounded cycles with registry-derived mode.
5. Closure produces a structured Outcome Packet; chat text alone cannot satisfy packet fields.
6. Humans and AI coworkers are visible governed participants with sponsors for agents.
7. Unauthorized users cannot discover or infer protected room data.
8. External channel events attach to the same canonical room through communication adapters with idempotent activity ids.
9. Conversation remains source material; decisions, artifacts, actions, evidence, and outcomes remain structured.
10. UI, accessibility, failure-state, and live-route evidence pass the implementation plan's completion gate.
11. At least 20 percent of implementation effort demonstrably converges existing Work Case/component seams.
12. `/portal/cases/*` remains a constrained customer digest and does not gain employee Work Room chrome.
13. Phase 1 ships without requiring a new realtime transport.

## 21. Open questions and deferred decisions

None of these block starting BI-ADDF27FE. Resolve before or during the named slice.

| ID | Question | Default until decided | Resolve by |
| --- | --- | --- | --- |
| OQ-1 | Which source types are standing by default? | Finite unless registry opts in | BI-BA868848 + source-registry review |
| OQ-2 | Preferred cycle carrier when WorkItem, capsule, and TaskRun all exist? | Registry rule per source type; document precedence | BI-BA868848 |
| OQ-3 | Persist Outcome Packet now or project only? | Project-only until invariant gate fails | BI-BA868848 gate evidence |
| OQ-4 | Soft refresh control on room page? | Optional; not required | BI-32E26F62 UX evidence |
| OQ-5 | Attention-lens copy: "Open room" vs keep "Open case"? | Prefer "Open room" with caseKey URL | BI-32E26F62 |
| OQ-6 | Should discover-only redacted projection be enabled for any Workspace source? | Off unless policy explicitly allows | BI-B49FA786 |

## 22. Architecture review (advisory)

### 22.1 Prior review (design origin)

- **Alignment summary:** well aligned with the Work Case projection architecture, with guardrails.
- **Important:** persistent room/cycle fields could become a second work model. **Edit adopted:** projection-first contract and named-invariant gate before any migration.
- **Important:** room membership could bypass principal authority. **Edit adopted:** participation, presence, assignment, access, and action authority are separate projections; authority is intersected server-side.
- **Important:** an external channel could become a second source of truth. **Edit adopted:** channel sessions are transport context attached to the canonical Work Case/TaskRun, with DPF deep links and receipts.
- **Minor:** Work Room could add a second Workspace navigation family. **Edit adopted:** reuse `/workspace/cases/[caseKey]`; no global or section navigation change in phase 1.
- **Standards researched:** Buzz, Zulip, Slack, Microsoft Teams/Loop, A2A alignment already adopted by the Work Case architecture, and DPF kernel principles named in §5.
- **Escalated decisions:** none. The operator selected the projection approach and the existing substrate removes the remaining architectural fork.

### 22.2 Review hardening (2026-07-27)

Additional improvements folded into this revision:

| Gap found | Edit adopted |
| --- | --- |
| Nested projection types were prose-only | §6.2 normative nested interfaces |
| Participant role and work state were conflated | §6.1/§6.2 separate role, work-state, and presence axes |
| Boundary gaps omitted mandatory dimensions | §6.2 complete gap vocabulary; nullable top-level purpose |
| Mode derivation unspecified | §8.4 registry-first rules; never guess from chat volume |
| Portal case route could absorb room chrome | §17 surface demarcation; acceptance #12 |
| Linear agent-as-member pattern under-cited | §4.5 |
| Activity idempotency implicit only | `eventId` invariant in §6.3 and §12 |
| Realtime expectations ambiguous | §11.7 phase-1 SSR/revalidate model |
| Decision scope (WWMD/WWWD) unstated | §5.5 |
| Architectural alignment checklist missing | §5.4 |
| Composer vs governed action boundary thin | §10.1 |
| Accessibility not design-level | §11.6 |
| Open questions buried | §21 explicit deferred table |
| Attention vocabulary incomplete | My Work / Open room in §3 |

**Remaining residual risk:** standing-cycle carrier precedence (OQ-2) can still produce ambiguous projections for multi-carrier sources; BI-BA868848 must record a per-source precedence table in code and tests before claiming standing rooms done.
