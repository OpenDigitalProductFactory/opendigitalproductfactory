# Build Process Orchestrator — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | EP-BUILD-ORCHESTRATOR |
| **IT4IT Alignment** | Integrate Value Stream (SS5.3), stages 5.3.1-5.3.5 |
| **Status** | Implemented |
| **Created** | 2026-04-02 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |
| **Dependencies** | EP-TAK-PATTERNS (agentic architecture patterns), EP-AI-WORKFORCE-001 (agent registry) |
| **Design Motto** | "Do what Claude Code does" — mirror proven orchestration patterns |

---

## 1. Problem Statement

The Build Studio currently runs a single agent (build-specialist) in one chat thread that handles everything: schema design, API routes, UI components, tests. This causes three problems:

1. **Permission-seeking**: The agent asks for approval at every step instead of acting autonomously. The permission-seeking nudge system catches this, but the root cause is a single agent trying to do too much with too little clarity about what it's allowed to do.

2. **Context window pollution**: A complex multi-file feature fills the context window with schema migration output, API route code, component markup, and test results — all in one conversation. By the time the agent reaches frontend work, the schema decisions are compressed or lost.

3. **No parallelism**: Schema changes and frontend scaffolding are independent work, but the single agent executes them sequentially. A feature that could be built in 3 minutes takes 10.

### What Currently Exists

- `agentic-loop.ts` — single-agent loop with fabrication/frustration detection, duration limits, dynamic tool enrichment, repetition detection
- `build-agent-prompts.ts` — phase-specific prompts (ideate/plan/build/review/ship) with IT4IT alignment
- `AgentThread` model — per-user threads keyed by `contextKey`
- `ToolExecution` audit table — tracks every tool call with parameters, result, duration
- `PhaseHandoff` model — structured context passing between phases (summary, decisions, open issues)
- `agent-grants.ts` — TOOL_TO_GRANTS mapping controls which tools each agent can use
- `agent-event-bus.ts` — SSE events keyed by threadId, already supports `async:started/progress/complete`
- `agent_registry.json` — AGT-ORCH-300 (integrate-orchestrator) defined with delegates_to
- `build-pipeline.ts` — checkpoint-based step execution with retry budgets

---

## 2. Architecture

### 2.1 Two-Tier Hierarchy

Following Claude Code's Fork model for sub-agent parallelism:

```text
User (AI Coworker chat)
  |  (phase-summary messages, process-defined templates)
  v
Build Process Orchestrator (strong tier)
  |  (task dispatch + structured AgenticResult returns)
  v
Specialist Sub-Agents (frontier tier, separate AgentThreads)
  +-- Data Architect — schema, migrations, model validation
  +-- Software Engineer — API routes, server actions, business logic
  +-- Frontend Engineer — pages, components, styling
  +-- QA Engineer — tests, typecheck, verification
```

The orchestrator is NOT a new top-level COO. The existing COO remains. The Build Process Orchestrator owns the build phase lifecycle and delegates specialist work to sub-agents running in isolated threads.

### 2.2 Why Two Tiers (Not Three)

The patterns spec (Section 8) recommends against a general-purpose orchestrator. Two tiers keeps the orchestrator's scope narrow: parse plan, build dependency graph, dispatch tasks, synthesize results. If this proves insufficient for a specific phase (e.g., the build phase needs its own coding orchestrator), a third tier can be introduced by promoting the build-phase dispatch loop to its own orchestrator — but not in v1.

### 2.3 Relationship to Phase Lifecycle

The existing 5-phase lifecycle (ideate > plan > build > review > ship) is unchanged. The Build Process Orchestrator activates during the **build phase** where task decomposition and parallelism matter. In other phases:

- **Ideate/Plan**: Orchestrator runs as a single agent inside `runAgenticLoop` directly (no sub-agents needed — single-agent research and planning)
- **Build**: Orchestrator activates as a direct dispatch function (`runBuildOrchestrator()`), decomposes plan into specialist tasks, dispatches in parallel
- **Review**: Orchestrator dispatches QA specialist for build verification (unit tests + typecheck). This is a separate invocation from the build-phase QA pass — the review-phase QA uses the release gate prompt (acceptance criteria, UX tests, deployment readiness) rather than the build verification prompt.
- **Ship**: Orchestrator follows the existing ship sequence (sequential tool calls, no sub-agents)

Phase transitions still require user approval. Sub-agent dispatch within a phase does not.

---

## 3. Execution Model

### 3.1 Plan Parsing and Dependency Graph

The plan phase produces structured output:

```typescript
{
  fileStructure: [
    { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "Add Complaint model" },
    { path: "apps/web/app/api/complaints/route.ts", action: "create", purpose: "CRUD API" },
    { path: "apps/web/components/complaints/ComplaintList.tsx", action: "create", purpose: "List UI" },
  ],
  tasks: [
    { title: "Add Complaint schema", testFirst: "...", implement: "...", verify: "..." },
    { title: "Create complaints API", testFirst: "...", implement: "...", verify: "..." },
    { title: "Build complaints UI", testFirst: "...", implement: "...", verify: "..." },
  ]
}
```

The orchestrator infers dependencies from file paths and task ordering:

1. **Schema tasks** (files in `packages/db/prisma/`) must complete first — everything depends on models
2. **API tasks** (files in `app/api/` or server actions) depend on schema but not on frontend
3. **Frontend tasks** (files in `components/` or `app/(shell)/`) depend on API types but can scaffold in parallel with API
4. **QA tasks** (tests, typecheck) run after all code generation tasks complete

Independent tasks at the same dependency level run in parallel via `Promise.all()`.

### 3.2 Specialist Dispatch

Each specialist runs in its own `AgentThread` using the existing `runAgenticLoop()`:

```typescript
// Pseudocode — not final implementation
const thread = await prisma.agentThread.create({
  data: {
    userId,
    contextKey: `build:${buildId}:data-architect`,
  },
});

const result = await runAgenticLoop({
  chatHistory: [{ role: "user", content: taskPrompt }],
  systemPrompt: specialistSystemPrompt,
  sensitivity: "internal",  // Inherited from /build route context
  tools: scopedToolSet,
  toolsForProvider: scopedToolsForProvider,
  userId,
  routeContext: "/build",
  agentId: "AGT-BUILD-DA",  // Data Architect
  threadId: thread.id,
  modelRequirements: { defaultMinimumTier: "frontier", defaultBudgetClass: "quality_first" },
  onProgress: (event) => agentEventBus.emit(parentThreadId, event),
});
```

Key points:

- **The orchestrator is NOT an agentic loop.** It is a direct dispatch function (`runBuildOrchestrator()`) that parses the plan, builds the dependency graph, and calls `runAgenticLoop()` for each specialist as a direct function call. The orchestrator does not run inside `runAgenticLoop` during the build phase — it IS the build phase's execution engine. During ideate/plan phases, the orchestrator runs as a single agent inside `runAgenticLoop` directly (no sub-agents).
- **Same loop, different context**: `runAgenticLoop` is reused unchanged for each specialist. All safety mechanisms (fabrication detection, frustration detection, repetition detection, duration limits, dynamic tool enrichment) work per-specialist.
- **Scoped tools**: Each specialist only sees tools relevant to their role (Section 5).
- **Sensitivity inherited**: All specialists inherit `sensitivity: "internal"` from the `/build` route context. This ensures side-effecting tools are correctly stripped in advise mode.
- **Event forwarding**: Specialist progress events are forwarded to the parent thread's event bus for SSE rendering in the UI.
- **Clean context**: Each specialist gets a fresh chat history with only their task description. No pollution from other specialists' work.

### 3.3 Parallel Dispatch with Dependency Sequencing

```text
Phase 1 (parallel):  Data Architect  |  Frontend Engineer (scaffold only)
                           |
Phase 2 (parallel):  Software Engineer  |  Frontend Engineer (wiring)
                           |
Phase 3 (sequential): QA Engineer (full test suite + typecheck)
```

The orchestrator runs each phase as a `Promise.all()` of independent specialist invocations, then advances to the next phase when all specialists in the current phase complete.

**Parallel safety**: Specialists dispatched in the same phase MUST have non-overlapping file targets. The orchestrator validates this when building the dependency graph from the plan's `fileStructure[]`. If two tasks touch the same file, they are sequenced, not parallelized.

**Orchestrator timeout**: The full dispatch cycle has a ceiling of `MAX_DURATION_ORCHESTRATOR_MS = 1_200_000` (20 minutes). This allows for 2 sequential phases at the specialist build limit (10 min each), since schema + API typically finish well under their ceilings. If the orchestrator hits this limit, it reports partial results to the user.

### 3.4 Failure Handling

When a specialist fails (returns with errors or hits the frustration/repetition limit):

1. **Orchestrator reads the `AgenticResult`** — executed tools, final content, error state
2. **Decides whether to retry with enriched context** — adds the failure details to the specialist's next task prompt (immediate feedback loop)
3. **Maximum 2 retries per specialist** — after that, orchestrator reports failure to user with specific details
4. **Failures don't block independent work** — if data architect fails on schema, frontend scaffolding can still proceed; only API wiring (which depends on schema) is blocked

---

## 4. Communication Model

### 4.1 Process-Defined Templates (Skills Inventory)

The orchestrator does not compose prose. It fills process-defined templates. These templates are skills in the skills inventory, refinable without code changes.

| Event | Template |
|-------|----------|
| **Build started** | "Starting build: {task_count} tasks across {specialist_count} specialists." |
| **Task dispatched** | (SSE event only — not a chat message) |
| **Specialist complete** | "{role} complete: {structured_outcome}" |
| **Phase summary** | "{completed_count}/{total_count} tasks done. {summary_of_outcomes}" |
| **Failure/escalation** | "{role} blocked on {issue}. Retrying with additional context..." or "{role} failed after {retry_count} attempts: {specific_error}. Need your input." |
| **Feedback captured** | (Logged to backlog, not communicated unless user has Dev mode enabled) |
| **Build complete** | "Build complete. {file_count} files created/modified, {test_count} tests pass, typecheck clean. Ready for review?" |

### 4.2 Phase-Summary Style

The user sees one consolidated message per specialist completion, not per tool call. Example conversation:

```
User: "Build it"
Orchestrator: "Starting build: 4 tasks across 3 specialists."
Orchestrator: "Data Architect complete: Complaint model with 8 fields, 2 indexes, migration applied."
Orchestrator: "Software Engineer complete: 4 API routes (CRUD), 2 server actions."
Orchestrator: "Frontend Engineer complete: ComplaintList page with filter controls, status badges."
Orchestrator: "QA complete: 12 tests pass, typecheck clean. Build complete — ready for review?"
```

### 4.3 SSE Events for Real-Time Progress

New event types added to `agent-event-bus.ts`:

```typescript
| { type: "orchestrator:build_started"; buildId: string; taskCount: number; specialists: string[] }
| { type: "orchestrator:task_dispatched"; buildId: string; taskTitle: string; specialist: string }
| { type: "orchestrator:task_complete"; buildId: string; taskTitle: string; specialist: string; outcome: string }
| { type: "orchestrator:phase_summary"; buildId: string; completed: number; total: number; summary: string }
| { type: "orchestrator:specialist_retry"; buildId: string; specialist: string; reason: string; attempt: number }
```

The UI renders these as a progress indicator (specialist name + status) alongside the chat messages.

---

## 5. Tool Scoping Per Specialist

### 5.1 Tool Sets

All specialists share sandbox access but have role-appropriate scoping via system prompts:

| Specialist | Tools | Prompt Focus |
|-----------|-------|-------------|
| **Data Architect** | `read_sandbox_file`, `edit_sandbox_file`, `write_sandbox_file`, `search_sandbox`, `list_sandbox_files`, `run_sandbox_command`, `validate_schema`, `describe_model` | Schema design, Prisma models, migrations, index design, relation validation. DAMA-DMBOK aligned. |
| **Software Engineer** | `read_sandbox_file`, `edit_sandbox_file`, `write_sandbox_file`, `search_sandbox`, `list_sandbox_files`, `run_sandbox_command`, `generate_code` | API routes, server actions, business logic, imports/exports wiring. |
| **Frontend Engineer** | `read_sandbox_file`, `edit_sandbox_file`, `write_sandbox_file`, `search_sandbox`, `list_sandbox_files`, `run_sandbox_command`, `generate_code` | Pages, components, CSS variables, semantic HTML, a11y, keyboard navigation. |
| **QA Engineer** | `read_sandbox_file`, `search_sandbox`, `list_sandbox_files`, `run_sandbox_command`, `run_sandbox_tests` | Test execution, typecheck, output interpretation. Read-only sandbox access (no write/edit/generate). |

### 5.2 Tool Differentiation via Prompts

The tool overlap is intentional — all specialists need to read and navigate the sandbox. The real differentiation comes from the system prompt:

- **Data Architect** gets schema-specific workflow instructions (validate_schema before migrate, inverse relations, @@index on FKs)
- **Software Engineer** gets wiring instructions (read existing patterns, match import conventions)
- **Frontend Engineer** gets the full CSS variable cheatsheet, semantic HTML rules, WCAG AA requirements
- **QA Engineer** gets structured failure recovery instructions (read test output, identify root cause, report — not fix)

### 5.3 Specialist Prompt Composition

Each specialist's system prompt is composed from reusable blocks:

```text
Specialist Prompt = Identity Block (shared)
                  + Role-Specific Instructions (per specialist)
                  + Task Description (from orchestrator)
                  + Build Context (from getBuildContextSection())
                  + Prior Specialist Results (cross-task context from orchestrator)
                  + IT4IT Context (from getIT4ITContext())
```

Example for Data Architect:

- **Identity Block**: Platform rules, date, contribution mode
- **Role-Specific**: Schema workflow (validate_schema before migrate, inverse relations, @@index on FKs, DAMA-DMBOK alignment)
- **Task Description**: "Add a Complaint model with fields: title (String), description (String), status (String, enum: open/in-progress/done), priority (Int), createdBy relation to User"
- **Build Context**: Running spec, phase handoffs from ideate/plan
- **Prior Results**: (empty for first specialist; populated for dependent specialists)
- **IT4IT**: Integrate Value Stream SS5.3

### 5.4 Grant Categories

Specialist agents registered in `agent_registry.json` with grant category `sandbox_execute`. The orchestrator agent has `build_plan_write` + `backlog_write` (for feedback loop backlog items) but NOT `sandbox_execute` — it never touches the sandbox directly.

### 5.5 Implementation Prerequisite: Grant Map Completeness

The TAK "delegation with narrowing" guarantee (Section 10) requires that ALL tools used by specialists and the orchestrator have explicit entries in the `TOOL_TO_GRANTS` map in `agent-grants.ts`. Tools not in the map are currently allowed by default — this must be tightened before specialist agents are registered, or the narrowing is not enforced.

Tools that need `TOOL_TO_GRANTS` entries added:

| Tool | Grant Category |
| ---- | -------------- |
| `write_sandbox_file` | `sandbox_execute` |
| `validate_schema` | `sandbox_execute` |
| `describe_model` | `sandbox_execute` |
| `execute_promotion` | `iac_execute` |

Additionally, AGT-ORCH-300's `tool_grants` in `agent_registry.json` must be updated to include `backlog_write` (needed for the deferred feedback loop in Section 6.2).

---

## 6. Feedback Loop (Orchestrator as Learning Coordinator)

### 6.1 Immediate Feedback (Within a Build)

When a specialist struggles (multiple retries, tool failures, fabrication detected):

1. Orchestrator captures the failure pattern from `AgenticResult.executedTools`
2. On retry, orchestrator enriches the specialist's task prompt with specific hints:
   - "The schema has a `status` field that uses string enums — see CLAUDE.md for valid values"
   - "The CSS variable for borders is `var(--dpf-border)`, not `border-gray-200`"
3. On dispatch of dependent specialists, orchestrator includes relevant context from prior specialists:
   - "The Data Architect created a `Complaint` model with fields: id, title, description, status, priority, createdAt, updatedAt, createdById. The status enum uses: open, in-progress, done."

This is the same pattern as `enrichToolDescriptions()` in `agentic-loop.ts` (Section 5 of patterns spec), but applied at the orchestrator level to specialist prompts rather than tool descriptions.

### 6.2 Deferred Feedback (Across Builds)

When the orchestrator observes persistent patterns:

1. **Tool deficiency**: "Data Architect needed to list existing indexes but has no tool for it" → creates a backlog item via `create_backlog_item` tool
2. **Prompt gap**: "Frontend Engineer consistently fails on CSS variables until reminded" → the skill/prompt for the Frontend Engineer specialist should include the CSS variable reference by default
3. **Model capability**: "QA Engineer produces better results at strong tier than expected" → note for future tier optimization

Deferred feedback is logged but not communicated to the user unless Dev mode is enabled. The orchestrator calls `create_backlog_item` with type `"product"` for tool/prompt improvements.

### 6.3 Goal

Specialists get the job done with **fewer resources and iterations** over time. The orchestrator's token spend on coordination is offset by reduced specialist token spend from better-scoped tasks and pre-loaded context. This is the economic justification for the `strong` tier orchestrator — it's a process optimization investment.

---

## 7. Model Tiering

| Role | Agent ID | Tier | Budget | Rationale |
|------|----------|------|--------|-----------|
| Build Process Orchestrator | AGT-ORCH-300 | `strong` | `balanced` | Process coordination, template-filling, dependency analysis. Token savings from process optimization outweigh coordination cost. |
| Data Architect | AGT-BUILD-DA | `frontier` | `quality_first` | Schema reasoning requires understanding relations, constraints, normalization, DAMA-DMBOK patterns. |
| Software Engineer | AGT-BUILD-SE | `frontier` | `quality_first` | Multi-file code generation, import wiring, pattern matching across codebase. |
| Frontend Engineer | AGT-BUILD-FE | `frontier` | `quality_first` | Component generation, CSS variable compliance, accessibility, responsive design. |
| QA Engineer | AGT-BUILD-QA | `strong` | `balanced` | Tool execution and output interpretation — does not generate complex code. |

Admin-configurable overrides via `AgentModelConfig` table take precedence (per existing pattern). The tier and budget values above are code defaults. New specialist agent IDs (AGT-BUILD-DA, etc.) will not have `AgentModelConfig` DB rows on initial deployment, so code defaults apply. If an admin later configures a weaker model for a specialist, that override wins — this is intentional.

---

## 8. Agent Registry Entries

New agents registered under AGT-ORCH-300's `delegates_to`:

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
  "status": "defined",
  "config_profile": {
    "model_binding": { "model_id": null, "temperature": 0.2 },
    "tool_grants": ["sandbox_execute"]
  }
}
```

Similar entries for AGT-BUILD-SE, AGT-BUILD-FE, AGT-BUILD-QA. All escalate to AGT-ORCH-300. None delegate further. HITL tier 0 (fully autonomous — no user interaction).

AGT-ORCH-300's `delegates_to` updated to include the four specialist agent IDs **in addition to** the existing delegates (AGT-130, AGT-131, AGT-132). The existing delegates are governance agents for review/ship phases and must be retained.

---

## 9. Implementation Changes

### 9.1 Files Modified

| File | Change |
| ---- | ------ |
| `apps/web/lib/actions/agent-coworker.ts` | **Critical integration point.** Route build-phase invocations to `build-orchestrator.ts` instead of direct `runAgenticLoop()`. Ideate/plan/review/ship phases continue to use single-agent loop via the orchestrator running `runAgenticLoop` directly. |
| `apps/web/lib/integrate/build-agent-prompts.ts` | Extract specialist-specific portions of the build prompt into composable blocks |
| `apps/web/lib/tak/agent-event-bus.ts` | Add orchestrator event types (Section 4.3) |
| `apps/web/lib/tak/agent-grants.ts` | Add `TOOL_TO_GRANTS` entries for `write_sandbox_file`, `validate_schema`, `describe_model`, `execute_promotion` (Section 5.5). Add specialist agent grant entries. |
| `packages/db/data/agent_registry.json` | Register 4 specialist agents, update AGT-ORCH-300 `delegates_to` (additive) and `tool_grants` (add `backlog_write`) |

### 9.2 Files Created

| File | Purpose |
|------|---------|
| `apps/web/lib/integrate/build-orchestrator.ts` | Core orchestrator: plan parsing, dependency graph, parallel dispatch, result synthesis, feedback capture, communication templates |
| `apps/web/lib/integrate/specialist-prompts.ts` | Role-specific system prompts for each specialist, composable with existing build context |
| `apps/web/lib/integrate/task-dependency-graph.ts` | Pure function: takes plan's fileStructure/tasks, returns ordered execution phases with parallel groups |

### 9.3 Files Not Changed

| File | Reason |
| ---- | ------ |
| `apps/web/lib/tak/agentic-loop.ts` | Reused unchanged — all safety mechanisms work per-specialist |
| `packages/db/prisma/schema.prisma` | No schema changes — uses existing AgentThread contextKey pattern |
| `apps/web/lib/mcp-tools.ts` | No new tools — orchestrator uses existing tools, specialists use existing sandbox tools |
| `apps/web/lib/tak/route-context-map.ts` | No changes — specialists run on the `/build` route context |

---

## 10. TAK Compliance

Per the Trusted AI Kernel's five mechanisms:

| TAK Mechanism | How This Design Complies |
|---------------|-------------------------|
| **Layered Authority** | Orchestrator delegates to specialists with narrower scope. Specialists cannot escalate to user — only to orchestrator. |
| **Immutable Directives** | Phase prompts and tool grants are defined in code/registry, not generated by the orchestrator at runtime. |
| **Proposal Gates** | Phase transitions require user approval. Sub-agent dispatch within a phase does not. Destructive operations (deploy, migrate in production) remain proposal-mode tools. |
| **Audit Trail** | Every specialist tool call recorded in ToolExecution table via existing fire-and-forget pattern. Specialist threadIds link to parent build via contextKey. |
| **Delegation with Narrowing** | Orchestrator has `build_plan_write` + `backlog_write`. Specialists have `sandbox_execute` only. No specialist can write backlog items or modify the plan. Authority narrows at each tier. **Prerequisite**: Section 5.5 grant map entries must be implemented first, or narrowing is not enforced (unmapped tools are currently allowed by default). |

---

## 11. Agentic Patterns Checklist (Section 10)

- [x] **Model routing**: Orchestrator = `strong`, specialists = `frontier`/`strong` with explicit tier and budget
- [x] **Duration limit**: Specialists run within existing `MAX_DURATION_BUILD_MS` (10 min). Orchestrator has `MAX_DURATION_ORCHESTRATOR_MS` = 20 min for the full dispatch cycle (Section 3.3).
- [x] **Handoff**: Two types: (a) **cross-phase** handoff uses existing `PhaseHandoff` model (ideate→plan→build, unchanged), (b) **orchestrator-to-specialist** handoff is new — structured task prompts with prior specialist results, returning structured `AgenticResult` objects.
- [x] **Tool definitions**: All specialist tools already have `requiredCapability`, `executionMode`, `sideEffect`, `buildPhases`.
- [x] **Fabrication detection**: Runs per-specialist in `runAgenticLoop` — unchanged.
- [x] **Phase nudge**: Runs per-specialist — unchanged.
- [x] **Prompt composition**: Specialists use the `/build` route context. Specialist prompts compose with existing build context blocks.
- [x] **Contribution mode**: Injected by existing `getBuildContextSection()` — specialists inherit it.
- [x] **Safety**: Destructive operations remain proposal-mode. Specialists cannot bypass.
- [x] **Audit**: Every tool execution recorded via existing pattern.

---

## 12. Out of Scope (v1)

- **Three-tier orchestration**: Phase-specific sub-orchestrators (e.g., Coding Orchestrator) deferred to v2 if the Build Process Orchestrator proves insufficient.
- **Cross-build learning**: Persistent skill refinement based on observed specialist failures across builds. v1 captures feedback as backlog items; automated skill refinement is future work.
- **Specialist-to-specialist communication**: Specialists do not talk to each other. All coordination flows through the orchestrator.
- **Dynamic specialist spawning**: v1 has 4 fixed specialist roles. Dynamic role creation based on task analysis is future work.
- **Sandbox isolation per specialist**: All specialists share the same sandbox. File-level conflict detection (two specialists editing the same file) is handled by dependency sequencing, not sandbox isolation.

---

## Sources

- Claude Code source leak analysis: `docs/superpowers/specs/2026-04-02-agentic-architecture-patterns-design.md` (Sections 1, 2, 3, 5, 8)
- TAK architecture: `docs/architecture/trusted-ai-kernel.md`
- IT4IT v3.0.1 Integrate Value Stream (SS5.3)
- DAMA-DMBOK (Data Architect alignment)
- US Patent 8,635,592 (Progressive Disclosure — communication model)
