# Agent Test Harness — Evidence-Based Model Profiling

**Date:** 2026-03-17
**Status:** Implemented
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-03-16-orchestrated-task-routing-design.md` (EndpointTaskPerformance, evaluation pipeline)
- `docs/superpowers/specs/2026-03-16-unified-mcp-coworker-design.md` (unified coworker, MCP routing)

## Problem Statement

The platform profiles AI models by asking another LLM to describe them, or by inferring capabilities from parameter counts. `ModelProfile.codingCapability` and `instructionFollowing` are guesses — never validated by actual task execution. This creates three problems:

1. **No evidence** — `instructionFollowing: "excellent"` means "a bigger model said so," not "we tested it." Models get trusted with work they can't actually do.
2. **Blind tuning** — when system prompts or task instructions change, there's no way to verify models still comply before real employees hit them. Regressions are discovered in production conversations.
3. **No comparison** — multiple models exist (Ollama/llama3, Gemini, etc.) but there's no systematic way to compare them on the same tasks.

## Design Summary

A two-layer test harness — **capability probes** gate basic competence, then **task scenarios** exercise specific task types — integrated directly into the model profiling pipeline. Tests run **per-model** (providerId + modelId), not per-provider. Results feed into `EndpointTaskPerformance`, `TaskEvaluation`, and update `ModelProfile` with evidence. An MCP tool (`run_endpoint_tests`) and CLI wrapper (`pnpm test:endpoints`) provide on-demand access. The Workforce page's Endpoint Performance panel shows results per-model.

### Key Principles

- **Evidence replaces description** — test results update `ModelProfile.codingCapability` and `instructionFollowing` with observed evidence, replacing LLM-generated guesses
- **Probes are grounded in system prompt rules** — each probe tests a specific rule from the identity block (Rules 1-12), not invented criteria. Probes must match how the real system works (e.g., Advise mode strips sideEffect tools, so probes don't send them)
- **Profiling IS verification** — probes run automatically as part of `profileModelsInternal()`, not as a separate step. Discover → Profile & Verify is one operation.
- **Per-model, not per-provider** — tests iterate over `ModelProfile` records (providerId + modelId pairs). Each model gets its own test run and results.
- **Same pipeline** — test results are `TaskEvaluation` records with `source: "test_harness"`. The existing scoring, lifecycle promotion, and routing logic consume them without modification.
- **Never fabricate** — probes and scenarios must be grounded in documented system prompt rules and actual system behavior. Do not invent test criteria.

---

## Section 1: Two-Layer Test Architecture

### Layer 1: Capability Probes

Small, fast, binary tests that verify behavioral compliance with the system prompt identity block rules. Each probe sends one message and checks the response against assertions grounded in specific rules.

**Critical design constraint:** Probes must simulate the same conditions the model faces in production. If the real system strips tools in Advise mode, the probe must NOT send tools in Advise mode. If the real system filters tools by role capability, the probe must NOT send tools the role can't access. Testing impossible scenarios produces false failures.

**Implemented probes (grounded in system prompt rules):**

| Probe | System Prompt Rule | What It Tests | How |
|---|---|---|---|
| `instruction-compliance-advise-mode` | Rule 3 (mode compliance) | Model gives advisory response without tools | No tools sent (Advise mode strips sideEffect tools). Checks response advises or suggests switching to Act mode. |
| `tool-calling-basic` | Rule 1, 8 (use tools, call silently) | Model calls the correct tool | Act mode with tool available. Checks `create_backlog_item` was called. |
| `brevity-simple-question` | Rule 4 (2-4 sentences max) | Model responds concisely | Simple question, no tools. Checks response under 300 words. |
| `no-narration` | Rule 2, 8 (no narration, tools invisible) | Model calls tool without multi-step narration | Act mode with tool. Checks tool was called AND no heavy narration ("Step 1... Step 2..."). |
| `hallucination-resistance` | Rule 1, 7, 12 (don't claim, be honest, don't fabricate) | Model admits when it lacks capability | Ask for impossible action (deploy/migrate) with no tools. Broad pattern matching for many ways of saying "I can't." |
| `role-boundary` | Rule 1 (never claim what you didn't do) | Model doesn't claim false success | No tools (role lacks capability). Checks model does NOT claim to have created the item. Pass by default unless the model hallucinates success. |

**Probe result:** `pass` or `fail` per probe, per model.

### Layer 2: Task Scenarios

Structured prompt-response pairs per task type. Only run against models that pass the relevant probes. Each scenario is graded 1-5 by the orchestrator via `evaluateResponseForTest()`.

**Implemented scenarios:**

| ID | Task Type | What It Tests |
|---|---|---|
| `greeting-brief` | greeting | Responds briefly, avoids generic AI phrasing |
| `tool-action-create-backlog` | tool-action | Calls correct tool without narration |
| `reasoning-compare` | reasoning | Substantive analysis, no AI disclaimers |
| `summarization-concise` | summarization | Concise summary without recommendations |

---

## Section 2: Test Registry

### Where Tests Live

Tests are defined in code in `apps/web/lib/endpoint-test-registry.ts` — same pattern as `TASK_TYPES` in `task-types.ts`.

### Types

```typescript
type CapabilityProbe = {
  id: string;
  category: string;
  name: string;
  promptOverrides?: Partial<PromptInput>;
  userMessage: string;
  tools?: ToolDefinition[];      // Only include tools the real system would offer
  assert: (response: string, toolCalls?: unknown[]) => { pass: boolean; reason: string };
};

type TestScenario = {
  id: string;
  taskType: string;
  name: string;
  routeContext: string;
  promptOverrides?: Partial<PromptInput>;
  userMessage: string;
  tools?: ToolDefinition[];
  assertions: ScenarioAssertion[];
  requiredProbes: string[];      // Probes that must pass before running this scenario
};

type ScenarioAssertion = {
  type: "contains" | "not_contains" | "max_length" | "min_length" | "tool_called" | "tool_not_called" | "orchestrator_score_gte";
  value: string | number;
  description: string;
};
```

### Test Prompt Defaults

All probes and scenarios use `assembleSystemPrompt()` with defaults that simulate a realistic mid-level employee context:

```typescript
const TEST_PROMPT_DEFAULTS: PromptInput = {
  hrRole: "HR-300",
  grantedCapabilities: ["view_platform", "manage_backlog", "view_operations"],
  deniedCapabilities: ["manage_capabilities", "manage_users"],
  mode: "act",
  sensitivity: "internal",
  domainContext: "Domain: Operations. You are on the operations page.",
  domainTools: ["create_backlog_item", "query_backlog", "report_quality_issue"],
  routeData: null,
  attachmentContext: null,
};
```

---

## Section 3: Test Runner — Model-Level Execution

### Per-Model, Not Per-Provider

The runner iterates over `ModelProfile` records (providerId + modelId pairs), not providers. A provider like Ollama may have multiple models with different capabilities — each is tested independently.

```
run_endpoint_tests(endpointId?, modelId?, taskType?, probesOnly?)
  ↓
1. RESOLVE — query active LLM providers, then find ModelProfile records
     (ModelProfile has no FK to ModelProvider — query providers first, filter profiles by ID)
  ↓
2. For each model:
   a. PROBE — run capability probes
   b. GATE — filter scenarios by required probes
   c. SCENARIO — run eligible scenarios (unless probesOnly)
   d. RECORD — persist TaskEvaluation + update EndpointTaskPerformance
   e. EVIDENCE — update ModelProfile.instructionFollowing / codingCapability
   f. STORE — save full probe/scenario results as JSON on EndpointTestRun.results
```

### Integration into Profiling Pipeline

Probes run automatically at the end of `profileModelsInternal()` in `ai-provider-internals.ts`. The flow is:

```
Provider setup wizard → Discover → Profile & Verify
  ↓
profileModelsInternal():
  1. Generate descriptive profile (metadata or LLM-based)
  2. Save ModelProfile with guessed capabilities
  3. Call verifyModels() → runs probes against each profiled model
  4. ModelProfile updated with evidence-based instructionFollowing
  ↓
Result: profiles have both descriptive metadata AND verified capabilities
```

This means profiling and verification are one step in the UI — the user sees "Profiling & verifying 3 models..." and when complete, the ModelProfile has evidence-based ratings.

### Failover Detection

The runner checks `FailoverResult.downgraded` — if the response came from a different endpoint, the test records `infrastructure_failure` instead of a score.

---

## Section 4: Results Pipeline

### TaskEvaluation Records

Scenario results become `TaskEvaluation` records with `source: "test_harness"`. The existing conversation pipeline sets `source: "conversation"`.

### EndpointTestRun — Full Results Storage

Each test run stores full probe/scenario details as JSON in `EndpointTestRun.results`:

```json
{
  "modelId": "llama3.1:8b",
  "friendlyName": "Llama 3.1 8B",
  "probes": [
    { "id": "tool-calling-basic", "category": "tool-calling", "name": "...", "pass": true, "reason": "..." }
  ],
  "scenarios": [
    { "id": "greeting-brief", "taskType": "greeting", "name": "...", "passed": true, "assertions": [...] }
  ]
}
```

This enables the UI to show detailed results per test run, per model.

### ModelProfile Evidence Update

```typescript
// instruction-compliance + tool-calling + no-narration all pass → "excellent"
// instruction-compliance passes → "adequate"
// instruction-compliance fails → "insufficient"
mapProbeResultsToInstructionFollowing(probePassMap)

// code-gen scenario avg >= 4.0 → "excellent"
// avg >= 3.0 → "adequate"
// avg < 3.0 → "insufficient"
mapScoresToCodingCapability(scores)
```

---

## Section 5: Access — MCP Tool, CLI, UI

### MCP Tool: `run_endpoint_tests`

Gated by `manage_capabilities`. Accepts `endpointId`, `modelId`, `taskType`, `probesOnly`.

### CLI Wrapper

```bash
pnpm test:endpoints                          # all models
pnpm test:endpoints --endpoint ollama        # one provider's models
pnpm test:endpoints --probes-only --ci       # CI mode (exit 1 on failures)
```

Script: `scripts/test-endpoints.ts`

### Workforce UI — Endpoint Performance Panel

Added to the provider detail page (`/platform/ai/providers/[providerId]`). Shows:

- **By Task Type tab:** Per-task-type scores, trust phase badges, evaluation counts
- **Recent Evaluations tab:** Last 20 evaluations with scores and "test" badge for harness results
- **Test Runs tab:** History with model name, probe pass/fail details with failure reasons, scenario assertion details
- **Run Probes / Run Full Tests buttons:** Trigger tests from the UI

Server actions in `apps/web/lib/actions/endpoint-performance.ts`.

---

## Section 6: Data Model

### TaskEvaluation — New Field

```prisma
source    String?   // "conversation" | "test_harness" | null (legacy)
```

### EndpointTestRun

```prisma
model EndpointTestRun {
  id              String    @id @default(cuid())
  runId           String    @unique
  endpointId      String?
  modelId         String?               // Which specific model was tested
  taskType        String?
  probesOnly      Boolean   @default(false)
  triggeredBy     String
  probesPassed    Int       @default(0)
  probesFailed    Int       @default(0)
  scenariosPassed Int       @default(0)
  scenariosFailed Int       @default(0)
  avgScore        Float?
  results         Json?                  // Full probe + scenario results for UI display
  startedAt       DateTime  @default(now())
  completedAt     DateTime?
  status          String    @default("running")

  @@index([endpointId])
  @@index([status])
}
```

---

## Section 7: Connection to Trusted AI Kernel

The test harness is the **proactive arm** of the Trusted AI Kernel.

**Onboarding flow for a new model:**

```
1. Admin sets up provider → Discover → Profile & Verify (automatic)
   → ModelProfile created with evidence-based instructionFollowing
   → EndpointTestRun records probe results

2. If probes fail → model's instructionFollowing = "insufficient" → router deprioritizes
   If probes pass → model's instructionFollowing = "excellent" → router trusts for instruction-heavy tasks

3. Real conversations begin → reactive evaluation continues building the profile
```

---

## Files Implemented

| File | What |
|------|------|
| `apps/web/lib/endpoint-test-registry.ts` | Probe definitions (6), scenario definitions (4), types, assertion helpers |
| `apps/web/lib/endpoint-test-runner.ts` | Model-level test execution, evidence mapping, `verifyModels()` |
| `apps/web/lib/endpoint-test-runner.test.ts` | Unit tests for assertion evaluation and evidence mapping |
| `apps/web/lib/mcp-tools.ts` | `run_endpoint_tests` tool definition + handler |
| `apps/web/lib/orchestrator-evaluator.ts` | Exported `evaluateResponseForTest()` + `updatePerformanceProfile()`; `source: "conversation"` on existing evals |
| `apps/web/lib/ai-provider-internals.ts` | `profileModelsInternal()` calls `verifyModels()` at the end |
| `apps/web/lib/actions/endpoint-performance.ts` | Server actions for performance data + `triggerEndpointTests()` |
| `apps/web/components/platform/EndpointPerformancePanel.tsx` | UI: performance tabs, test run details with probe/scenario results |
| `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` | Wired performance panel into provider detail page |
| `packages/db/prisma/schema.prisma` | `source` on TaskEvaluation; `EndpointTestRun` model with `modelId` + `results` |
| `scripts/test-endpoints.ts` | CLI wrapper |
| `package.json` | `test:endpoints` script |

---

## Lessons Learned During Implementation

1. **Probes must match real system behavior.** Initial probes sent tools the real system would never offer (e.g., tools in Advise mode, tools for unauthorized roles), then blamed the model for using them. The system prevents misuse by not offering tools, not by hoping the model self-censors.

2. **Tests run per-model, not per-provider.** A provider like Ollama has multiple models with different capabilities. Testing "ollama" as a unit is meaningless — the user needs to see "llama3.1 passes 5/6, phi3 passes 2/6."

3. **Profiling and verification are one step.** Separating "profile" (guess capabilities) from "verify" (test capabilities) creates a confusing two-step flow. The profiler should produce evidence-based results in one pass.

4. **ModelProfile has no FK to ModelProvider.** `providerId` is a bare string — can't use Prisma relation filters. Query active providers first, then filter profiles by provider ID.
