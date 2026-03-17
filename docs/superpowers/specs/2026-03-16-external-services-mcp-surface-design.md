# EP-MCP-SURFACE-001: External Services & MCP Surface Visibility

**Status:** Draft
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
- All sections start expanded by default, collapse state stored in client

**Expanded:** Shows the sortable list of service rows within that category.

### 4. Service Row Design

Each row is a collapsible card within its category section:

**Collapsed row (single line):**

| Status | Name | Type | Transport/Sub-cat | Sensitivity | Tier | Cost | Actions |
|--------|------|------|-------------------|-------------|------|------|---------|
| ● | Anthropic | LLM | Direct | pub · int | deep-thinker | medium | edit |
| ● | Pinecone | MCP | Subscribed | pub · int | basic | low | edit |
| ● | Brave Search | MCP | Internal | pub · int | basic | low | edit |

- Status dot: green (active), amber (unconfigured), gray (inactive), blue (detected/unregistered)
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

**On page load**, a server action scans for MCP servers configured in the environment:

**Sources to scan:**
- `.claude/settings.json` — MCP server configurations under the `mcpServers` key
- `McpServer` table — already-registered MCP server records

**Detection flow:**
1. Read MCP config from environment
2. Compare against existing `ModelProvider` rows with `endpointType === "service"`
3. For each detected server not yet registered: return as a "detected" candidate

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

No schema changes required. The existing `ModelProvider` model has all needed fields:
- `endpointType` — "llm" or "service"
- `category` — extended with "mcp-subscribed" and "mcp-internal" values
- `sensitivityClearance[]`, `capabilityTier`, `costBand`, `taskTags[]` — routing metadata
- `mcpTransport`, `maxConcurrency` — MCP-specific config

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

**Data layer:**
- `apps/web/lib/ai-provider-data.ts` — extend `getProviders()` to include service endpoints, add grouping helpers

**Seed script:**
- `packages/db/scripts/seed-service-endpoints.ts` — seed internal MCP service endpoints

**Provider detail page:**
- `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` — show MCP manifest fields (sensitivity, tier, cost, tags) in the detail form for service endpoints

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
