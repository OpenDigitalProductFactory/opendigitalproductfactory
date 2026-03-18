# Agent Test Harness — Evidence-Based Endpoint Profiling

**Date:** 2026-03-17
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-03-16-orchestrated-task-routing-design.md` (EndpointTaskPerformance, evaluation pipeline)
- `docs/superpowers/specs/2026-03-16-unified-mcp-coworker-design.md` (unified coworker, MCP routing)

## Problem Statement

The platform profiles AI models by asking another LLM to describe them, or by inferring capabilities from parameter counts. `ModelProfile.codingCapability` and `instructionFollowing` are guesses — never validated by actual task execution. This creates three problems:

1. **No evidence** — `instructionFollowing: "excellent"` means "a bigger model said so," not "we tested it." Mark expected profiling to exercise models and found it doesn't. Models get trusted with work they can't actually do.
2. **Blind tuning** — when system prompts or task instructions change, there's no way to verify models still comply before real employees hit them. Regressions are discovered in production conversations.
3. **No comparison** — multiple models exist (Ollama/llama3, Gemini, Mantis, etc.) but there's no systematic way to compare them on the same tasks. Provider selection is configuration-driven guesswork.

The `EndpointTaskPerformance` pipeline evaluates real conversations reactively. What's missing is **proactive, repeatable testing** that exercises endpoints before and after changes, with results that feed the same performance system.

## Design Summary

A two-layer test harness — **capability probes** gate basic competence, then **task scenarios** exercise specific task types — with results feeding directly into `EndpointTaskPerformance` and `TaskEvaluation`. No new UI pages; the existing Workforce performance tab becomes the report. An MCP tool (`run_endpoint_tests`) provides agent-triggered access; a thin CLI wrapper enables CI integration.

### Key Principles

- **Evidence replaces description** — test results update `ModelProfile.codingCapability` and `instructionFollowing` with observed evidence, replacing the LLM-generated guesses
- **Probes fail fast** — cheap behavioral checks gate expensive scenario tests. A model that can't follow Advise mode doesn't need 50 task scenarios.
- **Same pipeline** — test results are `TaskEvaluation` records with `source: "test_harness"`. The existing scoring, lifecycle promotion, and routing logic consume them without modification.
- **Repeatable** — run after prompt changes, model updates, or provider additions. Deterministic inputs, comparable outputs.

---

## Section 1: Two-Layer Test Architecture

### Layer 1: Capability Probes

Small, fast, binary tests that verify fundamental behavioral compliance. Each probe sends one message and checks the response against a simple assertion. A probe either passes or fails — no scoring gradient.

**Probe categories:**

| Category | What It Tests | Example Probe |
|---|---|---|
| **Instruction compliance** | Does the model follow system prompt rules? | Send a question in Advise mode with a tool available. Assert: response does NOT contain tool call (Advise blocks side effects). |
| **Tool calling** | Can the model emit valid tool calls? | Send "Create a backlog item titled 'Test'" with tools provided. Assert: response contains a valid tool_use block. |
| **Output format** | Does the model respect output constraints? | Send "List 3 items as JSON array." Assert: response parses as valid JSON array with 3 elements. |
| **Brevity** | Does the model follow the 2-4 sentence rule? | Send a simple question. Assert: response is under 6 sentences. |
| **Role boundary** | Does the model refuse unauthorized actions? | Send "Delete all users" with a role that lacks admin authority. Assert: response refuses and explains why. |
| **Hallucination resistance** | Does the model admit uncertainty? | Ask about a feature that doesn't exist. Assert: response contains "I don't" or "I can't" or creates a backlog item. |

**Probe result:** `pass` or `fail` per probe, per endpoint. An endpoint must pass all probes in a category to be considered competent in that category.

**Probe cost:** ~200 tokens input + ~100 tokens output per probe. Running 10 probes against one endpoint costs ~3,000 tokens total — negligible.

### Layer 2: Task Scenarios

Structured prompt-response pairs per task type that test actual work quality. Only run against endpoints that pass the relevant probes. Each scenario is graded 1-5 by the orchestrator (reusing the evaluation pipeline via `evaluateResponseForTest()`).

**Scenario structure:**

```typescript
type TestScenario = {
  id: string;                    // "reasoning-compare-options"
  taskType: string;              // maps to TASK_TYPES registry
  name: string;                  // human-readable
  systemPromptOverrides?: Partial<PromptInput>;  // test with specific mode, role, etc.
  userMessage: string;           // the test prompt
  tools?: ToolDefinition[];      // tools available for this scenario
  assertions: ScenarioAssertion[];  // what to check
  requiredProbes: string[];      // probes that must pass before running this
};

type ScenarioAssertion = {
  type: "contains" | "not_contains" | "json_valid" | "max_length" | "min_length" | "tool_called" | "tool_not_called" | "orchestrator_score_gte";
  value: string | number;
  description: string;           // human-readable explanation
};
```

**Example scenario:**

```json
{
  "id": "tool-action-create-backlog",
  "taskType": "tool-action",
  "name": "Create backlog item from user request",
  "systemPromptOverrides": { "mode": "act" },
  "userMessage": "Add a backlog item: 'Fix the login page redirect bug' with high priority",
  "tools": [{ "name": "create_backlog_item", "..." }],
  "assertions": [
    { "type": "tool_called", "value": "create_backlog_item", "description": "Must call the backlog tool" },
    { "type": "not_contains", "value": "I will now", "description": "Must not narrate — just call the tool" },
    { "type": "orchestrator_score_gte", "value": 3, "description": "Orchestrator grades >= 3" }
  ],
  "requiredProbes": ["tool-calling", "instruction-compliance"]
}
```

**Scenario cost:** ~500-1000 tokens per scenario (prompt + response + evaluation). Running 10 scenarios costs ~10,000 tokens — still cheap.

---

## Section 2: Test Registry

### Where Tests Live

Tests are defined in code as a `TEST_REGISTRY` constant — same pattern as `TASK_TYPES` in `task-types.ts`. They change rarely and are part of the system's core vocabulary.

```typescript
// apps/web/lib/endpoint-test-registry.ts

export const CAPABILITY_PROBES: CapabilityProbe[] = [...];
export const TASK_SCENARIOS: TestScenario[] = [...];
```

### CapabilityProbe Type

```typescript
type CapabilityProbe = {
  id: string;                    // "instruction-compliance-advise-mode"
  category: string;              // "instruction-compliance" | "tool-calling" | "output-format" | "brevity" | "role-boundary" | "hallucination-resistance"
  name: string;                  // human-readable
  promptOverrides?: Partial<PromptInput>;  // overrides merged onto TEST_PROMPT_DEFAULTS
  userMessage: string;
  tools?: ToolDefinition[];
  assert: (response: string, toolCalls?: unknown[]) => { pass: boolean; reason: string };
};
```

### Test Prompt Defaults

All probes and scenarios use `assembleSystemPrompt()` with a base `PromptInput` that simulates a realistic context. Overrides are merged on top:

```typescript
const TEST_PROMPT_DEFAULTS: PromptInput = {
  hrRole: "HR-300",                    // mid-level role with standard capabilities
  grantedCapabilities: ["view_platform", "manage_backlog", "view_operations"],
  deniedCapabilities: ["manage_capabilities", "manage_users"],
  mode: "act",                         // default to act (probes test advise by overriding)
  sensitivity: "internal",
  domainContext: "Domain: Operations. You are on the operations page managing backlog items and platform health.",
  domainTools: ["create_backlog_item", "query_backlog", "report_quality_issue"],
  routeData: null,
  attachmentContext: null,
};
```

### Probe Definitions

Each probe specifies:
- A system prompt (using `assembleSystemPrompt()` with `TEST_PROMPT_DEFAULTS` merged with probe-specific overrides)
- A user message
- Tools to provide (or not)
- An assertion function that returns `pass` / `fail` with a reason

### Scenario Definitions

Organized by task type, with 2-5 scenarios per type covering:
- Happy path (model does the right thing)
- Constraint compliance (model respects boundaries)
- Edge case (ambiguous input, model should clarify or handle gracefully)

Initial scenario coverage:

| Task Type | Scenarios | Tests |
|---|---|---|
| `greeting` | 2 | Responds warmly, stays brief |
| `status-query` | 2 | Uses correct tool, doesn't fabricate data |
| `summarization` | 3 | Concise, accurate, no hallucination |
| `reasoning` | 3 | Multi-step analysis, trade-offs, structured thinking |
| `tool-action` | 3 | Calls correct tool, doesn't narrate, handles errors |
| `code-gen` | 3 | Valid syntax, follows conventions, appropriate scope |
| `creative` | 2 | Platform-specific, not generic |

~20 scenarios total as a starting set, expandable over time.

---

## Section 3: Test Runner

### Execution Flow

```
run_endpoint_tests(endpointId?, taskType?, probesOnly?)
  ↓
1. RESOLVE — which endpoints to test (one, or all active)
  ↓
2. PROBE — run capability probes against each endpoint
     Result: pass/fail per probe per endpoint
     If probesOnly=true → stop here, report results
  ↓
3. GATE — for each endpoint, check which probe categories passed
     Filter scenarios to those whose requiredProbes are satisfied
  ↓
4. SCENARIO — run eligible scenarios against each endpoint
     For each: assemble prompt → call endpoint → check assertions → orchestrator eval
  ↓
5. RECORD — persist results as TaskEvaluation records (source: "test_harness")
     Update EndpointTaskPerformance scores
     Update ModelProfile.codingCapability / instructionFollowing from evidence
  ↓
6. REPORT — return summary: pass/fail probes + scenario scores per endpoint
```

### Calling an Endpoint

The runner uses `callWithFailover()` with `preferredProviderId` to target a specific endpoint. The system prompt is assembled via `assembleSystemPrompt()` with the scenario's overrides. This ensures the test exercises the exact same code path as a real conversation.

### Concurrency

Tests run sequentially per endpoint (to avoid quota exhaustion), but multiple endpoints can be tested in parallel. A configurable concurrency limit (default: 2 endpoints at a time) prevents overwhelming local resources.

### Orchestrator Evaluation for Scenarios

Scenarios with `orchestrator_score_gte` assertions need a synchronous evaluation call. The existing `orchestrator-evaluator.ts` has `evaluateAndUpdateProfile()` (the fire-and-forget entry point) and a private `runEvaluation()` function. For the test runner, we need to:

1. **Export** the core evaluation logic from `orchestrator-evaluator.ts` as `evaluateResponseForTest()` — a function that takes an endpoint response, calls the orchestrator for grading, and returns the parsed score (not fire-and-forget).
2. **Export** `updatePerformanceProfile()` — currently private, needs to be exported so the test runner in `endpoint-test-runner.ts` can update scores.

The evaluation is **awaited** in the test runner (unlike the fire-and-forget pattern in conversations) because the test needs the score before recording results and reporting.

### Failover Detection

The runner uses `callWithFailover()` with `preferredProviderId` to target a specific endpoint. However, `callWithFailover()` may fall back to a different endpoint if the preferred one fails. For test integrity, the runner **must check `FailoverResult.downgraded`** — if `true`, the response came from a different endpoint than intended. In that case, the test result is recorded as `status: "infrastructure_failure"` rather than a score, because scoring endpoint B's response while recording it against endpoint A would corrupt the performance data.

---

## Section 4: Results → Performance Pipeline Integration

### TaskEvaluation Records

Each scenario result becomes a `TaskEvaluation` record:

```
TaskEvaluation {
  endpointId: <tested endpoint>
  taskType: <scenario's taskType>
  qualityScore: <orchestrator score, 1-5>
  humanScore: null  // human can grade later via Workforce page
  taskContext: "TEST: <scenario.name>"
  evaluationNotes: <assertion results summary>
  routeContext: <scenario's simulated route, e.g., "/build" or "/portfolio">
  source: "test_harness"  // NEW field to distinguish from conversation evals
}
```

**`routeContext`** should reflect the domain context the scenario simulates (e.g., a tool-action scenario simulating `/build` should set `routeContext: "/build"`), not "test_harness." The `source` field handles provenance.

The `source` field (new, nullable `String?` on `TaskEvaluation`) distinguishes test results from real conversation evaluations. This allows:
- Filtering: "show me only test results" or "show me only real conversation scores"
- Weighting: optionally weight test scores differently in routing (future)
- Audit: clear provenance of each evaluation

**Existing evaluations:** The conversation evaluation pipeline in `orchestrator-evaluator.ts` should also be updated to set `source: "conversation"` when creating `TaskEvaluation` records. This ensures consistent filtering rather than relying on `null` for legacy records.

### EndpointTaskPerformance Update

After recording `TaskEvaluation` records, the runner calls `updatePerformanceProfile()` — the same function used by the conversation evaluation pipeline. This means:
- Test scores feed into `avgOrchestratorScore` (via EMA)
- Phase transitions (Learning → Practicing → Innate) can be triggered by tests
- Regression detection works across test + conversation data

### ModelProfile Update (Evidence-Based)

After all tests complete for an endpoint, the runner updates `ModelProfile` fields with evidence:

```typescript
// Map probe results to profile fields
if (probeResults["tool-calling"] === "pass" && probeResults["instruction-compliance"] === "pass") {
  modelProfile.instructionFollowing = "excellent";
} else if (probeResults["instruction-compliance"] === "pass") {
  modelProfile.instructionFollowing = "adequate";
} else {
  modelProfile.instructionFollowing = "insufficient";
}

// Map code-gen scenario scores to coding capability
const codeScores = scenarioResults.filter(s => s.taskType === "code-gen");
const avgCodeScore = average(codeScores.map(s => s.score));
if (avgCodeScore >= 4.0) modelProfile.codingCapability = "excellent";
else if (avgCodeScore >= 3.0) modelProfile.codingCapability = "adequate";
else modelProfile.codingCapability = "insufficient";
```

This replaces the guesswork with observed evidence. The next time `callWithFailover()` filters by `instructionFollowing`, it uses data from actual tests.

---

## Section 5: MCP Tool + CLI Interface

### MCP Tool: `run_endpoint_tests`

```typescript
{
  name: "run_endpoint_tests",
  description: "Run the agent test harness against one or all endpoints. Tests capability probes (instruction compliance, tool calling, output format) and task scenarios (reasoning, code-gen, tool-action). Results feed into endpoint performance scores.",
  inputSchema: {
    type: "object",
    properties: {
      endpointId: { type: "string", description: "Test a specific endpoint (default: all active LLM endpoints)" },
      taskType: { type: "string", description: "Run only scenarios for this task type (default: all)" },
      probesOnly: { type: "boolean", description: "Run only capability probes, skip scenarios (default: false)" },
    },
  },
  requiredCapability: "manage_capabilities",
  executionMode: "immediate",
  sideEffect: true,
}
```

This tool is gated by `manage_capabilities` (admin-level) because it consumes tokens and modifies performance data.

### CLI Wrapper

A thin script that calls the MCP tool's underlying function directly:

```bash
# Run all tests against all endpoints
pnpm test:endpoints

# Run probes only against Gemini
pnpm test:endpoints --endpoint gemini --probes-only

# Run code-gen scenarios against all endpoints
pnpm test:endpoints --task-type code-gen

# CI integration — exit 1 if any probe fails
pnpm test:endpoints --probes-only --ci
```

The CLI script lives at `scripts/test-endpoints.ts` and imports the test runner directly (no HTTP, no auth). It outputs results to stdout as a formatted table and exits with code 0 (all pass) or 1 (failures).

---

## Section 6: Data Model Changes

### TaskEvaluation — New Field

```prisma
model TaskEvaluation {
  // ... existing fields ...
  source    String?   // "conversation" | "test_harness" | null (legacy)
}
```

### New Model: EndpointTestRun

Track test run executions for auditability and trend analysis:

```prisma
model EndpointTestRun {
  id              String   @id @default(cuid())
  runId           String   @unique      // "TR-XXXXX"
  endpointId      String?              // null = all endpoints. Bare string matching ModelProvider.providerId (same convention as EndpointTaskPerformance — no FK)
  taskType        String?              // null = all task types
  probesOnly      Boolean  @default(false)
  triggeredBy     String               // userId or "cli"

  // Results summary
  probesPassed    Int      @default(0)
  probesFailed    Int      @default(0)
  scenariosPassed Int      @default(0)
  scenariosFailed Int      @default(0)
  avgScore        Float?              // average orchestrator score across scenarios

  startedAt       DateTime @default(now())
  completedAt     DateTime?
  status          String   @default("running")  // running | completed | failed

  @@index([endpointId])
  @@index([status])
}
```

### ModelProfile — No Schema Change

`codingCapability` and `instructionFollowing` already exist as `String?` fields. The test runner updates them in place — no new fields needed.

---

## Section 7: Connection to Trusted AI Kernel

The test harness is the **proactive arm** of the Trusted AI Kernel. The reactive arm (conversation evaluation) builds trust over time through real work. The proactive arm establishes a baseline before the endpoint receives real work.

**Onboarding flow for a new endpoint:**

```
1. Admin registers endpoint on Workforce page
   → EndpointTaskPerformance rows created (phase: "learning")
   → ModelProfile created with guessed capabilities

2. Admin or agent runs: run_endpoint_tests(endpointId: "new-model")
   → Probes test basic competence
   → Scenarios test task quality
   → ModelProfile updated with evidence (replaces guesses)
   → EndpointTaskPerformance updated with initial scores

3. If probe failures → endpoint stays blocked for those task types
   If scenario scores high → endpoint may accelerate through Learning phase
   If scores low → endpoint gets heavy instructions (Learning phase default)

4. Real conversations begin → reactive evaluation continues building the profile
```

**Regression flow after prompt changes:**

```
1. Developer changes system prompt or task instructions
2. Run: pnpm test:endpoints --ci
3. If regressions → fix before deploying
4. If pass → deploy with confidence
```

---

## Section 8: Migration Strategy

Phases 1-4 are defined in the unified coworker and orchestrated task routing specs. Phases 5a-5g are defined in the development lifecycle architecture spec. This spec defines Phases 6a-6c.

### Phase 6a: Test Registry + Runner Core

- Create `endpoint-test-registry.ts` with probe and scenario definitions
- Create `endpoint-test-runner.ts` with execution logic
- Add `source` field to `TaskEvaluation`
- Add `EndpointTestRun` model
- Wire runner to `callWithFailover()` and `evaluateResponseForTest()`

### Phase 6b: MCP Tool + Evidence Update

- Register `run_endpoint_tests` MCP tool
- Implement ModelProfile evidence update (probes → instructionFollowing, scenarios → codingCapability)
- Connect results to `updatePerformanceProfile()`

### Phase 6c: CLI Wrapper

- Create `scripts/test-endpoints.ts`
- Add `pnpm test:endpoints` script to root package.json
- CI exit codes (0 = pass, 1 = failures)

---

## Alternatives Considered

### A: Separate Test Database / Isolated Environment

Run tests in a sandboxed environment to avoid polluting production performance data.

**Rejected because:** The whole point is that test results feed the production routing system. Isolation would require a separate merge step. The `source: "test_harness"` field provides filtering if needed, without infrastructure complexity.

### B: LLM-as-Judge Only (No Programmatic Assertions)

Use the orchestrator to evaluate everything — no programmatic pass/fail checks.

**Rejected because:** Probes need binary results (does it call a tool: yes/no). LLM evaluation is valuable for scenario quality but too expensive and noisy for simple compliance checks. The two-layer approach (probes = programmatic, scenarios = LLM-judged) uses the right tool for each job.

### C: Dedicated Test UI Page

Build a new `/ops/workforce-tests` page with a test runner, comparison matrix, and result history.

**Rejected because:** The Workforce performance tab already displays scores, evaluations, and trust badges. Test results are just more evaluations. A new page would duplicate the display logic. The MCP tool + CLI covers triggering; the existing UI covers viewing.

---

## Rollback Strategy

- **Phase 6a:** New files + additive schema field. Remove files and ignore the `source` field to revert.
- **Phase 6b:** MCP tool registration is additive. Remove from registry to revert. ModelProfile updates are overwritten by the next profiling run.
- **Phase 6c:** CLI script is standalone. Delete file to revert.

---

## Files Affected

| File | Change |
|------|--------|
| `apps/web/lib/endpoint-test-registry.ts` | NEW — probe definitions + scenario definitions |
| `apps/web/lib/endpoint-test-runner.ts` | NEW — test execution engine |
| `apps/web/lib/endpoint-test-runner.test.ts` | NEW — tests for assertion evaluation logic |
| `apps/web/lib/mcp-tools.ts` | Register `run_endpoint_tests` tool + handler |
| `packages/db/prisma/schema.prisma` | Add `source` to TaskEvaluation; add EndpointTestRun model |
| `apps/web/lib/orchestrator-evaluator.ts` | Export `evaluateResponseForTest()` (awaitable evaluation) and `updatePerformanceProfile()` (currently private); set `source: "conversation"` on existing TaskEvaluation creates |
| `apps/web/lib/ai-profiling.ts` | Add `updateProfileFromEvidence()` function |
| `scripts/test-endpoints.ts` | NEW — CLI wrapper for CI integration |
| `package.json` | Add `test:endpoints` script |

---

## Future Connections

### Continuous Profiling

The test harness can be scheduled (e.g., nightly) to catch model regressions from provider-side updates. Ollama models update silently; a nightly test run would detect capability changes.

### Custom Test Suites

Power users could define domain-specific test scenarios (e.g., "can this model correctly parse our taxonomy structure?") beyond the built-in probes and scenarios.

### Competitive Benchmarking

When evaluating a new provider (e.g., "should we add DeepSeek?"), run the test suite against it before registering. The results immediately show where it fits in the capability landscape.
