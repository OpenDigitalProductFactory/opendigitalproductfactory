# Multi-Agent Collaboration & Visibility Design

| Field | Value |
| --- | --- |
| Status | Draft for review |
| Created | 2026-06-04 |
| Author | Claude (Opus 4.8) + Mark Bodman |
| Primary audience | Platform architecture, AI workforce UX, governance, standards |
| Epic | `EP-A2A` — agent-to-agent coworker team orchestration |
| Related standards | `A2A` 1.0.0, `TAK`, `GAID` |
| Related repo areas | `apps/web/components/agent/*`, `apps/web/lib/tak/*`, `apps/web/lib/actions/agent-threads.ts`, `apps/web/lib/ai-operations-map/*`, `apps/web/app/api/agent/stream/route.ts`, `packages/db/prisma/schema.prisma` |
| Related prior artifacts | `2026-04-23-a2a-aligned-coworker-runtime-design.md`, `2026-05-10-ai-coworker-visual-control-surface-design.md`, `2026-04-21-deliberation-pattern-framework-design.md`, `2026-04-29-orchestration-primitives-design.md`, `2026-05-31-pseudo-user-contract-design.md`, `2026-04-03-value-stream-team-architecture-design.md` |

## Purpose

Today the human↔coworker relationship in the portal is **1-to-1**: a user talks to exactly one route-resolved coworker, and that coworker's entire turn — including any work it hands off to or requests from another coworker — is collapsed into a single opaque "thinking" state. When a coworker spawns a child thread (`spawn_work_thread`), escalates (`Agent.escalatesTo`), or delegates (`DelegationGrant`), **the user sees none of it**. There is no way for the user to summon a second coworker into the conversation, and no way to observe, name, or optimize the collaboration patterns that emerge across coworkers over time.

This design extends DPF from 1-1 interaction to **multi-agent collaboration with first-class visibility**, by surfacing the multi-agent machinery that *already exists in the backend* up into:

1. the **user-facing conversation** (inline handoff, summon, and participant roster), and
2. an **operator/optimization lens** (collaboration patterns as observable, improvable units) that composes with the already-built AI Operations Map.

The design is **reuse-first**: nearly every primitive it needs is already in the schema or runtime. The gap is almost entirely projection and user-facing surface, not new substrate.

## Problem Statement

Mark's framing (2026-06-04): *"Today there is a very 1-1 interaction between human users and the ai-coworker. If the ai coworker hands off to another, or calls others, we have no visibility. The interface in the portal is capable of doing more, but we haven't extended into this. The ability for ai coworkers to be exposed in the portal UX or to be called as a second or third tier interaction needs to be supported."*

Decomposed into three concrete capability gaps:

- **G1 — Handoff/collaboration is invisible to the user.** `AgentCoworkerPanel.tsx` has no handoff, delegation, summon, or participant concept (verified: grep for `handoff|delegat|spawn_work|childThread|parentThread|summon|participant` returns zero matches in the panel). When a coworker calls another via `spawn_work_thread`, the child thread runs out-of-band; the user sees a single "[Agent] is thinking" with no indication that a second coworker is now involved.
- **G2 — Coworkers cannot be invoked as 2nd/3rd-tier participants from the UX.** Coworker resolution is purely route-based (`ROUTE_AGENT_MAP`). There is no coworker directory/picker in the chat, no `@mention`, no "bring in the Enterprise Architect" affordance. The user cannot escalate to or summon a specific coworker; nor can a coworker visibly request a named peer.
- **G3 — Collaboration patterns are not observable or optimizable.** The AI Operations Map (built, `/platform/ai/operations-map`) projects single-coworker activity onto a business-flow schematic, and `DelegationChainView` exists but is **admin-only and static**. Neither answers "which handoff patterns recur, where do they stall, and which should we optimize/codify into procedural code." The Process Observer (`2026-03-15-process-observer-design.md`) detects friction signals but does not model multi-agent collaboration as a first-class pattern.

## Current Repo & Runtime Truth

What already exists (verified 2026-06-04 against this worktree). The headline: **the collaboration substrate is largely built; the user-facing and pattern-optimization surfaces are not.**

### Built — backend collaboration primitives

| Primitive | Location | State |
| --- | --- | --- |
| Thread spawning (coworker→coworker) | `spawn_work_thread` MCP tool; `spawnWorkThread()` in `apps/web/lib/actions/agent-threads.ts`; dispatch in `agent-thread-dispatcher-runtime.ts` | **Built.** Creates child `AgentThread` (`parentThreadId`, `childCount`) + a `TaskRun`. Depth-1 limit; max 5 children. Polled via `get_thread_result` / `get_child_threads`. **Caveat (verified):** the child `TaskRun.parentTaskRunId` is currently hardcoded `null` in `spawnWorkThread` — task lineage is carried by `AgentThread.parentThreadId`, **not** `TaskRun.parentTaskRunId`. The participant projection (§A1) must read the thread edge; Slice 1 also populates `parentTaskRunId` so the task graph is complete. |
| Phase handoff (build) | `PhaseHandoff` model; `save_phase_handoff` MCP; `build-orchestrator.ts` | **Built.** Structured context (`summary`, `decisionsMade`, `openIssues`, `fromAgentId`, `toAgentId`) between build specialists. |
| Deliberation (multi-agent debate) | `apps/web/lib/deliberation/orchestrator.ts`; `start_deliberation` / `deliberate_on` MCP | **Built.** Parallel peer-review branches; `deliberation:*` events on the bus. |
| Build specialist dispatch | `build-orchestrator.ts`; `specialist-prompts.ts` | **Built.** Orchestrator → role-scoped specialists; the existing reference multi-agent pattern. |
| Event bus discriminants for collaboration | `apps/web/lib/tak/agent-event-bus.ts` | **Built.** `queue:escalation`, `orchestrator:task_dispatched|task_complete`, `deliberation:branch_dispatched|branch_completed`, `task:status`, `task:artifact`. |
| Delegation authority | `Agent.delegatesTo[]`, `Agent.escalatesTo`, `DelegationGrant`, `DelegationChain`/`DelegationLink`; `apps/web/lib/tak/delegation-authority.ts` | **Partial.** `delegation-authority.ts` **does** enforce chain authority propagation, loop detection, and depth (`MAX_DELEGATION_DEPTH = 4`) over `DelegationChain`/`DelegationLink` at runtime. But it does **not** read the `Agent.delegatesTo` / `Agent.escalatesTo` fields — every read of those two fields in `apps/web` is display/projection (`DelegationChainView`/`Panel` admin-only, agent detail page, AgentCard projection). So **those two fields specifically are informational**; Slice 2's `delegatesTo`/`escalatesTo` enforcement is net-new behavior layered onto the existing chain enforcement, not greenfield. |
| AI Operations Map (single-coworker visibility) | `apps/web/lib/ai-operations-map/*`, `apps/web/components/platform/AiOperationsMap.tsx`, route `/platform/ai/operations-map` | **Built (V1).** Projects `AgentEvent` + `ToolExecution` onto archetype business-flow schematic. Admin/platform surface. |
| AgentCard projection | designed in A2A spec; `agent-card-service` | **Partial/designed.** Canonical projection of agent capabilities/skills/grants. |

### Designed but not built (relevant)

- **A2A-aligned task-native runtime** (`2026-04-23-a2a-aligned-coworker-runtime-design.md`, BI-9DB7C332, in-progress): `TaskMessage`, `TaskArtifact`, canonical `TaskRun` envelope, question-packet handoff artifact. **Not yet implemented.** This design depends on its *task identity* concepts but does not block on the full cutover (see §Dependency Posture).

### Not built — the user-facing & pattern gap (this spec)

- `AgentCoworkerPanel.tsx`: no participant roster, no handoff card, no summon control. A child-thread spawn is invisible; the panel shows a single agent label that can change mid-turn but with no handoff semantics.
- No coworker directory/picker/`@mention` in any conversational surface.
- No "collaboration pattern" model: handoffs are individual `parentThreadId` edges, never aggregated into recurring patterns with health/latency/stall metrics.

## Research & Benchmarking (AGENTS.md §10)

Comparing **data/interaction models**, not feature lists.

### Open-source leaders

- **OpenAI Agents SDK — handoffs as first-class.** A handoff is a typed transfer where the receiving agent takes over the conversation; tracing emits a dedicated `HandoffSpan` distinct from tool/generation spans. **Adopted:** model coworker→coworker transfer as a first-class, *visible* event (a `HandoffSpan`-equivalent projected from `queue:escalation` + `orchestrator:task_dispatched`), not a hidden tool call. **Rejected:** OpenAI's full transfer-of-control default — DPF keeps the human's primary coworker as the conversation owner and renders peers as *participants*, preserving the governance owner (PAR principle, see below).
- **AutoGen (Microsoft) — GroupChat + roles.** A `GroupChatManager` selects the next speaker among a roster; turns are explicit and attributed. **Adopted:** an explicit, attributed **participant roster** with a turn/speaker model in the user-facing thread. **Rejected:** free-form round-robin auto-speaker selection as the *primary* UX; DPF gates peer entry through governed summon/handoff, not implicit speaker election.
- **CrewAI — delegation tool + process types.** Agents delegate via an explicit `Delegate work to coworker` tool; `sequential` vs `hierarchical` process types make the topology explicit. **Adopted:** a **governed `request_coworker` / handoff tool** that mirrors DPF's existing `spawn_work_thread` but carries A2A task semantics and emits a visible handoff. **Rejected:** CrewAI's unbounded peer-to-peer delegation graph; DPF retains the depth/fan-out caps already in `spawnWorkThread` and routes through the conversation owner.

### Commercial / standards

- **A2A 1.0.0 (Linux Foundation).** `Task` + `TaskStatusUpdateEvent` + `TaskArtifactUpdateEvent` + `AgentCard`; lifecycle includes `input-required`, `auth-required`. **Adopted:** the existing DPF A2A-alignment direction — collaboration units are tasks with status/artifact events; participant capabilities come from `AgentCard`. This design is the *user-facing projection* of that task model. **Rejected:** exposing raw A2A wire envelopes to end users; the conversation is a projection over tasks (consistent with the A2A-aligned runtime spec's "chat is a client over tasks").
- **LangGraph Studio — graph/thread observability.** Renders multi-node execution as a live graph with per-node state. **Adopted:** a **collaboration graph** view (who handed to whom, current state per participant) for the operator lens, anchored to the already-built Operations Map rather than a parallel surface. **Rejected:** a developer-grade node graph as the *end-user* surface; end users get a conversational participant view, operators get the graph.

### Patterns adopted / rejected / gaps filled

- **Adopt:** handoffs and summons are first-class, attributed, visible events; participant roster with governed entry; collaboration patterns are aggregatable and measurable.
- **Reject:** hidden delegation; transfer-of-control that loses the governance owner; a parallel event grammar or evidence model (the Operations Map spec's "project, don't republish" rule binds here too).
- **Gap DPF fills:** none of the surveyed tools tie multi-agent collaboration to a **governed authority chain** (`DelegationGrant`/`DelegationChain`/PAR), an **archetype business-flow map**, or a **pattern-optimization loop** that promotes stabilized collaboration into procedural code (the DPF autonomous-runtime thesis). That intersection is the differentiator and the reason this is built on DPF's substrate, not a generic orchestrator.

## Governing principles

- **Propose, Acknowledge, Reassign (PAR)** ([kernel principle](../founder-kernel/wiki/principles/propose-acknowledge-reassign.md)): a coworker entering a conversation is a *proposal*; the owner (or policy) must *acknowledge* before the peer mutates anything; control *reassigns* back explicitly. The participant model encodes PAR as state, not chat.
- **Orchestrator-worker** ([kernel principle](../founder-kernel/wiki/principles/orchestrator-worker-pattern.md)): peers don't freely route to each other; the conversation owner (or a designated orchestrator coworker) mediates entry. This preserves a single governance/authority owner per conversation.
- **Project, don't republish** (from the Operations Map spec): consume canonical `AgentEvent` / `TaskRun` / `DelegationChain` primitives; do not invent a parallel event union, state machine, or evidence ledger.
- **Make silent failures observable**, **architecture over shortcuts**, **research-and-use-standards** (A2A handoff/task semantics).

## Design

### Three layers (mapping to G1/G2/G3)

```
Layer A — Conversational multi-agent (G1, G2)
  Participant roster + inline handoff/summon cards in AgentCoworkerPanel,
  driven by governed handoff/summon tools and projected handoff events.

Layer B — Collaboration topology (G3, operator)
  A collaboration-graph view + pattern aggregation, composed into the
  already-built AI Operations Map as a new lens.

Layer C — Pattern optimization loop (G3, governance)
  CollaborationPattern aggregation → Process Observer findings →
  candidates for codification into procedural orchestration.
```

### Layer A — Conversational multi-agent

**A1. Participant model (projection, no new conversation substrate).**
A conversation already has a root `AgentThread` and may have child `AgentThread`s linked by `parentThreadId`. (Each thread also has a `TaskRun`, but `TaskRun.parentTaskRunId` is currently hardcoded `null` by `spawnWorkThread` — so the **thread edge is the load-bearing lineage today**; Slice 1 additionally populates `parentTaskRunId` to complete the task graph.) Introduce a **read-model** `ConversationParticipant` projected from these edges:

```ts
// apps/web/lib/tak/conversation-participants.ts  (view layer, no migration in slice 1)
type ConversationParticipant = {
  principalId: string;          // PrincipalAlias resolution (AGENTS.md §11) — never Agent.id
  agentId: string;
  label: string;
  role: "owner" | "peer" | "sub-agent";   // owner = route-resolved primary; peer = summoned; sub-agent = spawned worker
  tier: 1 | 2 | 3;              // interaction tier per Mark's framing
  state: TaskState;             // reuse apps/web/lib/tak/task-states.ts vocabulary exactly
  enteredVia: "route" | "summon" | "handoff" | "escalation" | "spawn";
  parentParticipantId?: string; // who brought them in (handoff/escalation lineage)
  taskRunId?: string;
  threadId: string;
};
```

The owner is the route-resolved coworker. Peers/sub-agents are projected from existing child-thread edges. **No new table in slice 1** — this is computed from `AgentThread.parentThreadId` + `TaskRun.status` (→ `TaskState`) + `AgentMessage.agentId`, mirroring the Operations Map's projection approach.

**A2. Governed handoff & summon tools.** Two MCP tools, both reusing the existing `spawn_work_thread` machinery, and gated by the **two existing, distinct governance layers** (verified): the capability × agent-grant intersection in `apps/web/lib/mcp-governed-execute.ts`, and — for proposal/PAR-acknowledge gating — the proposal-mode loop break in `apps/web/lib/tak/agentic-loop.ts` (`toolDef.executionMode === "proposal"`, with `autoApproveWhen` pre-authorization). The tools carry A2A handoff semantics and emit a **visible** event:

- `request_coworker` (coworker-initiated): a coworker requests a named peer/tier for a scoped sub-task. Mirrors `spawn_work_thread` but: (a) targets a *resolvable* coworker (by `agentId` or capability), (b) carries a question-packet-shaped payload (reuse the `TaskArtifact.metadata.artifactType="question-packet"` shape from the A2A spec — even before `TaskArtifact` is persisted, the payload shape is stable), (c) is declared `executionMode: "proposal"` so that, when the target exceeds the owner's delegation scope, the **agentic loop** (not the governed-execute gate) breaks to a proposal card for PAR acknowledge, and (d) emits `collaboration:handoff` (see A3).
- `summon_coworker` (user-initiated, via UI → server action): the user brings a specific coworker into the current conversation as a tier-2/3 participant. Routes through the same governance intersection (user capability × target agent grants).

Both **enforce `Agent.delegatesTo` / `escalatesTo`** at runtime (closing the "model only" gap): a `request_coworker` whose target is not in the caller's `delegatesTo` (and not the caller's `escalatesTo`) is denied with a clear reason, recorded as a `DelegationChain` hop.

**A3. Visible handoff events.** Per "project, don't republish," handoffs are projected from existing discriminants where possible. Where a genuinely new discriminant is needed it lands on the **canonical bus** (`agent-event-bus.ts`), not a panel-local channel:

- Add `collaboration:handoff` and `collaboration:summon` to `AgentEvent` (the canonical union), correlated by `threadId` + `parentParticipantId`. (The Operations Map spec explicitly permits new discriminants *on the canonical bus* with a companion substrate-spec note — this is that note.)
- `collaboration:return` marks reassignment of control back to the owner (PAR reassign), projected from child `TaskRun` reaching a terminal `TaskState`.

**A4. UI — `AgentCoworkerPanel` extension.**
- **Participant rail**: a compact roster (owner + active peers/sub-agents) with per-participant `state` chip (reuse report-kit `StatusBadge` + `statusColors`, AGENTS.md §12). Tier is shown as a depth indicator.
- **Inline handoff card** in the message stream: "🤝 *Build Specialist* asked *Enterprise Architect* to review the schema" with the question-packet summary, expandable to the sub-task's messages/artifacts. Renders from `collaboration:handoff`.
- **Summon control**: a coworker picker (the missing G2 affordance) backed by the AgentCard projection / agent registry, gated by the user's capabilities. Supports `@mention`-style invocation in the input.
- **Reduced-motion + a11y first-class** (mirror the Operations Map V1 acceptance bar). Color never the sole channel; every participant state carries label + icon.

All of this is **projection + presentation** over existing transport (`/api/agent/stream` SSE). No parallel WebSocket.

### Layer B — Collaboration topology (operator lens)

Compose into the **already-built** AI Operations Map (`apps/web/lib/ai-operations-map/*`, `components/platform/AiOperationsMap.tsx`) rather than a new page:

- **Collaboration overlay**: when a conversation or build involves >1 participant, render the handoff edges as `Transfer` objects. **Correction (verified):** the `Transfer` visual object is *specified* in the 2026-05-10 visual-control-surface design doc but is **not yet implemented** — the shipped Operations Map types are `OperationsMapStation` / `Line` / `Projection` / `Routing*`, with no `Transfer`/handoff concept. So Layer B **implements** the `Transfer` object per that prior spec (net-new viz substrate on the existing map, not a wiring-only change) and binds it to the new `collaboration:*` events. This is the largest single piece of net-new code in Layers A/B and should be sized accordingly.
- **Collaboration-graph inspector**: selecting a multi-participant pulse opens who-handed-to-whom with per-hop latency, state, and the governing `DelegationChain` reference. Reuses the Operations Map inspector + the existing (admin) `DelegationChainView` component logic.

### Layer C — Pattern optimization loop

The "patterns we want to optimize over time" requirement. **This is the one place that justifies new persistence** — and only after Layers A/B prove the model (the Operations Map spec's "only add persistence after the read-only view proves the model" discipline).

- **`CollaborationPattern`** (deferred to slice 3): an aggregation over completed multi-agent collaborations keyed by `(initiatingRole, targetRole, routeContext/valueStream, handoffKind)`, with rollups: occurrence count, success rate, median hop latency, stall/`input-required` rate, rework rate. Derivable initially as a *query* over `DelegationChain` + `TaskRun` + `collaboration:*` events; persisted only if the query plan demands it.
- **Process Observer integration**: feed recurring high-friction patterns (stalls, repeated escalations, low success rate) to the existing Process Observer (`2026-03-15-process-observer-design.md`) so they become triaged backlog items — closing the loop to "optimize over time."
- **Codification candidates**: patterns with high occurrence + high success are surfaced as candidates to promote from ad-hoc agentic handoff into procedural orchestration (`orchestration-primitives` / autonomous-runtime thesis: "move stabilized agent behavior into procedural code").

## Data Model Changes

Slice 1 and 2 add **no migrations** (pure projection + two governed tools + bus discriminants + UI). Persistence is introduced only in slice 3 and only if proven necessary:

| Change | Slice | Type |
| --- | --- | --- |
| `collaboration:handoff` / `:summon` / `:return` on `AgentEvent` union | 1 | Code (canonical bus) |
| `ConversationParticipant` read-model | 1 | Code (view) |
| `request_coworker` / `summon_coworker` tools + grant mappings | 1 | Code (MCP + `TOOL_TO_GRANTS` in `apps/web/lib/tak/agent-grants.ts`) |
| Runtime enforcement of `delegatesTo`/`escalatesTo` + `DelegationChain` hop write | 2 | Code (reuses existing models) |
| `CollaborationPattern` aggregation (query first; table only if `EXPLAIN` demands) | 3 | Query → conditional migration |

New `AgentEvent` discriminants and any new tool `enum:` values follow the strongly-typed-string-enum rule (AGENTS.md §3): the canonical `as const` and the MCP tool definition update in the same commit.

## Dependency Posture vs the A2A-aligned runtime

This design **depends on the A2A task *concepts*** (task identity, status/artifact events, question-packet handoff) but **does not block** on the full A2A-aligned runtime cutover (`TaskMessage`/`TaskArtifact` persistence). It uses the existing `TaskRun` + `AgentThread` edges as the participant/handoff substrate now, and the question-packet *shape* as the handoff payload. When the A2A runtime lands `TaskMessage`/`TaskArtifact`, the participant read-model and handoff cards re-point to those as the source of truth — projection insulates the UI from the substrate cutover. This is the explicit "exposing real surfaces later is projection work, not another rewrite" promise of the A2A spec, realized.

## Slices

**Slice 1 — Conversational multi-agent (G1 + G2), read + governed-write, no migration.**
- `collaboration:*` discriminants on the canonical bus; `ConversationParticipant` projection; `request_coworker` + `summon_coworker` tools (governed); `AgentCoworkerPanel` participant rail + inline handoff card + summon picker.
- Acceptance: a coworker can request a named peer and the user *sees* the handoff inline with the question-packet summary; the user can summon a specific coworker as a tier-2 participant; every handoff resolves to a real bus event + `TaskRun` (trace integrity); a11y + reduced-motion parity with Operations Map V1; build gate green (vitest + typecheck + `next build`); UX verified on the canonical local install.

**Slice 2 — Authority enforcement + topology overlay (G3 operator).**
- Enforce `delegatesTo`/`escalatesTo`; write `DelegationChain` hops; wire the Operations Map `Transfer` object + collaboration-graph inspector to `collaboration:*`.
- Acceptance: out-of-scope `request_coworker` is denied with a recorded reason; multi-participant work renders as Transfer edges on the Operations Map with per-hop latency/state.

**Slice 3 — Pattern optimization loop (G3 governance).**
- `CollaborationPattern` aggregation (query-first); Process Observer feed; codification-candidate surfacing.
- Acceptance: recurring high-friction handoff patterns appear as triaged backlog items; high-success patterns are flagged as procedural-codification candidates.

## Risks

1. **Owner/governance dilution.** Surfacing peers must not silently transfer authority. Mitigation: PAR + orchestrator-worker — peers are participants, the owner remains the governance principal; peer mutation requires acknowledge.
2. **Chat-as-runtime regression.** If handoffs leak through free-text instead of governed tools + bus events, visibility is fake. Mitigation: handoffs are *only* created by `request_coworker`/`summon_coworker`; trace-integrity test asserts every handoff card has a backing event + `TaskRun`.
3. **Parallel-surface drift.** Re-implementing collaboration viz outside the Operations Map. Mitigation: Layer B composes into the existing map's grammar/inspector; no new viz substrate.
4. **Premature persistence.** Mitigation: slices 1-2 are migration-free; `CollaborationPattern` is query-first.

## Open Questions

1. Should the conversation *owner* be allowed to delegate ownership to a summoned orchestrator coworker (tier-2 becomes mediator), or is ownership fixed to the route-resolved coworker for the conversation's life?
2. For `summon_coworker`, is the picker scoped to the current archetype/value-stream's coworkers by default, with an "all" override — or always the full registry?
3. Does `CollaborationPattern` key on `Agent` role or on `PrincipalAlias`/`AgentCard` capability (the latter survives agent re-org)?

## Recommendation

Proceed with Slice 1 as the first build: it directly closes the visible-handoff (G1) and coworker-summon (G2) gaps Mark named, adds **no migration**, reuses `spawn_work_thread` + the canonical event bus + the SSE transport + report-kit, and lands the projection seam that the A2A-aligned runtime and Operations Map can both attach to. Slices 2-3 layer enforcement and the optimization loop onto that seam.
