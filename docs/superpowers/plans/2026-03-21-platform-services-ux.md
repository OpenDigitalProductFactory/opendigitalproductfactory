# EP-INF-010: Platform Services UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify provider routing and MCP tool routing into one coherent admin surface with categorized provider sections, enhanced detail pages, async operations visibility, and a tool inventory panel.

**Architecture:** Extend the existing `ServiceSection`/`ServiceRow` pattern to support four distinct provider categories on the grid page. Add a new section for activated MCP servers (`McpServer` table). Add new cached query functions in `ai-provider-data.ts` for recipes, async ops, model summaries, and tool inventory. Create focused presentational components for each new UI element (RecipePanel, OAuthConnectionStatus, AsyncOperationsTable, ToolInventoryPanel). All data already exists in the database — this is pure UI presentation work.

**Tech Stack:** Next.js 14 App Router, React Server Components, Prisma ORM (existing schema), Vitest, CSS custom properties (`--dpf-*` design tokens), inline styles (matching existing `ServiceRow`/`ServiceSection` pattern)

**Spec:** `docs/superpowers/specs/2026-03-21-platform-services-ux-design.md`

---

## Codebase Conventions

- **Styling:** Inline styles using CSS custom properties: `--dpf-bg`, `--dpf-surface-1`, `--dpf-surface-2`, `--dpf-border`, `--dpf-text`, `--dpf-muted`, `--dpf-accent` (#7c8cf8). Status colors: active=#4ade80, unconfigured=#fbbf24, inactive=#8888a0.
- **Data flow:** Server component pages fetch data via cached functions in `ai-provider-data.ts`, pass to client components as props. Client components use server actions from `lib/actions/*.ts` for mutations.
- **Test pattern:** Vitest with explicit imports (`import { describe, expect, it } from "vitest"`). Mock Prisma with `vi.mock("@dpf/db", ...)`. Pure function tests need no mocks.
- **Test command:** `pnpm --filter web exec vitest run <path>` (or `pnpm --filter web exec vitest run` for all)
- **Component pattern:** Provider grid uses `ServiceSection` (collapsible accordion) + `ServiceRow` (expandable row). MCP services page uses `ServiceCard` (card grid). Both patterns exist — follow whichever fits the section.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/components/platform/ModelClassBadge.tsx` | Reusable badge for modelClass values (reasoning, image_gen, embedding, etc.) |
| `apps/web/components/platform/OAuthConnectionStatus.tsx` | OAuth token status display with relative expiry and refresh indicator |
| `apps/web/components/platform/RecipePanel.tsx` | Collapsible execution recipe table for provider detail page |
| `apps/web/components/platform/McpServiceRow.tsx` | Row component for activated MCP servers in the providers grid |
| `apps/web/components/platform/AsyncOperationsTable.tsx` | Table displaying AsyncInferenceOp records with status indicators |
| `apps/web/components/platform/ToolInventoryPanel.tsx` | Combined view of all agent-facing tools (platform + MCP) |
| `apps/web/app/(shell)/platform/ai/operations/page.tsx` | Async operations monitoring page |
| `apps/web/lib/ai-provider-data.test.ts` | Tests for new cached query functions |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/ai-provider-data.ts` | Add `getProviderModelSummaries()`, `getRecipesForProvider()`, `getActivatedMcpServers()`, `getAsyncOperations()`, `getToolInventory()` |
| `apps/web/lib/ai-provider-types.ts` | Add `ProviderModelSummary`, `McpServerGridRow`, `RecipeRow`, `AsyncOpRow`, `ToolInventoryItem` types |
| `apps/web/app/(shell)/platform/ai/providers/page.tsx` | Fetch MCP servers + model summaries, render 4th section for activated MCP services |
| `apps/web/components/platform/ServiceRow.tsx` | Accept optional `modelSummary` prop, show model count + non-chat capability badges |
| `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` | Fetch recipes + model class counts, render RecipePanel + OAuthConnectionStatus + capability summary |
| `apps/web/components/platform/ModelCard.tsx` | Replace inline model class badge with shared `ModelClassBadge` (DRY, spec §2a) |
| `apps/web/components/platform/ProviderDetailForm.tsx` | Accept optional `credential` enhancement for OAuth status display |
| `apps/web/components/platform/AiTabNav.tsx` | Add "Operations" tab linking to `/platform/ai/operations` |

---

## Task 1: ModelClassBadge Shared Component

**Files:**
- Create: `apps/web/components/platform/ModelClassBadge.tsx`

- [ ] **Step 1: Create the ModelClassBadge component**

This is a pure presentational component. It maps `modelClass` strings to colored badges. Chat is the default and renders nothing (no badge). All other classes get a colored pill with emoji.

```tsx
// apps/web/components/platform/ModelClassBadge.tsx

const MODEL_CLASS_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  chat:       { label: "Chat",       emoji: "",   color: "" },
  reasoning:  { label: "Reasoning",  emoji: "🧠", color: "#a78bfa" },
  image_gen:  { label: "Image",      emoji: "🖼️", color: "#f97316" },
  embedding:  { label: "Embedding",  emoji: "📐", color: "#06b6d4" },
  audio:      { label: "Audio",      emoji: "🎤", color: "#ec4899" },
  speech:     { label: "Speech",     emoji: "🔊", color: "#8b5cf6" },
  video:      { label: "Video",      emoji: "🎬", color: "#ef4444" },
  moderation: { label: "Moderation", emoji: "🛡️", color: "#f59e0b" },
  realtime:   { label: "Realtime",   emoji: "⚡", color: "#10b981" },
  code:       { label: "Code",       emoji: "💻", color: "#6366f1" },
};

export function getModelClassConfig(modelClass: string) {
  return MODEL_CLASS_CONFIG[modelClass] ?? { label: modelClass, emoji: "", color: "var(--dpf-muted)" };
}

export function ModelClassBadge({ modelClass }: { modelClass: string }) {
  if (modelClass === "chat") return null;
  const cfg = getModelClassConfig(modelClass);
  if (!cfg.color) return null;
  return (
    <span
      title={`Model class: ${modelClass}`}
      style={{
        fontSize: 9,
        fontWeight: 700,
        color: cfg.color,
        background: `${cfg.color}18`,
        padding: "1px 5px",
        borderRadius: 3,
        whiteSpace: "nowrap",
      }}
    >
      {cfg.emoji} {cfg.label}
    </span>
  );
}

/** Render a row of badges for an array of non-chat model classes. */
export function ModelClassBadges({ classes }: { classes: string[] }) {
  const filtered = classes.filter((c) => c !== "chat");
  if (filtered.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {filtered.map((c) => (
        <ModelClassBadge key={c} modelClass={c} />
      ))}
    </span>
  );
}
```

- [ ] **Step 2: Verify the component renders correctly**

Open the dev server and import `ModelClassBadge` into any existing page temporarily, or check that the file has no TypeScript errors:

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors in `ModelClassBadge.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/ModelClassBadge.tsx
git commit -m "feat(EP-INF-010): add ModelClassBadge shared component

Reusable badge for modelClass values (reasoning, image_gen, embedding, etc.).
Chat is the default and renders nothing. All other classes get a colored pill."
```

---

## Task 2: Types for New Data Shapes

**Files:**
- Modify: `apps/web/lib/ai-provider-types.ts`

- [ ] **Step 1: Add new type exports to ai-provider-types.ts**

Append these types at the end of the file. They define the shapes returned by the new cached queries we'll add in Task 3.

```ts
// ── EP-INF-010: Platform Services UX types ──────────────────────────────────

/** Aggregated model summary for provider grid display. */
export type ProviderModelSummary = {
  totalModels: number;
  activeModels: number;
  nonChatClasses: string[];
};

/** Row shape for activated MCP servers on the providers grid. */
export type McpServerGridRow = {
  id: string;
  serverId: string;
  name: string;
  status: string;
  transport: string | null;
  healthStatus: string;
  lastHealthCheck: string | null;   // ISO string
  category: string | null;
  tags: string[];
  activatedBy: string | null;
  activatedAt: string | null;       // ISO string
  integrationName: string | null;
  integrationLogoUrl: string | null;
  integrationCategory: string | null;
  toolCount: number;
  enabledToolCount: number;
};

/** Row shape for execution recipes on the provider detail page. */
export type RecipeGridRow = {
  id: string;
  contractFamily: string;
  modelId: string;
  executionAdapter: string;
  status: string;
  version: number;
  origin: string;
};

/** Row shape for async inference operations. */
export type AsyncOpRow = {
  id: string;
  providerId: string;
  modelId: string;
  contractFamily: string;
  status: string;
  progressPct: number | null;
  progressMessage: string | null;
  errorMessage: string | null;
  createdAt: string;          // ISO string
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
};

/** Single item in the combined tool inventory. */
export type ToolInventoryItem = {
  name: string;
  source: string;
  type: "platform" | "mcp";
  enabled: boolean;
  gating: string | null;
  originalName?: string;      // For MCP tools: un-namespaced name
};
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/ai-provider-types.ts
git commit -m "feat(EP-INF-010): add type definitions for services UX data shapes

Types for ProviderModelSummary, McpServerGridRow, RecipeGridRow,
AsyncOpRow, and ToolInventoryItem."
```

---

## Task 3: Data Layer — New Cached Queries

**Files:**
- Modify: `apps/web/lib/ai-provider-data.ts`
- Create: `apps/web/lib/ai-provider-data.test.ts`

- [ ] **Step 1: Write tests for getProviderModelSummaries**

Create the test file. This tests the aggregation logic for model summaries. We mock Prisma to return known profiles and verify the summary shape.

```ts
// apps/web/lib/ai-provider-data.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock Prisma before imports
const mockPrisma = {
  modelProfile: {
    findMany: vi.fn(),
  },
  executionRecipe: {
    findMany: vi.fn(),
  },
  mcpServer: {
    findMany: vi.fn(),
  },
  mcpServerTool: {
    findMany: vi.fn(),
  },
  asyncInferenceOp: {
    findMany: vi.fn(),
  },
};

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

// Must mock React cache to be a passthrough (not available in test env)
vi.mock("react", () => ({ cache: (fn: any) => fn }));

import {
  getProviderModelSummaries,
  getRecipesForProvider,
  getActivatedMcpServers,
  getAsyncOperations,
} from "./ai-provider-data";

beforeEach(() => vi.clearAllMocks());

describe("getProviderModelSummaries", () => {
  it("aggregates model counts and non-chat classes per provider", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      { providerId: "openai", modelClass: "chat", modelStatus: "active" },
      { providerId: "openai", modelClass: "chat", modelStatus: "active" },
      { providerId: "openai", modelClass: "image_gen", modelStatus: "active" },
      { providerId: "openai", modelClass: "embedding", modelStatus: "retired" },
      { providerId: "anthropic", modelClass: "chat", modelStatus: "active" },
      { providerId: "anthropic", modelClass: "reasoning", modelStatus: "active" },
    ]);

    const result = await getProviderModelSummaries();

    expect(result.get("openai")).toEqual({
      totalModels: 4,
      activeModels: 3,
      nonChatClasses: ["image_gen", "embedding"],
    });
    expect(result.get("anthropic")).toEqual({
      totalModels: 2,
      activeModels: 2,
      nonChatClasses: [],   // reasoning is chat-adjacent, not "non-chat"
    });
  });

  it("returns empty map when no profiles exist", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([]);
    const result = await getProviderModelSummaries();
    expect(result.size).toBe(0);
  });
});

describe("getRecipesForProvider", () => {
  it("returns recipes sorted by contractFamily asc, version desc", async () => {
    const recipes = [
      { id: "r1", contractFamily: "sync.tool_action", modelId: "m1", executionAdapter: "chat", status: "champion", version: 2, origin: "seed" },
      { id: "r2", contractFamily: "sync.tool_action", modelId: "m1", executionAdapter: "chat", status: "retired", version: 1, origin: "seed" },
    ];
    mockPrisma.executionRecipe.findMany.mockResolvedValue(recipes);

    const result = await getRecipesForProvider("openai");
    expect(result).toHaveLength(2);
    expect(mockPrisma.executionRecipe.findMany).toHaveBeenCalledWith({
      where: { providerId: "openai" },
      orderBy: [{ contractFamily: "asc" }, { version: "desc" }],
    });
  });
});

describe("getActivatedMcpServers", () => {
  it("excludes deactivated servers", async () => {
    mockPrisma.mcpServer.findMany.mockResolvedValue([]);
    await getActivatedMcpServers();
    const call = mockPrisma.mcpServer.findMany.mock.calls[0][0];
    expect(call.where.deactivatedAt).toBeNull();
  });
});

describe("getAsyncOperations", () => {
  it("returns most recent 50 operations", async () => {
    mockPrisma.asyncInferenceOp.findMany.mockResolvedValue([]);
    await getAsyncOperations();
    expect(mockPrisma.asyncInferenceOp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, orderBy: { createdAt: "desc" } }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run lib/ai-provider-data.test.ts 2>&1 | tail -20`

Expected: FAIL — the new functions don't exist yet.

- [ ] **Step 3: Implement the cached queries in ai-provider-data.ts**

Add these functions at the end of `apps/web/lib/ai-provider-data.ts`, before the `groupByEndpointTypeAndCategory` function. Import the new types at the top.

Add to the existing import block at the top of the file:
```ts
import type {
  // ... existing imports ...
  ProviderModelSummary,
  RecipeGridRow,
  McpServerGridRow,
  AsyncOpRow,
  ToolInventoryItem,
} from "./ai-provider-types";
```

Add these functions before `groupByEndpointTypeAndCategory`:

```ts
// ── EP-INF-010: Platform Services UX queries ────────────────────────────────

/** Aggregate model counts and non-chat capability classes per provider. */
export const getProviderModelSummaries = cache(
  async (): Promise<Map<string, ProviderModelSummary>> => {
    const profiles = await prisma.modelProfile.findMany({
      select: { providerId: true, modelClass: true, modelStatus: true },
    });
    const map = new Map<string, ProviderModelSummary>();
    for (const p of profiles) {
      const s = map.get(p.providerId) ?? { totalModels: 0, activeModels: 0, nonChatClasses: [] };
      s.totalModels++;
      if (p.modelStatus === "active") s.activeModels++;
      // "reasoning" is chat-adjacent — only flag truly different modalities
      if (!["chat", "reasoning"].includes(p.modelClass) && !s.nonChatClasses.includes(p.modelClass)) {
        s.nonChatClasses.push(p.modelClass);
      }
      map.set(p.providerId, s);
    }
    return map;
  },
);

/** Execution recipes for a single provider (detail page). */
export const getRecipesForProvider = cache(
  async (providerId: string): Promise<RecipeGridRow[]> => {
    const rows = await prisma.executionRecipe.findMany({
      where: { providerId },
      orderBy: [{ contractFamily: "asc" }, { version: "desc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      contractFamily: r.contractFamily,
      modelId: r.modelId,
      executionAdapter: r.executionAdapter,
      status: r.status,
      version: r.version,
      origin: r.origin,
    }));
  },
);

/** Model class distribution for a single provider (detail page capability summary). */
export const getModelClassCounts = cache(
  async (providerId: string): Promise<{ modelClass: string; count: number }[]> => {
    const groups = await prisma.modelProfile.groupBy({
      by: ["modelClass"],
      where: { providerId },
      _count: true,
    });
    return groups
      .map((g) => ({ modelClass: g.modelClass, count: g._count }))
      .sort((a, b) => b.count - a.count);
  },
);

/** Activated MCP servers with tool counts for the providers grid (section 1d). */
export const getActivatedMcpServers = cache(
  async (): Promise<McpServerGridRow[]> => {
    const servers = await prisma.mcpServer.findMany({
      where: { deactivatedAt: null },
      include: {
        integration: {
          select: { name: true, logoUrl: true, category: true },
        },
        tools: { select: { isEnabled: true } },
      },
      orderBy: { name: "asc" },
    });
    return servers.map((s) => ({
      id: s.id,
      serverId: s.serverId,
      name: s.integration?.name ?? s.name,
      status: s.status,
      transport: s.transport,
      healthStatus: s.healthStatus,
      lastHealthCheck: s.lastHealthCheck?.toISOString() ?? null,
      category: s.category,
      tags: s.tags as string[],
      activatedBy: s.activatedBy,
      activatedAt: s.activatedAt?.toISOString() ?? null,
      integrationName: s.integration?.name ?? null,
      integrationLogoUrl: s.integration?.logoUrl ?? null,
      integrationCategory: s.integration?.category ?? null,
      toolCount: s.tools.length,
      enabledToolCount: s.tools.filter((t) => t.isEnabled).length,
    }));
  },
);

/** Recent async inference operations (operations page). */
export const getAsyncOperations = cache(
  async (): Promise<AsyncOpRow[]> => {
    const ops = await prisma.asyncInferenceOp.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return ops.map((o) => ({
      id: o.id,
      providerId: o.providerId,
      modelId: o.modelId,
      contractFamily: o.contractFamily,
      status: o.status,
      progressPct: o.progressPct,
      progressMessage: o.progressMessage,
      errorMessage: o.errorMessage,
      createdAt: o.createdAt.toISOString(),
      startedAt: o.startedAt?.toISOString() ?? null,
      completedAt: o.completedAt?.toISOString() ?? null,
      expiresAt: o.expiresAt.toISOString(),
    }));
  },
);

/** Combined tool inventory: platform built-in tools + MCP server tools. */
export const getToolInventory = cache(
  async (): Promise<ToolInventoryItem[]> => {
    const { PLATFORM_TOOLS } = await import("./mcp-tools");
    const platformItems: ToolInventoryItem[] = PLATFORM_TOOLS.map((t) => ({
      name: t.name,
      source: "Platform",
      type: "platform" as const,
      enabled: true,
      gating: t.requiredCapability ?? null,
    }));

    const mcpTools = await prisma.mcpServerTool.findMany({
      where: {
        server: {
          deactivatedAt: null,
          healthStatus: "healthy",
        },
      },
      include: { server: { select: { name: true, serverId: true } } },
    });
    const mcpItems: ToolInventoryItem[] = mcpTools.map((t) => ({
      name: `${t.server.serverId}__${t.toolName}`,
      source: t.server.name,
      type: "mcp" as const,
      enabled: t.isEnabled,
      gating: null,
      originalName: t.toolName,
    }));

    return [...platformItems, ...mcpItems];
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run lib/ai-provider-data.test.ts 2>&1 | tail -20`

Expected: All tests PASS

- [ ] **Step 5: Verify TypeScript compilation**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ai-provider-data.ts apps/web/lib/ai-provider-data.test.ts apps/web/lib/ai-provider-types.ts
git commit -m "feat(EP-INF-010): add cached queries for services UX data

getProviderModelSummaries, getRecipesForProvider, getModelClassCounts,
getActivatedMcpServers, getAsyncOperations, getToolInventory.
All server-only cached functions reading existing DB tables."
```

---

## Task 4: Provider Grid — MCP Services Section

**Files:**
- Create: `apps/web/components/platform/McpServiceRow.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`

- [ ] **Step 1: Create the McpServiceRow component**

This component renders a single activated MCP server as a row, matching the `ServiceRow` visual style but showing MCP-specific data: health status, transport badge, tool counts, and agent-facing namespace.

```tsx
// apps/web/components/platform/McpServiceRow.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { McpServerGridRow } from "@/lib/ai-provider-types";

const HEALTH_COLORS: Record<string, string> = {
  healthy:     "#4ade80",
  degraded:    "#fbbf24",
  unhealthy:   "#ef4444",
  unreachable: "#ef4444",
  unknown:     "#8888a0",
};

const TRANSPORT_LABELS: Record<string, string> = {
  stdio: "STDIO",
  sse:   "SSE",
  http:  "HTTP",
};

export function McpServiceRow({ server }: { server: McpServerGridRow }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const healthColor = HEALTH_COLORS[server.healthStatus] ?? HEALTH_COLORS.unknown;

  return (
    <div style={{ borderBottom: "1px solid var(--dpf-border, #2a2a40)" }}>
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          cursor: "pointer",
          background: hovered ? "var(--dpf-surface-2, #1a1a2e)" : "transparent",
          transition: "background 0.1s",
        }}
      >
        {/* Health dot */}
        <span
          title={server.healthStatus}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: healthColor,
            flexShrink: 0,
          }}
        />

        {/* Name */}
        <span
          style={{
            color: "var(--dpf-text)",
            fontSize: 11,
            fontWeight: 600,
            flex: "1 1 0",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {server.name}
        </span>

        {/* Transport badge */}
        {server.transport && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "#a78bfa",
              background: "#a78bfa18",
              padding: "1px 5px",
              borderRadius: 3,
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            {TRANSPORT_LABELS[server.transport] ?? server.transport}
          </span>
        )}

        {/* Tool count */}
        <span
          style={{
            fontSize: 10,
            color: "var(--dpf-muted)",
            flexShrink: 0,
            fontFamily: "monospace",
          }}
        >
          {server.enabledToolCount}/{server.toolCount} tools
        </span>

        {/* Category */}
        {server.integrationCategory && (
          <span
            className="hidden sm:inline"
            style={{ color: "var(--dpf-muted)", fontSize: 10, flexShrink: 0 }}
          >
            {server.integrationCategory}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            padding: "10px 14px 12px 26px",
            background: "var(--dpf-surface-1, #13131f)",
            borderTop: "1px solid var(--dpf-border, #2a2a40)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "6px 16px",
              marginBottom: 10,
            }}
          >
            <DetailItem label="Server ID" value={server.serverId} mono />
            <DetailItem label="Health" value={server.healthStatus} />
            <DetailItem label="Transport" value={server.transport ?? "—"} />
            <DetailItem
              label="Last Health Check"
              value={server.lastHealthCheck ? new Date(server.lastHealthCheck).toLocaleString() : "Never"}
            />
            <DetailItem label="Tool Namespace" value={`${server.serverId}__*`} mono />
            {server.activatedAt && (
              <DetailItem
                label="Activated"
                value={new Date(server.activatedAt).toLocaleDateString()}
              />
            )}
          </div>

          {/* Tags */}
          {server.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              <span style={{ color: "var(--dpf-muted)", fontSize: 10, marginRight: 4, alignSelf: "center" }}>Tags:</span>
              {server.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 10,
                    color: "#a0a0c0",
                    background: "#ffffff0a",
                    border: "1px solid var(--dpf-border)",
                    padding: "1px 6px",
                    borderRadius: 3,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Links */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link
              href={`/platform/services/${server.id}`}
              style={{ color: "var(--dpf-accent)", fontSize: 10 }}
            >
              Manage Tools →
            </Link>
            {server.integrationName && (
              <Link
                href="/platform/integrations"
                style={{ color: "var(--dpf-muted)", fontSize: 10 }}
              >
                View in Catalog
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: "var(--dpf-muted)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          color: "var(--dpf-muted)",
          fontSize: 10,
          fontFamily: mono ? "monospace" : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add MCP Services section to the providers page**

Modify `apps/web/app/(shell)/platform/ai/providers/page.tsx`:

1. Add import at top:
```ts
import { getActivatedMcpServers } from "@/lib/ai-provider-data";
import { McpServiceRow } from "@/components/platform/McpServiceRow";
```

2. Add `getActivatedMcpServers()` to the `Promise.all` on line 44:
```ts
const [providers, byProvider, byAgent, freshJobs, detected, mcpServers] = await Promise.all([
  getProviders(),
  getTokenSpendByProvider(currentMonth),
  getTokenSpendByAgent(currentMonth),
  prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } }),
  detectMcpServers(),
  getActivatedMcpServers(),
]);
```

3. After the existing provider groups `ServiceSection` rendering (after line 92's closing `</div>`), and before the Token Spend section, add a new section:

```tsx
{/* Section 1b: Activated MCP Services */}
{mcpServers.length > 0 && (
  <div style={{ marginBottom: 32 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Activated MCP Services
        <span style={{ color: "var(--dpf-muted)", fontWeight: 400, marginLeft: 6 }}>
          {mcpServers.length} service{mcpServers.length !== 1 ? "s" : ""}
        </span>
      </div>
      <Link
        href="/platform/integrations"
        style={{ color: "var(--dpf-accent)", fontSize: 10 }}
      >
        Browse Catalog →
      </Link>
    </div>
    <div
      style={{
        background: "var(--dpf-surface-1, #13131f)",
        border: "1px solid var(--dpf-border, #2a2a40)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {mcpServers.map((s) => (
        <McpServiceRow key={s.id} server={s} />
      ))}
    </div>
  </div>
)}

{mcpServers.length === 0 && (
  <div style={{ marginBottom: 32 }}>
    <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
      MCP Services
    </div>
    <div style={{
      background: "var(--dpf-surface-1)",
      border: "1px solid var(--dpf-border)",
      borderRadius: 6,
      padding: "20px 16px",
      textAlign: "center",
    }}>
      <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: 0 }}>
        No MCP services activated.{" "}
        <Link href="/platform/integrations" style={{ color: "var(--dpf-accent)" }}>
          Browse the integration catalog
        </Link>{" "}
        to activate services.
      </p>
    </div>
  </div>
)}
```

Also add the `Link` import if not already present: `import Link from "next/link";`

- [ ] **Step 3: Verify the page renders**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors. Then verify visually on the dev server at `/platform/ai/providers`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/platform/McpServiceRow.tsx apps/web/app/(shell)/platform/ai/providers/page.tsx
git commit -m "feat(EP-INF-010): add activated MCP services section to providers grid

New McpServiceRow component showing health, transport, tool counts, and
namespace. Empty state links to integration catalog."
```

---

## Task 5: ServiceRow — Model Count and Non-Chat Badges

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`
- Modify: `apps/web/components/platform/ServiceRow.tsx`

- [ ] **Step 1: Fetch model summaries in the providers page**

In `apps/web/app/(shell)/platform/ai/providers/page.tsx`:

1. Add import:
```ts
import { getProviderModelSummaries } from "@/lib/ai-provider-data";
```

2. Add to the `Promise.all`:
```ts
const [providers, byProvider, byAgent, freshJobs, detected, mcpServers, modelSummaries] = await Promise.all([
  getProviders(),
  getTokenSpendByProvider(currentMonth),
  getTokenSpendByAgent(currentMonth),
  prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } }),
  detectMcpServers(),
  getActivatedMcpServers(),
  getProviderModelSummaries(),
]);
```

3. Pass `modelSummaries` to `ServiceRow`:
```tsx
<ServiceRow key={pw.provider.providerId} pw={pw} modelSummary={modelSummaries.get(pw.provider.providerId)} />
```

- [ ] **Step 2: Add model count and capability badges to ServiceRow**

Modify `apps/web/components/platform/ServiceRow.tsx`:

1. Add import at top:
```ts
import type { ProviderModelSummary } from "@/lib/ai-provider-types";
import { ModelClassBadges } from "./ModelClassBadge";
```

2. Extend the `Props` type:
```ts
type Props = {
  pw: ProviderWithCredential;
  modelSummary?: ProviderModelSummary;
};
```

3. Update the component signature:
```ts
export function ServiceRow({ pw, modelSummary }: Props) {
```

4. Add model count badge after the type badge (`{typeLabel}` span), inside the collapsed row, before the sensitivity badges:

```tsx
{/* Model count — LLM only */}
{provider.endpointType === "llm" && modelSummary && (
  <span
    style={{
      fontSize: 10,
      color: "var(--dpf-muted)",
      flexShrink: 0,
      fontFamily: "monospace",
    }}
  >
    {modelSummary.activeModels}/{modelSummary.totalModels} models
  </span>
)}

{/* Non-chat capability badges — LLM only */}
{provider.endpointType === "llm" && modelSummary && modelSummary.nonChatClasses.length > 0 && (
  <span className="hidden sm:inline" style={{ flexShrink: 0 }}>
    <ModelClassBadges classes={modelSummary.nonChatClasses} />
  </span>
)}
```

- [ ] **Step 3: Verify compilation and rendering**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/platform/ServiceRow.tsx apps/web/app/(shell)/platform/ai/providers/page.tsx
git commit -m "feat(EP-INF-010): add model count and non-chat capability badges to ServiceRow

Shows '{active}/{total} models' and ModelClassBadges for providers with
image_gen, embedding, audio, etc. models."
```

---

## Task 6: OAuthConnectionStatus Component

**Files:**
- Create: `apps/web/components/platform/OAuthConnectionStatus.tsx`

- [ ] **Step 1: Create the component**

This displays OAuth token status with relative expiry time, refresh token indicator, and reconnect/disconnect actions. It receives credential data that's already available in the provider detail context.

```tsx
// apps/web/components/platform/OAuthConnectionStatus.tsx
"use client";

import type { CredentialRow } from "@/lib/ai-provider-types";

function relativeTime(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let label: string;
  if (days > 0) label = `${days}d ${hours % 24}h`;
  else if (hours > 0) label = `${hours}h ${minutes % 60}m`;
  else label = `${minutes}m`;

  return diff > 0 ? `expires in ${label}` : `expired ${label} ago`;
}

type Props = {
  credential: CredentialRow;
  authMethod: string;
  authorizeUrl: string | null;
  providerId: string;
};

export function OAuthConnectionStatus({ credential, authMethod, authorizeUrl, providerId }: Props) {
  if (authMethod !== "oauth2_authorization_code") return null;

  const isConnected = credential.status === "configured" && credential.tokenExpiresAt;
  const isExpired = credential.tokenExpiresAt
    ? new Date(credential.tokenExpiresAt).getTime() < Date.now()
    : false;

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        padding: "12px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        OAuth Connection
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Status indicator */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isConnected && !isExpired ? "#4ade80" : "#fbbf24",
            flexShrink: 0,
          }}
        />

        {/* Status text */}
        <span style={{ fontSize: 12, color: "var(--dpf-text)" }}>
          {isConnected && !isExpired
            ? `Connected · ${relativeTime(credential.tokenExpiresAt!)}`
            : isExpired
              ? "Token expired"
              : "Not connected"}
        </span>

        {/* Refresh token indicator */}
        {credential.hasRefreshToken && (
          <span
            style={{
              fontSize: 9,
              color: "#4ade80",
              background: "#4ade8018",
              padding: "1px 5px",
              borderRadius: 3,
            }}
          >
            auto-refresh
          </span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {(!isConnected || isExpired) && authorizeUrl && (
          <a
            href={`/api/oauth/authorize/${providerId}`}
            style={{
              fontSize: 11,
              color: "var(--dpf-accent)",
              padding: "4px 10px",
              border: "1px solid var(--dpf-accent)",
              borderRadius: 4,
              textDecoration: "none",
            }}
          >
            Sign in
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/OAuthConnectionStatus.tsx
git commit -m "feat(EP-INF-010): add OAuthConnectionStatus component

Displays OAuth token status with relative expiry, auto-refresh indicator,
and sign-in action for oauth2_authorization_code providers."
```

---

## Task 7: RecipePanel Component

**Files:**
- Create: `apps/web/components/platform/RecipePanel.tsx`

- [ ] **Step 1: Create the RecipePanel component**

A collapsible section showing execution recipes for a provider. Displays contract family, model, adapter, status, version, and origin in a compact table.

```tsx
// apps/web/components/platform/RecipePanel.tsx
"use client";

import { useState } from "react";
import type { RecipeGridRow } from "@/lib/ai-provider-types";

const STATUS_COLORS: Record<string, string> = {
  champion:   "#4ade80",
  challenger: "#fbbf24",
  retired:    "#8888a0",
};

const ADAPTER_LABELS: Record<string, string> = {
  chat:          "Chat",
  embedding:     "Embedding",
  image_gen:     "Image Gen",
  transcription: "Transcription",
  async:         "Async",
};

type Props = {
  recipes: RecipeGridRow[];
};

export function RecipePanel({ recipes }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (recipes.length === 0) return null;

  const championCount = recipes.filter((r) => r.status === "champion").length;
  const challengerCount = recipes.filter((r) => r.status === "challenger").length;

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        marginTop: 16,
        overflow: "hidden",
      }}
    >
      {/* Header (toggle) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}>
            Execution Recipes
          </span>
          <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
            {recipes.length} recipe{recipes.length !== 1 ? "s" : ""}
            {championCount > 0 && ` · ${championCount} champion`}
            {challengerCount > 0 && ` · ${challengerCount} challenger`}
          </span>
        </div>
        <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Table */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--dpf-border)", overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 11,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                {["Contract Family", "Model", "Adapter", "Status", "Ver", "Origin"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "6px 10px",
                      textAlign: "left",
                      color: "var(--dpf-muted)",
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid var(--dpf-border)" }}
                >
                  <td style={{ padding: "6px 10px", color: "var(--dpf-text)", fontFamily: "monospace" }}>
                    {r.contractFamily}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {r.modelId}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {ADAPTER_LABELS[r.executionAdapter] ?? r.executionAdapter}
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: STATUS_COLORS[r.status] ?? "#8888a0",
                        background: `${STATUS_COLORS[r.status] ?? "#8888a0"}18`,
                        padding: "1px 5px",
                        borderRadius: 3,
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)", textAlign: "center" }}>
                    v{r.version}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {r.origin}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/RecipePanel.tsx
git commit -m "feat(EP-INF-010): add RecipePanel component

Collapsible table showing execution recipes with contract family, model,
adapter, champion/challenger status, version, and origin."
```

---

## Task 8: Provider Detail Page — Wire New Components

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`
- Modify: `apps/web/components/platform/ModelCard.tsx` (DRY: replace inline badge with shared ModelClassBadge)

- [ ] **Step 1: Replace inline model class badge in ModelCard with shared ModelClassBadge**

`ModelCard.tsx` has its own `MODEL_CLASS_COLOURS` map and `modelClassColour()` function (lines 40-50). Replace this with the shared `ModelClassBadge` component from Task 1. This covers spec section 2a ("modelClass column in model table").

1. Add import at top of `apps/web/components/platform/ModelCard.tsx`:
```ts
import { ModelClassBadge } from "./ModelClassBadge";
```

2. Remove the `MODEL_CLASS_COLOURS` constant and `modelClassColour()` function (lines ~40-50).

3. Remove the local `classLabel` and `classColour` variables (around line 263-264):
```ts
// REMOVE these lines:
// const classLabel = profile.modelClass ?? "chat";
// const classColour = modelClassColour(classLabel);
```

4. Replace the badge rendering (around line 307) from:
```tsx
<Badge label={classLabel} colour={classColour} />
```
to:
```tsx
<ModelClassBadge modelClass={profile.modelClass ?? "chat"} />
```

- [ ] **Step 2: Add data fetching for recipes, model class counts, and credential**

In `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`:

1. Add imports at top:
```ts
import { getRecipesForProvider, getModelClassCounts } from "@/lib/ai-provider-data";
import { RecipePanel } from "@/components/platform/RecipePanel";
import { OAuthConnectionStatus } from "@/components/platform/OAuthConnectionStatus";
```

2. Add the new queries to the `Promise.all` on line 19:
```ts
const [pw, models, profiles, allProviders, perfData, routingProfiles, routeDecisions, recipes, modelClassCounts] = await Promise.all([
  getProviderById(providerId),
  getDiscoveredModels(providerId),
  getModelProfiles(providerId),
  getProviders(),
  getEndpointPerformance(providerId),
  getRoutingProfiles(providerId),
  getRecentRouteDecisions(providerId),
  getRecipesForProvider(providerId),
  getModelClassCounts(providerId),
]);
```

- [ ] **Step 2: Add capability summary to the page header**

After the `docsUrl` / `consoleUrl` links div (around line 67), add a capability summary line:

```tsx
{/* Capability summary */}
{modelClassCounts.length > 0 && (
  <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 6 }}>
    Capabilities: {modelClassCounts.map((c, i) => (
      <span key={c.modelClass}>
        {i > 0 && " · "}
        {c.modelClass === "chat" ? "Chat" : c.modelClass === "reasoning" ? "Reasoning" : c.modelClass.replace("_", " ")}
        {" "}({c.count})
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 3: Add OAuthConnectionStatus before the ProviderDetailForm**

Inside the LLM provider branch (around line 100, just before `<ProviderDetailForm ...>`), add:

```tsx
{pw.credential && (
  <OAuthConnectionStatus
    credential={pw.credential}
    authMethod={pw.provider.authMethod}
    authorizeUrl={pw.provider.authorizeUrl}
    providerId={pw.provider.providerId}
  />
)}
```

- [ ] **Step 4: Add RecipePanel after the ProviderDetailForm container**

After the closing `</div>` of the ProviderDetailForm wrapper (after line 103), add:

```tsx
{/* Execution Recipes */}
<RecipePanel recipes={recipes} />
```

- [ ] **Step 5: Verify compilation and rendering**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors. Then verify visually at `/platform/ai/providers/{any-provider-id}`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx
git commit -m "feat(EP-INF-010): wire RecipePanel, OAuthConnectionStatus, and capability summary into provider detail

Shows model class distribution, OAuth token status, and execution recipes
on the provider detail page."
```

---

## Task 9: Async Operations Page + Navigation Tab

**Files:**
- Create: `apps/web/components/platform/AsyncOperationsTable.tsx`
- Create: `apps/web/app/(shell)/platform/ai/operations/page.tsx`
- Modify: `apps/web/components/platform/AiTabNav.tsx`

- [ ] **Step 1: Create the AsyncOperationsTable component**

```tsx
// apps/web/components/platform/AsyncOperationsTable.tsx
"use client";

import type { AsyncOpRow } from "@/lib/ai-provider-types";

const STATUS_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  pending:   { emoji: "⏳", color: "#8888a0", label: "Pending" },
  running:   { emoji: "🔵", color: "#3b82f6", label: "Running" },
  completed: { emoji: "✅", color: "#4ade80", label: "Completed" },
  failed:    { emoji: "❌", color: "#ef4444", label: "Failed" },
  expired:   { emoji: "⏰", color: "#fbbf24", label: "Expired" },
  cancelled: { emoji: "🚫", color: "#8888a0", label: "Cancelled" },
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

type Props = {
  operations: AsyncOpRow[];
};

export function AsyncOperationsTable({ operations }: Props) {
  if (operations.length === 0) {
    return (
      <div style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        padding: "20px 16px",
        textAlign: "center",
      }}>
        <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: 0 }}>
          No async operations recorded yet. Deep Research and other long-running operations will appear here.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
              {["ID", "Provider", "Model", "Status", "Progress", "Created", "Completed/Expires"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 10px",
                    textAlign: "left",
                    color: "var(--dpf-muted)",
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => {
              const cfg = STATUS_CONFIG[op.status] ?? STATUS_CONFIG.pending;
              return (
                <tr key={op.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)", fontFamily: "monospace", fontSize: 10 }}>
                    {op.id.slice(0, 8)}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-text)" }}>
                    {op.providerId}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {op.modelId}
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <span style={{ color: cfg.color }}>
                      {cfg.emoji} {cfg.label}
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    {op.status === "running" && op.progressPct != null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 4, background: "var(--dpf-border)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${op.progressPct}%`, height: "100%", background: "#3b82f6", borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{op.progressPct}%</span>
                      </div>
                    ) : op.progressMessage ? (
                      <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>{op.progressMessage}</span>
                    ) : op.status === "failed" && op.errorMessage ? (
                      <span style={{ color: "#ef4444", fontSize: 10 }} title={op.errorMessage}>
                        {op.errorMessage.slice(0, 50)}{op.errorMessage.length > 50 ? "..." : ""}
                      </span>
                    ) : (
                      <span style={{ color: "var(--dpf-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {formatRelative(op.createdAt)}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {op.completedAt
                      ? formatRelative(op.completedAt)
                      : `expires ${formatRelative(op.expiresAt)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the operations page**

```tsx
// apps/web/app/(shell)/platform/ai/operations/page.tsx
import { getAsyncOperations } from "@/lib/ai-provider-data";
import { AsyncOperationsTable } from "@/components/platform/AsyncOperationsTable";
import { AiTabNav } from "@/components/platform/AiTabNav";

export default async function OperationsPage() {
  const operations = await getAsyncOperations();

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Async Operations
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          {operations.length} operation{operations.length !== 1 ? "s" : ""} recorded
        </p>
      </div>

      <AiTabNav />

      <AsyncOperationsTable operations={operations} />
    </div>
  );
}
```

- [ ] **Step 3: Add "Operations" tab to AiTabNav**

In `apps/web/components/platform/AiTabNav.tsx`, add a new entry to the `TABS` array:

```ts
const TABS = [
  { label: "Workforce", href: "/platform/ai" },
  { label: "External Services", href: "/platform/ai/providers" },
  { label: "Route Log", href: "/platform/ai/routing" },
  { label: "Operations", href: "/platform/ai/operations" },
  { label: "Action History", href: "/platform/ai/history" },
];
```

- [ ] **Step 4: Verify compilation**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/platform/AsyncOperationsTable.tsx apps/web/app/(shell)/platform/ai/operations/page.tsx apps/web/components/platform/AiTabNav.tsx
git commit -m "feat(EP-INF-010): add async operations page with monitoring table

New /platform/ai/operations page showing AsyncInferenceOp records with
status indicators, progress bars, and relative timestamps.
Adds Operations tab to AiTabNav."
```

---

## Task 10: Tool Inventory Panel

**Files:**
- Create: `apps/web/components/platform/ToolInventoryPanel.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`

- [ ] **Step 1: Create the ToolInventoryPanel component**

A collapsible panel showing all tools available to agents — both platform built-in tools and MCP server tools. Shows the namespaced name the agent uses, the source, and whether the tool is enabled.

```tsx
// apps/web/components/platform/ToolInventoryPanel.tsx
"use client";

import { useState } from "react";
import type { ToolInventoryItem } from "@/lib/ai-provider-types";

type Props = {
  tools: ToolInventoryItem[];
};

export function ToolInventoryPanel({ tools }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");

  const platformCount = tools.filter((t) => t.type === "platform").length;
  const mcpCount = tools.filter((t) => t.type === "mcp").length;

  const filtered = filter
    ? tools.filter(
        (t) =>
          t.name.toLowerCase().includes(filter.toLowerCase()) ||
          t.source.toLowerCase().includes(filter.toLowerCase()),
      )
    : tools;

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}>
            Agent Tool Inventory
          </span>
          <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
            {platformCount} platform · {mcpCount} MCP · {tools.length} total
          </span>
        </div>
        <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--dpf-border)" }}>
          {/* Search */}
          <div style={{ padding: "8px 16px" }}>
            <input
              type="text"
              placeholder="Filter tools..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "4px 8px",
                fontSize: 11,
                background: "var(--dpf-bg)",
                border: "1px solid var(--dpf-border)",
                borderRadius: 4,
                color: "var(--dpf-text)",
                outline: "none",
              }}
            />
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  {["Tool Name", "Source", "Type", "Enabled", "Gating"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "6px 10px",
                        textAlign: "left",
                        color: "var(--dpf-muted)",
                        fontSize: 9,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.name} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ color: "var(--dpf-text)", fontFamily: "monospace", fontSize: 10 }}>
                        {t.name}
                      </span>
                      {t.originalName && (
                        <span style={{ color: "var(--dpf-muted)", fontSize: 9, marginLeft: 6 }}>
                          ({t.originalName})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                      {t.source}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: t.type === "platform" ? "#7c8cf8" : "#a78bfa",
                          background: t.type === "platform" ? "#7c8cf818" : "#a78bfa18",
                          padding: "1px 5px",
                          borderRadius: 3,
                          textTransform: "uppercase",
                        }}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ color: t.enabled ? "#4ade80" : "#8888a0", fontSize: 10 }}>
                        {t.enabled ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px", color: "var(--dpf-muted)", fontSize: 10 }}>
                      {t.gating ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div style={{ padding: "12px 16px", textAlign: "center", color: "var(--dpf-muted)", fontSize: 11 }}>
              No tools match filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire ToolInventoryPanel into the providers page**

In `apps/web/app/(shell)/platform/ai/providers/page.tsx`:

1. Add imports:
```ts
import { getToolInventory } from "@/lib/ai-provider-data";
import { ToolInventoryPanel } from "@/components/platform/ToolInventoryPanel";
```

2. Add `getToolInventory()` to the `Promise.all`:
```ts
const [providers, byProvider, byAgent, freshJobs, detected, mcpServers, modelSummaries, toolInventory] = await Promise.all([
  getProviders(),
  getTokenSpendByProvider(currentMonth),
  getTokenSpendByAgent(currentMonth),
  prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } }),
  detectMcpServers(),
  getActivatedMcpServers(),
  getProviderModelSummaries(),
  getToolInventory(),
]);
```

3. Add the panel after the MCP Services section and before the Token Spend section:

```tsx
{/* Agent Tool Inventory */}
<div style={{ marginBottom: 32 }}>
  <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
    Tool Inventory
  </div>
  <ToolInventoryPanel tools={toolInventory} />
</div>
```

- [ ] **Step 3: Verify compilation and rendering**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors. Then verify visually at `/platform/ai/providers`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/platform/ToolInventoryPanel.tsx apps/web/app/(shell)/platform/ai/providers/page.tsx
git commit -m "feat(EP-INF-010): add tool inventory panel to providers page

Shows all agent-facing tools (platform + MCP) with source, type, enabled
status, and permission gating. Collapsible with search filter."
```

---

## Task 11: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run the new tests**

Run: `pnpm --filter web exec vitest run lib/ai-provider-data.test.ts 2>&1 | tail -30`

Expected: All tests PASS

- [ ] **Step 2: Run full TypeScript check**

Run: `pnpm --filter web exec tsc --noEmit --pretty 2>&1 | tail -20`

Expected: No errors

- [ ] **Step 3: Run the full test suite to ensure no regressions**

Run: `pnpm --filter web exec vitest run 2>&1 | tail -30`

Expected: All existing tests still pass

---

## Summary

| Task | Description | New Files | Modified Files |
|------|------------|-----------|----------------|
| 1 | ModelClassBadge component | 1 | 0 |
| 2 | Type definitions | 0 | 1 |
| 3 | Data layer queries + tests | 1 | 1 |
| 4 | MCP Services grid section | 1 | 1 |
| 5 | ServiceRow enhancements | 0 | 2 |
| 6 | OAuthConnectionStatus | 1 | 0 |
| 7 | RecipePanel | 1 | 0 |
| 8 | Provider detail wiring + ModelCard DRY | 0 | 2 |
| 9 | Async operations page + tab | 2 | 1 |
| 10 | Tool inventory panel | 1 | 1 |
| 11 | Full test suite verification | 0 | 0 |
| **Total** | | **8 new** | **9 modified** |

---

## Spec Divergences

The plan intentionally deviates from the spec's "Files to Create" table in these ways. Update the spec after implementation:

| Spec Says | Plan Does | Reason |
|-----------|-----------|--------|
| `ProviderGridSection.tsx` | Reuses existing `ServiceSection`/`ServiceRow` pattern | Existing pattern already groups by type/category. New component would be redundant. |
| `McpServiceCard.tsx` | Creates `McpServiceRow.tsx` | Matches `ServiceRow` visual style used by the rest of the providers grid. |
| `ProviderCard.tsx` modification | N/A | `ProviderCard.tsx` does not exist. The grid uses `ServiceRow.tsx`. |
| `ModelClassBadge.tsx` usage in model table | Replace inline ModelCard badge + use in ServiceRow | ModelCard already had inline badges; DRY cleanup uses the shared component. |
