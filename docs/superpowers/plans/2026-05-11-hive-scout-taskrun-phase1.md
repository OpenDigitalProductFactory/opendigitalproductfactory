# Hive Scout TaskRun Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Hive Scout from a standalone weekly queue job into a seeded, scheduled coworker run with governed tool execution, durable task identity, and backlog evidence created from the same run.

**Architecture:** Reuse the existing scheduled coworker substrate instead of extending the old `hive-scout-ingest` cron path. Seed a dedicated `external-catalog-scout` coworker plus a scheduled task, add one governed `run_hive_scout_ingest` tool that wraps the deterministic ingest logic, and make scheduled task prompt resolution honor `task.agentId` so non-route coworkers can run without borrowing the wrong persona.

**Tech Stack:** Next.js 16, Vitest, Prisma 7, Inngest, scheduled coworker runtime, DPF prompt/skill seeders.

---

## Repo Truth

- The reviewed May 11 specs are directionally right, but parts of the runtime substrate are already present in code:
  - `ScheduledAgentTask.taskRunId` already exists in [D:/DPF-hive-scout-taskrun/packages/db/prisma/schema.prisma](D:/DPF-hive-scout-taskrun/packages/db/prisma/schema.prisma:4312)
  - `ToolExecution.taskRunId` already exists in [D:/DPF-hive-scout-taskrun/packages/db/prisma/schema.prisma](D:/DPF-hive-scout-taskrun/packages/db/prisma/schema.prisma:3028)
  - `executeScheduledAgentTask()` already creates `TaskRun` + `TaskMessage` records in [D:/DPF-hive-scout-taskrun/apps/web/lib/actions/agent-task-scheduler.ts](D:/DPF-hive-scout-taskrun/apps/web/lib/actions/agent-task-scheduler.ts:173)
- The actual gap is narrower:
  - Hive Scout still runs through [D:/DPF-hive-scout-taskrun/apps/web/lib/queue/functions/hive-scout-ingest.ts](D:/DPF-hive-scout-taskrun/apps/web/lib/queue/functions/hive-scout-ingest.ts:1)
  - the ingest logic writes backlog items directly from [D:/DPF-hive-scout-taskrun/apps/web/lib/actions/hive-scout/ingest-500-agents.ts](D:/DPF-hive-scout-taskrun/apps/web/lib/actions/hive-scout/ingest-500-agents.ts:1)
  - scheduled tasks currently resolve prompts from route context, not from the scheduled `agentId`
- Discovery triage already shows the right seeding pattern in:
  - [D:/DPF-hive-scout-taskrun/packages/db/src/seed-discovery-triage.ts](D:/DPF-hive-scout-taskrun/packages/db/src/seed-discovery-triage.ts:1)
  - [D:/DPF-hive-scout-taskrun/packages/db/src/discovery-triage-config.ts](D:/DPF-hive-scout-taskrun/packages/db/src/discovery-triage-config.ts:1)

## File Map

### Seed and coworker identity

- Create: `packages/db/src/hive-scout-config.ts`
  - Canonical task id, agent id, route context, schedule, prompt builder.
- Create: `packages/db/src/seed-hive-scout.ts`
  - Install-seeded scheduled task helper mirroring discovery triage.
- Modify: `packages/db/src/seed-hive-scout.test.ts`
  - New test file for seed helper behavior.
- Modify: `packages/db/src/seed.ts`
  - Seed the new coworker, grants, and scheduled task.
- Modify: `packages/db/data/agent_registry.json`
  - Add `external-catalog-scout` registry identity and grants.

### Prompt and skill assets

- Create: `prompts/route-persona/external-catalog-scout.prompt.md`
  - Route-persona prompt for the standalone scout coworker.
- Modify: `skills/platform/scout-external-catalogs.skill.md`
  - Reassign from `portfolio-advisor` to `external-catalog-scout` and document the governed tool.

### Runtime and tools

- Modify: `apps/web/lib/tak/agent-routing-server.ts`
  - Add scheduled-task-safe prompt resolution by explicit `agentId`.
- Modify: `apps/web/lib/actions/agent-task-scheduler.ts`
  - Use the new scheduled-agent resolver and add Hive Scout summary/status handling.
- Modify: `apps/web/lib/actions/agent-task-scheduler.test.ts`
  - Cover agent-owned scheduled resolution and Hive Scout failure/success paths.
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents.ts`
  - Add result metadata and backlog evidence writing support for created suggestions.
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts`
  - Extend with run-level behavior tests, not just parser tests.
- Modify: `apps/web/lib/mcp-tools.ts`
  - Add `run_hive_scout_ingest` tool definition and implementation.
- Modify: `apps/web/lib/tak/agent-grants.ts`
  - Map the new tool to grants.
- Modify: `apps/web/lib/mcp-tools.test.ts`
  - Verify the new tool is exposed correctly.
- Modify: `apps/web/lib/tak/agent-grants.test.ts`
  - Verify grant behavior for the new tool.

### Queue registration

- Modify: `apps/web/lib/queue/functions/hive-scout-ingest.ts`
  - Convert from durable schedule entry point to compatibility/manual shim or retire it.
- Modify: `apps/web/lib/queue/functions/index.ts`
  - Remove the weekly standalone Hive Scout cron from the primary queue registry if fully superseded by the seeded scheduled task.

## Chunk 1: Seed the Hive Scout coworker and scheduled task

### Task 1: Add the Hive Scout config and seed helper

**Files:**
- Create: `packages/db/src/hive-scout-config.ts`
- Create: `packages/db/src/seed-hive-scout.ts`
- Test: `packages/db/src/seed-hive-scout.test.ts`

- [ ] **Step 1: Write the failing seed-helper tests**

Cover:
- first-superuser ownership
- create vs update behavior
- prompt contains the required `run_hive_scout_ingest` instruction
- existing `nextRunAt` is preserved on update
- missing superuser fails loudly

- [ ] **Step 2: Run the new test file to verify it fails**

Run:
```powershell
pnpm --filter @dpf/db exec vitest run src/seed-hive-scout.test.ts
```

Expected:
- FAIL because the helper/config files do not exist yet.

- [ ] **Step 3: Implement the config + seed helper**

Mirror discovery triage:
- agent id: `external-catalog-scout`
- task id: deterministic semantic id
- schedule: weekly UTC cadence matching the prior Hive Scout window unless reviewed docs require otherwise
- route context: keep the operations-facing context agreed in the reviewed spec

- [ ] **Step 4: Re-run the seed-helper tests**

Run:
```powershell
pnpm --filter @dpf/db exec vitest run src/seed-hive-scout.test.ts
```

Expected:
- PASS

### Task 2: Seed the coworker identity and schedule

**Files:**
- Modify: `packages/db/src/seed.ts`
- Modify: `packages/db/data/agent_registry.json`
- Modify: `skills/platform/scout-external-catalogs.skill.md`
- Create: `prompts/route-persona/external-catalog-scout.prompt.md`

- [ ] **Step 1: Add the failing identity/seed assertions**

Prefer extending the new seed-helper test or adding a focused config/assertion test for:
- `external-catalog-scout` present in the registry
- expected grants present
- skill reassigned to the new agent

- [ ] **Step 2: Run the affected tests to verify failure**

Run:
```powershell
pnpm --filter @dpf/db exec vitest run src/seed-hive-scout.test.ts
pnpm --filter web exec vitest run lib/tak/agent-grants.test.ts
```

Expected:
- FAIL because the new coworker/tool mapping does not exist yet.

- [ ] **Step 3: Implement the seed/registry/prompt/skill changes**

Rules:
- keep the coworker narrowly scoped
- no route remapping of `/platform/ai/operations` for interactive chat
- use the prompt/skill seed system, not hardcoded-only persona text

- [ ] **Step 4: Re-run the affected tests**

Run:
```powershell
pnpm --filter @dpf/db exec vitest run src/seed-hive-scout.test.ts
pnpm --filter web exec vitest run lib/tak/agent-grants.test.ts
```

Expected:
- PASS

## Chunk 2: Add the governed Hive Scout tool and ingest evidence

### Task 3: Add `run_hive_scout_ingest` as a governed tool

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: `apps/web/lib/mcp-tools.test.ts`
- Modify: `apps/web/lib/tak/agent-grants.test.ts`

- [ ] **Step 1: Write the failing tool/grant tests**

Cover:
- tool exists in `PLATFORM_TOOLS`
- tool is side-effecting
- tool is grant-gated
- grant mapping authorizes `external-catalog-scout`

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```powershell
pnpm --filter web exec vitest run lib/mcp-tools.test.ts lib/tak/agent-grants.test.ts
```

Expected:
- FAIL because the tool and grant mapping do not exist yet.

- [ ] **Step 3: Implement the tool definition and execution**

Tool contract:
- name: `run_hive_scout_ingest`
- no required input for v1
- returns structured counts and created backlog item ids
- classifies upstream fetch vs parse failure explicitly

- [ ] **Step 4: Re-run the tool/grant tests**

Run:
```powershell
pnpm --filter web exec vitest run lib/mcp-tools.test.ts lib/tak/agent-grants.test.ts
```

Expected:
- PASS

### Task 4: Extend ingest behavior with backlog evidence metadata

**Files:**
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents.ts`
- Modify: `apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts`

- [ ] **Step 1: Write the failing ingest behavior tests**

Cover:
- created backlog items produce `BacklogItemActivity` evidence rows
- activity includes source metadata such as source URL/catalog and the scheduled `taskRunId` when provided
- duplicate re-runs do not write duplicate items or evidence
- parser failure is explicit

- [ ] **Step 2: Run the ingest tests to verify failure**

Run:
```powershell
pnpm --filter web exec vitest run lib/actions/hive-scout/ingest-500-agents.test.ts
```

Expected:
- FAIL because evidence metadata is not written today.

- [ ] **Step 3: Implement the minimal ingest changes**

Notes:
- keep the deterministic parser/dedupe logic intact
- prefer lightweight evidence rows over new schema in this slice
- do not invent autonomous ambiguity review yet

- [ ] **Step 4: Re-run the ingest tests**

Run:
```powershell
pnpm --filter web exec vitest run lib/actions/hive-scout/ingest-500-agents.test.ts
```

Expected:
- PASS

## Chunk 3: Make scheduled tasks resolve by `agentId` and run Hive Scout through the substrate

### Task 5: Add explicit scheduled-agent prompt resolution

**Files:**
- Modify: `apps/web/lib/tak/agent-routing-server.ts`
- Modify: `apps/web/lib/actions/agent-task-scheduler.ts`
- Modify: `apps/web/lib/actions/agent-task-scheduler.test.ts`

- [ ] **Step 1: Write the failing scheduled-task tests**

Cover:
- when `task.agentId` does not match the route-default agent, the scheduler resolves prompt/skills by `task.agentId`
- the resolved scheduled prompt still writes `TaskMessage`
- existing discovery-triage behavior stays green

- [ ] **Step 2: Run the scheduler tests to verify failure**

Run:
```powershell
pnpm --filter web exec vitest run lib/actions/agent-task-scheduler.test.ts lib/tak/agent-routing-server.test.ts
```

Expected:
- FAIL because scheduled tasks currently resolve prompts from route context only.

- [ ] **Step 3: Implement the resolver and scheduler wiring**

Rules:
- keep route-based resolution for interactive chat
- add explicit `agentId`-first resolution for scheduled work
- preserve DB prompt loading, skills loading, and principal linking

- [ ] **Step 4: Re-run the scheduler tests**

Run:
```powershell
pnpm --filter web exec vitest run lib/actions/agent-task-scheduler.test.ts lib/tak/agent-routing-server.test.ts
```

Expected:
- PASS

### Task 6: Replace the standalone Hive Scout cron with the seeded scheduled coworker

**Files:**
- Modify: `apps/web/lib/queue/functions/hive-scout-ingest.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: Add the failing queue/seed assertions**

Cover:
- Hive Scout no longer depends on its own weekly queue function as the durable schedule path
- seed path ensures the scheduled task exists

- [ ] **Step 2: Run the affected tests**

Run:
```powershell
pnpm --filter @dpf/db exec vitest run src/seed-hive-scout.test.ts src/seed-discovery-triage.test.ts
pnpm --filter web exec vitest run lib/actions/agent-task-scheduler.test.ts
```

Expected:
- FAIL until the wiring is updated.

- [ ] **Step 3: Implement the queue/runtime transition**

Transition rule:
- the seeded `ScheduledAgentTask` is the canonical scheduler
- keep a manual/dev replay path, but do not leave two competing weekly schedulers active

- [ ] **Step 4: Re-run the affected tests**

Run:
```powershell
pnpm --filter @dpf/db exec vitest run src/seed-hive-scout.test.ts src/seed-discovery-triage.test.ts
pnpm --filter web exec vitest run lib/actions/agent-task-scheduler.test.ts
```

Expected:
- PASS

## Verification and Finish

- [ ] **Step 1: Run the focused Phase 1 suites**

Run:
```powershell
pnpm --filter @dpf/db exec vitest run src/seed-hive-scout.test.ts src/seed-discovery-triage.test.ts
pnpm --filter web exec vitest run lib/actions/hive-scout/ingest-500-agents.test.ts lib/actions/agent-task-scheduler.test.ts lib/mcp-tools.test.ts lib/tak/agent-grants.test.ts lib/tak/agent-routing-server.test.ts lib/ai-operations-map/project-events.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run the production build**

Run:
```powershell
pnpm --filter web build
```

Expected:
- PASS with no new build errors.

- [ ] **Step 3: Rebuild and verify the running portal**

Run:
```powershell
docker compose build --no-cache portal portal-init sandbox
docker compose up -d
```

Verify:
- login at the configured app URL
- confirm the platform still loads
- verify `/platform/ai/operations` shows the proactive Hive Scout run after a manual trigger or seeded execution
- verify backlog evidence exists for created Hive Scout items

- [ ] **Step 4: Record evidence and commit in small slices**

Suggested commits:
1. seed + coworker identity
2. governed Hive Scout tool + grants
3. scheduled task resolver + runtime wiring
4. queue transition + verification

