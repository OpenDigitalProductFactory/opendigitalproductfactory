# EP-TASK-GOV-001: Task Governance Control Plane & Orchestration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable task-run and task-node substrate that governs coworker and Build Studio work with node-level authority, evidence, checkpoints, repeated-task detection, and end-to-end traceability while keeping chat as the primary user surface.

**Architecture:** Introduce new Prisma runtime models for `TaskRun`, `TaskNode`, and `TaskNodeEdge`, then layer a focused orchestration library on top of the existing coworker, routing, governance, and Build Studio flows. Keep routing, proposals, and audit systems intact, but thread task references and evidence snapshots through them so runtime work becomes reconstructable and reusable instead of being trapped in chat turns or build-plan JSON.

**Tech Stack:** Next.js 14 server actions, Prisma 5, PostgreSQL, TypeScript (strict), React 18, Vitest, existing route telemetry and governance helpers.

**Specs:** `docs/superpowers/specs/2026-03-23-task-governance-control-plane-design.md`, `docs/superpowers/specs/2026-03-23-task-graph-orchestration-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `packages/db/prisma/migrations/<timestamp>_task_governance_runtime/migration.sql` | Add `TaskRun`, `TaskNode`, `TaskNodeEdge` and supporting indexes/FKs |
| `apps/web/lib/task-governance-types.ts` | Runtime types, enums, JSON envelope helpers, presenter-safe DTOs |
| `apps/web/lib/task-governance-data.ts` | Prisma data access for task runs, nodes, dependencies, and summaries |
| `apps/web/lib/task-governance-orchestrator.ts` | Core orchestration rules: create/reuse run, create nodes, unlock dependencies, supersede stale work |
| `apps/web/lib/task-governance-presenter.ts` | Convert task graph state into concise user-facing summaries and checkpoint prompts |
| `apps/web/lib/task-patterns.ts` | Repeated-pattern fingerprinting and optimization proposal helpers |
| `apps/web/lib/build-task-governance.ts` | Build Studio mapping between `FeatureBuild` evidence/tasks and canonical task nodes |
| `apps/web/lib/task-governance-types.test.ts` | Unit tests for envelope validation and summary shaping |
| `apps/web/lib/task-governance-data.test.ts` | Data-layer tests for run/node creation and retrieval |
| `apps/web/lib/task-governance-orchestrator.test.ts` | Dependency, supersede, and checkpoint orchestration tests |
| `apps/web/lib/task-patterns.test.ts` | Repetition detection and optimization proposal tests |
| `apps/web/lib/build-task-governance.test.ts` | Build Studio task mapping tests |
| `apps/web/components/agent/TaskRunSummaryCard.tsx` | Small theme-aware summary component for coworker progress/checkpoints |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add task runtime models and relations from `User`, `AgentThread`, and `FeatureBuild`-adjacent context |
| `packages/db/src/table-classification.ts` | Classify new runtime tables for sanitized clone and sensitivity handling |
| `packages/types/src/entities.ts` | Export typed Prisma payloads for new runtime models |
| `apps/web/lib/agent-coworker-types.ts` | Extend message payloads with task summary/checkpoint metadata |
| `apps/web/lib/agent-coworker-data.ts` | Serialize task summaries alongside messages where relevant |
| `apps/web/lib/actions/agent-coworker.ts` | Create/reuse task runs, attach nodes, emit checkpoints, record task evidence |
| `apps/web/lib/mcp-tools.ts` | Wrap immediate/proposal tool execution with task-node traceability hooks |
| `apps/web/lib/governance-data.ts` | Add task-aware audit log helpers without replacing existing decision logs |
| `apps/web/lib/routing/route-outcome.ts` | Accept optional task-run/task-node references in route telemetry |
| `apps/web/lib/actions/build.ts` | Create/manage build-scoped task runs and sync build evidence into task nodes |
| `apps/web/lib/feature-build-data.ts` | Read task summaries for Build Studio surfaces |
| `apps/web/lib/feature-build-types.ts` | Add lightweight task summary types for Build Studio rendering |
| `apps/web/lib/process-observer-hook.ts` | Feed repeated-task detection with task-run fingerprints instead of raw thread turns alone |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Render compact task summaries and checkpoint prompts |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Render task checkpoint/status context next to assistant output |
| `apps/web/components/build/BuildStudio.tsx` | Show build-linked task progress without exposing raw graph internals |

---

## Chunk 1: Runtime Substrate

### Task 1: Add canonical task runtime schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/table-classification.ts`
- Create: `packages/db/prisma/migrations/<timestamp>_task_governance_runtime/migration.sql`
- Modify: `packages/types/src/entities.ts`

- [ ] **Step 1: Add `TaskRun`, `TaskNode`, and `TaskNodeEdge` models to Prisma**

Add the new models near the existing agent/build runtime models. Use string-backed statuses and node types to match current schema style. Include:
- `TaskRun.taskRunId`, `userId`, optional `threadId`, optional `buildId`, `routeContext`, `title`, `objective`, `source`, `status`, `authorityScope`, `repeatedPatternKey`, `templateId`, `startedAt`, `completedAt`, `archivedAt`
- `TaskNode.taskNodeId`, `taskRunId`, optional `parentNodeId`, `nodeType`, `title`, `objective`, `status`, `workerRole`, `dependencyMode`, `authorityEnvelope`, `evidenceContract`, `requestContract`, `routeDecision`, `inputSnapshot`, `outputSnapshot`, `costUsd`, `latencyMs`, `inputTokens`, `outputTokens`, `influenceLevel`, `supersededByNodeId`, timestamps
- `TaskNodeEdge.fromNodeId`, `toNodeId`, `edgeType`

Define relations so `TaskRun` belongs to `User` and can optionally reference `AgentThread` and `FeatureBuild` without requiring backfill of existing rows.

- [ ] **Step 2: Classify new tables for sanitized clone and sensitivity**

Update `packages/db/src/table-classification.ts`:
- `TaskRun`: `confidential`
- `TaskNode`: `confidential`
- `TaskNodeEdge`: `confidential`

These rows can contain user objectives, provider/model traces, and evidence snapshots, so they must not default to `public` or `internal`.

- [ ] **Step 3: Export typed payloads for the new models**

Add exports in `packages/types/src/entities.ts`:

```ts
export type TaskRun = Prisma.TaskRunGetPayload<{
  include: { nodes: true };
}>;

export type TaskNode = Prisma.TaskNodeGetPayload<{
  include: { childNodes: true };
}>;

export type TaskNodeEdge = Prisma.TaskNodeEdgeGetPayload<{}>;
```

- [ ] **Step 4: Generate and inspect the migration**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter @dpf/db exec prisma generate
pnpm --filter @dpf/db exec prisma migrate dev --name task_governance_runtime
```

Verify the generated SQL creates only the new tables/indexes/FKs. No edits to old migration files.

- [ ] **Step 5: Validate Prisma schema**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter @dpf/db exec prisma validate
```

Expected: `The schema at packages/db/prisma/schema.prisma is valid`

- [ ] **Step 6: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/table-classification.ts packages/types/src/entities.ts
git commit -m "feat(db): add task governance runtime models"
```

---

### Task 2: Create shared runtime types and presenter-safe DTOs

**Files:**
- Create: `apps/web/lib/task-governance-types.ts`
- Create: `apps/web/lib/task-governance-types.test.ts`

- [ ] **Step 1: Write failing tests for runtime helpers**

Create `apps/web/lib/task-governance-types.test.ts` covering:
- authority envelope defaults for advisory nodes
- evidence contract defaults by node type
- status transition guards for `queued -> ready -> running -> completed`
- presenter-safe summary shaping for checkpoint nodes

Start with concrete expectations:

```ts
it("creates an advisory authority envelope for analyze nodes", () => {
  expect(buildAuthorityEnvelope("analyze")).toMatchObject({
    mode: "advisory",
    mayMutatePlatformState: false,
    requiresHumanApproval: false,
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-governance-types.test.ts
```

Expected: missing module/export failures.

- [ ] **Step 3: Implement the shared types module**

Create `apps/web/lib/task-governance-types.ts` with:
- `TaskNodeType`, `TaskNodeStatus`, `TaskWorkerRole` literal unions
- `AuthorityEnvelope`, `EvidenceContract`, `TaskRunSummary`, `TaskCheckpointSummary`
- helpers such as `buildAuthorityEnvelope(nodeType)` and `buildEvidenceContract(nodeType)`
- one pure helper that turns raw node/run data into a concise summary payload for UI use

Keep this file pure. No Prisma imports.

- [ ] **Step 4: Re-run the test**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-governance-types.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add apps/web/lib/task-governance-types.ts apps/web/lib/task-governance-types.test.ts
git commit -m "feat: add task governance runtime types"
```

---

## Chunk 2: Data Access and Orchestration

### Task 3: Create task-governance data access helpers

**Files:**
- Create: `apps/web/lib/task-governance-data.ts`
- Create: `apps/web/lib/task-governance-data.test.ts`

- [ ] **Step 1: Write failing data-layer tests**

Create tests for:
- creating a new task run linked to a thread
- creating child nodes and dependency edges
- listing ready nodes for a run
- marking obsolete sibling nodes as `superseded`

Follow the existing mock-Prisma style used in `apps/web/lib/semantic-memory.test.ts` and `apps/web/lib/governance.test.ts`.

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-governance-data.test.ts
```

- [ ] **Step 3: Implement the data helpers**

Create `apps/web/lib/task-governance-data.ts` with focused functions:
- `findActiveTaskRunForThread(threadId)`
- `createTaskRun(input)`
- `createTaskNode(input)`
- `createTaskNodeEdge(input)`
- `listTaskNodes(taskRunId)`
- `listReadyTaskNodes(taskRunId)`
- `updateTaskNodeStatus(taskNodeId, status, patch?)`
- `supersedeTaskNode(taskNodeId, supersededByNodeId)`
- `getTaskRunSummary(taskRunId)`

Keep business rules out of this file. This layer should only do durable reads/writes.

- [ ] **Step 4: Re-run the test**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-governance-data.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add apps/web/lib/task-governance-data.ts apps/web/lib/task-governance-data.test.ts
git commit -m "feat: add task governance data access layer"
```

---

### Task 4: Implement the orchestration service

**Files:**
- Create: `apps/web/lib/task-governance-orchestrator.ts`
- Create: `apps/web/lib/task-governance-orchestrator.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Cover the core workflow rules:
- create a run from a user objective and seed `analyze` + `plan` nodes
- unlock dependent nodes when predecessors complete
- generate an `approval_gate` node for mutating/proposal-required work
- keep advisory nodes advisory when no authority is present
- merge duplicate repeated nodes by superseding the stale one

Include one skeptic-oriented test even before the consensus epic:

```ts
it("creates a checkpoint node instead of auto-executing external work without session authority", async () => {
  // expect next node to be approval_gate or activation_proposal
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-governance-orchestrator.test.ts
```

- [ ] **Step 3: Implement the orchestrator**

Create `apps/web/lib/task-governance-orchestrator.ts` with pure orchestration functions built on the data layer:
- `ensureTaskRunForConversation(...)`
- `seedInitialTaskNodes(...)`
- `appendExecutionNode(...)`
- `appendCheckpointNode(...)`
- `resolveNodeStatusTransitions(...)`
- `detectAndSupersedeDuplicateNodes(...)`

Do not call LLMs here. This file should govern runtime state, not produce content.

- [ ] **Step 4: Re-run the tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-governance-orchestrator.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add apps/web/lib/task-governance-orchestrator.ts apps/web/lib/task-governance-orchestrator.test.ts
git commit -m "feat: add task governance orchestrator"
```

---

## Chunk 3: Coworker Integration

### Task 5: Attach task runs and summaries to coworker conversations

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/agent-coworker-data.ts`
- Modify: `apps/web/lib/agent-coworker-types.ts`
- Create: `apps/web/lib/task-governance-presenter.ts`

- [ ] **Step 1: Write failing coworker tests**

Extend `apps/web/lib/actions/agent-coworker-server.test.ts` or `apps/web/lib/actions/agent-coworker.test.ts` with cases for:
- first meaningful user objective creates a task run
- subsequent related turns reuse the active run
- assistant responses can return a compact task summary/checkpoint payload
- approval-requiring work surfaces `awaiting_human` summary metadata

- [ ] **Step 2: Run the affected coworker tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker-server.test.ts apps/web/lib/actions/agent-coworker.test.ts
```

- [ ] **Step 3: Implement task-run creation and summary serialization**

Modify `apps/web/lib/actions/agent-coworker.ts`:
- call `ensureTaskRunForConversation` after thread ownership validation
- seed initial nodes when the run is first created
- record execution/checkpoint nodes after route/tool/proposal decisions

Modify `apps/web/lib/agent-coworker-types.ts` and `apps/web/lib/agent-coworker-data.ts` so `AgentMessageRow` can carry:
- `taskRunId`
- `taskSummary`
- `checkpointSummary`

Create `apps/web/lib/task-governance-presenter.ts` to keep the summary text and display hints out of the server action.

- [ ] **Step 4: Re-run the coworker tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker-server.test.ts apps/web/lib/actions/agent-coworker.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add apps/web/lib/actions/agent-coworker.ts apps/web/lib/agent-coworker-data.ts apps/web/lib/agent-coworker-types.ts apps/web/lib/task-governance-presenter.ts
git commit -m "feat: attach task governance to coworker conversations"
```

---

### Task 6: Thread task references through tool execution, approvals, and route telemetry

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/governance-data.ts`
- Modify: `apps/web/lib/routing/route-outcome.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/actions/governance.test.ts`
- Modify: `apps/web/lib/mcp-tools.test.ts`
- Modify: `apps/web/lib/routing/route-outcome.test.ts`

- [ ] **Step 1: Write failing tests for task-aware telemetry**

Add expectations that:
- immediate tool executions can receive optional `taskRunId` / `taskNodeId`
- proposal approvals write task references into decision rationale
- route outcomes accept optional task references without breaking existing callers

- [ ] **Step 2: Run the affected tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/mcp-tools.test.ts apps/web/lib/actions/governance.test.ts apps/web/lib/routing/route-outcome.test.ts
```

- [ ] **Step 3: Implement task-aware traceability**

Modify:
- `apps/web/lib/mcp-tools.ts` to accept an optional execution context object containing task refs and write node snapshots/results when tools run
- `apps/web/lib/governance-data.ts` to add a helper for task-aware audit rationale payloads
- `apps/web/lib/routing/route-outcome.ts` to accept optional `taskRunId` and `taskNodeId` in `RouteOutcomeInput`

Keep all new fields optional so existing call sites continue to work until migrated.

- [ ] **Step 4: Re-run the affected tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/mcp-tools.test.ts apps/web/lib/actions/governance.test.ts apps/web/lib/routing/route-outcome.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add apps/web/lib/mcp-tools.ts apps/web/lib/governance-data.ts apps/web/lib/routing/route-outcome.ts apps/web/lib/actions/governance.test.ts apps/web/lib/mcp-tools.test.ts apps/web/lib/routing/route-outcome.test.ts
git commit -m "feat: thread task references through telemetry and approvals"
```

---

## Chunk 4: Build Studio Integration

### Task 7: Map Build Studio work into canonical task runs

**Files:**
- Create: `apps/web/lib/build-task-governance.ts`
- Create: `apps/web/lib/build-task-governance.test.ts`
- Modify: `apps/web/lib/actions/build.ts`
- Modify: `apps/web/lib/feature-build-data.ts`
- Modify: `apps/web/lib/feature-build-types.ts`

- [ ] **Step 1: Write failing Build Studio integration tests**

Add tests for:
- creating a build-scoped task run when a build enters `plan` or `build`
- mapping `FeatureBuild.buildPlan.tasks` into `TaskNode` rows without deleting existing JSON evidence
- deriving a concise task summary for the Build Studio UI
- keeping existing phase gates intact when task tracking is present

Use `apps/web/lib/build-disciplines-integration.test.ts` and `apps/web/lib/feature-build-types.test.ts` as anchors.

- [ ] **Step 2: Run the affected tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/build-disciplines-integration.test.ts apps/web/lib/feature-build-types.test.ts
```

- [ ] **Step 3: Implement build-to-task mapping**

Create `apps/web/lib/build-task-governance.ts` with functions:
- `ensureTaskRunForBuild(buildId, userId)`
- `syncBuildPlanTasksToTaskNodes(buildId, plan)`
- `buildTaskSummaryFromRun(taskRun)`

Modify `apps/web/lib/actions/build.ts` to call this layer when:
- advancing into `plan` / `build`
- saving build plan evidence
- retrying build execution after failure

Modify `apps/web/lib/feature-build-data.ts` and `apps/web/lib/feature-build-types.ts` so Build Studio can read a lightweight `taskSummary` instead of raw graph data.

- [ ] **Step 4: Re-run the Build Studio tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/build-task-governance.test.ts apps/web/lib/build-disciplines-integration.test.ts apps/web/lib/feature-build-types.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add apps/web/lib/build-task-governance.ts apps/web/lib/build-task-governance.test.ts apps/web/lib/actions/build.ts apps/web/lib/feature-build-data.ts apps/web/lib/feature-build-types.ts
git commit -m "feat: map Build Studio work into task governance runtime"
```

---

## Chunk 5: Repetition, Skills, and Non-Technical UX

### Task 8: Detect repeated task patterns and emit optimization proposals

**Files:**
- Create: `apps/web/lib/task-patterns.ts`
- Create: `apps/web/lib/task-patterns.test.ts`
- Modify: `apps/web/lib/process-observer-hook.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Write failing repetition tests**

Cover:
- generating a stable repeated-pattern fingerprint from similar task runs
- suppressing proposals for one-off or noisy runs
- creating an optimization proposal after repeated successful flows

- [ ] **Step 2: Run the repetition tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-patterns.test.ts apps/web/lib/process-observer.test.ts
```

- [ ] **Step 3: Implement the pattern detector**

Create `apps/web/lib/task-patterns.ts` with helpers such as:
- `buildRepeatedPatternKey(runSummary)`
- `shouldSuggestOptimization(recentRuns)`
- `buildOptimizationProposal(runSummary)`

Modify `apps/web/lib/process-observer-hook.ts` to prefer task-run fingerprints over raw message title heuristics when task governance data exists.

- [ ] **Step 4: Re-run the repetition tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-patterns.test.ts apps/web/lib/process-observer.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add apps/web/lib/task-patterns.ts apps/web/lib/task-patterns.test.ts apps/web/lib/process-observer-hook.ts apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: add repeated task detection and optimization proposals"
```

---

### Task 9: Render concise task summaries for non-technical users

**Files:**
- Create: `apps/web/components/agent/TaskRunSummaryCard.tsx`
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`

- [ ] **Step 1: Write focused component tests**

Add or extend component tests so they verify:
- task summary card uses theme variables only
- checkpoint prompts render recommended route, why, and required approval
- Build Studio shows concise progress without exposing raw node topology

If no existing component tests fit cleanly, add small presenter-driven tests around the summary props.

- [ ] **Step 2: Run the component tests**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-governance-types.test.ts apps/web/lib/build-task-governance.test.ts
```

- [ ] **Step 3: Implement the UI surfaces**

Build `TaskRunSummaryCard.tsx` and wire it into the coworker and build surfaces. Follow the platform theming rules:
- use `var(--dpf-*)` tokens only
- keep the card terse: status, recommended next step, blockers, approval need
- do not expose raw graph IDs or dependency jargon

- [ ] **Step 4: Re-run the affected tests**

Run the same test command, plus any new component test file.

- [ ] **Step 5: Commit**

```bash
cd h:/OpenDigitalProductFactory
git add apps/web/components/agent/TaskRunSummaryCard.tsx apps/web/components/agent/AgentCoworkerPanel.tsx apps/web/components/agent/AgentMessageBubble.tsx apps/web/components/build/BuildStudio.tsx
git commit -m "feat: add non-technical task progress summaries"
```

---

## Chunk 6: Verification and Rollout

### Task 10: Run full verification and update backlog state

**Files:**
- Modify: live backlog rows for `BI-TGOV-001` through `BI-TGOV-008` as work completes

- [ ] **Step 1: Run targeted Vitest suites**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/task-governance-types.test.ts apps/web/lib/task-governance-data.test.ts apps/web/lib/task-governance-orchestrator.test.ts apps/web/lib/build-task-governance.test.ts apps/web/lib/task-patterns.test.ts apps/web/lib/actions/agent-coworker-server.test.ts apps/web/lib/actions/agent-coworker.test.ts apps/web/lib/mcp-tools.test.ts apps/web/lib/routing/route-outcome.test.ts apps/web/lib/build-disciplines-integration.test.ts apps/web/lib/feature-build-types.test.ts
```

- [ ] **Step 2: Run TypeScript verification**

Run:

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Run the production build gate**

Run:

```bash
cd h:/OpenDigitalProductFactory/apps/web
npx next build
```

Expected: zero errors. Do not mark the epic chunk done without this passing.

- [ ] **Step 4: Perform manual workflow checks**

Verify these flows manually:
1. Coworker chat creates a task run on a meaningful objective.
2. A proposal-producing action pauses the task run with `awaiting_human`.
3. Approval resumes the run and records audit + route evidence.
4. Build Studio entering `plan` or `build` shows a linked task summary.
5. Repeating the same workflow surfaces an optimization proposal instead of more graph noise.

- [ ] **Step 5: Update live backlog status**

Mark completed items in the live DB as implementation lands. At minimum:
- `BI-TGOV-001` after schema/data layer is merged
- `BI-TGOV-002` after authority/evidence wiring is merged
- `BI-TGOV-003` after orchestrator integration is merged
- `BI-TGOV-004` after chat/skills/repetition work is merged
- `BI-TGOV-007` after traceability and telemetry wiring is merged
- `BI-TGOV-008` after user-facing summary UX is merged

Leave `BI-TGOV-005` and `BI-TGOV-006` open if only the substrate hooks exist and the follow-on epics still own the deeper work.

- [ ] **Step 6: Final commit**

```bash
cd h:/OpenDigitalProductFactory
git add .
git commit -m "feat: ship task governance runtime and coworker integration"
```

Use a narrower final commit if the work was already committed incrementally.

---

## Notes for the Implementer

- Do not overload `BacklogItem`, `AgentThread`, or `FeatureBuild` into the canonical runtime graph. They stay as adjacent systems.
- Keep all new telemetry fields optional until every caller is migrated.
- Prefer additive rollout. Existing coworker and build flows must continue working if no task run exists yet.
- Keep collective reasoning advisory only. This plan lays the substrate; deeper consensus behavior belongs in `EP-COLL-001`.
- Keep specialist activation proposal logic minimal in this epic. The full capability registry and employment policies belong in `EP-SPEC-001`.
