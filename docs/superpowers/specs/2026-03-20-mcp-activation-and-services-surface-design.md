# EP-MCP-ACT-001: MCP Catalog Activation & External Services Surface

**Status:** Draft
**Date:** 2026-03-20
**Epic:** MCP Ecosystem Integration
**Depends on:** EP-INT-001 (MCP Integrations Catalog — complete)
**Parallel with:** EP-INF-001–004 (LLM Routing — separate concern)
**Supersedes:** EP-MCP-SURFACE-001 (2026-03-16 External Services & MCP Surface Visibility — the earlier design routed MCP services through `ModelProvider` with `endpointType: "service"`. This spec replaces that approach: `McpServer` is now the authoritative model for MCP services, fully decoupled from `ModelProvider` which remains LLM-only.)

---

## Problem

The MCP integrations catalog (EP-INT-001) is fully built — the platform syncs the official MCP registry weekly, enriches entries from Glama.ai, and surfaces them in a browsable catalog at `/platform/integrations`. But today the catalog is read-only. There is no path from "I found Stripe in the catalog" to "a coworker can call `create_payment_intent`."

Separately, admins have no dedicated surface for managing registered MCP services. LLM providers live at `/platform/ai/providers`; MCP services have no equivalent. Auto-detected MCP servers sit in the `McpServer` table with status `unconfigured` and no UI to act on them.

## Goal

Enable a complete lifecycle for external MCP services:

1. **Discover** — browse the catalog or auto-detect running servers
2. **Activate** — register a catalog entry as a usable endpoint with connection config
3. **Validate** — health-check the connection before going live
4. **Expose** — surface the server's tools to coworkers via the existing tool registry
5. **Manage** — admin UI for status, health, and deactivation

LLM routing (EP-INF-001–004) remains a separate concern. `ModelProvider` is for LLMs. `McpServer` is for MCP services. They may converge in the future but are intentionally decoupled now.

---

## Design

### Two Parallel Tracks

**Track 1: Catalog Activation Bridge** — the data path from catalog entry to usable service.
**Track 2: External Services Admin Surface** — the UI for managing registered services.

Both tracks share the `McpServer` table as the point of convergence.

---

### Track 1: Catalog Activation Bridge

#### 1.1 McpServer Schema Extension

The existing `McpServer` model is minimal (7 fields). Extend it to support connection lifecycle:

```prisma
model McpServer {
  id              String    @id @default(cuid())
  serverId        String    @unique          // stable identifier (e.g. registry slug)
  name            String
  config          Json                       // connection config: { transport, url, command, args, env }
  status          String    @default("unconfigured")  // unconfigured | active | degraded | unreachable | deactivated
  transport       String?                    // "stdio" | "sse" | "http" — denormalized for queries
  category        String?                    // mirrored from McpIntegration if catalog-sourced
  tags            String[]  @default([])     // capability tags (snapshot from catalog at activation time)
  healthStatus    String    @default("unknown")  // unknown | healthy | degraded | unreachable
  lastHealthCheck DateTime?
  lastHealthError String?
  integrationId   String?                    // FK to McpIntegration if activated from catalog
  activatedBy     String?                    // userId who registered it
  activatedAt     DateTime?
  deactivatedAt   DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  integration     McpIntegration? @relation(fields: [integrationId], references: [id])
  tools           McpServerTool[]

  @@index([status])
  @@index([category])
}
```

> **Note on `McpIntegration`:** Add `mcpServers McpServer[]` relation field to the `McpIntegration` model.

**Key decisions:**
- `integrationId` links back to the catalog entry via Prisma `@relation` (nullable — servers can also be manually registered or auto-detected without a catalog match).
- `tags` are a snapshot frozen at activation time. If the catalog updates tags on the next sync, the server's tags are not automatically refreshed. This is intentional — the admin accepted these capabilities at activation.
- `transport` is denormalized from `config` for filtering without JSON parsing.
- `healthStatus` is separate from `status`. A server can be `active` (admin intends it to be used) but `unreachable` (health check failed). This distinction prevents accidental deactivation on transient failures.
- `config` JSON structure varies by transport:
  - **stdio:** `{ transport: "stdio", command: string, args?: string[], env?: Record<string, string> }`
  - **sse:** `{ transport: "sse", url: string, headers?: Record<string, string> }`
  - **http:** `{ transport: "http", url: string, headers?: Record<string, string> }`

#### 1.2 Activation Flow

Server action: `activateMcpIntegration(integrationId: string, connectionConfig: McpConnectionConfig)`

1. Look up `McpIntegration` by id — must be `status: "active"`.
2. Validate `connectionConfig` shape against transport type.
3. Run health check (see 1.3). If it fails, return error — do not create the row.
4. Create `McpServer` row with:
   - `serverId` = integration slug
   - `config` = validated connection config
   - `status` = `"active"`
   - `transport` = extracted from config
   - `category`, `tags` = copied from `McpIntegration`
   - `integrationId` = link to catalog entry
   - `activatedBy` = current user
   - `activatedAt` = now
   - `healthStatus` = `"healthy"` (just passed check)
5. Run tool discovery (see 1.4).
6. Return success with server id.

**Permission:** Requires `manage_provider_connections` capability.

#### 1.3 Health Check

Function: `checkMcpServerHealth(config: McpConnectionConfig): Promise<HealthCheckResult>`

All transports use the MCP `initialize` handshake — the only transport-agnostic way to verify a server speaks MCP:

- For **http**: Send MCP `initialize` JSON-RPC request via HTTP POST. Expect `initialized` response. Timeout: 5 seconds.
- For **sse**: Send MCP `initialize` JSON-RPC request via HTTP POST (same as http transport — the SSE stream is for ongoing communication, not the handshake). Timeout: 5 seconds.
- For **stdio**: Spawn process, send MCP `initialize` request via stdin, expect `initialized` on stdout. Timeout: 10 seconds.

A plain HTTP GET is not a valid MCP health check — servers may not expose a `/health` endpoint.

Returns: `{ healthy: boolean; latencyMs: number; error?: string; toolCount?: number }`

**Stdio on serverless runtimes:** The stdio transport requires `child_process.spawn`, which is unavailable on Vercel's serverless runtime. The activation form shows a warning when `transport: "stdio"` is selected and the platform detects a serverless environment (`process.env.VERCEL` or equivalent). Health checks for stdio servers return `{ healthy: false, error: "stdio transport not supported on serverless runtime" }` in this case. Stdio transport is fully supported in dev and self-hosted Docker deployments.

Health checks run:
- On activation (blocking — must pass before server is registered)
- On-demand from admin UI ("Check Now" button — also re-runs tool discovery)
- Lazily before tool execution (if `lastHealthCheck` is older than 5 minutes)

No background health polling. Stateless, Vercel-friendly — same poll-on-request pattern as catalog sync.

#### 1.4 Tool Discovery

Function: `discoverMcpServerTools(serverId: string): Promise<DiscoveredTool[]>`

After activation and on each successful health check, call MCP `tools/list` on the server. Store discovered tools in a new `McpServerTool` table:

```prisma
model McpServerTool {
  id          String   @id @default(cuid())
  serverId    String                  // FK to McpServer.id
  toolName    String                  // original name from MCP tools/list (not namespaced)
  description String?
  inputSchema Json                    // JSON Schema from MCP tools/list
  isEnabled   Boolean  @default(true) // admin can disable individual tools
  discoveredAt DateTime @default(now()) // replaces createdAt — semantically clearer for auto-discovered rows
  updatedAt   DateTime @updatedAt

  server      McpServer @relation(fields: [serverId], references: [id], onDelete: Cascade)

  @@unique([serverId, toolName])
  @@index([serverId])
}
```

**Tool namespacing:** MCP server tools are exposed to the agentic loop with a namespace prefix to prevent collisions with `PLATFORM_TOOLS` or tools from other servers. The format is `{serverSlug}__{toolName}` (double underscore separator). For example, a tool `create_payment_intent` on a server with slug `stripe` becomes `stripe__create_payment_intent`. This ensures:
- No collision with platform tools (which never contain `__`)
- No collision between servers (each has a unique slug)
- Tool provenance is auditable — the server source is embedded in the name

The `McpServerTool.toolName` stores the original MCP name (e.g., `create_payment_intent`). The namespaced name is computed at query time by `getAvailableTools()`.

**Tool registry integration:** `getAvailableTools()` in [mcp-tools.ts](apps/web/lib/mcp-tools.ts) is extended to query enabled `McpServerTool` entries from active, healthy `McpServer` rows, prefix them with the server slug, and return them alongside `PLATFORM_TOOLS`. External tools are tagged with `requiresExternalAccess: true` and `sideEffect: true` by default (admin can override per-tool via `isEnabled`).

**Tool execution path:** When the agentic loop encounters a tool call for a namespaced MCP server tool:
1. Detect `__` separator in tool name → split into `serverSlug` and `originalToolName`
2. Look up `McpServer` by `serverId = serverSlug` → get `config`
3. Look up `McpServerTool` by `(serverId, toolName = originalToolName)` → confirm enabled
4. Lazy health check if stale (> 5 min)
5. Send MCP `tools/call` request to the server using the original tool name
6. Return `ToolResult` to the agentic loop

This extends the existing `executeTool()` switch in `mcp-tools.ts`: if the tool name contains `__`, route to MCP server execution. Platform tools (no `__`) continue through the existing switch.

---

### Track 2: External Services Admin Surface

#### 2.1 Services Page

New page at `/platform/services` (not under `/platform/ai/` — these are not LLM providers).

**Layout:**
- Header: "External Services" + count of active servers
- Two sections:
  - **Registered Services** — grid of `McpServer` rows with `status != "deactivated"`, grouped by category. Each card shows: name, transport badge, health indicator (green/yellow/red), tool count, last health check time, "Manage" link.
  - **Detected (Unconfigured)** — banner listing `McpServer` rows with `status = "unconfigured"`. Each shows name + "Configure" button that opens the registration form.

**Navigation:** Add "Services" to the platform admin nav alongside "AI" and "Integrations". Also add a "Services" card to the platform overview page (`/platform`) in the "Platform Services" section alongside the existing "AI Providers" and "Integrations" cards.

#### 2.2 Service Detail Page

`/platform/services/[serverId]`

Shows:
- Server name, status, transport, category, tags
- Connection config (redacted secrets)
- Health status with "Check Now" button
- Discovered tools table: name, description, enabled toggle
- Activation metadata: who activated, when, from which catalog entry (link)
- Deactivate button (sets `status = "deactivated"`, `deactivatedAt = now`)

#### 2.3 Activation Form

Reachable from:
- Catalog page: "Activate" button on `IntegrationCard` (pre-fills name, category, tags from catalog entry)
- Detected services banner: "Configure" button (pre-fills name from `McpServer.name`)
- Services page: "Register New" button (blank form)

Form fields:
- **Name** (pre-filled or editable)
- **Transport** (stdio / sse / http — radio group)
- **Connection details** (dynamic based on transport):
  - stdio: command, args, environment variables
  - sse/http: URL, optional headers
- **Test Connection** button — runs health check, shows result inline
- **Save & Activate** — disabled until health check passes

#### 2.4 Catalog Page Enhancement

On [IntegrationCard](apps/web/components/platform/IntegrationCard.tsx), add:
- If `McpServer` exists with matching `integrationId`: show "Active" badge + link to service detail page
- If not: show "Activate" button linking to the activation form

Query: join `McpServer` on `integrationId` when rendering catalog cards. Lightweight — just check existence.

---

## Data Flow Summary

```
MCP Registry ──sync──→ McpIntegration (catalog)
                              │
                        [Activate button]
                              │
                              ▼
                         McpServer (registered endpoint)
                              │
                        [tools/list]
                              │
                              ▼
                       McpServerTool (discovered tools)
                              │
                     [getAvailableTools()]
                              │
                              ▼
                     Agentic Loop → tools/call → MCP Server
```

## Security

- **Connection config** is stored as JSON in the database. Secrets (API keys, auth tokens) are stored in plaintext in v1. A follow-on epic (EP-MCP-SEC-001) will introduce encrypted credential storage. Until then, database access controls are the security boundary.
- **Tool execution** respects the existing `requiresExternalAccess` gate. MCP server tools are marked external by default.
- **Health checks** use the stored config. No user-supplied URLs at runtime — all connections go through admin-registered configs.
- **Permission model** reuses `manage_provider_connections` for all write operations. Read access to the services list follows existing platform visibility rules.

### Config Redaction

The `config` JSON must **never** be returned to the browser in full. A `redactConfig()` utility strips sensitive values before any API response, SSE event, or server component render:

- **Sensitive field patterns:** any key matching `secret`, `token`, `key`, `password`, `authorization`, `api_key`, `apikey` (case-insensitive)
- **Redaction for `headers`:** sensitive header values replaced with `"***"`
- **Redaction for `env`:** sensitive environment variable values replaced with `"***"`
- **Non-sensitive fields** (`transport`, `url`, `command`, `args`) are returned in full

The service detail page (section 2.2) uses `redactConfig()` before rendering. The activation form stores the full config server-side but only echoes back redacted values on re-render.

## Testing Strategy

- **Unit tests:** Schema validation, health check logic (mocked transports), tool discovery parsing, activation flow
- **Integration tests:** Full activation flow from catalog entry to tool availability in `getAvailableTools()`
- **Golden path test:** Catalog sync → activate entry → health check → tool discovery → coworker calls tool

## Migration Plan

Single migration adding:
- New columns to `McpServer` (transport, category, tags, healthStatus, lastHealthCheck, lastHealthError, integrationId, activatedBy, activatedAt, deactivatedAt, createdAt)
- Prisma relation from `McpServer.integrationId` → `McpIntegration.id`
- Reverse relation `mcpServers McpServer[]` on `McpIntegration`
- New `McpServerTool` table with cascade delete on server removal
- Index additions on `McpServer` (status, category) and `McpServerTool` (serverId)

Existing `McpServer` rows (auto-detected, status `unconfigured`) remain untouched — they gain the new columns with default values.

## What We Explicitly Defer

| Item | Why |
|------|-----|
| Unified coworker identity | Persona retirement is behind feature flag; current coworkers use tools via existing mechanism |
| LLM + MCP convergence | `ModelProvider` for LLMs, `McpServer` for services — may merge later |
| Encrypted credential vault | v1 stores config as JSON; follow-on EP-MCP-SEC-001 |
| Background health polling | Poll-on-request is sufficient; no persistent background process needed |
| MCP resources/prompts discovery | v1 discovers tools only; resources and prompts are follow-on |
| Per-tool permission gating | v1 uses server-level `requiresExternalAccess`; per-tool ACLs are follow-on |
| Service event audit log | v1 records `activatedBy`/`activatedAt`/`deactivatedAt` on the row. A full `McpServerEvent` audit table (tracking every state transition, config change, health failure) is follow-on — the current fields provide sufficient evidence for the initial regulated-industry requirement |
| Coworker-initiated activation | v1 limits activation to admin UI only. A coworker discovering a service via `search_integrations` cannot trigger activation through the agentic loop — it requires human admin action |
