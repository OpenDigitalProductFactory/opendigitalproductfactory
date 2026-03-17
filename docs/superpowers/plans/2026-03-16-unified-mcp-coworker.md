# Unified MCP Coworker Architecture — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-persona agent system with a single AI coworker identity, MCP-unified routing layer, Advise/Act toggle, and HR role-based authority.

**Architecture:** One coworker identity with composable system prompt (7 blocks), MCP endpoint registry replacing ModelProvider, AgentRouter for sensitivity × capability × cost matching, and Advise/Act binary toggle replacing External Access. Feature-flagged via `USE_UNIFIED_COWORKER` for rollback safety.

**Tech Stack:** Next.js, Prisma (PostgreSQL), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-16-unified-mcp-coworker-design.md`

---

## Chunk 1: Schema Migration & Feature Flag

Evolve ModelProvider to endpoint manifest, extend AuthorizationDecisionLog, add Agent.archived, migrate ModelProfile tiers. All additive — no breaking changes.

### Task 1.1: Add feature flag to platform config

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (PlatformConfig model)
- Modify: `packages/db/data/platform_config_seed.ts` (or seed file)

- [ ] **Step 1: Add USE_UNIFIED_COWORKER flag to seed data**

Add to `packages/db/src/seed.ts` (in the PlatformConfig upsert section). Note: `PlatformConfig.value` is type `Json`, so store as an object:
```typescript
await prisma.platformConfig.upsert({
  where: { key: "USE_UNIFIED_COWORKER" },
  update: {},
  create: { key: "USE_UNIFIED_COWORKER", value: { enabled: false } },
});
```

- [ ] **Step 2: Create helper to read the flag**

Create `apps/web/lib/feature-flags.ts`:
```typescript
import { prisma } from "@dpf/db";

export async function isUnifiedCoworkerEnabled(): Promise<boolean> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "USE_UNIFIED_COWORKER" },
  });
  const val = config?.value as { enabled?: boolean } | null;
  return val?.enabled === true;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/seed.ts apps/web/lib/feature-flags.ts
git commit -m "feat: add USE_UNIFIED_COWORKER feature flag"
```

### Task 1.2: Extend ModelProvider with endpoint manifest fields

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (ModelProvider model, lines 463-486)

- [ ] **Step 1: Add new fields to ModelProvider model**

Add these fields (all optional/defaulted so existing rows are unaffected):

```prisma
model ModelProvider {
  // ... existing fields ...

  // MCP Endpoint Manifest (new)
  endpointType          String    @default("llm")          // "llm" | "service"
  sensitivityClearance  String[]  @default([])              // ["public", "internal", "confidential", "restricted"]
  capabilityTier        String    @default("basic")         // "basic" | "routine" | "analytical" | "deep-thinker"
  costBand              String    @default("free")          // "free" | "low" | "medium" | "high"
  taskTags              String[]  @default([])              // ["reasoning", "code-gen", "web-search", etc.]
  mcpTransport          String?                             // "stdio" | "sse" | "http"
  maxConcurrency        Int?
}
```

- [ ] **Step 2: Run prisma migration**

```bash
cd packages/db && npx prisma migrate dev --name add-endpoint-manifest-fields
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/
git commit -m "schema: add MCP endpoint manifest fields to ModelProvider"
```

### Task 1.3: Extend AuthorizationDecisionLog

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (AuthorizationDecisionLog model, lines 653-672)

- [ ] **Step 1: Add new nullable fields**

```prisma
model AuthorizationDecisionLog {
  // ... existing fields ...

  // Unified coworker audit extensions (new, all nullable for backward compat)
  endpointUsed          String?
  mode                  String?    // "advise" | "act"
  routeContext          String?
  sensitivityLevel      String?
  sensitivityOverride   Boolean?
}
```

- [ ] **Step 2: Run prisma migration**

```bash
cd packages/db && npx prisma migrate dev --name extend-authorization-log
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/
git commit -m "schema: extend AuthorizationDecisionLog for unified coworker audit"
```

### Task 1.4: Add Agent.archived flag

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Agent model, lines 547-562)

- [ ] **Step 1: Add archived boolean field**

```prisma
model Agent {
  // ... existing fields ...
  archived    Boolean   @default(false)
}
```

- [ ] **Step 2: Run prisma migration**

```bash
cd packages/db && npx prisma migrate dev --name add-agent-archived-flag
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/
git commit -m "schema: add archived flag to Agent model"
```

### Task 1.5: Migrate ModelProfile capability tiers

**Files:**
- Create: `packages/db/scripts/migrate-capability-tiers.ts`

- [ ] **Step 1: Write migration script**

```typescript
import { prisma } from "../src/client";

const TIER_MAP: Record<string, string> = {
  "budget": "basic",
  "fast-worker": "routine",
  "specialist": "analytical",
  "deep-thinker": "deep-thinker",
  "embedding": "basic",
  "unknown": "basic",
};

async function migrate() {
  const profiles = await prisma.modelProfile.findMany();
  for (const p of profiles) {
    const newTier = TIER_MAP[p.capabilityTier] ?? "basic";
    if (newTier !== p.capabilityTier) {
      await prisma.modelProfile.update({
        where: { providerId_modelId: { providerId: p.providerId, modelId: p.modelId } },
        data: { capabilityTier: newTier },
      });
      console.log(`${p.providerId}/${p.modelId}: ${p.capabilityTier} → ${newTier}`);
    }
  }
  console.log("Done.");
}

migrate().catch(console.error);
```

- [ ] **Step 2: Run migration script**

```bash
cd packages/db && npx tsx scripts/migrate-capability-tiers.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/migrate-capability-tiers.ts
git commit -m "data: migrate ModelProfile capability tiers to new vocabulary"
```

### Task 1.6: Seed endpoint manifest data for existing providers

**Files:**
- Create: `packages/db/scripts/seed-endpoint-manifests.ts`

- [ ] **Step 1: Write seed script**

Populates sensitivityClearance, capabilityTier, costBand, taskTags, endpointType for existing ModelProvider rows based on their current category/costModel. Logic:

```typescript
import { prisma } from "../src/client";

async function seed() {
  const providers = await prisma.modelProvider.findMany();
  for (const p of providers) {
    const isLocal = p.category === "local" || p.providerId === "ollama";
    await prisma.modelProvider.update({
      where: { providerId: p.providerId },
      data: {
        endpointType: "llm",
        sensitivityClearance: isLocal
          ? ["public", "internal", "confidential", "restricted"]
          : ["public", "internal"],
        capabilityTier: p.providerId === "ollama" ? "analytical" : "deep-thinker",
        costBand: isLocal ? "free" : "medium",
        taskTags: ["reasoning", "summarization", "code-gen"],
      },
    });
    console.log(`${p.providerId}: seeded endpoint manifest`);
  }
  console.log("Done.");
}

seed().catch(console.error);
```

- [ ] **Step 2: Run seed script**

```bash
cd packages/db && npx tsx scripts/seed-endpoint-manifests.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/seed-endpoint-manifests.ts
git commit -m "data: seed endpoint manifest values for existing providers"
```

---

## Chunk 2: AgentRouter

Replace the provider selection logic in `ai-provider-priority.ts` with the new MCP-aware router that matches sensitivity × capability tier × cost band.

### Task 2.1: Write AgentRouter types

**Files:**
- Create: `apps/web/lib/agent-router-types.ts`

- [ ] **Step 1: Define types**

```typescript
export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted";
export type CapabilityTier = "basic" | "routine" | "analytical" | "deep-thinker";
export type CostBand = "free" | "low" | "medium" | "high";

export type TaskRequest = {
  /** Page sensitivity level */
  sensitivity: SensitivityLevel;
  /** Minimum capability tier required */
  minCapabilityTier: CapabilityTier;
  /** Required task tags (e.g., ["web-search"]) */
  requiredTags?: string[];
  /** Prefer cheapest eligible endpoint */
  preferCheap?: boolean;
};

export type EndpointCandidate = {
  endpointId: string;
  endpointType: "llm" | "service";
  sensitivityClearance: SensitivityLevel[];
  capabilityTier: CapabilityTier;
  costBand: CostBand;
  taskTags: string[];
  status: string;
  /** Rolling average latency in ms (for tiebreaker) */
  avgLatencyMs?: number;
  /** Recent failure count (for tiebreaker) */
  recentFailures?: number;
};

export type RouteResult = {
  endpointId: string;
  reason: string;
} | null;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/agent-router-types.ts
git commit -m "feat: add AgentRouter type definitions"
```

### Task 2.2: Write AgentRouter tests

**Files:**
- Create: `apps/web/lib/agent-router.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. Filters out endpoints not cleared for page sensitivity
2. Filters out endpoints missing required task tags
3. Ranks by cheapest cost band meeting capability tier
4. Tiebreaker: prefers lowest latency
5. Tiebreaker: prefers fewer failures
6. Tiebreaker: alphabetical as deterministic fallback
7. Returns null when no endpoints match
8. Primary routing selects highest-tier endpoint
9. Sub-task routing selects cheapest eligible endpoint
10. Inactive endpoints are excluded

```typescript
import { describe, it, expect } from "vitest";
import { routeTask, routePrimary, routeSubtask } from "../agent-router";
import type { EndpointCandidate, TaskRequest } from "../agent-router-types";

const ENDPOINTS: EndpointCandidate[] = [
  {
    endpointId: "ollama-llama",
    endpointType: "llm",
    sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    capabilityTier: "analytical",
    costBand: "free",
    taskTags: ["reasoning", "summarization"],
    status: "active",
    avgLatencyMs: 200,
    recentFailures: 0,
  },
  {
    endpointId: "ollama-phi",
    endpointType: "llm",
    sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    capabilityTier: "basic",
    costBand: "free",
    taskTags: ["summarization", "data-extraction"],
    status: "active",
    avgLatencyMs: 100,
    recentFailures: 0,
  },
  {
    endpointId: "openrouter",
    endpointType: "llm",
    sensitivityClearance: ["public", "internal"],
    capabilityTier: "deep-thinker",
    costBand: "medium",
    taskTags: ["reasoning", "code-gen"],
    status: "active",
    avgLatencyMs: 500,
    recentFailures: 0,
  },
  {
    endpointId: "brave-search",
    endpointType: "service",
    sensitivityClearance: ["public", "internal"],
    capabilityTier: "basic",
    costBand: "low",
    taskTags: ["web-search"],
    status: "active",
    avgLatencyMs: 300,
    recentFailures: 0,
  },
  {
    endpointId: "inactive-provider",
    endpointType: "llm",
    sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    capabilityTier: "deep-thinker",
    costBand: "free",
    taskTags: ["reasoning"],
    status: "inactive",
    avgLatencyMs: 0,
    recentFailures: 10,
  },
];

describe("routeTask", () => {
  it("filters by sensitivity clearance", () => {
    const result = routeTask(ENDPOINTS, {
      sensitivity: "confidential",
      minCapabilityTier: "basic",
    });
    // openrouter and brave-search only cleared for public/internal
    expect(result?.endpointId).not.toBe("openrouter");
    expect(result?.endpointId).not.toBe("brave-search");
  });

  it("filters by required task tags", () => {
    const result = routeTask(ENDPOINTS, {
      sensitivity: "internal",
      minCapabilityTier: "basic",
      requiredTags: ["web-search"],
    });
    expect(result?.endpointId).toBe("brave-search");
  });

  it("excludes inactive endpoints", () => {
    const result = routeTask(ENDPOINTS, {
      sensitivity: "restricted",
      minCapabilityTier: "deep-thinker",
    });
    expect(result).toBeNull(); // inactive-provider is the only deep-thinker cleared for restricted, but inactive
  });

  it("returns null when no endpoints match", () => {
    const result = routeTask(ENDPOINTS, {
      sensitivity: "restricted",
      minCapabilityTier: "deep-thinker",
      requiredTags: ["code-gen"],
    });
    expect(result).toBeNull();
  });

  it("prefers cheapest cost band meeting capability tier", () => {
    const result = routeTask(ENDPOINTS, {
      sensitivity: "internal",
      minCapabilityTier: "analytical",
      preferCheap: true,
    });
    // ollama-llama (free, analytical) beats openrouter (medium, deep-thinker)
    expect(result?.endpointId).toBe("ollama-llama");
  });

  it("tiebreaker: prefers lowest latency", () => {
    // Both ollama endpoints are free and cleared for confidential
    const result = routeTask(ENDPOINTS, {
      sensitivity: "confidential",
      minCapabilityTier: "basic",
      preferCheap: true,
    });
    // ollama-phi has lower latency (100ms vs 200ms)
    expect(result?.endpointId).toBe("ollama-phi");
  });
});

describe("routePrimary", () => {
  it("selects highest-tier eligible endpoint", () => {
    const result = routePrimary(ENDPOINTS, "internal");
    // openrouter is deep-thinker, highest tier for internal
    expect(result?.endpointId).toBe("openrouter");
  });

  it("falls back when highest tier not cleared", () => {
    const result = routePrimary(ENDPOINTS, "confidential");
    // openrouter not cleared for confidential → ollama-llama (analytical) is best
    expect(result?.endpointId).toBe("ollama-llama");
  });
});

describe("routeSubtask", () => {
  it("selects cheapest eligible endpoint", () => {
    const result = routeSubtask(ENDPOINTS, "internal", {
      requiredTags: ["summarization"],
    });
    // ollama-phi (free, basic, has summarization) is cheapest
    expect(result?.endpointId).toBe("ollama-phi");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/__tests__/agent-router.test.ts
```
Expected: FAIL — `agent-router` module doesn't exist yet.

- [ ] **Step 3: Commit failing tests**

```bash
git add apps/web/lib/agent-router.test.ts
git commit -m "test: add AgentRouter test suite (red)"
```

### Task 2.3: Implement AgentRouter

**Files:**
- Create: `apps/web/lib/agent-router.ts`

- [ ] **Step 1: Implement routing functions**

```typescript
import type {
  EndpointCandidate,
  TaskRequest,
  RouteResult,
  CapabilityTier,
  CostBand,
  SensitivityLevel,
} from "./agent-router-types";

const TIER_ORDER: Record<CapabilityTier, number> = {
  "basic": 1,
  "routine": 2,
  "analytical": 3,
  "deep-thinker": 4,
};

const COST_ORDER: Record<CostBand, number> = {
  "free": 0,
  "low": 1,
  "medium": 2,
  "high": 3,
};

function filterEligible(
  endpoints: EndpointCandidate[],
  request: TaskRequest,
): EndpointCandidate[] {
  return endpoints.filter((ep) => {
    if (ep.status !== "active") return false;
    if (!ep.sensitivityClearance.includes(request.sensitivity)) return false;
    if (TIER_ORDER[ep.capabilityTier] < TIER_ORDER[request.minCapabilityTier]) return false;
    if (request.requiredTags?.length) {
      if (!request.requiredTags.every((tag) => ep.taskTags.includes(tag))) return false;
    }
    return true;
  });
}

function rankEndpoints(
  endpoints: EndpointCandidate[],
  preferCheap: boolean,
): EndpointCandidate[] {
  return [...endpoints].sort((a, b) => {
    // Primary: cost (cheapest first if preferCheap, most capable first otherwise)
    if (preferCheap) {
      const costDiff = COST_ORDER[a.costBand] - COST_ORDER[b.costBand];
      if (costDiff !== 0) return costDiff;
    } else {
      const tierDiff = TIER_ORDER[b.capabilityTier] - TIER_ORDER[a.capabilityTier];
      if (tierDiff !== 0) return tierDiff;
      const costDiff = COST_ORDER[a.costBand] - COST_ORDER[b.costBand];
      if (costDiff !== 0) return costDiff;
    }
    // Tiebreaker 1: lowest latency
    const latA = a.avgLatencyMs ?? Infinity;
    const latB = b.avgLatencyMs ?? Infinity;
    if (latA !== latB) return latA - latB;
    // Tiebreaker 2: fewest failures
    const failA = a.recentFailures ?? 0;
    const failB = b.recentFailures ?? 0;
    if (failA !== failB) return failA - failB;
    // Tiebreaker 3: alphabetical
    return a.endpointId.localeCompare(b.endpointId);
  });
}

/** Route a task to the best-fit endpoint. */
export function routeTask(
  endpoints: EndpointCandidate[],
  request: TaskRequest,
): RouteResult {
  const eligible = filterEligible(endpoints, request);
  if (eligible.length === 0) return null;
  const ranked = rankEndpoints(eligible, request.preferCheap ?? false);
  const best = ranked[0]!;
  return { endpointId: best.endpointId, reason: `matched: tier=${best.capabilityTier}, cost=${best.costBand}` };
}

/** Route primary inference — highest-tier eligible endpoint. */
export function routePrimary(
  endpoints: EndpointCandidate[],
  sensitivity: SensitivityLevel,
): RouteResult {
  return routeTask(endpoints, {
    sensitivity,
    minCapabilityTier: "basic",
    preferCheap: false,
  });
}

/** Route sub-task — cheapest eligible endpoint meeting requirements. */
export function routeSubtask(
  endpoints: EndpointCandidate[],
  sensitivity: SensitivityLevel,
  options?: { requiredTags?: string[]; minCapabilityTier?: CapabilityTier },
): RouteResult {
  return routeTask(endpoints, {
    sensitivity,
    minCapabilityTier: options?.minCapabilityTier ?? "basic",
    requiredTags: options?.requiredTags,
    preferCheap: true,
  });
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/__tests__/agent-router.test.ts
```
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agent-router.ts apps/web/lib/agent-router-types.ts
git commit -m "feat: implement AgentRouter with sensitivity × capability × cost matching"
```

### Task 2.4: Add endpoint loader from database

**Files:**
- Create: `apps/web/lib/agent-router-data.ts`

- [ ] **Step 1: Implement endpoint loader**

Loads active endpoints from ModelProvider table and converts to `EndpointCandidate[]`:

```typescript
import { prisma } from "@dpf/db";
import type { EndpointCandidate, SensitivityLevel } from "./agent-router-types";

/** Load all active MCP endpoints from the workforce registry. */
export async function loadEndpoints(): Promise<EndpointCandidate[]> {
  const providers = await prisma.modelProvider.findMany({
    where: { status: { in: ["active", "unconfigured"] } },
    select: {
      providerId: true,
      endpointType: true,
      sensitivityClearance: true,
      capabilityTier: true,
      costBand: true,
      taskTags: true,
      status: true,
    },
  });

  return providers
    .filter((p) => p.status === "active")
    .map((p) => ({
      endpointId: p.providerId,
      endpointType: (p.endpointType ?? "llm") as "llm" | "service",
      sensitivityClearance: (p.sensitivityClearance ?? []) as SensitivityLevel[],
      capabilityTier: (p.capabilityTier ?? "basic") as EndpointCandidate["capabilityTier"],
      costBand: (p.costBand ?? "free") as EndpointCandidate["costBand"],
      taskTags: p.taskTags ?? [],
      status: p.status,
    }));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/agent-router-data.ts
git commit -m "feat: add endpoint loader for AgentRouter"
```

---

## Chunk 3: Coworker Identity & Prompt Assembler

Replace the persona-based agent routing with a single coworker identity and composable system prompt.

### Task 3.1: Define route context map

**Files:**
- Create: `apps/web/lib/route-context-map.ts`

- [ ] **Step 1: Create route context definitions**

Each route gets a domain context definition (replacing the persona system prompt). Extract domain knowledge from existing agent system prompts in `agent-routing.ts` (lines 43-351) but strip all personality/heuristics:

```typescript
import type { SensitivityLevel } from "./agent-router-types";

export type RouteContextDef = {
  /** Route prefix for matching */
  routePrefix: string;
  /** Domain name for prompt injection */
  domain: string;
  /** Sensitivity classification */
  sensitivity: SensitivityLevel;
  /** Domain context block for the system prompt */
  domainContext: string;
  /** Domain-specific tools available on this route */
  domainTools: string[];
  /** Quick-action skills shown in the UI */
  skills: Array<{ label: string; description: string; capability: string | null; prompt: string }>;
};

export const ROUTE_CONTEXT_MAP: Record<string, RouteContextDef> = {
  "/portfolio": {
    routePrefix: "/portfolio",
    domain: "Portfolio Management",
    sensitivity: "internal",
    domainContext: `Domain: Portfolio Management.
This page manages the organization's digital product portfolios, taxonomy, and strategic alignment.
Key concepts: portfolios contain digital products, products move through lifecycle stages (plan → design → build → production → retirement), taxonomy organizes capabilities.`,
    domainTools: [
      "search_portfolio_context",
      "create_digital_product",
      "update_lifecycle",
    ],
    skills: [
      { label: "Portfolio health", description: "Review portfolio status", capability: "view_portfolio", prompt: "Show me the current portfolio health — what products are active, planned, or retiring?" },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/inventory": {
    routePrefix: "/inventory",
    domain: "Product Inventory",
    sensitivity: "internal",
    domainContext: `Domain: Product Inventory.
This page shows all registered digital products, their lifecycle stages, versions, and dependencies.
Key concepts: products have versions, lifecycle stages, and portfolio assignments.`,
    domainTools: [
      "create_digital_product",
      "update_lifecycle",
    ],
    skills: [
      { label: "Product status", description: "Check product lifecycle", capability: "view_inventory", prompt: "Show me the current state of our digital products." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/ea": {
    routePrefix: "/ea",
    domain: "Enterprise Architecture",
    sensitivity: "internal",
    domainContext: `Domain: Enterprise Architecture.
This page manages the organization's enterprise architecture model — capability maps, value streams, and technology landscape.
Key concepts: capabilities map to value streams, products implement capabilities.`,
    domainTools: [],
    skills: [
      { label: "Capability map", description: "Review capabilities", capability: "view_ea_modeler", prompt: "Show me the current capability map." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/employee": {
    routePrefix: "/employee",
    domain: "Employee Management",
    sensitivity: "confidential",
    domainContext: `Domain: Employee Management.
This page manages employee profiles, roles, team assignments, and HR records.
Key concepts: employees have HR roles (HR-000 through HR-500), team memberships, and capability grants. This data is CONFIDENTIAL.`,
    domainTools: [],
    skills: [
      { label: "Team overview", description: "Who's on what team", capability: "view_employee", prompt: "Show me the current team structure." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/customer": {
    routePrefix: "/customer",
    domain: "Customer Success",
    sensitivity: "confidential",
    domainContext: `Domain: Customer Success.
This page manages customer organizations, contacts, subscriptions, and engagement.
Key concepts: customers have organizations, contacts, and lifecycle stages. This data is CONFIDENTIAL.`,
    domainTools: [],
    skills: [
      { label: "Customer overview", description: "Customer engagement status", capability: "view_customer", prompt: "Show me the customer engagement overview." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/ops": {
    routePrefix: "/ops",
    domain: "Operations",
    sensitivity: "internal",
    domainContext: `Domain: Operations.
This page manages the backlog, sprints, epics, and delivery velocity.
Key concepts: backlog items belong to epics, items move through statuses (open → in-progress → done → deferred).`,
    domainTools: [
      "create_backlog_item",
      "update_backlog_item",
    ],
    skills: [
      { label: "Backlog status", description: "Review epics and priorities", capability: "view_operations", prompt: "Give me the current backlog status." },
      { label: "Create task", description: "Create a backlog item", capability: "manage_backlog", prompt: "Create a new task." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/build": {
    routePrefix: "/build",
    domain: "Build Studio",
    sensitivity: "internal",
    domainContext: `Domain: Build Studio.
This page is the feature development workspace — feature briefs, build plans, complexity assessment, and code generation.
Key concepts: feature builds go through phases (intake → brief → plan → generate → review → complete). Builds produce digital products.`,
    domainTools: [
      "update_feature_brief",
      "create_build_epic",
      "register_digital_product_from_build",
      "search_portfolio_context",
      "assess_complexity",
      "propose_decomposition",
      "register_tech_debt",
      "save_build_notes",
    ],
    skills: [
      { label: "Start a build", description: "Begin a new feature build", capability: "view_platform", prompt: "I want to start building a new feature." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/platform": {
    routePrefix: "/platform",
    domain: "Platform & AI",
    sensitivity: "confidential",
    domainContext: `Domain: Platform & AI.
This page manages AI providers, agent workforce, model profiles, and platform configuration.
Key concepts: providers serve AI models, agents are assigned to providers, model profiles describe capabilities. This data is CONFIDENTIAL.`,
    domainTools: [
      "add_provider",
      "update_provider_category",
    ],
    skills: [
      { label: "Provider status", description: "Check AI providers", capability: "view_platform", prompt: "Show me the status of our AI providers." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/admin": {
    routePrefix: "/admin",
    domain: "Administration",
    sensitivity: "restricted",
    domainContext: `Domain: Administration.
This page manages user access, branding, platform settings, and security configuration.
Key concepts: users have platform roles, capabilities are granted per role, branding controls the visual identity. This data is RESTRICTED — local providers only.`,
    domainTools: [],
    skills: [
      { label: "Access review", description: "Who has access to what", capability: "view_admin", prompt: "Show me who has access to what capabilities." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
  "/workspace": {
    routePrefix: "/workspace",
    domain: "Workspace",
    sensitivity: "confidential",
    domainContext: `Domain: Workspace.
This is the cross-cutting workspace with visibility across all areas — portfolio, operations, build, workforce, and platform health.
Key concepts: aggregated view of delivery velocity, blockers, backlog status, and workforce utilization.`,
    domainTools: [
      "create_backlog_item",
      "update_backlog_item",
      "read_project_file",
      "search_project_files",
      "propose_file_change",
    ],
    skills: [
      { label: "Backlog status", description: "Review epics and priorities", capability: "view_platform", prompt: "Give me the current backlog status." },
      { label: "Read code", description: "Browse the project codebase", capability: "view_platform", prompt: "Show me the relevant source code." },
      { label: "Create task", description: "Create a backlog item", capability: "manage_backlog", prompt: "Create a new task." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback." },
    ],
  },
};

/** Default route context for unmatched routes */
export const FALLBACK_ROUTE_CONTEXT = ROUTE_CONTEXT_MAP["/workspace"]!;

/** Resolve route context by longest prefix match */
export function resolveRouteContext(pathname: string): RouteContextDef {
  const sorted = Object.keys(ROUTE_CONTEXT_MAP).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (pathname.startsWith(prefix)) return ROUTE_CONTEXT_MAP[prefix]!;
  }
  return FALLBACK_ROUTE_CONTEXT;
}
```

- [ ] **Step 2: Write test for route resolver**

Create `apps/web/lib/route-context-map.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveRouteContext, FALLBACK_ROUTE_CONTEXT } from "./route-context-map";

describe("resolveRouteContext", () => {
  it("matches exact route prefix", () => {
    expect(resolveRouteContext("/portfolio").domain).toBe("Portfolio Management");
  });

  it("matches nested routes", () => {
    expect(resolveRouteContext("/build/FB-123").domain).toBe("Build Studio");
  });

  it("falls back to workspace for unknown routes", () => {
    expect(resolveRouteContext("/unknown")).toBe(FALLBACK_ROUTE_CONTEXT);
  });

  it("returns correct sensitivity per route", () => {
    expect(resolveRouteContext("/admin").sensitivity).toBe("restricted");
    expect(resolveRouteContext("/employee").sensitivity).toBe("confidential");
    expect(resolveRouteContext("/portfolio").sensitivity).toBe("internal");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd apps/web && npx vitest run lib/route-context-map.test.ts
```
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/route-context-map.ts apps/web/lib/route-context-map.test.ts
git commit -m "feat: add route context definitions replacing agent personas"
```

### Task 3.2: Build composable system prompt assembler

**Files:**
- Create: `apps/web/lib/prompt-assembler.ts`
- Create: `apps/web/lib/prompt-assembler.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "../prompt-assembler";

describe("assembleSystemPrompt", () => {
  const baseInput = {
    hrRole: "HR-000" as const,
    grantedCapabilities: ["view_platform", "manage_backlog"],
    deniedCapabilities: ["manage_users"],
    mode: "advise" as const,
    sensitivity: "internal" as const,
    domainContext: "Domain: Operations.\nThis page manages the backlog.",
    domainTools: ["create_backlog_item", "update_backlog_item"],
    routeData: null as string | null,
    attachmentContext: null as string | null,
  };

  it("includes all 7 blocks in order", () => {
    const prompt = assembleSystemPrompt(baseInput);
    const identityIdx = prompt.indexOf("AI coworker");
    const authorityIdx = prompt.indexOf("HR-000");
    const modeIdx = prompt.indexOf("ADVISE");
    const sensitivityIdx = prompt.indexOf("classified");
    const domainIdx = prompt.indexOf("Domain: Operations");
    expect(identityIdx).toBeLessThan(authorityIdx);
    expect(authorityIdx).toBeLessThan(modeIdx);
    expect(modeIdx).toBeLessThan(sensitivityIdx);
    expect(sensitivityIdx).toBeLessThan(domainIdx);
  });

  it("injects Advise mode rules", () => {
    const prompt = assembleSystemPrompt(baseInput);
    expect(prompt).toContain("ADVISE");
    expect(prompt).toContain("must not create, update, or delete");
  });

  it("injects Act mode rules", () => {
    const prompt = assembleSystemPrompt({ ...baseInput, mode: "act" });
    expect(prompt).toContain("ACT");
    expect(prompt).toContain("logged");
  });

  it("lists granted and denied capabilities", () => {
    const prompt = assembleSystemPrompt(baseInput);
    expect(prompt).toContain("view_platform");
    expect(prompt).toContain("manage_backlog");
    expect(prompt).toContain("NOT authorized");
    expect(prompt).toContain("manage_users");
  });

  it("includes sensitivity level", () => {
    const prompt = assembleSystemPrompt(baseInput);
    expect(prompt).toContain("Internal");
  });

  it("includes domain tools", () => {
    const prompt = assembleSystemPrompt(baseInput);
    expect(prompt).toContain("create_backlog_item");
  });

  it("includes PLATFORM_PREAMBLE behavioral rules", () => {
    const prompt = assembleSystemPrompt(baseInput);
    expect(prompt).toContain("NEVER claim you did something");
  });

  it("omits route data block when null", () => {
    const prompt = assembleSystemPrompt(baseInput);
    expect(prompt).not.toContain("PAGE DATA");
  });

  it("includes route data block when present", () => {
    const prompt = assembleSystemPrompt({ ...baseInput, routeData: "There are 5 open items." });
    expect(prompt).toContain("There are 5 open items.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/__tests__/prompt-assembler.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement prompt assembler**

```typescript
import type { SensitivityLevel } from "./agent-router-types";

export type PromptInput = {
  hrRole: string;
  grantedCapabilities: string[];
  deniedCapabilities: string[];
  mode: "advise" | "act";
  sensitivity: SensitivityLevel;
  domainContext: string;
  domainTools: string[];
  routeData: string | null;
  attachmentContext: string | null;
};

// Block 1: Identity (static, includes behavioral rules from PLATFORM_PREAMBLE)
const IDENTITY_BLOCK = `You are an AI coworker inside a digital product management platform called Open Digital Product Factory. You are capable, direct, and specific to this platform. You don't give generic advice — everything you say is grounded in what's actually here. If you don't know, say so. If you can act, act. If you can't, explain why and what the employee can do about it.

CRITICAL RULES:
1. NEVER claim you did something you didn't do. If you lack a tool for a task, say "I can't do that directly — I'll create a backlog item for it" and ACTUALLY call create_backlog_item.
2. NEVER write "Action:", "Step 1:", "What you need to do next:", "I will now...", "Here's my plan:", or similar narration. Just DO it.
3. NEVER ask for confirmation before using a tool. The approval card IS the confirmation. Call the tool and let the user approve or reject.
4. NEVER write multi-paragraph plans. Respond in 2-4 sentences max. Act, don't plan.
5. NEVER mention internal details: schemas, table names, tool names, file paths, error codes, or system architecture.
6. If a user asks for MULTIPLE things, handle each one with separate tool calls.
7. If you can't do something with your available tools, be honest and create a backlog item to track the gap.
8. When you observe friction or a missing capability, use propose_improvement to suggest a platform enhancement.`;

function buildAuthorityBlock(input: PromptInput): string {
  const granted = input.grantedCapabilities.length > 0
    ? input.grantedCapabilities.join(", ")
    : "none";
  const denied = input.deniedCapabilities.length > 0
    ? input.deniedCapabilities.join(", ")
    : "none";
  return `The employee you're working with holds role ${input.hrRole}.
They are authorized to: ${granted}.
They are NOT authorized to: ${denied}.
All actions you take execute under their authority. Never exceed it.`;
}

function buildModeBlock(mode: "advise" | "act"): string {
  if (mode === "advise") {
    return `Mode: ADVISE. You may read, search, analyze, and recommend. You must not create, update, or delete anything. When you would take action, describe what you'd do. If action is needed, suggest switching to Act mode — once per turn, don't nag.`;
  }
  return `Mode: ACT. You may execute any tool the employee's role authorizes. All actions are logged. Prefer the most direct path. Don't ask for confirmation on routine operations — the employee chose Act mode because they trust you to act.`;
}

function buildSensitivityBlock(sensitivity: SensitivityLevel): string {
  const label = sensitivity.charAt(0).toUpperCase() + sensitivity.slice(1);
  return `This page is classified ${label}. Only endpoints cleared for ${label} are handling requests. Do not include classified data in sub-tasks routed to lower-clearance endpoints.`;
}

function buildDomainBlock(domainContext: string, domainTools: string[]): string {
  const toolList = domainTools.length > 0
    ? `\nAvailable domain tools: ${domainTools.join(", ")}`
    : "";
  return `${domainContext}${toolList}`;
}

export function assembleSystemPrompt(input: PromptInput): string {
  const sections = [
    IDENTITY_BLOCK,
    "",
    buildAuthorityBlock(input),
    "",
    buildModeBlock(input.mode),
    "",
    buildSensitivityBlock(input.sensitivity),
    "",
    buildDomainBlock(input.domainContext, input.domainTools),
  ];

  if (input.routeData) {
    sections.push("", "--- PAGE DATA ---", input.routeData);
  }

  if (input.attachmentContext) {
    sections.push("", input.attachmentContext);
  }

  return sections.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/__tests__/prompt-assembler.test.ts
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/prompt-assembler.ts apps/web/lib/prompt-assembler.test.ts
git commit -m "feat: composable system prompt assembler with 7 blocks"
```

---

## Chunk 4: Advise / Act Toggle

Replace External Access toggle with Advise/Act, add sideEffect flag to tools, wire mode gating into sendMessage.

### Task 4.1: Replace session state helpers

**Files:**
- Modify: `apps/web/components/agent/agent-external-access-session.ts` (20 lines — full rewrite)

- [ ] **Step 1: Rewrite session helpers for Advise/Act**

Replace entire file with per-route-scoped Advise/Act state:

```typescript
export type CoworkerMode = "advise" | "act";

function getCoworkerModeKey(userId: string, routeContext: string): string {
  return `coworker-mode-session:${userId}:${routeContext}`;
}

export function loadCoworkerMode(userId: string, routeContext: string): CoworkerMode {
  if (typeof window === "undefined") return "advise";
  const key = getCoworkerModeKey(userId, routeContext);
  const stored = sessionStorage.getItem(key);
  return stored === "act" ? "act" : "advise";
}

export function saveCoworkerMode(userId: string, routeContext: string, mode: CoworkerMode): void {
  if (typeof window === "undefined") return;
  const key = getCoworkerModeKey(userId, routeContext);
  sessionStorage.setItem(key, mode);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/agent/agent-external-access-session.ts
git commit -m "feat: replace External Access session state with Advise/Act per-route"
```

### Task 4.2: Add sideEffect flag to tool registry

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (ToolDefinition type + each tool entry)

- [ ] **Step 1: Add sideEffect to ToolDefinition type**

In the `ToolDefinition` type (line 14-21), add:
```typescript
sideEffect?: boolean; // true = blocked in Advise mode
```

- [ ] **Step 2: Add sideEffect flag to each tool**

Set `sideEffect: true` on all tools that create/update/delete:
- `create_backlog_item`, `update_backlog_item`, `create_digital_product`, `update_lifecycle` → `sideEffect: true`
- `report_quality_issue`, `propose_improvement`, `propose_file_change` → `sideEffect: true`
- `add_provider`, `update_provider_category` → `sideEffect: true`
- `update_feature_brief`, `create_build_epic`, `register_digital_product_from_build`, `register_tech_debt`, `save_build_notes` → `sideEffect: true`
- `search_public_web`, `fetch_public_website`, `analyze_public_website_branding` → `sideEffect: false` (read-only)
- `search_portfolio_context`, `assess_complexity`, `propose_decomposition` → `sideEffect: false` (read-only)
- `read_project_file`, `search_project_files` → `sideEffect: false` (read-only)

- [ ] **Step 3: Update getAvailableTools to accept mode**

Modify the `getAvailableTools` function to filter by mode:

```typescript
export function getAvailableTools(
  userContext: UserContext,
  options?: { externalAccessEnabled?: boolean; mode?: "advise" | "act" },
): ToolDefinition[] {
  return PLATFORM_TOOLS.filter(
    (tool) =>
      (!tool.requiresExternalAccess || options?.externalAccessEnabled === true)
      && (tool.requiredCapability === null || can(userContext, tool.requiredCapability))
      && (options?.mode !== "advise" || !tool.sideEffect),
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat: add sideEffect flag and Advise mode filtering to tool registry"
```

### Task 4.3: Update AgentPanelHeader for Advise/Act

**Files:**
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx` (lines 126-153 — External Access toggle)

- [ ] **Step 1: Replace External Access toggle with Advise/Act**

Replace the `externalAccessEnabled` prop and toggle with `coworkerMode` / `onToggleMode`. Update the button:

- Label: "Advise" or "Act" depending on state
- Tooltip: "Advise: AI recommends but doesn't act" / "Act: AI executes within your authority"
- Styling: Advise = default/transparent, Act = green accent (same style as current External Access On)

- [ ] **Step 2: Add sensitivity badge**

Near the Advise/Act toggle, add a small badge showing the page's sensitivity level. Use the route context to derive sensitivity from the route context map.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/AgentPanelHeader.tsx
git commit -m "feat: Advise/Act toggle and sensitivity badge in panel header"
```

### Task 4.4: Update AgentCoworkerPanel state management

**Files:**
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`

- [ ] **Step 1: Replace externalAccessEnabled state with coworkerMode**

Replace:
- `externalAccessEnabled` state → `coworkerMode` state (type `CoworkerMode`)
- `loadExternalAccessSessionState` → `loadCoworkerMode`
- `saveExternalAccessSessionState` → `saveCoworkerMode`

- [ ] **Step 2: Pass mode to sendMessage call**

In `submitMessage()` (line 162), replace `externalAccessEnabled` with:
```typescript
coworkerMode: coworkerMode,
// Keep externalAccessEnabled for backward compat during flag transition
externalAccessEnabled: coworkerMode === "act",
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/AgentCoworkerPanel.tsx
git commit -m "feat: wire Advise/Act state into AgentCoworkerPanel"
```

### Task 4.5: Wire mode into sendMessage server action

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Accept coworkerMode input**

Add `coworkerMode?: "advise" | "act"` to the `sendMessage` input type (line 97).

- [ ] **Step 2: Pass mode to getAvailableTools**

Update the tool filtering call (line 274):
```typescript
const availableTools = getAvailableTools({
  platformRole: user.platformRole,
  isSuperuser: user.isSuperuser,
}, {
  externalAccessEnabled: input.externalAccessEnabled === true,
  mode: input.coworkerMode ?? "advise",
});
```

- [ ] **Step 3: Pass mode to audit logging**

When logging to `authorizationDecisionLog` (or via `createAuthorizationDecisionLog`), include the mode in the rationale JSON.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: wire Advise/Act mode into sendMessage and tool filtering"
```

---

## Chunk 5: Integration — Feature-Flagged Prompt Switch

Wire the new prompt assembler and route context into the sendMessage flow behind the feature flag, so both old and new paths work.

### Task 5.1: Integrate unified prompt path

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Import new modules**

```typescript
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { resolveRouteContext } from "@/lib/route-context-map";
import { assembleSystemPrompt } from "@/lib/prompt-assembler";
import { getAllCapabilities, getGrantedCapabilities } from "@/lib/permissions";
```

Note: `getAllCapabilities` and `getGrantedCapabilities` may need to be added to `permissions.ts` — helper functions that return the list of capabilities a role has vs doesn't have for a given route.

- [ ] **Step 2: Add capability list helpers to permissions.ts**

Add to `apps/web/lib/permissions.ts`:

```typescript
/** Get all capabilities granted to a user's role */
export function getGrantedCapabilities(user: UserContext): string[] {
  if (user.isSuperuser) return Object.keys(PERMISSIONS) as string[];
  const role = user.platformRole;
  if (!role) return [];
  return (Object.entries(PERMISSIONS) as [CapabilityKey, Permission][])
    .filter(([, perm]) => perm.roles.includes(role as PlatformRoleId))
    .map(([cap]) => cap);
}

/** Get capabilities NOT granted to a user's role */
export function getDeniedCapabilities(user: UserContext): string[] {
  const granted = new Set(getGrantedCapabilities(user));
  return (Object.keys(PERMISSIONS) as string[]).filter((cap) => !granted.has(cap));
}
```

- [ ] **Step 3: Add feature-flagged prompt path in sendMessage**

After resolving the agent (line 212), add the unified coworker path:

```typescript
const useUnified = await isUnifiedCoworkerEnabled();

let populatedPrompt: string;

if (useUnified) {
  const routeCtx = resolveRouteContext(input.routeContext);
  const granted = getGrantedCapabilities({
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });
  const denied = getDeniedCapabilities({
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  }, routeCtx.domainTools);

  populatedPrompt = assembleSystemPrompt({
    hrRole: user.platformRole ?? "none",
    grantedCapabilities: granted,
    deniedCapabilities: denied,
    mode: (input.coworkerMode as "advise" | "act") ?? "advise",
    sensitivity: routeCtx.sensitivity,
    domainContext: routeCtx.domainContext,
    domainTools: routeCtx.domainTools,
    routeData: routeData,
    attachmentContext,
  });
} else {
  // Existing persona-based prompt assembly (lines 230-271)
  const promptSections = [
    agent.systemPrompt,
    "",
    "Current context:",
    // ... existing code ...
  ];
  populatedPrompt = promptSections.join("\n");
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/agent-coworker.ts apps/web/lib/permissions.ts
git commit -m "feat: feature-flagged unified coworker prompt path in sendMessage"
```

### Task 5.2: Update resolveAgentForRoute for unified mode

**Files:**
- Modify: `apps/web/lib/agent-routing.ts`

- [ ] **Step 1: Add unified coworker agent info**

When the feature flag is active, `resolveAgentForRoute` should return a minimal agent info object instead of a persona. Add at the top of the function:

```typescript
if (useUnified) {
  const routeCtx = resolveRouteContext(pathname);
  return {
    agentId: "coworker",
    agentName: "Coworker",
    agentDescription: routeCtx.domain,
    capability: null, // HR role handles gating
    sensitivity: routeCtx.sensitivity,
    systemPrompt: "", // Not used in unified mode — prompt assembler handles this
    skills: routeCtx.skills,
    modelRequirements: {},
  };
}
```

Note: `resolveAgentForRoute` is synchronous, so the async feature flag cannot be read inside it. Resolve the flag in `sendMessage` (which is already async) and pass `useUnified: boolean` as a parameter to `resolveAgentForRoute`. When `true`, use the new route context path; when `false`, use the existing persona path.

- [ ] **Step 2: Retain AGENT_NAME_MAP for historical rendering**

Ensure the existing `AGENT_NAME_MAP` stays so old messages still render with the correct agent name. Add the `"coworker"` entry:

```typescript
export const AGENT_NAME_MAP: Record<string, string> = {
  ...Object.fromEntries(Object.values(ROUTE_AGENT_MAP).map((e) => [e.agentId, e.agentName])),
  coworker: "Coworker",
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agent-routing.ts
git commit -m "feat: unified coworker path in resolveAgentForRoute with historical name map"
```

### Task 5.3: Archive persona agents in database

**Files:**
- Create: `packages/db/scripts/archive-persona-agents.ts`

- [ ] **Step 1: Write archive script**

```typescript
import { prisma } from "../src/client";

async function archive() {
  // Create the unified coworker agent row
  await prisma.agent.upsert({
    where: { agentId: "coworker" },
    update: { name: "Coworker", type: "orchestrator", status: "active", archived: false },
    create: { agentId: "coworker", name: "Coworker", tier: 1, type: "orchestrator", status: "active", archived: false },
  });

  // Archive all persona agents
  const personaIds = [
    "portfolio-advisor", "inventory-specialist", "ea-architect",
    "hr-specialist", "customer-advisor", "ops-coordinator",
    "platform-engineer", "build-specialist", "admin-assistant", "coo",
  ];
  const result = await prisma.agent.updateMany({
    where: { agentId: { in: personaIds } },
    data: { archived: true },
  });
  console.log(`Archived ${result.count} persona agents. Created/updated coworker agent.`);
}

archive().catch(console.error);
```

- [ ] **Step 2: Run archive script**

```bash
cd packages/db && npx tsx scripts/archive-persona-agents.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/archive-persona-agents.ts
git commit -m "data: archive persona agents, create unified coworker agent"
```

---

## Chunk 6: Register External Services as MCP Endpoints

Register web search and web fetch as endpoint rows in the workforce registry so they route through the same MCP system.

### Task 6.1: Seed external service endpoints

**Files:**
- Create: `packages/db/scripts/seed-service-endpoints.ts`

- [ ] **Step 1: Write seed script**

```typescript
import { prisma } from "../src/client";

const SERVICE_ENDPOINTS = [
  {
    providerId: "brave-search",
    name: "Brave Search",
    endpointType: "service",
    sensitivityClearance: ["public", "internal"],
    capabilityTier: "basic",
    costBand: "low",
    taskTags: ["web-search"],
    status: "active",
    category: "local",
    costModel: "token",
    authMethod: "api_key",
  },
  {
    providerId: "public-fetch",
    name: "Public URL Fetcher",
    endpointType: "service",
    sensitivityClearance: ["public", "internal"],
    capabilityTier: "basic",
    costBand: "free",
    taskTags: ["web-fetch"],
    status: "active",
    category: "local",
    costModel: "compute",
    authMethod: "none",
  },
  {
    providerId: "branding-analyzer",
    name: "Branding Analyzer",
    endpointType: "service",
    sensitivityClearance: ["public", "internal"],
    capabilityTier: "basic",
    costBand: "free",
    taskTags: ["branding-analysis", "web-fetch"],
    status: "active",
    category: "local",
    costModel: "compute",
    authMethod: "none",
  },
];

async function seed() {
  for (const ep of SERVICE_ENDPOINTS) {
    await prisma.modelProvider.upsert({
      where: { providerId: ep.providerId },
      update: {
        endpointType: ep.endpointType,
        sensitivityClearance: ep.sensitivityClearance,
        capabilityTier: ep.capabilityTier,
        costBand: ep.costBand,
        taskTags: ep.taskTags,
      },
      create: {
        providerId: ep.providerId,
        name: ep.name,
        endpointType: ep.endpointType,
        sensitivityClearance: ep.sensitivityClearance,
        capabilityTier: ep.capabilityTier,
        costBand: ep.costBand,
        taskTags: ep.taskTags,
        status: ep.status,
        category: ep.category,
        costModel: ep.costModel,
        families: [],
        enabledFamilies: [],
        authMethod: ep.authMethod,
        supportedAuthMethods: [ep.authMethod],
      },
    });
    console.log(`Seeded: ${ep.providerId}`);
  }
}

seed().catch(console.error);
```

- [ ] **Step 2: Run seed script**

```bash
cd packages/db && npx tsx scripts/seed-service-endpoints.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/seed-service-endpoints.ts
git commit -m "data: register Brave Search and Public Fetch as MCP service endpoints"
```

### Task 6.2: Remove requiresExternalAccess gating from tool registry

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Remove requiresExternalAccess flag from external tools**

In unified mode, external access is determined by the router (does an eligible service endpoint exist for this sensitivity level?), not by a session toggle. Remove `requiresExternalAccess: true` from `search_public_web`, `fetch_public_website`, and `analyze_public_website_branding`.

Keep the flag definition on `ToolDefinition` for backward compatibility when the feature flag is off, but when unified mode is active, ignore it in `getAvailableTools`.

- [ ] **Step 2: Update getAvailableTools**

```typescript
export function getAvailableTools(
  userContext: UserContext,
  options?: { externalAccessEnabled?: boolean; mode?: "advise" | "act"; unifiedMode?: boolean },
): ToolDefinition[] {
  return PLATFORM_TOOLS.filter(
    (tool) =>
      // In unified mode, external access is router-controlled (always include if cleared)
      (options?.unifiedMode || !tool.requiresExternalAccess || options?.externalAccessEnabled === true)
      && (tool.requiredCapability === null || can(userContext, tool.requiredCapability))
      && (options?.mode !== "advise" || !tool.sideEffect),
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat: router-controlled external access in unified mode"
```

---

## Chunk 7: Governance & Audit Updates

Refactor governance resolver for sensitivity overrides, extend audit logging.

### Task 7.1: Add sensitivity override resolution

**Files:**
- Modify: `apps/web/lib/governance-resolver.ts`

- [ ] **Step 1: Add sensitivity override function**

```typescript
import type { SensitivityLevel } from "./agent-router-types";

export type SensitivityOverrideRequest = {
  pageSensitivity: SensitivityLevel;
  requestedSensitivity: SensitivityLevel;
  employeeId: string;
};

export type SensitivityOverrideResult = {
  decision: "allow" | "deny";
  rationale: string;
};

const SENSITIVITY_ORDER: Record<SensitivityLevel, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

/** A downgrade is only valid when requested level is LOWER than page level. */
export function resolveSensitivityOverride(
  request: SensitivityOverrideRequest,
): SensitivityOverrideResult {
  if (SENSITIVITY_ORDER[request.requestedSensitivity] >= SENSITIVITY_ORDER[request.pageSensitivity]) {
    return { decision: "deny", rationale: "Requested sensitivity is not lower than page sensitivity" };
  }
  // Employee explicitly approved the downgrade — allow with audit trail
  return { decision: "allow", rationale: `Employee ${request.employeeId} approved downgrade from ${request.pageSensitivity} to ${request.requestedSensitivity}` };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/governance-resolver.ts
git commit -m "feat: add sensitivity override resolution for sub-task routing"
```

### Task 7.2: Extend audit logging helper

**Files:**
- Modify: `apps/web/lib/governance-data.ts`

- [ ] **Step 1: Add extended logging function**

Add a new function that includes the unified coworker audit fields:

```typescript
export async function createUnifiedAuditLog(input: {
  actorRef: string;
  actionKey: string;
  objectRef: string;
  decision: "allow" | "deny" | "require_approval";
  rationale: Record<string, unknown>;
  endpointUsed?: string;
  mode?: "advise" | "act";
  routeContext?: string;
  sensitivityLevel?: string;
  sensitivityOverride?: boolean;
}) {
  return prisma.authorizationDecisionLog.create({
    data: {
      decisionId: crypto.randomUUID(),
      actorType: "user",
      actorRef: input.actorRef,
      actionKey: input.actionKey,
      objectRef: input.objectRef,
      decision: input.decision,
      rationale: input.rationale,
      endpointUsed: input.endpointUsed,
      mode: input.mode,
      routeContext: input.routeContext,
      sensitivityLevel: input.sensitivityLevel,
      sensitivityOverride: input.sensitivityOverride,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/governance-data.ts
git commit -m "feat: extended audit logging for unified coworker actions"
```

---

## Data Script Execution Order

The standalone scripts in `packages/db/scripts/` must be run in this order after all schema migrations complete:

1. `npx tsx scripts/migrate-capability-tiers.ts` (Task 1.5)
2. `npx tsx scripts/seed-endpoint-manifests.ts` (Task 1.6)
3. `npx tsx scripts/archive-persona-agents.ts` (Task 5.3)
4. `npx tsx scripts/seed-service-endpoints.ts` (Task 6.1)

For fresh installs, these should also be called from `packages/db/src/seed.ts` after the main seed completes.

---

## Chunk 8: Verification & Cleanup

Run all existing tests, fix any breakage, and verify the feature flag toggle works both ways.

### Task 8.1: Run full test suite

**Files:**
- All test files in `apps/web/lib/__tests__/`

- [ ] **Step 1: Run existing tests**

```bash
cd apps/web && npx vitest run
```

- [ ] **Step 2: Fix any failures**

Existing tests for `agent-routing.test.ts`, `mcp-tools.test.ts`, `ai-provider-priority.test.ts`, `permissions.test.ts` may need updates for new function signatures (e.g., `getAvailableTools` accepting `mode` parameter).

- [ ] **Step 3: Verify feature flag off = old behavior**

With `USE_UNIFIED_COWORKER` set to `"false"`, the entire system should behave exactly as before. Verify the sendMessage flow uses the old persona-based prompt path.

- [ ] **Step 4: Verify feature flag on = new behavior**

Set `USE_UNIFIED_COWORKER` to `"true"` and verify:
- System prompt uses composable blocks (no persona)
- Advise/Act toggle appears instead of External Access
- Tool filtering respects sideEffect flag
- Sensitivity badge appears
- Audit logs include new fields

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: update tests for unified coworker architecture"
```

### Task 8.2: Reconcile sensitivity sources

**Sensitivity source of truth:** When `USE_UNIFIED_COWORKER` is ON, `route-context-map.ts` is authoritative. When OFF, `agent-sensitivity.ts` is authoritative. Both must agree on values to avoid confusion during the transition.

### Task 8.2a: Update agent-sensitivity.ts to match spec

**Files:**
- Modify: `apps/web/lib/agent-sensitivity.ts`

- [ ] **Step 1: Promote /workspace to confidential**

Update the ROUTE_SENSITIVITY array to set `/workspace` to `"confidential"` (currently `"internal"`, spec requires `"confidential"`).

- [ ] **Step 2: Run agent-sensitivity tests**

```bash
cd apps/web && npx vitest run lib/__tests__/agent-sensitivity.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agent-sensitivity.ts
git commit -m "fix: promote /workspace sensitivity to confidential per spec"
```
