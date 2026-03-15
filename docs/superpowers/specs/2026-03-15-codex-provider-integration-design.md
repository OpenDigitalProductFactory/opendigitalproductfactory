# EP-CODEX-001: OpenAI Codex Provider + MCP Server Integration

**Date:** 2026-03-15
**Status:** Draft
**Epic:** EP-CODEX-001

## Problem

The platform's AI provider registry treats all providers as raw model APIs with per-token or compute-based billing. OpenAI Codex is a fundamentally different kind of provider — an agentic coding specialist that runs tasks with tool use, sandboxed execution, and persistent threads. It also has a different billing model (subscription via ChatGPT plan OR per-token via API key) that users find confusing when mixed with standard API billing.

Platform users (business decision-makers) need to understand what they're paying for and how different providers compare on cost-to-performance — not just raw token pricing.

## Solution

Add OpenAI Codex as a distinct provider (`providerId: "codex"`) with MCP server integration, a new provider category (`"agent"`), and human-readable billing labels across all providers.

## Design

### 1. Provider Registry Changes

#### Schema migration: two new fields on `ModelProvider`

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `billingLabel` | `String?` | `null` | Human-readable billing description shown on provider cards |
| `costPerformanceNotes` | `String?` | `null` | Admin-facing context for cost/performance trade-offs, shown on detail page |

The existing `costModel` field gains a third valid value: `"subscription"` alongside `"token"` and `"compute"`. No enum change needed — the field is already a `String`.

The existing `category` field gains a third valid value: `"agent"` alongside `"direct"` and `"router"`.

#### Registry entry: `providers-registry.json`

```json
{
  "providerId": "codex",
  "name": "OpenAI Codex",
  "category": "agent",
  "baseUrl": null,
  "authMethod": "api_key",
  "supportedAuthMethods": ["api_key"],
  "authHeader": "Authorization",
  "costModel": "token",
  "families": ["codex-mini"],
  "inputPricePerMToken": 1.50,
  "outputPricePerMToken": 6.00,
  "billingLabel": "Pay-per-use (API key) or Subscription (ChatGPT plan)",
  "costPerformanceNotes": "Agentic coding specialist. ~3x cheaper than GPT-4o for code tasks. Runs in sandboxed environment with tool use and persistent threads.",
  "docsUrl": "https://developers.openai.com/codex/",
  "consoleUrl": "https://platform.openai.com/settings/organization/billing"
}
```

Key distinctions from the existing `openai` entry:
- Separate `providerId` — own credential, own spend tracking, own billing
- `category: "agent"` — not a raw model API
- Different pricing ($1.50/$6.00 vs $2.50/$10.00)
- `authMethod: "api_key"` — subscription billing mode is deferred (no platform-side credential flow exists for it yet; subscription users use Codex via IDE, not platform API calls)

#### Registry type update: `RegistryProviderEntry`

Widen the `category` union from `"direct" | "router"` to `"direct" | "router" | "agent"` in `ai-provider-types.ts`.

Add optional `billingLabel` and `costPerformanceNotes` fields to `RegistryProviderEntry` and `ProviderRow`. The sync logic in `syncProviderRegistry()` persists these to the new DB columns.

### 2. MCP Server Integration

#### McpServer record (seeded)

```json
{
  "serverId": "codex-agent",
  "name": "OpenAI Codex Agent",
  "config": {
    "command": "npx",
    "args": ["-y", "codex", "mcp-server"],
    "transport": "stdio",
    "tools": ["codex", "codex-reply"],
    "linkedProviderId": "codex",
    "defaults": {
      "approval-policy": "on-request",
      "sandbox": "workspace-write"
    }
  },
  "status": "unconfigured"
}
```

- `linkedProviderId: "codex"` — reserved for future spend attribution (see note below)
- `transport: "stdio"` — JSON-RPC over stdio (standard Codex MCP protocol)
- Two tools exposed: `codex` (start session) and `codex-reply` (continue thread)
- Configurable `approval-policy` (untrusted | on-request | never) and `sandbox` (read-only | workspace-write | danger-full-access)

**Note on `linkedProviderId`:** This field is stored in the untyped `config: Json` blob. In this phase it is seeded but not consumed by any runtime code path — spend attribution from MCP invocations to the Codex provider is deferred to the agent orchestration epic. A typed `McpServerConfig` interface and the consumption point will be specified in that epic.

#### Orchestration pattern (contextual — not in implementation scope)

The following describes the intended runtime pattern, implemented in a future agent orchestration epic:

A lower-cost orchestrator model (e.g. Ollama running locally) dispatches coding tasks to Codex via the MCP tools:

1. Orchestrator receives a task
2. Determines it requires code generation/modification
3. Invokes `codex` MCP tool with the task description
4. Codex runs in its sandbox, uses tools, writes code
5. Orchestrator receives the result via `codex-reply`
6. Platform logs token usage against the `codex` provider via `linkedProviderId`

This enables a cost-efficient tier architecture: cheap local model for routing/decisions, expensive cloud specialist for code execution.

### 3. Billing Clarity UX

#### Auto-generated billing labels

For providers without an explicit `billingLabel`, the UI generates one from pricing data:

| costModel | Generated label |
|-----------|----------------|
| `token` (with prices) | "Pay-per-use · $X.XX/$X.XX per M tokens" |
| `token` (no prices, e.g. routers) | "Pay-per-use · rates vary by model" |
| `compute` | "Local compute · electricity cost only" |

The `billingLabel` field from the DB/registry overrides the auto-generated label when set.

#### Provider card changes

Each provider card on `/platform/ai` gains the billing label, displayed in small muted text below the family list. Format: `fontSize: 10, color: #8888a0`.

#### Third category section on the grid

The AI Providers page currently groups providers into "Direct Providers" and "Routers & Gateways". A third section is added: **"Agent Providers"** for `category: "agent"`. This visually separates agentic providers (Codex, and future entries like Claude Code or Devin) from raw model APIs.

**Rendering order:** Direct Providers, Agent Providers, Routers & Gateways.
**Empty state:** The Agent Providers section is hidden when no `category: "agent"` providers exist (same conditional pattern as the existing sections).

#### Cost-performance notes on detail page

The provider detail page (`/platform/ai/providers/[providerId]`) shows the `costPerformanceNotes` in an info box above the configuration form when the field is non-null. Styled as a subtle info panel (`background: #161625`, `border-left: 3px solid #7c8cf8`).

### 4. Seed Changes

`packages/db/src/seed.ts` gains a `seedMcpServers()` function that upserts the Codex MCP server record. Called after `seedScheduledJobs()`.

**Upsert policy:** On re-seed, `seedMcpServers()` creates the record if missing but does NOT overwrite `config` or `status` if the record already exists. This preserves admin-modified sandbox/approval-policy settings. Same rationale as `syncProviderRegistry()` which preserves `status`, `enabledFamilies`, and `endpoint`.

### 5. What Is NOT In Scope

- **Codex TypeScript SDK** (`@openai/codex-sdk`) — can be layered on later if direct programmatic access proves more useful than MCP
- **Budget guardrails / spending limits** — deferred to the financial management module (parallel workstream)
- **Cost-vs-labor comparison** — deferred to financial management + HR system integration
- **Subscription auth method** — `"subscription"` as a `supportedAuthMethod` is deferred. No platform-side credential flow exists for subscription billing. Subscription users access Codex via IDE/CLI (personal use), not platform API calls. When a subscription auth flow becomes feasible, it will be specified in a follow-up epic.
- **Subscription usage tracking** — subscription plans have usage limits but no per-token cost; tracking "credits consumed" requires Codex API support that doesn't yet exist for third-party apps.
- **MCP spend attribution** — the `linkedProviderId` field in the MCP server config is seeded but not consumed. Runtime spend attribution from MCP tool invocations to the Codex provider is deferred to the agent orchestration epic.
- **Agent orchestration runtime** — the orchestration pattern described in Section 2 (Ollama dispatching to Codex via MCP) is contextual background. The actual dispatch logic, thread management, and multi-agent coordination are a separate epic.

## Files to Create or Modify

### Modify
- `packages/db/prisma/schema.prisma` — add `billingLabel String?` and `costPerformanceNotes String?` to `ModelProvider`
- `packages/db/data/providers-registry.json` — add `codex` entry, add `billingLabel`/`costPerformanceNotes` to existing entries
- `packages/db/src/seed.ts` — add `seedMcpServers()` for Codex MCP server record
- `apps/web/lib/ai-provider-types.ts` — extend `RegistryProviderEntry`, `ProviderRow` with new fields; add `getBillingLabel()` pure function
- `apps/web/lib/actions/ai-providers.ts` — update `syncProviderRegistry()` to persist `billingLabel`, `costPerformanceNotes`
- `apps/web/app/(shell)/platform/ai/page.tsx` — add "Agent Providers" section, billing labels on cards
- `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` — cost-performance notes info box

### Create
- Prisma migration for `billingLabel` and `costPerformanceNotes` columns

### Test
- `apps/web/lib/ai-providers.test.ts` — add tests for `getBillingLabel()` pure function
