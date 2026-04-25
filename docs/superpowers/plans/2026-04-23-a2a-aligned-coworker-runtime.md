# A2A-Aligned Coworker Runtime Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor DPF’s internal coworker runtime into a canonical task-native substrate aligned to A2A task, message, artifact, and agent-card concepts while preserving current coworker UX and current governance controls.

**Architecture:** Phase 1 establishes the canonical task-native core under compatibility adapters. Phase 2 cuts the coworker runtime over to that core and adds internal protocol projection. `TaskRun` is the canonical task, `TaskNode` remains the orchestration graph, `TaskMessage` and `TaskArtifact` become first-class, and `AgentThread` / `AgentMessage` become compatibility and presentation layers.

**Tech Stack:** Next.js, TypeScript, Prisma, PostgreSQL, SSE, existing TAK/GAID runtime modules

---

## Chunk 1: Canonical Task Envelope and Schema

### Task 1: Extend `TaskRun` to carry the canonical A2A-shaped task envelope

**Files:**
- Modify: `D:/DPF/packages/db/prisma/schema.prisma`
- Create: `D:/DPF/packages/db/prisma/migrations/<timestamp>_task_run_a2a_envelope/migration.sql`
- Test: `D:/DPF/apps/web/lib/deliberation/orchestrator.test.ts`

- [ ] **Step 1: Add failing schema-level expectations in tests**

Add assertions that new task bootstrap paths persist the extended fields:

```ts
expect(prisma.taskRun.create).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      contextId: expect.any(String),
      status: "submitted",
      authorityScope: expect.anything(),
    }),
  }),
);
```

- [ ] **Step 2: Add new `TaskRun` fields in Prisma schema**

Add only net-new fields. Do NOT add `state` or `governanceEnvelope` — the existing `status` column stays as the storage site for task state (its default is migrated to `submitted`; see spec § "State Vocabulary Migration") and the existing `authorityScope Json?` / `progressPayload Json?` / `routeContext String?` columns stay as the storage sites for the governance envelope (see spec § "Governance Envelope Storage").

```prisma
contextId          String?
initiatingAgentId  String?
currentAgentId     String?
parentTaskRunId    String?
a2aMetadata        Json?
```

Then extend the Prisma `@default` on `status` to `"submitted"` and document the full A2A-aligned value set (`submitted | working | input-required | auth-required | completed | failed | canceled | rejected | archived`) in a `///` schema comment next to the field. Also update `apps/web/lib/tak/task-states.ts` (create it) with a `TASK_STATES` `as const` array and exported `TaskState` type, following the CLAUDE.md "Strongly-Typed String Enums" rule.

- [ ] **Step 3: Generate and complete the migration**

Run (per `CLAUDE.md` — never use `npx prisma`):

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name task_run_a2a_envelope
```

Then add data-safe SQL for defaults and indexes to the generated migration. Confirm the migration timestamp does not collide with any existing file in `packages/db/prisma/migrations/`.

- [ ] **Step 4: Update task bootstrap code to populate the new fields**

Touch:

- `D:/DPF/apps/web/lib/deliberation/orchestrator.ts`
- `D:/DPF/apps/web/lib/actions/request-brand-extraction.ts`
- any other `TaskRun.create` call sites

Expected initialization:

```ts
contextId: input.threadId ?? crypto.randomUUID(),
status: "submitted",
currentAgentId: input.agentId ?? null,
routeContext: input.routeContext ?? null,
```

- [ ] **Step 5: Verify the focused tests pass**

Run:

```bash
pnpm --filter web test -- deliberation/orchestrator.test.ts
```

Expected: the updated bootstrap tests pass.

### Task 2: Add first-class `TaskMessage` and `TaskArtifact`

**Files:**
- Modify: `D:/DPF/packages/db/prisma/schema.prisma`
- Create: `D:/DPF/packages/db/prisma/migrations/<timestamp>_task_messages_and_artifacts/migration.sql`
- Create: `D:/DPF/apps/web/lib/tak/task-envelope-types.ts`
- Create: `D:/DPF/apps/web/lib/tak/task-message-service.ts`
- Create: `D:/DPF/apps/web/lib/tak/task-artifact-service.ts`
- Test: `D:/DPF/apps/web/lib/tak/task-message-service.test.ts`
- Test: `D:/DPF/apps/web/lib/tak/task-artifact-service.test.ts`

- [ ] **Step 1: Write failing tests for task message and artifact persistence**

Use explicit A2A-shaped payloads:

```ts
parts: [{ text: "Need finance review", mediaType: "text/plain" }]
```

and:

```ts
parts: [{ data: { summary: "handoff ready" }, mediaType: "application/json" }]
```

- [ ] **Step 2: Add `TaskMessage` and `TaskArtifact` models**

Model concrete fields for:

- stable external IDs
- `taskRunId`
- `contextId`
- `role`
- `parts Json`
- `metadata Json`
- `referenceTaskIds`
- producer linkage on artifacts

- [ ] **Step 3: Implement minimal persistence services**

Create simple explicit APIs:

```ts
createTaskMessage(input)
listTaskMessages(taskRunId)
createTaskArtifact(input)
listTaskArtifacts(taskRunId)
```

- [ ] **Step 4: Verify the focused unit tests pass**

Run:

```bash
pnpm --filter web test -- task-message-service.test.ts task-artifact-service.test.ts
```

Expected: new services persist and read task-native envelopes correctly.

### Task 3: Link governance and audit tables to canonical task IDs

**Files:**
- Modify: `D:/DPF/packages/db/prisma/schema.prisma`
- Create: `D:/DPF/packages/db/prisma/migrations/<timestamp>_link_governance_records_to_task_run/migration.sql`
- Modify: `D:/DPF/apps/web/lib/tak/agentic-loop.ts`
- Modify: `D:/DPF/apps/web/lib/mcp-tools.ts`
- Modify: `D:/DPF/apps/web/lib/actions/governance.ts`
- Modify: `D:/DPF/apps/web/lib/tak/delegation-authority.ts`
- Test: `D:/DPF/apps/web/lib/tak/agentic-loop.test.ts`

- [ ] **Step 1: Add nullable `taskRunId` foreign-key fields**

Add nullable links to:

- `ToolExecution`
- `AgentActionProposal`
- `DelegationGrant`
- `AuthorizationDecisionLog`
- `ScheduledAgentTask`
- `DelegationChain`
- `AgentMessage`
- `PhaseHandoff`

- [ ] **Step 2: Thread canonical task IDs through runtime call sites**

Update execution and governance call paths so they pass `taskRunId` wherever available.

- [ ] **Step 3: Add a failing audit test**

Example assertion:

```ts
expect(prisma.toolExecution.create).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({ taskRunId: "TR-123" }),
  }),
);
```

- [ ] **Step 4: Make the test pass and verify**

Run:

```bash
pnpm --filter web test -- tak/agentic-loop.test.ts
```

Expected: tool execution and proposal persistence carry canonical task linkage.

## Chunk 2: Compatibility Adapters and Internal Agent Card

### Task 4: Project coworker chat onto the canonical task substrate

**Files:**
- Modify: `D:/DPF/apps/web/lib/actions/agent-coworker.ts`
- Modify: `D:/DPF/apps/web/lib/tak/agent-coworker-data.ts`
- Modify: `D:/DPF/apps/web/lib/tak/agent-coworker-types.ts`
- Create: `D:/DPF/apps/web/lib/tak/task-chat-projection.ts`
- Test: `D:/DPF/apps/web/lib/actions/agent-coworker.test.ts`

- [ ] **Step 1: Write a failing test for chat-to-task projection**

The send path should:

- create or resolve a canonical `TaskRun`
- write a `TaskMessage`
- continue writing a compatibility `AgentMessage`

- [ ] **Step 2: Implement projection helpers**

Create explicit helpers:

```ts
ensureTaskForCoworkerTurn(...)
projectTaskMessageToAgentMessage(...)
projectAgentMessageToTaskMessage(...)
```

- [ ] **Step 3: Update the coworker send flow**

Ensure every new coworker request has a canonical task record even if the UX still renders chat.

- [ ] **Step 4: Verify focused coworker tests**

Run:

```bash
pnpm --filter web test -- agent-coworker.test.ts
```

Expected: existing coworker behavior still works while canonical task records are created.

### Task 5: Normalize SSE and progress into task status and artifact events

**Files:**
- Modify: `D:/DPF/apps/web/lib/tak/agent-event-bus.ts` (canonical; root-level `apps/web/lib/agent-event-bus.ts` is only a 3-line shim — do not edit the shim)
- Modify: `D:/DPF/apps/web/app/api/agent/stream/route.ts`
- Modify: `D:/DPF/apps/web/lib/tak/thread-progress.ts`
- Create: `D:/DPF/apps/web/lib/tak/task-stream-projection.ts`
- Test: `D:/DPF/apps/web/lib/tak/thread-progress.test.ts`

- [ ] **Step 1: Add failing tests for A2A-shaped stream projection**

Example expected events:

```ts
{ type: "task:status"; taskId: "TR-123", contextId: "ctx-1", state: "working" }
{ type: "task:artifact"; taskId: "TR-123", artifactId: "artifact-1" }
```

- [ ] **Step 2: Add projection helpers without breaking existing event consumers**

Do not remove existing events in phase 1. Add a projection layer that can emit normalized task events alongside legacy event shapes.

- [ ] **Step 3: Verify replay and live-stream tests**

Run:

```bash
pnpm --filter web test -- tak/thread-progress.test.ts
```

Expected: both replay and live emit paths preserve task identity and status.

### Task 6: Add an internal `AgentCard` projection service

**Files:**
- Create: `D:/DPF/apps/web/lib/tak/agent-card-service.ts`
- Create: `D:/DPF/apps/web/lib/tak/agent-card-types.ts`
- Modify: `D:/DPF/apps/web/lib/tak/index.ts`
- Test: `D:/DPF/apps/web/lib/tak/agent-card-service.test.ts`

- [ ] **Step 1: Write a failing projection test**

Assert that the card contains:

- name and description
- supported interfaces
- capabilities
- skills
- security requirements
- DPF extension metadata for `TAK` and `GAID`

- [ ] **Step 2: Implement the base projection**

Read from:

- `Agent`
- `AgentExecutionConfig`
- `AgentGovernanceProfile`
- `AgentToolGrant`
- `AgentSkillAssignment`

- [ ] **Step 3: Add extension metadata fields**

Include extension payloads such as:

```ts
extensions: {
  tak: { hitlPolicy, sensitivity, operatingProfileFingerprint },
  gaid: { gaid, aidocRef, authorizationClasses },
}
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter web test -- tak/agent-card-service.test.ts
```

Expected: the internal card is stable and complete enough for later protocol projection.

## Chunk 3: Phase 2 Cutover Readiness

### Task 7: Make coworker-to-coworker handoff explicitly task-native

**Files:**
- Modify: `D:/DPF/apps/web/lib/tak/delegation-authority.ts`
- Modify: `D:/DPF/apps/web/lib/actions/skill-discovery.ts`
- Modify: `D:/DPF/apps/web/lib/actions/agent-task-scheduler.ts`
- Modify: `D:/DPF/apps/web/lib/actions/build.ts`
- Test: `D:/DPF/apps/web/lib/actions/skill-discovery.test.ts`

- [ ] **Step 1: Write failing tests for handoff artifacts and lineage**

Each handoff should produce:

- child or linked canonical task
- task artifact or structured handoff message
- delegation lineage references

- [ ] **Step 2: Update handoff producers**

Ensure build handoffs, scheduled tasks, and skill-driven delegation all produce canonical task-native records first, then project to legacy UX artifacts if needed.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter web test -- skill-discovery.test.ts
```

Expected: internal handoffs are no longer implicit chat side effects.

### Task 8: Add private task endpoints for internal projection

**Files:**
- Create: `D:/DPF/apps/web/app/api/internal/tasks/[taskId]/route.ts`
- Create: `D:/DPF/apps/web/app/api/internal/tasks/[taskId]/subscribe/route.ts`
- Create: `D:/DPF/apps/web/app/api/internal/agent-card/route.ts`
- Test: `D:/DPF/apps/web/lib/api/__tests__/internal-task-endpoints.test.ts`

- [ ] **Step 1: Write failing endpoint tests**

Cover:

- fetch task status
- fetch task messages and artifacts
- subscribe to task updates
- fetch internal agent card

- [ ] **Step 2: Implement read-only private endpoints**

Keep these internal and non-public in phase 2. They are the projection layer, not a public conformance claim.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter web test -- internal-task-endpoints.test.ts
```

Expected: internal consumers can use task-centric APIs without going through chat.

### Task 9: Update TAK and GAID docs to codify the runtime pattern

**Files:**
- Modify: `D:/DPF/docs/architecture/trusted-ai-kernel.md`
- Modify: `D:/DPF/docs/architecture/GAID.md`
- Modify: `D:/DPF/docs/architecture/agent-standards-dpf-conformance.md`

- [ ] **Step 1: Add `TAK` task-envelope guidance**

Document:

- canonical task envelope
- interrupted states such as `input-required` and `auth-required`
- task-bound audit and approval expectations

- [ ] **Step 2: Add `GAID` A2A profile language**

Document:

- `AgentCard` to `GAID` / `AIDoc` mapping
- task and artifact custody identifiers
- receipt linkage to canonical task IDs

- [ ] **Step 3: Verify docs are internally consistent**

Run:

```bash
git diff -- docs/architecture/trusted-ai-kernel.md docs/architecture/GAID.md docs/architecture/agent-standards-dpf-conformance.md
```

Expected: the standards docs describe the same runtime pattern the code now implements.

### Task 10: Run verification before claiming the migration ready

**Files:**
- No code changes required unless verification finds issues

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm --filter web test -- tak/agentic-loop.test.ts tak/thread-progress.test.ts agent-coworker.test.ts
```

Expected: focused runtime tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter web typecheck
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
cd apps/web && npx next build
```

Expected: production build succeeds.

- [ ] **Step 4: Run affected UX verification**

Verify at minimum:

- coworker chat still sends and streams correctly
- approval card rendering still works when proposal-mode tools are used
- task-backed background flows still stream progress

- [ ] **Step 5: Commit the migration in focused slices**

Recommended commit sequence:

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/<...>
git commit -m "feat(runtime): add canonical task envelope models"

git add apps/web/lib/tak apps/web/lib/actions/agent-coworker.ts apps/web/app/api/agent/stream/route.ts
git commit -m "feat(runtime): project coworker flows onto task-native substrate"

git add docs/architecture docs/superpowers/specs docs/superpowers/plans
git commit -m "docs(standards): codify A2A-shaped TAK and GAID runtime pattern"
```

Plan complete and saved to `docs/superpowers/plans/2026-04-23-a2a-aligned-coworker-runtime.md`. Ready to execute?
