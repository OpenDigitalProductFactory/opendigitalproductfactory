---
status: draft
---

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

## BI-E725AA43 successor: bounded scheduled-task status

**Date:** 2026-10-21. **Workroom:** WC-B0D846E6. **Shape:** delivery-small@1.0.0; fix, low sensitivity. This section extends the existing posture reader and tool-pack design; the historical implementation steps above are retained as provenance, not new work for this repair.

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

### Problem and source evidence

The authorized live `get_ai_platform_posture` call at 2026-10-21T06:12:27Z produced 313,502 characters. The external MCP route replaced that data with a 2,000-character prefix, omitting scheduled-task errors. The separate owner-scoped schedule list also exceeds the transport budget and does not project `lastError`; it is not the authority or substrate for this repair. The existing monitor's visible error is incomplete, so its actual failure cause remains undiagnosed.

At source `ee1e80b0a46b893beea11b928cfe621849730ad4`, `loadAiPlatformPosture` reads all scheduled tasks in the same aggregation as providers, models, spend, routes, jobs and endpoint reachability. Its existing task projection is exactly `taskId`, `agentId`, `title`, `isActive`, `nextRunAt`, `lastStatus`, `lastError`. `apps/web/app/api/mcp/v1/route.ts` clamps serialized data using the 100,000-character `MCP_ROUTE_TOOL_RESULT_CHAR_CAP` from `apps/web/lib/tak/tool-result-budget.ts`. Raising that cap would preserve unnecessary reads and transfer; it is rejected.

`agent-task-scheduler.ts` persists an error message that can append the coworker's returned text. Consequently `lastError` is an existing authorized, untrusted free-form status field; it is neither sanitized nor proof of authoritative run settlement. This repair must not open a thread, TaskRun, prompt, task configuration or tool-result reader.

### Proportional design and contracts

Extend the same `get_ai_platform_posture` input schema with optional `scheduledTaskId`. Preserve `view_platform`, `agent_control_read`, immediate execution and read-only/idempotent annotations. The current tool already exposes all users' seven-field status projections under that platform-wide authority; adding an owner predicate or using a lower-grant list tool would change the established contract.

**CONTRACT-SELECTOR:** If the property is supplied, require a string of at most 200 UTF-16 code units whose trimmed value is nonempty. Reject null, non-string, blank and oversized inputs before any reader runs. Do not echo rejected input. Normalize surrounding whitespace, then perform one exact `ScheduledAgentTask.findUnique` lookup. Selector mode takes precedence over `windowHours` and `includeRetired`, which have no meaning for this single-row read. An invalid selector never falls back to the full report.

**CONTRACT-STATUS:** The selected reader uses only the existing seven-field allowlist, with no joins. Return an explicit `scope: "scheduled-task"`, `requestedTaskId`, `generatedAt`, `found`, `scheduledTask`, and per-field `truncation` flags. A missing ID returns `found: false` and `scheduledTask: null`; an existing task with null status is still found. Keep nullable fields null and serialize `nextRunAt` as ISO or null. No schedule, owner, prompt, taskConfig, thread ID, TaskRun ID or raw execution content is added.

**CONTRACT-BOUNDS:** Preserve the lookup identity and cap projected `agentId` at 200, `title` at 300, `lastStatus` at 100, and `lastError` at 4,000 UTF-16 code units. Report a separate boolean for each capped field, including false when null or uncut. This guarantees a selected data payload below 32,000 serialized JSON characters, including worst-case control-character escaping and bounded metadata, and therefore below the external MCP cap. It does not guarantee preservation under every smaller native/adaptive tool-result budget. A cut error must not be described as complete.

**CONTRACT-DEFAULT:** With no selector property, keep the existing full loader's options, return type, queries, response shape and summary unchanged. Implement the selected reader in the existing aggregation module and branch in the existing handler before full aggregation; do not add a tool, endpoint, table, grant, dependency or parallel status substrate. Database errors remain errors, not fabricated not-found results.

### Grounding, alternatives and impact

The original posture plan and `2026-06-25-platform-consolidation-spine-design.md` own tool-pack and shared read projection. This repair reuses that design rather than introducing another API. The deployment doctrine's Authority Core/API contract remains unchanged; only an explicit optional response mode is added. Canonical stored task identity supplies the lookup; no identity system changes.

Options rejected: broad result-cap increases; repeated full reads; altering the lower-authority owner list; thread/TaskRun joins; direct database diagnosis outside the tool. These either retain the truncation defect or expand authority and data scope. Exact selection adopts the existing Prisma unique-read pattern without a new parser, pagination framework or dependency.

Live overlap review found BI-6786CE44 concerns assignments-page UX budgets, completed BI-0073DE6A concerns knowledge draft approval, and retired BI-5FE164B4 concerns provider authentication retirement. None supplies this bounded status projection. The separate owner-scoped schedule list remains outside this repair; BI-0A82D3B4 remains owner of recurrence timing. Original unknown portal/native attempts are not settled by this repair.

The resolved Workroom impact contract names the two colocated test suites, Style Drift Guard, Design Grounding PR section, doc-index and capability-completeness freshness checks, preflight, exact-tree shared-runtime gate and PR health. `find_related_tests` returned each exact colocated suite with ready graph state and no warnings. Plans under `docs/superpowers` are unpublished in the doc resolver, so this extension requires no doc-index content edit. If a derived check actually requires a change, claim its path normally before writing; foreign scope conflicts do not authorize forced regeneration.

### Acceptance and traceability

The following six criteria preserve the live item's acceptance scope:

- **REQ-STATUS-1:** An exact scheduled-task request returns only the selected existing status projection below the MCP cap.
- **REQ-STATUS-2:** Unrelated provider/model/spend/route/task queries do not run for that selector.
- **REQ-STATUS-3:** Existing full posture callers keep their output contract.
- **REQ-STATUS-4:** Unknown IDs and oversized errors have explicit bounded results.
- **REQ-STATUS-5:** Source tests and affected typechecks pass.
- **REQ-STATUS-6:** After canonical deployment, the existing monitor error is readable through this same authorized tool, enabling actual failure diagnosis.

**FLOW-STATUS-READ:** Existing tool authorization → supplied-selector validation → one existing task lookup → bounded seven-field projection and truthful flags → existing MCP transport. Absent selector → unchanged full aggregation.

**VERIFY-STATUS-RED-GREEN:** Actual failing regression tests, then green affected suites, both web TypeScript programs and exact-tree gate. **VERIFY-STATUS-LIVE:** Parent-owned canonical preflight/upgrade followed by one exact tool read of the existing monitor. No task mutation or execution is part of acceptance.

### Ordered implementation

All phases are sequencing within one inseparable fix. A schema-only option, unbounded reader or test-only change cannot independently restore the diagnostic read, so no phase is independently shippable.

1. [ ] Publish this proportional successor design/plan under ordinary docs-only hooks; record and check current immutable live coverage for BI-E725AA43. Record author research on the named source reproduction and planned failing-to-passing proof using the supported small-fix lane. Transition the same room's intent only when readiness permits.
2. [ ] Provision the isolated worktree through `scripts/lib/bootstrap-worktree-deps.mjs` and verify managed compile readiness. Read the installed Next.js testing guide. Add regressions in the two existing test files before production edits: exact unique read/select, no broad readers including reachability, default preservation, invalid input with no reads, absent/null/proposed status distinctions, truncation at and beyond limits, escaped-control serialization bounds, and excluded extra fields. Execute RED through normal `host-resource-runner` admission; infrastructure refusal is unrun, never product RED.
3. [ ] Add the bounded selected-reader helper/type in `apps/web/lib/ai-platform-posture/get-ai-platform-posture.ts`; add schema and early branch in `apps/web/lib/mcp/packs/ai-platform-posture-pack.ts`. Keep their default paths intact. Make the failing tests green without changing grants or transport budgets.
4. [ ] Run both focused suites plus existing pack-registry and agent-grants suites through governed source-local admission. Run `web typecheck:all` (both source and test programs), doc-index/capability-completeness checks and Style Drift Guard. Run normal preflight and the passing exact-current-tree shared lease gate. Incorporate independent client review; native review is separately attributed and any uncertain attempt remains uncertain.
5. [ ] Publish a DCO-signed ready PR through ordinary guarded hooks, attach it, refresh current-head coverage where required, observe CI and protected merge/health. Record source delivery without claiming runtime acceptance. Parent owns canonical deployment and VERIFY-STATUS-LIVE; do not change or rerun the monitor here.

Focused command, from the worktree root after readiness:

```sh
node scripts/host-resource-runner.mjs --class vitest -- pnpm --filter web exec vitest run lib/ai-platform-posture/get-ai-platform-posture.test.ts lib/mcp/packs/ai-platform-posture-pack.test.ts lib/mcp/pack-registry.test.ts lib/tak/agent-grants.test.ts
node scripts/host-resource-runner.mjs --class typescript -- pnpm --filter web typecheck:all
```

### Backlog coverage

One atomic deliverable, `bounded-task-status`, maps to BI-E725AA43 with no dependencies. Its requirement references are REQ-STATUS-1 through REQ-STATUS-6; contract references are CONTRACT-SELECTOR, CONTRACT-STATUS, CONTRACT-BOUNDS and CONTRACT-DEFAULT; flow reference is FLOW-STATUS-READ; verification references are VERIFY-STATUS-RED-GREEN and VERIFY-STATUS-LIVE. The immutable provider commit/blob and server-selected coverage receipt are recorded in the live Workroom; no coverage is claimed before the writer and checker succeed. Do not change this document merely to insert its own newly minted receipt and invalidate its immutable identity.

### Risks and rollback

Invalid input must not trigger global reads. Narrow queries must not inherit hidden relations or extra fields. Free-form errors can contain sensitive-looking or misleading text; preserve existing authority, cap it and label truncation without treating it as an instruction or authoritative settlement. Native budgets can still shorten the response. Default callers must retain compatibility. Unit isolation, authority metadata assertions and bounded serialization tests mitigate these risks; live evidence remains a separate obligation. Roll back this optional mode through a protected source revert if needed; no data migration or runtime database correction is required.
