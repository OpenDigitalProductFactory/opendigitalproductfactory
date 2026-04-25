# A2A-Aligned Internal Coworker Runtime Design

| Field | Value |
|-------|-------|
| **Status** | Draft for review |
| **Created** | 2026-04-23 |
| **Author** | Codex + Mark Bodman |
| **Primary Audience** | Platform architecture, AI runtime, standards, governance |
| **Related Standards** | `TAK`, `GAID`, `A2A` |
| **Related Runtime Areas** | coworker execution, delegation, approvals, audit, identity, task governance |

## Purpose

This design refactors the internal DPF coworker runtime into an A2A-shaped, task-native architecture while preserving current coworker UX and current governance controls.

The goal is not to claim full A2A conformance immediately. The goal is to make the internal runtime structurally compatible with the current A2A task model now, so that:

- coworker-to-coworker handoff is represented as a governed task, not an implicit chat side effect
- outputs are represented as task artifacts
- clarifications and progress are represented as task messages and task status events
- `TAK` runtime controls and `GAID` identity and receipt semantics can be layered explicitly into the task envelope
- future private or public A2A endpoint exposure requires projection work, not another core rewrite

## Problem Statement

DPF already contains many of the right governance primitives:

- agent routing and route-scoped agent identity
- `Agent.delegatesTo`
- `AgentGovernanceProfile.allowDelegation`
- `DelegationGrant`
- `AgentActionProposal`
- `ScheduledAgentTask`
- `ToolExecution`
- user capability intersected with agent tool grants
- `TaskRun` and `TaskNode`

However, these primitives are spread across multiple models and execution paths rather than being unified as one canonical task envelope.

Today the runtime is still primarily:

- chat-first
- thread-centric
- proposal and audit side-table driven
- only partially task-native

That makes DPF conceptually adjacent to A2A, but not yet A2A-shaped in its internal architecture.

For DPF to be a real proving ground for `TAK` and `GAID`, the platform should do the harder architectural work now:

- make the internal work unit task-native
- attach governance and authority to that task-native substrate
- keep chat as a client and presentation layer rather than the governing model

## Current Repo and Runtime Truth

### Runtime and Schema Surfaces Present

The current schema and runtime already include the main building blocks:

- `Agent`, `AgentGovernanceProfile`, and `DelegationGrant` in `packages/db/prisma/schema.prisma`
- `AgentThread`, `AgentMessage`, `AgentActionProposal`, and `ToolExecution` in `packages/db/prisma/schema.prisma`
- `ScheduledAgentTask` in `packages/db/prisma/schema.prisma`
- `DelegationChain` in `packages/db/prisma/schema.prisma`
- `TaskRun`, `TaskNode`, and `TaskNodeEdge` in `packages/db/prisma/schema.prisma`
- proposal-mode execution break at `apps/web/lib/tak/agentic-loop.ts:847` (`toolDef.executionMode === "proposal"`)
- tool authorization intersection in `apps/web/lib/mcp-tools.ts` and `apps/web/lib/tak/agent-grants.ts`
- delegation-chain logic in `apps/web/lib/tak/delegation-authority.ts`
- scheduled coworker execution in `apps/web/lib/actions/agent-task-scheduler.ts`
- current coworker thread and message serialization in `apps/web/lib/tak/agent-coworker-data.ts`
- existing `TaskRun` creation sites: `apps/web/lib/deliberation/orchestrator.ts:313` and `apps/web/lib/mcp-tools.ts:2553`

Relevant current `TaskRun` shape (fields that intersect with the A2A envelope):

- `taskRunId String @unique` — already a stable external ID
- `threadId String?` — already a de-facto context pointer
- `routeContext String?` — already carries route/persona context
- `status String @default("active")` — values: `active | awaiting_human | completed | failed | cancelled | archived`
- `authorityScope Json?` — already a governance blob
- `progressPayload Json?` — already a progress/status blob

Section "Data Model Changes" below calls out how the new A2A-aligned fields reconcile with this existing shape rather than duplicating it.

### Live DB Snapshot on 2026-04-23

The live platform state in this install is important because it shows what is structurally present versus operationally active:

- `154` `AgentThread` rows
- `50` `AgentMessage` rows
- `26` `ToolExecution` rows
- `5` `TaskRun` rows
- `0` `TaskNode` rows
- `0` `DelegationGrant` rows
- `0` `AgentActionProposal` rows
- `0` `ScheduledAgentTask` rows
- `0` `DelegationChain` rows
- `0` `AuthorizationDecisionLog` rows
- `0` `PhaseHandoff` rows

This means the runtime already records coworker conversations and tool activity, and it already has a task substrate, but the task substrate is not yet the canonical coworker collaboration model.

## Research and Benchmarking

### A2A Reality Check

As of 2026-04-23, the official A2A project is hosted by the Linux Foundation under `a2aproject`, and the current released spec line in the upstream repository is `1.0.0`.

The current A2A protocol defines:

- `AgentCard`
- `Task`
- `TaskStatus`
- `TaskState`
- `Message`
- `Part`
- `Artifact`
- `TaskStatusUpdateEvent`
- `TaskArtifactUpdateEvent`
- task APIs such as `SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask`, and `SubscribeToTask`

The current A2A task lifecycle explicitly includes:

- `SUBMITTED`
- `WORKING`
- `COMPLETED`
- `FAILED`
- `CANCELED`
- `INPUT_REQUIRED`
- `REJECTED`
- `AUTH_REQUIRED`

The current A2A `AgentCard` also includes:

- supported interfaces
- capabilities
- skills
- default input and output modes
- security schemes
- security requirements
- optional authenticated extended agent card support

Primary references:

- [A2A latest specification](https://a2a-protocol.org/latest/specification/)
- [A2A upstream specification repository](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)
- [A2A authoritative proto](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto)

### What A2A Does Cover

A2A already provides useful facilities for this project:

- agent discovery and capability declaration
- skill declaration
- task and artifact lifecycle semantics
- message and part structure
- streaming task status and artifact updates
- security scheme declaration using API key, HTTP auth, OAuth2, OIDC, and mTLS
- explicit `AUTH_REQUIRED` task interruption semantics

In practice, this means A2A already gives DPF a solid carrier for:

- what an agent says it can do
- which skills it exposes
- how it can be contacted
- what authentication schemes it expects
- how task progress and artifact output move across the wire

### What A2A Does Not Fully Cover

A2A does not by itself define:

- enterprise RBAC or human authority semantics
- delegated approval workflows
- portable proof of present authorization
- stable issuer-backed agent identity and continuity semantics
- chain-of-custody receipts at `GAID` depth
- runtime enforcement semantics at `TAK` depth
- a rich native limitation vocabulary for denied action classes, approval requirements, prohibited domains, tenant restrictions, or sensitivity ceilings

This makes A2A an excellent interaction and task carrier, but not a substitute for `TAK` or `GAID`.

The practical boundary is:

- A2A can declare capabilities, skills, interfaces, and auth schemes
- A2A can interrupt work for auth or input requirements
- A2A does not by itself provide a strong standardized way to express all of the material limitations and governance constraints that DPF wants to prove through `TAK` and `GAID`

## Gap Analysis: Current DPF vs A2A

| Area | Current DPF | Current A2A | Gap |
|------|-------------|-------------|-----|
| Agent discovery | Route-local agent resolution and registry-backed metadata | `AgentCard` with skills, interfaces, auth requirements | DPF lacks a canonical internal Agent Card projection |
| Work unit | `AgentThread` plus side-table workflow records; `TaskRun` exists but is not canonical | `Task` is canonical | DPF needs one canonical task model for coworker work |
| Task state | Mix of thread, message, proposal, and queue semantics | Explicit `TaskState` | DPF needs task-state normalization across coworker flows |
| Message model | `AgentMessage` is chat-centric and string-content only | `Message` with `Part`, `taskId`, `contextId`, references | DPF needs task-native messages with part/content envelopes |
| Artifact model | Outputs live in feature records, handoffs, verification payloads, tool results, and free-text messages | `Artifact` is explicit | DPF needs first-class task artifacts |
| Streaming | Event bus and SSE already exist | task status and artifact update events | DPF needs A2A-shaped event semantics on top of existing SSE |
| Cancel and subscribe | thread-based SSE, no canonical task subscription surface | `SubscribeToTask`, `CancelTask` | DPF needs task-centric status and cancellation service boundaries |
| Auth declaration | user capability and agent grants are enforced in runtime | `AgentCard` security declarations, `AUTH_REQUIRED` state | DPF needs projection of actual auth posture into task and card metadata |
| Approval and delegation | strong primitives exist | no rich built-in approval or RBAC model | DPF should keep these as `TAK`/platform extensions |
| Identity and receipts | strong standards direction in `GAID`, limited runtime projection today | not core to A2A | DPF should layer `GAID` identity and receipt semantics onto A2A task carriers |

## Design Goals

1. Make internal coworker collaboration task-native now.
2. Use the existing `TaskRun` and `TaskNode` substrate rather than inventing a second work graph.
3. Preserve current governance:
   - human approval where required
   - delegation grants
   - audit logging
   - tool-grant enforcement
4. Preserve current coworker UX during migration.
5. Make the internal runtime structurally compatible with A2A task, artifact, message, and card concepts.
6. Make room for stronger auth and RBAC work already happening in parallel.
7. Encode `TAK` and `GAID` concepts in the runtime as explicit envelope fields and profiles, not only in documents.

## Non-Goals

1. Claiming immediate public A2A compliance.
2. Replacing existing coworker chat UX in one cutover.
3. Replacing `TAK` or `GAID` with A2A.
4. Implementing finance business logic beyond a neutral handoff example.
5. Publishing public `GAID` issuance, external transparency logs, or public verifier infrastructure in this effort.

## Recommended Architecture

### Options Considered

1. **Thin adapter:** leave the runtime chat-first and add an outward A2A adapter over `AgentThread`. Cheap to land, but keeps task-shape debt internal forever and produces a misleading external view.
2. **Flag-day rewrite:** replace `AgentThread` with a task-native model in one cut. Architecturally clean but destabilizing and blocks every other initiative for the duration.
3. **Staged task-native core with compatibility projection:** build the canonical task-native substrate now, run it alongside `AgentThread` as a compatibility and presentation layer, then cut the runtime over in a second phase.

### Core Decision

DPF should take option 3 through a two-phase migration:

- phase 1 builds the canonical task-native core under compatibility adapters
- phase 2 cuts the coworker runtime over to that core as the primary model and adds protocol projection

This avoids the thin-adapter trap (option 1) while still preventing a destabilizing flag-day rewrite (option 2).

## Canonical Internal Mapping

### `Task`

The canonical internal `Task` becomes `TaskRun`.

`TaskRun` is extended to carry:

- A2A-aligned task identity and status
- stable `contextId`
- initiating and acting agent references
- parent/child and handoff lineage
- governance and authority envelope metadata
- links to task messages, artifacts, audit records, proposals, and delegation records

### `Task decomposition`

`TaskNode` remains the canonical internal decomposition and worker-assignment substrate.

This is platform-specific and remains below the A2A core task projection. A2A does not require internal node graphs, and DPF should keep them as a stronger internal orchestration layer.

### `Message / context`

DPF should introduce a task-native message model rather than relying on `AgentMessage` as the source of truth.

Recommended shape:

- add a new `TaskMessage` model linked to `TaskRun`
- represent message content as `parts` JSON compatible with the A2A `Part` concept
- preserve `messageId`, `taskId`, and `contextId`
- allow reference-task links and structured metadata

`AgentThread` remains during migration as the current human-facing context container.

Phase 1 rule:

- `AgentThread` is the compatibility and presentation context
- `TaskRun.contextId` is introduced explicitly
- user-visible coworker messages are projected to and from `TaskMessage`

### `Artifact`

DPF should introduce a new `TaskArtifact` model linked to `TaskRun`.

Artifacts should absorb and normalize outputs that are currently scattered across:

- phase handoffs
- verification summaries
- deliberation outputs
- generated evidence digests
- structured coworker handoff payloads

The artifact payload should use `parts` JSON aligned to A2A content semantics and carry metadata such as:

- artifact type
- producer agent
- producing node
- evidence references
- append/final-chunk semantics when needed

### `Agent Card`

DPF should add an internal `AgentCard` projection service rather than treating the registry, agent record, and governance tables as separate sources.

The internal card should project from:

- `Agent`
- `AgentExecutionConfig`
- `AgentGovernanceProfile`
- `AgentToolGrant`
- `AgentSkillAssignment`
- `GAID`/`AIDoc` projection data when available

This card becomes the canonical bridge between DPF agent metadata and future A2A publication.

## Governance Envelope Model

DPF should attach a governed envelope to each canonical task.

Recommended internal shape:

- `taskCore`
  - `taskId`
  - `contextId`
  - `state`
  - `statusMessage`
  - `createdAt`
  - `updatedAt`
- `authority`
  - initiating principal
  - acting agent
  - route context
  - sensitivity
  - portable authorization classes
  - local capability grants
  - agent tool grants
- `oversight`
  - `hitlPolicy`
  - proposal requirements
  - approval authority metadata
  - active or required delegation grants
- `custody`
  - parent task
  - parent receipt
  - trace context
  - delegation chain references
- `identity`
  - internal agent ID
  - optional `GAID`
  - `AIDoc` reference
  - operating profile fingerprint
- `evidence`
  - artifact references
  - audit references
  - verification references

This envelope is the right place to combine A2A task semantics with `TAK` and `GAID` semantics.

## What Stays Core vs What Becomes Extension

### Core A2A-Compatible Fields

The following should be modeled as core fields or first-class projections:

- agent card identity, interfaces, skills, capabilities, input and output modes, and security declarations
- task ID
- context ID
- task state
- status message
- task history
- task artifacts
- task status and artifact update events
- cancel and subscribe semantics

### DPF / TAK / GAID Extensions

The following should remain platform or standards-family extensions layered onto the core:

- human authority chain
- platform role and capability resolution
- agent tool grant intersection
- proposal and approval metadata
- delegation grant references
- route context and sensitivity labels
- declared limitation profiles
- `GAID`, `AIDoc`, and operating profile fingerprints
- receipt IDs and evidence references
- audit class and capability ID

These are not deviations from the goal. They are the reason DPF is a proving ground.

## A2A Authentication and Authorization Position

Yes, A2A has a real facility here, but it is a base facility, not a full governance stack.

DPF should explicitly position the layers as:

- **A2A** handles interaction-level auth declaration and interruption semantics
- **TAK** handles runtime authorization, approval, execution gating, and oversight
- **GAID** handles stable identity, card-to-identity binding, authorization classes, and receipts

That means the ongoing RBAC and stronger-auth work should be layered in, not treated as out of scope.

Recommended runtime behavior:

- `AgentCard` projection declares security schemes and security requirements
- tasks can enter `auth-required` when the runtime needs stronger auth or delegated authority
- current user and agent authorization remains resolved through DPF policy and grants
- approval-required work continues to use proposal-mode controls rather than pretending A2A auth solves approval
- `GAID` authorization classes are projected into task and receipt metadata

DPF should also explicitly project limitation semantics beyond the base A2A shape:

- `AgentCard` and skill declarations describe exposed capabilities and required auth
- `GAID` `AIDoc` carries richer declared limitation metadata and authorization classes
- `TAK` runtime state carries the actually enforced permission set, approval posture, and runtime limitation envelope

That separation is important for honesty:

- A2A tells peers how to interact
- `GAID` tells peers what the identified agent claims about capability and limitation posture
- `TAK` tells operators and auditors what the runtime will actually enforce

## Proposed Service Boundaries

### New Internal Services

1. `task-envelope-service`
   - creates and updates canonical `TaskRun` records
   - normalizes task states
   - resolves task context and lineage

2. `task-message-service`
   - persists and retrieves `TaskMessage`
   - projects to and from `AgentMessage`

3. `task-artifact-service`
   - persists and streams `TaskArtifact`
   - normalizes handoffs and evidence outputs

4. `agent-card-service`
   - projects an internal A2A-shaped card from agent, governance, grant, skill, and identity data

5. `task-governance-linker`
   - attaches proposals, grants, authorization decisions, tool executions, and delegation records to canonical task IDs

### Existing Services to Refactor

- `apps/web/lib/actions/agent-coworker.ts`
- `apps/web/lib/tak/agentic-loop.ts`
- `apps/web/lib/mcp-tools.ts`
- `apps/web/lib/actions/agent-task-scheduler.ts`
- `apps/web/lib/tak/agent-event-bus.ts`
- `apps/web/app/api/agent/send/route.ts`
- `apps/web/app/api/agent/stream/route.ts`

## Data Model Changes

### Phase 1 Additions

Extend `TaskRun` with net-new fields only. Existing fields are reused rather than duplicated.

| Field | Purpose | Relationship to existing `TaskRun` |
|-------|---------|------------------------------------|
| `contextId` | Stable A2A context identifier | New; during phase 1, backfilled from `threadId` when a thread exists, else a fresh UUID |
| `initiatingAgentId` | Agent or principal that originated the task | New |
| `currentAgentId` | Agent currently acting on the task | New |
| `parentTaskRunId` | Parent task in a handoff chain | New (self-reference) |
| `a2aMetadata Json?` | A2A-shaped extensions not captured elsewhere (history cursor, reference-task IDs, etc.) | New |

The existing `status String` field is kept as the storage column; an A2A `TaskState` vocabulary is added as a value-level migration, not a second column (see "State Vocabulary Migration" below). The existing `authorityScope Json?`, `progressPayload Json?`, and `routeContext String?` fields already carry governance, progress, and route data — new governance envelope sections project through these fields (see "Governance Envelope Storage" below) rather than adding a parallel `governanceEnvelope` column.

Additional models and links:

1. Add `TaskMessage`
   - `taskRunId`
   - `messageId`
   - `contextId`
   - `role`
   - `parts`
   - `metadata`
   - `referenceTaskIds`
   - `createdAt`

2. Add `TaskArtifact`
   - `taskRunId`
   - `artifactId`
   - `name`
   - `description`
   - `parts`
   - `metadata`
   - `producerAgentId`
   - `producerNodeId`
   - `createdAt`

3. Add nullable `taskRunId` links where appropriate to:
   - `ToolExecution`
   - `AgentActionProposal`
   - `DelegationGrant`
   - `AuthorizationDecisionLog`
   - `ScheduledAgentTask`
   - `DelegationChain`
   - `AgentMessage`
   - `PhaseHandoff`

### State Vocabulary Migration

The existing `TaskRun.status` values (`active | awaiting_human | completed | failed | cancelled | archived`) do not map 1:1 to A2A `TaskState` (`submitted | working | input-required | auth-required | completed | failed | canceled | rejected`). Proposed reconciliation without adding a parallel column:

| Current `status` | A2A `TaskState` | Notes |
|------------------|-----------------|-------|
| `active` | `working` | Default once a worker has picked it up |
| `awaiting_human` | `input-required` | Maps to the A2A interruption state when HITL is required |
| — (new) | `submitted` | New initial value; `startedAt` remains the transition marker |
| — (new) | `auth-required` | New value used when authorization must be re-obtained mid-task |
| — (new) | `rejected` | New value for policy-denied tasks |
| `completed` | `completed` | 1:1 |
| `failed` | `failed` | 1:1 |
| `cancelled` | `canceled` | Canonicalize to the A2A spelling |
| `archived` | — | Retained as a DPF-internal post-terminal state |

Implementation: a single migration rewrites existing rows, updates the default to `submitted`, and documents the A2A values in a comment next to the column. Code enforces the new vocabulary via `lib/backlog.ts`-style `TASK_STATES` const (see CLAUDE.md "Strongly-Typed String Enums" rules — any new value requires updating both the canonical `as const` array and any MCP tool `enum:` declarations in the same commit).

### Governance Envelope Storage

The conceptual envelope in "Governance Envelope Model" above is a *logical* shape, not a new column. It is stored as follows:

- `taskCore` → derived from `TaskRun` scalar columns
- `authority` → `TaskRun.authorityScope` (existing `Json?`, extended in place)
- `oversight` → `TaskRun.authorityScope.oversight` sub-object (same column)
- `custody` → `TaskRun.a2aMetadata.custody` plus `parentTaskRunId` + `DelegationChain` links
- `identity` → resolved at read time via the `agent-card-service` projection, not persisted on `TaskRun`
- `evidence` → resolved at read time via `TaskArtifact` + `ToolExecution` + `AuthorizationDecisionLog` joins

This avoids duplicating data across a new `governanceEnvelope` column and the existing `authorityScope` / `progressPayload` fields.

### Phase 2 Hardening

1. Reduce mandatory dependence on `AgentThread` for coworker-to-coworker execution.
2. Make `TaskRun` and `TaskMessage` the primary read path for coworker execution state.
3. Keep `AgentThread` as chat context and user-facing conversation grouping.

## Two-Phase Migration

### Phase 1: Canonical Task Core Under Compatibility Adapters

Phase 1 establishes the real architecture without breaking current chat UX.

Deliverables:

- canonical task envelope on `TaskRun`
- new `TaskMessage` and `TaskArtifact`
- governance and audit tables linked to canonical task IDs
- internal `AgentCard` projection
- A2A-shaped status and artifact events over the existing event bus and SSE
- compatibility projection between current `AgentThread` / `AgentMessage` UX and the new task-native substrate

Success criteria:

- every new coworker handoff can be represented as a canonical task
- every consequential action can be traced back to a canonical task ID
- approval, delegation, and audit records can be joined through the task envelope
- current coworker chat still works

### Phase 2: Runtime Cutover and Protocol Projection

Phase 2 makes the task-native substrate the default runtime model rather than a compatibility layer.

Deliverables:

- coworker-to-coworker handoff uses canonical tasks everywhere
- user-visible coworker views are projections over canonical task and task-message state
- internal task subscribe and cancel semantics become first-class
- internal and optionally private A2A-style API surfaces can be added
- `GAID` / `AIDoc` / authorization class / receipt projection is carried through task and card surfaces

Success criteria:

- chat is a client over tasks, not the governing runtime model
- internal runtime is accurately describable as A2A-shaped
- exposing real A2A endpoints later is primarily projection work

## TAK Updates Required

The `TAK` standard and family docs should be updated to include:

1. explicit task-envelope guidance for multi-agent runtime work
2. a normative distinction between:
   - task core semantics
   - runtime governance envelope
   - carrier protocol profile
3. task-state guidance aligned with interrupted states such as `input-required` and `auth-required`
4. task-bound audit and evidence requirements
5. task-bound delegation and approval chain requirements
6. guidance for task status and artifact event projection over external protocols

## GAID Updates Required

The `GAID` standard and family docs should be updated to include:

1. explicit A2A profile language for:
   - Agent Card to `GAID` mapping
   - `AIDoc` reference in agent card or extended card
   - task and artifact event custody metadata
2. receipt guidance tied to canonical task IDs
3. guidance for projecting portable authorization classes into task metadata
4. guidance for binding task and artifact events to agent identity and parent receipts

## Risks

1. If `TaskRun` is only lightly extended and coworker logic still fundamentally depends on `AgentThread`, the platform will retain hidden debt.
2. If task messages and artifacts are not made first-class, handoffs will continue to leak through free-text chat.
3. If task IDs are not attached to audit and governance records, DPF will still fall short of a convincing `TAK` and `GAID` proving-ground story.
4. If this effort tries to expose public A2A endpoints too early, it will compete with core runtime cleanup.

## Open Questions

1. Should `AgentThread` remain the internal `contextId` carrier in phase 1, or should a dedicated `TaskContext` model be introduced immediately?
2. Should receipts be modeled as a dedicated table in this effort, or should phase 1 link existing audit records first and defer cryptographic receipt hardening to follow-on work?
3. How much of the ongoing RBAC and stronger-auth work can be referenced directly in the first `auth-required` task-state implementation?

## What Should Wait

These should wait until phase 2 or a direct follow-on:

- public A2A endpoint exposure
- signed public `AgentCard` publication
- external `GAID-Public` issuance and transparency logging
- full cryptographic receipt and verifier material publication

## Recommendation

DPF should proceed with a two-phase migration to an A2A-shaped, task-native coworker runtime.

The platform should treat A2A as the interoperable task and card carrier, and treat `TAK` and `GAID` as the stronger runtime-governance and identity layers carried on top of it.

That is the architecture most aligned with DPF’s role as a proving ground, and it avoids both fake conformance and deferred core debt.
