# External Services & MCP Surface Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify LLM providers and MCP services under one "External Services" tab on the AI Workforce page, with collapsible list sections, auto-discovery, and MCP manifest metadata visibility.

**Architecture:** Extend `ProviderRow` type with MCP manifest fields. Replace the four hardcoded category grid sections on the providers page with a generic `ServiceSection` + `ServiceRow` component pair that groups by `endpointType` then `category`. Add auto-detection from `McpServer` table and Claude plugins. Seed internal MCP service endpoints.

**Tech Stack:** Next.js (App Router), Prisma, PostgreSQL, Vitest, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-16-external-services-mcp-surface-design.md`

---

## Chunk 1: Type Layer, Data, Seed, Tab Rename

### Task 1: Extend ProviderRow Type with MCP Fields

**Files:**
- Modify: `apps/web/lib/ai-provider-types.ts`

- [ ] **Step 1: Add MCP manifest fields to ProviderRow type**

Add after `costPerformanceNotes: string | null;` (line 65):
```ts
  endpointType: string;
  sensitivityClearance: string[];
  capabilityTier: string;
  costBand: string;
  taskTags: string[];
  mcpTransport: string | null;
  maxConcurrency: number | null;
```

- [ ] **Step 2: Extend RegistryProviderEntry category union**

Change line 141 from:
```ts
  category: "direct" | "router" | "agent";
```
To:
```ts
  category: "direct" | "router" | "agent" | "mcp-subscribed" | "mcp-internal";
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/ai-provider-types.ts
git commit -m "feat: extend ProviderRow and RegistryProviderEntry with MCP manifest fields"
```

---

### Task 2: Update Data Queries to Select MCP Fields

**Files:**
- Modify: `apps/web/lib/ai-provider-data.ts`

- [ ] **Step 1: Read the file and find the getProviders select clause**

- [ ] **Step 2: Add MCP fields to the Prisma select**

Add these to the `select` object inside `getProviders()`:
```ts
      endpointType: true,
      sensitivityClearance: true,
      capabilityTier: true,
      costBand: true,
      taskTags: true,
      mcpTransport: true,
      maxConcurrency: true,
```

- [ ] **Step 3: Add grouping helper function**

Add at the end of the file:
```ts
export type ServiceGroup = {
  endpointType: string;
  category: string;
  displayName: string;
  providers: ProviderWithCredential[];
};

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  local: "Local",
  direct: "Direct",
  agent: "Agent",
  router: "Routers & Gateways",
  "mcp-subscribed": "Subscribed",
  "mcp-internal": "Internal",
};

const CATEGORY_ORDER: Record<string, number> = {
  local: 0, direct: 1, agent: 2, router: 3,
  "mcp-internal": 0, "mcp-subscribed": 1,
};

export function groupByEndpointTypeAndCategory(
  providers: ProviderWithCredential[],
): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();

  for (const pw of providers) {
    const type = pw.provider.endpointType || "llm";
    const cat = pw.provider.category;
    const key = `${type}:${cat}`;

    if (!groups.has(key)) {
      groups.set(key, {
        endpointType: type,
        category: cat,
        displayName: CATEGORY_DISPLAY_NAMES[cat] ?? cat,
        providers: [],
      });
    }
    groups.get(key)!.providers.push(pw);
  }

  // Sort: LLM groups first, then MCP. Within each type, sort by CATEGORY_ORDER.
  return [...groups.values()].sort((a, b) => {
    if (a.endpointType !== b.endpointType) {
      return a.endpointType === "llm" ? -1 : 1;
    }
    return (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/ai-provider-data.ts
git commit -m "feat: add MCP fields to provider queries and grouping helper"
```

---

### Task 3: Seed Internal MCP Service Endpoints

**Files:**
- Modify: `packages/db/scripts/seed-service-endpoints.ts`

- [ ] **Step 1: Read and update the seed script**

Read the existing file. Update all service entries to use `category: "mcp-internal"` and ensure Brave Search uses `costBand: "free"`. The script should upsert so it's idempotent.

- [ ] **Step 2: Run the seed script**

```bash
cd packages/db && DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx scripts/seed-service-endpoints.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/seed-service-endpoints.ts
git commit -m "data: update internal MCP service endpoints with mcp-internal category"
```

---

### Task 4: Rename Tab to "External Services"

**Files:**
- Modify: `apps/web/components/platform/AiTabNav.tsx`

- [ ] **Step 1: Change the label**

Change line 8 from:
```ts
  { label: "Providers", href: "/platform/ai/providers" },
```
To:
```ts
  { label: "External Services", href: "/platform/ai/providers" },
```

- [ ] **Step 2: Update the page header in providers page**

In `apps/web/app/(shell)/platform/ai/providers/page.tsx`, change the `<h1>` text from "AI Providers" to "External Services".

- [ ] **Step 3: Update back link in provider detail page**

In `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`, find the back link text "AI Providers" and change to "External Services".

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/platform/AiTabNav.tsx "apps/web/app/(shell)/platform/ai/providers/page.tsx" "apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx"
git commit -m "feat: rename Providers tab to External Services"
```

---

## Chunk 2: Collapsible UI Components

### Task 5: Create ServiceSection Component

**Files:**
- Create: `apps/web/components/platform/ServiceSection.tsx`

- [ ] **Step 1: Create the collapsible section component**

```tsx
// apps/web/components/platform/ServiceSection.tsx
"use client";

import { useState } from "react";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";

type Props = {
  endpointType: string;
  displayName: string;
  providers: ProviderWithCredential[];
  children: React.ReactNode;
};

const STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  unconfigured: "#fbbf24",
  inactive: "#8888a0",
  detected: "#38bdf8",
};

export function ServiceSection({ endpointType, displayName, providers, children }: Props) {
  const hasActive = providers.some((p) => p.provider.status === "active");
  const [expanded, setExpanded] = useState(hasActive);

  const counts = {
    active: providers.filter((p) => p.provider.status === "active").length,
    unconfigured: providers.filter((p) => p.provider.status === "unconfigured").length,
    inactive: providers.filter((p) => p.provider.status === "inactive").length,
  };

  const typeLabel = endpointType === "llm" ? "LLM" : "MCP";

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-t bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-1)] transition-colors text-left"
      >
        <span className="text-[10px] text-[var(--dpf-muted)]">{expanded ? "▼" : "▶"}</span>
        <span className="text-xs font-semibold text-white">
          {typeLabel} — {displayName}
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-2 text-[10px]">
          {counts.active > 0 && (
            <span style={{ color: STATUS_COLOURS.active }}>{counts.active} active</span>
          )}
          {counts.unconfigured > 0 && (
            <span style={{ color: STATUS_COLOURS.unconfigured }}>{counts.unconfigured} unconfigured</span>
          )}
          {counts.inactive > 0 && (
            <span style={{ color: STATUS_COLOURS.inactive }}>{counts.inactive} inactive</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="border border-t-0 border-[var(--dpf-border)] rounded-b overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/platform/ServiceSection.tsx
git commit -m "feat: add ServiceSection collapsible component"
```

---

### Task 6: Create ServiceRow Component

**Files:**
- Create: `apps/web/components/platform/ServiceRow.tsx`

- [ ] **Step 1: Create the collapsible row component**

```tsx
// apps/web/components/platform/ServiceRow.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";
import { getBillingLabel } from "@/lib/ai-provider-types";
import { ProviderStatusToggle } from "./ProviderStatusToggle";

type Props = {
  pw: ProviderWithCredential;
};

const STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  unconfigured: "#fbbf24",
  inactive: "#8888a0",
  detected: "#38bdf8",
};

const SENSITIVITY_ABBREV: Record<string, string> = {
  public: "pub",
  internal: "int",
  confidential: "con",
  restricted: "res",
};

export function ServiceRow({ pw }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { provider } = pw;
  const statusColour = STATUS_COLOURS[provider.status] ?? "#8888a0";
  const billingLabel = getBillingLabel(provider);

  return (
    <div className="border-b border-[var(--dpf-border)] last:border-b-0">
      {/* Collapsed row */}
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--dpf-surface-1)] cursor-pointer group"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Status dot */}
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: statusColour }}
          title={provider.status}
        />

        {/* Name */}
        <span className="text-xs font-medium text-white min-w-0 truncate flex-1">
          {provider.name}
        </span>

        {/* Type badge */}
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] shrink-0">
          {provider.endpointType === "llm" ? "LLM" : "MCP"}
        </span>

        {/* Sensitivity badges */}
        <div className="hidden sm:flex gap-1 shrink-0">
          {(provider.sensitivityClearance ?? []).map((s: string) => (
            <span key={s} className="text-[8px] px-1 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
              {SENSITIVITY_ABBREV[s] ?? s}
            </span>
          ))}
        </div>

        {/* Capability tier */}
        <span className="hidden md:block text-[9px] text-[var(--dpf-muted)] w-20 shrink-0 truncate">
          {provider.capabilityTier ?? "—"}
        </span>

        {/* Cost band */}
        <span className="hidden md:block text-[9px] text-[var(--dpf-muted)] w-12 shrink-0">
          {provider.costBand ?? "—"}
        </span>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ProviderStatusToggle providerId={provider.providerId} initialStatus={provider.status} />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-6 py-3 bg-[var(--dpf-surface-1)] border-t border-[var(--dpf-border)] space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[10px]">
            <div>
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Endpoint</span>
              <p className="text-white font-mono mt-0.5 truncate">{provider.endpoint ?? provider.baseUrl ?? "—"}</p>
            </div>
            <div>
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Auth</span>
              <p className="text-white mt-0.5">{provider.authMethod ?? "—"}</p>
            </div>
            <div>
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Transport</span>
              <p className="text-white mt-0.5">{provider.mcpTransport ?? (provider.endpointType === "llm" ? "api" : "—")}</p>
            </div>
            <div>
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Sensitivity</span>
              <p className="text-white mt-0.5">{(provider.sensitivityClearance ?? []).join(", ") || "—"}</p>
            </div>
            <div>
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Capability Tier</span>
              <p className="text-white mt-0.5">{provider.capabilityTier ?? "—"}</p>
            </div>
            <div>
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Cost Band</span>
              <p className="text-white mt-0.5">{provider.costBand ?? "—"}</p>
            </div>
          </div>

          {(provider.taskTags ?? []).length > 0 && (
            <div className="text-[10px]">
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Task Tags</span>
              <div className="flex gap-1 mt-0.5 flex-wrap">
                {(provider.taskTags ?? []).map((tag: string) => (
                  <span key={tag} className="px-1.5 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {provider.endpointType === "llm" && provider.families.length > 0 && (
            <div className="text-[10px]">
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Model Families</span>
              <p className="text-white mt-0.5">{provider.families.join(", ")}</p>
            </div>
          )}

          {billingLabel && (
            <div className="text-[10px]">
              <span className="text-[var(--dpf-muted)] uppercase tracking-wider">Billing</span>
              <p className="text-white mt-0.5">{billingLabel}</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Link href={`/platform/ai/providers/${provider.providerId}`} className="text-[10px] text-[var(--dpf-accent)]">
              Configure →
            </Link>
            {provider.docsUrl && (
              <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--dpf-muted)] hover:text-white">
                Docs
              </a>
            )}
            {provider.consoleUrl && (
              <a href={provider.consoleUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--dpf-muted)] hover:text-white">
                Console
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/platform/ServiceRow.tsx
git commit -m "feat: add ServiceRow collapsible component with MCP metadata"
```

---

### Task 7: Rewrite Providers Page with Grouped Collapsible Sections

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`

- [ ] **Step 1: Read the current file fully**

- [ ] **Step 2: Replace the provider registry section**

Replace the four hardcoded category sections (Section 1: Provider Registry, lines ~75-291) with the new grouped layout. Keep Section 2 (Token Spend) and Section 3 (Scheduled Jobs) unchanged.

Import the new components and grouping helper:
```ts
import { groupByEndpointTypeAndCategory } from "@/lib/ai-provider-data";
import { ServiceSection } from "@/components/platform/ServiceSection";
import { ServiceRow } from "@/components/platform/ServiceRow";
```

Replace Section 1 with:
```tsx
      {/* Section 1: External Services Registry */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            External Services
          </div>
          {canWrite && <SyncProvidersButton lastSyncAt={lastSync ?? null} />}
        </div>

        {providers.length === 0 ? (
          <p style={{ color: "#8888a0", fontSize: 11 }}>No services registered. Click &quot;Update Providers&quot; to import.</p>
        ) : (
          groupByEndpointTypeAndCategory(providers).map((group) => (
            <ServiceSection
              key={`${group.endpointType}:${group.category}`}
              endpointType={group.endpointType}
              displayName={group.displayName}
              providers={group.providers}
            >
              {group.providers.map((pw) => (
                <ServiceRow key={pw.provider.providerId} pw={pw} />
              ))}
            </ServiceSection>
          ))
        )}
      </div>
```

Remove the old imports that are no longer needed: `ProviderStatusToggle` (moved into ServiceRow), `getBillingLabel` (used inside ServiceRow).

Remove the four hardcoded category variables: `localProviders`, `directProviders`, `routerProviders`, `agentProviders`.

Update the header subtitle to use grouped counts:
```tsx
        <p style={{ fontSize: 11, color: "#8888a0", marginTop: 2 }}>
          {providers.length} service{providers.length !== 1 ? "s" : ""} registered
          {lastSync ? ` · last synced ${new Date(lastSync).toLocaleDateString()}` : ""}
        </p>
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(shell)/platform/ai/providers/page.tsx"
git commit -m "feat: replace provider cards with collapsible service sections"
```

---

## Chunk 3: Auto-Discovery & Registration

### Task 8: Add MCP Detection Server Action

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Add detectMcpServers action**

Read the file first. Add at the end:

```ts
export type DetectedMcpService = {
  serverId: string;
  name: string;
  source: "database" | "plugin";
  config: Record<string, unknown>;
};

/**
 * Detect MCP servers from McpServer table and Claude plugins.
 * Returns services not yet registered as ModelProvider rows.
 */
export async function detectMcpServers(): Promise<DetectedMcpService[]> {
  const detected: DetectedMcpService[] = [];

  // Source 1: McpServer table
  const mcpServers = await prisma.mcpServer.findMany();
  for (const server of mcpServers) {
    const existing = await prisma.modelProvider.findUnique({
      where: { providerId: server.serverId },
    });
    if (!existing) {
      detected.push({
        serverId: server.serverId,
        name: server.name,
        source: "database",
        config: (server.config as Record<string, unknown>) ?? {},
      });
    }
  }

  // Source 2: Claude plugins (best-effort, file may not exist)
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    const pluginsPath = path.join(home, ".claude", "plugins", "installed_plugins.json");
    const raw = await fs.readFile(pluginsPath, "utf-8");
    const plugins = JSON.parse(raw) as Array<{ package_name?: string; name?: string }>;

    for (const plugin of plugins) {
      const id = plugin.package_name ?? plugin.name;
      if (!id) continue;
      const existing = await prisma.modelProvider.findUnique({
        where: { providerId: id },
      });
      if (!existing) {
        detected.push({
          serverId: id,
          name: plugin.name ?? id,
          source: "plugin",
          config: {},
        });
      }
    }
  } catch {
    // Plugins file not found or not readable — skip silently
  }

  return detected;
}
```

- [ ] **Step 2: Add registerMcpService action**

```ts
export async function registerMcpService(input: {
  providerId: string;
  name: string;
  sensitivityClearance: string[];
  capabilityTier: string;
  costBand: string;
  taskTags: string[];
}): Promise<void> {
  await requireManageProviders();

  await prisma.modelProvider.upsert({
    where: { providerId: input.providerId },
    update: {
      name: input.name,
      endpointType: "service",
      category: "mcp-subscribed",
      sensitivityClearance: input.sensitivityClearance,
      capabilityTier: input.capabilityTier,
      costBand: input.costBand,
      taskTags: input.taskTags,
      status: "active",
    },
    create: {
      providerId: input.providerId,
      name: input.name,
      endpointType: "service",
      category: "mcp-subscribed",
      sensitivityClearance: input.sensitivityClearance,
      capabilityTier: input.capabilityTier,
      costBand: input.costBand,
      taskTags: input.taskTags,
      status: "active",
      families: [],
      enabledFamilies: [],
      costModel: "token",
      authMethod: "none",
      supportedAuthMethods: ["none"],
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "feat: add MCP service detection and registration actions"
```

---

### Task 9: Create DetectedServicesBanner Component

**Files:**
- Create: `apps/web/components/platform/DetectedServicesBanner.tsx`

- [ ] **Step 1: Create the banner component**

```tsx
// apps/web/components/platform/DetectedServicesBanner.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerMcpService, type DetectedMcpService } from "@/lib/actions/ai-providers";

type Props = {
  detected: DetectedMcpService[];
};

export function DetectedServicesBanner({ detected }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [registered, setRegistered] = useState<Set<string>>(new Set());

  if (detected.length === 0) return null;

  const remaining = detected.filter((d) => !registered.has(d.serverId));
  if (remaining.length === 0) return null;

  function handleRegister(service: DetectedMcpService) {
    startTransition(async () => {
      await registerMcpService({
        providerId: service.serverId,
        name: service.name,
        sensitivityClearance: ["public", "internal"],
        capabilityTier: "basic",
        costBand: "free",
        taskTags: [],
      });
      setRegistered((prev) => new Set([...prev, service.serverId]));
      router.refresh();
    });
  }

  return (
    <div className="mb-4 p-3 rounded-lg border border-[#38bdf8] bg-[#38bdf808]">
      <p className="text-xs text-[#38bdf8] font-medium mb-2">
        {remaining.length} new MCP service{remaining.length !== 1 ? "s" : ""} detected. Review and register.
      </p>
      <div className="space-y-2">
        {remaining.map((service) => (
          <div key={service.serverId} className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-[#38bdf8] shrink-0" title="detected" />
            <span className="text-xs text-white flex-1">{service.name}</span>
            <span className="text-[9px] text-[var(--dpf-muted)]">{service.source}</span>
            <button
              type="button"
              onClick={() => handleRegister(service)}
              disabled={isPending}
              className="text-[10px] px-2 py-1 rounded bg-[var(--dpf-accent)] text-white font-medium disabled:opacity-50"
            >
              Register
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire banner into providers page**

In `apps/web/app/(shell)/platform/ai/providers/page.tsx`, add:

Import:
```ts
import { detectMcpServers } from "@/lib/actions/ai-providers";
import { DetectedServicesBanner } from "@/components/platform/DetectedServicesBanner";
```

In the data fetching section, add detection call:
```ts
  const detected = await detectMcpServers();
```

In the JSX, add the banner above Section 1:
```tsx
      <DetectedServicesBanner detected={detected} />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/DetectedServicesBanner.tsx "apps/web/app/(shell)/platform/ai/providers/page.tsx"
git commit -m "feat: auto-detect MCP services and show registration banner"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run tests**

```bash
cd apps/web && pnpm test
```
Verify no new failures.

- [ ] **Step 2: Verify the External Services page**

Navigate to `/platform/ai/providers`:
- Tab should say "External Services"
- LLM providers grouped by category in collapsible sections
- MCP — Internal section shows Brave Search, Public Fetch, Branding Analyzer (after seed)
- Each row expands to show MCP manifest metadata
- Detection banner appears if McpServer records or plugins exist without matching ModelProvider rows

- [ ] **Step 3: Verify provider detail page**

Navigate to any provider detail page:
- Back link says "External Services"
- Existing configuration workflow still works

- [ ] **Step 4: Push**

```bash
git push
```
