# Multi-Agent Collaboration & Visibility Design

| Field | Value |
| --- | --- |
| Status | Reviewed and corrected for implementation alignment |
| Created | 2026-06-04 |
| Last reviewed | 2026-06-06 — G2 corrected to visibility-only (Mark): human summon-entry path removed |
| Author | Claude (Opus 4.8) + Mark Bodman; review pass by Codex |
| Primary audience | Platform architecture, AI workforce UX, governance, standards |
| Epic | `EP-A2A` - agent-to-agent coworker team orchestration |
| Live backlog context | MCP `list_epics` verified `EP-A2A` open with 2 items; MCP semantic search found `BI-65B0D697` (`AI Operations Map - coworker-to-coworker (A2A) interaction visibility re-architecture`) as directly related. `search_specs_and_plans` returned no indexed matches for the main terms during this pass, so repo-file verification below is the stronger source. |
| Related standards | `A2A` 1.0.0, `TAK`, `GAID`, PAR, orchestrator-worker |
| Related repo areas | `apps/web/components/agent/*`, `apps/web/lib/tak/*`, `apps/web/lib/actions/agent-threads.ts`, `apps/web/lib/actions/conversation-participants-action.ts`, `apps/web/lib/mcp-tools.ts`, `apps/web/lib/ai-operations-map/*`, `apps/web/app/api/agent/stream/route.ts`, `packages/db/prisma/schema.prisma` |
| Related prior artifacts | `2026-04-23-a2a-aligned-coworker-runtime-design.md`, `2026-05-10-ai-coworker-visual-control-surface-design.md`, `2026-04-21-deliberation-pattern-framework-design.md`, `2026-04-29-orchestration-primitives-design.md`, `2026-05-31-pseudo-user-contract-design.md`, `2026-04-03-value-stream-team-architecture-design.md` |

## Purpose

DPF is moving from a mostly 1-to-1 human-to-coworker portal interaction toward governed multi-agent collaboration that the user can see, trust, and optimize. Mark's 2026-06-04 framing was that coworker handoffs, summons, and second/third-tier interactions are currently too hidden for the portal's ambitions.

This spec defines the product and architecture contract for that shift. It is reuse-first: DPF already has thread spawning, task runs, event streaming, delegation-chain substrate, AgentCard-style capability projection, and an AI Operations Map. The work is to project those primitives into excellent user-facing UX and an operator-visible topology without creating parallel event, identity, or evidence systems.

The review pass found that this worktree has already landed a substantial Slice 1 implementation. This document therefore separates:

- **Current worktree truth** - what exists in `D:\DPF\.claude\worktrees\sleepy-khorana-197ea7` now.
- **Slice 1A hardening/refactor** - the architectural and UI cleanup required before calling the conversational layer done.
- **Future slices** - Operations Map transfer topology and pattern optimization.

## Problem Statement

Mark's framing (2026-06-04): "Today there is a very 1-1 interaction between human users and the ai-coworker. If the ai coworker hands off to another, or calls others, we have no visibility. The interface in the portal is capable of doing more, but we haven't extended into this. The ability for ai coworkers to be exposed in the portal UX or to be called as a second or third tier interaction needs to be supported."

The problem decomposes into three product gaps:

- **G1 - Handoff/collaboration visibility.** A user must see when the primary coworker brings another coworker into the work, why that peer was invoked, what state the peer is in, and when control returns.
- **G2 - Coworker-driven tasking, shown to the user.** The active coworker — not the human — chooses which peers to bring in and what to task them with. The user-facing surface for the active thread is **visibility only**: it shows which coworkers the active coworker is tasking and a summary of what each is doing. There is no human picker, dropdown, or objective field.
- **G3 - Collaboration optimization.** Operators must be able to see recurring collaboration patterns, stalls, latency, and successful handoff paths so repeated ad-hoc behavior can be improved or codified into procedural orchestration.

> **Correction (Mark, 2026-06-06).** The first G2 implementation shipped a human-facing summon picker (a "Bring in a coworker" button with a coworker dropdown and a "What should they do?" field). That puts the burden of choosing and tasking peers on the human, which is wrong: *"This is not the responsibility of the human… this is the sole responsibility of the active AI coworker to choose and task the other AI Coworkers. This spec is in spirit right, but it should not be for entry. Instead, the UI for the active thread should show what other AI coworkers it is tasking and a summary of what they are doing."* G2 is therefore **visibility, not entry**. The picker is removed; the active coworker drives `request_coworker` / `summon_coworker` itself; the portal only renders the resulting activity.

## Current Repo & Runtime Truth

Verified against this worktree on 2026-06-05. The important correction: the first conversational projection has moved from "not built" to "partly built, needs hardening."

### Built before this spec

| Primitive | Location | Verified state |
| --- | --- | --- |
| Child thread spawning | `apps/web/lib/actions/agent-threads.ts`, wrapper in `apps/web/lib/actions/agent-coworker.ts`, MCP `spawn_work_thread` in `apps/web/lib/mcp-tools.ts` | Built. Depth-1 only, max 5 children, owner/cancel checks, dispatch compensation. |
| Task lineage | `TaskRun.parentTaskRunId` in `packages/db/prisma/schema.prisma`; `spawnWorkThread()` in `apps/web/lib/actions/agent-threads.ts` | Improved in this worktree. Child `TaskRun.parentTaskRunId` is now populated when the parent thread has a task run. Root chat threads often have no parent task run, so `AgentThread.parentThreadId` remains the always-present lineage edge. |
| Phase handoff | `PhaseHandoff`, `save_phase_handoff`, `apps/web/lib/integrate/build-orchestrator.ts` | Built for Build Studio phase transfer, not directly the user-facing coworker collaboration surface. |
| Deliberation | `apps/web/lib/deliberation/orchestrator.ts`, `start_deliberation`, `deliberate_on`, `deliberation:*` events | Built as multi-branch review/debate substrate. |
| Canonical agent event bus | `apps/web/lib/tak/agent-event-bus.ts` | Built. The union now includes `collaboration:handoff`, `collaboration:summon`, and `collaboration:return` in this worktree. |
| Delegation-chain substrate | `DelegationChain` model and `apps/web/lib/tak/delegation-authority.ts` | Built for authority propagation, loop detection, and depth limiting over chain links. |
| Informational agent delegation fields | `Agent.delegatesTo[]`, `Agent.escalatesTo` in `packages/db/prisma/schema.prisma`; display reads in admin/platform pages | Present, but not yet enforced by `request_coworker` / `summon_coworker`. |
| AI Operations Map V1 | `apps/web/lib/ai-operations-map/*`, `apps/web/components/platform/AiOperationsMap.tsx`, route `/platform/ai/operations-map` | Built for task/tool/evidence projection. It does not yet have transfer/handoff topology. |
| AgentCard-style projection | `apps/web/lib/tak/agent-card-service.ts` and related A2A spec | Partly built/designed; usable for capability and skill discovery direction. |

### Built in this worktree by the EP-A2A slice

| Surface | Location | Verified state |
| --- | --- | --- |
| Participant projection | `apps/web/lib/tak/conversation-participants-core.ts`, `apps/web/lib/tak/conversation-participants.ts` | Built as a pure core plus DB wrapper. Projects owner + depth-1 children from `AgentThread.parentThreadId`, `TaskRun`, latest assistant message, and `PrincipalAlias(aliasType="agent")`. Fails open to `agentId` when legacy agents lack a principal alias. |
| Targeted coworker collaboration core | `apps/web/lib/tak/coworker-collaboration.ts` | Built for `requestCoworker()` and `summonCoworker()`. Reuses child thread spawning and emits `collaboration:*` events. Current comments correctly state hard `delegatesTo` / `escalatesTo` enforcement is still Slice 2. |
| MCP tools | `apps/web/lib/mcp-tools.ts` | `request_coworker` and `summon_coworker` exist and dispatch to the collaboration core. They have `TOOL_TO_GRANTS` entries in `apps/web/lib/tak/agent-grants.ts` requiring `thread_write`. |
| Participant projection action | `apps/web/lib/actions/conversation-participants-action.ts` | Built (read-only). Projects the live participant roster for the visibility panel. **Replaces the removed `coworker-summon.ts`**, which exposed a user-facing `listSummonableCoworkers` + `summonCoworkerAction` entry path; per the 2026-06-06 correction the human entry path was deleted and only the read-only projection remains. |
| Coworker panel projection | `apps/web/components/agent/AgentCoworkerPanel.tsx` | Built. Imports `CollaborationActivityPanel` (which composes `ConversationParticipantRail` + `HandoffCard`); handles `collaboration:handoff|summon|return` SSE events; refreshes participants. The `CoworkerSummonPicker` entry form is removed (2026-06-06). |
| Participant rail | `apps/web/components/agent/ConversationParticipantRail.tsx` | Built and quiet for 1-1 conversations. Reuses report-kit `StatusBadge`, but currently carries a local task-state-to-intent map that should move into report-kit/status intent registry. |
| Inline collaboration card | `apps/web/components/agent/HandoffCard.tsx` | Built. Renders handoff/summon/return cards. Current glyphs are emoji; UI hardening should replace them with `lucide-react` icons per the frontend design standard. |
| ~~Summon picker~~ (removed 2026-06-06) | ~~`apps/web/components/agent/CoworkerSummonPicker.tsx`~~ | **Deleted.** This was a human entry form (coworker dropdown + "what should they do?" textarea). Per the G2 correction, choosing and tasking peers is the active coworker's job, not the human's. The visibility panel (`CollaborationActivityPanel`) is the only user-facing collaboration surface. |
| Unit coverage | `apps/web/lib/tak/conversation-participants.test.ts`, `apps/web/lib/actions/agent-threads.test.ts` | Participant projection has focused tests. The collaboration core, summon action, and visual components need targeted tests. |

### Not built yet

- Hard runtime enforcement of `Agent.delegatesTo` / `Agent.escalatesTo` inside the collaboration tools.
- `DelegationChain` hop writes for request/summon attempts, including denied attempts.
- Persistent collaboration provenance that survives refresh. Current live cards come from SSE/client state; participant projection sees existing child threads as `enteredVia: "spawn"` because no persisted `handoff` / `summon` metadata is attached to the child task/thread.
- Operations Map transfer edges, transfer inspector, and collaboration graph overlay.
- `CollaborationPattern` aggregation or Process Observer feed.

## Research & Benchmarking

AGENTS.md requires feature specs to benchmark real data and interaction models. Sources were rechecked during this review pass.

### External standards and products

- **A2A protocol** - The canonical model uses agent discovery (`AgentCard`), task status, task artifacts, polling, and SSE task update events. Adopt: keep DPF collaboration as task-backed projection with status/artifact semantics. Reject: showing raw A2A wire envelopes in the end-user chat. Sources: [A2A specification](https://a2aproject.github.io/A2A/latest/specification/), [A2A core protocol notes](https://agent2agent.info/specification/core/).
- **OpenAI Agents SDK** - Handoffs and tracing are first-class; tracing includes handoffs, tool calls, generations, guardrails, and custom events. Adopt: a visible collaboration event is not just text; it is a traceable runtime fact. Reject: default transfer-of-control as the user model; DPF keeps an owner participant under PAR. Sources: [OpenAI Agents SDK guide](https://platform.openai.com/docs/guides/agents-sdk/), [Agents SDK tracing](https://openai.github.io/openai-agents-js/guides/tracing).
- **AutoGen group chat** - Group chat makes speaker selection explicit, including manual, random, round-robin, callable, and model-selected modes. Adopt: explicit participant roster and attributed turns. Reject: hidden or free-form auto-speaker selection as the portal default. Sources: [AutoGen groupchat reference](https://autogenhub.github.io/autogen/docs/reference/agentchat/groupchat/), [AutoGen selector group chat](https://microsoft.github.io/autogen/0.4.5/user-guide/agentchat-user-guide/selector-group-chat.html).
- **CrewAI collaboration and hierarchical process** - Delegation is an explicit process/tool concept, and hierarchical mode uses a manager agent to plan, delegate, and validate. Adopt: governed named-peer request/summon tools. Reject: unbounded peer-to-peer delegation; DPF preserves depth/fan-out caps and an owner/orchestrator. Sources: [CrewAI collaboration](https://docs.crewai.com/en/concepts/collaboration), [CrewAI processes](https://docs.crewai.com/en/concepts/processes).
- **LangGraph/LangSmith Studio** - Studio observability centers on inspecting threads/traces for execution understanding. Adopt: an operator topology/inspector for multi-agent handoffs. Reject: exposing a developer-grade node graph as the default employee conversation surface. Source: [LangGraph Studio observability](https://docs.langchain.com/langgraph-platform/observability-studio).

### DPF-specific design intelligence

The MCP `search_design_intelligence` calls for the narrow terms "operations dashboard collaboration visibility status handoff participant roster evidence timeline", "network graph flow map transfer edges operations topology", "dashboard status timeline inspector progressive disclosure", "graph flow network process map", and similar broader terms returned no curated hits in this run. The binding UI guidance therefore comes from the local canonical standards:

- `AGENTS.md` Section 12: theme-aware tokens and report-kit composition.
- `docs/platform-usability-standards.md`: WCAG 2.2 AA, tokenized color roles, focus and form requirements.
- `apps/web/components/ui/report-kit/README.md`: `StatusBadge`, `DataTable`, `FilterBar`, `StatCard`, `Chart`, `statusColors`, and `LocalTime` conventions.

### Patterns adopted and rejected

- **Adopt:** visible, attributed handoff/summon events; roster-first conversation UX; task-backed state; inspector-backed operator topology; structured handoff payloads.
- **Reject:** chat-only delegation, hidden tool calls, transfer-of-control that loses the owner, parallel event unions, local status color maps, and persistence before the read model proves the query shape.
- **DPF differentiator:** DPF ties multi-agent collaboration to governed authority (`Principal`, `PrincipalAlias`, `DelegationChain`, PAR), business-flow visibility (Operations Map), and a refactor loop that promotes repeated agentic behavior into procedural orchestration.

## Governing Principles

- **Propose, Acknowledge, Reassign (PAR)** ([kernel principle](../../founder-kernel/wiki/principles/propose-acknowledge-reassign.md)): a coworker entering a conversation is a proposal or governed action; mutation authority is acknowledged, and control returns explicitly.
- **Orchestrator-worker** ([kernel principle](../../founder-kernel/wiki/principles/orchestrator-worker-pattern.md)): specialists do not freely route to each other; the owner or orchestrator mediates entry.
- **Single source of truth** ([kernel principle](../../founder-kernel/wiki/principles/single-source-of-truth.md)): collaboration visibility must project canonical `AgentThread`, `TaskRun`, `AgentEvent`, `ToolExecution`, `PrincipalAlias`, and `DelegationChain` facts rather than duplicate them.
- **Principal convergence** ([kernel principle](../../professions/data-architect/wiki/principal-convergence.md)): new actor references resolve through `Principal` / `PrincipalAlias`, not a parallel identity table.
- **Architecture over shortcuts** ([kernel principle](../../founder-kernel/wiki/principles/architecture-over-shortcuts.md)): spend the refactor budget now on the governance and UI seams instead of letting a chat-only prototype become the architecture.
- **Structured handoffs, not conversation history** ([kernel principle](../../founder-kernel/wiki/principles/structured-handoffs-not-conversation-history.md)): a handoff carries an explicit summary, evidence, open questions, and constraints; it does not rely on the receiving coworker reading raw chat history.

## Architecture

### Layer A - Conversational Multi-Agent UX

Layer A is partly built and should be finished through a Slice 1A hardening/refactor pass.

#### A1. Participant projection

The projection is the right shape: `ConversationParticipant` is a read model over `AgentThread.parentThreadId`, `TaskRun`, `AgentMessage.agentId`, and `PrincipalAlias`. It should remain a projection, not a new table.

Required hardening:

- Persist `enteredVia`, `tier`, `fromAgentId`, `toAgentId`, and handoff summary on existing substrate so refreshes and history views do not lose meaning. Preferred zero-migration target: `TaskRun.a2aMetadata` for the child task, plus persisted `ToolExecution` when invoked through MCP. Do not add a `ConversationParticipant` table.
- Keep `AgentThread.parentThreadId` as the canonical lineage edge for chat-root conversations. Treat `TaskRun.parentTaskRunId` as a useful companion when a parent task run exists.
- Preserve `PrincipalAlias(aliasType="agent", aliasValue=agentId)` resolution. Continue fail-open display for legacy agents, but mark `principalResolved=false` so operator/audit views can surface identity debt.

#### A2. Governed handoff and summon

`request_coworker` and `summon_coworker` exist. The remaining architectural requirement is governance parity:

- `request_coworker` must be proposal-aware when the target exceeds the caller's delegated scope. Current MCP definitions do not declare `executionMode: "proposal"` for these tools; the hardening pass must add the correct PAR behavior or explicitly document why the existing `thread_write` grant is sufficient for a limited MVP.
- Both `request_coworker` and `summon_coworker` are **coworker-initiated** and flow through the governed MCP execution path (`mcp-governed-execute.ts`), carrying the active coworker's `callerAgentId` for authority enforcement and attribution. There is no user-facing summon action: the human cannot pick or task a peer, so there is no `auth()`-only side door to govern. (The removed `summonCoworkerAction()` was exactly that side door; deleting it closes the bypass risk rather than papering over it.)
- `Agent.delegatesTo` / `Agent.escalatesTo` must become enforcement inputs, not display-only metadata. Denied attempts write an auditable reason and do not spawn a child thread.
- Every accepted or denied request/summon writes or extends a `DelegationChain` hop once Slice 2 starts; until then, the UX must not imply that chain-of-custody is already complete.

#### A3. Visible handoff events

`collaboration:handoff`, `collaboration:summon`, and `collaboration:return` are already on the canonical `AgentEvent` union. Keep them there.

Required hardening:

- Emit `collaboration:return` from child task terminal transitions; the union exists but the return signal is not yet wired.
- Make every visible card traceable to a runtime fact. For live-only events, use the event plus child `TaskRun`. For reload/history, reconstruct from `TaskRun.a2aMetadata` and persisted `ToolExecution` rows where available.
- Do not create a panel-local event grammar. Unknown future `AgentEvent` discriminants remain tolerated by default projection logic.

#### A4. UI contract

**Primary UX model (Mark, 2026-06-05): collapsed, summarized, done-indicated progressive disclosure.** The human is *not necessarily a direct participant* in coworker-to-coworker activity, so sub-agent collaboration must default to a **single collapsed, summarized row** — not an always-expanded rail plus a stream of inline cards. The canonical shape is the familiar "sub-agent activity" disclosure:

- **Collapsed (default):** one compact row summarizing the collaboration — who was brought in, how many coworkers, and the aggregate state — with a **done indicator** (an in-progress affordance while any sub-agent is working; a completion check when all sub-agents reach a terminal state). Example collapsed text: *"Sub-agent activity — Enterprise Architect · working"* → on completion *"Sub-agent activity — Enterprise Architect · done."*
- **Expanded (on click):** the participant roster (the existing rail content) plus the per-event handoff/summon/return cards. Expansion is the user opting in to detail; it is never required to understand that collaboration happened or finished.
- **Quiet for 1-1:** nothing renders when the owner is the only participant. The disclosure appears only when a peer/sub-agent is present or a recent collaboration event fired.
- **Done signal is a runtime fact, not a guess.** The aggregate "done" state is computed from participant `TaskState` (terminal vs in-flight) and confirmed by `collaboration:return` (A3). While in-flight, the row shows a reduced-motion-safe progress affordance; on completion it shows a check plus a one-line outcome summary.

The previous always-visible rail (`ConversationParticipantRail`) becomes the **expanded-detail body** of this disclosure rather than a top-level element. Implement the disclosure as a focused `CollaborationActivityPanel` (collapsible) that composes the existing rail + cards; do not leave the rail and a loose card stream as independent top-level panel elements.

Remaining refinements:

- Use report-kit status semantics end to end. Move the local `TaskState -> Intent` map from `ConversationParticipantRail.tsx` into the central `statusColors.ts` registry or a shared task-state badge wrapper.
- Replace emoji glyphs in the collaboration UI with `lucide-react` icons such as `Handshake`, `UserPlus`, `Undo2`, `Users`, `ChevronRight`/`ChevronDown` (disclosure), `Loader2` (in-flight), and `CheckCircle2` (done).
- Keep the disclosure compact and stable: fixed collapsed height, truncation, and tooltips so participant labels cannot resize the coworker panel or overlap the message stream.
- **The disclosure is read-only.** It carries no human controls for choosing or tasking a coworker — no picker, dropdown, objective field, or `@mention` summon. Per the 2026-06-06 correction, the active coworker decides which peers to bring in (via `request_coworker` / `summon_coworker`); the user only sees the resulting roster and per-event cards. Each card attributes the action to the **active coworker** as the source (not "You").
- Each summon/handoff card shows a one-line summary of what the peer was tasked with, so the user understands *what* each coworker is doing without expanding into the sub-thread.
- Apply the portal UI rules: CSS variables only, no local raw color maps, WCAG 2.2 AA contrast, color never as the sole channel, reduced-motion compatible activity indicators, and visible focus states.

### Layer B - Collaboration Topology in the AI Operations Map

Layer B is not built in this worktree. The Operations Map currently projects task runs, tool executions, receipts, backlog evidence, and external evidence; its types do not include a transfer/handoff overlay.

Implement this as an extension of the existing map, not a new page:

- Add an `OperationsMapTransfer` (or equivalent) projection alongside `OperationsMapProjection`, with `fromAgentId`, `toAgentId`, `parentThreadId`, `childThreadId`, `taskRunId`, `enteredVia`, `startedAt`, `completedAt`, `latencyMs`, `state`, and `delegationChainId?`.
- Project transfer edges from `TaskRun.a2aMetadata`, `AgentThread.parentThreadId`, `collaboration:*` live events, and `DelegationChain` once Slice 2 writes hops.
- Render transfers as a restrained overlay on `AiOperationsMap`, not as a dense graph by default. Selecting a transfer opens the existing inspector pattern with source, freshness, state, latency, and authority details.
- Add a quick-view filter such as "Collaboration" only after transfer data exists; avoid a dead nav/control that shows no rows.

### Layer C - Pattern Optimization Loop

Layer C turns observed collaboration into optimization candidates.

Use query-first aggregation:

- Start with `TaskRun.repeatedPatternKey`, `TaskRun.a2aMetadata`, `DelegationChain`, and transfer projections. Do not add a `CollaborationPattern` table in the first implementation.
- Key patterns by stable roles/capabilities, not raw display names: `(initiatingRoleOrCapability, targetRoleOrCapability, routeContext/valueStream, enteredVia)`.
- Compute occurrence count, success rate, median hop latency, stall/input-required rate, denied-attempt rate, and rework rate.
- Feed high-friction patterns into the existing Process Observer path as backlog candidates.
- Feed high-success repeated patterns into the procedural-codification queue: repeated agentic handoff that stabilizes should become deterministic orchestration where appropriate.

Only introduce a persisted `CollaborationPattern` model if an `EXPLAIN` pass against realistic volumes shows the query-first approach is too expensive or if the Process Observer needs durable review workflow fields that existing rows cannot hold.

## Data Model Posture

No new migration is required for Slice 1A if the design uses existing `TaskRun.a2aMetadata` and `ToolExecution` audit rows.

| Change | Status | Type |
| --- | --- | --- |
| `collaboration:handoff` / `collaboration:summon` / `collaboration:return` on `AgentEvent` | Present in worktree | Code |
| `ConversationParticipant` read model | Present in worktree | Code |
| `request_coworker` / `summon_coworker` tools + `TOOL_TO_GRANTS` entries | Present in worktree | Code |
| `TaskRun.parentTaskRunId` populated during child thread spawn when parent task exists | Present in worktree | Code |
| Persist collaboration provenance in `TaskRun.a2aMetadata` | Required Slice 1A | Code, no migration |
| Governed UI summon path | Required Slice 1A | Code, no migration |
| `delegatesTo` / `escalatesTo` enforcement + `DelegationChain` hop writes | Required Slice 2 | Code using existing models |
| Operations Map transfer projection | Required Slice 2 | Code, no migration unless proven by load |
| Collaboration pattern aggregation | Required Slice 3 | Query first; conditional migration only after evidence |

Any future string-enum value follows AGENTS.md Section 3: update the canonical `as const` registry and MCP schemas in the same commit before data uses the value.

## Dependency Posture vs A2A-Aligned Runtime

This design depends on A2A task concepts: task identity, status/artifact updates, structured handoff payloads, and AgentCard-based discovery. It does not block on the full A2A runtime cutover.

Current substrate:

- `AgentThread.parentThreadId` is the load-bearing edge for conversation lineage.
- `TaskRun.parentTaskRunId` is now populated when possible.
- `TaskRun.a2aMetadata` is the preferred short-term home for collaboration provenance.
- `AgentEvent` over SSE carries live visibility.
- `ToolExecution` carries governed execution evidence when a collaboration tool is invoked through MCP.

When `TaskMessage` / `TaskArtifact` persistence is fully adopted for task-native chat, the participant read model and cards should re-point to those artifacts without changing the user-facing UX contract.

## GAID Chain-of-Custody, A2A Traceability & the Collaboration Call-Stack

*(Added 2026-06-05 at Mark's request: review GAID, the need for A2A traceability and a call-stack, and A2A interaction concerns generally.)*

When one coworker hands off to another — and that one calls a third — the platform needs a **call-stack**: a single, end-to-end-correlatable record of who invoked whom, under whose authority, with what result, that survives across processes and (eventually) across organizational boundaries. This is exactly what `GAID` §10 (Chain-of-Custody and Agent Action Receipts) standardizes, and what DPF should converge the collaboration substrate toward. We treat `A2A` as the interaction carrier, `TAK` as the runtime enforcement layer, and `GAID` as the identity + chain-of-custody layer (per `2026-04-23-a2a-aligned-coworker-runtime-design.md`).

### The call-stack DPF already has (and what it lacks)

The collaboration call-stack is **already physically present**, spread across three lineage edges, but it is not yet GAID-shaped:

| Call-stack concern | DPF substrate today | GAID §10 requirement | Gap |
| --- | --- | --- | --- |
| Frame linkage (who called whom) | `AgentThread.parentThreadId`; `TaskRun.parentTaskRunId`; `DelegationChain.parentLinkId` + `chainId` + `depth` | `parent_receipt` per delegated action | Lineage exists but is not expressed as receipts with a `parent_receipt` pointer |
| Acting + delegating identity | `fromAgentId` / `toAgentId` (DPF internal agentIds); actor resolved to `Principal` via `PrincipalAlias` | both delegated and delegating **`GAID`** `MUST` be recorded (§10.3) | No `GAID` binding yet — DPF uses internal agentIds, not stable issuer-backed GAIDs |
| Authority of the action | `DelegationChain.authorityScope` / `originAuthority`; tool grants; `delegatesTo` enforcement (Slice 2) | `authorization_class` reference in the receipt (§9, §10.2) | Portable class (`delegate`, `execute`, …) not yet mapped onto DPF grants/provenance |
| End-to-end correlation | none — `chainId` groups one delegation flow but no trace id spans thread + task + tool-execution + provider call | `trace_context` sufficient for distributed correlation, **preserved end to end** (§10.3) | **No propagated trace context** — the single biggest call-stack gap |
| Consequential-action evidence | `ToolExecution` rows; `collaboration:*` events (ephemeral); `DelegationChain` hops | a **receipt** per consequential action: `receipt_id`, `request_hash`, `result_hash`, `execution_mode`, `target_ref`, `signature` (§10.2) | DPF has audit rows + `ToolExecutionReceipt` (per-execution), but not a collaboration-aware receipt carrying trace + parent linkage |
| Integrity / non-repudiation | none (rows are mutable) | tamper-evident receipts; `RFC 9421`/`JOSE`/`COSE`/`DSSE` signatures for `GAID-Federated`+ (§10.4) | Deferred — appropriate for the federated/public posture, not single-org V1 |

**Conclusion:** DPF is at `GAID-Private` posture. The chain-of-custody *graph* exists (thread + task + delegation lineage); what is missing for true A2A traceability is (1) a **propagated trace context** spanning a multi-agent flow, (2) **GAID identity binding** on the actors, and (3) a **collaboration receipt** that ties a consequential collaboration action to its `parent_receipt`, `trace_context`, and `authorization_class`. None require leaving single-org; all are projection/record work over the substrate already built in Slices 1–2.

### Design direction (incremental, GAID-Private first)

1. **Trace context — introduce now, cheaply.** Mint a `traceId` (W3C Trace Context `traceparent` / OpenTelemetry GenAI conventions — see `docs/specs/routing-resilience-and-failure-observability-spec.md`, which already adopts OTel GenAI spans) at the root of a conversation, and propagate it through every collaboration spawn into `TaskRun.a2aMetadata.trace` (and onto child spawns, the existing `collaboration:*` events, and `ToolExecution.routeContext`/metadata). A `spanId` per hop + a `parentSpanId` reproduce the call-stack frames. This is the smallest change that turns the existing lineage into a *correlatable* call-stack and is the prerequisite for everything below.
2. **Authorization class — map, don't invent.** Adopt the GAID §9.2 portable vocabulary and map it onto DPF's grant model: a handoff/summon is the `delegate` class; a side-effecting sub-agent tool call is `execute`; read-only is `observe`/`analyze`. Record the active `authorization_class` in the collaboration provenance (`a2aMetadata.collaboration.authorizationClass`) and, later, in receipts (§9.3: the class is *declarative*, never proof of present authorization — local `TAK` grant/`delegatesTo` enforcement still gates).
3. **GAID identity binding — project from what exists.** The participant projection already resolves actors to a `Principal` via `PrincipalAlias`; add an optional `gaid` projection (AIDoc §7.2 minimum fields: `gaid`, `subject_type` = coordinator/specialist, `tool_surface`, `model_binding`, `hitl_profile`) sourced from the AgentCard projection service. Until a `GAID` namespace is issued, the internal agentId is the private-posture identifier and `principalResolved=false` already flags identity debt (Slice 1A).
4. **Collaboration receipt — extend, don't duplicate.** A consequential collaboration action (accepted handoff, summon, denied attempt, sub-agent terminal result) emits a receipt carrying the GAID §10.2 minimum fields. Reuse `ToolExecutionReceipt` where the action is a governed tool call; add a thin collaboration-receipt projection for handoff/return that records `parent_receipt` (the initiating hop), `trace_context`, `authorization_class`, `request_hash` (the question-packet digest), and `result_hash` (the child task outcome digest). Privacy per §10.5: reference the question-packet by digest, never copy raw prompt text into a shareable receipt.
5. **A2A profile (§11.5) — keep the carrier honest.** The AgentCard projection is the A2A surface; the published `GAID` projection `SHOULD` stay consistent across public and authenticated card variants. Cross-boundary A2A (org-to-org) maps to the `cross-boundary` authorization class and `GAID-Federated`/`-Public` posture — explicitly **out of scope** for the single-org install, but the receipt/trace shape is designed so federation is projection work, not a rewrite.

### A2A Interaction Concerns (threat → control)

General concerns for agent-to-agent interaction, mapped to the control that addresses each (drawing on `docs/architecture/agent-standards-threat-model.md`). "Built" = present in Slices 1–2; "Gap" = needs the trace/receipt/GAID work above.

| Concern | What goes wrong | Control | Status |
| --- | --- | --- | --- |
| **Unbounded recursion / fan-out** | A→B→C→… or one agent spawning many, runaway cost | `spawnWorkThread` depth-1 + max-5 children; `delegation-authority.ts` `MAX_DELEGATION_DEPTH=4` | Built (caps), but the two limits are inconsistent — reconcile |
| **Delegation loops** | A delegates to B which delegates back to A | `delegation-authority.ts` loop detection over `DelegationChain` | Built (chain layer); the new `request_coworker` path must route through it, not just `delegatesTo` |
| **Over-broad delegation (confused deputy)** | Delegate acts with more authority than the delegator held | `delegatesTo`/`escalatesTo` gate (Slice 2) + `delegation-authority.ts` authority narrowing/intersection | Built (gate); narrowing must be wired into `request_coworker`, not only the legacy chain API |
| **Identity spoofing** | An agent claims to be another in a handoff | `Principal`/`PrincipalAlias` resolution; future `GAID` binding + signed receipts | Partial — identity resolved, not yet GAID-bound or signed |
| **Forged / unauthorized delegation** | A hop the named delegator never authorized | Governed tool path (audit + hooks); future tamper-evident receipts (§10.4) | Partial — audited, not yet non-repudiable |
| **Cross-hop prompt injection** | Malicious content in a handoff packet steers the receiving agent beyond scope | Structured question-packet (`hardEdges`, `pushbackPermission`, `decisionRoute`) treated as data, not commands; receiving agent bounded by its own grants | Partial — packet shape defined; receiving-side "treat handoff as data" guardrail should be explicit |
| **Silent sub-agent failure / stall** | A delegate stalls and the caller/user never knows | `collaboration:return` on terminal transition + done indicator + `taskrun:stalled` watchdog | Built |
| **Invisible delegation** | Work happens off-screen with no user/operator visibility | Collapsed disclosure (user) + Operations Map transfer overlay (operator) | Built |
| **Untraceable multi-agent flow** | No way to reconstruct a full A→B→C flow after the fact | propagated `trace_context` + `parent_receipt` chain | **Gap — the core of this section** |
| **Cross-boundary exposure** | An org-to-org A2A call leaks data or authority | `cross-boundary` authorization class; `GAID-Federated`+ posture; not enabled single-org | Out of scope (V1) — designed-for, not built |

## Slices

### Slice 1A - Harden the Conversational Layer

Scope: finish the implementation already present in this worktree.

- **Collapsed/summarized disclosure (Mark, 2026-06-05):** introduce a `CollaborationActivityPanel` that is collapsed and summarized by default with a done indicator, composing the existing rail (as expanded detail) and the handoff/summon/return cards. Replace the always-visible rail + loose card stream with this disclosure.
- Add the return event path for child task terminal states so the done indicator is a confirmed runtime fact; while the return event is being wired, drive the indicator from participant `TaskState` (poll while in-flight).
- Persist collaboration provenance in `TaskRun.a2aMetadata` so cards and participant `enteredVia` survive refresh.
- **Remove the human summon-entry path (2026-06-06 correction):** delete `CoworkerSummonPicker` and the user-facing `summonCoworkerAction`; the disclosure is visibility-only. Summon stays a coworker-initiated MCP tool (`summon_coworker`) carrying `callerAgentId`. Make `request_coworker` proposal-aware or explicitly bounded.
- Replace local status intent mapping with report-kit central status semantics.
- Replace emoji glyphs with lucide icons and verify compact responsive behavior.
- Add focused tests for `coworker-collaboration.ts`, the participant projection action, the collaboration disclosure summary/done logic, and the panel's collaboration event handling.

Acceptance:

- By default the panel shows a single collapsed, summarized collaboration row with a clear in-progress/done indicator; expanding reveals the roster and cards. Nothing renders for a 1-1 conversation.
- The done indicator flips to "done" when all sub-agents reach a terminal `TaskState`, confirmed by `collaboration:return` where available.
- The active coworker can bring in a named peer (handoff or summon), and the user sees the peer plus a one-line summary of what it was tasked with, persisted across refresh and attributed to the active coworker (not "You").
- The user-facing surface is read-only: there is no picker, dropdown, objective field, or `@mention` summon by which a human could choose or task a coworker.
- Participant state uses central report-kit semantics and no local status color map.
- Component tests cover no-overlap/no-overflow core states; UX verification runs against the canonical local install or shared local-CI convergence sandbox.

### Slice 2 - Authority and Operations Map Topology

Scope: enforce authority and expose topology to operators.

- Enforce `Agent.delegatesTo` / `Agent.escalatesTo` for request/summon.
- Write `DelegationChain` hops for accepted and denied collaboration attempts.
- Add `OperationsMapTransfer` projection and inspector.
- Render transfer edges on the existing AI Operations Map.

Acceptance:

- Out-of-scope `request_coworker` is denied, records an auditable reason, and does not spawn a child thread.
- A completed handoff renders as a transfer edge with source, freshness, state, latency, and authority details.
- The map still works if one source is unavailable and labels stale/partial transfer data rather than collapsing it into a false status.

### Slice 2.5 - GAID Traceability & the Call-Stack

Scope: turn the existing collaboration lineage into a GAID-shaped, end-to-end-correlatable call-stack (see "GAID Chain-of-Custody, A2A Traceability & the Collaboration Call-Stack" above). GAID-Private posture only; no signing, no cross-boundary.

- **Trace context first.** Mint a root `traceId` per conversation; propagate `{ traceId, spanId, parentSpanId }` through every collaboration spawn into `TaskRun.a2aMetadata.trace`, the `collaboration:*` events, and tool-execution metadata. Align with the OTel GenAI conventions already adopted in `docs/specs/routing-resilience-and-failure-observability-spec.md`.
- **Authorization class.** Map GAID §9.2 portable classes onto the grant model; record `authorizationClass` (`delegate` for handoff/summon, `execute` for side-effecting sub-agent calls) in collaboration provenance.
- **Collaboration receipt.** Emit a receipt per consequential collaboration action (accepted/denied handoff, summon, child terminal result) carrying §10.2 fields: `parent_receipt`, `trace_context`, `authorization_class`, `request_hash` (question-packet digest), `result_hash`. Reuse `ToolExecutionReceipt` for governed tool calls; project a thin collaboration receipt for handoff/return. Privacy per §10.5 (digest, not raw text).
- **GAID/AIDoc projection (read-only).** Extend the participant + AgentCard projection with optional `gaid` + AIDoc minimum fields; keep `principalResolved=false` as the identity-debt flag until a namespace is issued.
- **Reconcile the depth caps.** `spawnWorkThread` depth-1 vs `MAX_DELEGATION_DEPTH=4` are inconsistent; pick one model and document it, and route `request_coworker` through `delegation-authority.ts` loop/narrowing in addition to the `delegatesTo` gate.

Acceptance:

- A multi-agent flow (owner → peer → sub-task) is reconstructable end-to-end from a single `traceId`, with parent/child spans matching the call-stack.
- Each consequential collaboration action has a receipt with `parent_receipt` + `trace_context` + `authorization_class`; denied handoffs included.
- No raw prompt text appears in any receipt; question-packets are referenced by digest.
- Deferred explicitly (documented, not built): receipt signing / non-repudiation (§10.4), cross-boundary A2A, public GAID issuance.

### Slice 3 - Pattern Optimization

Scope: aggregate patterns and feed improvement loops.

- Query recurring handoff/summon patterns from task metadata, transfer projections, and delegation chains.
- Feed high-friction patterns to Process Observer/backlog triage.
- Surface high-success repeated patterns as procedural-codification candidates.
- Add persistence only if query-first evidence proves it necessary.

Acceptance:

- Operators can see the top recurring collaboration patterns, stall/input-required rates, and median hop latency.
- High-friction patterns can become backlog items with concrete evidence.
- High-success patterns can be promoted to an orchestration-primitives/proceduralization review.

## Refactoring Budget

Reserve at least 20 percent of the implementation effort for refactoring and UI hardening, not just feature wiring:

- Extract collaboration state/event handling out of `AgentCoworkerPanel.tsx` into a focused hook or child component so the panel does not become the collaboration runtime.
- Centralize task-state badge intent mapping in report-kit or a shared `TaskStateBadge`.
- Normalize collaboration provenance writes in one helper used by both MCP and UI summon paths.
- Keep Operations Map transfer projection pure/testable, mirroring the current `project-events.ts` split from DB loading.
- Add regression tests before broadening behavior; avoid "works in live chat" as the only evidence.

## Risks

1. **Governance bypass.** A user-facing summon action that called the collaboration core after only `auth()` was a side door around the governed execution path. Mitigation (done, 2026-06-06): the human summon-entry path is removed entirely; summon is only reachable as a coworker-initiated MCP tool through `mcp-governed-execute.ts`. There is no human entry surface left to bypass.
2. **Visible but non-persistent handoffs.** Live cards that disappear on refresh create false confidence. Mitigation: persist provenance on existing task metadata and reconstruct cards/read models from it.
3. **Owner dilution.** Multi-agent UX can imply authority moved to the peer. Mitigation: PAR states owner, peer, return, and mutation authority explicitly.
4. **Parallel visualization surface.** A new graph page would duplicate the Operations Map. Mitigation: transfer overlay composes into the existing map and inspector.
5. **Premature table design.** A `CollaborationPattern` table before query evidence would violate schema stewardship. Mitigation: query-first with `TaskRun.repeatedPatternKey` and metadata.
6. **UI clutter.** A participant rail can become noisy in normal 1-1 work. Mitigation: quiet by default; show only when multiple participants or a recent collaboration event exists.

## Open Questions

1. Should ownership ever transfer to a summoned orchestrator coworker, or is the route-resolved owner fixed for the conversation lifetime?
2. ~~Should the coworker picker default scope be route, value stream, archetype, or a weighted blend of those?~~ **Resolved 2026-06-06:** there is no human picker. The active coworker selects peers, so scoping is the coworker's routing/judgment concern, not a UI default.
3. Should `request_coworker` be a proposal-mode tool in all cases, or only when delegation scope is exceeded?
4. Should persisted collaboration provenance live only in `TaskRun.a2aMetadata`, or also produce a compact `AgentMessage` system card for transcript history?
5. Should pattern keys prefer AgentCard capability over role/agent id to survive future agent reorgs?

## Recommendation

Do not start with the Operations Map overlay. First finish **Slice 1A**: harden the conversational layer already present in this worktree so it is governed, persistent across refresh, visually polished, and tested. Then implement Slice 2 as the operator topology layer. This keeps the user-visible value close while paying the architecture/refactor bill before the prototype hardens into debt.
