# Phase 7A — AI Provider Registry & Token Spend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/platform/ai` — a dynamic AI provider registry with credential management, auth validation, token spend tracking, and a central platform scheduler.

**Architecture:** Prisma schema migration adds `TokenUsage`, `ScheduledJob`, and new columns on `ModelProvider`. Server actions in `ai-providers.ts` handle sync, configure, test, and log operations. A new `/platform/ai` route (three sections: provider grid, spend dashboard, scheduler) and a `/platform/ai/providers/[providerId]` detail page complete the UI.

**Tech Stack:** Next.js 14 App Router, Prisma 5, PostgreSQL, React cache, Auth.js v5, Vitest (node environment)

**Spec:** `docs/superpowers/specs/2026-03-12-phase-7a-ai-provider-registry-design.md`

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Modify | Add `TokenUsage`, `ScheduledJob`; extend `ModelProvider` |
| `packages/db/data/providers-registry.json` | Create | Initial 6-provider registry |
| `packages/db/src/seed.ts` | Modify | Add `seedScheduledJobs()` call |
| `apps/web/lib/ai-provider-types.ts` | Create | Shared TypeScript types + cost calculation helpers |
| `apps/web/lib/ai-providers.test.ts` | Create | Unit tests for cost helpers |
| `apps/web/lib/ai-provider-data.ts` | Create | React-cached server fetchers |
| `apps/web/lib/actions/ai-providers.ts` | Create | Server actions (sync, configure, test, log, schedule) |
| `apps/web/app/(shell)/platform/ai/page.tsx` | Create | Main page (provider grid + spend + scheduler) |
| `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` | Create | Provider detail + configure form |
| `apps/web/components/platform/TokenSpendPanel.tsx` | Create | Client component: tabbed spend dashboard |
| `apps/web/components/platform/ScheduledJobsTable.tsx` | Create | Client component: jobs table with inline schedule editor |
| `apps/web/components/platform/ProviderDetailForm.tsx` | Create | Client component: configure + test connection form |
| `apps/web/app/(shell)/platform/page.tsx` | Modify | Add "AI Providers" link card |

---

## Chunk 1: Schema, Types, and Seed Data

### Task 1: Prisma schema migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add new models and extend ModelProvider**

Open `packages/db/prisma/schema.prisma`. Find the `ModelProvider` model (currently around line 191) and replace it, then add `TokenUsage` and `ScheduledJob` after it:

```prisma
model ModelProvider {
  id                   String   @id @default(cuid())
  providerId           String   @unique
  name                 String
  families             Json
  enabledFamilies      Json     @default("[]")
  status               String   @default("unconfigured")
  authEndpoint         String?
  authHeader           String?
  endpoint             String?
  costModel            String   @default("token")
  inputPricePerMToken  Float?
  outputPricePerMToken Float?
  computeWatts         Float?
  electricityRateKwh   Float?
  updatedAt            DateTime @updatedAt
}

model TokenUsage {
  id           String   @id @default(cuid())
  agentId      String
  providerId   String
  contextKey   String
  inputTokens  Int      @default(0)
  outputTokens Int      @default(0)
  inferenceMs  Int?
  costUsd      Float    @default(0)
  createdAt    DateTime @default(now())
}

model ScheduledJob {
  id         String    @id @default(cuid())
  jobId      String    @unique
  name       String
  schedule   String    @default("weekly")
  lastRunAt  DateTime?
  nextRunAt  DateTime?
  lastStatus String?
  lastError  String?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}
```

- [ ] **Step 2: Run migration**

```bash
cd packages/db && npx prisma migrate dev --name add_ai_provider_registry
```

Expected: migration file created in `prisma/migrations/`, `✔ Generated Prisma Client`

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web exec tsc --noEmit 2>&1 | grep -v "branding\|Header"
```

Expected: no errors related to new models

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add TokenUsage, ScheduledJob, extend ModelProvider for Phase 7A"
```

---

### Task 2: TypeScript types and cost calculation helpers

**Files:**
- Create: `apps/web/lib/ai-provider-types.ts`
- Create: `apps/web/lib/ai-providers.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `apps/web/lib/ai-providers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeTokenCost,
  computeComputeCost,
  computeNextRunAt,
  SCHEDULE_INTERVALS_MS,
} from "./ai-provider-types";

describe("computeTokenCost", () => {
  it("returns 0 for zero tokens", () => {
    expect(computeTokenCost(0, 0, 3.0, 15.0)).toBe(0);
  });

  it("computes cost for input tokens only", () => {
    // 1M input tokens at $3/M = $3.00
    expect(computeTokenCost(1_000_000, 0, 3.0, 15.0)).toBeCloseTo(3.0);
  });

  it("computes cost for output tokens only", () => {
    // 1M output tokens at $15/M = $15.00
    expect(computeTokenCost(0, 1_000_000, 3.0, 15.0)).toBeCloseTo(15.0);
  });

  it("computes combined cost", () => {
    // 500K in + 100K out = $1.50 + $1.50 = $3.00
    expect(computeTokenCost(500_000, 100_000, 3.0, 15.0)).toBeCloseTo(3.0);
  });
});

describe("computeComputeCost", () => {
  it("returns 0 for zero inference time", () => {
    expect(computeComputeCost(0, 150, 0.12)).toBe(0);
  });

  it("computes cost for 1 hour at 150W and $0.12/kWh", () => {
    // 1h = 3_600_000ms, 150W = 0.15kW, 0.15kWh * $0.12 = $0.018
    expect(computeComputeCost(3_600_000, 150, 0.12)).toBeCloseTo(0.018);
  });

  it("computes cost for 10 minutes at 300W", () => {
    // 600_000ms = 1/6 hour, 300W = 0.3kW, (1/6)*0.3*0.12 = 0.006
    expect(computeComputeCost(600_000, 300, 0.12)).toBeCloseTo(0.006);
  });
});

describe("computeNextRunAt", () => {
  it("returns null for disabled schedule", () => {
    expect(computeNextRunAt("disabled", new Date())).toBeNull();
  });

  it("adds 1 day for daily", () => {
    const now = new Date("2026-03-12T00:00:00Z");
    const next = computeNextRunAt("daily", now);
    expect(next?.getTime()).toBe(now.getTime() + SCHEDULE_INTERVALS_MS.daily);
  });

  it("adds 7 days for weekly", () => {
    const now = new Date("2026-03-12T00:00:00Z");
    const next = computeNextRunAt("weekly", now);
    expect(next?.getTime()).toBe(now.getTime() + SCHEDULE_INTERVALS_MS.weekly);
  });

  it("adds 30 days for monthly", () => {
    const now = new Date("2026-03-12T00:00:00Z");
    const next = computeNextRunAt("monthly", now);
    expect(next?.getTime()).toBe(now.getTime() + SCHEDULE_INTERVALS_MS.monthly);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test 2>&1 | grep -E "FAIL|cannot find|ai-providers"
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the types and helper file**

Create `apps/web/lib/ai-provider-types.ts`:

```ts
// apps/web/lib/ai-provider-types.ts

// ─── Schedule helpers ─────────────────────────────────────────────────────────

export const SCHEDULE_INTERVALS_MS = {
  daily:   1 * 24 * 60 * 60 * 1000,
  weekly:  7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

export type ScheduleValue = "daily" | "weekly" | "monthly" | "disabled";

export function computeNextRunAt(schedule: string, from: Date): Date | null {
  if (schedule === "disabled") return null;
  const ms = SCHEDULE_INTERVALS_MS[schedule as keyof typeof SCHEDULE_INTERVALS_MS];
  if (ms === undefined) return null;
  return new Date(from.getTime() + ms);
}

// ─── Cost calculation ─────────────────────────────────────────────────────────

/** Token-priced provider cost (cloud APIs). */
export function computeTokenCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMToken: number,
  outputPricePerMToken: number,
): number {
  return (inputTokens / 1_000_000) * inputPricePerMToken
       + (outputTokens / 1_000_000) * outputPricePerMToken;
}

/** Compute-priced provider cost (local inference, e.g. Ollama). */
export function computeComputeCost(
  inferenceMs: number,
  computeWatts: number,
  electricityRateKwh: number,
): number {
  return (inferenceMs / 3_600_000) * (computeWatts / 1_000) * electricityRateKwh;
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ProviderRow = {
  id: string;
  providerId: string;
  name: string;
  families: string[];
  enabledFamilies: string[];
  status: string;
  costModel: string;
  authEndpoint: string | null;
  authHeader: string | null;
  endpoint: string | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
  computeWatts: number | null;
  electricityRateKwh: number | null;
};

export type CredentialRow = {
  providerId: string;
  secretRef: string | null;
  status: string;
};

export type ProviderWithCredential = {
  provider: ProviderRow;
  credential: CredentialRow | null;
};

export type SpendByProvider = {
  providerId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
};

export type SpendByAgent = {
  agentId: string;
  agentName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
};

export type ScheduledJobRow = {
  id: string;
  jobId: string;
  name: string;
  schedule: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
};

// ─── Registry JSON shape ──────────────────────────────────────────────────────

export type RegistryProviderEntry = {
  providerId: string;
  name: string;
  families: string[];
  authEndpoint: string | null;
  authHeader: string | null;
  costModel: string;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
  computeWatts?: number;
  electricityRateKwh?: number;
};
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
pnpm test 2>&1 | grep -E "PASS|FAIL|ai-providers"
```

Expected: `PASS apps/web/lib/ai-providers.test.ts` — all 11 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/ai-provider-types.ts apps/web/lib/ai-providers.test.ts
git commit -m "feat(web): add AI provider types and cost calculation helpers with tests"
```

---

### Task 3: Provider registry JSON

**Files:**
- Create: `packages/db/data/providers-registry.json`

- [ ] **Step 1: Create the registry file**

Create `packages/db/data/providers-registry.json`:

```json
[
  {
    "providerId": "anthropic",
    "name": "Anthropic",
    "families": ["claude-3-5", "claude-4"],
    "authEndpoint": "https://api.anthropic.com/v1/models",
    "authHeader": "x-api-key",
    "costModel": "token",
    "inputPricePerMToken": 3.00,
    "outputPricePerMToken": 15.00
  },
  {
    "providerId": "openai",
    "name": "OpenAI",
    "families": ["gpt-4o", "gpt-4-turbo", "gpt-4o-mini"],
    "authEndpoint": "https://api.openai.com/v1/models",
    "authHeader": "Authorization",
    "costModel": "token",
    "inputPricePerMToken": 2.50,
    "outputPricePerMToken": 10.00
  },
  {
    "providerId": "azure-openai",
    "name": "Azure OpenAI",
    "families": ["gpt-4o", "gpt-4-turbo"],
    "authEndpoint": null,
    "authHeader": "api-key",
    "costModel": "token",
    "inputPricePerMToken": 5.00,
    "outputPricePerMToken": 15.00
  },
  {
    "providerId": "gemini",
    "name": "Google Gemini",
    "families": ["gemini-1.5-pro", "gemini-2.0"],
    "authEndpoint": "https://generativelanguage.googleapis.com/v1/models",
    "authHeader": "x-goog-api-key",
    "costModel": "token",
    "inputPricePerMToken": 1.25,
    "outputPricePerMToken": 5.00
  },
  {
    "providerId": "ollama",
    "name": "Ollama (local)",
    "families": ["llama3", "mistral", "phi3", "gemma2"],
    "authEndpoint": "http://localhost:11434/api/tags",
    "authHeader": null,
    "costModel": "compute",
    "computeWatts": 150,
    "electricityRateKwh": 0.12
  },
  {
    "providerId": "bedrock",
    "name": "AWS Bedrock",
    "families": ["claude", "titan", "llama"],
    "authEndpoint": null,
    "authHeader": "Authorization",
    "costModel": "token",
    "inputPricePerMToken": 3.00,
    "outputPricePerMToken": 15.00
  }
]
```

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/db/data/providers-registry.json','utf8')); console.log('OK')"
```

Expected: `OK`

> **Note:** OpenAI uses `authHeader: "Authorization"` — the `testProviderAuth` action sends this value with the `Bearer ` prefix automatically for providers whose header is `Authorization`. AWS Bedrock uses SigV4 signing and cannot be tested via a simple header auth check; `testProviderAuth` will skip the check and return a configuration-only confirmation for Bedrock (`authEndpoint: null`).

- [ ] **Step 3: Commit**

```bash
git add packages/db/data/providers-registry.json
git commit -m "feat(db): add initial provider registry JSON with 6 providers"
```

---

### Task 4: Seed scheduled jobs

**Files:**
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: Add seedScheduledJobs function**

In `packages/db/src/seed.ts`, add this function before the `main()` function:

```ts
async function seedScheduledJobs(): Promise<void> {
  await prisma.scheduledJob.upsert({
    where:  { jobId: "provider-registry-sync" },
    create: {
      jobId:     "provider-registry-sync",
      name:      "Provider registry sync",
      schedule:  "weekly",
      nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    update: {
      // Only reset schedule — preserve operational state on re-seed
      schedule: "weekly",
    },
  });
  console.log("Seeded scheduled jobs");
}
```

- [ ] **Step 2: Call it from main()**

In the `main()` function, add `await seedScheduledJobs();` after `await seedDefaultAdminUser();`:

```ts
async function main(): Promise<void> {
  console.log("Starting seed...");
  await seedRoles();
  await seedPortfolios();
  await seedAgents();
  await seedTaxonomyNodes();
  await seedDigitalProducts();
  await seedEaArchimate4();
  await seedEaViewpoints();
  await seedEaViews();
  await seedDpfSelfRegistration();
  await seedThemeBrandingEpic();
  await seedDefaultAdminUser();
  await seedScheduledJobs();     // ← add this
  console.log("Seed complete.");
}
```

- [ ] **Step 3: Run seed to verify**

```bash
cd packages/db && npx prisma db seed
```

Expected: `Seeded scheduled jobs` in output, no errors

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(db): seed provider-registry-sync scheduled job"
```

---

## Chunk 2: Data Layer and Server Actions

### Task 5: Data fetchers

**Files:**
- Create: `apps/web/lib/ai-provider-data.ts`

- [ ] **Step 1: Create the fetchers file**

Create `apps/web/lib/ai-provider-data.ts`:

```ts
// apps/web/lib/ai-provider-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
import { cache } from "react";
import { prisma } from "@dpf/db";
import type {
  ProviderWithCredential,
  ProviderRow,
  SpendByProvider,
  SpendByAgent,
  ScheduledJobRow,
} from "./ai-provider-types";

export const getProviders = cache(async (): Promise<ProviderWithCredential[]> => {
  const providers = await prisma.modelProvider.findMany({ orderBy: { name: "asc" } });
  const credentials = await prisma.credentialEntry.findMany({
    where: { providerId: { in: providers.map((p) => p.providerId) } },
  });
  const credMap = new Map(credentials.map((c) => [c.providerId, c]));
  return providers.map((p) => ({
    provider: {
      ...p,
      families:        p.families as string[],
      enabledFamilies: p.enabledFamilies as string[],
    } satisfies ProviderRow,
    credential: credMap.get(p.providerId) ?? null,
  }));
});

export const getProviderById = cache(async (providerId: string): Promise<ProviderWithCredential | null> => {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return null;
  const credential = await prisma.credentialEntry.findUnique({ where: { providerId } });
  return {
    provider: {
      ...provider,
      families:        provider.families as string[],
      enabledFamilies: provider.enabledFamilies as string[],
    } satisfies ProviderRow,
    credential: credential ?? null,
  };
});

function monthRange(month: { year: number; month: number }): { gte: Date; lt: Date } {
  const gte = new Date(Date.UTC(month.year, month.month - 1, 1));
  const lt  = new Date(Date.UTC(month.year, month.month, 1));
  return { gte, lt };
}

export const getTokenSpendByProvider = cache(
  async (month: { year: number; month: number }): Promise<SpendByProvider[]> => {
    const range = monthRange(month);
    const rows = await prisma.tokenUsage.groupBy({
      by: ["providerId"],
      where: { createdAt: range },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    return rows.map((r) => ({
      providerId:        r.providerId,
      totalInputTokens:  r._sum.inputTokens  ?? 0,
      totalOutputTokens: r._sum.outputTokens ?? 0,
      totalCostUsd:      r._sum.costUsd      ?? 0,
    }));
  }
);

export const getTokenSpendByAgent = cache(
  async (month: { year: number; month: number }): Promise<SpendByAgent[]> => {
    const range = monthRange(month);
    const rows = await prisma.tokenUsage.groupBy({
      by: ["agentId"],
      where: { createdAt: range },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    });
    const agentIds = rows.map((r) => r.agentId);
    const agents = await prisma.agent.findMany({ where: { agentId: { in: agentIds } } });
    const agentMap = new Map(agents.map((a) => [a.agentId, a.name]));
    return rows.map((r) => ({
      agentId:           r.agentId,
      agentName:         agentMap.get(r.agentId) ?? r.agentId,
      totalInputTokens:  r._sum.inputTokens  ?? 0,
      totalOutputTokens: r._sum.outputTokens ?? 0,
      totalCostUsd:      r._sum.costUsd      ?? 0,
    }));
  }
);

export const getScheduledJobs = cache(async (): Promise<ScheduledJobRow[]> => {
  return prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } });
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "ai-provider"
```

Expected: no output (no errors in these files)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/ai-provider-data.ts
git commit -m "feat(web): add AI provider data fetchers"
```

---

### Task 6: Server actions

**Files:**
- Create: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Create the actions file**

Create `apps/web/lib/actions/ai-providers.ts`:

```ts
"use server";

import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  computeTokenCost,
  computeComputeCost,
  computeNextRunAt,
  type RegistryProviderEntry,
} from "@/lib/ai-provider-types";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function requireManageProviders(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
}

async function requireSession(): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
}

// ─── Registry sync ────────────────────────────────────────────────────────────

const REGISTRY_URL =
  "https://raw.githubusercontent.com/OpenDigitalProductFactory/opendigitalproductfactory/main/packages/db/data/providers-registry.json";

/**
 * Sync provider registry from GitHub. No auth guard — called from server component
 * on page load for any view_platform holder. Use triggerProviderSync() for the
 * admin button (which adds the manage_provider_connections check).
 */
export async function syncProviderRegistry(): Promise<{ added: number; updated: number; error?: string }> {
  const job = await prisma.scheduledJob.findUnique({ where: { jobId: "provider-registry-sync" } });
  let entries: RegistryProviderEntry[];

  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entries = (await res.json()) as RegistryProviderEntry[];
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    if (job) {
      await prisma.scheduledJob.update({
        where: { jobId: "provider-registry-sync" },
        data: { lastRunAt: new Date(), lastStatus: "error", lastError: error },
      });
    }
    return { added: 0, updated: 0, error };
  }

  let added = 0;
  let updated = 0;

  for (const entry of entries) {
    const existing = await prisma.modelProvider.findUnique({ where: { providerId: entry.providerId } });
    if (existing) {
      await prisma.modelProvider.update({
        where: { providerId: entry.providerId },
        data: {
          name:                 entry.name,
          families:             entry.families,
          authEndpoint:         entry.authEndpoint ?? null,
          authHeader:           entry.authHeader ?? null,
          costModel:            entry.costModel,
          ...(entry.inputPricePerMToken !== undefined  && { inputPricePerMToken:  entry.inputPricePerMToken }),
          ...(entry.outputPricePerMToken !== undefined && { outputPricePerMToken: entry.outputPricePerMToken }),
          ...(entry.computeWatts !== undefined         && { computeWatts:         entry.computeWatts }),
          ...(entry.electricityRateKwh !== undefined   && { electricityRateKwh:   entry.electricityRateKwh }),
          // status and enabledFamilies deliberately NOT updated — preserve admin config
        },
      });
      updated++;
    } else {
      await prisma.modelProvider.create({
        data: {
          providerId:          entry.providerId,
          name:                entry.name,
          families:            entry.families,
          enabledFamilies:     [],
          status:              "unconfigured",
          authEndpoint:        entry.authEndpoint ?? null,
          authHeader:          entry.authHeader ?? null,
          costModel:           entry.costModel,
          inputPricePerMToken:  entry.inputPricePerMToken ?? null,
          outputPricePerMToken: entry.outputPricePerMToken ?? null,
          computeWatts:        entry.computeWatts ?? null,
          electricityRateKwh:  entry.electricityRateKwh ?? null,
        },
      });
      added++;
    }
  }

  const now = new Date();
  if (job) {
    await prisma.scheduledJob.update({
      where: { jobId: "provider-registry-sync" },
      data: {
        lastRunAt:  now,
        lastStatus: "ok",
        lastError:  null,
        nextRunAt:  computeNextRunAt(job.schedule, now),
      },
    });
  }

  return { added, updated };
}

/** Admin button wrapper — requires manage_provider_connections. */
export async function triggerProviderSync(): Promise<{ added: number; updated: number; error?: string }> {
  await requireManageProviders();
  return syncProviderRegistry();
}

// ─── Configure provider ───────────────────────────────────────────────────────

export async function configureProvider(input: {
  providerId: string;
  enabledFamilies: string[];
  secretRef?: string;
  endpoint?: string;
  computeWatts?: number;
  electricityRateKwh?: number;
}): Promise<{ error?: string }> {
  await requireManageProviders();

  if (input.secretRef !== undefined) {
    await prisma.credentialEntry.upsert({
      where:  { providerId: input.providerId },
      create: { providerId: input.providerId, secretRef: input.secretRef, status: "pending" },
      update: { secretRef: input.secretRef, status: "pending" },
    });
  }

  await prisma.modelProvider.update({
    where: { providerId: input.providerId },
    data: {
      enabledFamilies: input.enabledFamilies,
      ...(input.endpoint !== undefined         && { endpoint:           input.endpoint }),
      ...(input.computeWatts !== undefined     && { computeWatts:       input.computeWatts }),
      ...(input.electricityRateKwh !== undefined && { electricityRateKwh: input.electricityRateKwh }),
    },
  });

  return {};
}

// ─── Test provider auth ───────────────────────────────────────────────────────

export async function testProviderAuth(providerId: string): Promise<{ ok: boolean; message: string }> {
  await requireManageProviders();

  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { ok: false, message: "Provider not found" };

  const credential = await prisma.credentialEntry.findUnique({ where: { providerId } });

  // Guard: keyed providers need a credential with a secretRef
  if (provider.authHeader !== null) {
    if (!credential || credential.secretRef === null) {
      return { ok: false, message: "No credential configured" };
    }
    if (process.env[credential.secretRef] === undefined) {
      return { ok: false, message: `Environment variable not set: ${credential.secretRef}` };
    }
  }

  // Guard: Azure OpenAI-style providers need a custom endpoint
  if (provider.authEndpoint === null && provider.endpoint === null) {
    return { ok: false, message: "Custom endpoint required" };
  }

  const authUrl = provider.endpoint
    ? `${provider.endpoint}/openai/models?api-version=2024-02-01`
    : (provider.authEndpoint as string);

  const headers: Record<string, string> = {};
  if (provider.authHeader !== null && credential?.secretRef) {
    const apiKey = process.env[credential.secretRef];
    if (apiKey !== undefined) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${apiKey}`
        : apiKey;
    }
  }

  try {
    const res = await fetch(authUrl, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });

    if (res.ok) {
      await prisma.modelProvider.update({ where: { providerId }, data: { status: "active" } });
      if (credential) {
        await prisma.credentialEntry.update({ where: { providerId }, data: { status: "ok" } });
      }
      return { ok: true, message: `Connected — HTTP ${res.status}` };
    } else {
      if (credential) {
        await prisma.credentialEntry.update({ where: { providerId }, data: { status: "error" } });
      }
      return { ok: false, message: `HTTP ${res.status} — ${res.statusText}` };
    }
  } catch (err) {
    if (credential) {
      await prisma.credentialEntry.update({ where: { providerId }, data: { status: "error" } });
    }
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

// ─── Scheduled jobs ───────────────────────────────────────────────────────────

export async function updateScheduledJob(input: { jobId: string; schedule: string }): Promise<void> {
  await requireManageProviders();
  const nextRunAt = computeNextRunAt(input.schedule, new Date());
  await prisma.scheduledJob.update({
    where: { jobId: input.jobId },
    data: { schedule: input.schedule, nextRunAt },
  });
}

export async function runScheduledJobNow(jobId: string): Promise<void> {
  await requireManageProviders();
  if (jobId === "provider-registry-sync") {
    await syncProviderRegistry();
    return;
  }
  console.warn(`runScheduledJobNow: unknown jobId "${jobId}"`);
}

// ─── Token usage logging ──────────────────────────────────────────────────────

export async function logTokenUsage(input: {
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs?: number;
}): Promise<void> {
  await requireSession();

  const provider = await prisma.modelProvider.findUnique({ where: { providerId: input.providerId } });

  let costUsd = 0;
  if (provider) {
    if (provider.costModel === "compute" && input.inferenceMs !== undefined) {
      costUsd = computeComputeCost(
        input.inferenceMs,
        provider.computeWatts ?? 150,
        provider.electricityRateKwh ?? 0.12,
      );
    } else if (provider.costModel === "token") {
      costUsd = computeTokenCost(
        input.inputTokens,
        input.outputTokens,
        provider.inputPricePerMToken ?? 0,
        provider.outputPricePerMToken ?? 0,
      );
    }
  }

  await prisma.tokenUsage.create({
    data: {
      agentId:     input.agentId,
      providerId:  input.providerId,
      contextKey:  input.contextKey,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      ...(input.inferenceMs !== undefined && { inferenceMs: input.inferenceMs }),
      costUsd,
    },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "ai-providers"
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "feat(web): add AI provider server actions (sync, configure, test, log)"
```

---

## Chunk 3: UI Pages and Components

### Task 7: Client components

**Files:**
- Create: `apps/web/components/platform/TokenSpendPanel.tsx`
- Create: `apps/web/components/platform/ScheduledJobsTable.tsx`

- [ ] **Step 1: Create TokenSpendPanel**

Create `apps/web/components/platform/TokenSpendPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { SpendByProvider, SpendByAgent } from "@/lib/ai-provider-types";

// Month selector (switching between months) is deferred to a later phase —
// TokenUsage will be empty in Phase 7A. Current month is fixed server-side.

type Props = {
  initialMonth: { year: number; month: number };
  byProvider: SpendByProvider[];
  byAgent: SpendByAgent[];
};

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function TokenSpendPanel({ initialMonth, byProvider, byAgent }: Props) {
  const [tab, setTab] = useState<"provider" | "agent">("provider");
  const totalCost = byProvider.reduce((s, r) => s + r.totalCostUsd, 0);
  const monthLabel = `${MONTH_NAMES[(initialMonth.month - 1) % 12]} ${initialMonth.year}`;

  const isEmpty = byProvider.length === 0 && byAgent.length === 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Token Spend — {monthLabel}
          </div>
          {!isEmpty && (
            <div style={{ color: "#e0e0ff", fontSize: 18, fontWeight: 700, marginTop: 2 }}>
              {formatCost(totalCost)} total
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["provider", "agent"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 9, padding: "2px 8px", borderRadius: 3, cursor: "pointer",
                background: tab === t ? "#2a2a50" : "transparent",
                border: `1px solid ${tab === t ? "#7c8cf8" : "#2a2a40"}`,
                color: tab === t ? "#7c8cf8" : "#555566",
              }}
            >
              {t === "provider" ? "By Provider" : "By Agent"}
            </button>
          ))}
        </div>
      </div>

      {isEmpty && (
        <p style={{ color: "#555566", fontSize: 11 }}>No spend data yet — token usage will appear here once agents are active.</p>
      )}

      {!isEmpty && tab === "provider" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {byProvider.map((r) => {
            const pct = totalCost > 0 ? Math.round((r.totalCostUsd / totalCost) * 100) : 0;
            return (
              <div key={r.providerId} style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: 6, padding: 10 }}>
                <div style={{ color: "#555566", fontSize: 9, marginBottom: 2 }}>{r.providerId}</div>
                <div style={{ color: "#e0e0ff", fontSize: 16, fontWeight: 700 }}>{formatCost(r.totalCostUsd)}</div>
                <div style={{ color: "#555566", fontSize: 9, marginTop: 2 }}>
                  {formatTokens(r.totalInputTokens)} in · {formatTokens(r.totalOutputTokens)} out
                </div>
                <div style={{ height: 4, background: "#2a2a40", borderRadius: 2, marginTop: 6 }}>
                  <div style={{ height: 4, background: "#4ade80", borderRadius: 2, width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isEmpty && tab === "agent" && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ color: "#555566", textAlign: "left" }}>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Agent</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Input</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Output</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {byAgent.map((r) => (
              <tr key={r.agentId} style={{ borderTop: "1px solid #2a2a40", color: "#e0e0ff" }}>
                <td style={{ padding: "6px 8px" }}>{r.agentName}</td>
                <td style={{ padding: "6px 8px", color: "#555566" }}>{formatTokens(r.totalInputTokens)}</td>
                <td style={{ padding: "6px 8px", color: "#555566" }}>{formatTokens(r.totalOutputTokens)}</td>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{formatCost(r.totalCostUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ScheduledJobsTable**

Create `apps/web/components/platform/ScheduledJobsTable.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateScheduledJob, runScheduledJobNow } from "@/lib/actions/ai-providers";
import type { ScheduledJobRow } from "@/lib/ai-provider-types";

type Props = { jobs: ScheduledJobRow[]; canWrite: boolean };

const SCHEDULES = ["daily", "weekly", "monthly", "disabled"] as const;

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ScheduledJobsTable({ jobs, canWrite }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleScheduleChange(jobId: string, schedule: string) {
    startTransition(async () => {
      await updateScheduledJob({ jobId, schedule });
      router.refresh();
    });
  }

  function handleRunNow(jobId: string) {
    startTransition(async () => {
      await runScheduledJobNow(jobId);
      router.refresh();
    });
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
      <thead>
        <tr style={{ color: "#555566", textAlign: "left" }}>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Job</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Schedule</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Last run</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Next run</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Status</th>
          <th style={{ padding: "4px 8px", fontWeight: 500 }} />
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.jobId} style={{ borderTop: "1px solid #2a2a40", color: "#e0e0ff" }}>
            <td style={{ padding: "6px 8px" }}>{job.name}</td>
            <td style={{ padding: "6px 8px" }}>
              {canWrite ? (
                <select
                  value={job.schedule}
                  disabled={isPending}
                  onChange={(e) => handleScheduleChange(job.jobId, e.target.value)}
                  style={{ background: "#1a1a2e", border: "1px solid #2a2a40", color: "#7c8cf8", fontSize: 9, padding: "1px 4px", borderRadius: 3 }}
                >
                  {SCHEDULES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <span style={{ color: "#7c8cf8" }}>{job.schedule}</span>
              )}
            </td>
            <td style={{ padding: "6px 8px", color: "#555566" }}>{formatDate(job.lastRunAt)}</td>
            <td style={{ padding: "6px 8px", color: "#555566" }}>{formatDate(job.nextRunAt)}</td>
            <td style={{ padding: "6px 8px" }}>
              {job.lastStatus === "ok"    && <span style={{ color: "#4ade80" }}>✓ ok</span>}
              {job.lastStatus === "error" && <span style={{ color: "#f87171" }}>✗ error</span>}
              {!job.lastStatus            && <span style={{ color: "#555566" }}>—</span>}
            </td>
            <td style={{ padding: "6px 8px", textAlign: "right" }}>
              {canWrite && (
                <button
                  onClick={() => handleRunNow(job.jobId)}
                  disabled={isPending}
                  style={{ color: "#7c8cf8", background: "none", border: "none", fontSize: 9, cursor: "pointer" }}
                >
                  Run now
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "platform/"
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/platform/
git commit -m "feat(web): add TokenSpendPanel and ScheduledJobsTable client components"
```

---

### Task 8: Provider detail form component

**Files:**
- Create: `apps/web/components/platform/ProviderDetailForm.tsx`

- [ ] **Step 1: Create the form component**

Create `apps/web/components/platform/ProviderDetailForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureProvider, testProviderAuth } from "@/lib/actions/ai-providers";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";

type Props = { pw: ProviderWithCredential; canWrite: boolean };

export function ProviderDetailForm({ pw, canWrite }: Props) {
  const { provider, credential } = pw;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [secretRef, setSecretRef]                 = useState(credential?.secretRef ?? "");
  const [endpoint, setEndpoint]                   = useState(provider.endpoint ?? "");
  const [computeWatts, setComputeWatts]           = useState(String(provider.computeWatts ?? 150));
  const [electricityRate, setElectricityRate]     = useState(String(provider.electricityRateKwh ?? 0.12));
  const [enabledFamilies, setEnabledFamilies]     = useState<string[]>(provider.enabledFamilies);
  const [testResult, setTestResult]               = useState<{ ok: boolean; message: string } | null>(null);
  const [saveMessage, setSaveMessage]             = useState<string | null>(null);

  const isKeyed      = provider.authHeader !== null;
  const needsEndpoint = provider.authEndpoint === null;
  const isCompute    = provider.costModel === "compute";

  function toggleFamily(family: string) {
    setEnabledFamilies((prev) =>
      prev.includes(family) ? prev.filter((f) => f !== family) : [...prev, family]
    );
  }

  function handleSave() {
    startTransition(async () => {
      const result = await configureProvider({
        providerId: provider.providerId,
        enabledFamilies,
        ...(isKeyed && secretRef ? { secretRef } : {}),
        ...(needsEndpoint && endpoint ? { endpoint } : {}),
        ...(isCompute ? { computeWatts: Number(computeWatts), electricityRateKwh: Number(electricityRate) } : {}),
      });
      setSaveMessage(result.error ? `Error: ${result.error}` : "Saved");
      router.refresh();
    });
  }

  function handleTest() {
    startTransition(async () => {
      const result = await testProviderAuth(provider.providerId);
      setTestResult(result);
      router.refresh();
    });
  }

  const statusColour = provider.status === "active" ? "#4ade80" : provider.status === "inactive" ? "#555566" : "#fbbf24";

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <span style={{ background: `${statusColour}20`, color: statusColour, fontSize: 9, padding: "2px 6px", borderRadius: 3 }}>
          {provider.status}
        </span>
        <span style={{ color: "#555566", fontSize: 10 }}>{provider.costModel === "compute" ? "compute-priced" : "token-priced"}</span>
      </div>

      {/* Enabled families */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: "#555566", fontSize: 10, marginBottom: 6 }}>Enabled model families</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {provider.families.map((f) => (
            <label key={f} style={{ display: "flex", alignItems: "center", gap: 4, cursor: canWrite ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={enabledFamilies.includes(f)}
                disabled={!canWrite || isPending}
                onChange={() => toggleFamily(f)}
              />
              <span style={{ fontSize: 10, color: "#e0e0ff" }}>{f}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom endpoint (Azure OpenAI etc.) */}
      {needsEndpoint && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>
            Custom endpoint URL
          </label>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={!canWrite || isPending}
            placeholder="https://my-resource.openai.azure.com"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4 }}
          />
        </div>
      )}

      {/* API key env var name */}
      {isKeyed && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>
            Environment variable name
          </label>
          <input
            value={secretRef}
            onChange={(e) => setSecretRef(e.target.value)}
            disabled={!canWrite || isPending}
            placeholder="ANTHROPIC_API_KEY"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4, fontFamily: "monospace" }}
          />
          <p style={{ color: "#555566", fontSize: 9, marginTop: 3 }}>
            Enter the name of the env var that holds the API key — not the key itself.
          </p>
        </div>
      )}

      {/* Compute settings */}
      {isCompute && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>GPU/CPU wattage</label>
            <input
              type="number"
              value={computeWatts}
              onChange={(e) => setComputeWatts(e.target.value)}
              disabled={!canWrite || isPending}
              style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4 }}
            />
          </div>
          <div>
            <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>Electricity rate ($/kWh)</label>
            <input
              type="number"
              step="0.01"
              value={electricityRate}
              onChange={(e) => setElectricityRate(e.target.value)}
              disabled={!canWrite || isPending}
              style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4 }}
            />
          </div>
        </div>
      )}

      {canWrite && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={handleSave}
            disabled={isPending}
            style={{ padding: "6px 14px", background: "#2a2a50", border: "1px solid #7c8cf8", color: "#7c8cf8", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >
            Save
          </button>
          <button
            onClick={handleTest}
            disabled={isPending}
            style={{ padding: "6px 14px", background: "transparent", border: "1px solid #2a2a40", color: "#e0e0ff", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >
            Test connection
          </button>
          {saveMessage && <span style={{ fontSize: 10, color: saveMessage.startsWith("Error") ? "#f87171" : "#4ade80" }}>{saveMessage}</span>}
          {testResult && (
            <span style={{ fontSize: 10, color: testResult.ok ? "#4ade80" : "#f87171" }}>
              {testResult.ok ? "✓" : "✗"} {testResult.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "ProviderDetailForm"
```

Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/ProviderDetailForm.tsx
git commit -m "feat(web): add ProviderDetailForm client component"
```

---

### Task 9: /platform/ai main page

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/page.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/app/(shell)/platform/ai/page.tsx`:

```tsx
// apps/web/app/(shell)/platform/ai/page.tsx
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProviders, getTokenSpendByProvider, getTokenSpendByAgent, getScheduledJobs } from "@/lib/ai-provider-data";
import { syncProviderRegistry, triggerProviderSync } from "@/lib/actions/ai-providers";
import { TokenSpendPanel } from "@/components/platform/TokenSpendPanel";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";

const STATUS_COLOURS: Record<string, string> = {
  active:        "#4ade80",
  unconfigured:  "#fbbf24",
  inactive:      "#555566",
};

export default async function PlatformAiPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections");

  // Auto-sync if due
  const jobs = await getScheduledJobs();
  const syncJob = jobs.find((j) => j.jobId === "provider-registry-sync");
  if (syncJob && syncJob.schedule !== "disabled" && syncJob.nextRunAt && syncJob.nextRunAt < new Date()) {
    await syncProviderRegistry();
  }

  const now = new Date();
  const currentMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  // Second getScheduledJobs() call — not deduplicated by React cache because
  // syncProviderRegistry() may have mutated the DB between the two calls.
  // freshJobs reflects the updated lastRunAt/nextRunAt after any auto-sync.
  const [providers, byProvider, byAgent, freshJobs] = await Promise.all([
    getProviders(),
    getTokenSpendByProvider(currentMonth),
    getTokenSpendByAgent(currentMonth),
    getScheduledJobs(),
  ]);

  const lastSync = freshJobs.find((j) => j.jobId === "provider-registry-sync")?.lastRunAt;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>AI Providers</h1>
        <p style={{ fontSize: 11, color: "#555566", marginTop: 2 }}>
          {providers.length} provider{providers.length !== 1 ? "s" : ""} registered
          {lastSync ? ` · last synced ${new Date(lastSync).toLocaleDateString()}` : ""}
        </p>
      </div>

      {/* Section 1: Provider Registry */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Providers</div>
          {canWrite && (
            <form action={triggerProviderSync}>
              <button
                type="submit"
                style={{ fontSize: 10, padding: "3px 10px", background: "transparent", border: "1px solid #2a2a40", color: "#555566", borderRadius: 3, cursor: "pointer" }}
              >
                ↻ Sync from registry
              </button>
            </form>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {providers.map(({ provider }) => {
            const colour = STATUS_COLOURS[provider.status] ?? "#555566";
            return (
              <div
                key={provider.providerId}
                style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderLeft: `3px solid ${colour}`, borderRadius: 6, padding: 10 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <span style={{ color: "#e0e0ff", fontWeight: 600, fontSize: 12 }}>{provider.name}</span>
                  <span style={{ background: `${colour}20`, color: colour, fontSize: 8, padding: "1px 5px", borderRadius: 3 }}>
                    {provider.status}
                  </span>
                </div>
                <div style={{ color: "#555566", fontSize: 9, marginBottom: 6 }}>
                  {provider.families.slice(0, 3).join(" · ")}
                  {provider.families.length > 3 ? " +more" : ""}
                </div>
                <Link
                  href={`/platform/ai/providers/${provider.providerId}`}
                  style={{ color: "#7c8cf8", fontSize: 9 }}
                >
                  Configure →
                </Link>
              </div>
            );
          })}
          {providers.length === 0 && (
            <p style={{ color: "#555566", fontSize: 11 }}>No providers registered. Click "Sync from registry" to import.</p>
          )}
        </div>
      </div>

      {/* Section 2: Token Spend */}
      <div style={{ marginBottom: 32 }}>
        <TokenSpendPanel initialMonth={currentMonth} byProvider={byProvider} byAgent={byAgent} />
      </div>

      {/* Section 3: Scheduled Jobs */}
      <div>
        <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
          Scheduled Jobs
        </div>
        <ScheduledJobsTable jobs={freshJobs} canWrite={canWrite} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "platform/ai"
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/\(shell\)/platform/ai/
git commit -m "feat(web): add /platform/ai page (provider grid, spend dashboard, scheduler)"
```

---

### Task 10: /platform/ai/providers/[providerId] detail page

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`

- [ ] **Step 1: Create the detail page**

Create `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`:

```tsx
// apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProviderById } from "@/lib/ai-provider-data";
import { ProviderDetailForm } from "@/components/platform/ProviderDetailForm";

type Props = { params: Promise<{ providerId: string }> };

export default async function ProviderDetailPage({ params }: Props) {
  const { providerId } = await params;
  const pw = await getProviderById(providerId);
  if (!pw) notFound();

  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections");

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link href="/platform/ai" style={{ color: "#555566", fontSize: 10 }}>← AI Providers</Link>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: "6px 0 2px" }}>{pw.provider.name}</h1>
        <p style={{ fontSize: 10, color: "#555566", margin: 0, fontFamily: "monospace" }}>{pw.provider.providerId}</p>
      </div>

      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: 8, padding: 20 }}>
        <ProviderDetailForm pw={pw} canWrite={canWrite} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "platform/ai/providers"
```

Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(shell)/platform/ai/providers/"
git commit -m "feat(web): add /platform/ai/providers/[providerId] detail page"
```

---

### Task 11: Update /platform page with AI Providers card

**Files:**
- Modify: `apps/web/app/(shell)/platform/page.tsx`

- [ ] **Step 1: Add AI Providers card**

In `apps/web/app/(shell)/platform/page.tsx`, read the file first to find the correct insertion point, then add a `Link` import if not already present, and add this block after the closing `</div>` of the capabilities grid (after the `{capabilities.length === 0 && ...}` line):

```tsx
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#e0e0ff", marginBottom: 12 }}>Platform Services</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          <Link
            href="/platform/ai"
            style={{
              display: "block",
              padding: 16,
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderLeft: "4px solid #7c8cf8",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            <p style={{ fontSize: 11, fontWeight: 600, color: "#e0e0ff", margin: "0 0 4px" }}>AI Providers</p>
            <p style={{ fontSize: 10, color: "#555566", margin: 0 }}>
              Provider registry, credentials, token spend
            </p>
          </Link>
        </div>
      </div>
```

- [ ] **Step 2: Verify TypeScript and run tests**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep -E "Error|error" | grep -v "branding\|Header"
pnpm test 2>&1 | tail -10
```

Expected: no new TypeScript errors; all tests passing (including the 11 new ai-providers tests)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(shell)/platform/page.tsx"
git commit -m "feat(web): add AI Providers link card to /platform page"
```

---

## Done

All tasks complete. Run full test suite one final time:

```bash
pnpm test
```

Expected: all tests passing, no TypeScript errors.
