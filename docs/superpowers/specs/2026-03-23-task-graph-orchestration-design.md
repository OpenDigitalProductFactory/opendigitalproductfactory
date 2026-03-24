# Task Graph Orchestration Design

**Date:** 2026-03-23  
**Status:** Draft  
**Authors:** Mark Bodman + Codex (design partner)  
**Parent spec:** `2026-03-23-task-governance-control-plane-design.md`  
**Related existing epics:** `EP-AGENT-EXEC-001`, `EP-AI-UX`  
**Related existing code:**  
- `apps/web/lib/agentic-loop.ts`  
- `apps/web/lib/routing/request-contract.ts`  
- `apps/web/lib/routing/pipeline-v2.ts`  
- `apps/web/lib/routing/route-outcome.ts`  
- `apps/web/lib/actions/build.ts`  
- `apps/web/lib/feature-build-types.ts`  
- `apps/web/lib/semantic-memory.ts`

---

## Problem Statement

The platform has execution primitives, but not yet a canonical runtime work graph.

Current gaps:

1. The coworker can iterate with tools, but a non-trivial objective is not durably represented as a parent task with explicit child tasks.
2. Repeated task patterns can be noticed in chat, but there is no canonical decomposition template model behind them.
3. Build Studio has task-like structure in `FeatureBuild.buildPlan.tasks`, but it is scoped to build workflows and cannot serve as the shared runtime substrate for general coworker work.
4. HITL and audit already exist, but there is no node-level authority envelope and evidence contract.
5. Non-technical users need this orchestration to feel inherent and self-maintaining, not like a workflow engine they must manage directly.

The platform needs a single canonical runtime model for governed task decomposition.

---

## Goals

1. Introduce a canonical task-run and task-node model for governed runtime work.
2. Keep chat as the primary human interface.
3. Represent decomposition, dependencies, checkpoints, approvals, verification, and summaries explicitly.
4. Attach authority and evidence requirements at the node level.
5. Record complete execution-chain traceability across advisory and execution nodes.
6. Support repeated-task detection and promotion into reusable templates or skills.
7. Make graph creation, maintenance, pruning, and cleanup inherent platform behavior.

## Non-Goals

1. Building a user-facing graph editor.
2. Replacing Build Studio with the task graph in one step.
3. Modeling collective reasoning in detail here. That belongs to the follow-on consensus spec.
4. Modeling the full specialist catalog here. That belongs to the specialist ecosystem spec.

---

## Design Summary

Introduce two new canonical runtime models:

- `TaskRun`: the parent session-scoped objective container
- `TaskNode`: a child work unit inside the run

The coworker creates and manages these automatically. The user mainly experiences:

- a conversational interface
- concise progress and approval prompts
- skill suggestions
- optimization proposals for repeated work

The graph is the platform's internal execution surface. Chat is the user surface.

---

## Canonical Runtime Model

### `TaskRun`

Represents one meaningful session-scoped objective.

Suggested fields:

```prisma
model TaskRun {
  id                    String   @id @default(cuid())
  taskRunId             String   @unique
  threadId              String?
  userId                String
  routeContext          String?
  title                 String
  objective             String   @db.Text
  source                String   @default("coworker") // coworker | build | skill | proactive
  status                String   @default("active")   // active | awaiting_human | completed | failed | cancelled | archived
  authorityScope        Json?    // current session-scoped authority envelope
  repeatedPatternKey    String?
  templateId            String?
  startedAt             DateTime @default(now())
  completedAt           DateTime?
  archivedAt            DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  nodes                 TaskNode[]

  @@index([userId, status])
  @@index([threadId])
  @@index([routeContext, status])
}
```

### `TaskNode`

Represents one child unit of work.

Suggested fields:

```prisma
model TaskNode {
  id                    String   @id @default(cuid())
  taskNodeId            String   @unique
  taskRunId             String
  parentNodeId          String?
  taskRun               TaskRun  @relation(fields: [taskRunId], references: [id], onDelete: Cascade)
  parentNode            TaskNode? @relation("TaskNodeTree", fields: [parentNodeId], references: [id])
  childNodes            TaskNode[] @relation("TaskNodeTree")

  nodeType              String   // analyze | plan | execute | review | skeptical_review | activation_proposal | approval_gate | verify | summarize
  title                 String
  objective             String   @db.Text
  status                String   @default("queued") // queued | ready | running | blocked | awaiting_human | completed | failed | cancelled | superseded
  workerRole            String   // planner | researcher | executor | reviewer | skeptical_reviewer | verifier | activation_analyst | summarizer

  dependencyMode        String?  // all_of | any_of | after_parent
  authorityEnvelope     Json?
  evidenceContract      Json?

  requestContract       Json?
  routeDecision         Json?
  inputSnapshot         Json?
  outputSnapshot        Json?

  costUsd               Float?
  latencyMs             Int?
  inputTokens           Int?
  outputTokens          Int?

  influenceLevel        String?  // none | contextual | material
  supersededByNodeId    String?
  startedAt             DateTime?
  completedAt           DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([taskRunId, status])
  @@index([parentNodeId])
  @@index([nodeType, status])
  @@index([workerRole, status])
}
```

### `TaskNodeEdge`

Optional explicit edge model if parent/child alone is insufficient.

Use this if the implementation needs cross-branch dependencies without abusing `parentNodeId`.

```prisma
model TaskNodeEdge {
  id             String   @id @default(cuid())
  fromNodeId     String
  toNodeId       String
  edgeType       String   // depends_on | informs | verifies | blocks | supersedes
  createdAt      DateTime @default(now())

  @@unique([fromNodeId, toNodeId, edgeType])
  @@index([toNodeId])
}
```

Recommendation: start with `parentNodeId` plus `TaskNodeEdge`. The graph needs both hierarchy and cross-node dependency.

---

## Node Types

Initial supported node types:

- `analyze`
- `plan`
- `execute`
- `review`
- `skeptical_review`
- `activation_proposal`
- `approval_gate`
- `verify`
- `summarize`

This is intentionally small. New node types should only be added when they change lifecycle or authority behavior materially.

---

## Status Model

Suggested statuses:

- `queued`
- `ready`
- `running`
- `blocked`
- `awaiting_human`
- `completed`
- `failed`
- `cancelled`
- `superseded`

Rules:

- `queued` means dependencies not yet satisfied
- `ready` means executable now
- `awaiting_human` means paused on approval, clarification, or authority
- `superseded` is used when the platform safely folds duplicate or obsolete nodes into a better route

---

## Authority Envelope

Every node carries its own authority envelope. Do not infer authority from the whole run.

Suggested envelope shape:

```json
{
  "mode": "advisory",
  "mayUseInternalActiveResources": true,
  "mayUseExternalActiveResources": false,
  "mayMutatePlatformState": false,
  "mayPrepareActivationProposal": false,
  "requiresHumanApproval": false,
  "requiresSessionHandsOnPlatform": false,
  "requiresSessionHandsOnExternal": false,
  "consequenceDisclosureShown": false
}
```

Typical examples:

- `analyze`: advisory only
- `activation_proposal`: may prepare proposal, may not execute enablement
- `execute` on an internal mutating action: requires session hands-on platform if mutating
- `execute` on an external costly action: requires session hands-on external plus consequence disclosure
- `approval_gate`: always `awaiting_human`

Session-scoped authority expires automatically when the session disconnects or times out.

---

## Evidence Contract

Each node also carries an explicit evidence contract.

Suggested shape:

```json
{
  "requiresReasoningSummary": true,
  "requiresSources": false,
  "requiresToolLogs": true,
  "requiresRouteSnapshot": true,
  "requiresCostLatency": true,
  "requiresVerification": false,
  "requiresDissentCapture": false,
  "requiresArtifactRefs": []
}
```

This ensures node outputs are useful for:

- evidence requirements
- debugging
- postmortems
- future optimization

---

## Graph Lifecycle

### Creation

The graph should be created automatically when a meaningful objective is detected in chat or when a skill/build pattern starts a new governed run.

Triggers:

- explicit user objective in chat
- Build Studio phase transition into structured work
- replay of a reusable skill or workflow template
- proactive optimization proposal accepted by the user

### Maintenance

The system should maintain graph hygiene itself:

- merge duplicate nodes when safe
- mark obsolete paths `superseded`
- convert stalled nodes into follow-up proposals or archived evidence
- attach new turns to the existing active run where appropriate

### Cleanup

For non-technical users, cleanup must be inherent:

- completed nodes remain as evidence
- transient advisory-only nodes can be archived aggressively
- abandoned session authority expires automatically
- orphaned or stale nodes are archived or superseded

The user should not manage graph hygiene manually.

---

## Repetition, Skills, and Optimization

The graph substrate is the runtime basis for repetitive-task detection.

### Pattern Detection

When multiple task runs or node sequences are materially similar, the platform should derive:

- a `repeatedPatternKey`
- a candidate reusable template
- a potential user-facing skill or optimization proposal

### User-Facing Behavior

The coworker should be able to say:

- "I see you doing this repeatedly."
- "Here is a safer or faster route."
- "I can package this as a reusable skill."

### Storage

Do not store only prompt text. Store:

- graph pattern signature
- route success characteristics
- authority requirements
- evidence requirements
- whether users accepted the optimization

This lets skills become governed task-graph templates rather than mere shortcuts.

---

## Worker Assignment Model

Each node should separate:

1. **Worker role**
2. **Specialist fit requirement**
3. **Concrete route**

This means:

- the graph chooses the role needed
- the specialist ecosystem later determines eligible resources
- the current routing stack chooses the concrete provider/model/tool/resource

This is critical for future provider growth, including NVIDIA and future ecosystems, because worker roles remain stable while concrete resources evolve.

---

## Checkpoints

The graph must support explicit checkpoints.

Recommended checkpoint triggers:

- before employing an inactive or not-yet-employed specialist resource
- before external cost beyond the current safe envelope
- before important state mutation
- after meaningful dissent or skeptical review
- when the route deviates from the preferred policy path
- when repeated-task detection suggests optimization
- before stronger autonomy is requested

At a checkpoint, the coworker should present:

- what has been done
- recommended next route
- important cost/risk implications
- policy-aligned alternatives
- approval or authority needed

---

## Traceability Model

Traceability must be end-to-end and reconstructable.

For each node, record:

- `parentTaskRunId`
- `parentNodeId`
- `nodeType`
- `workerRole`
- `requestContractSnapshot`
- `selectedRouteSnapshot`
- `authoritySnapshot`
- `inputs`
- `outputs`
- `evidenceRefs`
- cost, latency, and tokens
- dissent / objections
- approval / refusal events
- status transitions
- whether the node materially influenced the outcome

This should integrate with existing systems rather than replace them:

- `RouteOutcome`
- `RecipePerformance`
- `AgentActionProposal`
- `AuthorizationDecisionLog`
- `FeatureBuild` evidence
- semantic memory

---

## Integration with Existing Models

### `AgentThread`

Remains the conversational surface and thread history container.

It should link to active or recent `TaskRun` records, but should not be overloaded to represent the graph itself.

### `AgentActionProposal`

Should remain the approval artifact for consequential actions.

Task nodes of type `activation_proposal` or `approval_gate` may emit proposals, but the proposal model remains the canonical HITL action object.

### `FeatureBuild`

Should remain the canonical build-work package and evidence record.

Do not replace it. Instead:

- a build may own or reference one or more `TaskRun`s
- `FeatureBuild.buildPlan.tasks` should later be mapped to canonical `TaskNode`s

### `RouteOutcome`

Should remain route-level execution telemetry.

Task-node execution should reference or aggregate route outcomes rather than replacing them.

---

## Schema Stewardship Decision

This spec introduces a new canonical shared concept: `TaskRun`.

That is preferable to overloading:

- `BacklogItem` for runtime work
- `FeatureBuild` for all orchestration
- `AgentThread` for execution state

This is a real schema-level refactoring decision: governed runtime work needs its own home.

---

## Migration Strategy

### Phase 1: Add Canonical Runtime Models

- add `TaskRun`
- add `TaskNode`
- optionally add `TaskNodeEdge`
- add lightweight links from `AgentThread` and `FeatureBuild`

### Phase 2: Attach Coworker Sessions

- create task runs automatically for meaningful coworker objectives
- attach turns to the active run
- record node status transitions and route snapshots

### Phase 3: Attach Build Studio

- map build-plan tasks into canonical task nodes
- keep existing build evidence fields intact
- expose checkpoints and verification nodes through existing Build Studio UX

### Phase 4: Repetition and Skill Promotion

- derive pattern signatures
- create reusable graph templates
- surface proactive optimization proposals

### Phase 5: Hand Off to Follow-On Specs

- collective reasoning nodes and skeptical review behavior
- specialist ecosystem employment and activation proposals

---

## Testing Strategy

### Unit Tests

- task-run creation from chat objective
- node dependency resolution
- authority-envelope enforcement
- evidence-contract enforcement
- duplicate-node merge / supersede logic
- session-authority expiry behavior

### Integration Tests

- coworker conversation creates a task run and child nodes
- execution node records route snapshot and telemetry
- approval-gate node emits a proposal and pauses correctly
- Build Studio task mapping creates canonical nodes without breaking existing build evidence
- repeated-task detection surfaces an optimization proposal

### UX Verification

For non-technical users, verify that:

- chat remains the primary interface
- approvals are concise and understandable
- progress feels visible without graph noise
- repetitive-task optimization proposals feel helpful rather than intrusive

---

## Future Refactoring

1. Replace ad hoc task arrays inside `FeatureBuild.buildPlan` with references to canonical task nodes.
2. Add specialized node templates for domain workflows after the substrate stabilizes.
3. Expose a lightweight human-readable execution timeline instead of a raw graph for normal users.
4. Add retention policies that distinguish archival evidence from low-value transient advisory nodes.

---

## Follow-On Specs

After this spec, the next two should be:

1. `Collective Reasoning and Skeptical Consensus`
2. `Specialist Ecosystem and Innovation Intake`

Those two specs depend on the canonical task-node substrate defined here.
