# AI Platform Posture Read Tool — Implementation Plan (BI-5903D447)

> **For agentic workers:** REQUIRED: Use the DPF-native delivery path (`dpf-tdd`, `dpf-local-merge-ci-before-push`, and `dpf-pr-with-dco`) to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the scheduled AI-platform-posture knowledge-article refresh (and any other AI ops caller) one authoritative, read-only MCP tool that returns real-time provider/model/spend/failover/assignment/scheduled-task state, instead of inferring it from `list_all_capability_needs` / `search_tool_marketplace`, which only expose partial, derived capability-needs feedback.

**Architecture:** Follow the existing `BI-ARCH-TOOLPACKS` pattern (`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`) — one new scoped `ToolPack` (`apps/web/lib/mcp/packs/ai-platform-posture-pack.ts`) registering a single read-only tool, `get_ai_platform_posture`, that lazy-delegates to a new aggregation module (`apps/web/lib/ai-platform-posture/get-ai-platform-posture.ts`). The aggregation module composes existing Prisma models with scoped `select`s (no secret fields) and reuses the existing `getTokenSpendByProvider` / `getTokenSpendByAgent` groupBy readers from `apps/web/lib/inference/ai-provider-data.ts` rather than re-deriving TokenUsage aggregation. Failover-chain integrity and agent-to-provider assignment have no existing single-purpose reader (confirmed by repo grep before writing this plan) — they are derived from `RouteDecisionLog`/`RouteOutcome` rows in a bounded lookback window, reusing the `providerFromEndpoint` helper already used by the AI Operations Map to recover a `providerId` from a `provider:model` `selectedEndpointId`.

**Tech Stack:** Prisma 7 (read-only queries against `ModelProvider`, `ModelProfile`, `TokenUsage`, `RouteDecisionLog`, `RouteOutcome`, `ScheduledAgentTask`, `ScheduledJob`), Next.js/TypeScript, Vitest, MCP tool packs.

---

### Task 1: Aggregation module

**Files:**
- Add: `apps/web/lib/ai-platform-posture/get-ai-platform-posture.ts`
- Add: `apps/web/lib/ai-platform-posture/get-ai-platform-posture.test.ts`

- [x] **Step 1: Write the aggregation function**

`loadAiPlatformPosture(options?: { windowHours?; includeRetired? })` returns `{ generatedAt, windowHours, providers, modelProfiles, tokenSpend, failoverChain, agentProviderAssignments, scheduledTasks }`. Providers/model profiles select only non-secret fields (no `authHeader`, `oauthClientId`, `tokenUrl`, credential rows). Token spend reuses the existing readers for the current calendar month. Failover-chain integrity aggregates `RouteDecisionLog.fallbackChain`/`fallbacksUsed` and `RouteOutcome.fallbackOccurred`/`providerErrorCode` over a bounded window (default 24h, capped at 168h). Agent-to-provider assignment groups recent `RouteDecisionLog` rows by `agentId`, picks the most-routed-to provider per agent. Scheduled-task status covers both `ScheduledAgentTask` (per-user recurring coworker tasks) and `ScheduledJob` (platform cron catalog) — `list_scheduled_agent_tasks` only covers the former, scoped to the calling user, so this is a genuinely new platform-wide read.

- [ ] **Step 2: Unit tests**

Mock `@dpf/db` and `ai-provider-data`; assert providers/model profiles are retired-filtered by default, token spend delegates to the existing readers, failover rate/assignment math is correct on fixture rows, and scheduled-task counts (`activeAgentTasks`, `failingAgentTasks`, `enabledJobs`, `failingJobs`) are right.

- [ ] **Step 3: Run tests green**

`pnpm --filter web exec vitest run apps/web/lib/ai-platform-posture/get-ai-platform-posture.test.ts`

### Task 2: MCP tool pack registration

**Files:**
- Add: `apps/web/lib/mcp/packs/ai-platform-posture-pack.ts`
- Add: `apps/web/lib/mcp/packs/ai-platform-posture-pack.test.ts`
- Modify: `apps/web/lib/mcp/pack-registry.ts` (one import line + one array entry)
- Modify: `apps/web/lib/tak/agent-grants.ts` (one `TOOL_TO_GRANTS` entry, mirroring the pack's `grants` map)

- [x] **Step 1: Define the tool**

`get_ai_platform_posture` — `requiredCapability: "view_platform"`, `sideEffect: false`, `annotations: { readOnlyHint: true, idempotentHint: true }`, optional `windowHours`/`includeRetired` input params, grant `["agent_control_read"]` (same tier as the sibling provider-management tools in `model-provider-pack.ts`).

- [ ] **Step 2: Registration + grant tests**

Mirror `model-provider-pack.test.ts`: exact tool-name list, provenance-free description, metadata preserved verbatim, grants match `isToolAllowedByGrants`.

- [ ] **Step 3: Wire into the registry**

Add the pack import/array entry to `pack-registry.ts` and the grant entry to `agent-grants.ts` under the "Provider management" section.

### Task 3: Verification

- [ ] Typecheck: `node node_modules/typescript/bin/tsc --noEmit -p apps/web` (or the project's configured typecheck script)
- [ ] Full pack + registry test sweep: `pnpm --filter web exec vitest run apps/web/lib/mcp/packs/ai-platform-posture-pack.test.ts apps/web/lib/ai-platform-posture/get-ai-platform-posture.test.ts apps/web/lib/mcp/pack-registry.test.ts apps/web/lib/tak/agent-grants.test.ts`
- [ ] `dpf-local-merge-ci-before-push` before opening the PR.
