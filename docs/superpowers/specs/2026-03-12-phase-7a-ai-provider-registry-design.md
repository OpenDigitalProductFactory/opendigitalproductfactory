# Phase 7A — AI Provider Registry & Token Spend Design

**Date:** 2026-03-12
**Status:** Draft
**Scope:** Dynamic AI provider registry, credential management, auth validation, token spend tracking, and a central platform scheduler. Lives at `/platform/ai`.

---

## Context and Motivation

The platform's AI agents call LLM APIs. Today, provider credentials and model choices are implicit (env vars, hard-coded assumptions). As the agent roster grows — and as local models like Ollama become viable — the platform needs a first-class way to register providers, manage API keys, and understand what AI costs. The analogy to HR is intentional: just as human employees have salaries tracked per role, AI agents have token spend tracked per context. Phase 7A builds the infrastructure layer that Phases 7B (agent job assignment) and 7C (AI co-worker sidebar) depend on.

---

## Architecture

A new `/platform/ai` route surfaces three concerns in a single admin page: the provider registry, the token spend dashboard, and the platform scheduler. Provider definitions are sourced from a JSON file in the ODPF GitHub repo and synced on a configurable schedule. Two cost models are supported: token-priced (cloud APIs) and compute-priced (local inference). A new `ScheduledJob` table coordinates all recurring platform tasks — provider sync is the first entry.

**Tech stack:** Next.js 14 App Router, Prisma 5, PostgreSQL. No new runtime dependencies.

---

## Capability

The existing `manage_provider_connections` capability (already in `permissions.ts`, assigned to `HR-000`) is repurposed for this feature. No new capability is added. All write actions on `/platform/ai` check `manage_provider_connections`. The capability name is kept as-is to avoid churn in downstream call sites.

---

## Data Model

### New: `TokenUsage`

```prisma
model TokenUsage {
  id           String   @id @default(cuid())
  agentId      String                          // Agent.agentId business key (e.g. "HR-100")
  providerId   String                          // ModelProvider.providerId business key
  contextKey   String                          // route path, e.g. "/ea/views/abc"
  inputTokens  Int      @default(0)
  outputTokens Int      @default(0)
  inferenceMs  Int?                            // compute-priced providers only
  costUsd      Float    @default(0)            // computed at log time
  createdAt    DateTime @default(now())
}
```

`agentId` and `providerId` are bare string business keys with no FK relations. `getTokenSpendByAgent` uses a two-step fetch: aggregate `TokenUsage` by `agentId`, then `prisma.agent.findMany({ where: { agentId: { in: ids }}})` to join agent names. This avoids requiring every agent to have a DB row before spend can be logged.

### New: `ScheduledJob`

```prisma
model ScheduledJob {
  id         String    @id @default(cuid())
  jobId      String    @unique
  name       String
  schedule   String    @default("weekly")   // "daily" | "weekly" | "monthly" | "disabled"
  lastRunAt  DateTime?
  nextRunAt  DateTime?
  lastStatus String?                        // "ok" | "error" — application-enforced
  lastError  String?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}
```

`nextRunAt` computation: on each run or schedule change, `nextRunAt = now + interval` where `daily → 1 day`, `weekly → 7 days`, `monthly → 30 days`. If `schedule = "disabled"`, `nextRunAt = null`. The on-load check is the only trigger mechanism in Phase 7A — "weekly" means the sync fires at most once per week and only when an admin visits `/platform/ai`. A background runner is out of scope.

### Extended: `ModelProvider` (migration required)

The migration adds these columns and changes the status default:

```prisma
// Changes to existing ModelProvider model:
status              String    @default("unconfigured")  // was @default("inactive")
// New columns:
authEndpoint        String?   // URL for auth check; null for custom-endpoint providers
authHeader          String?   // header name for API key; null = keyless provider
endpoint            String?   // custom base URL (Azure OpenAI and similar)
costModel           String    @default("token")         // "token" | "compute"
inputPricePerMToken  Float?
outputPricePerMToken Float?
computeWatts        Float?
electricityRateKwh  Float?
enabledFamilies     Json      @default("[]")
```

`status` valid values (enforced by application logic only, not a DB constraint):
- `"unconfigured"` — default for new rows (registry-synced but not yet configured)
- `"active"` — configured and auth check passed
- `"inactive"` — manually disabled

The migration changes `@default("inactive")` to `@default("unconfigured")`. Existing rows with `status = "inactive"` are unchanged by the migration — the application treats both as "not active" for routing purposes.

### `CredentialEntry` (existing, unchanged schema)

`providerId` (business key, `@unique`) → `secretRef String?` (env var name, e.g. `"ANTHROPIC_API_KEY"`) + `status String`.

One credential entry per provider. `secretRef` is nullable — keyless providers (Ollama, `authHeader: null`) have no entry or have `secretRef = null`.

---

## TypeScript Types

```ts
// apps/web/lib/ai-provider-types.ts

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
```

---

## Provider Registry JSON

Hosted at:
`https://raw.githubusercontent.com/markdbodman/opendigitalproductfactory/main/packages/db/data/providers-registry.json`

Schema per entry:

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
    "providerId": "ollama",
    "name": "Ollama (local)",
    "families": ["llama3", "mistral", "phi3"],
    "authEndpoint": "http://localhost:11434/api/tags",
    "authHeader": null,
    "costModel": "compute",
    "computeWatts": 150,
    "electricityRateKwh": 0.12
  }
]
```

**Azure OpenAI special case:** `authEndpoint: null` because the auth URL depends on the admin's resource name. The auth check constructs `${ModelProvider.endpoint}/openai/models?api-version=2024-02-01` using the `endpoint` field the admin enters on the detail page.

**Keyless providers** (`authHeader: null`): auth check is `GET authEndpoint` with no credentials. HTTP 2xx = ok. No `CredentialEntry` is created for these providers (or `secretRef` is null if one exists).

**`syncProviderRegistry()` upsert behaviour:**
- `create` branch: all registry fields written, `status = "unconfigured"`, `enabledFamilies = []`
- `update` branch: all registry fields written including `name`, `families`, `authEndpoint`, `authHeader`, `costModel`, all pricing fields. **`status` and `enabledFamilies` are never overwritten on update.** This preserves admin configuration across syncs.

---

## Cost Calculation

**Token-priced:**
```
costUsd = (inputTokens / 1_000_000 × inputPricePerMToken)
        + (outputTokens / 1_000_000 × outputPricePerMToken)
```

**Compute-priced:**
```
costUsd = (inferenceMs / 3_600_000) × (computeWatts / 1_000) × electricityRateKwh
```

Both store `costUsd` in `TokenUsage` at log time.

---

## Routes & Pages

### `/platform/ai` (new)

**Auth:** Inherited from the parent `/platform/layout.tsx` which already gates on `view_platform`. No additional `layout.tsx` is needed for `/platform/ai` or `/platform/ai/providers/[providerId]` — the parent layout covers both. Write actions are independently enforced inside each server action via `manage_provider_connections`.

**On-load auto-sync:** The server component queries `ScheduledJob` for `jobId = "provider-registry-sync"`. If `nextRunAt` is not null, is in the past, and `schedule ≠ "disabled"`, it `await`s `syncProviderRegistry()` before rendering. This keeps data fresh without a background runner. The await adds latency only when a sync is due.

The auto-sync call **does not check `manage_provider_connections`** — it is triggered by the server render, not by user intent, and the page is already gated by `view_platform`. Any authorized viewer's page load can trigger a due sync. The `manage_provider_connections` check applies only to the explicit "↻ Sync from registry" button action and to all other write actions.

Three sections:

**1 — Provider Registry**
Card grid of all `ModelProvider` rows. Each card: name, status badge (`"unconfigured"` / `"active"` / `"inactive"`), model families, "Configure →" link. Header: last sync timestamp (from `ScheduledJob.lastRunAt`) + "↻ Sync from registry" button (server action `syncProviderRegistry`, requires `manage_provider_connections`).

**2 — Token Spend**
Client component with two tabs: *By Provider* | *By Agent*. Month selector (client state `{ year: number; month: number }`, defaults to current month) triggers a re-render via `useTransition` + `router.refresh()`, or a direct server action call with the selected month. If `TokenUsage` is empty (expected in Phase 7A), both tabs show a "No spend data yet" empty state.

- *By Provider*: stat cards — `totalCostUsd`, `totalInputTokens`, `totalOutputTokens`, proportional progress bar.
- *By Agent*: table sorted by `totalCostUsd` descending — agent name, token counts, cost. No `contextKey` column (one agent can have many context keys; the table aggregates all of them).

**3 — Scheduled Jobs**
Table of all `ScheduledJob` rows ordered by `jobId`. Columns: name, schedule (editable `<select>` for `manage_provider_connections` holders, calls `updateScheduledJob` on change), last run, next run, last status. "Run now" button calls `runScheduledJobNow`.

### `/platform/ai/providers/[providerId]` (new)

Detail page (server component + client form). Fields shown conditionally:

| Field | Shown when |
|---|---|
| Enabled families (multi-checkbox) | always |
| API key env var name | `authHeader !== null` (token-priced / keyed providers) |
| Custom endpoint | `authEndpoint === null` (Azure OpenAI etc.) |
| Compute wattage + electricity rate | `costModel === "compute"` |

**"API key env var name" input:** Admin types the env var name (e.g. `ANTHROPIC_API_KEY`), not the key value. Label reads "Environment variable name". Saves to `CredentialEntry.secretRef`.

**"Test connection" button:** Calls `testProviderAuth`. Shows inline ✓ or ✗ with message. On success also sets `ModelProvider.status = "active"`.

---

## Server Actions

**`apps/web/lib/actions/ai-providers.ts`** — write actions gated by `manage_provider_connections` unless noted.

`syncProviderRegistry` carries **no auth guard internally** so the server component can call it on page load for any `view_platform` holder. A thin wrapper action `triggerProviderSync` adds the `manage_provider_connections` guard and is what the "↻ Sync from registry" button wires to. This matches the `requireManageBacklog` wrapper pattern used in `backlog.ts`.

### `syncProviderRegistry(): Promise<{ added: number; updated: number; error?: string }>` *(no auth guard)*
- Fetches registry JSON (5s timeout). Returns `{ error }` on network failure.
- Upserts each entry into `ModelProvider` per the create/update rules above.
- Updates `ScheduledJob` (`lastRunAt = now`, `nextRunAt = now + interval`, `lastStatus = "ok"` or `"error"`).

### `configureProvider(input: { providerId: string; secretRef?: string; enabledFamilies: string[]; endpoint?: string; computeWatts?: number; electricityRateKwh?: number }): Promise<{ error?: string }>`
- `secretRef`, `endpoint`, `computeWatts`, and `electricityRateKwh` are optional. Under `exactOptionalPropertyTypes: true`, callers must **omit** these properties entirely rather than pass `undefined` — e.g. `{ providerId, enabledFamilies }` for keyless providers. Passing `secretRef: undefined` is a compile error.
- For keyless providers (where `secretRef` is omitted): skips `CredentialEntry` upsert.
- For keyed providers: upserts `CredentialEntry { providerId, secretRef, status: "pending" }`.
- Updates `ModelProvider`: `enabledFamilies`, and conditionally `endpoint`, `computeWatts`, `electricityRateKwh`.
- Does **not** set `ModelProvider.status = "active"` — that only happens after `testProviderAuth` succeeds.

### `testProviderAuth(providerId: string): Promise<{ ok: boolean; message: string }>`

Guard conditions (checked in order, return early with `{ ok: false, message }` if any fail):
1. `ModelProvider` not found → `"Provider not found"`
2. `authHeader !== null` and no `CredentialEntry` row or `secretRef` is null → `"No credential configured"`
3. `authHeader !== null` and `process.env[secretRef]` is `undefined` → `"Environment variable not set"`
4. `authEndpoint === null` and `endpoint` is null → `"Custom endpoint required"`

Auth URL: `ModelProvider.endpoint ? "${endpoint}/openai/models?api-version=2024-02-01" : authEndpoint`.

Request: GET to auth URL, 8s timeout, with header `{ [authHeader]: process.env[secretRef] }` (omitted entirely for keyless providers).

- HTTP 2xx → `{ ok: true, message: "Connected — HTTP 200" }`. Sets `ModelProvider.status = "active"`, `CredentialEntry.status = "ok"`.
- Non-2xx or network error → `{ ok: false, message: "HTTP 401 — Unauthorized" }` (includes status code). Sets `CredentialEntry.status = "error"`. Leaves `ModelProvider.status` unchanged.

### `triggerProviderSync(): Promise<{ added: number; updated: number; error?: string }>` *(requires `manage_provider_connections`)*
Thin wrapper: checks capability, then calls `syncProviderRegistry()`. This is what the "↻ Sync from registry" button binds to as a form action.

### `updateScheduledJob(input: { jobId: string; schedule: string }): Promise<void>`
Updates `schedule`. Sets `nextRunAt = now + interval` (or `null` if `"disabled"`).

### `runScheduledJobNow(jobId: string): Promise<void>`
Dispatches job by `jobId`. For `"provider-registry-sync"`: calls `syncProviderRegistry()`. Unknown `jobId`: no-op.

### `logTokenUsage(input: { agentId: string; providerId: string; contextKey: string; inputTokens: number; outputTokens: number; inferenceMs?: number }): Promise<void>`
**Auth:** Requires a valid platform session (`auth()` check, `session.user` must exist). No capability restriction — any authenticated HR role may log spend on behalf of an agent. No `manage_provider_connections` guard needed since this is written by agent infrastructure, not the admin UI.

Fetches `ModelProvider` pricing fields, computes `costUsd`, writes `TokenUsage` row. Called by agent infrastructure in Phase 7B+. **The table will be empty during Phase 7A** — this action is implemented now so the schema and hook are ready.

---

## Data Fetchers

**`apps/web/lib/ai-provider-data.ts`**

### `getProviders(): Promise<ProviderWithCredential[]>`
```ts
const providers = await prisma.modelProvider.findMany({ orderBy: { name: "asc" } });
const credentials = await prisma.credentialEntry.findMany({
  where: { providerId: { in: providers.map((p) => p.providerId) } },
});
const credMap = new Map(credentials.map((c) => [c.providerId, c]));
return providers.map((p) => ({ provider: p as ProviderRow, credential: credMap.get(p.providerId) ?? null }));
```

### `getTokenSpendByProvider(month: { year: number; month: number }): Promise<SpendByProvider[]>`
Date range: `gte: first day of month, lt: first day of next month` (UTC). Prisma `groupBy: ["providerId"]`, `_sum: { inputTokens, outputTokens, costUsd }`. Prisma `_sum` fields return `number | null` — coalesce with `?? 0` when mapping to `SpendByProvider`.

### `getTokenSpendByAgent(month: { year: number; month: number }): Promise<SpendByAgent[]>`
Same date filter. `groupBy: ["agentId"]`, `_sum: { inputTokens, outputTokens, costUsd }`. Coalesce all `_sum` fields with `?? 0`. Then `prisma.agent.findMany({ where: { agentId: { in: agentIds }}})` to build a name map. Name resolution pattern:
```ts
const agentMap = new Map(agents.map((a) => [a.agentId, a.name]));
// per row:
agentName: agentMap.get(row.agentId) ?? row.agentId,
```
Agents with no matching `Agent` row fall back to displaying `agentId`.

### `getScheduledJobs(): Promise<ScheduledJob[]>`
`prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } })`.

---

## Navigation

`/platform/ai` is accessed via an "AI Providers" card added to the `/platform` capabilities grid (always visible to `view_platform` holders). No new top-level nav item.

---

## Seed Data

**`packages/db/data/providers-registry.json`** (initial entries, committed to repo):
`anthropic`, `openai`, `azure-openai`, `gemini`, `ollama`, `bedrock`.

**`seed.ts`** adds `seedScheduledJobs()`:
```ts
await prisma.scheduledJob.upsert({
  where: { jobId: "provider-registry-sync" },
  create: {
    jobId: "provider-registry-sync",
    name: "Provider registry sync",
    schedule: "weekly",
    nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  },
  update: {
    // Only reset schedule; preserve operational state (lastRunAt, lastStatus, nextRunAt)
    schedule: "weekly",
  },
});
```

The `update` branch only resets `schedule` — it does not overwrite `lastRunAt`, `lastStatus`, or `nextRunAt` on re-seed, preserving recorded sync history on production databases.

---

## Out of Scope for Phase 7A

- Actual LLM call integration — agents still use env vars directly; `logTokenUsage` is the hook for Phase 7B+
- Budget alerts or spend limits
- Per-user spend breakdown
- Secrets manager integration (Phase 7A uses env var name references only)
- Background job runner (sync fires on page visit only)
- Route handler for sync — the server component calls `syncProviderRegistry()` directly
