# MCP Integrations Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally-cached, weekly-synced catalog of MCP integrations (Stripe, WordPress, AWS, Shopify, Mailchimp, etc.) pulled from the official MCP Registry and enriched from Glama.ai, browsable by business owners and queryable by the AI Coworker.

**Architecture:** The sync service fetches the full MCP Registry via paginated REST API, enriches each entry with Glama.ai metadata (ratings, logos, pricing), and upserts into a local `McpIntegration` table. The weekly schedule uses the existing `ScheduledJob` + `computeNextRunAt()` poll-on-request pattern — no background process needed. A `search_integrations` tool in `PLATFORM_TOOLS` lets the AI Coworker query the local catalog at runtime.

**Tech Stack:** Next.js 15 App Router server components, Prisma + PostgreSQL, Vitest, `fetch` for external API calls, existing `agentEventBus` for SSE progress, existing `ScheduledJob` scheduling pattern.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `apps/web/lib/mcp-catalog-types.ts` | TypeScript types for registry/Glama API responses; `ARCHETYPE_TAG_RULESET` config |
| `apps/web/lib/mcp-catalog-sync.ts` | Core sync logic — fetch, enrich, upsert, deprecate; no auth, no server directive |
| `apps/web/lib/actions/mcp-catalog.ts` | Server actions: `triggerMcpCatalogSync`, `queryMcpIntegrations`, `updateMcpCatalogSchedule` |
| `apps/web/lib/actions/mcp-catalog.test.ts` | Vitest tests for server actions |
| `apps/web/lib/mcp-catalog-sync.test.ts` | Vitest tests for sync service |
| `apps/web/app/(shell)/platform/integrations/page.tsx` | Catalog browser page (server component) |
| `apps/web/app/(shell)/platform/integrations/sync/page.tsx` | Sync management page (server component) |
| `apps/web/app/api/platform/integrations/sync-progress/[syncId]/route.ts` | SSE route for real-time sync progress |
| `apps/web/components/platform/IntegrationCard.tsx` | Single integration card (logo, name, badges) |
| `apps/web/components/platform/IntegrationCatalogFilters.tsx` | Filter bar + search input (client component) |
| `apps/web/components/platform/McpSyncButton.tsx` | Sync Now button with SSE progress display |

### Modified files
| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `McpIntegration` and `McpCatalogSync` models |
| `apps/web/lib/agent-event-bus.ts` | Add `sync:progress` event type to `AgentEvent` union |
| `apps/web/lib/mcp-tools.ts` | Add `search_integrations` to `PLATFORM_TOOLS`; add executor case in `executeTool` |
| `apps/web/lib/actions/ai-providers.ts` | Extend `runScheduledJobNow` to handle `"mcp-catalog-sync"` |

---

## Task 1: DB Schema — Add McpIntegration and McpCatalogSync

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add models to schema**

Open `packages/db/prisma/schema.prisma` and append these two models at the end of the file (after the last existing model):

```prisma
model McpIntegration {
  id               String   @id @default(cuid())
  registryId       String   @unique
  slug             String   @unique
  name             String
  shortDescription String?
  description      String?  @db.Text
  logoUrl          String?
  vendor           String?
  repositoryUrl    String?
  documentationUrl String?
  category         String
  subcategory      String?
  tags             String[]
  pricingModel     String?
  rating           Decimal?
  ratingCount      Int?
  installCount     Int?
  isVerified       Boolean  @default(false)
  archetypeIds     String[]
  status           String   @default("active")
  rawMetadata      Json
  lastSyncedAt     DateTime
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([category])
  @@index([pricingModel])
  @@index([isVerified])
  @@index([status])
  @@index([tags])
}

model McpCatalogSync {
  id                String    @id @default(cuid())
  triggeredBy       String
  triggeredByUserId String?
  startedAt         DateTime  @default(now())
  completedAt       DateTime?
  status            String    @default("running")
  totalFetched      Int?
  totalUpserted     Int?
  totalNew          Int?
  totalRemoved      Int?
  error             String?   @db.Text
}
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter @dpf/db exec prisma migrate dev --name add_mcp_integrations_catalog
```

Expected: Migration created and applied. `McpIntegration` and `McpCatalogSync` tables exist in the DB.

- [ ] **Step 3: Verify Prisma client regenerated**

```bash
pnpm --filter @dpf/db exec prisma generate
```

Expected: No errors. `prisma.mcpIntegration` and `prisma.mcpCatalogSync` are available.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add McpIntegration and McpCatalogSync models (EP-INT-001)"
```

---

## Task 2: Types and Tag→Archetype Ruleset

**Files:**
- Create: `apps/web/lib/mcp-catalog-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// apps/web/lib/mcp-catalog-types.ts

// ─── External API response shapes ────────────────────────────────────────────

/** Minimal shape returned by registry.modelcontextprotocol.io/v0/servers */
export interface RegistryServerEntry {
  id: string;
  name: string;
  description?: string;
  vendor?: string;
  repositoryUrl?: string;
  documentationUrl?: string;
  category?: string;
  subcategory?: string;
  tags?: string[];
  isVerified?: boolean;
}

/** Minimal shape returned by glama.ai/api/mcp/v1/servers/{id} */
export interface GlamaServerEntry {
  id: string;
  logoUrl?: string;
  rating?: number;
  ratingCount?: number;
  installCount?: number;
  pricingModel?: string;
}

// ─── Tag → Archetype ruleset ──────────────────────────────────────────────────

/**
 * Maps registry/Glama tags to StorefrontArchetype.archetypeId values.
 * Values must match the exact archetypeId strings seeded in StorefrontArchetype.
 * Update this config in the same PR as any archetype addition/removal.
 */
export const ARCHETYPE_TAG_RULESET: Record<string, string[]> = {
  // Payments / commerce
  payments:     ["retail-goods", "food-hospitality", "fitness-recreation", "education-training", "pet-grooming", "pet-care"],
  ecommerce:    ["retail-goods", "artisan-goods", "florist"],
  commerce:     ["retail-goods", "artisan-goods", "restaurant", "catering", "bakery"],
  pos:          ["retail-goods", "food-hospitality"],
  // Booking / scheduling
  booking:      ["veterinary-clinic", "dental-practice", "physiotherapy", "counselling", "optician", "hair-salon", "barber-shop", "nail-salon", "beauty-spa", "personal-trainer", "pet-grooming", "pet-care", "gym", "yoga-studio", "dance-studio"],
  scheduling:   ["veterinary-clinic", "dental-practice", "physiotherapy", "counselling", "optician", "hair-salon", "barber-shop"],
  calendar:     ["veterinary-clinic", "dental-practice", "corporate-training", "tutoring"],
  // Marketing / email
  email:        ["retail-goods", "fitness-recreation", "nonprofit-community", "charity", "sports-club"],
  marketing:    ["retail-goods", "food-hospitality", "fitness-recreation", "professional-services"],
  crm:          ["it-managed-services", "legal-services", "accounting", "marketing-agency", "consulting", "facilities-maintenance"],
  // Website / content
  cms:          ["retail-goods", "food-hospitality", "professional-services", "nonprofit-community"],
  wordpress:    ["retail-goods", "food-hospitality", "professional-services", "nonprofit-community"],
  // Cloud / infrastructure
  cloud:        ["it-managed-services", "consulting", "marketing-agency"],
  storage:      ["it-managed-services", "consulting"],
  // Source control
  git:          ["it-managed-services", "consulting", "corporate-training"],
  // Donations / nonprofit
  donations:    ["pet-rescue", "animal-shelter", "community-shelter", "charity", "sports-club"],
  nonprofit:    ["pet-rescue", "animal-shelter", "community-shelter", "charity", "sports-club"],
  // Communication
  messaging:    ["it-managed-services", "consulting", "facilities-maintenance"],
  slack:        ["it-managed-services", "consulting"],
  // Finance / accounting
  accounting:   ["accounting", "legal-services", "it-managed-services"],
  invoicing:    ["accounting", "it-managed-services", "consulting", "facilities-maintenance", "plumber", "electrician"],
};

/**
 * Derives archetypeIds for a set of tags using ARCHETYPE_TAG_RULESET.
 * Returns deduplicated array of matching archetypeId strings.
 */
export function deriveArchetypeIds(tags: string[]): string[] {
  const ids = new Set<string>();
  for (const tag of tags) {
    const matches = ARCHETYPE_TAG_RULESET[tag.toLowerCase()];
    if (matches) matches.forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}
```

- [ ] **Step 2: Write tests for deriveArchetypeIds**

Create `apps/web/lib/mcp-catalog-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deriveArchetypeIds } from "./mcp-catalog-types";

describe("deriveArchetypeIds", () => {
  it("returns matching archetype IDs for known tags", () => {
    const result = deriveArchetypeIds(["payments", "ecommerce"]);
    expect(result).toContain("retail-goods");
    expect(result).toContain("food-hospitality");
  });

  it("deduplicates when multiple tags map to the same archetype", () => {
    const result = deriveArchetypeIds(["payments", "ecommerce"]);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });

  it("returns empty array for unknown tags", () => {
    expect(deriveArchetypeIds(["unknowntag123"])).toEqual([]);
  });

  it("is case-insensitive for tags", () => {
    const lower = deriveArchetypeIds(["payments"]);
    const upper = deriveArchetypeIds(["PAYMENTS"]);
    expect(lower).toEqual(upper);
  });

  it("handles empty tags array", () => {
    expect(deriveArchetypeIds([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web vitest run apps/web/lib/mcp-catalog-types.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mcp-catalog-types.ts apps/web/lib/mcp-catalog-types.test.ts
git commit -m "feat(integrations): add MCP catalog types and tag→archetype ruleset (EP-INT-001)"
```

---

## Task 3: Sync Service

**Files:**
- Create: `apps/web/lib/mcp-catalog-sync.ts`
- Create: `apps/web/lib/mcp-catalog-sync.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `apps/web/lib/mcp-catalog-sync.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    mcpCatalogSync: {
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { runMcpCatalogSync } from "./mcp-catalog-sync";

const mockRegistryPage1 = {
  servers: [
    { id: "stripe-mcp", name: "Stripe", description: "Payments", tags: ["payments"], category: "finance", isVerified: true },
    { id: "wp-mcp", name: "WordPress", description: "CMS", tags: ["cms", "wordpress"], category: "cms", isVerified: false },
  ],
  nextCursor: null,
};

const mockGlamaStripe = { id: "stripe-mcp", logoUrl: "https://example.com/stripe.png", rating: 4.8, ratingCount: 120, pricingModel: "paid" };
const mockGlamaWp = { id: "wp-mcp", logoUrl: "https://example.com/wp.png", rating: 4.2, ratingCount: 80, pricingModel: "free" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mcpIntegration.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.mcpIntegration.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([]);
  vi.mocked(prisma.mcpCatalogSync.update).mockResolvedValue({} as never);

  // Mock fetch for registry and Glama
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("registry.modelcontextprotocol.io")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRegistryPage1) });
    }
    if (url.includes("glama.ai") && url.includes("stripe-mcp")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGlamaStripe) });
    }
    if (url.includes("glama.ai") && url.includes("wp-mcp")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGlamaWp) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  }));
});

describe("runMcpCatalogSync", () => {
  it("fetches from registry and upserts entries", async () => {
    await runMcpCatalogSync("sync-1");
    expect(prisma.mcpIntegration.upsert).toHaveBeenCalledTimes(2);
  });

  it("upserts Stripe with enriched Glama data", async () => {
    await runMcpCatalogSync("sync-1");
    const stripeCall = vi.mocked(prisma.mcpIntegration.upsert).mock.calls.find(
      (c) => c[0].where.registryId === "stripe-mcp"
    );
    expect(stripeCall).toBeDefined();
    expect(stripeCall![0].create.logoUrl).toBe("https://example.com/stripe.png");
    expect(stripeCall![0].create.rating).toBe(4.8);
    expect(stripeCall![0].create.pricingModel).toBe("paid");
  });

  it("derives archetypeIds from tags", async () => {
    await runMcpCatalogSync("sync-1");
    const stripeCall = vi.mocked(prisma.mcpIntegration.upsert).mock.calls.find(
      (c) => c[0].where.registryId === "stripe-mcp"
    );
    expect(stripeCall![0].create.archetypeIds).toContain("retail-goods");
  });

  it("marks entries absent from sync as deprecated", async () => {
    // Pre-existing entry not in this sync
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
      { registryId: "old-mcp" } as never,
    ]);
    await runMcpCatalogSync("sync-1");
    expect(prisma.mcpIntegration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active" }),
        data: { status: "deprecated" },
      })
    );
  });

  it("updates sync record to success on completion", async () => {
    await runMcpCatalogSync("sync-1");
    expect(prisma.mcpCatalogSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sync-1" },
        data: expect.objectContaining({ status: "success" }),
      })
    );
  });

  it("updates sync record to failed on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    await runMcpCatalogSync("sync-1");
    expect(prisma.mcpCatalogSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", error: "Network error" }),
      })
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter web vitest run apps/web/lib/mcp-catalog-sync.test.ts
```

Expected: FAIL — `mcp-catalog-sync.ts` does not exist yet.

- [ ] **Step 3: Implement the sync service**

Create `apps/web/lib/mcp-catalog-sync.ts`:

```typescript
// apps/web/lib/mcp-catalog-sync.ts
// Core MCP catalog sync logic. No "use server" — importable by actions and tests.

import { prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/agent-event-bus";
import { deriveArchetypeIds, type RegistryServerEntry, type GlamaServerEntry } from "@/lib/mcp-catalog-types";

const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0/servers";
const GLAMA_BASE = "https://glama.ai/api/mcp/v1/servers";
const PAGE_SIZE = 50;
const GLAMA_CONCURRENCY = 10;
const GLAMA_BATCH_DELAY_MS = 100;

async function fetchRegistryPage(cursor?: string): Promise<{ servers: RegistryServerEntry[]; nextCursor: string | null }> {
  const url = new URL(REGISTRY_BASE);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Registry API error: ${res.status}`);
  return res.json();
}

async function fetchGlamaEnrichment(registryId: string): Promise<GlamaServerEntry | null> {
  try {
    const res = await fetch(`${GLAMA_BASE}/${encodeURIComponent(registryId)}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function enrichBatch(entries: RegistryServerEntry[]): Promise<Map<string, GlamaServerEntry>> {
  const result = new Map<string, GlamaServerEntry>();
  for (let i = 0; i < entries.length; i += GLAMA_CONCURRENCY) {
    const batch = entries.slice(i, i + GLAMA_CONCURRENCY);
    const enriched = await Promise.all(batch.map((e) => fetchGlamaEnrichment(e.id)));
    batch.forEach((entry, idx) => {
      const g = enriched[idx];
      if (g) result.set(entry.id, g);
    });
    if (i + GLAMA_CONCURRENCY < entries.length) {
      await new Promise((r) => setTimeout(r, GLAMA_BATCH_DELAY_MS));
    }
  }
  return result;
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function runMcpCatalogSync(syncId: string): Promise<void> {
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalNew = 0;
  const syncedRegistryIds: string[] = [];

  try {
    // Collect all existing active IDs for deprecation comparison
    const existing = await prisma.mcpIntegration.findMany({
      where: { status: "active" },
      select: { registryId: true },
    });
    const existingIds = new Set(existing.map((e) => e.registryId));

    let cursor: string | undefined;
    do {
      const page = await fetchRegistryPage(cursor);
      const entries = page.servers;
      totalFetched += entries.length;

      const glamaMap = await enrichBatch(entries);

      for (const entry of entries) {
        const glama = glamaMap.get(entry.id);
        const archetypeIds = deriveArchetypeIds(entry.tags ?? []);
        const isNew = !existingIds.has(entry.id);
        if (isNew) totalNew++;

        await prisma.mcpIntegration.upsert({
          where: { registryId: entry.id },
          create: {
            registryId:      entry.id,
            slug:            toSlug(entry.name),
            name:            entry.name,
            shortDescription: entry.description?.slice(0, 160) ?? null,
            description:     entry.description ?? null,
            vendor:          entry.vendor ?? null,
            repositoryUrl:   entry.repositoryUrl ?? null,
            documentationUrl: entry.documentationUrl ?? null,
            category:        entry.category ?? "uncategorized",
            subcategory:     entry.subcategory ?? null,
            tags:            entry.tags ?? [],
            isVerified:      entry.isVerified ?? false,
            archetypeIds,
            status:          "active",
            rawMetadata:     entry as object,
            lastSyncedAt:    new Date(),
            // Glama enrichment
            logoUrl:         glama?.logoUrl ?? null,
            rating:          glama?.rating ?? null,
            ratingCount:     glama?.ratingCount ?? null,
            installCount:    glama?.installCount ?? null,
            pricingModel:    glama?.pricingModel ?? null,
          },
          update: {
            name:            entry.name,
            shortDescription: entry.description?.slice(0, 160) ?? null,
            description:     entry.description ?? null,
            vendor:          entry.vendor ?? null,
            repositoryUrl:   entry.repositoryUrl ?? null,
            documentationUrl: entry.documentationUrl ?? null,
            category:        entry.category ?? "uncategorized",
            subcategory:     entry.subcategory ?? null,
            tags:            entry.tags ?? [],
            isVerified:      entry.isVerified ?? false,
            archetypeIds,
            status:          "active",
            rawMetadata:     entry as object,
            lastSyncedAt:    new Date(),
            logoUrl:         glama?.logoUrl ?? null,
            rating:          glama?.rating ?? null,
            ratingCount:     glama?.ratingCount ?? null,
            installCount:    glama?.installCount ?? null,
            pricingModel:    glama?.pricingModel ?? null,
          },
        });

        syncedRegistryIds.push(entry.id);
        totalUpserted++;

        agentEventBus.emit(syncId, {
          type: "sync:progress",
          totalFetched,
          totalUpserted,
          totalNew,
        });
      }

      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    // Mark absent entries deprecated
    const { count: totalRemoved } = await prisma.mcpIntegration.updateMany({
      where: { status: "active", registryId: { notIn: syncedRegistryIds } },
      data: { status: "deprecated" },
    });

    await prisma.mcpCatalogSync.update({
      where: { id: syncId },
      data: { status: "success", completedAt: new Date(), totalFetched, totalUpserted, totalNew, totalRemoved },
    });

    agentEventBus.emit(syncId, { type: "done" });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    await prisma.mcpCatalogSync.update({
      where: { id: syncId },
      data: { status: "failed", completedAt: new Date(), error },
    });
    agentEventBus.emit(syncId, { type: "done" });
  }
}
```

- [ ] **Step 4: Run tests — verify passing**

```bash
pnpm --filter web vitest run apps/web/lib/mcp-catalog-sync.test.ts
```

Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/mcp-catalog-sync.ts apps/web/lib/mcp-catalog-sync.test.ts
git commit -m "feat(integrations): add MCP catalog sync service (EP-INT-001)"
```

---

## Task 4: AgentEvent — Add sync:progress Type

**Files:**
- Modify: `apps/web/lib/agent-event-bus.ts`

- [ ] **Step 1: Add sync:progress to AgentEvent union**

In `apps/web/lib/agent-event-bus.ts`, add one line to the `AgentEvent` union:

```typescript
// Before the closing semicolon of the AgentEvent type, add:
| { type: "sync:progress"; totalFetched: number; totalUpserted: number; totalNew: number }
```

The full union after the change:

```typescript
export type AgentEvent =
  | { type: "tool:start"; tool: string; iteration: number }
  | { type: "tool:complete"; tool: string; success: boolean }
  | { type: "phase:change"; buildId: string; phase: string }
  | { type: "brief:update"; buildId: string }
  | { type: "evidence:update"; buildId: string; field: string }
  | { type: "iteration"; iteration: number; toolCount: number }
  | { type: "test:step"; stepIndex: number; description: string; screenshot?: string; passed: boolean }
  | { type: "sync:progress"; totalFetched: number; totalUpserted: number; totalNew: number }
  | { type: "done" };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: No errors related to `agent-event-bus.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agent-event-bus.ts
git commit -m "feat(integrations): add sync:progress event type to AgentEvent (EP-INT-001)"
```

---

## Task 5: Server Actions

**Files:**
- Create: `apps/web/lib/actions/mcp-catalog.ts`
- Create: `apps/web/lib/actions/mcp-catalog.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/actions/mcp-catalog.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/mcp-catalog-sync", () => ({ runMcpCatalogSync: vi.fn() }));
vi.mock("@/lib/ai-provider-types", () => ({
  computeNextRunAt: vi.fn().mockReturnValue(new Date("2026-04-01")),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpCatalogSync: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    scheduledJob: {
      upsert: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    mcpIntegration: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { runMcpCatalogSync } from "@/lib/mcp-catalog-sync";
import { triggerMcpCatalogSync, queryMcpIntegrations, updateMcpCatalogSchedule } from "./mcp-catalog";

const mockAdminSession = {
  user: { id: "user-1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockAdminSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(prisma.mcpCatalogSync.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.mcpCatalogSync.create).mockResolvedValue({ id: "sync-1" } as never);
  vi.mocked(prisma.scheduledJob.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.scheduledJob.update).mockResolvedValue({} as never);
  vi.mocked(prisma.scheduledJob.findUnique).mockResolvedValue({ schedule: "weekly" } as never);
  vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([]);
  vi.mocked(prisma.mcpIntegration.count).mockResolvedValue(0);
  vi.mocked(runMcpCatalogSync).mockResolvedValue(undefined);
});

describe("triggerMcpCatalogSync", () => {
  it("rejects unauthenticated callers", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await triggerMcpCatalogSync();
    expect(result.ok).toBe(false);
  });

  it("rejects callers without manage_platform_settings", async () => {
    vi.mocked(can).mockReturnValue(false);
    const result = await triggerMcpCatalogSync();
    expect(result.ok).toBe(false);
  });

  it("rejects when sync already running", async () => {
    vi.mocked(prisma.mcpCatalogSync.findFirst).mockResolvedValue({ id: "running-1", status: "running" } as never);
    const result = await triggerMcpCatalogSync();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("already in progress");
  });

  it("creates a sync record and calls runMcpCatalogSync", async () => {
    const result = await triggerMcpCatalogSync();
    expect(prisma.mcpCatalogSync.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triggeredBy: "manual", triggeredByUserId: "user-1" }) })
    );
    expect(result.ok).toBe(true);
    expect(result.syncId).toBe("sync-1");
  });
});

describe("queryMcpIntegrations", () => {
  it("returns integrations matching query", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
      { id: "1", name: "Stripe", category: "finance", status: "active" } as never,
    ]);
    const result = await queryMcpIntegrations({ query: "stripe" });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Stripe");
  });

  it("filters by category", async () => {
    await queryMcpIntegrations({ query: "payment", category: "finance" });
    expect(prisma.mcpIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: "finance" }),
      })
    );
  });

  it("filters by pricingModel", async () => {
    await queryMcpIntegrations({ query: "anything", pricingModel: "free" });
    expect(prisma.mcpIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pricingModel: "free" }),
      })
    );
  });

  it("only returns active status entries", async () => {
    await queryMcpIntegrations({ query: "stripe" });
    expect(prisma.mcpIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active" }),
      })
    );
  });
});

describe("updateMcpCatalogSchedule", () => {
  it("rejects callers without manage_platform_settings", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(updateMcpCatalogSchedule("weekly")).rejects.toThrow("Unauthorized");
  });

  it("upserts the ScheduledJob with new schedule and nextRunAt", async () => {
    await updateMcpCatalogSchedule("monthly");
    expect(prisma.scheduledJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "mcp-catalog-sync" },
        update: expect.objectContaining({ schedule: "monthly" }),
      })
    );
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter web vitest run apps/web/lib/actions/mcp-catalog.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement server actions**

Create `apps/web/lib/actions/mcp-catalog.ts`:

```typescript
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { runMcpCatalogSync } from "@/lib/mcp-catalog-sync";
import { computeNextRunAt, type ScheduleValue } from "@/lib/ai-provider-types";

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function requireManagePlatform(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform_settings")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// ─── Sync ──────────────────────────────────────────────────────────────────────

export async function triggerMcpCatalogSync(): Promise<{ ok: boolean; message: string; syncId?: string }> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform_settings")) {
    return { ok: false, message: "Unauthorized" };
  }

  const running = await prisma.mcpCatalogSync.findFirst({ where: { status: "running" } });
  if (running) return { ok: false, message: "A sync is already in progress." };

  const sync = await prisma.mcpCatalogSync.create({
    data: { triggeredBy: "manual", triggeredByUserId: user.id },
  });

  // Update ScheduledJob lastRunAt
  await prisma.scheduledJob.update({
    where: { jobId: "mcp-catalog-sync" },
    data: { lastRunAt: new Date(), lastStatus: "running" },
  }).catch(() => {});

  // Fire sync without awaiting — the client subscribes to SSE on sync.id for real-time progress.
  // This is safe in Next.js Node runtime: Prisma's connection pool persists across requests,
  // so the void continuation can complete after the server action returns.
  void runMcpCatalogSync(sync.id).then(async () => {
    const job = await prisma.scheduledJob.findUnique({ where: { jobId: "mcp-catalog-sync" } });
    await prisma.scheduledJob.update({
      where: { jobId: "mcp-catalog-sync" },
      data: {
        lastStatus: "completed",
        lastRunAt: new Date(),
        nextRunAt: job ? computeNextRunAt(job.schedule, new Date()) : null,
      },
    }).catch(() => {});
  }).catch(() => {});

  return { ok: true, message: "Sync started.", syncId: sync.id };
}

// ─── Query ─────────────────────────────────────────────────────────────────────

export async function queryMcpIntegrations(params: {
  query: string;
  category?: string;
  archetypeId?: string;
  pricingModel?: string;
  limit?: number;
}) {
  const { query, category, archetypeId, pricingModel, limit = 20 } = params;

  return prisma.mcpIntegration.findMany({
    where: {
      status: "active",
      ...(category ? { category } : {}),
      ...(pricingModel ? { pricingModel } : {}),
      ...(archetypeId ? { archetypeIds: { has: archetypeId } } : {}),
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { shortDescription: { contains: query, mode: "insensitive" } },
        { tags: { has: query.toLowerCase() } },
      ],
    },
    select: {
      id: true, name: true, vendor: true, slug: true,
      shortDescription: true, category: true, pricingModel: true,
      rating: true, ratingCount: true, installCount: true, isVerified: true,
      documentationUrl: true, logoUrl: true, archetypeIds: true,
    },
    orderBy: [{ isVerified: "desc" }, { installCount: "desc" }],
    take: limit,
  });
}

// ─── Schedule management ───────────────────────────────────────────────────────

export async function updateMcpCatalogSchedule(schedule: ScheduleValue): Promise<void> {
  await requireManagePlatform();
  const nextRunAt = schedule === "disabled" ? null : computeNextRunAt(schedule, new Date());
  await prisma.scheduledJob.upsert({
    where: { jobId: "mcp-catalog-sync" },
    create: {
      jobId: "mcp-catalog-sync",
      name: "MCP Integrations Catalog Sync",
      schedule,
      nextRunAt,
    },
    update: { schedule, nextRunAt },
  });
}

// ─── Scheduled execution (called from page server component) ──────────────────

export async function runMcpCatalogSyncIfDue(): Promise<void> {
  const job = await prisma.scheduledJob.findUnique({ where: { jobId: "mcp-catalog-sync" } });
  if (!job || job.schedule === "disabled" || !job.nextRunAt || job.nextRunAt > new Date()) return;
  const running = await prisma.mcpCatalogSync.findFirst({ where: { status: "running" } });
  if (running) return;
  const sync = await prisma.mcpCatalogSync.create({ data: { triggeredBy: "schedule" } });
  await prisma.scheduledJob.update({
    where: { jobId: "mcp-catalog-sync" },
    data: { lastRunAt: new Date(), lastStatus: "running", nextRunAt: computeNextRunAt(job.schedule, new Date()) },
  });
  runMcpCatalogSync(sync.id).then(() =>
    prisma.scheduledJob.update({ where: { jobId: "mcp-catalog-sync" }, data: { lastStatus: "completed" } }).catch(() => {})
  ).catch(() => {});
}
```

- [ ] **Step 4: Run tests — verify passing**

```bash
pnpm --filter web vitest run apps/web/lib/actions/mcp-catalog.test.ts
```

Expected: All tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/mcp-catalog.ts apps/web/lib/actions/mcp-catalog.test.ts
git commit -m "feat(integrations): add mcp-catalog server actions (EP-INT-001)"
```

---

## Task 6: SSE Route for Sync Progress

**Files:**
- Create: `apps/web/app/api/platform/integrations/sync-progress/[syncId]/route.ts`

- [ ] **Step 1: Implement SSE route**

```typescript
// apps/web/app/api/platform/integrations/sync-progress/[syncId]/route.ts

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { agentEventBus } from "@/lib/agent-event-bus";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ syncId: string }> },
) {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { syncId } = await params;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

      const unsubscribe = agentEventBus.subscribe(syncId, (event) => {
        send(event);
        if (event.type === "done") {
          unsubscribe();
          controller.close();
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/platform/integrations/sync-progress/
git commit -m "feat(integrations): add SSE route for sync progress (EP-INT-001)"
```

---

## Task 7: Extend runScheduledJobNow + Register ScheduledJob

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Extend runScheduledJobNow**

In `apps/web/lib/actions/ai-providers.ts`, find `runScheduledJobNow` (around line 345). Add a case for `"mcp-catalog-sync"` before the `console.warn` fallthrough:

```typescript
export async function runScheduledJobNow(jobId: string): Promise<void> {
  await requireManageProviders();
  if (jobId === "provider-registry-sync") {
    await syncProviderRegistry();
    return;
  }
  if (jobId === "mcp-catalog-sync") {
    const { triggerMcpCatalogSync } = await import("@/lib/actions/mcp-catalog");
    await triggerMcpCatalogSync();
    return;
  }
  console.warn(`runScheduledJobNow: unknown jobId "${jobId}"`);
}
```

Note: dynamic import avoids circular dependency since `ai-providers.ts` is imported by the scheduler page that also uses mcp-catalog.

- [ ] **Step 2: Add ScheduledJob seed entry**

The seed file is `packages/db/src/seed.ts`. Find `seedScheduledJobs()` (around line 1064). Add the `mcp-catalog-sync` job upsert immediately after the `provider-registry-sync` upsert, following the exact same pattern:

```typescript
await prisma.scheduledJob.upsert({
  where:  { jobId: "mcp-catalog-sync" },
  create: {
    jobId:     "mcp-catalog-sync",
    name:      "MCP Integrations Catalog Sync",
    schedule:  "weekly",
    nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  },
  update: {
    // Only reset schedule — preserve operational state on re-seed
    schedule: "weekly",
  },
});
```

Then run the seed:

```bash
pnpm --filter @dpf/db exec prisma db seed
```

Expected: `mcp-catalog-sync` row appears in `ScheduledJob` table.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "feat(integrations): extend runScheduledJobNow for mcp-catalog-sync (EP-INT-001)"
```

---

## Task 8: search_integrations Tool

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Write the test first**

Add a new test file `apps/web/lib/mcp-tools-integrations.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: {
      findMany: vi.fn(),
    },
    // include all other tables that executeTool's switch touches to avoid undefined errors
    backlogItem: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn(), requireCap: vi.fn() }));
vi.mock("@/lib/semantic-memory", () => ({ storePlatformKnowledge: vi.fn() }));

import { prisma } from "@dpf/db";
import { executeTool } from "./mcp-tools";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
    {
      id: "1", name: "Stripe", vendor: "Stripe Inc", slug: "stripe",
      shortDescription: "Payments API", category: "finance", pricingModel: "paid",
      rating: 4.8, ratingCount: 100, isVerified: true,
      documentationUrl: "https://stripe.com/docs", logoUrl: null, archetypeIds: ["retail-goods"],
    } as never,
  ]);
});

describe("executeTool — search_integrations", () => {
  it("queries mcpIntegration and returns results", async () => {
    const result = await executeTool("search_integrations", { query: "payments" }, "user-1");
    expect(result.success).toBe(true);
    expect(result.data?.results).toHaveLength(1);
  });

  it("passes category filter to prisma query", async () => {
    await executeTool("search_integrations", { query: "pay", category: "finance" }, "user-1");
    expect(prisma.mcpIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: "finance" }) })
    );
  });

  it("returns empty results gracefully when nothing found", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([]);
    const result = await executeTool("search_integrations", { query: "nonexistent" }, "user-1");
    expect(result.success).toBe(true);
    expect(result.data?.results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter web vitest run apps/web/lib/mcp-tools-integrations.test.ts
```

Expected: FAIL — `search_integrations` case not in `executeTool`.

- [ ] **Step 3: Add tool definition to PLATFORM_TOOLS**

In `apps/web/lib/mcp-tools.ts`, find the `PLATFORM_TOOLS` array and add this entry (after the last existing tool):

```typescript
{
  name: "search_integrations",
  description: "Search the MCP integrations catalog for services relevant to a feature or business need. Use when the user asks what they can connect, or when researching integrations for a new feature.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you are looking for — e.g. 'payments', 'email marketing', 'booking calendar', 'source control'" },
      category: { type: "string", description: "Optional category filter — e.g. 'finance', 'cms', 'cloud', 'crm'" },
      archetypeId: { type: "string", description: "Optional archetype filter — returns integrations tagged as relevant to this archetype" },
      pricingModel: { type: "string", enum: ["free", "paid", "freemium", "open-source"], description: "Optional pricing filter" },
      limit: { type: "number", description: "Max results to return. Default 10." },
    },
    required: ["query"],
  },
  requiredCapability: null,
},
```

- [ ] **Step 4: Add executor case to executeTool**

In `apps/web/lib/mcp-tools.ts`, find the `executeTool` function switch statement and add a new case (before the `default:` case):

```typescript
case "search_integrations": {
  const results = await prisma.mcpIntegration.findMany({
    where: {
      status: "active",
      ...(typeof params["category"] === "string" ? { category: params["category"] } : {}),
      ...(typeof params["pricingModel"] === "string" ? { pricingModel: params["pricingModel"] } : {}),
      ...(typeof params["archetypeId"] === "string" ? { archetypeIds: { has: params["archetypeId"] } } : {}),
      OR: [
        { name: { contains: String(params["query"]), mode: "insensitive" } },
        { shortDescription: { contains: String(params["query"]), mode: "insensitive" } },
        { tags: { has: String(params["query"]).toLowerCase() } },
      ],
    },
    select: {
      name: true, vendor: true, shortDescription: true, category: true,
      pricingModel: true, rating: true, ratingCount: true, isVerified: true,
      documentationUrl: true, logoUrl: true, archetypeIds: true,
    },
    orderBy: [{ isVerified: "desc" }, { installCount: "desc" }],
    take: typeof params["limit"] === "number" ? params["limit"] : 10,
  });
  return { success: true, message: `Found ${results.length} integration(s).`, data: { results } };
}
```

- [ ] **Step 5: Run tests — verify passing**

```bash
pnpm --filter web vitest run apps/web/lib/mcp-tools-integrations.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools-integrations.test.ts
git commit -m "feat(integrations): add search_integrations tool to PLATFORM_TOOLS (EP-INT-001)"
```

---

## Task 9: UI Components

**Files:**
- Create: `apps/web/components/platform/IntegrationCard.tsx`
- Create: `apps/web/components/platform/IntegrationCatalogFilters.tsx`
- Create: `apps/web/components/platform/McpSyncButton.tsx`

- [ ] **Step 1: IntegrationCard**

```typescript
// apps/web/components/platform/IntegrationCard.tsx

type Integration = {
  name: string;
  vendor: string | null;
  shortDescription: string | null;
  category: string;
  pricingModel: string | null;
  rating: unknown;
  ratingCount: number | null;
  isVerified: boolean;
  documentationUrl: string | null;
  logoUrl: string | null;
};

const PRICING_BADGES: Record<string, string> = {
  free: "FREE",
  paid: "PAID",
  freemium: "FREEMIUM",
  "open-source": "OSS",
};

export function IntegrationCard({ integration }: { integration: Integration }) {
  const rating = typeof integration.rating === "number" ? integration.rating :
    integration.rating && typeof (integration.rating as { toNumber?: () => number }).toNumber === "function"
      ? (integration.rating as { toNumber: () => number }).toNumber()
      : null;

  return (
    <div className="border rounded-lg p-4 flex flex-col gap-2 hover:shadow-md transition-shadow bg-card">
      <div className="flex items-start gap-3">
        {integration.logoUrl ? (
          <img src={integration.logoUrl} alt="" className="w-10 h-10 rounded object-contain" />
        ) : (
          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
            {integration.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{integration.name}</span>
            {integration.isVerified && (
              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">✓ Verified</span>
            )}
            {integration.pricingModel && (
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                {PRICING_BADGES[integration.pricingModel] ?? integration.pricingModel.toUpperCase()}
              </span>
            )}
          </div>
          {integration.vendor && (
            <p className="text-xs text-muted-foreground">{integration.vendor}</p>
          )}
        </div>
      </div>

      {integration.shortDescription && (
        <p className="text-sm text-muted-foreground line-clamp-2">{integration.shortDescription}</p>
      )}

      <div className="flex items-center justify-between mt-auto pt-1">
        <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded">
          {integration.category}
        </span>
        <div className="flex items-center gap-3">
          {rating !== null && (
            <span className="text-xs text-muted-foreground">★ {rating.toFixed(1)}{integration.ratingCount ? ` (${integration.ratingCount})` : ""}</span>
          )}
          {integration.documentationUrl && (
            <a href={integration.documentationUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline">
              Docs →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: IntegrationCatalogFilters**

```typescript
// apps/web/components/platform/IntegrationCatalogFilters.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const CATEGORIES = ["finance", "cms", "cloud", "crm", "communication", "developer-tools", "marketing", "ecommerce", "productivity", "uncategorized"];
const PRICING = ["free", "paid", "freemium", "open-source"];

export function IntegrationCatalogFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.delete("page");
    startTransition(() => router.push(`?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <input
        type="search"
        placeholder="Search integrations…"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => update("q", e.target.value)}
        className="border rounded px-3 py-1.5 text-sm w-56"
      />
      <select
        value={searchParams.get("category") ?? ""}
        onChange={(e) => update("category", e.target.value)}
        className="border rounded px-3 py-1.5 text-sm"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        value={searchParams.get("pricing") ?? ""}
        onChange={(e) => update("pricing", e.target.value)}
        className="border rounded px-3 py-1.5 text-sm"
      >
        <option value="">Any pricing</option>
        {PRICING.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 3: McpSyncButton**

```typescript
// apps/web/components/platform/McpSyncButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerMcpCatalogSync } from "@/lib/actions/mcp-catalog";

export function McpSyncButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ fetched: number; upserted: number; isNew: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setError(null);
    setProgress({ fetched: 0, upserted: 0, isNew: 0 });

    startTransition(async () => {
      const result = await triggerMcpCatalogSync();
      if (!result.ok) {
        setError(result.message);
        setProgress(null);
        return;
      }

      // Subscribe to SSE for progress
      if (result.syncId) {
        const evtSource = new EventSource(`/api/platform/integrations/sync-progress/${result.syncId}`);
        evtSource.onmessage = (e) => {
          const event = JSON.parse(e.data);
          if (event.type === "sync:progress") {
            setProgress({ fetched: event.totalFetched, upserted: event.totalUpserted, isNew: event.totalNew });
          }
          if (event.type === "done") {
            evtSource.close();
            setProgress(null);
            router.refresh();
          }
        };
        evtSource.onerror = () => { evtSource.close(); setProgress(null); router.refresh(); };
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleSync}
        disabled={disabled || isPending}
        className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
      >
        {isPending ? "Syncing…" : "Sync Now"}
      </button>
      {progress && (
        <p className="text-xs text-muted-foreground">
          Fetched {progress.fetched} · Upserted {progress.upserted} · New {progress.isNew}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/platform/IntegrationCard.tsx apps/web/components/platform/IntegrationCatalogFilters.tsx apps/web/components/platform/McpSyncButton.tsx
git commit -m "feat(integrations): add IntegrationCard, filters, and sync button components (EP-INT-001)"
```

---

## Task 10: Pages

**Files:**
- Create: `apps/web/app/(shell)/platform/integrations/page.tsx`
- Create: `apps/web/app/(shell)/platform/integrations/sync/page.tsx`

- [ ] **Step 1: Catalog browser page**

```typescript
// apps/web/app/(shell)/platform/integrations/page.tsx

import { Suspense } from "react";
import { queryMcpIntegrations, runMcpCatalogSyncIfDue } from "@/lib/actions/mcp-catalog";
import { IntegrationCard } from "@/components/platform/IntegrationCard";
import { IntegrationCatalogFilters } from "@/components/platform/IntegrationCatalogFilters";
import { prisma } from "@dpf/db";

type SearchParams = Promise<{ q?: string; category?: string; pricing?: string; archetype?: string }>;

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  // Poll-on-request: fire sync if overdue (same pattern as providers page)
  await runMcpCatalogSyncIfDue();

  const { q = "", category, pricing, archetype } = await searchParams;

  const integrations = await queryMcpIntegrations({
    query: q,
    category,
    pricingModel: pricing,
    archetypeId: archetype,
    limit: 60,
  });

  const totalCount = await prisma.mcpIntegration.count({ where: { status: "active" } });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-muted-foreground text-sm">{totalCount.toLocaleString()} available · updated weekly from the MCP Registry</p>
        </div>
        <a href="/platform/integrations/sync" className="text-sm text-primary hover:underline">Manage sync →</a>
      </div>

      <Suspense>
        <IntegrationCatalogFilters />
      </Suspense>

      {integrations.length === 0 ? (
        <p className="text-muted-foreground text-sm py-12 text-center">No integrations found. Try a different search or run a sync.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {integrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Sync management page**

```typescript
// apps/web/app/(shell)/platform/integrations/sync/page.tsx

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { McpSyncButton } from "@/components/platform/McpSyncButton";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";
import { getScheduledJobs } from "@/lib/ai-provider-data";

export default async function IntegrationsSyncPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform_settings");

  const recentSyncs = await prisma.mcpCatalogSync.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  const jobs = await getScheduledJobs();
  const syncJob = jobs.filter((j) => j.jobId === "mcp-catalog-sync");
  const isRunning = recentSyncs.some((s) => s.status === "running");

  const lastSync = recentSyncs[0];

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Integrations Sync</h1>
        <p className="text-muted-foreground text-sm">Manages the weekly pull from the MCP Registry and Glama.ai.</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Status</h2>
        {lastSync ? (
          <div className="border rounded-lg p-4 space-y-1 text-sm">
            <p>Last sync: <strong>{new Date(lastSync.startedAt).toLocaleString()}</strong> — <span className={lastSync.status === "success" ? "text-green-600" : lastSync.status === "failed" ? "text-red-600" : "text-yellow-600"}>{lastSync.status}</span></p>
            {lastSync.totalFetched != null && <p>Fetched {lastSync.totalFetched} · Upserted {lastSync.totalUpserted} · New {lastSync.totalNew} · Removed {lastSync.totalRemoved}</p>}
            {lastSync.error && <p className="text-destructive text-xs">{lastSync.error}</p>}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No sync has run yet.</p>
        )}
        {canWrite && <McpSyncButton disabled={isRunning} />}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Schedule</h2>
        <ScheduledJobsTable jobs={syncJob} canWrite={canWrite} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sync History</h2>
        <table className="w-full text-sm border rounded-lg overflow-hidden">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Triggered by</th>
              <th className="text-left p-2">Fetched</th>
              <th className="text-left p-2">New</th>
              <th className="text-left p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentSyncs.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{new Date(s.startedAt).toLocaleDateString()}</td>
                <td className="p-2">{s.triggeredBy}</td>
                <td className="p-2">{s.totalFetched ?? "—"}</td>
                <td className="p-2">{s.totalNew ?? "—"}</td>
                <td className={`p-2 font-medium ${s.status === "success" ? "text-green-600" : s.status === "failed" ? "text-red-600" : "text-yellow-600"}`}>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(shell)/platform/integrations/
git commit -m "feat(integrations): add catalog browser and sync management pages (EP-INT-001)"
```

---

## Task 11: Shell Nav Link

**Files:**
- Modify: Shell nav component (find it first)

- [ ] **Step 1: Find the shell nav component**

```bash
grep -rl "platform/ai\|platform.*nav\|/platform" apps/web/components/shell/ apps/web/app/\(shell\)/ --include="*.tsx" | head -20
```

Look for the component that renders the sidebar/top nav links for the platform section.

- [ ] **Step 2: Add Integrations link**

Once found, add a nav link entry for Integrations alongside the existing platform links. Follow the exact pattern of existing entries. Example (adapt to match actual component structure):

```tsx
<NavLink href="/platform/integrations" icon={<PlugIcon />}>
  Integrations
</NavLink>
```

The link should sit adjacent to the AI Workforce (`/platform/ai`) nav entry.

- [ ] **Step 3: Verify the page is reachable**

Start the dev server and navigate to `http://localhost:3000/platform/integrations`. Page should render (empty catalog is fine — no sync has run yet).

```bash
pnpm --filter web dev
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(integrations): add Integrations nav link to shell (EP-INT-001)"
```

---

## Task 12: Smoke Test — End to End

- [ ] **Step 1: Run full test suite**

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web vitest run
```

Expected: All existing tests pass. New tests pass.

- [ ] **Step 2: TypeScript clean**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Manual smoke test in dev**

1. Navigate to `/platform/integrations/sync`
2. Click "Sync Now" — observe progress counter increment
3. Sync completes — history table shows new row
4. Navigate to `/platform/integrations` — catalog grid renders with cards
5. Type in search box — results filter
6. Change schedule dropdown — persists on refresh

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(EP-INT-001): MCP integrations catalog complete"
```
