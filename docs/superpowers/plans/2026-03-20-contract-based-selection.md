# EP-INF-005a: Contract-Based Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex task classification + weighted dimension scoring with structured RequestContract + cost-per-success ranking, running parallel to the legacy path as fallback.

**Architecture:** New `RequestContract` type with deterministic inference. New `routeEndpointV2()` pipeline function using cost-per-success ranking. Legacy `routeEndpoint()` stays as fallback. Both produce the same `RouteDecision` output.

**Tech Stack:** TypeScript, Vitest (globals: false), Prisma

**Spec:** `docs/superpowers/specs/2026-03-20-contract-based-selection-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/request-contract.ts` | `RequestContract` type, `inferContract()`, default reasoning depths |
| `apps/web/lib/routing/cost-ranking.ts` | `estimateCost()`, `estimateSuccessProbability()`, `rankByCostPerSuccess()` |
| `apps/web/lib/routing/pipeline-v2.ts` | `routeEndpointV2()` — contract-based routing with cost-per-success |
| `apps/web/lib/routing/request-contract.test.ts` | Contract inference tests |
| `apps/web/lib/routing/cost-ranking.test.ts` | Ranking tests |
| `apps/web/lib/routing/pipeline-v2.test.ts` | V2 pipeline integration tests |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add contract template fields to `TaskRequirement` |
| `apps/web/lib/routing/pipeline.ts` | Export `getExclusionReason()` for reuse |
| `apps/web/lib/routing/index.ts` | Export new modules |

### Unchanged Files

| File | Why |
|---|---|
| `apps/web/lib/routing/scoring.ts` | Legacy path, retained |
| `apps/web/lib/routing/fallback.ts` | Still receives RouteDecision |
| `apps/web/lib/task-classifier.ts` | Still determines taskType |
| `apps/web/lib/routing/rate-tracker.ts` | Consumed by both paths |

---

## Task 1: RequestContract Type + Contract Inference

**Files:**
- Create: `apps/web/lib/routing/request-contract.ts`
- Create: `apps/web/lib/routing/request-contract.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/lib/routing/request-contract.test.ts
import { describe, expect, it } from "vitest";
import { inferContract } from "./request-contract";
import type { RequestContract } from "./request-contract";

describe("inferContract", () => {
  const baseMessages = [{ role: "user" as const, content: "Hello world" }];

  describe("tool detection", () => {
    it("sets requiresTools true when tools provided", async () => {
      const contract = await inferContract("tool-action", baseMessages, [{ name: "search" }]);
      expect(contract.requiresTools).toBe(true);
    });

    it("sets requiresTools false when no tools", async () => {
      const contract = await inferContract("greeting", baseMessages);
      expect(contract.requiresTools).toBe(false);
    });
  });

  describe("schema detection", () => {
    it("sets requiresStrictSchema true when outputSchema provided", async () => {
      const contract = await inferContract("data-extraction", baseMessages, undefined, { type: "object" });
      expect(contract.requiresStrictSchema).toBe(true);
    });

    it("sets modality.output to json when schema provided", async () => {
      const contract = await inferContract("data-extraction", baseMessages, undefined, { type: "object" });
      expect(contract.modality.output).toContain("json");
    });
  });

  describe("modality inference", () => {
    it("detects image input from message content", async () => {
      const messages = [{ role: "user" as const, content: [
        { type: "text", text: "Describe this" },
        { type: "image", source: { type: "base64", data: "..." } },
      ]}];
      const contract = await inferContract("reasoning", messages);
      expect(contract.modality.input).toContain("image");
    });

    it("sets output to tool_call when tools provided", async () => {
      const contract = await inferContract("tool-action", baseMessages, [{ name: "search" }]);
      expect(contract.modality.output).toContain("tool_call");
    });

    it("defaults to text input/output", async () => {
      const contract = await inferContract("greeting", baseMessages);
      expect(contract.modality.input).toEqual(["text"]);
      expect(contract.modality.output).toEqual(["text"]);
    });
  });

  describe("reasoning depth defaults", () => {
    it("maps greeting to minimal", async () => {
      const contract = await inferContract("greeting", baseMessages);
      expect(contract.reasoningDepth).toBe("minimal");
    });

    it("maps reasoning to high", async () => {
      const contract = await inferContract("reasoning", baseMessages);
      expect(contract.reasoningDepth).toBe("high");
    });

    it("maps code-gen to medium", async () => {
      const contract = await inferContract("code-gen", baseMessages);
      expect(contract.reasoningDepth).toBe("medium");
    });

    it("defaults unknown task types to medium", async () => {
      const contract = await inferContract("unknown-type", baseMessages);
      expect(contract.reasoningDepth).toBe("medium");
    });
  });

  describe("contract family", () => {
    it("produces sync.code-gen for default sync mode", async () => {
      const contract = await inferContract("code-gen", baseMessages);
      expect(contract.contractFamily).toBe("sync.code-gen");
    });

    it("produces background.data-extraction with route context", async () => {
      const contract = await inferContract("data-extraction", baseMessages, undefined, undefined, {
        sensitivity: "internal",
        interactionMode: "background",
      });
      expect(contract.contractFamily).toBe("background.data-extraction");
    });
  });

  describe("token estimation", () => {
    it("estimates input tokens from message length", async () => {
      const longMessage = [{ role: "user" as const, content: "a".repeat(4000) }];
      const contract = await inferContract("reasoning", longMessage);
      expect(contract.estimatedInputTokens).toBeGreaterThanOrEqual(900);
      expect(contract.estimatedInputTokens).toBeLessThanOrEqual(1100);
    });
  });

  describe("route context overrides", () => {
    it("uses sensitivity from route context", async () => {
      const contract = await inferContract("greeting", baseMessages, undefined, undefined, {
        sensitivity: "confidential",
      });
      expect(contract.sensitivity).toBe("confidential");
    });

    it("uses budgetClass from route context", async () => {
      const contract = await inferContract("greeting", baseMessages, undefined, undefined, {
        sensitivity: "internal",
        budgetClass: "minimize_cost",
      });
      expect(contract.budgetClass).toBe("minimize_cost");
    });

    it("defaults sensitivity to internal", async () => {
      const contract = await inferContract("greeting", baseMessages);
      expect(contract.sensitivity).toBe("internal");
    });

    it("defaults budgetClass to balanced", async () => {
      const contract = await inferContract("greeting", baseMessages);
      expect(contract.budgetClass).toBe("balanced");
    });
  });

  describe("contractId", () => {
    it("generates a unique contractId", async () => {
      const c1 = await inferContract("greeting", baseMessages);
      const c2 = await inferContract("greeting", baseMessages);
      expect(c1.contractId).not.toBe(c2.contractId);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/request-contract.test.ts`

- [ ] **Step 3: Implement request-contract.ts**

Key implementation details:
- `RequestContract` type as defined in spec Section 1
- `inferContract()` is async (for future DB template lookup, but initially pure)
- `contractId` generated with `crypto.randomUUID()` or a simple incrementing counter
- Message content scanning: check if content is an array (multimodal) and look for `type: "image"`, `type: "file"`, etc.
- Token estimation: sum content string lengths / 4
- `DEFAULT_REASONING_DEPTH` map for task type defaults
- Route context fields override defaults when provided
- Export the `RequestContract` type and `inferContract` function

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/request-contract.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/request-contract.ts apps/web/lib/routing/request-contract.test.ts
git commit -m "feat(routing): EP-INF-005a RequestContract type and contract inference with TDD"
```

---

## Task 2: Cost-Per-Success Ranking

**Files:**
- Create: `apps/web/lib/routing/cost-ranking.ts`
- Create: `apps/web/lib/routing/cost-ranking.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `estimateCost` computes correct cost from pricing + token estimates
- `estimateCost` returns null when pricing is null
- `estimateCost` returns 0 for free models (pricing = 0)
- `estimateSuccessProbability` returns 0 when required tool capability missing
- `estimateSuccessProbability` returns 0 when required schema capability missing
- `estimateSuccessProbability` returns 0.3 when below quality floor
- `estimateSuccessProbability` uses failure rate for base probability
- `rankByCostPerSuccess` with `minimize_cost`: cheapest above floor wins
- `rankByCostPerSuccess` with `quality_first`: highest success prob wins
- `rankByCostPerSuccess` with `balanced`: blends cost and quality
- `rankByCostPerSuccess` penalizes null pricing (not treated as free)
- `rankByCostPerSuccess` ranks free models by quality

Use `makeEndpoint()` helper pattern from `pipeline.test.ts` — import `EMPTY_CAPABILITIES`, `EMPTY_PRICING` from `model-card-types.ts` and override specific fields.

For `averageRelevantDimensions`, import `getDimensionsForTask` from `production-feedback.ts` (it's already exported).

- [ ] **Step 2: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/cost-ranking.test.ts`

- [ ] **Step 3: Implement cost-ranking.ts**

Key details:
- `estimateCost(endpoint, contract)` uses `endpoint.pricing.inputPerMToken` and `outputPerMToken` with `contract.estimatedInputTokens/OutputTokens`
- `estimateSuccessProbability(endpoint, contract)` checks required capabilities, quality floor, failure rate. **NOTE:** `ModelCardCapabilities` fields are `boolean | null`. Use `!== true` (not `!value`) for required capability checks — `null` (unknown) is treated as "does not have capability," which is the correct conservative behavior per EP-INF-003 principle.
- `averageRelevantDimensions(endpoint, taskType)` uses `getDimensionsForTask()` from `production-feedback.ts` to get relevant dimensions, then averages the endpoint's scores for those dimensions. Access scores via a lookup map (not bracket notation on EndpointManifest, which isn't string-indexed):

```typescript
function getDimensionScore(ep: EndpointManifest, dim: string): number {
  const scores: Record<string, number> = {
    reasoning: ep.reasoning, codegen: ep.codegen, toolFidelity: ep.toolFidelity,
    instructionFollowing: ep.instructionFollowing, structuredOutput: ep.structuredOutput,
    conversational: ep.conversational, contextRetention: ep.contextRetention,
  };
  return scores[dim] ?? 50;
}
```

Handle empty dimensions (unknown task type → `getDimensionsForTask()` returns `[]`) by returning 50 (neutral) instead of dividing by zero.
- `rankByCostPerSuccess(candidates, contract)` implements the three budget class behaviors
- `REASONING_DEPTH_FLOORS` map: minimal→30, low→45, medium→60, high→75
- Export all functions

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/cost-ranking.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/cost-ranking.ts apps/web/lib/routing/cost-ranking.test.ts
git commit -m "feat(routing): EP-INF-005a cost-per-success ranking with TDD"
```

---

## Task 3: Pipeline V2

**Files:**
- Create: `apps/web/lib/routing/pipeline-v2.ts`
- Create: `apps/web/lib/routing/pipeline-v2.test.ts`
- Modify: `apps/web/lib/routing/pipeline.ts` (export `getExclusionReason`)

- [ ] **Step 1: Verify `getExclusionReason` is exported from pipeline.ts**

Read `apps/web/lib/routing/pipeline.ts` line 115. `getExclusionReason()` may already be exported. If so, this is a no-op.

**CRITICAL NOTE:** `getExclusionReason()` takes `(ep: EndpointManifest, req: TaskRequirementContract, sensitivity: SensitivityLevel)`. It accepts `TaskRequirementContract`, NOT `RequestContract`. These are different types. In `pipeline-v2.ts`, you must create a new `getExclusionReasonV2(ep: EndpointManifest, contract: RequestContract)` function that:
- Duplicates the relevant checks from `getExclusionReason` (status, modelClass, context window, rate limits)
- Maps `contract.sensitivity` to the sensitivity check
- Maps `contract.requiresTools`, `contract.requiresStrictSchema`, `contract.requiresStreaming` to the capability checks
- Adds the NEW contract-specific checks (modality, residency)

Do NOT try to call the existing `getExclusionReason` with a `RequestContract` — it won't compile.

- [ ] **Step 2: Write failing tests for pipeline-v2**

```typescript
// apps/web/lib/routing/pipeline-v2.test.ts
import { describe, expect, it } from "vitest";
import { routeEndpointV2 } from "./pipeline-v2";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";

// Reuse makeEndpoint pattern from pipeline.test.ts
function makeEndpoint(overrides: Partial<EndpointManifest>): EndpointManifest {
  // ... same defaults as pipeline.test.ts
}

function makeContract(overrides: Partial<RequestContract> = {}): RequestContract {
  return {
    contractId: "test-contract",
    contractFamily: "sync.test",
    taskType: "reasoning",
    modality: { input: ["text"], output: ["text"] },
    interactionMode: "sync",
    sensitivity: "internal",
    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: false,
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    reasoningDepth: "medium",
    budgetClass: "balanced",
    ...overrides,
  };
}

describe("routeEndpointV2", () => {
  it("produces a valid RouteDecision", () => {
    const ep = makeEndpoint({ id: "ep1", providerId: "openai", modelId: "gpt-4o",
      pricing: { ...EMPTY_PRICING, inputPerMToken: 5, outputPerMToken: 15 } });
    const decision = routeEndpointV2([ep], makeContract(), [], []);
    expect(decision.selectedEndpoint).toBe("ep1");
    expect(decision.selectedModelId).toBe("gpt-4o");
  });

  it("excludes models lacking required image input", () => {
    const ep = makeEndpoint({
      id: "ep1",
      capabilities: { ...EMPTY_CAPABILITIES, imageInput: false },
    });
    const contract = makeContract({
      modality: { input: ["text", "image"], output: ["text"] },
    });
    const decision = routeEndpointV2([ep], contract, [], []);
    expect(decision.selectedEndpoint).toBeNull();
    expect(decision.excludedReasons.some(r => r.includes("image"))).toBe(true);
  });

  it("excludes models lacking required structuredOutput", () => {
    const ep = makeEndpoint({
      id: "ep1",
      capabilities: { ...EMPTY_CAPABILITIES, structuredOutput: false },
    });
    const contract = makeContract({ requiresStrictSchema: true });
    const decision = routeEndpointV2([ep], contract, [], []);
    expect(decision.selectedEndpoint).toBeNull();
  });

  it("prefers cheaper model for minimize_cost budget", () => {
    const cheap = makeEndpoint({
      id: "cheap", providerId: "openai", modelId: "gpt-4o-mini",
      reasoning: 65, codegen: 65,
      pricing: { ...EMPTY_PRICING, inputPerMToken: 0.15, outputPerMToken: 0.6 },
    });
    const expensive = makeEndpoint({
      id: "expensive", providerId: "anthropic", modelId: "claude-opus-4-6",
      reasoning: 95, codegen: 92,
      pricing: { ...EMPTY_PRICING, inputPerMToken: 5, outputPerMToken: 25 },
    });
    const contract = makeContract({ budgetClass: "minimize_cost", reasoningDepth: "medium" });
    const decision = routeEndpointV2([cheap, expensive], contract, [], []);
    expect(decision.selectedEndpoint).toBe("cheap");
  });

  it("prefers quality model for quality_first budget", () => {
    const cheap = makeEndpoint({
      id: "cheap", reasoning: 65,
      pricing: { ...EMPTY_PRICING, inputPerMToken: 0.15, outputPerMToken: 0.6 },
    });
    const expensive = makeEndpoint({
      id: "expensive", reasoning: 95,
      pricing: { ...EMPTY_PRICING, inputPerMToken: 5, outputPerMToken: 25 },
    });
    const contract = makeContract({ budgetClass: "quality_first" });
    const decision = routeEndpointV2([cheap, expensive], contract, [], []);
    expect(decision.selectedEndpoint).toBe("expensive");
  });

  it("penalizes null pricing (not treated as free)", () => {
    const knownCost = makeEndpoint({
      id: "known", reasoning: 70,
      pricing: { ...EMPTY_PRICING, inputPerMToken: 1, outputPerMToken: 3 },
    });
    const unknownCost = makeEndpoint({
      id: "unknown", reasoning: 70,
      pricing: EMPTY_PRICING,
    });
    const contract = makeContract({ budgetClass: "minimize_cost" });
    const decision = routeEndpointV2([knownCost, unknownCost], contract, [], []);
    expect(decision.selectedEndpoint).toBe("known");
  });

  it("handles residency policy local_only", () => {
    const cloud = makeEndpoint({ id: "cloud", providerId: "openai" });
    const local = makeEndpoint({ id: "local", providerId: "ollama" });
    const contract = makeContract({ residencyPolicy: "local_only" });
    const decision = routeEndpointV2([cloud, local], contract, [], []);
    expect(decision.selectedEndpoint).toBe("local");
  });
});
```

- [ ] **Step 3: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/pipeline-v2.test.ts`

- [ ] **Step 4: Implement pipeline-v2.ts**

Key implementation:
- Import `filterByPolicy` from `./pipeline` (already exported)
- Import `getExclusionReason` from `./pipeline` (newly exported in step 1)
- Import `checkModelCapacity` from `./rate-tracker`
- Import `estimateSuccessProbability`, `rankByCostPerSuccess` from `./cost-ranking`
- `routeEndpointV2()` follows the same stage structure as `routeEndpoint()`:
  1. Pin/block overrides (duplicate the logic from routeEndpoint — it's ~30 lines, not worth extracting a shared function for this epic)
  2. Policy filter via `filterByPolicy()`
  3. Hard filter: call `getExclusionReason()` for existing checks, PLUS new contract-specific checks:
     - Modality: `contract.modality.input.includes("image") && !ep.capabilities.imageInput`
     - Modality: `contract.modality.input.includes("file") && !ep.capabilities.pdfInput`
     - Schema: `contract.requiresStrictSchema && !ep.capabilities.structuredOutput`
     - Residency: `contract.residencyPolicy === "local_only" && ep.providerId !== "ollama"`
  4. Cost-per-success ranking via `rankByCostPerSuccess()`
  5. Capacity penalty from EP-INF-004
  6. Select winner + build fallback chain (same logic as routeEndpoint)
- Output: standard `RouteDecision` — `taskType` from `contract.taskType`

- [ ] **Step 5: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/pipeline-v2.test.ts`

- [ ] **Step 6: Run ALL routing tests to verify no regressions**

Run: `cd apps/web && npx vitest run lib/routing/`

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/routing/pipeline-v2.ts apps/web/lib/routing/pipeline-v2.test.ts apps/web/lib/routing/pipeline.ts
git commit -m "feat(routing): EP-INF-005a contract-based pipeline v2 with TDD"
```

---

## Task 4: Prisma Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (TaskRequirement model, around line 2867)

- [ ] **Step 1: Add contract template fields to TaskRequirement**

```prisma
  // EP-INF-005a: Contract template fields
  reasoningDepthDefault      String    @default("medium")
  budgetClassDefault         String    @default("balanced")
  interactionModeDefault     String    @default("sync")
  supportedInputModalities   Json      @default("[\"text\"]")
  supportedOutputModalities  Json      @default("[\"text\"]")
  residencyPolicy            String?
```

- [ ] **Step 2: Run migration**

Run: `cd packages/db && npx prisma migrate dev --name ep-inf-005a-contract-template-fields`

If migration requires interactive reset (drift), use the manual approach from EP-INF-003 Task 10: create migration SQL manually, apply with `prisma db execute`, register with `prisma migrate resolve --applied`.

- [ ] **Step 3: Regenerate Prisma client**

Run: `cd packages/db && npx prisma generate`

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): EP-INF-005a add contract template fields to TaskRequirement"
```

---

## Task 5: Update Exports + Wire Into Call Site

**Files:**
- Modify: `apps/web/lib/routing/index.ts`
- Optionally modify: call site where routing is invoked (for awareness, not necessarily changing it in this epic)

- [ ] **Step 1: Add exports to index.ts**

```typescript
// EP-INF-005a: Contract-based selection
export type { RequestContract } from "./request-contract";
export { inferContract } from "./request-contract";
export { estimateCost, estimateSuccessProbability, rankByCostPerSuccess } from "./cost-ranking";
export { routeEndpointV2 } from "./pipeline-v2";
```

- [ ] **Step 2: Note on call site wiring**

The call site (`agent-coworker.ts` around line 471) currently calls `routeEndpoint()`. Wiring in `routeEndpointV2()` as the primary path with fallback to `routeEndpoint()` can be done in this task or as a separate follow-up. The key change:

```typescript
// Primary: contract-based routing
const contract = await inferContract(classification.taskType, messages, tools, outputSchema, {
  sensitivity: routeCtx.sensitivity,
  interactionMode: "sync",
});
const manifestDecision = routeEndpointV2(manifests, contract, policies, epOverrides);

// Fallback: if V2 returns no selection and legacy would have found one
if (!manifestDecision.selectedEndpoint) {
  const taskReq = await loadTaskRequirement(classification.taskType);
  const legacyDecision = routeEndpoint(manifests, taskReq, routeCtx.sensitivity, policies, epOverrides);
  if (legacyDecision.selectedEndpoint) {
    // Use legacy result but log that V2 failed
    console.warn(`[routing] V2 found no endpoint, falling back to legacy for ${classification.taskType}`);
    manifestDecision = legacyDecision;
  }
}
```

**Important:** Read `agent-coworker.ts` carefully before modifying — understand the full flow. If the wiring is complex, defer to a separate commit.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/routing/index.ts
git commit -m "feat(routing): EP-INF-005a export contract-based selection modules"
```

---

## Task 6: Run Full Test Suite & Verify

- [ ] **Step 1: Run all routing tests**

Run: `cd apps/web && npx vitest run lib/routing/`
Expected: All tests pass — new contract/ranking/v2 tests + all existing tests.

- [ ] **Step 2: Run type check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit if any fixes needed**

```bash
git add apps/web/lib/routing/ apps/web/lib/ai-inference.ts
git commit -m "fix(routing): EP-INF-005a address test suite issues"
```
