# Coworker Active Capability Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent tool-calling coworkers from being routed to capability-deficient models by enforcing a per-agent minimum capability floor in the routing pipeline.
**Architecture:** Add `minimumCapabilities` and `minimumContextTokens` to `AgentModelConfig`; read in `agentic-loop.ts` and inject into `RequestContract`; enforce as a hard exclusion in `getExclusionReasonV2` before graceful tool-stripping; extend `NoEligibleEndpointsError` to surface the missing capability. All existing coworkers default to `{ toolUse: true }` via migration backfill.
**Tech Stack:** Prisma 7.x, TypeScript, Next.js 16, pnpm workspaces. Run `pnpm --filter @dpf/db exec prisma` — never `npx prisma`.

**Spec:** `docs/superpowers/specs/2026-04-13-coworker-active-capability-enforcement.md`
**Epic:** EP-AGENT-CAP-002

---

## Context for Implementers

### The Problem

The COO / AI Ops Engineer coworkers show "limited mode" because they get routed to `chatgpt/gpt-5.4`, which strips custom function tools. The routing pipeline detects this, retries without tools, and the coworker operates in a degraded read-only state. This is silent — no error, no admin alert.

Root cause: `AgentModelConfig` has no concept of minimum capability. The router doesn't know that the COO *must* have tool use — it just picks the best-scoring model in the quality tier.

### The Fix

Add a `minimumCapabilities` floor to `AgentModelConfig`. The router will reject any endpoint that doesn't satisfy the floor before attempting graceful degradation. All currently seeded coworkers get `{ toolUse: true }` as their default floor.

### Key Files

| File | Role |
|---|---|
| `packages/db/prisma/schema.prisma` | Prisma schema — `AgentModelConfig` model |
| `packages/db/src/seed.ts` | Seeds `AgentModelConfig` rows with defaults |
| `apps/web/lib/routing/types.ts` | `EndpointManifest` interface — add promoted modality fields |
| `apps/web/lib/routing/loader.ts` | Populates `EndpointManifest` — add promoted field values |
| `apps/web/lib/routing/request-contract.ts` | `RequestContract` interface — add capability floor fields |
| `apps/web/lib/routing/pipeline-v2.ts` | `getExclusionReasonV2()` — add capability floor check here |
| `apps/web/lib/inference/routed-inference.ts` | `RouteAndCallOptions`, `NoEligibleEndpointsError`, degradation gate |
| `apps/web/lib/tak/agentic-loop.ts` | Reads `AgentModelConfig`, builds `routeOptions` |
| `apps/web/app/(shell)/platform/ai/assignments/page.tsx` | Admin assignments page |
| `apps/web/components/platform/AgentModelAssignmentTable.tsx` | Assignment table component |

### Routing Flow (after this change)

```
agentic-loop.ts:
  reads agentModelConfig.minimumCapabilities (default: { toolUse: true })
  → adds minimumCapabilities + minimumContextTokens to routeOptions

routeAndCall() in routed-inference.ts:
  → builds RequestContract via inferContract()
  → injects minimumCapabilities + minimumContextTokens into contract (post-build)

pipeline-v2.ts getExclusionReasonV2():
  [NEW] if contract.minimumCapabilities → check each required cap against endpoint
    → return exclusion reason if any cap missing
  [NEW] if contract.minimumContextTokens → check ep.maxContextTokens
  [then existing checks: status, sensitivity, tool use, etc.]

routed-inference.ts degradation gate:
  [NEW] if no endpoint + agentRequiresTool → throw NoEligibleEndpointsError
     (replaces silent degradation)
```

### Migration Timestamp

Use `20260413100000`. The prior migration is `20260413000000_model_capability_lifecycle`.

---

## Phase 1: Schema + Seed (no behavior change)

### Task 1: Schema migration — add capability floor to AgentModelConfig

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (find `AgentModelConfig` model, around line 4854)
- Create: `packages/db/prisma/migrations/20260413100000_ep_agent_cap_002/migration.sql`

- [ ] **Step 1: Add fields to schema**

  Open `packages/db/prisma/schema.prisma`. Find the `AgentModelConfig` model and add two new optional fields after `budgetClass`:

  ```prisma
  model AgentModelConfig {
    agentId          String    @id
    minimumTier      String    @default("adequate")
    pinnedProviderId String?
    pinnedModelId    String?
    budgetClass      String    @default("balanced")
    // EP-AGENT-CAP-002: Hard capability floor — model must satisfy ALL declared capabilities.
    // Null = system default { "toolUse": true }.
    // {} = passive agent (no capability floor — rare, must be explicit).
    minimumCapabilities  Json?
    // EP-AGENT-CAP-002: Minimum context window tokens for RAG/knowledge retrieval.
    // Null = system default 16000.
    minimumContextTokens Int?
    configuredAt     DateTime  @default(now())
    configuredById   String?
    configuredBy     User?     @relation("AgentModelConfiguredBy", fields: [configuredById], references: [id])
  }
  ```

- [ ] **Step 2: Generate the migration normally**

  With the Docker stack running (postgres container must be up), generate the migration:

  ```bash
  docker exec portal sh -c "cd /app && pnpm --filter @dpf/db exec prisma migrate dev --name ep_agent_cap_002"
  ```

  Expected output: `✔ Generated Prisma Client` and a new migration file at `packages/db/prisma/migrations/<timestamp>_ep_agent_cap_002/migration.sql`. Prisma picks the timestamp automatically — **do not rename the directory**.

  > If `migrate dev` fails because the portal container doesn't have a direct DB connection configured, run from the host instead (requires `DATABASE_URL` set in your local env):
  > ```bash
  > pnpm --filter @dpf/db exec prisma migrate dev --name ep_agent_cap_002
  > ```

- [ ] **Step 3: Add backfill SQL to the generated migration file**

  Open the generated `migration.sql` (the file Prisma just created). It will contain the `ALTER TABLE` DDL. Append the backfill statement at the end:

  ```sql
  -- EP-AGENT-CAP-002: Backfill all existing coworker rows with the standard tool-use floor.
  -- All currently seeded agents have tool_grants assigned; toolUse: true is correct for all.
  -- Rows set to '{}' are explicit passive agents (rare, must be a deliberate admin choice).
  UPDATE "AgentModelConfig"
  SET "minimumCapabilities" = '{"toolUse": true}'::jsonb
  WHERE "minimumCapabilities" IS NULL;
  ```

  > Do NOT hand-write the full migration file. Let Prisma generate the DDL from the schema diff, then append only the backfill. This preserves the checksum integrity and avoids drift.

- [ ] **Step 4: Apply the migration in the running container**

  ```bash
  docker exec portal sh -c "cd /app && pnpm --filter @dpf/db exec prisma migrate deploy"
  ```

  Expected: `1 migration applied` and no checksum errors. If `migrate deploy` reports the migration was "already applied" (because `migrate dev` applied it in step 2), that's correct — it means both dev and deploy paths are consistent.

- [ ] **Step 5: Verify columns and backfill**

  ```bash
  docker exec -e PGPASSWORD=dpf_password portal psql -h postgres -U dpf_user -d dpf_db -c "\d \"AgentModelConfig\""
  ```

  Expected: columns `minimumCapabilities jsonb` and `minimumContextTokens integer` present.

  ```bash
  docker exec -e PGPASSWORD=dpf_password portal psql -h postgres -U dpf_user -d dpf_db -c "SELECT \"agentId\", \"minimumCapabilities\" FROM \"AgentModelConfig\" LIMIT 5;"
  ```

  Expected: all rows show `{"toolUse": true}` for `minimumCapabilities`.

- [ ] **Step 6: Commit**

  ```
  feat(schema): add minimumCapabilities and minimumContextTokens to AgentModelConfig (EP-AGENT-CAP-002)
  ```

---

### Pre-condition for Task 2: Resolve seed ↔ assignments page discrepancy

**Before writing the seed defaults, verify the agent lists match.** There is a known divergence:

- `packages/db/src/seed.ts` `defaults` array: `build-specialist`, `coo`, `platform-engineer`, `admin-assistant`, `ops-coordinator`, `portfolio-advisor`, `inventory-specialist`, `ea-architect`, `hr-specialist`, `customer-advisor`, `onboarding-coo`, `doc-specialist`, `data-architect`
- `apps/web/app/(shell)/platform/ai/assignments/page.tsx` `AGENT_DEFAULTS`: `build-specialist`, `coo`, `admin-assistant`, `platform-engineer`, `compliance-officer`, `finance-controller`, `hr-specialist`, `customer-advisor`, `portfolio-advisor`, `inventory-specialist`, `ea-architect`, `ops-coordinator`, `onboarding-coo`

**Gaps:**
- Assignments page has `compliance-officer`, `finance-controller` — seed.ts does not
- Seed.ts has `doc-specialist`, `data-architect` — assignments page does not
- Assignments page shows `build-specialist` tier as `"frontier"`; seed.ts has `"strong"`

**Resolution before implementing Task 2:**

1. Decide which agents are registered coworkers that require the capability floor. `seed.ts` is the source of truth (CLAUDE.md: "Files are the source of truth"). Add missing agents to seed.ts; do not add them only in the UI constant.
2. Add `compliance-officer` and `finance-controller` to seed.ts if they are active coworkers.
3. Add `doc-specialist` and `data-architect` to the assignments page AGENT_DEFAULTS if they are missing.
4. Resolve the `build-specialist` tier discrepancy (`frontier` vs `strong`) — the seed.ts value wins.
5. After reconciling, the seed defaults array in Task 2 below is the authoritative list.

---

### Task 2: Seed defaults — per-coworker capability floor

**Files:**
- Modify: `packages/db/src/seed.ts` (around line 1425 — the `defaults` array for AgentModelConfig seeding)

The seed creates `AgentModelConfig` rows on first install and skips existing ones (admin-configured rows are preserved). We need to:
1. Add the new fields to the type declaration
2. Add values to every entry in the `defaults` array
3. Update the skip-existing logic so that `minimumCapabilities` IS applied even when the row exists (backfills correctly on redeploy if an admin hasn't explicitly changed it)

- [ ] **Step 1: Update the type declaration**

  Find the type declaration before the defaults array (around line 1424):

  ```typescript
  }> = [
  ```

  Change to add new fields:

  ```typescript
    agentId: string;
    minimumTier: string;
    budgetClass: string;
    pinnedProviderId?: string;
    pinnedModelId?: string;
    minimumCapabilities?: Record<string, boolean>;
    minimumContextTokens?: number;
  }> = [
  ```

- [ ] **Step 2: Update the defaults array**

  Replace the defaults array entries (lines ~1430-1444) with:

  ```typescript
  const defaults: Array<{
    agentId: string;
    minimumTier: string;
    budgetClass: string;
    pinnedProviderId?: string;
    pinnedModelId?: string;
    minimumCapabilities?: Record<string, boolean>;
    minimumContextTokens?: number;
  }> = [
    { agentId: "build-specialist",    minimumTier: "strong",   budgetClass: "quality_first", pinnedModelId: "claude-sonnet-4-6", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "coo",                 minimumTier: "strong",   budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "platform-engineer",   minimumTier: "strong",   budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "admin-assistant",     minimumTier: "strong",   budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
    { agentId: "ops-coordinator",     minimumTier: "adequate", budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "portfolio-advisor",   minimumTier: "adequate", budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "inventory-specialist", minimumTier: "adequate", budgetClass: "balanced",     minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
    { agentId: "ea-architect",        minimumTier: "adequate", budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "hr-specialist",       minimumTier: "adequate", budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
    { agentId: "customer-advisor",    minimumTier: "adequate", budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
    { agentId: "onboarding-coo",      minimumTier: "basic",    budgetClass: "minimize_cost", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
    { agentId: "doc-specialist",      minimumTier: "adequate", budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "data-architect",      minimumTier: "adequate", budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "compliance-officer",  minimumTier: "strong",   budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
    { agentId: "finance-controller",  minimumTier: "strong",   budgetClass: "balanced",      minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  ];
  ```

- [ ] **Step 3: Update the seed loop to backfill capability fields**

  Find the existing-row handling block (around line 1452). Currently it only updates `pinnedProviderId`/`pinnedModelId`. Extend it to also backfill `minimumCapabilities` and `minimumContextTokens` when the existing row has null values:

  ```typescript
  if (existing) {
    // Admin-configured rows are preserved for tier/budget.
    // But capability floor and context minimum ARE backfilled if null —
    // these are system defaults, not admin choices.
    const needsPinUpdate =
      (d.pinnedProviderId && !existing.pinnedProviderId) ||
      (d.pinnedModelId && !existing.pinnedModelId);
    const needsCapUpdate =
      (d.minimumCapabilities !== undefined && existing.minimumCapabilities === null) ||
      (d.minimumContextTokens !== undefined && existing.minimumContextTokens === null);

    if (needsPinUpdate || needsCapUpdate) {
      await prisma.agentModelConfig.update({
        where: { agentId: d.agentId },
        data: {
          ...(d.pinnedProviderId && !existing.pinnedProviderId ? { pinnedProviderId: d.pinnedProviderId } : {}),
          ...(d.pinnedModelId && !existing.pinnedModelId ? { pinnedModelId: d.pinnedModelId } : {}),
          ...(d.minimumCapabilities !== undefined && existing.minimumCapabilities === null
            ? { minimumCapabilities: d.minimumCapabilities }
            : {}),
          ...(d.minimumContextTokens !== undefined && existing.minimumContextTokens === null
            ? { minimumContextTokens: d.minimumContextTokens }
            : {}),
        },
      });
      console.log(`  Updated config for ${d.agentId}`);
    }
    existed++;
    continue;
  }
  ```

  Also update the `create` call to include the new fields:

  ```typescript
  await prisma.agentModelConfig.create({
    data: {
      agentId: d.agentId,
      minimumTier: d.minimumTier,
      budgetClass: d.budgetClass,
      pinnedProviderId: d.pinnedProviderId ?? null,
      pinnedModelId: d.pinnedModelId ?? null,
      minimumCapabilities: d.minimumCapabilities ?? null,
      minimumContextTokens: d.minimumContextTokens ?? null,
      configuredAt: new Date(),
    },
  });
  ```

- [ ] **Step 4: Run TypeScript check**

  ```bash
  cd apps/web && pnpm tsc --noEmit 2>&1 | head -30
  ```

  Fix any type errors (most likely `minimumCapabilities` type mismatch — Prisma generates `JsonValue | null`, so you may need `as Prisma.InputJsonValue`).

- [ ] **Step 5: Commit**

  ```
  feat(seed): add minimumCapabilities and minimumContextTokens defaults for all coworkers (EP-AGENT-CAP-002)
  ```

---

## Phase 2: Routing Types + Enforcement

### Task 3: Agent capability types file + RequestContract update

**Files:**
- Create: `apps/web/lib/routing/agent-capability-types.ts`
- Modify: `apps/web/lib/routing/request-contract.ts` (add two fields to `RequestContract`)
- Create: `apps/web/lib/routing/agent-capability-types.test.ts`

- [ ] **Step 1: Create `agent-capability-types.ts`**

  Create `apps/web/lib/routing/agent-capability-types.ts`:

  ```typescript
  import type { EndpointManifest } from "./types";

  /**
   * EP-AGENT-CAP-002: Subset of ModelCardCapabilities used as a per-agent routing floor.
   *
   * When minimumCapabilities is set on AgentModelConfig, the routing pipeline will
   * reject any endpoint that does not satisfy ALL declared capabilities.
   * Null in the DB = use DEFAULT_MINIMUM_CAPABILITIES at runtime.
   * {} (empty object) = passive agent — no capability floor (explicit opt-out).
   */
  export interface AgentMinimumCapabilities {
    toolUse?: boolean;
    imageInput?: boolean;
    pdfInput?: boolean;
    codeExecution?: boolean;
    computerUse?: boolean;
    webSearch?: boolean;
  }

  /** Runtime default when minimumCapabilities is null in DB. All standard coworkers. */
  export const DEFAULT_MINIMUM_CAPABILITIES: AgentMinimumCapabilities = { toolUse: true };

  /** Explicit passive agent — no capability floor. Must be set explicitly; never the default. */
  export const PASSIVE_AGENT_CAPABILITIES: AgentMinimumCapabilities = {};

  /** System default minimum context window for RAG/L2 context injection (tokens). */
  export const DEFAULT_MINIMUM_CONTEXT_TOKENS = 16_000;

  /**
   * Check whether an endpoint satisfies an agent's minimum capability floor.
   *
   * Uses endpoint.supportsToolUse for toolUse — the existing top-level field,
   * already resolved through the 5-level priority chain in resolveToolUse().
   *
   * For all other caps (imageInput, pdfInput, codeExecution, computerUse,
   * webSearch) reads from endpoint.capabilities directly. EndpointManifest
   * already carries the full ModelCardCapabilities JSON blob, so there is no
   * benefit to denormalizing these to top-level booleans.
   */
  export function satisfiesMinimumCapabilities(
    endpoint: Pick<EndpointManifest, "supportsToolUse" | "capabilities">,
    floor: AgentMinimumCapabilities,
  ): { satisfied: boolean; missingCapability?: keyof AgentMinimumCapabilities } {
    if (floor.toolUse && !endpoint.supportsToolUse) {
      return { satisfied: false, missingCapability: "toolUse" };
    }
    const caps = endpoint.capabilities as Record<string, unknown> | null | undefined;
    if (floor.imageInput && !caps?.imageInput) {
      return { satisfied: false, missingCapability: "imageInput" };
    }
    if (floor.pdfInput && !caps?.pdfInput) {
      return { satisfied: false, missingCapability: "pdfInput" };
    }
    if (floor.codeExecution && !caps?.codeExecution) {
      return { satisfied: false, missingCapability: "codeExecution" };
    }
    if (floor.computerUse && !caps?.computerUse) {
      return { satisfied: false, missingCapability: "computerUse" };
    }
    if (floor.webSearch && !caps?.webSearch) {
      return { satisfied: false, missingCapability: "webSearch" };
    }
    return { satisfied: true };
  }
  ```

- [ ] **Step 2: Write tests**

  Create `apps/web/lib/routing/agent-capability-types.test.ts`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import {
    satisfiesMinimumCapabilities,
    DEFAULT_MINIMUM_CAPABILITIES,
    PASSIVE_AGENT_CAPABILITIES,
  } from "./agent-capability-types";
  import type { EndpointManifest } from "./types";

  function ep(overrides: Partial<Pick<EndpointManifest, "supportsToolUse" | "capabilities">> = {}) {
    return {
      supportsToolUse: false,
      capabilities: {},
      ...overrides,
    } as unknown as EndpointManifest;
  }

  describe("satisfiesMinimumCapabilities", () => {
    it("passes empty floor (passive agent) for any endpoint", () => {
      expect(satisfiesMinimumCapabilities(ep(), PASSIVE_AGENT_CAPABILITIES)).toEqual({ satisfied: true });
    });

    it("fails toolUse floor when endpoint has supportsToolUse: false", () => {
      const result = satisfiesMinimumCapabilities(ep({ supportsToolUse: false }), DEFAULT_MINIMUM_CAPABILITIES);
      expect(result).toEqual({ satisfied: false, missingCapability: "toolUse" });
    });

    it("passes toolUse floor when endpoint has supportsToolUse: true", () => {
      const result = satisfiesMinimumCapabilities(ep({ supportsToolUse: true }), DEFAULT_MINIMUM_CAPABILITIES);
      expect(result).toEqual({ satisfied: true });
    });

    it("fails imageInput floor when capabilities.imageInput is falsy", () => {
      const result = satisfiesMinimumCapabilities(ep({ capabilities: {} as never }), { imageInput: true });
      expect(result).toEqual({ satisfied: false, missingCapability: "imageInput" });
    });

    it("passes imageInput floor when capabilities.imageInput is true", () => {
      const result = satisfiesMinimumCapabilities(
        ep({ capabilities: { imageInput: true } as never }),
        { imageInput: true },
      );
      expect(result).toEqual({ satisfied: true });
    });

    it("fails on first missing capability in multi-cap floor", () => {
      // toolUse satisfied, imageInput not
      const result = satisfiesMinimumCapabilities(
        ep({ supportsToolUse: true, capabilities: {} as never }),
        { toolUse: true, imageInput: true },
      );
      expect(result).toEqual({ satisfied: false, missingCapability: "imageInput" });
    });

    it("passes full multi-cap floor when all satisfied", () => {
      const result = satisfiesMinimumCapabilities(
        ep({ supportsToolUse: true, capabilities: { imageInput: true } as never }),
        { toolUse: true, imageInput: true },
      );
      expect(result).toEqual({ satisfied: true });
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they pass**

  ```bash
  cd apps/web && pnpm vitest run lib/routing/agent-capability-types.test.ts
  ```

  Expected: `7 tests passed`.

- [ ] **Step 4: Add fields to `RequestContract`**

  Open `apps/web/lib/routing/request-contract.ts`. Find the `RequestContract` interface. After `minimumDimensions?: Record<string, number>;`, add:

  ```typescript
  // EP-AGENT-CAP-002: Agent-level capability floor — hard filter in Stage 1 routing.
  // Set from AgentModelConfig.minimumCapabilities. Null = no agent-level floor.
  minimumCapabilities?: import("./agent-capability-types").AgentMinimumCapabilities;
  // EP-AGENT-CAP-002: Minimum context window for RAG injection.
  // Set from AgentModelConfig.minimumContextTokens. Applied in addition to minContextTokens.
  agentMinimumContextTokens?: number;
  ```

- [ ] **Step 5: TypeScript check**

  ```bash
  cd apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 6: Commit**

  ```
  feat(routing): add AgentMinimumCapabilities types + satisfiesMinimumCapabilities helper (EP-AGENT-CAP-002)
  ```

---

### Task 4: RouteAndCallOptions + contract injection + degradation gate

**Files:**
- Modify: `apps/web/lib/inference/routed-inference.ts`

This task:
1. Adds `minimumCapabilities` and `agentMinimumContextTokens` to `RouteAndCallOptions`
2. Injects them into the contract after `inferContract()`
3. Extends `NoEligibleEndpointsError` with `missingCapability` and `agentId` fields
4. Updates the degradation gate to throw instead of silently degrading when the agent requires tool use

- [ ] **Step 1: Add fields to `RouteAndCallOptions`**

  Find the `RouteAndCallOptions` interface (around line 70). After `requireTools?: boolean;`, add:

  ```typescript
  /**
   * EP-AGENT-CAP-002: Agent-level minimum capability floor.
   * When set, endpoints that don't satisfy all declared capabilities are
   * excluded BEFORE graceful tool-stripping. Use DEFAULT_MINIMUM_CAPABILITIES
   * ({ toolUse: true }) for standard coworkers.
   */
  minimumCapabilities?: import("@/lib/routing/agent-capability-types").AgentMinimumCapabilities;
  /**
   * EP-AGENT-CAP-002: Minimum context window tokens required by the agent (for RAG).
   * Merged with task-level minContextTokens — the stricter value wins.
   * Null = system default (16000 tokens). Read from AgentModelConfig.minimumContextTokens.
   */
  agentMinimumContextTokens?: number;
  /**
   * EP-AGENT-CAP-002: Agent identifier for error correlation.
   * Set from agentId in agentic-loop.ts so NoEligibleEndpointsError can surface
   * which agent triggered the capability floor violation.
   */
  agentId?: string;
  ```

- [ ] **Step 2: Inject into contract after `inferContract()`**

  Find the section after `inferContract()` where `minimumDimensions` is injected (around line 161):

  ```typescript
  // Inject minimum dimension thresholds into contract
  if (options?.minimumDimensions) {
    contract.minimumDimensions = options.minimumDimensions;
  }
  ```

  Add immediately after:

  ```typescript
  // EP-AGENT-CAP-002: Inject agent capability floor into contract
  if (options?.minimumCapabilities !== undefined) {
    contract.minimumCapabilities = options.minimumCapabilities;
  }
  if (options?.agentMinimumContextTokens !== undefined) {
    // Use the stricter of task-level and agent-level context minimums
    const agentMin = options.agentMinimumContextTokens;
    if (contract.minContextTokens === undefined || agentMin > (contract.minContextTokens ?? 0)) {
      contract.minContextTokens = agentMin;
    }
  }
  ```

- [ ] **Step 3: Extend `NoEligibleEndpointsError`**

  Find the current `NoEligibleEndpointsError` class (around line 49):

  ```typescript
  export class NoEligibleEndpointsError extends Error {
    constructor(
      public readonly taskType: string,
      public readonly reason: string,
      public readonly excludedCount: number,
    ) {
  ```

  Replace with:

  ```typescript
  export class NoEligibleEndpointsError extends Error {
    constructor(
      public readonly taskType: string,
      public readonly reason: string,
      public readonly excludedCount: number,
      /** EP-AGENT-CAP-002: Which capability the agent required but no endpoint satisfied. */
      public readonly missingCapability?: string,
      /** EP-AGENT-CAP-002: The agent that triggered the error (for admin UI correlation). */
      public readonly agentId?: string,
    ) {
  ```

  The `super()` call and everything else stays the same.

- [ ] **Step 4: Update the degradation gate**

  Find the degradation gate (around line 205):

  ```typescript
  if (!decision.selectedEndpoint && contract.requiresTools) {
    if (options?.requireTools) {
      throw new NoEligibleEndpointsError(
        taskType,
        `No tool-capable endpoint available. Build Studio requires tool support — ` +
        `cannot fall back to generic chat. Configure a tool-capable provider (OpenAI, Anthropic, Gemini) ` +
        `or check that existing providers are active.`,
        decision.excludedCount,
      );
    }
    // ... graceful degradation continues below
  ```

  Replace (keep the existing graceful degradation path intact for task-level requirements, but add a new block BEFORE it for agent-level requirements):

  ```typescript
  // EP-AGENT-CAP-002: Agent capability floor — hard block, no graceful degradation.
  // Only throw if the routing evidence shows the capability floor was the ACTUAL cause
  // of failure. If endpoints were excluded for sensitivity, status, rate-limit, or
  // other reasons, fall through to the existing error/degradation path instead —
  // surfacing "no tool-capable endpoint" when tools aren't the problem is misleading.
  if (!decision.selectedEndpoint && options?.minimumCapabilities) {
    const floorExclusions = decision.candidates.filter(
      (c) => c.excluded && c.excludedReason?.includes("EP-AGENT-CAP-002"),
    );
    if (floorExclusions.length > 0) {
      // Identify which capability was the blocker from the first exclusion reason
      const missingCap = floorExclusions[0]?.excludedReason?.match(/capability '(\w+)'/)?.[1];
      throw new NoEligibleEndpointsError(
        taskType,
        `No endpoint satisfies agent capability floor (EP-AGENT-CAP-002). ` +
        `Missing: ${missingCap ?? "unknown"}. ` +
        `Configure a capable provider at Platform > AI > Model Assignment.`,
        decision.excludedCount,
        missingCap,
        options?.agentId,
      );
    }
  }

  if (!decision.selectedEndpoint && contract.requiresTools) {
    if (options?.requireTools) {
      throw new NoEligibleEndpointsError(
        taskType,
        `No tool-capable endpoint available. Build Studio requires tool support — ` +
        `cannot fall back to generic chat. Configure a tool-capable provider (OpenAI, Anthropic, Gemini) ` +
        `or check that existing providers are active.`,
        decision.excludedCount,
      );
    }
  ```

  Note: `options?.agentId` is not currently in `RouteAndCallOptions`. Either add it as an optional field, or omit the last argument for now.

- [ ] **Step 5: TypeScript check**

  ```bash
  cd apps/web && pnpm tsc --noEmit 2>&1 | head -30
  ```

- [ ] **Step 6: Commit**

  ```
  feat(routing): extend NoEligibleEndpointsError + inject capability floor into RequestContract (EP-AGENT-CAP-002)
  ```

---

### Task 5: Pipeline capability floor check

**Files:**
- Modify: `apps/web/lib/routing/pipeline-v2.ts` (add check in `getExclusionReasonV2`)
- Create: `apps/web/lib/routing/pipeline-v2.capability.test.ts`

This is the core enforcement. `getExclusionReasonV2` is called for every endpoint and returns a string reason if the endpoint should be excluded. We add the capability floor check FIRST, so it runs before all other checks.

- [ ] **Step 1: Add import at top of pipeline-v2.ts**

  Find the imports at the top of `apps/web/lib/routing/pipeline-v2.ts`. Add:

  ```typescript
  import { satisfiesMinimumCapabilities } from "./agent-capability-types";
  ```

- [ ] **Step 2: Add capability floor check in `getExclusionReasonV2`**

  Find `getExclusionReasonV2` (around line 38). It starts with the status check. Insert the capability floor check as the FIRST check in the function body, before the status check:

  ```typescript
  export function getExclusionReasonV2(
    ep: EndpointManifest,
    contract: RequestContract,
  ): string | null {
    // EP-AGENT-CAP-002: Agent capability floor — hard filter, non-negotiable.
    // Must run BEFORE status/graceful-degradation checks so a tool-incapable
    // endpoint is never selected even in degraded mode.
    if (contract.minimumCapabilities && Object.keys(contract.minimumCapabilities).length > 0) {
      const check = satisfiesMinimumCapabilities(ep, contract.minimumCapabilities);
      if (!check.satisfied) {
        return `Agent requires capability '${check.missingCapability}' (EP-AGENT-CAP-002)`;
      }
    }

    // Status check — only active and degraded pass
    if (ep.status !== "active" && ep.status !== "degraded") {
  ```

- [ ] **Step 3: Write capability floor tests**

  Create `apps/web/lib/routing/pipeline-v2.capability.test.ts`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { getExclusionReasonV2 } from "./pipeline-v2";
  import type { EndpointManifest } from "./types";
  import type { RequestContract } from "./request-contract";

  function activeEp(overrides: Partial<EndpointManifest> = {}): EndpointManifest {
    return {
      id: "test-ep",
      providerId: "codex",
      modelId: "gpt-5.3-codex",
      name: "GPT-5.3",
      endpointType: "chat",
      status: "active",
      sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      supportsToolUse: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      maxContextTokens: 400000,
      maxOutputTokens: 16000,
      modelRestrictions: [],
      reasoning: 90,
      codegen: 88,
      toolFidelity: 92,
      instructionFollowing: 90,
      structuredOutput: 88,
      conversational: 85,
      contextRetention: 78,
      customScores: {},
      avgLatencyMs: 1200,
      recentFailureRate: 0,
      costPerOutputMToken: 15,
      profileSource: "seed",
      profileConfidence: "high",
      retiredAt: null,
      qualityTier: "frontier",
      modelClass: "chat",
      modelFamily: "gpt",
      inputModalities: ["text"],
      outputModalities: ["text"],
      capabilities: { toolUse: true, structuredOutput: true, streaming: true } as never,
      pricing: {} as never,
      supportedParameters: [],
      deprecationDate: null,
      metadataSource: "catalog",
      metadataConfidence: "high",
      perRequestLimits: null,
      ...overrides,
    };
  }

  function contract(overrides: Partial<RequestContract> = {}): RequestContract {
    return {
      contractId: "test",
      contractFamily: "sync.conversation",
      taskType: "conversation",
      modality: { input: ["text"], output: ["text"] },
      interactionMode: "sync",
      sensitivity: "internal",
      requiresTools: false,
      requiresStrictSchema: false,
      requiresStreaming: false,
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 500,
      reasoningDepth: "low",
      budgetClass: "balanced",
      ...overrides,
    };
  }

  describe("getExclusionReasonV2 — capability floor (EP-AGENT-CAP-002)", () => {
    it("passes when no minimumCapabilities set (null/undefined)", () => {
      const ep = activeEp({ supportsToolUse: false });
      const c = contract(); // no minimumCapabilities
      expect(getExclusionReasonV2(ep, c)).toBeNull();
    });

    it("passes empty minimumCapabilities {} (passive agent)", () => {
      const ep = activeEp({ supportsToolUse: false });
      const c = contract({ minimumCapabilities: {} });
      expect(getExclusionReasonV2(ep, c)).toBeNull();
    });

    it("excludes endpoint when agent requires toolUse and endpoint has supportsToolUse: false", () => {
      const ep = activeEp({ supportsToolUse: false });
      const c = contract({ minimumCapabilities: { toolUse: true } });
      const reason = getExclusionReasonV2(ep, c);
      expect(reason).toContain("toolUse");
      expect(reason).toContain("EP-AGENT-CAP-002");
    });

    it("passes endpoint when agent requires toolUse and endpoint has supportsToolUse: true", () => {
      const ep = activeEp({ supportsToolUse: true });
      const c = contract({ minimumCapabilities: { toolUse: true } });
      expect(getExclusionReasonV2(ep, c)).toBeNull();
    });

    it("excludes inactive endpoint even if capability floor would pass", () => {
      const ep = activeEp({ supportsToolUse: true, status: "disabled" });
      const c = contract({ minimumCapabilities: { toolUse: true } });
      const reason = getExclusionReasonV2(ep, c);
      // status check runs after capability check; either exclusion is valid
      expect(reason).not.toBeNull();
    });

    it("excludes endpoint missing imageInput when agent requires it", () => {
      // capabilities.imageInput is absent in the default mock — satisfies the floor check
      const ep = activeEp({ capabilities: {} as never });
      const c = contract({ minimumCapabilities: { imageInput: true } });
      const reason = getExclusionReasonV2(ep, c);
      expect(reason).toContain("imageInput");
    });
  });
  ```

- [ ] **Step 4: Run tests**

  ```bash
  cd apps/web && pnpm vitest run lib/routing/pipeline-v2.capability.test.ts
  ```

  Expected: `6 tests passed`.

- [ ] **Step 5: TypeScript check**

  ```bash
  cd apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 6: Commit**

  ```
  feat(routing): enforce agent capability floor in pipeline Stage 1 (EP-AGENT-CAP-002)
  ```

---

### Task 6: Agentic loop wiring

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts` (around line 374 — agentModelConfig read + effectiveConfig + routeOptions)

This task reads `minimumCapabilities` and `minimumContextTokens` from the DB row and passes them through to `routeAndCall`. The import and type handling are the key details.

- [ ] **Step 1: Add import at top of agentic-loop.ts**

  Add the import (with other routing imports):

  ```typescript
  import {
    DEFAULT_MINIMUM_CAPABILITIES,
    DEFAULT_MINIMUM_CONTEXT_TOKENS,
  } from "@/lib/routing/agent-capability-types";
  import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";
  ```

- [ ] **Step 2: Extract capability floor after agentModelConfig read**

  Find the section after `agentModelConfig` is read (around line 374). After the `agentModelConfig` read, add:

  ```typescript
  // EP-AGENT-CAP-002: Read capability floor from agent config.
  // Null DB value = use system default { toolUse: true }.
  // {} DB value = passive agent, no floor.
  const rawMinCaps = agentModelConfig?.minimumCapabilities as AgentMinimumCapabilities | null | undefined;
  const minimumCapabilities: AgentMinimumCapabilities =
    rawMinCaps !== null && rawMinCaps !== undefined ? rawMinCaps : DEFAULT_MINIMUM_CAPABILITIES;
  const agentMinimumContextTokens: number =
    agentModelConfig?.minimumContextTokens ?? DEFAULT_MINIMUM_CONTEXT_TOKENS;
  ```

- [ ] **Step 3: Add to routeOptions**

  Find the `routeOptions` object construction (around line 414):

  ```typescript
  const routeOptions = {
    ...(toolsForProvider ? { tools: toolsForProvider } : {}),
    taskType: taskType ?? "conversation",
    ...effectiveConfig,
    ...(requireTools ? { requireTools: true } : {}),
    ...(agentDisplayName ? { agentDisplayName } : {}),
  };
  ```

  Add the capability floor fields:

  ```typescript
  const routeOptions = {
    ...(toolsForProvider ? { tools: toolsForProvider } : {}),
    taskType: taskType ?? "conversation",
    ...effectiveConfig,
    ...(requireTools ? { requireTools: true } : {}),
    ...(agentDisplayName ? { agentDisplayName } : {}),
    // EP-AGENT-CAP-002: Capability floor — passed through to pipeline Stage 1
    minimumCapabilities,
    agentMinimumContextTokens,
    agentId,
  };
  ```

- [ ] **Step 4: TypeScript check**

  ```bash
  cd apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```

  Common issue: Prisma's `JsonValue` type for `minimumCapabilities` from DB may not directly cast to `AgentMinimumCapabilities`. The cast `as AgentMinimumCapabilities | null | undefined` is safe here because we control the write path.

- [ ] **Step 5: Smoke test — verify COO no longer gets chatgpt**

  With the container running (or after rebuild), send a message to the COO / AI Ops Engineer from the UI. The coworker should now respond normally with tool use. If `chatgpt/gpt-5.4` is the only non-tool provider and `codex` is active, the floor will exclude chatgpt and select codex.

  Alternatively, check the route decision log in admin. Navigate to Platform > AI > Activity or check the route decision table.

- [ ] **Step 6: Commit**

  ```
  feat(agentic-loop): pass minimumCapabilities floor from AgentModelConfig to routeAndCall (EP-AGENT-CAP-002)
  ```

---

## Phase 3: Admin UI

### Task 7: Provider activation gate — warn on zero active capabilities

**Files:**
- Find the provider activation flow: search for `status.*active` or `activateProvider` in `apps/web/app/api/admin/` and `apps/web/lib/`
- The gate warning belongs in the provider activation handler (wherever provider status is changed from `inactive`/`unconfigured` to `active`)

The spec requires a warning (not a blocker) when an admin activates a provider whose models have no active capabilities (toolUse, imageInput, pdfInput, or codeExecution all false/null). Passive providers are valid for non-coworker workflows; the warning is informational.

- [ ] **Step 1: Find the provider activation endpoint**

  ```bash
  grep -r "status.*active\|activateProvider\|provider.*status" apps/web/app/api/admin/ --include="*.ts" -l
  ```

  Also check:
  ```bash
  grep -r "ModelProvider.*update\|updateProvider" apps/web/lib/ apps/web/app/api/ --include="*.ts" -l
  ```

- [ ] **Step 2: Add capability gap check to the activation response**

  In the provider activation handler (after updating provider status to `active`), add a post-activation check:

  ```typescript
  import { prisma } from "@dpf/db";

  // EP-AGENT-CAP-002: Warn if activated provider has no models with active capabilities
  const activeModels = await prisma.modelProfile.findMany({
    where: { providerId: activatedProviderId, modelStatus: { in: ["active", "degraded"] } },
    select: { capabilities: true },
  });

  const hasActiveCapability = activeModels.some((m) => {
    const caps = m.capabilities as Record<string, unknown> | null;
    return caps?.toolUse === true || caps?.imageInput === true ||
           caps?.pdfInput === true || caps?.codeExecution === true;
  });

  const warning = hasActiveCapability
    ? null
    : "This provider's models have no active capabilities (toolUse, imageInput, pdfInput, codeExecution). " +
      "It will not be eligible for routing to any registered coworker. " +
      "It may still be used for passive chat workflows (summarization, creative writing).";
  ```

  Return the `warning` field in the response JSON alongside the activation result:

  ```typescript
  return NextResponse.json({ success: true, warning });
  ```

- [ ] **Step 3: Surface the warning in the provider activation UI**

  Find where the provider activation API response is handled in the frontend. If `warning` is present in the response, show an amber toast or inline message.

- [ ] **Step 4: TypeScript check**

  ```bash
  cd apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 5: Commit**

  ```
  feat(admin): warn when activating provider with no active capabilities (EP-AGENT-CAP-002)
  ```

---

### Task 8: Assignments page — capability gap banner + per-agent badges

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/assignments/page.tsx`
- Modify: `apps/web/components/platform/AgentModelAssignmentTable.tsx`

The assignments page already fetches `AgentModelConfig` rows and endpoint manifests. We need to:
1. Compute which agents have NO eligible endpoints after capability floor filtering
2. Show a gap banner at the top when any agents are misconfigured
3. Add per-agent capability badges (Tools / Image / PDF / Code) showing required vs. available

- [ ] **Step 1: Read and understand the current page structure**

  Read the current `apps/web/app/(shell)/platform/ai/assignments/page.tsx` and `apps/web/components/platform/AgentModelAssignmentTable.tsx` to understand the data shapes before modifying.

- [ ] **Step 2: Compute capability gap in page.tsx**

  In the data-fetching section of `page.tsx`, after loading manifests and agent configs, add:

  ```typescript
  import { satisfiesMinimumCapabilities, DEFAULT_MINIMUM_CAPABILITIES } from "@/lib/routing/agent-capability-types";
  import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";

  // EP-AGENT-CAP-002: Identify agents with no eligible endpoints
  const capabilityGapAgents = agentList.filter((agent) => {
    const floor = (agent.minimumCapabilities as AgentMinimumCapabilities | null)
      ?? DEFAULT_MINIMUM_CAPABILITIES;
    if (Object.keys(floor).length === 0) return false; // passive agent — no gap possible
    const activeManifests = manifests.filter(
      (m) => m.status === "active" || m.status === "degraded",
    );
    return !activeManifests.some(
      (m) => satisfiesMinimumCapabilities(m, floor).satisfied,
    );
  });
  ```

  Pass `capabilityGapAgents.length` and `capabilityGapAgents` as props to `AgentModelAssignmentTable`.

- [ ] **Step 3: Add gap banner to AgentModelAssignmentTable.tsx**

  At the top of the table component, before the table itself, add a conditional banner:

  ```tsx
  {capabilityGapCount > 0 && (
    <div
      className="mb-4 rounded-md border px-4 py-3 text-sm"
      style={{
        borderColor: "var(--dpf-warning)",
        backgroundColor: "color-mix(in srgb, var(--dpf-warning) 10%, var(--dpf-surface-1))",
        color: "var(--dpf-text)",
      }}
    >
      <span className="font-semibold">{capabilityGapCount} agent{capabilityGapCount > 1 ? "s" : ""}</span>
      {" "}have no eligible endpoints for their required capabilities.
      Check active providers at{" "}
      <a href="/platform/ai/providers" style={{ color: "var(--dpf-accent)" }} className="underline">
        Platform &gt; AI &gt; Providers
      </a>.
    </div>
  )}
  ```

- [ ] **Step 4: Add per-agent capability badges**

  In the agent row rendering (wherever `minimumTier` and `budgetClass` are shown), add a small badge row:

  ```tsx
  {/* EP-AGENT-CAP-002: Required capability badges — use --dpf-* vars for dark-mode safety */}
  {agent.minimumCapabilities && (
    <div className="flex gap-1 mt-1">
      {(agent.minimumCapabilities as AgentMinimumCapabilities).toolUse && (
        <span
          className="rounded px-1.5 py-0.5 text-xs"
          style={{ background: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)", color: "var(--dpf-accent)" }}
        >Tools</span>
      )}
      {(agent.minimumCapabilities as AgentMinimumCapabilities).imageInput && (
        <span
          className="rounded px-1.5 py-0.5 text-xs"
          style={{ background: "color-mix(in srgb, var(--dpf-info) 15%, transparent)", color: "var(--dpf-info)" }}
        >Image</span>
      )}
      {(agent.minimumCapabilities as AgentMinimumCapabilities).pdfInput && (
        <span
          className="rounded px-1.5 py-0.5 text-xs"
          style={{ background: "color-mix(in srgb, var(--dpf-warning) 15%, transparent)", color: "var(--dpf-warning)" }}
        >PDF</span>
      )}
      {(agent.minimumCapabilities as AgentMinimumCapabilities).codeExecution && (
        <span
          className="rounded px-1.5 py-0.5 text-xs"
          style={{ background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)", color: "var(--dpf-success)" }}
        >Code</span>
      )}
    </div>
  )}
  ```

- [ ] **Step 5: TypeScript check**

  ```bash
  cd apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 6: Verify in browser**

  Navigate to Platform > AI > Assignments. Verify:
  - With no capability gaps: no banner shown
  - If you temporarily disable the `codex` provider (or change an agent's minimumCapabilities to require `codeExecution` when no model supports it), the amber banner appears
  - Tool badges appear on coworker rows

- [ ] **Step 7: Commit**

  ```
  feat(admin): capability gap banner and requirement badges in agent assignments page (EP-AGENT-CAP-002)
  ```

---

## Phase 4: Ollama Rename (EP-AGENT-CAP-002-CLEANUP)

> **Note:** This phase is a separate tracked task. Do not merge it with Phase 1-3 work. The rename affects 103 files and must be done atomically with a DB migration. Confirm with the platform owner before starting this phase.

### Task 8: Rename providerId "ollama" → "local"

The platform uses Docker Model Runner (built into Docker Desktop 4.40+) for local AI. It is currently registered as `providerId: "ollama"` — a legacy misnaming from when a separate Ollama service was used. Docker Model Runner exposes an OpenAI-compatible `/v1` API at `http://model-runner.docker.internal/v1`.

**Scope:**
1. Migration: `UPDATE "ModelProvider" SET "providerId" = 'local' WHERE "providerId" = 'ollama'` (CASCADE or manual update of FK rows)
2. Seed: change `providerId: "ollama"` → `"local"` everywhere in seed.ts
3. Adapter registration: find and update `"ollama"` string in provider adapter files
4. Residency policy in pipeline-v2.ts: `ep.providerId !== "ollama"` → `ep.providerId !== "local"`
5. UI labels: replace "Ollama" display label with "Local (Docker Model Runner)"
6. `onboarding-coo` pinned provider: if `pinnedProviderId = "ollama"` in DB, update to `"local"`
7. Documentation: update all references to Ollama in docs/

**Files to scan before starting:**
```bash
grep -r "\"ollama\"" apps/ packages/ --include="*.ts" --include="*.tsx" -l
grep -r "'ollama'" apps/ packages/ --include="*.ts" --include="*.tsx" -l
grep -ri "ollama" docs/ -l
```

**Migration SQL:**
```sql
-- Step 1: update FK rows first (ModelProfile)
UPDATE "ModelProfile" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
-- Step 2: update the provider row itself
UPDATE "ModelProvider" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
-- Step 3: update any AgentModelConfig pins
UPDATE "AgentModelConfig" SET "pinnedProviderId" = 'local' WHERE "pinnedProviderId" = 'ollama';
```

- [ ] **Step 1: Confirm scope** — run grep, count affected files, report to platform owner
- [ ] **Step 2: Write migration** — migration timestamp `20260413110000_rename_ollama_to_local`
- [ ] **Step 3: Update all TypeScript files** — use find-replace across all files
- [ ] **Step 4: Update residency policy in pipeline-v2.ts**
- [ ] **Step 5: Update UI labels**
- [ ] **Step 6: Apply migration**
- [ ] **Step 7: Run full TypeScript check**
- [ ] **Step 8: Verify local model still routes correctly in dev environment**
- [ ] **Step 9: Commit**

---

## Verification Checklist (Post-Phase 2)

### Automated checks

Run these before marking Phase 2 complete:

```bash
# 1. TypeScript — full compile, no errors
cd apps/web && pnpm tsc --noEmit

# 2. Unit tests for new routing code
cd apps/web && pnpm vitest run lib/routing/agent-capability-types.test.ts
cd apps/web && pnpm vitest run lib/routing/pipeline-v2.capability.test.ts
cd apps/web && pnpm vitest run lib/routing/loader.test.ts

# 3. Production build — must succeed before shipping
cd apps/web && pnpm next build
```

`pnpm next build` is required — not optional. The capability floor types flow through multiple inference boundaries; a build error that `tsc --noEmit` doesn't catch (e.g., a missing export, a Server Component importing a Client module) will only appear here.

### Coworker QA

After Phase 2 is deployed (or in the running dev stack), exercise these paths manually:

1. **COO / AI Ops Engineer no longer in limited mode**
   - Send any message to COO from the UI (e.g., "What's the current sprint status?")
   - Coworker must respond with tool use, not "I can't call any tools in this session"
   - Route decision log: chatgpt should appear as excluded with reason containing "EP-AGENT-CAP-002"

2. **Hard failure path — no capable provider**
   - Temporarily mark all tool-capable providers as `inactive` or `disabled` via Platform > AI > Providers
   - Send a message to any coworker
   - UI should show a structured error, not a "limited mode" degraded response
   - Re-activate providers after testing

3. **Passive-agent path (if any exists) — no false exclusions**
   - If any agent has `minimumCapabilities: {}` in DB, confirm it still routes normally to any active endpoint

4. **Capability gap banner**
   - Navigate to Platform > AI > Assignments
   - If a tool-capable provider is the only active one and chatgpt has no tools, the banner should be absent (chatgpt is a non-coworker provider, not a registered coworker assignment)
   - If you temporarily disable all tool-capable providers, the banner should appear

---

## Routing Spec Update (EP-AGENT-CAP-002)

**Update required:** `docs/superpowers/specs/2026-03-29-model-routing-simplification-design.md`

Add a new section describing the agent capability floor as the first check inside Stage 1 hard filtering. The routing pipeline stages should be documented as:

```
Stage 0: Pin/block override (existing — specific provider/model pinned to agent)
Stage 1: Hard filters — getExclusionReasonV2() per endpoint (existing + EP-AGENT-CAP-002)
  1a. Agent capability floor (NEW — EP-AGENT-CAP-002, runs first)
      Hard reject: satisfiesMinimumCapabilities(ep, contract.minimumCapabilities) === false
      Source: AgentModelConfig.minimumCapabilities (runtime default: { toolUse: true })
      Error path: NoEligibleEndpointsError with missingCapability + agentId fields
  1b. Status filter — only active/degraded endpoints pass (existing)
  1c. Model class filter (existing)
  1d. Sensitivity clearance (existing)
  1e. Context window minimum (existing, now also enforced via agentMinimumContextTokens)
  1f. Task capability requirements — requiresTools, requiresCodeExecution, etc. (existing)
Stage 2: Quality tier scoring (existing)
Stage 3: Cost-per-success ranking (existing)
```

**Key distinction**: The capability floor (1a) is an *agent-level* predicate — it characterizes what the model must be able to do to serve this particular agent, regardless of what the current task requires. The task capability requirements (1f) are *task-level* predicates — they reflect what the current message requires. Both are hard filters; the agent floor runs first because it eliminates the most endpoints most of the time for standard coworkers (all of which require toolUse).

The routing spec should also note that the capability floor is the primary reason a model is or is not eligible as a coworker — this is the fundamental routing decision for agentic workflows, not a secondary filter.
