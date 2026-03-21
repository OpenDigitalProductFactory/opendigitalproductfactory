# EP-MCP-SURFACE-001: External Services & MCP Surface Visibility

**Status:** Superseded by EP-MCP-ACT-001 (2026-03-20-mcp-activation-and-services-surface-design.md)
**Date:** 2026-03-16
**Epic:** External Services & MCP Surface
**Scope:** Unify LLM providers and MCP services under one "External Services" tab on the AI Workforce page, with auto-discovery, collapsible list UI, and sensitivity/routing metadata visibility

---

## Problem Statement

The AI Workforce page currently shows LLM providers on the "Providers" tab, but MCP services (Pinecone, Firebase, Playwright, Context7, Brave Search, etc.) have no visibility in the platform UI. The platform consumes external MCP servers configured in the Claude environment and has internal service endpoints (Brave Search, Public Fetch, Branding Analyzer), but there's no way for an admin to:

- See what MCP services are connected
- Manage their sensitivity clearance and routing metadata
- Distinguish between subscribed (external) and internal services
- Register newly detected MCP servers

Meanwhile, the Unified MCP Coworker architecture already treats LLM providers and service endpoints as the same type (`ModelProvider` rows with `endpointType` field) — the UI just hasn't caught up.

## Goals

1. Unify LLM providers and MCP services under one "External Services" tab
2. Collapsible list rows with status indicators, sortable by name/status/type/sensitivity/cost
3. Auto-detect MCP servers from environment config and prompt admin to register
4. Show sensitivity clearance, capability tier, and cost band for all endpoints
5. Distinguish MCP — Subscribed (external) from MCP — Internal (built-in)

## Non-Goals

- Exposing the platform's own MCP server for external consumption (separate epic)
- MCP transport configuration UI (stdio/sse/http connection editing — deferred)
- Real-time health monitoring / heartbeat for MCP services

---

## Design

### 1. Tab Rename & Structure

Rename the "Providers" tab to **"External Services"** in `AiTabNav`. The route stays at `/platform/ai/providers` to avoid breaking existing links. Only the label changes.

The three tabs become:
- **Workforce** → `/platform/ai`
- **External Services** → `/platform/ai/providers`
- **Action History** → `/platform/ai/history`

### 2. Service Categories

All endpoints are `ModelProvider` rows. The UI groups them by `endpointType` first, then by `category`:

**LLM Endpoints** (`endpointType === "llm"`):

| Category | Display Name | Examples |
|----------|-------------|----------|
| `local` | Local | Ollama |
| `direct` | Direct | Anthropic, OpenAI, Gemini |
| `agent` | Agent | OpenAI Codex |
| `router` | Routers & Gateways | OpenRouter, LiteLLM |

**MCP Service Endpoints** (`endpointType === "service"`):

| Category | Display Name | Examples |
|----------|-------------|----------|
| `mcp-subscribed` | Subscribed | Pinecone, Firebase, Playwright, Context7 |
| `mcp-internal` | Internal | Brave Search, Public Fetch, Branding Analyzer |

The `category` field on `ModelProvider` is extended with two new values: `"mcp-subscribed"` and `"mcp-internal"`. No schema migration needed — `category` is a `String` field.

### 3. Collapsible Section Design

Each category section renders as a collapsible group:

**Collapsed (summary header):**
```
▶ LLM — Direct                    4 active · 8 inactive · 2 unconfigured
▶ MCP — Subscribed                3 active · 1 unconfigured
▶ MCP — Internal                  3 active
```

- Click arrow or header to expand
- Status summary shows count per status using colored numbers (green/amber/gray)
- Sections with active services start expanded; sections with zero active services start collapsed
- Collapse state stored in client (useState, no persistence)

**Expanded:** Shows the sortable list of service rows within that category.

### 4. Service Row Design

Each row is a collapsible card within its category section:

**Collapsed row (single line):**

| Status | Name | Type | Transport/Sub-cat | Sensitivity | Tier | Cost | Actions |
|--------|------|------|-------------------|-------------|------|------|---------|
| ● | Anthropic | LLM | Direct | pub · int | deep-thinker | medium | edit |
| ● | Pinecone | MCP | Subscribed | pub · int | basic | low | edit |
| ● | Brave Search | MCP | Internal | pub · int | basic | low | edit |

- Status dot: green (active), amber (unconfigured), gray (inactive), blue (detected/unregistered). Each dot has a `title` attribute with the status text for accessibility.
- Sensitivity clearance shown as abbreviated badges: `pub`, `int`, `con`, `res`
- Edit button appears on hover

**Expanded row (detail panel below the row):**

- **Connection:** endpoint URL, transport type (stdio/sse/http/api), auth method
- **Routing metadata:** sensitivity clearance (full labels), capability tier, cost band, task tags
- **LLM-specific:** model families (enabled/total), token pricing
- **MCP-specific:** server config summary, max concurrency
- **Source:** "Auto-detected" or "Manual" badge
- **Links:** Configure, Docs, Console (where available)
- Clicking "Configure" navigates to the existing `/platform/ai/providers/[providerId]` detail page

**Sort controls** (column header buttons, same pattern as epic list):
- Name (alpha)
- Status (active → unconfigured → inactive)
- Type (LLM → MCP)
- Sensitivity (by highest clearance level)
- Cost band (free → low → medium → high)

### 5. Auto-Discovery

**On page load**, a server action scans for MCP servers from two sources:

**Sources to scan:**
1. **`McpServer` table** (primary) — MCP server records already registered in the database. Each has a `serverId`, `name`, `config` (JSON with connection details), and `status`. Compare `McpServer.serverId` against `ModelProvider.providerId` — any `McpServer` without a matching `ModelProvider` row is a candidate.
2. **Claude plugins** (secondary) — read `~/.claude/plugins/installed_plugins.json` to detect plugin-based MCP servers (Pinecone, Firebase, Playwright, Context7, etc.). Each plugin entry has a name and package identifier. Compare against existing `ModelProvider.providerId` values.

**Relationship between `McpServer` and `ModelProvider`:** `McpServer.serverId` maps to `ModelProvider.providerId` by naming convention (no FK). `McpServer` is the detection/connection source; `ModelProvider` is the registered endpoint in the workforce registry. When a detected service is registered, a `ModelProvider` row is created with `providerId` matching `McpServer.serverId`. The `McpServer` row is retained as the connection config source.

**Detection flow:**
1. Load `McpServer` rows and installed plugin entries
2. Load existing `ModelProvider` rows with `endpointType === "service"`
3. Any source entry without a matching `ModelProvider.providerId` is returned as a "detected" candidate

**UI treatment:**
- Banner at top of External Services tab when unregistered services are detected:
  *"N new MCP services detected. Review and register."*
- Detected services appear in the list with blue status dot and "detected" badge
- Clicking a detected service opens a registration form:
  - Confirm/edit name
  - Set sensitivity clearance (default: `["public", "internal"]`)
  - Set capability tier (default: `"basic"`)
  - Set cost band (default: `"free"`)
  - Assign task tags
  - Category auto-set to `"mcp-subscribed"`
- On confirm: upsert into `ModelProvider` with `endpointType: "service"`, `status: "active"`
- Registration requires `manage_provider_connections` capability, matching the existing provider configuration pattern

**Already-registered services** that match a detected config show normally — no banner, no action needed.

### 6. Internal Service Seeding

The platform's built-in service endpoints need to be registered as `ModelProvider` rows on first run (or via a seed script). Three initial internal services:

| providerId | Name | Task Tags | Sensitivity |
|-----------|------|-----------|-------------|
| `brave-search` | Brave Search | `["web-search"]` | `["public", "internal"]` |
| `public-fetch` | Public URL Fetcher | `["web-fetch"]` | `["public", "internal"]` |
| `branding-analyzer` | Branding Analyzer | `["branding-analysis", "web-fetch"]` | `["public", "internal"]` |

All three: `endpointType: "service"`, `category: "mcp-internal"`, `costBand: "free"`, `capabilityTier: "basic"`, `status: "active"`.

---

## Data Model

No schema migration required. The existing `ModelProvider` model has all needed fields. However, the TypeScript type layer needs updates:

**`ProviderRow` type** (`apps/web/lib/ai-provider-types.ts`) — add MCP manifest fields:
```ts
endpointType: string;
sensitivityClearance: string[];
capabilityTier: string;
costBand: string;
taskTags: string[];
mcpTransport: string | null;
maxConcurrency: number | null;
```

**`RegistryProviderEntry` category union** — extend with `"mcp-subscribed" | "mcp-internal"`.

**`getProviders()` select clause** — add the MCP manifest fields to the Prisma select so they're returned in the query.

**Data migration:** Existing service endpoint rows seeded with `category: "local"` and `endpointType: "service"` should be updated to `category: "mcp-internal"`. The Brave Search `costBand` should be corrected from `"low"` to `"free"`.

**Grouping logic:** The current providers page filters by hardcoded category strings (`"local"`, `"direct"`, `"router"`, `"agent"`). Replace with a two-level grouping function: group by `endpointType` first (LLM vs MCP), then by `category` within each type. Signature: `groupByEndpointTypeAndCategory(providers): Map<string, ProviderRow[]>`.

## Files Affected

**Tab navigation:**
- `apps/web/components/platform/AiTabNav.tsx` — rename "Providers" label to "External Services"

**Page restructure:**
- `apps/web/app/(shell)/platform/ai/providers/page.tsx` — replace category-card layout with collapsible list sections grouped by endpointType + category

**New components:**
- `apps/web/components/platform/ServiceSection.tsx` — collapsible category section (server component header + client expand/collapse)
- `apps/web/components/platform/ServiceRow.tsx` — collapsible service row with summary + detail views
- `apps/web/components/platform/DetectedServicesBanner.tsx` — banner for unregistered detected MCP services
- `apps/web/components/platform/ServiceRegistrationForm.tsx` — registration form for detected services

**Server actions:**
- `apps/web/lib/actions/ai-providers.ts` — add `detectMcpServers()` action, add `registerMcpService()` action

**Type layer:**
- `apps/web/lib/ai-provider-types.ts` — add MCP manifest fields to `ProviderRow`, extend `RegistryProviderEntry` category union

**Data layer:**
- `apps/web/lib/ai-provider-data.ts` — add MCP fields to `getProviders()` select, add `groupByEndpointTypeAndCategory()` helper

**Seed script:**
- `packages/db/scripts/seed-service-endpoints.ts` — update to use `category: "mcp-internal"` and `costBand: "free"` for all internal services

**Provider detail page:**
- `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` — show MCP manifest fields (sensitivity, tier, cost, tags) in the detail form for service endpoints; update back link text from "AI Providers" to "External Services"

**Existing sections:** Token Spend and Scheduled Jobs sections on the providers page remain unchanged, rendered below the External Services listing.

## Testing Strategy

- Verify tab rename displays "External Services"
- Verify LLM providers still display correctly in their categories
- Verify MCP — Internal services appear after seeding
- Verify auto-detection finds MCP servers from environment config
- Verify detected services banner appears with correct count
- Verify registration flow creates ModelProvider with correct endpointType/category
- Verify collapsible sections expand/collapse with correct summary counts
- Verify sort controls work across all service types
- Verify existing provider detail page still works for LLM providers
- Verify service detail page shows MCP manifest fields
