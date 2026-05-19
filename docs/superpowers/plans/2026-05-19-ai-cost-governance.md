# AI Cost Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instrument, right-size, and bound AI token spend across all three cost pools (DPF internal API, Claude Code CLI, Codex CLI) to eliminate silent waste and enforce agent budgets.

**Architecture:** Four phases build on each other — Phase 1 closes observability gaps so Phase 2 budget gates can read real data; Phase 2 right-sizes models so Phase 3 compaction has cheaper iteration; Phase 4 makes CLI pool exhaustion visible before it stalls builds. `ModelProfile.costTier` (already in schema) is the authoritative model tier source — no new `ModelTierPolicy` table needed.

**Tech Stack:** Next.js 16, Prisma 7.x, TypeScript, PostgreSQL, Prometheus (prom-client), Vitest. All shell commands run inside Linux containers. Use `pnpm --filter web` for app commands.

**Spec:** `docs/superpowers/specs/2026-05-19-ai-cost-governance.md`
**Epic:** Create EP-COST-001 in the backlog before starting. Query live backlog for the epic ID; use it in every task status update.

---

## Pre-Flight Checklist

Before starting any task:
- [ ] Run `pnpm --filter web typecheck` — note any pre-existing errors; do not introduce new ones
- [ ] Run `pnpm --filter web exec vitest run apps/web/lib/routing/` — note any pre-existing failures
- [ ] Confirm you are on a topic branch (`feat/ep-cost-observability` for Phase 1), not `main`

---

## Phase 1 — Observability

> **Goal:** Every Anthropic inference call produces a complete cost record including prompt cache hit/miss. All gaps confirmed in spec §"Current State Assessment" addressed.

---

### Task 1.1: Extend `AdapterResult.usage` with cache fields

**Files:**
- Modify: `apps/web/lib/routing/adapter-types.ts:60`
- Modify: `apps/web/lib/routing/chat-adapter.ts:383–385`
- Modify: `apps/web/lib/routing/chat-adapter.test.ts` (add test)

**Context:** `AdapterResult.usage` currently carries only `{ inputTokens, outputTokens }`. Anthropic's API returns `usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens` in every response when prompt caching is active. The chat adapter discards them at line 383–385. The downstream telemetry writer already has a `cachedInputTokens` field waiting for this data.

- [ ] **Step 1: Write a failing test in `chat-adapter.test.ts`**

  Find the existing Anthropic response test (grep for `"input_tokens"` in that file). Add a sibling test:

  ```typescript
  it("extracts cache token fields from Anthropic response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        content: [{ type: "text", text: "hello" }],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 300,
        },
      }),
    });
    global.fetch = mockFetch;

    const result = await chatAdapter.execute({
      // … minimal AdapterRequest matching existing test patterns …
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "test-key",
    });

    expect(result.usage.cacheCreationInputTokens).toBe(500);
    expect(result.usage.cacheReadInputTokens).toBe(300);
  });
  ```

- [ ] **Step 2: Run test to confirm it fails**
  ```
  pnpm --filter web exec vitest run apps/web/lib/routing/chat-adapter.test.ts
  ```
  Expected: `TypeError: result.usage.cacheCreationInputTokens is undefined`

- [ ] **Step 3: Extend `AdapterResult.usage` type in `adapter-types.ts:60`**

  Change:
  ```typescript
  usage: { inputTokens: number; outputTokens: number };
  ```
  To:
  ```typescript
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  ```

- [ ] **Step 4: Extract cache fields in `chat-adapter.ts:383–385` (Anthropic branch only)**

  Change:
  ```typescript
  const usage = (data.usage as Record<string, number>) ?? {};
  inputTokens = usage.input_tokens ?? 0;
  outputTokens = usage.output_tokens ?? 0;
  ```
  To:
  ```typescript
  const usage = (data.usage as Record<string, number>) ?? {};
  inputTokens = usage.input_tokens ?? 0;
  outputTokens = usage.output_tokens ?? 0;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens > 0
    ? usage.cache_creation_input_tokens : undefined;
  const cacheReadInputTokens = usage.cache_read_input_tokens > 0
    ? usage.cache_read_input_tokens : undefined;
  ```

  Then update the return statement at `chat-adapter.ts:485` to include the cache fields:
  ```typescript
  return {
    text,
    toolCalls,
    usage: { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens },
    inferenceMs,
  };
  ```
  Note: `cacheCreationInputTokens` and `cacheReadInputTokens` are only set in the Anthropic branch. All other branches (`gemini`, `chatgpt`, OpenAI-compatible) leave them `undefined` — that is correct.

- [ ] **Step 5: Run test to confirm it passes**
  ```
  pnpm --filter web exec vitest run apps/web/lib/routing/chat-adapter.test.ts
  ```

- [ ] **Step 6: Run full routing suite to confirm no regressions**
  ```
  pnpm --filter web exec vitest run apps/web/lib/routing/
  ```

- [ ] **Step 7: Commit**
  ```
  git add apps/web/lib/routing/adapter-types.ts apps/web/lib/routing/chat-adapter.ts apps/web/lib/routing/chat-adapter.test.ts
  git commit -s -m "feat(ep-cost): extract Anthropic prompt cache token fields in chat-adapter"
  ```

---

### Task 1.2: Add `cacheCreationInputTokens` to `AdapterRunTelemetry` and wire through

**Files:**
- Modify: `packages/db/prisma/schema.prisma` — add column to `AdapterRunTelemetry`
- Create: `packages/db/prisma/migrations/<timestamp>_add_cache_creation_tokens/migration.sql`
- Modify: `apps/web/lib/routing/adapter-telemetry-writer.ts:57` — add field to `AdapterTelemetryInput`
- Modify: `apps/web/lib/routing/adapter-telemetry-writer.ts:130` — conditionally write the field
- Modify: `apps/web/lib/inference/ai-inference.ts:472–488` — pass cache fields to `writeAdapterTelemetry`
- Modify: `apps/web/lib/routing/adapter-telemetry-writer.test.ts` — add test for new field

**Context:** `AdapterRunTelemetry` already has `cachedInputTokens` (maps to `cache_read_input_tokens`). It is missing `cacheCreationInputTokens` (the write cost, charged at 1.25× input rate). Both are needed to compute true cache ROI. The `callProvider()` function in `ai-inference.ts` must pass these from the adapter result into the telemetry write.

- [ ] **Step 1: Write failing test in `adapter-telemetry-writer.test.ts`**

  Add a test confirming `cacheCreationInputTokens` is written to the DB row when provided:
  ```typescript
  it("writes cacheCreationInputTokens when provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({});
    // Assuming prisma is mocked in this test file — follow the existing mock pattern
    vi.mocked(prisma.adapterRunTelemetry.create).mockResolvedValue(mockCreate);

    await writeAdapterTelemetry({
      adapterKind: "chat",
      adapterVersion: "1",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      executionMode: "single",
      startedAt: new Date(),
      status: "success",
      cacheCreationInputTokens: 500,
      cachedInputTokens: 300,
    });

    expect(prisma.adapterRunTelemetry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cacheCreationInputTokens: 500, cachedInputTokens: 300 }),
      })
    );
  });
  ```

- [ ] **Step 2: Run test to confirm it fails**
  ```
  pnpm --filter web exec vitest run apps/web/lib/routing/adapter-telemetry-writer.test.ts
  ```

- [ ] **Step 3: Add column to schema**

  In `packages/db/prisma/schema.prisma`, locate `model AdapterRunTelemetry` (search for `cachedInputTokens`). Add after that line:
  ```
  cacheCreationInputTokens  Int?
  ```

- [ ] **Step 4: Create and apply migration**
  ```
  pnpm --filter @dpf/db exec prisma migrate dev --name add_cache_creation_tokens
  ```
  Confirm the generated SQL contains `ALTER TABLE "AdapterRunTelemetry" ADD COLUMN "cacheCreationInputTokens" INTEGER;`

- [ ] **Step 5: Add `cacheCreationInputTokens` to `AdapterTelemetryInput` type**

  In `adapter-telemetry-writer.ts:57`, after `cachedInputTokens?: number;` add:
  ```typescript
  cacheCreationInputTokens?: number;
  ```

- [ ] **Step 6: Write the field conditionally in `adapter-telemetry-writer.ts`**

  After line 130 (`if (input.cachedInputTokens ...)`), add:
  ```typescript
  if (input.cacheCreationInputTokens !== undefined) data.cacheCreationInputTokens = input.cacheCreationInputTokens;
  ```

- [ ] **Step 7: Pass cache fields from `callProvider()` into `writeAdapterTelemetry()`**

  In `apps/web/lib/inference/ai-inference.ts`, locate the success-path `writeAdapterTelemetry` call (~line 472). Add the cache fields from `result.usage`:
  ```typescript
  void writeAdapterTelemetry({
    // … existing fields …
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cachedInputTokens: result.usage.cacheReadInputTokens,         // add
    cacheCreationInputTokens: result.usage.cacheCreationInputTokens, // add
    toolCallsTotal: result.toolCalls.length,
    // … rest …
  });
  ```

- [ ] **Step 8: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/routing/adapter-telemetry-writer.test.ts
  pnpm --filter web exec vitest run apps/web/lib/routing/
  ```

- [ ] **Step 9: Commit**
  ```
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ \
    apps/web/lib/routing/adapter-telemetry-writer.ts \
    apps/web/lib/routing/adapter-telemetry-writer.test.ts \
    apps/web/lib/inference/ai-inference.ts
  git commit -s -m "feat(ep-cost): add cacheCreationInputTokens to AdapterRunTelemetry and wire from callProvider"
  ```

---

### Task 1.3: Add Prometheus cache metrics and ToolExecution cost fields

**Files:**
- Modify: `apps/web/lib/operate/metrics.ts` — add two cache counters
- Modify: `apps/web/lib/inference/ai-inference.ts` — emit cache counters after callProvider
- Modify: `packages/db/prisma/schema.prisma` — add cost fields to `ToolExecution`
- Create: migration for ToolExecution cost fields
- Modify: `apps/web/lib/routing/adapter-telemetry-writer.test.ts` — add Prometheus counter test

**Context:** Prometheus counters at `/api/metrics` let the operator verify cache is active without writing DB queries. `ToolExecution` currently has no token/cost fields, making it impossible to attribute spend to specific tool calls.

- [ ] **Step 1: Write failing test for Prometheus cache counters**

  In `adapter-telemetry-writer.test.ts` or a new `metrics.test.ts`, confirm the new counters exist with the right label set. Simplest approach: import the counter and assert it has the right name:
  ```typescript
  import { aiCacheCreationTokens, aiCacheReadTokens } from "@/lib/metrics";
  it("cache counters are registered with correct labels", () => {
    expect(aiCacheCreationTokens).toBeDefined();
    expect(aiCacheReadTokens).toBeDefined();
  });
  ```

- [ ] **Step 2: Run test to confirm it fails (import error expected)**

- [ ] **Step 3: Add counters to `metrics.ts`**

  In `apps/web/lib/operate/metrics.ts`, after the existing `aiInferenceTokens` counter, add:
  ```typescript
  export const aiCacheCreationTokens = new Counter({
    name: "dpf_ai_cache_creation_tokens_total",
    help: "Tokens written to prompt cache (charged at 1.25x input rate)",
    labelNames: ["provider", "model", "agent"] as const,
    registers: [registry],
  });

  export const aiCacheReadTokens = new Counter({
    name: "dpf_ai_cache_read_tokens_total",
    help: "Tokens read from prompt cache (charged at 0.1x input rate)",
    labelNames: ["provider", "model", "agent"] as const,
    registers: [registry],
  });
  ```

- [ ] **Step 4: Emit cache counters in `callProvider()` after token metrics (~line 466)**

  In `ai-inference.ts`, after the existing `aiInferenceTokens.inc()` calls, add:
  ```typescript
  if (result.usage.cacheCreationInputTokens) {
    aiCacheCreationTokens.inc(
      { provider: providerId, model: modelId, agent: attribution?.agentId ?? "unknown" },
      result.usage.cacheCreationInputTokens
    );
  }
  if (result.usage.cacheReadInputTokens) {
    aiCacheReadTokens.inc(
      { provider: providerId, model: modelId, agent: attribution?.agentId ?? "unknown" },
      result.usage.cacheReadInputTokens
    );
  }
  ```
  Import the new counters at the top of the file alongside the existing metric imports.

- [ ] **Step 5: Add cost fields to `ToolExecution` in schema**

  Locate `model ToolExecution` in `schema.prisma`. Add three nullable fields (after `durationMs`):
  ```
  inferenceInputTokens   Int?
  inferenceOutputTokens  Int?
  inferenceCostUsd       Float?
  ```
  (Using `inference` prefix to avoid collision with tool result content.)

- [ ] **Step 6: Create and apply migration**
  ```
  pnpm --filter @dpf/db exec prisma migrate dev --name add_tool_execution_cost_fields
  ```

- [ ] **Step 7: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/
  ```

- [ ] **Step 8: Run typecheck**
  ```
  pnpm --filter web typecheck
  ```

- [ ] **Step 9: Functional verification (MANDATORY before Phase 2)**

  Start the app (`docker compose up -d portal portal-init`) and make one coworker turn that routes to an Anthropic-backed agent. Then query the DB:
  ```sql
  SELECT "cachedInputTokens", "cacheCreationInputTokens", "inputTokens", "outputTokens"
  FROM "AdapterRunTelemetry"
  ORDER BY "startedAt" DESC
  LIMIT 5;
  ```
  At least one row must have non-null `cacheCreationInputTokens` OR `cachedInputTokens`. If both are null after a real Anthropic call, investigate before proceeding — the extraction is not wired correctly.

- [ ] **Step 10: Commit**
  ```
  git add apps/web/lib/operate/metrics.ts apps/web/lib/inference/ai-inference.ts \
    packages/db/prisma/schema.prisma packages/db/prisma/migrations/
  git commit -s -m "feat(ep-cost): add Prometheus cache counters and ToolExecution cost fields"
  ```

---

### Task 1.4: Add `AgentBudgetEvent` table (prerequisite for Phase 2 budget gate)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` — add `AgentBudgetEvent` model
- Create: migration

**Context:** The Phase 2 budget gate writes events when agents approach or hit their token limits. Creating the table in Phase 1 means Phase 2 has no schema work — only logic.

- [ ] **Step 1: Add model to `schema.prisma`**

  Add after `AdapterRunTelemetry`:
  ```prisma
  model AgentBudgetEvent {
    id            String   @id @default(cuid())
    agentId       String
    providerId    String
    eventType     String   // "warning_80" | "warning_95" | "downgrade" | "rejected"
    limitType     String   // "daily" | "per_task"
    actualTokens  Int
    limitTokens   Int
    buildRunId    String?
    createdAt     DateTime @default(now())

    @@index([agentId, createdAt])
    @@index([buildRunId])
  }
  ```

- [ ] **Step 2: Create and apply migration**
  ```
  pnpm --filter @dpf/db exec prisma migrate dev --name add_agent_budget_event
  ```

- [ ] **Step 3: Commit**
  ```
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
  git commit -s -m "feat(ep-cost): add AgentBudgetEvent table for Phase 2 budget gate"
  ```

---

## Phase 2 — Budget Gate + Model Tier Ladder

> **Goal:** Agent token budgets defined in `agent_registry.json` are enforced at runtime. Right-sized models replace blanket Opus/Sonnet usage for routine tasks.

**Prerequisites:** Phase 1 complete. `AgentBudgetEvent` table exists. `ModelProfile.costTier` already carries tier values (confirmed in schema at line 1434) — no new tier table needed.

---

### Task 2.1: Add `preferredCostTier` to agent config and resolve model at dispatch time

**Files:**
- Modify: `packages/db/data/agent_registry.json` — add `preferredCostTier` to each agent
- Modify: `apps/web/lib/routing/` — wherever agent config is read before `callProvider()` dispatch
- Modify: relevant test file (search for where `agent_registry.json` is loaded in tests)

**Context:** `ModelProfile.costTier` is the tier of a model. Agents need a `preferredCostTier` that says "give me any model at this tier from the current provider". The routing layer then selects the cheapest model with `costTier = preferredCostTier` rather than using a hardcoded `model_id`.

- [ ] **Step 1: Define the three tiers**

  The existing `ModelProfile.costTier` values in the seed data must be audited. Run:
  ```sql
  SELECT DISTINCT "costTier" FROM "ModelProfile" ORDER BY "costTier";
  ```
  Map existing values to the spec's three tiers: `critical`, `standard`, `routine`. If the DB uses different strings (e.g., `"frontier"`, `"strong"`, `"adequate"`), use those strings consistently — do NOT introduce a new vocabulary without migrating existing data.

- [ ] **Step 2: Update `agent_registry.json`**

  For each agent, add `"preferredCostTier": "<tier>"` to its `config_profile` object. Apply the following mapping:
  - Orchestrators doing **routing, dispatch, status summaries** → `"routine"`
  - Specialists doing **implement, test, review** → `"standard"`
  - Agents doing **creative ideation, security analysis, architecture** → `"critical"`
  - Agents with explicit `model_id_override` → keep their override; add `"preferredCostTier": null`

  There are 63 agents. Batch-edit by tier: grep for `"tier": "orchestrator"` to find orchestrators, then assess function from the `capability_domain` field.

- [ ] **Step 3: Write a failing test for cost-tier model resolution**

  In the relevant routing test file (check `apps/web/lib/routing/loader.test.ts` or `pipeline-v2.test.ts`):
  ```typescript
  it("resolves routine-tier agent to cheapest routine model from provider", async () => {
    // Setup: a ModelProfile with costTier="routine" and one with costTier="standard"
    // Assert: when an agent has preferredCostTier="routine", the dispatched modelId
    //   comes from the routine-tier profile, not the standard one
  });
  ```

- [ ] **Step 4: Implement cost-tier resolution in the routing layer**

  Find where `model_id` is resolved for an agent before `callProvider()`. Extend to:
  1. Read `preferredCostTier` from agent config
  2. If set and no `model_id_override`, query `ModelProfile WHERE providerId = ? AND costTier = ? ORDER BY /* cheapest first */` and use the first result's `modelId`
  3. Log the resolved model + tier to the telemetry `overrideReason` field (e.g., `"tier:routine→claude-haiku-4-5-20251001"`)

- [ ] **Step 5: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/routing/
  ```

- [ ] **Step 6: Commit**
  ```
  git add packages/db/data/agent_registry.json apps/web/lib/routing/
  git commit -s -m "feat(ep-cost): add preferredCostTier to agents; resolve model from ModelProfile at dispatch"
  ```

---

### Task 2.2: Implement pre-call budget gate in `callProvider()`

**Files:**
- Modify: `apps/web/lib/inference/ai-inference.ts` — add budget check before adapter dispatch
- Create: `apps/web/lib/inference/budget-gate.ts` — isolated budget logic (testable)
- Create: `apps/web/lib/inference/budget-gate.test.ts`

**Context:** `logTokenUsage()` already writes to the `TokenUsage` table with `agentId`. The budget gate reads today's total from `TokenUsage` and compares against the agent's `token_budget.daily_limit`. Events are written to `AgentBudgetEvent`. At >100% usage, `callProvider()` throws `InferenceError` with code `"billing"`.

- [ ] **Step 1: Write failing tests in `budget-gate.test.ts`**

  ```typescript
  describe("checkBudget", () => {
    it("returns 'ok' when below 80% of daily limit", async () => { ... });
    it("returns 'warning_80' when between 80-95% of daily limit", async () => { ... });
    it("returns 'warning_95' when between 95-100% of daily limit", async () => { ... });
    it("returns 'rejected' when over 100% of daily limit", async () => { ... });
  });
  ```

  Mock `prisma.tokenUsage.aggregate` to control the actual token counts.

- [ ] **Step 2: Run tests to confirm they fail**
  ```
  pnpm --filter web exec vitest run apps/web/lib/inference/budget-gate.test.ts
  ```

- [ ] **Step 3: Implement `budget-gate.ts`**

  ```typescript
  // apps/web/lib/inference/budget-gate.ts

  import { prisma } from "@dpf/db";

  export type BudgetStatus = "ok" | "warning_80" | "warning_95" | "downgrade" | "rejected";

  export async function checkAgentBudget(
    agentId: string,
    dailyLimit: number,
  ): Promise<{ status: BudgetStatus; actualTokens: number; limitTokens: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const agg = await prisma.tokenUsage.aggregate({
      where: { agentId, createdAt: { gte: today } },
      _sum: { inputTokens: true, outputTokens: true },
    });

    const actualTokens =
      (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
    const ratio = actualTokens / dailyLimit;

    let status: BudgetStatus = "ok";
    if (ratio >= 1.0) status = "rejected";
    else if (ratio >= 0.95) status = "downgrade"; // model downgrade kicks in at 95%
    else if (ratio >= 0.80) status = "warning_80";

    return { status, actualTokens, limitTokens: dailyLimit };
  }

  export async function writeBudgetEvent(input: {
    agentId: string;
    providerId: string;
    eventType: string;
    limitType: "daily" | "per_task";
    actualTokens: number;
    limitTokens: number;
    buildRunId?: string;
  }): Promise<void> {
    await prisma.agentBudgetEvent.create({ data: input });
  }
  ```

- [ ] **Step 4: Wire gate into `callProvider()` in `ai-inference.ts`**

  At the top of `callProvider()`, after resolving `agentId` from attribution, before dispatching:
  ```typescript
  if (attribution?.agentId && agentDailyLimit > 0) {
    const budget = await checkAgentBudget(attribution.agentId, agentDailyLimit);
    if (budget.status === "rejected") {
      void writeBudgetEvent({ agentId: attribution.agentId, providerId, eventType: "rejected", limitType: "daily", ...budget });
      aiModelDowngradeTotal.inc({ agent: attribution.agentId, from_model: modelId, to_model: "none" });
      throw new InferenceError("Agent daily token budget exceeded", "billing", providerId);
    }
    if (budget.status === "downgrade") {
      // Resolve the routine-tier model for the current provider and swap it in
      const routineModel = await resolveModelForTier(providerId, "routine");
      if (routineModel && routineModel !== modelId) {
        aiModelDowngradeTotal.inc({ agent: attribution.agentId, from_model: modelId, to_model: routineModel });
        modelId = routineModel; // override for this call only
      }
      void writeBudgetEvent({ agentId: attribution.agentId, providerId, eventType: "downgrade", limitType: "daily", ...budget });
    }
    if (budget.status === "warning_80") {
      void writeBudgetEvent({ agentId: attribution.agentId, providerId, eventType: "warning_80", limitType: "daily", ...budget });
    }
  }
  ```

  `agentDailyLimit` must be read from the agent's registry config. Add a helper `getAgentDailyLimit(agentId): Promise<number>` that queries the agent config from the DB (the registry is seeded to DB — find the right table via `grep -r "daily_limit" packages/db/`).

- [ ] **Step 5: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/inference/
  pnpm --filter web exec vitest run apps/web/lib/routing/
  ```

- [ ] **Step 6: Run typecheck**
  ```
  pnpm --filter web typecheck
  ```

- [ ] **Step 7: Add three Prometheus metrics required by spec**

  In `apps/web/lib/operate/metrics.ts`, add:
  ```typescript
  export const aiBudgetEventsTotal = new Counter({
    name: "dpf_ai_budget_events_total",
    help: "Agent budget threshold events",
    labelNames: ["agent", "event_type", "limit_type"] as const,
    registers: [registry],
  });

  export const aiModelDowngradeTotal = new Counter({
    name: "dpf_ai_model_downgrade_total",
    help: "Model downgrades triggered by budget pressure",
    labelNames: ["agent", "from_model", "to_model"] as const,
    registers: [registry],
  });
  ```
  Import `aiModelDowngradeTotal` in `ai-inference.ts` and emit it on the downgrade path (already wired in Step 4's code snippet). Emit `aiBudgetEventsTotal` inside `writeBudgetEvent()` in `budget-gate.ts`.

- [ ] **Step 8: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/inference/
  pnpm --filter web exec vitest run apps/web/lib/routing/
  ```

- [ ] **Step 9: Run typecheck**
  ```
  pnpm --filter web typecheck
  ```

- [ ] **Step 10: Commit**
  ```
  git add apps/web/lib/inference/budget-gate.ts apps/web/lib/inference/budget-gate.test.ts \
    apps/web/lib/inference/ai-inference.ts apps/web/lib/operate/metrics.ts
  git commit -s -m "feat(ep-cost): budget gate with 95% model downgrade, 80% warning, 100% rejection + Prometheus metrics"
  ```

---

### Task 2.3: Surface budget events in `/platform/ai/authority`

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/authority/page.tsx` (or its data fetcher)
- Modify: relevant API route if the authority page fetches via API

**Context:** Budget events are written to `AgentBudgetEvent`. The authority page at `/platform/ai/authority` already shows `ToolExecution` rows. Add a "Budget Alerts" section showing recent `AgentBudgetEvent` rows (agentId, eventType, actualTokens, limitTokens, createdAt).

- [ ] **Step 1: Locate the authority page data fetch**
  ```
  grep -rn "AgentBudgetEvent\|agentBudgetEvent" apps/web/app/
  ```
  If none found, the data fetch needs to be added.

- [ ] **Step 2: Add DB query for recent budget events**

  Add to the page's data fetch:
  ```typescript
  const budgetEvents = await prisma.agentBudgetEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  ```

- [ ] **Step 3: Render budget events table**

  Add a "Budget Alerts" card using the platform's standard table pattern (follow the existing ToolExecution table structure in the same file). Columns: Agent, Event Type, Actual Tokens, Limit, % Used, Timestamp.

- [ ] **Step 4: Manual UX verification**

  Navigate to `/platform/ai/authority`. Trigger a coworker turn to generate a `TokenUsage` row. Confirm the Budget Alerts section renders (may be empty — that is correct if no thresholds have been crossed).

- [ ] **Step 5: Commit**
  ```
  git add apps/web/app/
  git commit -s -m "feat(ep-cost): surface AgentBudgetEvent rows in /platform/ai/authority"
  ```

---

## Phase 3 — Context Compaction

> **Goal:** Build Studio phase handoffs no longer accumulate the full prior conversation. Coworker threads stay bounded regardless of length.

---

### Task 3.1: Rolling coworker thread compaction

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts` — add rolling compaction before message assembly
- Create: `apps/web/lib/actions/thread-compaction.ts` — isolated compaction logic
- Create: `apps/web/lib/actions/thread-compaction.test.ts`

**Context:** Coworker threads accumulate indefinitely. Per the spec: whenever the assembled message list exceeds 20 turns, summarize the oldest 10 into a summary message. This fires again at 30, 40, etc. — it is a rolling trigger, not a one-time trigger.

The summary call uses the `routine` cost tier model to minimize spend on the compaction step itself.

**Before implementing:** grep `agent-coworker.ts` for the role values used when injecting context messages (e.g., page data, wiki context). Use the same role convention for the summary message. A wrong role string (`"summary"` is not a valid ChatMessage role) will cause the provider call to fail. The safe fallback is `role: "system"` with a `[SUMMARY]` prefix in the content string.

- [ ] **Step 1: Write failing tests in `thread-compaction.test.ts`**

  ```typescript
  describe("shouldCompact", () => {
    it("returns false when message count <= 20", () => { ... });
    it("returns true when message count > 20", () => { ... });
  });

  describe("compactOldest", () => {
    it("returns a summary message covering the oldest 10 turns", async () => { ... });
    it("leaves the remaining messages unchanged", async () => { ... });
    it("fires again at 30 turns after a previous compaction at 21", async () => { ... });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

- [ ] **Step 3: Implement `thread-compaction.ts`**

  ```typescript
  // apps/web/lib/actions/thread-compaction.ts

  import type { ChatMessage } from "@/lib/ai-inference";
  import { callProvider } from "@/lib/inference/ai-inference";

  const COMPACTION_THRESHOLD = 20;
  const COMPACTION_BATCH = 10;

  export function shouldCompact(messages: ChatMessage[]): boolean {
    return messages.length > COMPACTION_THRESHOLD;
  }

  /** Rolling compaction: summarizes oldest COMPACTION_BATCH messages.
   *  Caller should loop until shouldCompact() returns false. */
  export async function compactOldest(
    messages: ChatMessage[],
    providerId: string,
    modelId: string, // must be a routine-tier model
  ): Promise<ChatMessage[]> {
    const toCompact = messages.slice(0, COMPACTION_BATCH);
    const rest = messages.slice(COMPACTION_BATCH);

    const summaryPrompt: ChatMessage[] = [
      {
        role: "user",
        content: `Summarize the following conversation excerpt in 2-3 sentences, preserving all decisions, action outcomes, and key facts. Omit pleasantries.\n\n${JSON.stringify(toCompact)}`,
      },
    ];

    const result = await callProvider({
      messages: summaryPrompt,
      providerId,
      modelId,
      // no tools, no system prompt — pure summarization
    });

    const summaryMessage: ChatMessage = {
      role: "system", // or "user" with a [SUMMARY] prefix — follow existing thread conventions
      content: `[Thread summary — ${toCompact.length} earlier turns]: ${result.content}`,
    };

    return [summaryMessage, ...rest];
  }
  ```

- [ ] **Step 4: Wire rolling compaction into `agent-coworker.ts`**

  Before the message list is assembled for the inference call, add:
  ```typescript
  let messages = assembledMessages; // existing assembly
  while (shouldCompact(messages)) {
    messages = await compactOldest(messages, routineProviderId, routineModelId);
  }
  ```
  `routineProviderId` and `routineModelId` are resolved from the `routine` cost tier using the same resolver added in Task 2.1.

- [ ] **Step 5: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/actions/thread-compaction.test.ts
  ```

- [ ] **Step 6: Manual UX verification**

  Create a coworker thread, send 25+ messages, confirm responses remain coherent and no DB errors appear. Confirm a `[Thread summary]` system message appears in the thread history.

- [ ] **Step 7: Commit**
  ```
  git add apps/web/lib/actions/thread-compaction.ts apps/web/lib/actions/thread-compaction.test.ts \
    apps/web/lib/actions/agent-coworker.ts
  git commit -s -m "feat(ep-cost): rolling coworker thread compaction at 20-turn threshold"
  ```

---

### Task 3.2: Build Studio phase-boundary summarization

**Files:**
- Modify: `apps/web/lib/integrate/build-orchestrator.ts` — add `compactPhase()` between specialist dispatches
- Create: `apps/web/lib/integrate/phase-compaction.ts`
- Create: `apps/web/lib/integrate/phase-compaction.test.ts`
- Modify: `packages/db/prisma/schema.prisma` — add `BuildPhaseRun` model
- Create: migration for `BuildPhaseRun`

**Context:** Build Studio phases (Ideate → Design → Implement → Review → Ship) run sequentially in `build-orchestrator.ts`. Each specialist receives the full prior thread. After each phase completes, a compaction step summarizes that phase's output before the next specialist sees it.

No `BuildPhaseRun` or `BuildRun` table currently exists in `schema.prisma` (confirmed).

- [ ] **Step 1: Add `BuildPhaseRun` model to schema**

  ```prisma
  model BuildPhaseRun {
    id               String   @id @default(cuid())
    buildId          String
    phase            String   // "ideate" | "design" | "implement" | "review" | "ship"
    agentIds         String[]
    inputTokens      Int      @default(0)
    outputTokens     Int      @default(0)
    cacheReadTokens  Int      @default(0)
    costUsd          Float    @default(0)
    startedAt        DateTime @default(now())
    finishedAt       DateTime?

    @@index([buildId, phase])
  }
  ```

- [ ] **Step 2: Create and apply migration**
  ```
  pnpm --filter @dpf/db exec prisma migrate dev --name add_build_phase_run
  ```

- [ ] **Step 3: Write failing test in `phase-compaction.test.ts`**

  ```typescript
  it("compactPhase returns a summary string under 400 tokens", async () => {
    // Mock callProvider to return a short summary
    // Assert the returned summary is a string with the phase name embedded
  });
  ```

- [ ] **Step 4: Implement `phase-compaction.ts`**

  ```typescript
  // apps/web/lib/integrate/phase-compaction.ts

  import type { ChatMessage } from "@/lib/ai-inference";
  import { callProvider } from "@/lib/inference/ai-inference";

  export async function compactPhase(
    phase: string,
    phaseMessages: ChatMessage[],
    providerId: string,
    modelId: string, // routine tier
  ): Promise<ChatMessage> {
    const prompt: ChatMessage[] = [{
      role: "user",
      content: `You are a build phase summarizer. Summarize the ${phase} phase output in 3-5 bullet points. Include: decisions made, artifacts produced, open questions, and anything the next phase must know. Be concrete — no filler.\n\nPhase transcript:\n${JSON.stringify(phaseMessages)}`,
    }];

    const result = await callProvider({ messages: prompt, providerId, modelId });

    return {
      role: "system",
      content: `[${phase.toUpperCase()} PHASE COMPLETE]\n${result.content}`,
    };
  }
  ```

- [ ] **Step 5: Add `compactPhase()` call in `build-orchestrator.ts`**

  After each specialist phase completes and before the next is dispatched, call `compactPhase()` and replace the phase's messages in the working thread with the summary. Record the phase token counts in a new `BuildPhaseRun` row.

- [ ] **Step 6: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/integrate/phase-compaction.test.ts
  pnpm --filter web exec vitest run apps/web/lib/integrate/
  ```

- [ ] **Step 7: Add `dpf_build_phase_cost_usd_total` Prometheus counter**

  In `apps/web/lib/operate/metrics.ts`, add:
  ```typescript
  export const buildPhaseCostUsd = new Counter({
    name: "dpf_build_phase_cost_usd_total",
    help: "Estimated USD cost per Build Studio phase",
    labelNames: ["phase", "agent"] as const,
    registers: [registry],
  });
  ```
  Emit it inside `build-orchestrator.ts` when writing the `BuildPhaseRun` row, using the phase's aggregated `costUsd`.

- [ ] **Step 8: Commit**
  ```
  git add apps/web/lib/integrate/phase-compaction.ts apps/web/lib/integrate/phase-compaction.test.ts \
    apps/web/lib/integrate/build-orchestrator.ts \
    apps/web/lib/operate/metrics.ts \
    packages/db/prisma/schema.prisma packages/db/prisma/migrations/
  git commit -s -m "feat(ep-cost): Build Studio phase-boundary compaction + BuildPhaseRun cost tracking + phase cost metric"
  ```

---

### Task 3.3: Tool result trimming utility

**Files:**
- Create: `apps/web/lib/routing/tool-result-trimmer.ts`
- Create: `apps/web/lib/routing/tool-result-trimmer.test.ts`
- Modify: highest-volume tool execution paths (identify via `ToolExecution` query after Phase 1 lands)

**Context:** Tool calls often return large JSON payloads. The spec calls for trimming to 2,000 tokens by default, keeping the most relevant fields. This is implemented as a pure utility that can be applied per-tool.

- [ ] **Step 1: Write failing tests**

  ```typescript
  describe("trimToolResult", () => {
    it("returns unchanged result when under token limit", () => { ... });
    it("truncates array results to maxItems when token estimate exceeds limit", () => { ... });
    it("strips audit metadata fields from result objects", () => { ... });
    it("returns a trimmedTokens count in the metadata", () => { ... });
  });
  ```

- [ ] **Step 2: Implement `tool-result-trimmer.ts`**

  ```typescript
  // apps/web/lib/routing/tool-result-trimmer.ts

  const METADATA_FIELDS_TO_STRIP = ["createdAt", "updatedAt", "auditLog", "internalId"];
  const DEFAULT_MAX_TOKENS = 2000;
  const CHARS_PER_TOKEN = 4; // conservative approximation

  export type TrimResult = {
    result: unknown;
    trimmedTokens: number;
    wasTrimmed: boolean;
  };

  export function trimToolResult(
    result: unknown,
    maxTokens = DEFAULT_MAX_TOKENS,
  ): TrimResult {
    const raw = JSON.stringify(result);
    const rawTokens = Math.ceil(raw.length / CHARS_PER_TOKEN);

    if (rawTokens <= maxTokens) {
      return { result, trimmedTokens: 0, wasTrimmed: false };
    }

    let trimmed = deepStripFields(result, METADATA_FIELDS_TO_STRIP);

    // If it's an array, truncate to fit
    if (Array.isArray(trimmed)) {
      while (trimmed.length > 0) {
        const candidate = JSON.stringify(trimmed);
        if (Math.ceil(candidate.length / CHARS_PER_TOKEN) <= maxTokens) break;
        trimmed = trimmed.slice(0, Math.floor(trimmed.length * 0.8));
      }
    }

    const trimmedRaw = JSON.stringify(trimmed);
    const trimmedTokens = rawTokens - Math.ceil(trimmedRaw.length / CHARS_PER_TOKEN);
    return { result: trimmed, trimmedTokens, wasTrimmed: true };
  }

  function deepStripFields(obj: unknown, fields: string[]): unknown {
    if (Array.isArray(obj)) return obj.map((item) => deepStripFields(item, fields));
    if (obj && typeof obj === "object") {
      return Object.fromEntries(
        Object.entries(obj as Record<string, unknown>)
          .filter(([k]) => !fields.includes(k))
          .map(([k, v]) => [k, deepStripFields(v, fields)])
      );
    }
    return obj;
  }
  ```

- [ ] **Step 3: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/routing/tool-result-trimmer.test.ts
  ```

- [ ] **Step 4: Wire into highest-volume tool paths**

  After Phase 1 lands, query:
  ```sql
  SELECT "toolName", COUNT(*) as calls, AVG("durationMs") as avg_ms
  FROM "ToolExecution"
  GROUP BY "toolName"
  ORDER BY calls DESC
  LIMIT 10;
  ```
  Apply `trimToolResult()` to the top 3 highest-volume tools that return large payloads.

- [ ] **Step 5: Commit**
  ```
  git add apps/web/lib/routing/tool-result-trimmer.ts apps/web/lib/routing/tool-result-trimmer.test.ts
  git commit -s -m "feat(ep-cost): add trimToolResult utility; apply to high-volume tool paths"
  ```

---

## Phase 4 — CLI Pool Visibility

> **Goal:** CLI rate-limit exhaustion is surfaced before it stalls a Build Studio run. Pool status is visible in Admin > AI Providers.

---

### Task 4.1: Add `CliPoolStatus` table and wire from 429 responses

**Files:**
- Modify: `packages/db/prisma/schema.prisma` — add `CliPoolStatus` model
- Create: migration
- Modify: `apps/web/lib/routing/cli-adapter.ts` — write to `CliPoolStatus` on 429
- Modify: `apps/web/lib/routing/codex-cli-adapter.ts` — same
- Modify: relevant test files

**Context:** When the Claude Code CLI or Codex CLI returns a 429, the `Retry-After` or `X-RateLimit-Reset` header tells us when the window resets. Writing this to `CliPoolStatus` lets the orchestrator check pool health before dispatching CLI-backed tasks.

- [ ] **Step 1: Add `CliPoolStatus` model to schema**

  ```prisma
  model CliPoolStatus {
    id            String   @id @default(cuid())
    adapterKind   String   // "claude-cli" | "codex-cli"
    status        String   // "available" | "exhausted"
    exhaustedAt   DateTime?
    resetsAt      DateTime?
    lastCheckedAt DateTime @updatedAt

    @@unique([adapterKind])
  }
  ```

- [ ] **Step 2: Create and apply migration**
  ```
  pnpm --filter @dpf/db exec prisma migrate dev --name add_cli_pool_status
  ```

- [ ] **Step 3: Write failing test for 429 handler in `cli-adapter.test.ts`**

  Add a test confirming that when the CLI adapter receives a 429, it upserts a `CliPoolStatus` row:
  ```typescript
  it("writes CliPoolStatus exhausted row on 429", async () => {
    // Mock the CLI to return exit code 1 with a rate-limit message
    // Assert prisma.cliPoolStatus.upsert was called with status: "exhausted"
  });
  ```

- [ ] **Step 4: Implement `CliPoolStatus` write in both adapters**

  In both `cli-adapter.ts` and `codex-cli-adapter.ts`, in the error handling path for rate-limit errors, add:
  ```typescript
  void prisma.cliPoolStatus.upsert({
    where: { adapterKind: "claude-cli" }, // or "codex-cli"
    create: {
      adapterKind: "claude-cli",
      status: "exhausted",
      exhaustedAt: new Date(),
      resetsAt: parseRetryAfter(errorHeaders),
    },
    update: {
      status: "exhausted",
      exhaustedAt: new Date(),
      resetsAt: parseRetryAfter(errorHeaders),
    },
  });
  ```

  `parseRetryAfter()` reads the `Retry-After` header (seconds offset) or `X-RateLimit-Reset` header (Unix timestamp) and returns a `Date`.

- [ ] **Step 5: Implement pool availability check in `build-orchestrator.ts`**

  Before dispatching any CLI-backed task:
  ```typescript
  const poolStatus = await prisma.cliPoolStatus.findUnique({
    where: { adapterKind: "claude-cli" },
  });
  if (poolStatus?.status === "exhausted" && poolStatus.resetsAt && poolStatus.resetsAt > new Date()) {
    // Route to API adapter instead, or wait and retry
    log.warn(`CLI pool exhausted until ${poolStatus.resetsAt.toISOString()}, rerouting to API adapter`);
    // … fallback logic …
  }
  ```

- [ ] **Step 6: Expose pool status in Admin > AI Providers**

  Add a "CLI Pool Status" section to the providers page. Show: adapter kind, current status, exhausted at, resets at. A green/red indicator is enough — no chart needed.

- [ ] **Step 7: Run tests**
  ```
  pnpm --filter web exec vitest run apps/web/lib/routing/cli-adapter.test.ts
  pnpm --filter web exec vitest run apps/web/lib/routing/codex-cli-adapter.test.ts
  ```

- [ ] **Step 8: Manual UX verification**

  Navigate to Admin > AI Providers and confirm the CLI Pool Status section renders. Manually upsert a test row via the DB if needed to verify the display:
  ```sql
  INSERT INTO "CliPoolStatus" ("id", "adapterKind", "status", "exhaustedAt", "resetsAt", "lastCheckedAt")
  VALUES (gen_random_uuid(), 'claude-cli', 'exhausted', now(), now() + interval '1 hour', now());
  ```

- [ ] **Step 9: Commit**
  ```
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ \
    apps/web/lib/routing/cli-adapter.ts apps/web/lib/routing/codex-cli-adapter.ts \
    apps/web/app/
  git commit -s -m "feat(ep-cost): CliPoolStatus table; capture 429 from CLI adapters; surface in Admin"
  ```

---

## Final Verification

After all phases are complete:

- [ ] Run full test suite:
  ```
  pnpm --filter web exec vitest run
  ```

- [ ] Run production build:
  ```
  cd apps/web && npx next build
  ```

- [ ] UX smoke test:
  1. Make a coworker turn on an Anthropic-backed agent → verify `AdapterRunTelemetry` has non-null cache fields
  2. Navigate to `/platform/ai/authority` → verify Budget Alerts section renders
  3. Send 25+ messages in a coworker thread → verify `[Thread summary]` appears in thread
  4. Navigate to Admin > AI Providers → verify CLI Pool Status section renders
  5. Run a Build Studio cycle → verify `BuildPhaseRun` rows are created in DB

- [ ] Open PR targeting `main`, title: `feat: AI cost governance — observability, model tiering, context compaction, CLI pool visibility`

---

## Success Metrics (verify post-ship)

After 48 hours of production traffic:

```sql
-- Cache hit rate (should be >0 if Anthropic caching is active)
SELECT
  COUNT(*) FILTER (WHERE "cachedInputTokens" > 0)::float / COUNT(*) AS cache_hit_rate,
  AVG("cachedInputTokens") AS avg_cache_read_tokens,
  AVG("cacheCreationInputTokens") AS avg_cache_write_tokens
FROM "AdapterRunTelemetry"
WHERE "providerId" = 'anthropic'
  AND "startedAt" > now() - interval '48 hours';

-- Model tier distribution (should show routine tier appearing)
SELECT "modelId", COUNT(*) as calls
FROM "AdapterRunTelemetry"
WHERE "startedAt" > now() - interval '48 hours'
GROUP BY "modelId"
ORDER BY calls DESC;

-- Budget events (should be 0 unless a runaway agent hit limits)
SELECT "eventType", COUNT(*) FROM "AgentBudgetEvent"
WHERE "createdAt" > now() - interval '48 hours'
GROUP BY "eventType";
```
