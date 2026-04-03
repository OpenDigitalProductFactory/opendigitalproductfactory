# Build Process Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single build-specialist agent with a Build Process Orchestrator that decomposes plan tasks, dispatches specialist sub-agents in parallel, and reports phase-summary progress to the user.

**Architecture:** Two-tier hierarchy — Build Process Orchestrator (strong tier, direct dispatch function) delegates to specialist sub-agents (Data Architect, Software Engineer, Frontend Engineer, QA Engineer) running in separate AgentThreads via the existing `runAgenticLoop()`. Parallel dispatch with dependency-aware sequencing. Fork model inspired by Claude Code.

**Tech Stack:** TypeScript, Prisma (existing models), existing `runAgenticLoop`, `agentEventBus`, `agent-grants`, `agent_registry.json`.

**Spec:** `docs/superpowers/specs/2026-04-02-build-process-orchestrator-design.md`

---

## Task 1: Grant Map Completeness (Prerequisite)

The TAK "delegation with narrowing" guarantee requires all specialist tools in `TOOL_TO_GRANTS`. Without this, authority narrowing is not enforced.

**Files:**
- Modify: `apps/web/lib/tak/agent-grants.ts` (TOOL_TO_GRANTS object, ~line 11)
- Test: `apps/web/lib/tak/agent-grants.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/tak/agent-grants.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isToolAllowedByGrants } from "./agent-grants";

describe("TOOL_TO_GRANTS completeness", () => {
  const sandboxGrants = ["sandbox_execute"];
  const noGrants: string[] = [];

  it("write_sandbox_file requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("write_sandbox_file", sandboxGrants)).toBe(true);
    expect(isToolAllowedByGrants("write_sandbox_file", noGrants)).toBe(false);
  });

  it("validate_schema requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("validate_schema", sandboxGrants)).toBe(true);
    expect(isToolAllowedByGrants("validate_schema", noGrants)).toBe(false);
  });

  it("describe_model requires sandbox_execute", () => {
    expect(isToolAllowedByGrants("describe_model", sandboxGrants)).toBe(true);
    expect(isToolAllowedByGrants("describe_model", noGrants)).toBe(false);
  });

  it("execute_promotion requires iac_execute", () => {
    const iacGrants = ["iac_execute"];
    expect(isToolAllowedByGrants("execute_promotion", iacGrants)).toBe(true);
    expect(isToolAllowedByGrants("execute_promotion", noGrants)).toBe(false);
  });

  it("orchestrator with only backlog_write cannot use sandbox tools", () => {
    const orchGrants = ["build_plan_write", "backlog_write"];
    expect(isToolAllowedByGrants("write_sandbox_file", orchGrants)).toBe(false);
    expect(isToolAllowedByGrants("run_sandbox_command", orchGrants)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm exec vitest run lib/tak/agent-grants.test.ts
```

Expected: `write_sandbox_file` tests fail (currently unmapped, so `isToolAllowedByGrants` returns `true` for all grants including empty).

- [ ] **Step 3: Add missing TOOL_TO_GRANTS entries**

In `apps/web/lib/tak/agent-grants.ts`, add to the `TOOL_TO_GRANTS` object (after the existing `// Build / Sandbox` section around line 33):

```typescript
  write_sandbox_file: ["sandbox_execute"],
  validate_schema: ["sandbox_execute"],
  describe_model: ["sandbox_execute"],
```

And in the `// Deploy / Release` section (after `deploy_feature` around line 52):

```typescript
  execute_promotion: ["iac_execute"],
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && pnpm exec vitest run lib/tak/agent-grants.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```
feat(tak): add missing TOOL_TO_GRANTS entries for authority narrowing

Prerequisite for EP-BUILD-ORCHESTRATOR. Adds write_sandbox_file,
validate_schema, describe_model (sandbox_execute) and execute_promotion
(iac_execute) to the grant map so specialist agents are properly scoped.
```

---

## Task 2: Agent Registry — Register Specialist Agents

Register 4 specialist agents and update AGT-ORCH-300 with new delegates and `backlog_write` grant.

**Files:**
- Modify: `packages/db/data/agent_registry.json`

- [ ] **Step 1: Add specialist agent entries**

Add these 4 entries to the `agents` array in `packages/db/data/agent_registry.json`:

```json
{
  "agent_id": "AGT-BUILD-DA",
  "agent_name": "build-data-architect",
  "tier": "specialist",
  "value_stream": "integrate",
  "capability_domain": "Schema design, Prisma migrations, model validation, index optimization; DAMA-DMBOK aligned",
  "human_supervisor_id": "HR-200",
  "hitl_tier_default": 0,
  "delegates_to": [],
  "escalates_to": "AGT-ORCH-300",
  "it4it_sections": ["5.3 Integrate Value Stream", "5.3.3"],
  "status": "defined",
  "config_profile": {
    "model_binding": { "model_id": null, "temperature": 0.2, "max_tokens": 8192 },
    "execution_runtime": { "type": "in_process", "timeout_seconds": 600 },
    "token_budget": { "daily_limit": 200000, "per_task_limit": 50000 },
    "tool_grants": ["sandbox_execute"]
  }
},
{
  "agent_id": "AGT-BUILD-SE",
  "agent_name": "build-software-engineer",
  "tier": "specialist",
  "value_stream": "integrate",
  "capability_domain": "API routes, server actions, business logic, imports/exports wiring",
  "human_supervisor_id": "HR-200",
  "hitl_tier_default": 0,
  "delegates_to": [],
  "escalates_to": "AGT-ORCH-300",
  "it4it_sections": ["5.3 Integrate Value Stream", "5.3.3"],
  "status": "defined",
  "config_profile": {
    "model_binding": { "model_id": null, "temperature": 0.2, "max_tokens": 8192 },
    "execution_runtime": { "type": "in_process", "timeout_seconds": 600 },
    "token_budget": { "daily_limit": 200000, "per_task_limit": 50000 },
    "tool_grants": ["sandbox_execute"]
  }
},
{
  "agent_id": "AGT-BUILD-FE",
  "agent_name": "build-frontend-engineer",
  "tier": "specialist",
  "value_stream": "integrate",
  "capability_domain": "Pages, components, CSS variables, semantic HTML, a11y, keyboard navigation",
  "human_supervisor_id": "HR-200",
  "hitl_tier_default": 0,
  "delegates_to": [],
  "escalates_to": "AGT-ORCH-300",
  "it4it_sections": ["5.3 Integrate Value Stream", "5.3.3"],
  "status": "defined",
  "config_profile": {
    "model_binding": { "model_id": null, "temperature": 0.2, "max_tokens": 8192 },
    "execution_runtime": { "type": "in_process", "timeout_seconds": 600 },
    "token_budget": { "daily_limit": 200000, "per_task_limit": 50000 },
    "tool_grants": ["sandbox_execute"]
  }
},
{
  "agent_id": "AGT-BUILD-QA",
  "agent_name": "build-qa-engineer",
  "tier": "specialist",
  "value_stream": "integrate",
  "capability_domain": "Test execution, typecheck, output interpretation, build verification",
  "human_supervisor_id": "HR-200",
  "hitl_tier_default": 0,
  "delegates_to": [],
  "escalates_to": "AGT-ORCH-300",
  "it4it_sections": ["5.3 Integrate Value Stream", "5.3.5"],
  "status": "defined",
  "config_profile": {
    "model_binding": { "model_id": null, "temperature": 0.1, "max_tokens": 4096 },
    "execution_runtime": { "type": "in_process", "timeout_seconds": 300 },
    "token_budget": { "daily_limit": 100000, "per_task_limit": 25000 },
    "tool_grants": ["sandbox_execute"]
  }
}
```

- [ ] **Step 2: Update AGT-ORCH-300**

In the AGT-ORCH-300 entry, update `delegates_to` to add the 4 new IDs alongside existing ones:

```json
"delegates_to": ["AGT-130", "AGT-131", "AGT-132", "AGT-BUILD-DA", "AGT-BUILD-SE", "AGT-BUILD-FE", "AGT-BUILD-QA"]
```

And add `"backlog_write"` to AGT-ORCH-300's `config_profile.tool_grants` array.

- [ ] **Step 3: Verify JSON validity**

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/db/data/agent_registry.json','utf8')); console.log('Valid JSON')"
```

- [ ] **Step 4: Commit**

```
feat(registry): register specialist sub-agents for Build Process Orchestrator

AGT-BUILD-DA (data-architect), AGT-BUILD-SE (software-engineer),
AGT-BUILD-FE (frontend-engineer), AGT-BUILD-QA (qa-engineer).
All escalate to AGT-ORCH-300. HITL tier 0 (fully autonomous).
Updates AGT-ORCH-300 delegates_to and adds backlog_write grant.
```

---

## Task 3: Agent Event Bus — Orchestrator Events

Add orchestrator-specific event types for SSE progress rendering.

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.ts` (AgentEvent type union, ~line 5)

- [ ] **Step 1: Add orchestrator event types**

In `apps/web/lib/tak/agent-event-bus.ts`, add to the `AgentEvent` type union (after the `async:` events, before the closing semicolon):

```typescript
  // EP-BUILD-ORCHESTRATOR: orchestrator progress events
  | { type: "orchestrator:build_started"; buildId: string; taskCount: number; specialists: string[] }
  | { type: "orchestrator:task_dispatched"; buildId: string; taskTitle: string; specialist: string }
  | { type: "orchestrator:task_complete"; buildId: string; taskTitle: string; specialist: string; outcome: string }
  | { type: "orchestrator:phase_summary"; buildId: string; completed: number; total: number; summary: string }
  | { type: "orchestrator:specialist_retry"; buildId: string; specialist: string; reason: string; attempt: number }
```

- [ ] **Step 2: Verify typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

Expected: Clean. These are type-only additions — no runtime change.

- [ ] **Step 3: Commit**

```
feat(events): add orchestrator SSE event types for EP-BUILD-ORCHESTRATOR

New event types: build_started, task_dispatched, task_complete,
phase_summary, specialist_retry. UI can render real-time specialist
progress without polling.
```

---

## Task 4: Task Dependency Graph (Pure Function)

Pure function that takes a plan's `fileStructure` and `tasks`, returns ordered execution phases with parallel groups.

**Files:**
- Create: `apps/web/lib/integrate/task-dependency-graph.ts`
- Test: `apps/web/lib/integrate/task-dependency-graph.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/integrate/task-dependency-graph.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildDependencyGraph, type PlanTask, type PlanFileEntry } from "./task-dependency-graph";

describe("buildDependencyGraph", () => {
  it("puts schema tasks in phase 1, API in phase 2, frontend in phase 3, QA last", () => {
    const files: PlanFileEntry[] = [
      { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "Add Complaint model" },
      { path: "apps/web/app/api/complaints/route.ts", action: "create", purpose: "CRUD API" },
      { path: "apps/web/components/complaints/ComplaintList.tsx", action: "create", purpose: "List UI" },
    ];
    const tasks: PlanTask[] = [
      { title: "Add Complaint schema", testFirst: "", implement: "", verify: "" },
      { title: "Create complaints API", testFirst: "", implement: "", verify: "" },
      { title: "Build complaints UI", testFirst: "", implement: "", verify: "" },
    ];

    const phases = buildDependencyGraph(files, tasks);

    expect(phases).toHaveLength(4); // schema, api, frontend, qa
    expect(phases[0]!.tasks[0]!.specialist).toBe("data-architect");
    expect(phases[1]!.tasks[0]!.specialist).toBe("software-engineer");
    expect(phases[2]!.tasks[0]!.specialist).toBe("frontend-engineer");
    expect(phases[3]!.tasks[0]!.specialist).toBe("qa-engineer");
  });

  it("groups independent tasks in the same phase for parallel execution", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/app/api/foo/route.ts", action: "create", purpose: "Foo API" },
      { path: "apps/web/app/api/bar/route.ts", action: "create", purpose: "Bar API" },
    ];
    const tasks: PlanTask[] = [
      { title: "Create foo API", testFirst: "", implement: "", verify: "" },
      { title: "Create bar API", testFirst: "", implement: "", verify: "" },
    ];

    const phases = buildDependencyGraph(files, tasks);

    // Both are API tasks with no schema dependency — should be in same phase
    const apiPhase = phases.find(p => p.tasks.some(t => t.specialist === "software-engineer"));
    expect(apiPhase!.tasks).toHaveLength(2);
  });

  it("detects file overlap and sequences instead of parallelizing", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/lib/shared.ts", action: "modify", purpose: "Add helper A" },
      { path: "apps/web/lib/shared.ts", action: "modify", purpose: "Add helper B" },
    ];
    const tasks: PlanTask[] = [
      { title: "Add helper A", testFirst: "", implement: "", verify: "" },
      { title: "Add helper B", testFirst: "", implement: "", verify: "" },
    ];

    const phases = buildDependencyGraph(files, tasks);

    // Same file — must be sequential, not parallel
    const taskPhases = phases.filter(p => p.tasks.some(t => t.specialist !== "qa-engineer"));
    const totalNonQaTasks = taskPhases.reduce((sum, p) => sum + p.tasks.length, 0);
    expect(totalNonQaTasks).toBe(2);
    // They should not be in the same phase
    expect(taskPhases.some(p => p.tasks.length > 1)).toBe(false);
  });

  it("always adds QA phase at the end", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/components/Hello.tsx", action: "create", purpose: "UI" },
    ];
    const tasks: PlanTask[] = [
      { title: "Build hello component", testFirst: "", implement: "", verify: "" },
    ];

    const phases = buildDependencyGraph(files, tasks);
    const lastPhase = phases[phases.length - 1]!;
    expect(lastPhase.tasks[0]!.specialist).toBe("qa-engineer");
  });

  it("handles empty plan gracefully", () => {
    const phases = buildDependencyGraph([], []);
    expect(phases).toHaveLength(1); // QA only
    expect(phases[0]!.tasks[0]!.specialist).toBe("qa-engineer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm exec vitest run lib/integrate/task-dependency-graph.test.ts
```

Expected: Module not found.

- [ ] **Step 3: Implement task-dependency-graph.ts**

Create `apps/web/lib/integrate/task-dependency-graph.ts`:

```typescript
// apps/web/lib/integrate/task-dependency-graph.ts
// Pure function: plan structure → ordered execution phases with parallel groups.
// No DB imports. No side effects. Fully testable.

export type PlanFileEntry = {
  path: string;
  action: "create" | "modify";
  purpose: string;
};

export type PlanTask = {
  title: string;
  testFirst: string;
  implement: string;
  verify: string;
};

export type SpecialistRole = "data-architect" | "software-engineer" | "frontend-engineer" | "qa-engineer";

export type AssignedTask = {
  taskIndex: number;
  title: string;
  specialist: SpecialistRole;
  files: PlanFileEntry[];
  task: PlanTask;
};

export type ExecutionPhase = {
  phaseIndex: number;
  parallel: boolean;
  tasks: AssignedTask[];
};

// ─── Specialist Assignment ──────────────────────────────────────────────────

const SCHEMA_PATTERNS = [/packages\/db\/prisma\//i, /\.prisma$/i, /migration/i];
const API_PATTERNS = [/app\/api\//i, /actions\//i, /server-action/i, /lib\/.*(?:action|service)/i];
const FRONTEND_PATTERNS = [/components?\//i, /app\/\(shell\)\//i, /\.tsx$/i, /\.css$/i];

function classifyFile(path: string): SpecialistRole {
  if (SCHEMA_PATTERNS.some(p => p.test(path))) return "data-architect";
  if (API_PATTERNS.some(p => p.test(path))) return "software-engineer";
  if (FRONTEND_PATTERNS.some(p => p.test(path))) return "frontend-engineer";
  // Default: software-engineer handles misc files (lib utilities, configs, etc.)
  return "software-engineer";
}

function assignSpecialist(task: PlanTask, taskIndex: number, files: PlanFileEntry[]): AssignedTask {
  // Match task to files by index (plan tasks align 1:1 with file groups)
  // or by title keyword matching as fallback
  const taskFiles = files.filter((_f, i) => i === taskIndex) || [];
  const specialist = taskFiles.length > 0
    ? classifyFile(taskFiles[0]!.path)
    : classifyFromTitle(task.title);

  return { taskIndex, title: task.title, specialist, files: taskFiles, task };
}

function classifyFromTitle(title: string): SpecialistRole {
  const lower = title.toLowerCase();
  if (lower.includes("schema") || lower.includes("model") || lower.includes("migration") || lower.includes("database")) return "data-architect";
  if (lower.includes("api") || lower.includes("route") || lower.includes("action") || lower.includes("endpoint")) return "software-engineer";
  if (lower.includes("ui") || lower.includes("page") || lower.includes("component") || lower.includes("frontend") || lower.includes("layout")) return "frontend-engineer";
  if (lower.includes("test") || lower.includes("verify") || lower.includes("typecheck")) return "qa-engineer";
  return "software-engineer";
}

// ─── Dependency Ordering ────────────────────────────────────────────────────

const ROLE_PRIORITY: Record<SpecialistRole, number> = {
  "data-architect": 0,     // Schema first — everything depends on models
  "software-engineer": 1,  // API routes depend on schema
  "frontend-engineer": 2,  // Frontend depends on API types
  "qa-engineer": 3,        // Tests run after all code generation
};

/**
 * Build a dependency-aware execution plan from the build plan's file structure and tasks.
 *
 * Rules:
 * 1. Tasks are assigned to specialists based on file paths
 * 2. Tasks are grouped by specialist priority level (schema → API → frontend)
 * 3. Tasks at the same priority level run in parallel UNLESS they touch the same file
 * 4. A QA phase is always appended at the end
 */
export function buildDependencyGraph(
  files: PlanFileEntry[],
  tasks: PlanTask[],
): ExecutionPhase[] {
  // Assign specialists to tasks
  const assigned = tasks.map((task, i) => assignSpecialist(task, i, files));

  // Group by priority level
  const byPriority = new Map<number, AssignedTask[]>();
  for (const task of assigned) {
    if (task.specialist === "qa-engineer") continue; // QA always goes last
    const priority = ROLE_PRIORITY[task.specialist];
    const group = byPriority.get(priority) ?? [];
    group.push(task);
    byPriority.set(priority, group);
  }

  // Build phases — split groups that have file overlaps
  const phases: ExecutionPhase[] = [];
  const sortedPriorities = [...byPriority.keys()].sort((a, b) => a - b);

  for (const priority of sortedPriorities) {
    const group = byPriority.get(priority)!;
    const subPhases = splitByFileOverlap(group);
    for (const sub of subPhases) {
      phases.push({
        phaseIndex: phases.length,
        parallel: sub.length > 1,
        tasks: sub,
      });
    }
  }

  // Always append QA phase
  phases.push({
    phaseIndex: phases.length,
    parallel: false,
    tasks: [{
      taskIndex: -1, // Synthetic task — not from the plan
      title: "Full verification: tests + typecheck",
      specialist: "qa-engineer",
      files: [],
      task: { title: "Full verification", testFirst: "", implement: "", verify: "run_sandbox_tests + tsc --noEmit" },
    }],
  });

  return phases;
}

/**
 * Split a group of tasks into sub-groups where tasks with overlapping file
 * targets are in separate sub-groups (sequential), and non-overlapping tasks
 * are in the same sub-group (parallel).
 */
function splitByFileOverlap(tasks: AssignedTask[]): AssignedTask[][] {
  if (tasks.length <= 1) return [tasks];

  const result: AssignedTask[][] = [];
  const usedPaths = new Set<string>();

  let currentBatch: AssignedTask[] = [];

  for (const task of tasks) {
    const taskPaths = task.files.map(f => f.path);
    const hasOverlap = taskPaths.some(p => usedPaths.has(p));

    if (hasOverlap) {
      // Flush current batch, start new one
      if (currentBatch.length > 0) result.push(currentBatch);
      currentBatch = [task];
      usedPaths.clear();
      taskPaths.forEach(p => usedPaths.add(p));
    } else {
      currentBatch.push(task);
      taskPaths.forEach(p => usedPaths.add(p));
    }
  }

  if (currentBatch.length > 0) result.push(currentBatch);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && pnpm exec vitest run lib/integrate/task-dependency-graph.test.ts
```

- [ ] **Step 5: Commit**

```
feat(build): add task dependency graph for orchestrator dispatch

Pure function: plan fileStructure + tasks → ordered execution phases
with parallel groups. Classifies tasks by file path patterns, sequences
by specialist priority (schema → API → frontend → QA), splits file
overlaps into sequential phases.
```

---

## Task 5: Specialist Prompts

Role-specific system prompts composable with existing build context blocks.

**Files:**
- Create: `apps/web/lib/integrate/specialist-prompts.ts`

- [ ] **Step 1: Create specialist-prompts.ts**

Create `apps/web/lib/integrate/specialist-prompts.ts`:

```typescript
// apps/web/lib/integrate/specialist-prompts.ts
// Role-specific system prompts for Build Process Orchestrator specialists.
// Composable with getBuildContextSection() and getIT4ITContext().

import type { SpecialistRole } from "./task-dependency-graph";

const SHARED_IDENTITY = `You are a specialist sub-agent in the Digital Product Factory Build Studio.
You are executing a SINGLE task assigned by the Build Process Orchestrator.
You do NOT interact with the user. You report results back to the orchestrator.

RULES:
- Execute your assigned task completely and autonomously.
- Do NOT ask for permission or clarification — act on the task description.
- Do NOT narrate code. Use tools directly.
- If you get stuck after 3 attempts, report what failed and why in your final message.
- Keep your final response to 2-3 sentences summarizing what you did.`;

const DATA_ARCHITECT_PROMPT = `${SHARED_IDENTITY}

You are the Data Architect specialist. Your domain: Prisma schema design, migrations, model validation, index optimization.

WORKFLOW:
1. read_sandbox_file on packages/db/prisma/schema.prisma to see existing models
2. edit_sandbox_file to add/modify models. ALWAYS include:
   - Inverse relations on BOTH sides
   - @@index on every foreign key field (xxxId fields)
   - Enums DEFINED BEFORE models that reference them
3. validate_schema — MANDATORY before any migration
4. ONLY after validate_schema passes: run_sandbox_command with "pnpm --filter @dpf/db exec prisma migrate dev --name <name>"
5. run_sandbox_command with "pnpm --filter @dpf/db exec prisma generate"
6. run_sandbox_command with "pnpm exec tsc --noEmit" to verify types

NEVER run prisma migrate without calling validate_schema first.
Use describe_model to look up existing model fields — never guess.

String enum fields (status, type) MUST use canonical values from CLAUDE.md:
- Epic.status: "open", "in-progress", "done"
- BacklogItem.status: "open", "in-progress", "done", "deferred"
- BacklogItem.type: "portfolio", "product"
Hyphens, not underscores. Never invent synonyms.`;

const SOFTWARE_ENGINEER_PROMPT = `${SHARED_IDENTITY}

You are the Software Engineer specialist. Your domain: API routes, server actions, business logic, imports/exports wiring.

WORKFLOW:
1. list_sandbox_files to understand existing file structure
2. read_sandbox_file on similar existing files to match patterns (imports, exports, naming, error handling)
3. For new files: generate_code with clear instruction
4. For existing files: read_sandbox_file first, then edit_sandbox_file with exact old_text/new_text
5. Wire up imports/routes in existing files via edit_sandbox_file
6. run_sandbox_command with "pnpm exec tsc --noEmit" to verify types

WHEN edit_sandbox_file FAILS: read the file to see exact content, then use edit_sandbox_file with lines mode (start_line, end_line, new_content).
Match existing patterns exactly — import style, export conventions, error handling approach.`;

const FRONTEND_ENGINEER_PROMPT = `${SHARED_IDENTITY}

You are the Frontend Engineer specialist. Your domain: pages, components, CSS variables, semantic HTML, accessibility.

WORKFLOW:
1. list_sandbox_files to understand existing component structure
2. read_sandbox_file on similar existing components to match patterns
3. For new files: generate_code with clear instruction
4. For existing files: read_sandbox_file first, then edit_sandbox_file
5. run_sandbox_command with "pnpm exec tsc --noEmit" to verify types

THEME-AWARE STYLING — MANDATORY:
- NEVER use hardcoded colors (text-white, bg-white, text-black, inline hex)
- Text: var(--dpf-text), secondary: var(--dpf-muted)
- Backgrounds: var(--dpf-surface-1), var(--dpf-surface-2)
- Borders: var(--dpf-border)
- Interactive: var(--dpf-accent)
- Only exception: text-white on accent-background buttons

SEMANTIC HTML: Use <nav>, <main>, <section>, <article>, <header>, <footer>. <div> for layout only.
ACCESSIBILITY: All interactive elements need accessible names. Use ARIA only when semantic HTML is insufficient.
KEYBOARD: All interactive elements must be Tab-reachable and Enter/Space-activatable.
COLOR MEANING: Never use color as sole information carrier. Status badges need text labels or icons.`;

const QA_ENGINEER_PROMPT = `${SHARED_IDENTITY}

You are the QA Engineer specialist. Your domain: test execution, typecheck verification, output interpretation.

WORKFLOW:
1. run_sandbox_command with "pnpm exec tsc --noEmit" — typecheck first
2. run_sandbox_tests — full test suite
3. If tests fail: read the test output, identify WHICH test and the exact error
4. read_sandbox_file on the failing test to understand what it expects
5. Report results: pass count, fail count, typecheck status, specific failures

You do NOT fix code. You report what passed and what failed.
If something fails, describe the failure clearly so the orchestrator can dispatch a fix.

Your final message MUST include:
- Typecheck: pass/fail (with error count if failed)
- Tests: N passed, N failed
- If failures: the test name and a one-line description of each failure`;

const SPECIALIST_PROMPTS: Record<SpecialistRole, string> = {
  "data-architect": DATA_ARCHITECT_PROMPT,
  "software-engineer": SOFTWARE_ENGINEER_PROMPT,
  "frontend-engineer": FRONTEND_ENGINEER_PROMPT,
  "qa-engineer": QA_ENGINEER_PROMPT,
};

/** Agent IDs for each specialist role. */
export const SPECIALIST_AGENT_IDS: Record<SpecialistRole, string> = {
  "data-architect": "AGT-BUILD-DA",
  "software-engineer": "AGT-BUILD-SE",
  "frontend-engineer": "AGT-BUILD-FE",
  "qa-engineer": "AGT-BUILD-QA",
};

/** Model requirements per specialist role. */
export const SPECIALIST_MODEL_REQS: Record<SpecialistRole, { defaultMinimumTier: string; defaultBudgetClass: string }> = {
  "data-architect": { defaultMinimumTier: "frontier", defaultBudgetClass: "quality_first" },
  "software-engineer": { defaultMinimumTier: "frontier", defaultBudgetClass: "quality_first" },
  "frontend-engineer": { defaultMinimumTier: "frontier", defaultBudgetClass: "quality_first" },
  "qa-engineer": { defaultMinimumTier: "strong", defaultBudgetClass: "balanced" },
};

/** Tool names each specialist is allowed to use. Used to filter toolsForProvider. */
export const SPECIALIST_TOOLS: Record<SpecialistRole, string[]> = {
  "data-architect": [
    "read_sandbox_file", "edit_sandbox_file", "write_sandbox_file",
    "search_sandbox", "list_sandbox_files", "run_sandbox_command",
    "validate_schema", "describe_model",
  ],
  "software-engineer": [
    "read_sandbox_file", "edit_sandbox_file", "write_sandbox_file",
    "search_sandbox", "list_sandbox_files", "run_sandbox_command",
    "generate_code",
  ],
  "frontend-engineer": [
    "read_sandbox_file", "edit_sandbox_file", "write_sandbox_file",
    "search_sandbox", "list_sandbox_files", "run_sandbox_command",
    "generate_code",
  ],
  "qa-engineer": [
    "read_sandbox_file", "search_sandbox", "list_sandbox_files",
    "run_sandbox_command", "run_sandbox_tests",
  ],
};

/**
 * Build the full system prompt for a specialist.
 * Composes: role prompt + task description + build context + prior results.
 */
export function buildSpecialistPrompt(params: {
  role: SpecialistRole;
  taskDescription: string;
  buildContext: string;
  priorResults?: string;
}): string {
  const parts = [SPECIALIST_PROMPTS[params.role]];

  if (params.buildContext) {
    parts.push(params.buildContext);
  }

  parts.push(`\n--- Your Assigned Task ---\n${params.taskDescription}`);

  if (params.priorResults) {
    parts.push(`\n--- Results from Prior Specialists ---\n${params.priorResults}`);
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(build): add specialist system prompts for orchestrator sub-agents

Role-specific prompts for data-architect, software-engineer,
frontend-engineer, qa-engineer. Includes tool scoping, model tier
mapping, and composable prompt builder function.
```

---

## Task 6: Build Orchestrator (Core)

The main orchestrator function that parses plans, dispatches specialists, handles failures, and synthesizes results.

**Files:**
- Create: `apps/web/lib/integrate/build-orchestrator.ts`
- Test: `apps/web/lib/integrate/build-orchestrator.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/integrate/build-orchestrator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatPhaseMessage, formatBuildCompleteMessage } from "./build-orchestrator";

describe("orchestrator communication templates", () => {
  it("formats specialist completion message", () => {
    const msg = formatPhaseMessage("data-architect", "Created Complaint model with 8 fields, 2 indexes, migration applied.");
    expect(msg).toBe("Data Architect complete: Created Complaint model with 8 fields, 2 indexes, migration applied.");
  });

  it("formats build complete message", () => {
    const msg = formatBuildCompleteMessage({
      totalTasks: 4,
      completedTasks: 4,
      failedTasks: 0,
      specialistSummaries: [
        { role: "data-architect", outcome: "Complaint model with 8 fields" },
        { role: "software-engineer", outcome: "4 API routes" },
        { role: "frontend-engineer", outcome: "ComplaintList page" },
        { role: "qa-engineer", outcome: "12 tests pass, typecheck clean" },
      ],
    });
    expect(msg).toContain("Build complete");
    expect(msg).toContain("4/4 tasks done");
    expect(msg).toContain("Ready for review");
  });

  it("formats partial failure message", () => {
    const msg = formatBuildCompleteMessage({
      totalTasks: 4,
      completedTasks: 3,
      failedTasks: 1,
      specialistSummaries: [
        { role: "data-architect", outcome: "Complaint model with 8 fields" },
        { role: "software-engineer", outcome: "FAILED: Migration not found" },
        { role: "frontend-engineer", outcome: "ComplaintList page" },
        { role: "qa-engineer", outcome: "8 tests pass, 4 failed" },
      ],
    });
    expect(msg).toContain("3/4 tasks done");
    expect(msg).toContain("1 failed");
    expect(msg).not.toContain("Ready for review");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm exec vitest run lib/integrate/build-orchestrator.test.ts
```

- [ ] **Step 3: Implement build-orchestrator.ts**

Create `apps/web/lib/integrate/build-orchestrator.ts`:

```typescript
// apps/web/lib/integrate/build-orchestrator.ts
// Build Process Orchestrator: plan parsing, dependency-aware parallel dispatch,
// result synthesis, and process-defined communication.
// EP-BUILD-ORCHESTRATOR — "Do what Claude Code does"

import { prisma } from "@dpf/db";
import { runAgenticLoop, type AgenticResult } from "@/lib/agentic-loop";
import { agentEventBus, type AgentEvent } from "@/lib/agent-event-bus";
import { getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { getBuildContextSection, type BuildContext } from "@/lib/integrate/build-agent-prompts";
import { getIT4ITContext } from "@/lib/integrate/build-agent-prompts";
import {
  buildDependencyGraph,
  type ExecutionPhase,
  type AssignedTask,
  type PlanFileEntry,
  type PlanTask,
} from "./task-dependency-graph";
import {
  buildSpecialistPrompt,
  SPECIALIST_AGENT_IDS,
  SPECIALIST_MODEL_REQS,
  SPECIALIST_TOOLS,
} from "./specialist-prompts";
import type { SpecialistRole } from "./task-dependency-graph";
import type { BuildPlanDoc } from "@/lib/explore/feature-build-types";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_DURATION_ORCHESTRATOR_MS = 1_200_000; // 20 minutes
const MAX_SPECIALIST_RETRIES = 2;

// ─── Communication Templates ────────────────────────────────────────────────

const ROLE_LABELS: Record<SpecialistRole, string> = {
  "data-architect": "Data Architect",
  "software-engineer": "Software Engineer",
  "frontend-engineer": "Frontend Engineer",
  "qa-engineer": "QA",
};

export function formatPhaseMessage(role: SpecialistRole, outcome: string): string {
  return `${ROLE_LABELS[role]} complete: ${outcome}`;
}

export type BuildSummary = {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  specialistSummaries: Array<{ role: SpecialistRole; outcome: string }>;
};

export function formatBuildCompleteMessage(summary: BuildSummary): string {
  const status = `${summary.completedTasks}/${summary.totalTasks} tasks done`;
  const failNote = summary.failedTasks > 0 ? `, ${summary.failedTasks} failed` : "";
  const outcomes = summary.specialistSummaries.map(s => `- ${ROLE_LABELS[s.role]}: ${s.outcome}`).join("\n");

  if (summary.failedTasks > 0) {
    return `Build incomplete. ${status}${failNote}.\n${outcomes}\n\nSome tasks need attention before proceeding.`;
  }
  return `Build complete. ${status}.\n${outcomes}\n\nReady for review?`;
}

// ─── Specialist Dispatch ────────────────────────────────────────────────────

type SpecialistResult = {
  task: AssignedTask;
  result: AgenticResult;
  success: boolean;
  retries: number;
};

async function dispatchSpecialist(params: {
  task: AssignedTask;
  userId: string;
  platformRole: string | null;
  isSuperuser: boolean;
  buildId: string;
  buildContext: string;
  parentThreadId: string;
  priorResults?: string;
}): Promise<SpecialistResult> {
  const { task, userId, platformRole, isSuperuser, buildId, buildContext, parentThreadId, priorResults } = params;
  const role = task.specialist;
  const agentId = SPECIALIST_AGENT_IDS[role];
  const modelReqs = SPECIALIST_MODEL_REQS[role];
  const allowedToolNames = new Set(SPECIALIST_TOOLS[role]);

  // Create isolated thread — upsert guards against re-trigger on the same build
  const thread = await prisma.agentThread.upsert({
    where: { userId_contextKey: { userId, contextKey: `build:${buildId}:${role}:${task.taskIndex}` } },
    update: {},
    create: { userId, contextKey: `build:${buildId}:${role}:${task.taskIndex}` },
  });

  // Get tools scoped to this specialist's allowed set.
  // UserContext shape: { userId, platformRole, isSuperuser } — see lib/govern/permissions.ts
  const userContext = { userId, platformRole, isSuperuser };
  const allTools = await getAvailableTools(
    userContext,
    { mode: "act", agentId },
  );
  const scopedTools = allTools.filter(t => allowedToolNames.has(t.name));
  const toolsForProvider = toolsToOpenAIFormat(scopedTools);

  // Build the specialist's system prompt
  const systemPrompt = buildSpecialistPrompt({
    role,
    taskDescription: `Task: ${task.title}\n\nFiles to work on:\n${task.files.map(f => `- ${f.path} (${f.action}): ${f.purpose}`).join("\n") || "See task description for details."}`,
    buildContext,
    priorResults,
  });

  // Dispatch with retries
  let lastResult: AgenticResult | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_SPECIALIST_RETRIES; attempt++) {
    const taskPrompt = attempt === 0
      ? task.task.implement || task.title
      : `RETRY (attempt ${attempt + 1}): The previous attempt had issues:\n${lastResult?.content?.slice(0, 500) ?? "Unknown error"}\n\nTry a different approach. Original task: ${task.task.implement || task.title}`;

    // Emit dispatch event
    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:task_dispatched",
      buildId,
      taskTitle: task.title,
      specialist: ROLE_LABELS[role],
    });

    lastResult = await runAgenticLoop({
      chatHistory: [{ role: "user", content: taskPrompt }],
      systemPrompt,
      sensitivity: "internal",
      tools: scopedTools,
      toolsForProvider,
      userId,
      routeContext: "/build",
      agentId,
      threadId: thread.id,
      modelRequirements: modelReqs,
      onProgress: (event: AgentEvent) => agentEventBus.emit(parentThreadId, event),
    });

    // Check if specialist succeeded — heuristic: no frustration exit, tools were called
    const calledBuildTools = lastResult.executedTools.some(t =>
      t.name !== "read_sandbox_file" && t.name !== "search_sandbox" && t.name !== "list_sandbox_files"
    );
    const hasErrors = lastResult.executedTools.some(t => !t.result.success);
    const isQA = role === "qa-engineer"; // QA success = ran tests, regardless of test outcome

    if ((calledBuildTools && !hasErrors) || isQA) {
      return { task, result: lastResult, success: true, retries: attempt };
    }

    retries = attempt + 1;
    if (attempt < MAX_SPECIALIST_RETRIES) {
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:specialist_retry",
        buildId,
        specialist: ROLE_LABELS[role],
        reason: lastResult.content.slice(0, 200),
        attempt: attempt + 1,
      });
    }
  }

  return { task, result: lastResult!, success: false, retries };
}

// ─── Orchestrator Main ──────────────────────────────────────────────────────

export type OrchestratorResult = {
  content: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  specialistResults: SpecialistResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
};

/**
 * Run the Build Process Orchestrator.
 * Parses the approved plan, builds dependency graph, dispatches specialists
 * in parallel phases, synthesizes results.
 *
 * This is a DIRECT DISPATCH FUNCTION — not an agentic loop.
 * It calls runAgenticLoop for each specialist, not for itself.
 */
export async function runBuildOrchestrator(params: {
  buildId: string;
  plan: BuildPlanDoc;
  userId: string;
  platformRole: string | null;
  isSuperuser: boolean;
  parentThreadId: string;
  buildContext: string;
}): Promise<OrchestratorResult> {
  const { buildId, plan, userId, platformRole, isSuperuser, parentThreadId, buildContext } = params;
  const startTime = Date.now();

  // Build dependency graph from plan
  const phases = buildDependencyGraph(
    plan.fileStructure ?? [],
    plan.tasks ?? [],
  );

  const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);

  // Emit build started
  const specialists = [...new Set(phases.flatMap(p => p.tasks.map(t => ROLE_LABELS[t.specialist])))];
  agentEventBus.emit(parentThreadId, {
    type: "orchestrator:build_started",
    buildId,
    taskCount: totalTasks,
    specialists,
  });

  // Execute phases sequentially; tasks within a phase run in parallel
  const allResults: SpecialistResult[] = [];
  let priorResultsSummary = "";

  for (const phase of phases) {
    // Timeout check
    if (Date.now() - startTime > MAX_DURATION_ORCHESTRATOR_MS) {
      console.warn(`[orchestrator] hit MAX_DURATION (${MAX_DURATION_ORCHESTRATOR_MS}ms). Reporting partial results.`);
      break;
    }

    // Dispatch all tasks in this phase in parallel
    const phaseResults = await Promise.all(
      phase.tasks.map(task =>
        dispatchSpecialist({
          task,
          userId,
          platformRole,
          isSuperuser,
          buildId,
          buildContext,
          parentThreadId,
          priorResults: priorResultsSummary || undefined,
        })
      ),
    );

    // Collect results and build prior context for next phase
    for (const sr of phaseResults) {
      allResults.push(sr);

      const roleLabel = ROLE_LABELS[sr.task.specialist];
      const outcome = sr.success
        ? sr.result.content.slice(0, 300)
        : `FAILED after ${sr.retries} retries: ${sr.result.content.slice(0, 200)}`;

      // Emit completion event
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:task_complete",
        buildId,
        taskTitle: sr.task.title,
        specialist: roleLabel,
        outcome,
      });

      // Accumulate context for downstream specialists
      priorResultsSummary += `\n${roleLabel} (${sr.task.title}): ${outcome}`;
    }

    // Emit phase summary
    const completed = allResults.filter(r => r.success).length;
    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:phase_summary",
      buildId,
      completed,
      total: totalTasks,
      summary: `Phase ${phase.phaseIndex + 1} complete.`,
    });
  }

  // Synthesize final result
  const completedTasks = allResults.filter(r => r.success).length;
  const failedTasks = allResults.filter(r => !r.success).length;
  const totalInputTokens = allResults.reduce((sum, r) => sum + r.result.totalInputTokens, 0);
  const totalOutputTokens = allResults.reduce((sum, r) => sum + r.result.totalOutputTokens, 0);

  const summary: BuildSummary = {
    totalTasks,
    completedTasks,
    failedTasks,
    specialistSummaries: allResults.map(r => ({
      role: r.task.specialist,
      outcome: r.success ? r.result.content.slice(0, 200) : `FAILED: ${r.result.content.slice(0, 150)}`,
    })),
  };

  return {
    content: formatBuildCompleteMessage(summary),
    totalTasks,
    completedTasks,
    failedTasks,
    specialistResults: allResults,
    totalInputTokens,
    totalOutputTokens,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && pnpm exec vitest run lib/integrate/build-orchestrator.test.ts
```

- [ ] **Step 5: Run full typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

Fix any type errors. `UserContext` shape is `{ userId, platformRole, isSuperuser }` (from `lib/govern/permissions.ts`) — the orchestrator already uses this shape correctly.

- [ ] **Step 6: Commit**

```
feat(build): add Build Process Orchestrator — parallel specialist dispatch

Core orchestrator: parses approved plan, builds dependency graph,
dispatches specialists in parallel via runAgenticLoop, handles retries,
synthesizes results with process-defined communication templates.
Reuses existing agentic loop — all safety mechanisms work per-specialist.
```

---

## Task 7: Integration — Wire Orchestrator into agent-coworker.ts

Route build-phase invocations through the orchestrator instead of the direct single-agent loop.

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts` (~line 674-692)

- [ ] **Step 1: Read current integration point**

Read `apps/web/lib/actions/agent-coworker.ts` lines 660-720 to understand the current agentic loop invocation and what surrounds it.

- [ ] **Step 2: Add orchestrator routing**

The key change: when the route is `/build` AND the active build phase is `"build"` AND the plan has a `buildPlan`, invoke `runBuildOrchestrator()` instead of `runAgenticLoop()`.

Before the existing `runAgenticLoop` call (~line 674), add:

```typescript
    // EP-BUILD-ORCHESTRATOR: Route build-phase to orchestrator for parallel specialist dispatch
    if (input.routeContext.startsWith("/build") && activeBuildPhase === "build") {
      const activeBuild = await prisma.featureBuild.findFirst({
        where: { createdById: user.id!, phase: "build" },
        orderBy: { updatedAt: "desc" },
        select: { buildId: true, plan: true },
      });

      const plan = activeBuild?.plan as Record<string, unknown> | null;
      const buildPlan = plan?.buildPlan as import("@/lib/explore/feature-build-types").BuildPlanDoc | undefined;

      if (activeBuild && buildPlan?.tasks?.length) {
        const { runBuildOrchestrator } = await import("@/lib/integrate/build-orchestrator");
        const { agentEventBus } = await import("@/lib/agent-event-bus");

        const orchestratorResult = await runBuildOrchestrator({
          buildId: activeBuild.buildId,
          plan: buildPlan,
          userId: user.id!,
          platformRole: user.platformRole ?? null,
          isSuperuser: user.isSuperuser ?? false,
          parentThreadId: input.threadId,
          buildContext: populatedPrompt,
        });

        agentEventBus.emit(input.threadId, { type: "done" });

        const agentMsg = await prisma.agentMessage.create({
          data: {
            threadId: input.threadId,
            role: "assistant",
            content: orchestratorResult.content,
            agentId: agent.agentId,
            routeContext: input.routeContext,
            providerId: "orchestrator",
            taskType: taskTypeId !== "unknown" ? taskTypeId : null,
            routedEndpointId: null,
          },
          select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
        });

        return {
          message: agentMsg,
          inputTokens: orchestratorResult.totalInputTokens,
          outputTokens: orchestratorResult.totalOutputTokens,
          providerId: "orchestrator",
          modelId: "multi-specialist",
          downgraded: false,
          downgradeMessage: null,
        };
      }
    }
```

This goes BEFORE the existing `const { runAgenticLoop } = await import(...)` block. If the orchestrator condition doesn't match (not in build phase, or no plan), it falls through to the existing single-agent loop.

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```
feat(build): wire Build Process Orchestrator into agent-coworker

Routes build-phase invocations through runBuildOrchestrator() when
an approved buildPlan with tasks exists. Falls through to single-agent
loop for ideate/plan/review/ship phases and builds without plans.
```

---

## Task 8: Manual Integration Test

Verify the orchestrator works end-to-end in the Build Studio.

**Files:** None (testing only)

- [ ] **Step 1: Verify AI provider routing works**

Check that the configured AI provider can handle tool calls before running the build. Open AI Workforce > Providers in the UI and confirm at least one frontier-tier provider is active.

- [ ] **Step 2: Create a test feature build**

In Build Studio, create a new feature: "Add a simple Feedback model with title, message, status fields and a list page."

- [ ] **Step 3: Complete ideate and plan phases**

Let the AI coworker work through ideate (design doc) and plan (build plan with fileStructure and tasks). Verify the plan has structured tasks before approving for build.

- [ ] **Step 4: Trigger build phase**

Approve the plan and say "Build it." Watch for:
- "Starting build: N tasks across N specialists" message
- SSE events showing specialist dispatch/completion
- Phase-summary messages (not tool-by-tool narration)
- QA phase running after code generation
- Final "Build complete. Ready for review?" message

- [ ] **Step 5: Verify audit trail**

Check ToolExecution table for specialist threadIds (`build:{buildId}:data-architect:*`, etc.) to confirm all specialist tool calls were audited.

- [ ] **Step 6: Document results**

Note any issues found during manual testing for follow-up.

---

## Dependency Order

```text
Task 1 (grant map)  ─┐
Task 2 (registry)    ─┤
Task 3 (events)      ─┼─→ Task 6 (orchestrator core) ─→ Task 7 (integration) ─→ Task 8 (manual test)
Task 4 (dep graph)   ─┤
Task 5 (prompts)     ─┘
```

Tasks 1-5 are independent and can be executed in parallel. Task 6 depends on Tasks 4 and 5. Task 7 depends on Task 6. Task 8 depends on Task 7.
