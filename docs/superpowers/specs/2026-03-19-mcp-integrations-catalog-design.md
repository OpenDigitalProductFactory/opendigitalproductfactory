# MCP Integrations Catalog — Design Spec

**Date:** 2026-03-19
**Epic:** EP-INT-001
**Status:** Draft — awaiting plan

---

## 1. Overview

Add a locally-cached, periodically-synced catalog of MCP integrations to the ODPF platform. The catalog is pulled from the official MCP Registry (`registry.modelcontextprotocol.io`) and enriched with metadata from Glama.ai (ratings, logos, pricing). Storing the catalog locally means any agent, process, or admin UI can query it without hitting external APIs at runtime.

The catalog serves three consumers:

1. **Business owner** — browses integrations in the admin panel, filtered by their archetype or category, to discover services they can connect to their instance (Stripe for payments, WordPress for an existing site, Mailchimp for email marketing, etc.)
2. **AI Coworker** — searches the local catalog when advising on new features or storefront setup, returning relevant options with key metadata (name, pricing, rating, docs link)
3. **Platform admin** — runs weekly sync to refresh the catalog via a manual trigger or automated schedule; monitors sync history and stats

This is especially valuable for small businesses that are unaware of what integrations exist, or are migrating existing tooling onto the platform and need connection options surfaced proactively.

---

## 2. Scope

### In scope

- `McpIntegration` Prisma model — catalog entries
- `McpCatalogSync` Prisma model — sync log
- Sync service — paginated pull from official MCP Registry, per-batch enrichment from Glama.ai, archetype relevance derivation, upsert + deprecation logic
- Cron job — configurable weekly schedule (default Sunday 02:00 UTC)
- Admin UI — `/platform/integrations` catalog browser + `/platform/integrations/sync` management page
- `search_integrations` tool added to `PLATFORM_TOOLS` in `mcp-tools.ts`
- Tag→archetype ruleset — code-level config mapping registry tags to `StorefrontArchetype.archetypeId` values

### Out of scope (follow-on epics)

- Credential management — storing API keys, OAuth tokens per integration (EP-INT-002)
- In-platform activation flows — connecting a live integration with authenticated credentials (EP-INT-002)
- Building or self-hosting custom MCP servers
- Real-time health monitoring of connected integrations

---

## 3. Data Model

### `McpIntegration`

Stores one row per integration. `registryId` is the conflict key for upserts.

```prisma
model McpIntegration {
  id               String   @id @default(cuid())
  registryId       String   @unique  // canonical ID from official registry
  slug             String   @unique  // kebab-case, for local lookup & URLs
  name             String
  shortDescription String?
  description      String?  @db.Text
  logoUrl          String?
  vendor           String?           // publisher name (e.g. "Stripe, Inc.")
  repositoryUrl    String?
  documentationUrl String?
  category         String            // registry taxonomy (e.g. "finance", "cms", "cloud")
  subcategory      String?
  tags             String[]
  pricingModel     String?           // "free" | "paid" | "freemium" | "open-source"
  rating           Decimal?          // 0–5, sourced from Glama
  ratingCount      Int?
  installCount     Int?              // popularity signal from registry
  isVerified       Boolean  @default(false)  // official/verified publisher
  archetypeIds     String[]          // archetype relevance — derived from tags on sync
  status           String   @default("active")  // "active" | "deprecated" | "coming-soon"
  rawMetadata      Json              // full registry payload — forward compatibility
  lastSyncedAt     DateTime
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([category])
  @@index([pricingModel])
  @@index([isVerified])
  @@index([status])
  @@index([tags])  // GIN index for array containment queries (tags @> ARRAY[...])
}
```

### `McpCatalogSync`

One row per sync run. Used for admin history view and progress tracking.

```prisma
model McpCatalogSync {
  id                  String    @id @default(cuid())
  triggeredBy         String    // "schedule" | "manual"
  triggeredByUserId   String?   // populated when triggeredBy === "manual"; matches User.id
  startedAt           DateTime  @default(now())
  completedAt         DateTime?
  status              String    @default("running")  // "running" | "success" | "failed"
  totalFetched        Int?
  totalUpserted       Int?
  totalNew            Int?
  totalRemoved        Int?      // entries marked deprecated since last sync
  error               String?   @db.Text
}
```

**`triggeredBy` semantics:** always one of the two literals `"schedule"` or `"manual"`. For manual admin triggers, `triggeredByUserId` holds the authenticated user's `User.id` for audit attribution — matching the `triggeredByEmployeeId` pattern used in `RegulatoryMonitorScan`. The sync history table displays the user's name when `triggeredByUserId` is present.

### Archetype derivation

`archetypeIds` is populated during sync using a tag→archetype ruleset defined in code (e.g. `"payments"` → `["retail-goods", "food-hospitality", "fitness-recreation", "education-training"]`). No separate mapping table — the ruleset is a config object in the sync service, extensible without a migration. Ruleset values are the exact `archetypeId` strings defined in `StorefrontArchetype` (e.g. `"retail-goods"`, `"veterinary-clinic"`). The ruleset is treated as a trusted config — no runtime validation against the `StorefrontArchetype` table on each sync. If an archetype is removed from the platform, the corresponding ruleset entry is updated in the same PR. Entries missing enrichment fields from Glama (logo, rating, pricing) leave those fields `null` — not a sync failure.

---

## 4. Sync Architecture

### Sources

| Source | Purpose | API |
|---|---|---|
| Official MCP Registry | Primary — registryId, name, description, tags, category, vendor, repositoryUrl | `registry.modelcontextprotocol.io/v0/servers` (paginated, cursor-based) |
| Glama.ai | Enrichment — rating, ratingCount, installCount, logoUrl, pricingModel | `glama.ai/api/mcp/v1/servers/{id}` (per entry) |

### Sync flow

```
1. Create McpCatalogSync record (status: "running", triggeredBy)
2. Paginate MCP Registry API — collect all server records
3. For each page batch (50 entries):
   a. Enrich with Glama metadata — parallel requests, max 10 concurrent, 100ms delay between batches
   b. Derive archetypeIds from tags using ruleset
   c. Upsert into McpIntegration (conflict key: registryId)
4. Mark entries absent from this sync as status: "deprecated"
5. Update McpCatalogSync (status: "success", totalFetched, totalUpserted, totalNew, totalRemoved)
6. On unrecoverable error → status: "failed", error logged to McpCatalogSync.error
```

### Scheduling mechanism

The sync job is registered as a `ScheduledJob` record (`jobId: "mcp-catalog-sync"`) following the existing platform pattern. The `ScheduledJob.schedule` field stores a `ScheduleValue` named interval — `"weekly"` by default. `nextRunAt` and `lastRunAt` are maintained by `computeNextRunAt()` (`apps/web/lib/ai-provider-types.ts`) — the same utility used by all other scheduled jobs. The default `nextRunAt` is seeded to the next Sunday 02:00 UTC on first registration. The admin schedule config UI presents the four existing `ScheduleValue` options (`daily`, `weekly`, `monthly`, `disabled`) — no cron expression entry; day-of-week and time precision are not supported in this epic and are deferred to EP-INT-004.

Automated execution: the platform does not run a persistent background process. Scheduled jobs fire via the existing poll-on-request mechanism — a lightweight check at the start of relevant API requests compares `nextRunAt` to `now()` and fires overdue jobs. No external cron runner, Vercel cron config, or `node-cron` package is needed or added.

### Entry points

Both entry points call the same `runMcpCatalogSync()` service function in `lib/actions/mcp-catalog.ts`:

- **Admin "Sync Now"** — server action; authenticated admin triggers manually; `triggeredBy: "manual"`, `triggeredByUserId` set to session user ID; emits `sync:progress` events on the `agentEventBus` keyed by the `McpCatalogSync.id` for the SSE stream; UI subscribes to that key for real-time progress display (fetched, upserted, new, deprecated counts). `sync:progress` is a new event type added to the `AgentEvent` union in `agent-event-bus.ts`.
- **Scheduled** — fired by the poll-on-request mechanism when `nextRunAt` is overdue; `triggeredBy: "schedule"`; `triggeredByUserId: null`; no SSE stream — logs to `McpCatalogSync` only.

### Rate limiting

Glama enrichment: 10 concurrent requests, 100ms delay between batches. Stays within free-tier limits. Registry API: standard cursor pagination with no artificial throttle — the official registry is designed for aggregator pulls.

---

## 5. Admin UI

### Catalog browser — `/platform/integrations`

New top-level section in the shell nav alongside Workforce, Storefront, etc.

- **Grid view** — `McpIntegration` cards: logo, name, vendor, `shortDescription`, category badge, pricing badge (`FREE` / `PAID` / `FREEMIUM` / `OSS`), star rating + count, verified tick
- **Filters** — category, pricingModel, archetypeIds (multi-select), isVerified toggle
- **Search** — keyword search against `name`, `shortDescription`, `tags` using Prisma `contains` / `ILIKE` on text fields and array containment on `tags` — local DB query only, no external call at browse time. The `@@index([tags])` GIN index on `McpIntegration` makes tag containment queries efficient at catalog scale.
- **Detail drawer** — opens on card click: full `description`, all tags, rating breakdown, `installCount`, links to `documentationUrl` and `repositoryUrl`

### Sync management — `/platform/integrations/sync`

- Last sync: timestamp, status badge, counts summary
- **Sync Now** button — disabled while `status: "running"`; shows real-time progress (fetched, upserted, new, deprecated) using existing long-running ops progress pattern
- **Sync history table** — `McpCatalogSync` rows: date, triggeredBy, duration, totalFetched, totalNew, totalRemoved, status
- **Schedule config** — `ScheduleValue` selector (`daily` / `weekly` / `monthly` / `disabled`); persisted to the `ScheduledJob` record for `"mcp-catalog-sync"`

---

## 6. AI Coworker Tool

New entry in `PLATFORM_TOOLS` (`apps/web/lib/mcp-tools.ts`):

```ts
{
  name: "search_integrations",
  description: "Search the MCP integrations catalog for services relevant to a feature or business need. Use when the user asks what they can connect, or when researching integrations for a new feature.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What you are looking for — e.g. 'payments', 'email marketing', 'booking calendar', 'source control'"
      },
      category: {
        type: "string",
        description: "Optional category filter — e.g. 'finance', 'cms', 'cloud', 'crm'"
      },
      archetypeId: {
        type: "string",
        description: "Optional archetype filter — returns integrations tagged as relevant to this archetype"
      },
      pricingModel: {
        type: "string",
        enum: ["free", "paid", "freemium", "open-source"],
        description: "Optional pricing filter"
      },
      limit: {
        type: "number",
        description: "Max results to return. Default 10."
      }
    },
    required: ["query"]
  },
  requiredCapability: null  // read-only catalog search — available to all roles
}
```

**Returned fields per result:** `name`, `vendor`, `shortDescription`, `category`, `pricingModel`, `rating`, `ratingCount`, `isVerified`, `documentationUrl`, `archetypeIds`.

The Coworker calls this tool when:
- A business owner asks "what can I use for payments / email / bookings?"
- Build Studio agents are researching integrations for a new feature
- Storefront setup surfaces integration recommendations based on the selected archetype

---

## 7. Security

| Concern | Approach |
|---|---|
| Admin-only sync trigger | Sync Now server action requires `manage_platform_settings` capability |
| Schedule config | Persisted via existing platform settings; same capability gate |
| Catalog browse | Read-only; available to all authenticated shell users — no sensitive data exposed |
| AI tool | `requiredCapability: null` — read-only, no side effects, safe for all roles |
| External API calls | Sync runs server-side only; Glama/registry API keys (if required) stored in env vars, never exposed to client |

---

## 8. Future Epics

| Epic | Scope |
|---|---|
| EP-INT-002 | Credential management — per-integration API key and OAuth token storage, activation UI |
| EP-INT-003 | Archetype-driven onboarding recommendations — surface suggested integration stack at first-run setup based on selected archetype |
| EP-INT-004 | Integration health monitoring — status checks, last-used timestamps, alert on deprecated integrations in use |
