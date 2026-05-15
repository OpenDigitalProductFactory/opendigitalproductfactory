# Skill Telemetry and Reflection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first governed Hermes-style learning increment: skill usage telemetry, visible skill attribution, repeated-tool reflection triggers, skill capability needs, and normalized improvement signals.

**Architecture:** This increment reuses DPF's existing governance substrate. Skill use becomes event-sourced through `SkillUsageEvent`, aggregate metrics remain in `SkillMetric`, action evidence stays in `ToolExecution`, stuck-run detection keeps writing `PlatformIssueReport`, and reflection outputs use `TaskRun`, `CoworkerSelfAssessment`, `CoworkerCapabilityNeed`, and `ImprovementSignal`. The prompt assembler remains a composition layer; skill resolution, telemetry, and reflection live in focused services.

**Tech Stack:** TypeScript, Next.js 16 App Router, React, Prisma 7, PostgreSQL, Vitest, Docker Compose, pnpm workspaces.

---

## Scope

This plan implements Slice 1 and Slice 2 from `docs/superpowers/specs/2026-05-15-governed-hermes-learning-loop-design.md`.

In scope:

- `SkillUsageEvent` model and runtime event writer.
- `ToolExecution.skillId` attribution.
- Minimal `ImprovementSignal` substrate required by the continuous-improvement flywheel spec.
- Skill runtime service extracted from `apps/web/lib/actions/agent-skills.ts` and `apps/web/lib/actions/agent-coworker.ts`.
- Prompt `skills` block as a peer of `domainTools`.
- `SkillUsageEvent` to `SkillMetric` aggregator.
- Repeated-tool issue extraction from `agentic-loop.ts` into a named helper.
- Reflection trigger that consumes `PlatformIssueReport(type="agent_stuck")`.
- Skill-related `CoworkerCapabilityNeed` and `ImprovementSignal` output.
- Compact skill attribution in coworker chat and `/platform/ai/skills`.

Out of scope:

- `SkillRevision` approval/rollback flow. That is Slice 3.
- Curator lifecycle states (`lifecycleState`, pinned/stale/archive/quarantine). That is Slice 4.
- Evidence/session search. That is Slice 5.
- Evolution Lab. That is Slice 6.
- External skill import governance. That is Slice 7.

## Preconditions

- Work in a new worktree from `origin/main`:

```powershell
git fetch origin main
git worktree add D:\DPF\.worktrees\skill-telemetry-and-reflection -b feat/skill-telemetry-and-reflection origin/main
cd D:\DPF\.worktrees\skill-telemetry-and-reflection
.\scripts\seed-worktree-mcp.ps1
```

- Read `AGENTS.md` in the worktree before editing.
- Confirm the branch guard:

```powershell
git branch --show-current
```

Expected: `feat/skill-telemetry-and-reflection`, not `main`.

- Check live legacy capability-need kinds before the migration:

```powershell
@'
SELECT kind, COUNT(*) FROM "CoworkerCapabilityNeed" GROUP BY kind ORDER BY kind;
'@ | docker exec -i dpf-postgres-1 psql -U dpf -d dpf
```

Expected on the 2026-05-15 install: only `tool` exists. If other kinds exist, preserve them by mapping unknown values to `other` in the migration or by explicitly carrying them forward in the typed enum after product review.

## File Structure

### New files

| File | Responsibility |
| --- | --- |
| `packages/db/prisma/migrations/<timestamp>_skill_telemetry_and_reflection/migration.sql` | Adds `SkillUsageEvent`, `ToolExecution.skillId`, and minimal `ImprovementSignal`. |
| `apps/web/lib/skills/types.ts` | Canonical skill usage phases, period utilities, and small shared types. |
| `apps/web/lib/skills/runtime.ts` | Skill loading, prompt body extraction, invocation parsing, prompt block shaping, and refactored skill helpers. |
| `apps/web/lib/skills/runtime.test.ts` | Unit tests for skill parsing, prompt compiling, and active skill extraction. |
| `apps/web/lib/skills/usage-events.ts` | Event writer for eligible, loaded, invoked, completed, failed, and rated skill events. |
| `apps/web/lib/skills/usage-events.test.ts` | Unit tests for event writer validation and no-op behavior. |
| `apps/web/lib/skills/skill-metrics.ts` | Idempotent `SkillUsageEvent` to `SkillMetric` aggregation. |
| `apps/web/lib/skills/skill-metrics.test.ts` | Aggregator tests. |
| `apps/web/lib/improvement-flywheel/signals.ts` | Minimal `ImprovementSignal` writer and dedupe helper. |
| `apps/web/lib/improvement-flywheel/signals.test.ts` | Unit tests for signal creation and dedupe. |
| `apps/web/lib/tak/runtime-issues.ts` | Named repeated-tool detector and `PlatformIssueReport` writer. |
| `apps/web/lib/tak/runtime-issues.test.ts` | Tests for repeated-tool detection and issue payloads. |
| `apps/web/lib/tak/reflection-triggers.ts` | Reflection trigger that consumes runtime issue rows and writes governed outputs. |
| `apps/web/lib/tak/reflection-triggers.test.ts` | Tests for `TaskRun`, capability need, and improvement signal output. |
| `apps/web/components/agent/AgentSkillAttributionChip.tsx` | Compact theme-aware skill chip for active coworker work. |
| `apps/web/components/agent/AgentSkillAttributionChip.test.tsx` | Chip rendering tests. |

### Modified files

| File | Change |
| --- | --- |
| `packages/db/prisma/schema.prisma` | Add models/columns/relations/indexes for this slice. |
| `apps/web/lib/actions/agent-skills.ts` | Become a thin server-action wrapper over `apps/web/lib/skills/runtime.ts`. |
| `apps/web/lib/actions/agent-coworker.ts` | Use runtime skill service, record eligible/loaded events, pass active skill id into the autonomous loop, and reduce skill-related responsibility in this large file. |
| `apps/web/lib/tak/prompt-assembler.ts` | Add optional `skills` input and render a concise skills block alongside domain context. No DB writes here. |
| `apps/web/lib/tak/prompt-assembler.test.ts` | Assert skills block rendering and omission. |
| `apps/web/lib/tak/autonomous-work-run.ts` | Accept `activeSkillId`; pass it to `runAgenticLoop`; invoke post-run reflection trigger for wrapper-based runs. |
| `apps/web/lib/tak/autonomous-work-run.test.ts` | Assert skill id propagation and reflection trigger call. |
| `apps/web/lib/tak/agentic-loop.ts` | Use `runtime-issues.ts`, accept active skill id, record skill completion/failure, pass skill id into governed tool execution. |
| `apps/web/lib/tak/agentic-loop.test.ts` | Update repeated-tool tests and add skill attribution tests. |
| `apps/web/lib/mcp-governed-execute.ts` | Add `skillId` to governed context and write it to `ToolExecution`. |
| `apps/web/lib/mcp-governed-execute.test.ts` | Assert audit rows include `skillId` when supplied. |
| `apps/web/lib/coworker-self-assessment/types.ts` | Reconcile capability need kind values with spec values and migration plan. |
| `apps/web/lib/coworker-self-assessment/*.test.ts` | Update enum tests and any stale `ui_surface` expectations. |
| `apps/web/lib/mcp-tools.ts` | Keep MCP schema enums in sync with coworker capability need kinds. |
| `apps/web/lib/mcp-tools-coworker-self-assessment.test.ts` | Assert new enums are exposed and old invalid kinds reject. |
| `apps/web/lib/actions/skills-observatory.ts` | Read `SkillUsageEvent`, `SkillMetric`, and `ToolExecution.skillId`. |
| `apps/web/components/platform/SkillsObservatoryPanel.tsx` | Show usage/success attribution without hardcoded colors. |
| `apps/web/components/admin/SkillsCatalogView.tsx` | Remove existing hardcoded hex colors while touching the skills surface. |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Show active skill chip when a skill invocation is running. |
| `apps/web/components/agent/AgentPanelHeader.tsx` / `AgentSkillsDropdown.tsx` | Preserve selected skill id when a user invokes a skill. |

## Chunk 1: Data Model And Typed Constants

### Task 1: Add SkillUsageEvent, ToolExecution.skillId, and ImprovementSignal

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_skill_telemetry_and_reflection/migration.sql`

- [ ] **Step 1: Add schema fields before generating the migration**

Add `ToolExecution.skillId`:

```prisma
  // Governed Hermes learning Slice 1: nullable active skill attribution.
  skillId       String?
```

Add indexes:

```prisma
  @@index([skillId, createdAt(sort: Desc)])
```

Add relation fields on `SkillDefinition`:

```prisma
  usageEvents SkillUsageEvent[]
```

Add the event model near the skill models:

```prisma
model SkillUsageEvent {
  id              String   @id @default(cuid())
  eventId         String   @unique
  skillId         String
  agentId         String
  userId          String?
  threadId        String?
  taskRunId       String?
  toolExecutionId String?
  routeContext    String?
  phase           String
  source          String   @default("coworker")
  metadata        Json     @default("{}")
  createdAt       DateTime @default(now())

  skill SkillDefinition @relation(fields: [skillId], references: [skillId], onDelete: Cascade)

  @@index([skillId, createdAt(sort: Desc)])
  @@index([agentId, createdAt(sort: Desc)])
  @@index([threadId, createdAt(sort: Desc)])
  @@index([taskRunId, createdAt(sort: Desc)])
  @@index([phase, createdAt(sort: Desc)])
}
```

Add minimal `ImprovementSignal` from the flywheel spec:

```prisma
model ImprovementSignal {
  id                        String   @id @default(cuid())
  signalId                  String   @unique
  sourceType                String
  sourceId                  String
  title                     String
  description               String?  @db.Text
  evidence                  Json     @default("{}")
  recurrenceCount           Int      @default(1)
  status                    String   @default("open")
  routeContext              String?
  agentId                   String?
  threadId                  String?
  buildId                   String?
  providerId                String?
  toolName                  String?
  digitalProductId          String?
  portfolioId               String?
  suspectedRootCause        String?
  objectiveImpactHypothesis String?
  graphNodeRefs             String[] @default([])
  graphEdgeRefs             String[] @default([])
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt
  lastSeenAt                DateTime @default(now())

  @@unique([sourceType, sourceId])
  @@index([status, createdAt(sort: Desc)])
  @@index([routeContext, createdAt(sort: Desc)])
  @@index([agentId, createdAt(sort: Desc)])
  @@index([toolName, createdAt(sort: Desc)])
}
```

- [ ] **Step 2: Generate the migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name skill_telemetry_and_reflection
```

Expected: migration creates `SkillUsageEvent`, adds nullable `skillId` to `ToolExecution`, and creates `ImprovementSignal`.

- [ ] **Step 3: Inspect the generated SQL**

Open the generated migration and verify:

- no destructive changes,
- no required column added to populated tables,
- indexes match the schema,
- `ImprovementSignal` uniqueness is on `sourceType, sourceId`.

- [ ] **Step 4: Generate the Prisma client**

Run:

```powershell
pnpm --filter @dpf/db exec prisma generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/<timestamp>_skill_telemetry_and_reflection/migration.sql
git commit -s -m "feat(db): add skill telemetry and improvement signal models"
```

### Task 2: Extend capability-need kind enum (do not replace)

**Files:**
- Modify: `apps/web/lib/coworker-self-assessment/types.ts`
- Verify (no change expected): `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools-coworker-self-assessment.test.ts`
- Touch only if a test references a new kind: `apps/web/lib/coworker-self-assessment/assessment-service.test.ts`, `apps/web/lib/coworker-self-assessment/review-service.test.ts`

**Current state (verified 2026-05-15):**

```typescript
// apps/web/lib/coworker-self-assessment/types.ts:7-16
export const COWORKER_CAPABILITY_NEED_KINDS = [
  "tool", "skill", "grant", "model", "memory", "data", "ui_surface", "boundary",
] as const;
```

The enum is **already typed** — the spec sentence "free-form String today" is incorrect about the application layer (the DB column is a Prisma `String`, but every call site validates against `COWORKER_CAPABILITY_NEED_KINDS`). `apps/web/lib/mcp-tools.ts` already spreads the same constant into the MCP schema at lines 2763, 2792, 9852, 9908. Live data uses only `tool` (confirmed by the preconditions query).

The aligned spec extends the existing taxonomy rather than replacing it. `skill`, `memory`, and `tool` already exist; `prompt`, `convention`, `code`, and `other` must be **added** to the constant. The five values currently in the enum that were missing from the original draft (`grant`, `model`, `data`, `ui_surface`, `boundary`) **must be preserved** — each represents a real operational-gap class already wired into the assessment surfaces. Dropping them would invalidate the historical taxonomy and break the assessment dashboard.

- [ ] **Step 1: Write a failing test for the new kinds**

In `apps/web/lib/mcp-tools-coworker-self-assessment.test.ts`, add a case that submits a capability need with each new kind (`prompt`, `convention`, `code`, `other`) and asserts the MCP schema accepts it. This test fails today because the constant does not yet include them.

In the same file, add an inverse assertion that an unknown kind (e.g. `"made-up"`) is rejected — guard against future enum drift.

- [ ] **Step 2: Extend the canonical constant**

In `apps/web/lib/coworker-self-assessment/types.ts`, update:

```typescript
export const COWORKER_CAPABILITY_NEED_KINDS = [
  // Existing operational gap kinds — DO NOT remove without product review.
  "tool",
  "skill",
  "grant",
  "model",
  "memory",
  "data",
  "ui_surface",
  "boundary",
  // Governed Hermes learning Slice 2 (spec §7.3 additions).
  "prompt",
  "convention",
  "code",
  "other",
] as const;
```

Hyphenation: `ui_surface` keeps its underscore (live shape; do not break existing rows). New values are single tokens; if a future value needs multi-word form, prefer hyphens per AGENTS.md §3.

- [ ] **Step 3: Verify MCP schema picks up the new values automatically**

`apps/web/lib/mcp-tools.ts` already imports and spreads `COWORKER_CAPABILITY_NEED_KINDS` at lines 2763, 2792, 9852, 9908 — no edit needed. Confirm no parallel hardcoded enum exists:

```powershell
git grep -n '"ui_surface"|"boundary"' apps/web/lib | Where-Object { $_ -notmatch 'types\.ts|\.test\.|\.md' }
```

Expected: no matches. If any exist, replace with imports of `COWORKER_CAPABILITY_NEED_KINDS`.

- [ ] **Step 4: Run focused tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/coworker-self-assessment/assessment-service.test.ts apps/web/lib/coworker-self-assessment/review-service.test.ts apps/web/lib/mcp-tools-coworker-self-assessment.test.ts
```

Expected: tests pass, including the new `prompt | convention | code | other` cases. The existing `ui_surface` test case at `assessment-service.test.ts:52` continues to pass unchanged.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/coworker-self-assessment apps/web/lib/mcp-tools-coworker-self-assessment.test.ts
git commit -s -m "feat(ai): extend coworker capability-need kinds for skill reflection"
```

**Spec note:** The parent spec's §7.3 table is now aligned to the extended-union rule. Do not reintroduce replacement wording in Slice 2.

## Chunk 2: Skill Runtime Telemetry

### Task 3: Create shared skill runtime helpers

**Files:**
- Create: `apps/web/lib/skills/types.ts`
- Create: `apps/web/lib/skills/runtime.ts`
- Create: `apps/web/lib/skills/runtime.test.ts`
- Modify: `apps/web/lib/actions/agent-skills.ts`

- [ ] **Step 1: Write tests for skill body parsing and invocation detection**

Create tests that cover:

- frontmatter body extraction,
- prompt compilation,
- active skill id extraction from `Use the \`skill-id\` skill.`,
- no skill id for ordinary user messages.

Example assertion:

```typescript
expect(extractInvokedSkillId("Use the `build-plan` skill.\n\nSkill description: ...")).toBe("build-plan");
expect(extractInvokedSkillId("Can you help me plan this?")).toBeNull();
```

- [ ] **Step 2: Implement `apps/web/lib/skills/types.ts`**

Include:

```typescript
export const SKILL_USAGE_PHASES = [
  "eligible",
  "loaded",
  "invoked",
  "completed",
  "failed",
  "rated",
] as const;

export type SkillUsagePhase = (typeof SKILL_USAGE_PHASES)[number];
```

- [ ] **Step 3: Move parsing and compiling into `runtime.ts`**

Move the helper logic currently in `agent-skills.ts`:

- `extractSkillBody`,
- `compileSkillInvocationPrompt`,
- `getSkillsForAgent`,
- `getSkillsForAgentLegacy`.

Add:

```typescript
export function extractInvokedSkillId(content: string): string | null {
  const match = content.match(/^Use the `([^`]+)` skill\./);
  return match?.[1] ?? null;
}
```

Add a prompt block shaper:

```typescript
export function renderSkillsPromptBlock(skills: CoworkerSkill[]): string {
  if (skills.length === 0) return "";
  return [
    "Available coworker skills:",
    ...skills.map((s) => `- ${s.skillId}: ${s.label} - ${s.description}`),
  ].join("\n");
}
```

- [ ] **Step 4: Leave `agent-skills.ts` as a wrapper**

`apps/web/lib/actions/agent-skills.ts` should import and re-export server-safe actions from `runtime.ts`. Keep existing public function names so callers do not all change in this task.

- [ ] **Step 5: Run tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/skills/runtime.test.ts apps/web/lib/actions/agent-skills.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/skills apps/web/lib/actions/agent-skills.ts apps/web/lib/actions/agent-skills.test.ts
git commit -s -m "refactor(skills): centralize runtime skill helpers"
```

### Task 4: Add SkillUsageEvent writer

**Files:**
- Create: `apps/web/lib/skills/usage-events.ts`
- Create: `apps/web/lib/skills/usage-events.test.ts`

- [ ] **Step 1: Write tests**

Mock Prisma and test:

- invalid phases reject,
- empty skill list is a no-op,
- `recordSkillUsageEvents` creates one row per skill id,
- metadata is preserved,
- duplicate event calls can be safely retried when caller supplies deterministic metadata but event ids remain unique.

- [ ] **Step 2: Implement event writer**

Implement:

```typescript
export async function recordSkillUsageEvents(input: {
  phase: SkillUsagePhase;
  skillIds: string[];
  agentId: string;
  userId?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  routeContext?: string | null;
  toolExecutionId?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<void>
```

Rules:

- If `skillIds.length === 0`, return.
- Deduplicate skill ids before writing.
- Use public ids like `SUE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`.
- Catch and log write failures; do not break the coworker response path.
- Do not write aggregate `SkillMetric` here.

- [ ] **Step 3: Run tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/skills/usage-events.test.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/lib/skills/usage-events.ts apps/web/lib/skills/usage-events.test.ts
git commit -s -m "feat(skills): record skill usage events"
```

### Task 5: Add SkillMetric aggregator

**Files:**
- Create: `apps/web/lib/skills/skill-metrics.ts`
- Create: `apps/web/lib/skills/skill-metrics.test.ts`

- [ ] **Step 1: Write tests**

Test:

- period key generation,
- invocation count from `invoked` rows,
- success count from `completed` rows,
- no double-counting on rerun,
- rows grouped by `skillId`, `agentId`, and `period`.

- [ ] **Step 2: Implement aggregator**

Implement:

```typescript
export function getSkillMetricPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export async function aggregateSkillMetrics(input?: {
  period?: string;
  since?: Date;
  until?: Date;
}): Promise<{ upserted: number }>
```

Use event counts as source of truth:

- `invocationCount` = count of `phase="invoked"`,
- `successCount` = count of `phase="completed"`,
- average latency remains null until tool/runtime events supply latency,
- `feedbackNotes` remains null.

Use `upsert` on `SkillMetric` by `skillId_agentId_period`.

- [ ] **Step 3: Register the aggregator as a scheduled job**

Without a schedule, `aggregateSkillMetrics` would never run and `SkillMetric` would stay empty, defeating the Definition of Done. Register the aggregator as a daily `ScheduledJob`:

1. Add a seed entry in `packages/db/src/seed.ts` or the nearest companion scheduled-job seed with `jobId="skill-metrics-aggregator"`, `name="Skill Metrics Aggregator"`, and `schedule="0 5 * * *"` (daily 05:00 UTC). `ScheduledJob` has no `kind` or `enabled` columns; enabled means the schedule is not `disabled`. The 05:00 slot was verified on 2026-05-15 against live `ScheduledJob` rows and repo cron seeds; no existing job uses it.
2. Register a handler in the scheduled-job dispatcher (search for an existing job-kind switch — typically in `apps/web/lib/scheduled-jobs/` or the dispatcher route) that calls `aggregateSkillMetrics()` and records duration.
3. Aggregator must be idempotent — repeated runs against the same period upsert to the same `SkillMetric` rows, never duplicate. Step 1 of this task's tests already covers this.

Also expose a server-action button on `/platform/ai/skills` (or an existing admin "Run job" surface) that runs `aggregateSkillMetrics({ period })` on demand, so an operator can force a refresh during UX verification without waiting for the cron tick.

- [ ] **Step 4: Run tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/skills/skill-metrics.test.ts
```

Expected: tests pass. The scheduled-job handler test must also assert idempotency across two consecutive invocations.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/skills/skill-metrics.ts apps/web/lib/skills/skill-metrics.test.ts packages/db/src/seed.ts
git commit -s -m "feat(skills): aggregate skill metrics from usage events"
```

## Chunk 3: Prompt And Tool Attribution

### Task 6: Add skills block to prompt assembly without DB side effects

**Files:**
- Modify: `apps/web/lib/tak/prompt-assembler.ts`
- Modify: `apps/web/lib/tak/prompt-assembler.test.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Write prompt assembler tests**

Add tests that:

- `skills` renders after domain context and before page data,
- no skills block appears when `skills` is empty or omitted,
- existing domain tools behavior is unchanged.

- [ ] **Step 2: Update `PromptInput`**

Add:

```typescript
  skills?: Array<{
    skillId: string;
    label: string;
    description: string;
  }>;
```

- [ ] **Step 3: Render the skills block**

In the dynamic domain block:

```typescript
if (input.skills && input.skills.length > 0) {
  domainBlock += "\n\nAvailable coworker skills:";
  for (const skill of input.skills) {
    domainBlock += `\n- ${skill.skillId}: ${skill.label} - ${skill.description}`;
  }
}
```

Do not import Prisma or event writers into `prompt-assembler.ts`.

- [ ] **Step 4: Record eligible and loaded events in `agent-coworker.ts`**

In the unified prompt path:

- load runtime skills using `getSkillsForAgent(agent.agentId)`,
- pass skill summaries into `assembleSystemPrompt`,
- call `recordSkillUsageEvents({ phase: "eligible", skillIds: ... })`,
- call `recordSkillUsageEvents({ phase: "loaded", skillIds: ... })` after the skills block is included.

If route fallback skills are used and have no `skillId`, do not invent ids. Record only DB-backed skill ids.

- [ ] **Step 5: Run focused tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/prompt-assembler.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/tak/prompt-assembler.ts apps/web/lib/tak/prompt-assembler.test.ts apps/web/lib/actions/agent-coworker.ts
git commit -s -m "feat(skills): expose coworker skills in prompt context"
```

### Task 7: Propagate active skill id into tool audit

**Files:**
- Modify: `apps/web/lib/tak/autonomous-work-run.ts`
- Modify: `apps/web/lib/tak/agentic-loop.ts`
- Modify: `apps/web/lib/mcp-governed-execute.ts`
- Modify: related tests for all three files

- [ ] **Step 1: Write failing tests**

Add tests that prove:

- `executeAutonomousAgenticLoop` passes `activeSkillId` to `runAgenticLoop`,
- `runAgenticLoop` passes `skillId` into governed execution context,
- `mcp-governed-execute` writes `skillId` to `ToolExecution`,
- a failed tool call records `phase="failed"` for the active skill,
- a successful tool call records `phase="completed"` for the active skill.

- [ ] **Step 2: Extend types**

Add `activeSkillId?: string | null` to:

- `executeAutonomousAgenticLoop` input,
- `runAgenticLoop` params,
- `GovernedExecuteContext`.

- [ ] **Step 3: Extract active skill id from user message**

In `agent-coworker.ts`, before invoking `executeAutonomousAgenticLoop`:

```typescript
const activeSkillId = extractInvokedSkillId(input.content);
if (activeSkillId) {
  await recordSkillUsageEvents({
    phase: "invoked",
    skillIds: [activeSkillId],
    agentId: agent.agentId,
    userId: user.id,
    threadId,
    routeContext: input.routeContext,
  });
}
```

Pass `activeSkillId` into `executeAutonomousAgenticLoop`.

- [ ] **Step 4: Bind tool executions**

In `runAgenticLoop`, pass `activeSkillId` to `governedExecuteTool` context when present. In `mcp-governed-execute`, include it in the audit row as `skillId`.

- [ ] **Step 5: Record completion/failure**

After each tool result in `runAgenticLoop`, if `activeSkillId` is present:

- write `completed` when the tool succeeds,
- write `failed` when the tool fails,
- include `{ toolName, iteration }` metadata.

- [ ] **Step 6: Run focused tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/autonomous-work-run.test.ts apps/web/lib/tak/agentic-loop.test.ts apps/web/lib/mcp-governed-execute.test.ts
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/lib/tak/autonomous-work-run.ts apps/web/lib/tak/autonomous-work-run.test.ts apps/web/lib/tak/agentic-loop.ts apps/web/lib/tak/agentic-loop.test.ts apps/web/lib/mcp-governed-execute.ts apps/web/lib/mcp-governed-execute.test.ts apps/web/lib/actions/agent-coworker.ts
git commit -s -m "feat(skills): attribute tool execution to active skills"
```

## Chunk 4: Runtime Issue Reflection

### Task 8: Extract repeated-tool issue detection

**Files:**
- Create: `apps/web/lib/tak/runtime-issues.ts`
- Create: `apps/web/lib/tak/runtime-issues.test.ts`
- Modify: `apps/web/lib/tak/agentic-loop.ts`
- Modify: `apps/web/lib/tak/agentic-loop.test.ts`

- [ ] **Step 1: Write runtime issue tests**

Test:

- no issue under threshold,
- issue at three identical tool calls in a 40-call window,
- reason hint includes failed tool error when present,
- build routes do not write the `PlatformIssueReport`,
- non-build routes write one `agent_stuck` issue payload.

- [ ] **Step 2: Move detection into helper**

Create:

```typescript
export function detectRepeatedToolCall(input: {
  executedTools: Array<{ name: string; args?: Record<string, unknown>; result: { success: boolean; error?: string; message?: string } }>;
  iteration: number;
  window?: number;
  threshold?: number;
}): RepeatedToolIssue | null
```

Keep the same hashing behavior as the current loop.

- [ ] **Step 3: Move issue write into helper**

Create:

```typescript
export async function recordRepeatedToolIssue(input: {
  repeated: RepeatedToolIssue;
  routeContext: string | null;
  userId: string;
  agentId: string | null;
  featureBuildId?: string | null;
}): Promise<{ reportId: string } | null>
```

Use the same `PlatformIssueReport` fields currently written inline.

- [ ] **Step 4: Replace inline logic in `agentic-loop.ts`**

The loop should:

1. call `detectRepeatedToolCall`,
2. build the stop message as today,
3. call `recordRepeatedToolIssue` for non-build routes,
4. return immediately as today.

Behavior must not change except that the issue code is now reusable.

- [ ] **Step 5: Run tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/runtime-issues.test.ts apps/web/lib/tak/agentic-loop.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/tak/runtime-issues.ts apps/web/lib/tak/runtime-issues.test.ts apps/web/lib/tak/agentic-loop.ts apps/web/lib/tak/agentic-loop.test.ts
git commit -s -m "refactor(tak): extract repeated-tool runtime issues"
```

### Task 9: Create minimal reflection trigger

**Files:**
- Create: `apps/web/lib/tak/reflection-triggers.ts`
- Create: `apps/web/lib/tak/reflection-triggers.test.ts`
- Create: `apps/web/lib/improvement-flywheel/signals.ts`
- Create: `apps/web/lib/improvement-flywheel/signals.test.ts`
- Modify: `apps/web/lib/tak/autonomous-work-run.ts`
- Modify: `apps/web/lib/coworker-self-assessment/assessment-service.ts` only if needed for dependency injection

- [ ] **Step 1: Write tests for signal writer**

Test `createOrTouchImprovementSignal`:

- creates a signal for `sourceType + sourceId`,
- increments `recurrenceCount` and updates `lastSeenAt` on duplicates,
- preserves evidence JSON.

- [ ] **Step 2: Implement `signals.ts`**

Create:

```typescript
export async function createOrTouchImprovementSignal(input: {
  sourceType: string;
  sourceId: string;
  title: string;
  description?: string | null;
  evidence?: Record<string, unknown>;
  routeContext?: string | null;
  agentId?: string | null;
  threadId?: string | null;
  buildId?: string | null;
  toolName?: string | null;
  suspectedRootCause?: string | null;
  objectiveImpactHypothesis?: string | null;
}): Promise<{ signalId: string }>
```

- [ ] **Step 3: Write tests for reflection trigger**

Given a new `PlatformIssueReport(type="agent_stuck")`, assert the trigger:

- creates a child or sibling `TaskRun` with source `proactive`,
- persists `CoworkerSelfAssessment`,
- persists `CoworkerCapabilityNeed(kind="skill")`,
- emits `ImprovementSignal`,
- marks the reflection task completed,
- does not update `SkillDefinition`.

- [ ] **Step 4: Implement `processRuntimeIssueReflection`**

Create:

```typescript
export async function processRuntimeIssueReflection(input: {
  taskRunId?: string | null;
  userId: string;
  agentId: string;
  threadId: string;
  routeContext: string;
  since: Date;
}): Promise<{ processed: number }>
```

Implementation:

1. Query `PlatformIssueReport` rows created since `since` for the same agent/thread/route where `type="agent_stuck"` and `source="coworker_runtime"`.
2. For each row, create an autonomous work run titled `Skill reflection: repeated tool use`.
3. Create a deterministic self-assessment with `verdict="gaps"` and `confidence="medium"`.
4. Create one need with:
   - `kind="skill"`,
   - `severity="important"`,
   - evidence containing `platformIssueReportId`, `threadId`, `taskRunId`, `routeContext`.
5. Create or touch an `ImprovementSignal` with `sourceType="platform_issue_report"` and `sourceId=row.reportId`.
6. Complete the reflection `TaskRun`.

- [ ] **Step 5: Hook the trigger after autonomous runs**

In `executeAutonomousAgenticLoop`, capture `const startedAt = new Date()` before `runAgenticLoop`. After the result resolves, call `processRuntimeIssueReflection` with the run context. Catch and log failures; never block the user response. Use `void`-style fire-and-forget plus structured logging with the `[reflection-triggers]` prefix, matching the planned `reflection-triggers.ts` module and existing bracketed subsystem tags such as `[agentic-loop]`, `[agentic-tool]`, and `[governed-execute]`, so a slow reflection job cannot delay the user-facing response.

**Reflection-loop self-protection (must be explicit).** A reflection run produces tool calls of its own; if one of those calls trips the repeated-tool detector, it would file a new `PlatformIssueReport`, which would trigger another reflection — an unbounded loop. Apply all three guards:

1. **Source check.** When the parent `TaskRun.source === "proactive"` and the run title starts with `"Skill reflection:"`, skip the post-run reflection hook entirely. Test: a reflection `TaskRun` that itself trips the repeated-tool guard must produce zero new reflection `TaskRun` rows.
2. **Metadata guard.** Stamp every reflection-spawned `TaskRun` with `metadata.reflectionDepth = (parent.metadata.reflectionDepth ?? 0) + 1`. Refuse to spawn when `reflectionDepth >= 1`. This catches the case where the source check is bypassed (e.g. a future caller uses `source="coworker"` for a reflection-equivalent flow).
3. **Idempotency at the signal layer.** `createOrTouchImprovementSignal` already dedupes on `(sourceType, sourceId)`. The reflection trigger MUST set `sourceId = platformIssueReport.reportId` so a re-fire on the same issue increments `recurrenceCount` instead of producing a parallel signal.

Add a vitest case that asserts a reflection run cannot recursively trigger another reflection run, exercising all three guards.

- [ ] **Step 6: Run focused tests**

```powershell
pnpm --filter web exec vitest run apps/web/lib/improvement-flywheel/signals.test.ts apps/web/lib/tak/reflection-triggers.test.ts apps/web/lib/tak/autonomous-work-run.test.ts
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/lib/improvement-flywheel apps/web/lib/tak/reflection-triggers.ts apps/web/lib/tak/reflection-triggers.test.ts apps/web/lib/tak/autonomous-work-run.ts apps/web/lib/tak/autonomous-work-run.test.ts
git commit -s -m "feat(tak): reflect on repeated-tool runtime issues"
```

## Chunk 5: Operator UI

### Task 10: Add coworker skill attribution chip

**Files:**
- Create: `apps/web/components/agent/AgentSkillAttributionChip.tsx`
- Create: `apps/web/components/agent/AgentSkillAttributionChip.test.tsx`
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx`
- Modify: `apps/web/components/agent/AgentSkillsDropdown.tsx`

- [ ] **Step 1: Write chip tests**

Test:

- renders skill label and version when present,
- uses theme-token classes or CSS variables only,
- renders nothing when no active skill is present.

- [ ] **Step 2: Preserve selected skill metadata**

Change skill invocation flow from "prompt string only" to include skill metadata where possible:

- add optional `onSendSkill(skill)` callback to `AgentSkillsDropdown`,
- call it when a coworker skill is clicked,
- keep `onSend(skill.prompt)` fallback for existing behavior,
- store `{ skillId, label }` in `AgentCoworkerPanel` while the request is busy.

- [ ] **Step 3: Render the chip**

Place the chip near the busy/current-tool status area, not as a large card. It should be a compact operational indicator:

```tsx
<AgentSkillAttributionChip skill={activeSkill} />
```

Use only `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-2)]`, `border-[var(--dpf-border)]`, and `text-[var(--dpf-accent)]`.

- [ ] **Step 4: Run focused UI tests**

```powershell
pnpm --filter web exec vitest run apps/web/components/agent/AgentSkillAttributionChip.test.tsx apps/web/components/agent/AgentPanelHeader.test.tsx apps/web/components/agent/AgentSkillsDropdown.test.tsx
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/components/agent
git commit -s -m "feat(ui): show active coworker skill attribution"
```

### Task 11: Update Skills Observatory with telemetry

**Files:**
- Modify: `apps/web/lib/actions/skills-observatory.ts`
- Modify: `apps/web/components/platform/SkillsObservatoryPanel.tsx`
- Modify: `apps/web/components/admin/SkillsCatalogView.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/skills/page.test.tsx`
- Add tests if missing for `skills-observatory.ts`

- [ ] **Step 1: Add server action tests for telemetry shape**

Test that `getSkillsObservatoryStats` includes:

- total usage events,
- invoked events,
- completed events,
- failed events,
- metric rows.

Test `getSpecialistExecutions` includes `skillId` when present.

- [ ] **Step 2: Update data fetchers**

`skills-observatory.ts` should read:

- `SkillDefinition`,
- `SkillAssignment`,
- `SkillMetric`,
- `SkillUsageEvent`,
- `ToolExecution.skillId`.

Do not keep route-only skills as the only source of truth. Route skills can remain a fallback section, but DB skills and usage metrics must be primary.

- [ ] **Step 3: Update UI**

In `SkillsObservatoryPanel`:

- add a "Usage" or "Telemetry" tab,
- show invoked/completed/failed counts,
- show recent skill-attributed tool executions,
- avoid card nesting and keep rows dense.

In `SkillsCatalogView`, replace hardcoded hex values:

- `#60a5fa` -> `var(--dpf-info)`,
- `#fb923c` -> `var(--dpf-warning)`.

- [ ] **Step 4: Run focused tests**

```powershell
pnpm --filter web exec vitest run 'apps/web/app/(shell)/platform/ai/skills/page.test.tsx' apps/web/lib/actions/skills-observatory.test.ts apps/web/components/platform/SkillsObservatoryPanel.test.tsx
```

If `skills-observatory.test.ts` or `SkillsObservatoryPanel.test.tsx` do not exist yet, create them in this task.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/actions/skills-observatory.ts apps/web/components/platform/SkillsObservatoryPanel.tsx apps/web/components/admin/SkillsCatalogView.tsx 'apps/web/app/(shell)/platform/ai/skills/page.test.tsx'
git commit -s -m "feat(ai): surface skill telemetry in operations"
```

## Chunk 6: Verification And Delivery

### Task 12: Run required verification

**Files:** no source changes expected unless verification finds defects.

- [ ] **Step 1: Run focused test suite**

```powershell
pnpm --filter web exec vitest run apps/web/lib/skills/runtime.test.ts apps/web/lib/skills/usage-events.test.ts apps/web/lib/skills/skill-metrics.test.ts apps/web/lib/improvement-flywheel/signals.test.ts apps/web/lib/tak/runtime-issues.test.ts apps/web/lib/tak/reflection-triggers.test.ts apps/web/lib/tak/prompt-assembler.test.ts apps/web/lib/tak/autonomous-work-run.test.ts apps/web/lib/tak/agentic-loop.test.ts apps/web/lib/mcp-governed-execute.test.ts apps/web/lib/coworker-self-assessment/assessment-service.test.ts apps/web/lib/coworker-self-assessment/review-service.test.ts apps/web/lib/mcp-tools-coworker-self-assessment.test.ts apps/web/components/agent/AgentSkillAttributionChip.test.tsx apps/web/components/agent/AgentPanelHeader.test.tsx apps/web/components/agent/AgentSkillsDropdown.test.tsx 'apps/web/app/(shell)/platform/ai/skills/page.test.tsx'
```

Expected: all listed tests pass.

- [ ] **Step 2: Run typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run production build**

```powershell
pnpm --filter web exec next build
```

Expected: build succeeds. If a pre-existing environmental failure appears, capture the exact error and fix if feasible.

- [ ] **Step 4: Verify migration applies cleanly**

Run against the local install:

```powershell
pnpm --filter @dpf/db exec prisma migrate status
```

Expected: database is up to date after applying the new migration.

- [ ] **Step 5: UX verification**

Use the Docker-served app configured by repo-root `.env`:

1. Log in with `admin@dpf.local` and `ADMIN_PASSWORD` from repo-root `.env`.
2. Open a route with a coworker that has DB-backed skills.
3. Invoke a skill from the coworker skills dropdown.
4. Confirm the skill chip appears while the request is active.
5. Trigger or simulate a repeated-tool guard in a test-safe path.
6. Open `/platform/ai/skills` and confirm telemetry appears.
7. Open `/platform/ai/capability-needs?kind=skill` and confirm skill needs can be filtered.

Capture screenshots or notes as PR evidence.

- [ ] **Step 6: Check git status**

```powershell
git status --short --branch
```

Expected: only intended files changed.

- [ ] **Step 7: Final commit if verification fixes were needed**

```powershell
git add <changed-files>
git commit -s -m "fix(ai): complete skill telemetry verification"
```

Only do this if verification required changes after the prior task commits.

### Task 13: Push and PR

**Files:** none.

- [ ] **Step 1: PR-overlap sweep before pushing**

This slice touches several high-traffic files (`agent-coworker.ts`, `agent-skills.ts`, `agentic-loop.ts`, `autonomous-work-run.ts`, `prompt-assembler.ts`, `mcp-governed-execute.ts`, `mcp-tools.ts`, `coworker-self-assessment/types.ts`, `schema.prisma`). Concurrent sessions can land overlapping changes. Sweep before push:

```powershell
git fetch origin main
git log origin/main --since="14 days ago" --pretty=format:"%h %s" -- `
  apps/web/lib/actions/agent-coworker.ts `
  apps/web/lib/actions/agent-skills.ts `
  apps/web/lib/tak/agentic-loop.ts `
  apps/web/lib/tak/autonomous-work-run.ts `
  apps/web/lib/tak/prompt-assembler.ts `
  apps/web/lib/mcp-governed-execute.ts `
  apps/web/lib/mcp-tools.ts `
  apps/web/lib/coworker-self-assessment/types.ts `
  packages/db/prisma/schema.prisma

gh pr list --state open --json number,title,headRefName,files `
  --jq '.[] | select(.files[]?.path | test("agent-coworker|agent-skills|agentic-loop|autonomous-work-run|prompt-assembler|mcp-governed-execute|mcp-tools|coworker-self-assessment|schema.prisma")) | {number, title, branch: .headRefName}'
```

If conflicts are likely, rebase onto `origin/main` and re-run verification (Task 12) before pushing. If another open PR is solving the same problem (e.g. another session also extracting `runtime-issues.ts`), pause and coordinate — do not push and hope.

- [ ] **Step 2: Push**

```powershell
git push -u origin feat/skill-telemetry-and-reflection
```

- [ ] **Step 3: Open a draft PR**

Use GitHub tooling or `gh` fallback. PR title:

```text
[codex] Governed skill telemetry and reflection
```

PR body must include:

- summary of skill telemetry (what events fire, where `ToolExecution.skillId` is written, how `SkillMetric` is populated and on what schedule),
- summary of reflection trigger behavior (what the trigger consumes, what it writes, the three-layer loop-protection),
- explicit statement that skill proposals, curator, lifecycle states, evidence search, evolution, and external import are out of scope (Slices 3–7),
- verification commands and outcomes from Task 12,
- UX verification evidence (screenshots from Task 12 Step 5),
- migration note (Prisma migrate, indexes added, no destructive changes, nullable columns only),
- DCO note (all commits signed; confirm `gh pr checks` shows DCO green before flipping out of draft).

- [ ] **Step 4: Verify PR-level checks before marking ready**

```powershell
gh pr checks --watch
```

Wait for green. Per AGENTS.md §4, DCO must pass and the build gate must be clean before any reviewer is requested.

## Rollback Plan

If the implementation causes runtime problems:

1. Disable the reflection trigger call in `executeAutonomousAgenticLoop` first; telemetry can remain passive.
2. Stop the metrics aggregator if it was scheduled.
3. Leave nullable columns in place; do not roll back schema in production unless migration policy requires it.
4. Revert UI chip if it causes layout problems.
5. File a `CoworkerCapabilityNeed(kind="code")` or backlog item with evidence if the rollback reveals a platform defect.

## Definition Of Done

- `SkillUsageEvent` records are created for eligible, loaded, invoked, completed, and failed phases.
- `SkillMetric` is populated by an idempotent aggregator **and** the aggregator is registered as a daily `ScheduledJob` (cron `0 5 * * *`, verified free on 2026-05-15), seeded, and exposed via an on-demand admin trigger.
- `ToolExecution.skillId` is set for explicit skill invocations.
- `COWORKER_CAPABILITY_NEED_KINDS` is **extended** (not replaced): the existing eight values remain and `prompt | convention | code | other` are added; MCP schema picks up the change without duplication.
- Repeated-tool runtime issues are detected through `runtime-issues.ts`, not open-coded in `agentic-loop.ts`.
- A repeated-tool `PlatformIssueReport` can produce a governed reflection `TaskRun`, a `CoworkerSelfAssessment`, a `CoworkerCapabilityNeed(kind="skill")`, and an `ImprovementSignal`.
- Reflection runs cannot recursively trigger themselves: the source check, `metadata.reflectionDepth` guard, and `(sourceType, sourceId)` signal-layer dedupe all have explicit test coverage.
- No production skill content is mutated by this slice.
- `/platform/ai/skills` shows skill telemetry.
- Coworker chat shows a compact, theme-aware active skill chip.
- Focused Vitest suite passes.
- `pnpm --filter web typecheck` passes.
- `pnpm --filter web exec next build` passes.
- UX verification is recorded.
- PR-overlap sweep against the touched files is recorded in the PR body; no concurrent PR is solving the same surface.
- All commits are signed with DCO and pushed to a branch; `gh pr checks` is green before flipping out of draft.
