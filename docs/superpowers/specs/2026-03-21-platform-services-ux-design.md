# EP-INF-010: Platform Services UX

**Date:** 2026-03-21
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-010
**Prerequisites:** EP-INF-009b/c/d (routing hardening complete), EP-OAUTH-001 (OAuth authorization code flow), EP-INT-001 (MCP integrations catalog), EP-MCP-ACT-001 Track 1 (catalog activation bridge)

---

## Problem Statement

The provider management UI (`/platform/ai/providers`) was built when the platform had a flat list of LLM providers with API keys. The infrastructure has since grown to include:

- **MCP service endpoints** (web search, fetch — `endpointType: "service"`)
- **OAuth authorization code connections** (Codex — `authMethod: "oauth2_authorization_code"`)
- **Agent providers** (Codex — `category: "agent"`, no chat inference)
- **Non-chat model types** (image gen, embedding, transcription, async — `modelClass` beyond chat/reasoning)
- **Execution adapters** (chat, image_gen, embedding, transcription, async — per-recipe adapter selection)
- **Champion/challenger recipes** (A/B experimentation per contract family)
- **Async inference operations** (`AsyncInferenceOp` — long-running Deep Research)
- **MCP integrations catalog** (`McpIntegration` — browsable catalog synced from official registry + Glama.ai)
- **Activated MCP servers** (`McpServer` + `McpServerTool` — health-checked, tool-discovered external services)

The UI shows everything in one flat provider grid. Service endpoints sit next to LLM providers. Agent providers show irrelevant inference controls. Recipe/adapter status is invisible. OAuth connection health is buried. MCP catalog and activated services exist but live on separate pages with no connection to the provider management experience.

---

## Context: Two Routing Systems, One Admin Surface

This epic sits at the convergence of two parallel routing systems that are similar in structure but different in what they deliver to agents:

### Provider Routing (EP-INF-003 through EP-INF-009)

Answers: **"Which model handles this inference request?"**

- `RequestContract` captures what the request needs (modality, reasoning depth, budget, sensitivity)
- `routeEndpointV2()` filters and ranks `(providerId, modelId)` pairs by cost-per-success
- Execution adapters dispatch to the selected provider's API (chat, image_gen, embedding, transcription)
- Result: the agent gets a response from the best-fit model

### MCP Tool Routing (EP-INT-001, EP-MCP-ACT-001)

Answers: **"Which external tools should this agent have access to?"**

- `McpIntegration` catalog provides discovery (synced weekly from official registry)
- `McpServer` activation validates config, runs MCP `initialize` health check, discovers tools via `tools/list`
- `McpServerTool` entries are namespaced as `{serverSlug}__{toolName}` (e.g., `stripe__create_payment_intent`)
- `getAvailableTools()` merges platform tools + MCP server tools into the model's tool list
- `executeTool()` detects the `__` separator and dispatches via MCP `tools/call` to the server

### The Handoff

After provider routing selects a model, the tool framework builds the tool list. These are independent concerns:

1. `routeAndCall()` picks the model (provider routing)
2. `getAvailableTools()` assembles available tools (platform + MCP tools, gated by HR role + sensitivity)
3. Model calls tools → `executeTool()` dispatches (MCP tools to their servers, platform tools to internal handlers)

### What This Epic Must Unify

Currently these two systems are administered on separate pages with different mental models:
- `/platform/ai/providers` — LLM providers, but also service endpoints mixed in
- `/platform/integrations` — MCP catalog browser (EP-INT-001)
- `/platform/services` — MCP server activation (EP-MCP-ACT-001 Track 2, planned but not built)

This epic should present a coherent admin experience where:
- LLM providers, agent providers, and MCP services are visually distinct but managed from one hub
- The path from "discover in catalog" → "activate" → "tools available to agents" is visible and navigable
- Service health, tool counts, and agent-facing tool names are surfaced (not buried in DB)

### Existing MCP Plumbing (already implemented)

| Layer | Implementation | Status |
|-------|---------------|--------|
| Catalog sync | `mcp-catalog-sync.ts` — paginated registry fetch + Glama enrichment | Done (EP-INT-001) |
| Catalog search | `search_integrations` tool in `PLATFORM_TOOLS` | Done |
| Activation bridge | `mcp-services.ts` — validate → health check → create McpServer → discover tools | Done (EP-MCP-ACT-001 T1) |
| Health check | `mcp-server-health.ts` — MCP `initialize` handshake per transport | Done |
| Tool discovery | `mcp-server-tools.ts` — `tools/list` → `McpServerTool` with namespace prefix | Done |
| Tool execution | `executeTool()` in `mcp-tools.ts` — `__` separator routing to MCP `tools/call` | Done |
| Config redaction | `mcp-server-types.ts` — strips secrets before browser responses | Done |
| Admin catalog UI | `/platform/integrations` — browse, filter, sync management | Done (EP-INT-001) |
| Admin services UI | `/platform/services` — activation form, detail page | **Not built** |

---

## Design

### 1. Provider Grid Reorganization

Replace the single flat grid with three sections:

#### 1a. LLM Providers (Primary)

Providers where `endpointType !== "service"` and `category !== "agent"`. These are the chat/reasoning/specialized inference providers.

**Card shows:**
- Provider name, status badge, auth method indicator
- Best model name + capability tier (from ModelProfile)
- Model count: `{active} active / {total} discovered`
- Cost tier indicator ($, $$, $$$)
- Non-chat capabilities badges (if any models with `modelClass` ≠ chat/reasoning): 🖼️ Image, 🎤 Audio, 📐 Embedding

**Card actions:** Configure, Discover Models, Profile Models, View Recipes

#### 1b. Agent Providers

Providers where `category === "agent"`. These use specialized APIs (e.g., Codex backend) and don't participate in standard chat routing.

**Card shows:**
- Provider name, connection status
- Auth method (OAuth sign-in vs API key)
- Supported capabilities (from registry)
- "Connected" / "Not connected" / "Token expired" status

**Card actions:** Configure, Sign In (OAuth), Disconnect

#### 1c. Service Endpoints

Providers where `endpointType === "service"`. These are internal MCP-backed tools (web search, fetch, etc.), not inference endpoints.

**Card shows:**
- Service name, status badge
- Tool count (from MCP server registration)
- Category label
- Last health check timestamp

**Card actions:** Configure, Test Connection, View Tools

#### 1d. Activated MCP Services

Rows from `McpServer` (joined to `McpIntegration` via `integrationId`). These are external MCP services activated from the catalog.

**Card shows:**
- Service name (from `McpIntegration.name` or `McpServer.name`)
- Transport badge (stdio / sse / http)
- Health status: 🟢 healthy / 🟡 degraded / 🔴 unhealthy / ⚪ unchecked
- Tool count: `{enabled} / {total} tools enabled`
- Agent-facing tool prefix: `{serverSlug}__*`
- Activation metadata: activated by, activation date
- Category + archetype relevance tags (from catalog)

**Card actions:** Health Check, Manage Tools (enable/disable individual tools), Deactivate, View in Catalog

**Empty state:** Link to `/platform/integrations` catalog with CTA "Browse integrations to activate"

#### Integration Catalog Link

Prominent link/button at the top of the Services section: "Browse Integration Catalog" → `/platform/integrations`

This connects the existing EP-INT-001 catalog browser to the activation flow. When EP-MCP-ACT-001 Track 2 builds the activation form, the flow becomes: catalog → activate → appears in section 1d.

### 2. Provider Detail Page Enhancements

#### 2a. Model Table — modelClass column

Add `modelClass` column to the discovered/profiled models table. Show as a badge:
- `chat` → default (no badge)
- `reasoning` → 🧠 Reasoning
- `image_gen` → 🖼️ Image
- `embedding` → 📐 Embedding
- `audio` → 🎤 Audio
- `speech` → 🔊 Speech

#### 2b. Recipe Panel

New collapsible section on the provider detail page: "Execution Recipes"

**Table columns:** Contract Family | Model | Adapter | Status (champion/challenger) | Version | Origin

**Purpose:** Shows admins which recipes are seeded, which adapter each uses, and whether champion/challenger experimentation is active. Currently invisible — admins have no way to see this.

#### 2c. OAuth Connection Status

When `authMethod === "oauth2_authorization_code"`:
- Show connection status: green dot "Connected · expires {relative time}" / amber "Token expired"
- Show `hasRefreshToken` indicator (auto-refresh available or not)
- "Disconnect" action clears tokens
- "Sign in with {provider}" button for initial/re-auth

This extends the work from EP-OAUTH-001 spec section 6 (UI Changes) which specified this but wasn't implemented for the provider detail form.

#### 2d. Non-Chat Capability Summary

When the provider has models with `modelClass` values beyond chat/reasoning, show a capability summary:

```
Capabilities: Chat (12 models) · Reasoning (3) · Image Gen (2) · Embedding (1)
```

Derived from `ModelProfile.modelClass` group counts.

### 3. Async Operations Panel

New page or section: `/platform/ai/operations`

Shows `AsyncInferenceOp` records:

**Table columns:** ID | Provider | Model | Status | Progress | Created | Completed/Expires

**Row states:**
- 🔵 Running — progress bar, elapsed time
- ✅ Completed — link to view result
- ❌ Failed — error message
- ⏰ Expired — expiry timestamp
- 🚫 Cancelled

**Purpose:** Visibility into Deep Research and other long-running operations. Currently these are tracked in the database but invisible in the UI.

### 4. Navigation Update

The current nav has a single "AI Providers" link. Extend to:

```
Platform > AI & Services
  ├── Providers        (LLM + Agent + Service + MCP — 4-section grid)
  ├── Integrations     (MCP catalog browser — already exists at /platform/integrations)
  ├── Recipes          (optional: dedicated recipe browser)
  └── Operations       (async inference operations)
```

Or keep as a single page with tabs/sections if the separate pages feel like overkill.

### 5. MCP Tool Visibility

Agents see MCP tools via `getAvailableTools()` but admins currently have no visibility into which tools are agent-facing. Add:

#### 5a. Tool Inventory Panel

Accessible from the provider/services page or as a collapsible section. Shows all tools available to agents:

**Columns:** Tool Name | Source | Type | Enabled | Gating

Where:
- **Source** — "Platform" (built-in) or `{McpServer.name}` (external)
- **Type** — "Built-in" or "MCP" (with transport indicator)
- **Enabled** — toggle for MCP tools (`McpServerTool.isEnabled`), always-on for platform tools
- **Gating** — which HR capability/permission is required, if any

This gives admins the answer to "what can the AI coworker actually do?" in one place.

#### 5b. Agent-Facing Tool Names

For MCP services, show the namespaced tool name (`stripe__create_payment_intent`) alongside the original name (`create_payment_intent`). The namespace is how the agent sees and calls it — admins need to understand this mapping.

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/web/components/platform/ProviderGridSection.tsx` | Reusable grid section (LLM / Agent / Service / MCP) |
| `apps/web/components/platform/RecipePanel.tsx` | Collapsible recipe table for provider detail |
| `apps/web/components/platform/AsyncOperationsTable.tsx` | Async operation monitoring table |
| `apps/web/components/platform/OAuthConnectionStatus.tsx` | OAuth status display + actions |
| `apps/web/components/platform/ModelClassBadge.tsx` | Small badge component for model class |
| `apps/web/components/platform/McpServiceCard.tsx` | Card for activated MCP servers (health, tools, transport) |
| `apps/web/components/platform/ToolInventoryPanel.tsx` | Combined view of all agent-facing tools (platform + MCP) |

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/app/(shell)/platform/ai/providers/page.tsx` | Split grid into 4 sections using ProviderGridSection |
| `apps/web/components/platform/ProviderDetailForm.tsx` | Add RecipePanel, OAuth status, model class column, capability summary |
| `apps/web/components/platform/ProviderCard.tsx` | Add non-chat capability badges, model count, auth method indicator |
| `apps/web/lib/actions/ai-providers.ts` | New server actions: `getRecipesForProvider()`, `getAsyncOperations()`, `getActivatedMcpServers()`, `getToolInventory()` |
| `apps/web/app/(shell)/platform/page.tsx` | Update navigation to "AI & Services", add Integrations + Operations links |
| `apps/web/components/platform/IntegrationCard.tsx` | Add "Activate" action linking to activation flow (when EP-MCP-ACT-001 T2 lands) |

## Data Queries (all data already exists)

| Query | Source |
|-------|--------|
| Provider sections | `ModelProvider` with `endpointType` and `category` filters |
| Model class counts | `ModelProfile` grouped by `modelClass` per provider |
| Recipe list | `ExecutionRecipe` filtered by providerId |
| OAuth status | `CredentialEntry.tokenExpiresAt`, `hasRefreshToken` check |
| Async operations | `AsyncInferenceOp` ordered by `createdAt desc` |
| Activated MCP services | `McpServer` joined to `McpIntegration` via `integrationId`, with `McpServerTool` counts |
| Tool inventory | `PLATFORM_TOOLS` (static) + `McpServerTool` where `isEnabled` and server active+healthy |

---

## What Is NOT In Scope

- **Recipe editing UI** — admins can view recipes but not manually edit them. Recipe mutation is via the champion/challenger system.
- **Model profiling trigger** — the "Profile Models" button already exists. No changes to the profiling flow.
- **New server actions for inference** — all inference goes through `routeAndCall()`. No UI-initiated inference changes.
- **Mobile layout** — desktop-first for admin pages.
- **Dark mode** — follows existing platform theme.
