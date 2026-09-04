---
status: active
---

BI-37719AAB's governed decision is owned by
[2026-09-01-codex-subscription-model-eligibility-design.md](./2026-09-01-codex-subscription-model-eligibility-design.md).
Section 13 below remains supporting routing detail, not a second approval
artifact.

# CLI Execution Adapter — Routing Design Spec

| Field | Value |
| --- | --- |
| **Epic** | Platform Infrastructure / Coworker Substrate |
| **Status** | Phase A implementation in progress (renamed + reconciled against `origin/main` on 2026-05-16; see [2026-05-16-substrate-spec-reconciliation.md](../audits/2026-05-16-substrate-spec-reconciliation.md)) |
| **Created** | 2026-04-29 |
| **Renamed** | 2026-05-16 — original filename `2026-04-29-coworker-execution-adapter-substrate-design.md` collided with a different-content in-process orchestration-primitives spec on main (PR #350). New name signals the routing-layer scope explicitly. |
| **Author** | Claude Opus 4.7 (1M ctx) for Mark Bodman |
| **Promotes** | [2026-04-29-cli-substrate-status-review.md](../audits/2026-04-29-cli-substrate-status-review.md) (audit) and its [Codex JSONL probe evidence](../audits/evidence/2026-04-29-codex-cli-jsonl-probe.md) |
| **Hard dependency** | [2026-04-27-artifact-provenance-receipts-design.md](./2026-04-27-artifact-provenance-receipts-design.md) — `ToolExecutionReceipt` table required before §7 (custody) can mint full receipts. Already shipped on main as of 2026-04-30 (commit landed migration `20260430023000_artifact_provenance_receipts_slice_1`). |
| **Related specs** | [2026-04-27-routing-control-data-plane-design.md](./2026-04-27-routing-control-data-plane-design.md) (extends the route plan), [2026-04-27-routing-substrate-attempt-history.md](./2026-04-27-routing-substrate-attempt-history.md) (attempt-history feeds outcome scoring), [2026-05-10-ai-coworker-visual-control-surface-design.md](./2026-05-10-ai-coworker-visual-control-surface-design.md) (Operations Map; consumes this spec's `NormalizedEvent` shape; Phase E cockpit complements it, does not replace it), [2026-05-11-autonomous-coworker-runtime-design.md](./2026-05-11-autonomous-coworker-runtime-design.md) (TaskRun substrate that consumes `AdapterRunTelemetry` as evidence), [2026-05-09-build-execution-provider-design.md](./2026-05-09-build-execution-provider-design.md) (Build Studio's `BuildExecutionProvider`/`BuildAgentRunner` — *parallel layer*, not the same axis; see §3 boundary statement). |
| **Scope** | `apps/web/lib/routing/*` (adapter registry, route plan, capability profile), `apps/web/lib/routing/cli-adapter.ts` (extended by PR #520 with `--mcp-config` mounting; A6 keeps that intact), new `apps/web/lib/routing/codex-cli-adapter.ts` (already present on main, 360 lines, no `--json` parsing yet), `apps/web/lib/inference/ai-inference.ts` (A6 replaces the `isCliAdapter` short-circuit; the older `apps/web/lib/ai-inference.ts` is a 2-line shim), `apps/web/lib/actions/agent-coworker.ts` (event normalization → panel), `packages/db/prisma/schema.prisma` (`AgentThread.cliSession*` columns, capability-profile cache, adapter telemetry), coworker panel UI components (cockpit shape). |
| **Distinct from** | The receipts spec — that addresses whether tool *outputs* can be trusted. This addresses *which substrate* runs the model and how its native events reach the panel honestly. Also distinct from `BuildExecutionProvider` / `BuildAgentRunner` (Build Studio's sandbox + agent dispatch layer): those describe *where Build Studio runs an agent*; this spec describes *which substrate the panel emits events through*. |
| **Primary Goal** | Make execution adapter (HTTP, Claude Code CLI, Codex CLI, Codex-as-MCP, local runtime) a first-class routing dimension with capability negotiation, so the coworker panel can use harness-native features (slash commands, MCP attach, hooks, subagents, plan/todo state, web access) through a governed substrate, with shadow/race modes for honest cross-adapter calibration and resilience to provider/license churn. |

---

## 1. Problem Statement

The AI Coworker panel today is HTTP-only. Every inference call flows `agent-coworker.ts → routed-inference.ts → pipeline-v2 → fallback.callWithFallbackChain → ai-inference.callProvider → execution-adapter-registry.getExecutionAdapter`. `chat-adapter.ts` handles HTTP fetch, `cli-adapter.ts` handles the Claude Code CLI subprocess, `codex-cli-adapter.ts` handles Codex. Build Studio dispatches Claude Code and Codex CLIs via separate subprocess paths (`claude-dispatch.ts`, `codex-dispatch.ts`) for code work, but those paths don't touch the panel. A partial CLI path exists for `providerId === "anthropic-sub"` ([ai-inference.ts:353](../../../apps/web/lib/inference/ai-inference.ts#L353) — the older `apps/web/lib/ai-inference.ts` is a 2-line re-export shim) but parses only `tool_use` events from the stream and discards everything else. [PR #520](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/520) (merged 2026-05-13) extended `cli-adapter.ts` with per-call MCP attach via `--mcp-config <path> --strict-mcp-config` when an `mcpSession` token is present — that work coexists with this spec and is preserved by Phase A6.

The consequence: panel users can't access any of the harness-native superpowers their CLI peers take for granted. Slash commands, MCP attachment, hooks, subagents, plan mode, todos, WebFetch, WebSearch, sandboxed bash, extended-thinking control — none of these reach the panel. Every time Anthropic or OpenAI ships a new harness feature, the gap widens.

A second, related problem: provider volatility is recurring infrastructure work. License changes, TOS shifts, model deprecations, rate-limit pool changes all force re-architecting of the inference path. Today there is no mechanism to **measure adapter performance in production** — the platform can't tell whether Claude Code CLI or Codex CLI or Anthropic HTTP is producing better outcomes for a given task class, so every substrate decision is made on intuition rather than data.

The audit at [2026-04-29-cli-substrate-status-review.md](../audits/2026-04-29-cli-substrate-status-review.md) frames the architectural direction. This spec defines the implementation contract.

## 2. Non-Goals

- **Replacing HTTP adapters wholesale.** Routing probes, eval, calibration, embeddings, classification, and any sub-second utility work stays HTTP. The 3–15 minute CLI timeout floor is unacceptable for those surfaces.
- **Implementing the receipt ledger.** That work belongs to the [receipts spec](./2026-04-27-artifact-provenance-receipts-design.md). This spec depends on `ToolExecutionReceipt` existing; if it lands first, §7 falls into place.
- **Cross-organization adapter portability.** Adapters bind to local sandbox containers, OAuth tokens, and the routing layer. Cross-install adapter sharing is out of scope.
- **Replacing Build Studio's CLI dispatch path.** [claude-dispatch.ts](../../../apps/web/lib/integrate/claude-dispatch.ts) and [codex-dispatch.ts](../../../apps/web/lib/integrate/codex-dispatch.ts) keep their existing contract. The substrate adapter system is parallel to them; over time we can converge, but the spec doesn't mandate it.
- **Building new MCP servers.** This spec governs *attach* behavior, not catalog growth.
- **Subagent orchestration semantics.** When Claude Code spawns a subagent via Task tool, the substrate normalizes the event into a panel-renderable shape. How DPF's own coworker registry interacts with CLI subagents is a follow-up spec.
- **Custom slash command authoring UI.** This spec defines how harness-emitted slash commands surface in the panel; user-authored slash commands are a separate feature.
- **Removing the agentic-loop platform tool registry.** The `PLATFORM_TOOLS` in [mcp-tools.ts](../../../apps/web/lib/tak/mcp-tools.ts) remain available regardless of adapter. CLI sessions get a *superset* (platform tools + harness tools), HTTP sessions get the existing set.

## 3. Architectural Model

Four orthogonal axes, each previously conflated, are decomposed:

```text
┌────────────┬──────────────┬─────────────────────┬──────────────────┐
│  Provider  │    Model     │ Execution adapter   │   Auth posture   │
├────────────┼──────────────┼─────────────────────┼──────────────────┤
│ anthropic  │ claude-opus  │ http                │ api-key          │
│ anthropic  │ claude-opus  │ claude-code-cli     │ oauth            │
│ anthropic  │ claude-sonnet│ http                │ api-key          │
│ openai     │ gpt-5        │ http                │ api-key          │
│ openai     │ gpt-5        │ codex-cli           │ oauth (chatgpt)  │
│ openai     │ gpt-5        │ codex-mcp-server    │ oauth (chatgpt)  │
│ openai     │ codex-models │ codex-cli           │ oauth            │
│ ollama     │ llama-…      │ local-runtime       │ local            │
└────────────┴──────────────┴─────────────────────┴──────────────────┘
```

A single coworker may keep its `GAID` identity stable while routing dynamically across these axes. The substrate spec is the routing-layer contract that makes this honest.

The system has six components:

```text
┌──────────────────────────────────────────────────────────────────────┐
│  ExecutionAdapter (interface)                                        │
│   - kind: http | claude-code-cli | codex-cli | codex-mcp | local     │
│   - execute(plan, prompt) → AsyncIterator<NormalizedEvent>           │
│   - probe() → AdapterCapabilityProfile  (cached per (adapter,ver))   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────────┐
│  AdapterRegistry      (extends apps/web/lib/routing/adapter-registry)│
│   - registers adapters by kind, not provider                          │
│   - capability-profile cache (DB-backed, TTL 24h)                     │
│   - version pinning                                                   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────────┐
│  RoutePlan extension                                                  │
│   - executionAdapter: ExecutionAdapterSelector                        │
│   - executionMode:    "single" | "shadow" | "race"                    │
│   - capabilityRequirements: AdapterCapabilityRequirement[]            │
│   - shadowAdapters?:  ExecutionAdapterSelector[]                      │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────────┐
│  CliSessionService    (new)                                          │
│   - thread → cliSessionId mapping (per-thread, sandbox-pinned)        │
│   - lifecycle: claim, lease, expire, sweep                            │
│   - resume via codex `exec resume` and Claude `--session-id`          │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────────┐
│  EventNormalizer      (per-adapter parser → DPF-native events)        │
│   - input: adapter-specific stream (stream-json, JSONL, SSE)          │
│   - output: NormalizedEvent — task / message / tool / artifact /      │
│     approval / plan / todo / subagent / hook / health                 │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────────┐
│  AdapterTelemetry     (feeds outcome scoring)                         │
│   - per-run: latency, tokens, cost, quota, accept, refuse, fail,      │
│     tool-call validity, capability-use, schema-drift detected         │
│   - shadow runs logged but not user-visible                           │
└──────────────────────────────────────────────────────────────────────┘
```

The execution-mode logic (single/shadow/race) sits between the route plan and the adapter dispatch — see §6.

## 4. Schema Changes

### 4.1 `AdapterCapabilityProfile` table (new)

Replaces hand-maintained capability tables with observed data.

```prisma
model AdapterCapabilityProfile {
  id                          String   @id @default(cuid())
  adapterKind                 String   // "http-anthropic" | "claude-code-cli" | "codex-cli" | "codex-mcp" | "local-ollama"
  adapterVersion              String   // e.g. "claude-code/1.2.3", "codex-cli/0.125.0", "anthropic-http/2024-06-01"
  probedAt                    DateTime
  probedBy                    String   // host/process identity, for cache invalidation across replicas

  // Observed capabilities — booleans, not aspirations
  supportsStreamingEvents     Boolean
  supportsMcpAttach           Boolean
  supportsMcpAttachPerInvoke  Boolean  // Claude Code: yes (--mcp-config); Codex: no (static config only)
  supportsSubagents           Boolean
  supportsHooks               Boolean
  supportsPlanState           Boolean
  supportsTodoState           Boolean
  supportsWebFetch            Boolean
  supportsWebSearch           Boolean
  supportsSessionResume       Boolean
  supportsExtendedThinking    Boolean
  supportsOutputSchema        Boolean

  // Operating envelope
  maxInteractiveLatencyMs     Int      // wall-clock budget for first event
  supportedAuthModes          String[] // "api-key" | "oauth" | "local"

  // Known landmines (Codex example: --json silently ignored when MCP active)
  knownDegradations           Json?    // [{ trigger: string, behavior: string, source: string }]

  // Cache key — same kind+version reuses profile until TTL or version changes
  @@unique([adapterKind, adapterVersion])
  @@index([adapterKind, probedAt])
}
```

Capability is **observed**, not asserted. Each adapter ships a `probe()` method that runs at registration and on version change, populating this table. The route planner reads from this table; the audit's §3 capability table is replaced by the live row set.

### 4.2 `AgentThread` extension

```prisma
model AgentThread {
  // ... existing fields ...
  cliSessionId          String?      // adapter-issued session UUID (claude --session-id, codex thread_id)
  cliSessionAdapterKind String?      // which adapter owns this session
  cliSessionContainerId String?      // sandbox container slot pinned to this thread
  cliSessionLastUsedAt  DateTime?    // sweeper TTL anchor
  cliSessionWorkdir     String?      // /workspace/threads/<threadId> after isolation lands

  @@index([cliSessionLastUsedAt])
}
```

Sweeper job (cron, every 10 min): expire sessions whose `cliSessionLastUsedAt` is older than `CLI_SESSION_TTL_MIN` (default 60 min), free their sandbox slot, set the row to null. Idempotent — a thread may re-claim a session on next message.

### 4.3 `AdapterRunTelemetry` table (new)

One row per execution attempt. Feeds outcome scoring (§6.4) and shadow-run comparison.

```prisma
model AdapterRunTelemetry {
  id                  String   @id @default(cuid())
  threadId            String?  // null for non-coworker runs (probes, eval)
  agentMessageId      String?  // joins to AgentMessage when applicable
  buildId             String?  // for Build Studio dispatch via the substrate
  adapterKind         String
  adapterVersion      String
  providerId          String
  modelId             String

  executionMode       String   // "single" | "shadow-primary" | "shadow-alt" | "race-primary" | "race-loser"
  raceCohortId        String?  // groups concurrent race/shadow runs

  startedAt           DateTime
  finishedAt          DateTime?
  durationMs          Int?
  firstEventLatencyMs Int?

  // Outcome dimensions (audit §5.4)
  status              String   // "success" | "refusal" | "error" | "timeout" | "cancelled" | "policy-block"
  refusalReason       String?
  errorClass          String?
  inputTokens         Int?
  cachedInputTokens   Int?
  outputTokens        Int?
  reasoningTokens     Int?
  estimatedCostUsd    Decimal? @db.Decimal(10, 6)
  quotaPoolConsumed   String?  // "anthropic-api" | "anthropic-oauth" | "openai-api" | "openai-chatgpt" | "local"

  toolCallsTotal      Int      @default(0)
  toolCallsInvalid    Int      @default(0)  // fabricated tool names, schema mismatches
  capabilitiesUsed    String[] // which §4.1 booleans were actually exercised this run
  schemaDriftDetected Boolean  @default(false)  // adapter emitted unexpected event shape

  userAccepted        Boolean? // null = not yet decided; true = message kept; false = retried/discarded
  acceptedAt          DateTime?

  rawEventDigest      String?  // sha256 of normalized event log, for cross-adapter equivalence checks

  @@index([adapterKind, startedAt])
  @@index([raceCohortId])
  @@index([threadId, startedAt])
}
```

`userAccepted` is set asynchronously when a downstream signal lands (user keeps the reply, retries, or escalates). Acceptance is the canonical "did this adapter win?" signal.

### 4.4 Hard-coded CLI special case removal

[`apps/web/lib/inference/ai-inference.ts:353`](../../../apps/web/lib/inference/ai-inference.ts#L353) on `origin/main` carries an `isCliAdapter` boolean short-circuit:

```ts
const isCliAdapter = effectivePlan.executionAdapter === "claude-cli"
  || effectivePlan.executionAdapter === "codex-cli";
const baseUrl = isCliAdapter ? "cli://local" : await resolveExecutionBaseUrl(...);
const headers = isCliAdapter ? {} : await buildAuthHeaders(...);
const adapter = getExecutionAdapter(effectivePlan.executionAdapter);
```

Phase A6 replaces this with a structured selector + capability-aware resolver:

```ts
const selector = parseExecutionAdapterSelector(effectivePlan.executionAdapter);
const isCliAdapter = selector?.kind === "claude-code-cli" || selector?.kind === "codex-cli";
const baseUrl = isCliAdapter ? "cli://local" : await resolveExecutionBaseUrl(...);
const headers = isCliAdapter ? {} : await buildAuthHeaders(...);
const adapter = selector !== null
  ? await resolveExecutionAdapter(selector, effectivePlan.capabilityRequirements)
  : getExecutionAdapter(executionAdapterRaw as string);  // legacy passthrough
```

The decision lives in the route plan, populated by §5. Backward compat: legacy string values for CLI/chat round-trip through `parseExecutionAdapterSelector`; legacy strings outside the structured taxonomy (`responses`, `embedding`, `image_gen`, `async`, `transcription`) fall through to the registry unchanged. **The Claude CLI `--mcp-config` mounting added by [PR #520](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/520) is preserved verbatim** — that path is gated by `mcpSession` token presence, which is orthogonal to the `executionAdapter` selector; both layers continue to compose.

## 5. Route Plan Extension

### 5.1 New `ExecutionAdapterSelector` field

```ts
type ExecutionAdapterKind =
  | "http-anthropic"
  | "http-openai"
  | "http-gemini"
  | "http-ollama"
  | "claude-code-cli"
  | "codex-cli"
  | "codex-mcp-server"
  | "local-runtime";

type ExecutionAdapterSelector = {
  kind: ExecutionAdapterKind;
  version?: string;          // pin specific adapter version; absent = latest probed
  authMode: "api-key" | "oauth" | "local";
  containerHint?: string;    // sandbox pool affinity for CLI adapters
};

type AdapterCapabilityRequirement = {
  capability: keyof AdapterCapabilityProfile;
  required: boolean;         // fail-route if missing
};
```

### 5.2 Capability negotiation at route-plan time

[recipe-loader.ts](../../../apps/web/lib/routing/recipe-loader.ts) extends to evaluate capability requirements:

1. Coworker's recipe declares capability needs (e.g. agent X needs `supportsSubagents=true` for plan-and-execute tasks).
2. Route planner queries `AdapterCapabilityProfile` for adapters that satisfy all `required: true` requirements.
3. Falls back to next-best adapter if first choice fails the requirement set.
4. Logs the requirement match in `AdapterRunTelemetry.capabilitiesUsed` so we can see which capabilities actually drive selection in production.

Capability requirements are *advisory* unless `required: true`. A request for `supportsTodoState` against an HTTP adapter that lacks it doesn't hard-fail — it logs and downgrades to text-only.

### 5.3 Concrete examples

```ts
// Coworker chat — default
{ executionAdapter: { kind: "http-anthropic", authMode: "api-key" }, executionMode: "single" }

// Coworker doing a complex multi-step task — wants harness features
{
  executionAdapter: { kind: "claude-code-cli", authMode: "oauth" },
  executionMode: "single",
  capabilityRequirements: [
    { capability: "supportsSubagents", required: true },
    { capability: "supportsTodoState", required: true },
    { capability: "supportsMcpAttachPerInvoke", required: true },
  ],
}

// Routing calibration — shadow Codex against Claude HTTP for outcome data
{
  executionAdapter: { kind: "http-anthropic", authMode: "api-key" },
  executionMode: "shadow",
  shadowAdapters: [{ kind: "codex-cli", authMode: "oauth" }],
}

// Latency-critical eval probe — race Anthropic + OpenAI HTTP, take first
{
  executionAdapter: { kind: "http-anthropic", authMode: "api-key" },
  executionMode: "race",
  shadowAdapters: [{ kind: "http-openai", authMode: "api-key" }],
}
```

### 5.4 Quota-pool spreading (audit Q4)

Per the [CLI vs API rate limits memory](../../../memory/project_cli_vs_api_rate_limits.md), `anthropic-api` and `anthropic-oauth` quota pools are independent. Per-provider-family quota model:

```ts
type ProviderFamilyQuotaState = {
  family: "anthropic" | "openai" | ...;
  pools: Array<{
    poolId: string;            // "anthropic-api" | "anthropic-oauth"
    saturation: number;        // 0..1, derived from recent 429 rate
    adaptersServed: ExecutionAdapterKind[];
  }>;
};
```

When two adapters serve the same model family and both pass capability requirements, the router prefers the less-saturated pool. This is intentional load-spreading for resilience, not just a fallback — and it's why the audit's §3 substrate-as-routing-dimension framing matters operationally, not just architecturally.

## 6. Execution Modes

### 6.1 `single` — production default

Pick best adapter per policy, run once, return result. Telemetry row written on completion. No additional cost vs today.

### 6.2 `shadow` — live + N alternatives, log only

Primary runs and is returned to the user. Shadow adapters run in background with the same prompt, results discarded after telemetry capture.

**Budget controls (audit Q5):**

```ts
shadow_eligible = (
  totalShadowSpendThisMonth < SHADOW_BUDGET_USD &&
  random() < SHADOW_SAMPLE_RATE &&
  !KILL_SWITCH_ENABLED
);

// SHADOW_SAMPLE_RATE default = 0.05 (5%)
// SHADOW_BUDGET_USD default = $100/month
// KILL_SWITCH_ENABLED env: SUBSTRATE_SHADOW_DISABLE=1
```

The formula is: `max_shadow_rate ≤ monthly_shadow_budget / (avg_run_cost × monthly_run_count)`. Ops sets the budget; the spec defines the formula and the kill switch.

Shadow runs are tagged `executionMode: "shadow-alt"` in telemetry and **must not** be visible in any user-facing surface. Operator dashboards only.

### 6.3 `race` — N adapters in parallel, first valid wins

All adapters in `[primary, ...shadowAdapters]` start concurrently. Acceptance criteria (audit Q6) — first result satisfying:

1. **Non-error.** `status === "success"`.
2. **Non-refusal.** No model refusal text patterns; no `policy-block` status.
3. **Tool-call valid.** Every emitted tool call resolves to a registered tool name with a schema-valid argument set; no fabricated tool names. (Cross-references the receipts spec — fabricated calls produce no receipts.)
4. **Within latency budget.** First event arrived under `maxInteractiveLatencyMs`.
5. **Policy pass.** Route-sensitivity floor satisfied (no MCP server in the response that the route plan didn't authorize).

Once one adapter wins, others are SIGTERM'd. All cohort members write telemetry rows with the same `raceCohortId` so we can analyze loser data later. Race mode requires explicit opt-in (`SUBSTRATE_RACE_ENABLE` env) — it doubles or triples spend and isn't a sensible default for chat.

### 6.4 Outcome scoring

Per the audit §5.4. The "winning adapter" for a (taskClass, providerFamily, capabilityRequirementSet) tuple is the one minimizing:

```
risk_adjusted_cost = (estimated_cost_usd × refusal_rate_factor × retry_rate_factor)
                   / (acceptance_rate × capability_use_rate)
```

`acceptance_rate` is computed from `userAccepted`. `refusal_rate_factor` and `retry_rate_factor` penalize unhelpful runs. `capability_use_rate` counts how often the adapter actually exercised a capability we required (selecting Claude Code CLI for subagents and getting back a single text reply means we paid for capability we didn't use).

Scoring runs as a nightly batch over `AdapterRunTelemetry`. Output feeds the route planner's adapter ranking the next day.

## 7. Custody — CLI ToolExecution Minting

**Receipts substrate already shipped.** The hard dependency from earlier drafts ([receipts spec](./2026-04-27-artifact-provenance-receipts-design.md), `ToolExecutionReceipt` table) **landed on main 2026-04-30** via migration `20260430023000_artifact_provenance_receipts_slice_1`. This section's CLI-specific clauses now apply on top of that substrate.

### 7.1 Today's gap (partial)

Phase A6 already closes one half of the gap via [PR #520](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/520): when the agentic loop populates `mcpSession`, Claude CLI mounts `mcp__dpf__*` platform tools via `--mcp-config`. The CLI's tool calls flow back through DPF's MCP server endpoint at `/api/mcp/v1`, hitting `governedExecuteTool` and minting `ToolExecution` rows tagged `source: "internal-mcp-session"`.

The remaining custody gap is:
1. **Claude CLI's native tools** (Bash, Read, Write, Task, etc.) executed inside the harness sandbox — these still don't reach `prisma.toolExecution`. [claude-dispatch.ts](../../../apps/web/lib/integrate/claude-dispatch.ts) returns `executedTools: []` hardcoded; the panel-driven cli-adapter has the same gap for non-`mcp__dpf__*` tool blocks.
2. **All Codex CLI tool calls** — [codex-cli-adapter.ts](../../../apps/web/lib/routing/codex-cli-adapter.ts) doesn't parse `--json` output yet.

Phase B6 closes both.

### 7.2 Required clause

Each CLI adapter's `EventNormalizer` (§8) must mint a `ToolExecution` row for every harness-emitted tool call:

| Adapter | Stream event(s) → ToolExecution |
| --- | --- |
| Claude Code CLI (native tools — Bash, Read, Write, Task, etc.) | `tool_use` blocks in stream-json (the `mcp__dpf__*` subset is already minted via the MCP-bridge path from PR #520; non-MCP blocks are the remaining target) |
| Codex CLI | `item.completed` where `item.type ∈ {command_execution, mcp_tool_call, file_change, web_search}` |
| Codex MCP server | tool call wire format from MCP protocol |
| HTTP adapters | already minted via `governedExecuteTool` at [`apps/web/lib/mcp-governed-execute.ts:206`](../../../apps/web/lib/mcp-governed-execute.ts#L206) — unchanged |

`ToolExecution.threadId` and `ToolExecution.cliSessionId` (extension) link the row back to the panel thread. The receipts substrate is already live on main, so the same normalizer can mint `ToolExecutionReceipt` rows immediately for any CLI tool call that consumed sandbox state.

### 7.3 Codex stream-MCP landmine

Codex CLI silently ignores `--json` when MCP servers are active (issue [openai/codex#15451](https://github.com/openai/codex/issues/15451)). The Codex adapter must:

1. At route-plan time: detect `(codex-cli + MCP active)` combination.
2. Refuse the run with a clear error rather than parse malformed output.
3. Log the refusal to `AdapterRunTelemetry` with `errorClass = "codex-mcp-json-degradation"` so the issue is operationally visible.
4. Prefer `codex-mcp-server` adapter kind for that route plan if MCP is required (Codex acts as MCP server itself, side-stepping the bug).

## 8. Event Normalization

Each adapter's stream is parsed into a single DPF-native event taxonomy. The panel renders these events; raw harness payloads are kept only in trace detail.

### 8.1 Normalized event types

```ts
type NormalizedEvent =
  | { kind: "task.started"; taskId: string; intent: string }
  | { kind: "message.delta"; text: string }
  | { kind: "thinking.delta"; text: string; effort?: "low" | "medium" | "high" }
  | { kind: "tool.invoked"; toolId: string; toolName: string; argsDigest: string }
  | { kind: "tool.completed"; toolId: string; status: "ok" | "error"; resultDigest: string }
  | { kind: "todo.updated"; todos: Array<{ id: string; text: string; status: "todo" | "doing" | "done" }> }
  | { kind: "plan.proposed"; steps: Array<{ id: string; text: string }> }
  | { kind: "subagent.started"; subagentId: string; intent: string }
  | { kind: "subagent.completed"; subagentId: string; status: "ok" | "error" }
  | { kind: "hook.fired"; hookName: string; phase: "pre" | "post"; result: "ok" | "blocked" }
  | { kind: "approval.required"; proposalId: string; scope: string; effect: string }
  | { kind: "artifact.produced"; artifactId: string; kind: "file" | "diff" | "doc"; uri: string }
  | { kind: "web.fetch"; url: string; status: number; contentDigest: string }
  | { kind: "web.search"; query: string; resultCount: number }
  | { kind: "adapter.degraded"; reason: string; impact: "soft" | "hard" }
  | { kind: "task.completed"; status: "success" | "error" | "cancelled"; usage: TokenUsage };
```

### 8.2 Per-adapter normalizer mapping

| Adapter event | → Normalized event |
| --- | --- |
| Claude Code `tool_use` | `tool.invoked` |
| Claude Code `tool_result` | `tool.completed` |
| Claude Code thinking block | `thinking.delta` |
| Claude Code TodoWrite tool | `todo.updated` |
| Claude Code Task tool spawn | `subagent.started` |
| Claude Code hook output | `hook.fired` |
| Codex `item.started type=command_execution` | `tool.invoked` |
| Codex `item.completed type=command_execution` | `tool.completed` |
| Codex `item.completed type=agent_message` | `message.delta` |
| Codex `item.completed type=reasoning` | `thinking.delta` |
| Codex `item.completed type=plan_update` | `plan.proposed` or `todo.updated` |
| Codex `item.completed type=file_change` | `artifact.produced` |
| Codex `item.completed type=mcp_tool_call` | `tool.invoked` + `tool.completed` |
| Codex `item.completed type=web_search` | `web.search` |
| Codex `turn.completed` | `task.completed` |
| HTTP SSE `content_block_delta` | `message.delta` |
| HTTP SSE `tool_use` block | `tool.invoked` |

### 8.3 Schema-drift detection

Each normalizer ships with a per-adapter-version schema fixture. On every run, observed event shapes are checksummed against the fixture. Drift sets `AdapterRunTelemetry.schemaDriftDetected = true` and emits a logged warning. Three consecutive drift detections trigger an automatic kill-switch on that adapter version (revert to previous probed version).

This is the operational guard against the Codex `item_type → type` rename pattern (issue [openai/codex#4776](https://github.com/openai/codex/issues/4776)) — we'll know the next time it happens, instead of getting silently malformed UI.

## 9. CLI Session Lifecycle

Per audit Q2 — current state is per-task ephemeral. Target is **per-thread sessions with per-task ephemeral fallback for parallel work**.

### 9.0 Boundary vs `WorkCapsule` (PR #602)

[PR #602](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/602) (merged 2026-05-14) introduced `WorkCapsule` + `WorkCapsuleActivity` for sandbox lease lifecycle: columns include `executorKind`, `executorRef`, `sandboxProviderId`, `sandboxId`, `worktreePath`, `leaseExpiresAt`, `leaseHolderPrincipalId` plus a sweeper. That is the **unit-of-work envelope** layer. `CliSessionService` (Phase C) is the **transport-level handle** to a running CLI subprocess inside a sandbox.

Boundary statement:

- `WorkCapsule` owns the sandbox lease (`sandboxId`, `worktreePath`, `leaseExpiresAt`, `leaseHolderPrincipalId`). It is grain = unit-of-work.
- `CliSessionService` owns the per-thread CLI session ID, the harness session state (Claude `--session-id`, Codex `thread_id`), and the `AgentThread.cliSession*` mapping. It is grain = panel thread.
- Phase C wires `CliSessionService.claim()` to consume an existing `WorkCapsule` lease where one applies, rather than allocating its own sandbox slot. `AgentThread.cliSessionContainerId` becomes a FK-by-convention pointer to `WorkCapsule.sandboxId` (or equivalent) so the sandbox pool isn't double-managed. The sweeper (§9.4) defers to the WorkCapsule sweeper for sandbox lifecycle and only nulls the `AgentThread.cliSession*` columns when the underlying lease expires.

This separation keeps the unit-of-work concept singular while letting the panel thread own its own per-message session identity.

### 9.1 Session claim

When a coworker message arrives on thread T using a CLI adapter:

1. `CliSessionService.claim(threadId, adapterKind)`.
2. If `AgentThread.cliSessionId` is set and `cliSessionLastUsedAt` is within TTL: reuse.
3. Else: allocate a sandbox container slot from the pool (audit confirms `DPF_SANDBOX_POOL_SIZE` default 3 already exists), bind to thread, generate session UUID, write to `AgentThread`.
4. Update `cliSessionLastUsedAt` on every claim.

### 9.2 Concurrency rule

Two messages on the same thread arriving concurrently:

- If both can serialize (chat-like, sequential): they queue on the thread's session.
- If one is a long-running task (Build Studio dispatch from within a coworker thread): it gets an **ephemeral fallback** — fresh `--session-id` (Claude) or `--ephemeral` (Codex), no thread session pin.

This matches the build-orchestrator's existing decision at [build-orchestrator.ts:906](../../../apps/web/lib/integrate/build-orchestrator.ts#L906) to deliberately omit `--session-id` for parallel work.

### 9.3 Workspace isolation

Today all CLI tasks share `/workspace` ([claude-dispatch.ts:178](../../../apps/web/lib/integrate/claude-dispatch.ts#L178)). For panel-driven CLI sessions, this is a correctness hazard.

Proposal — bound to per-thread sessions, not per-task:

- `cliSessionWorkdir = /workspace/threads/<threadId>` for the panel substrate.
- The CliSessionService creates the directory on first claim and a git worktree off `main`.
- Thread session lifecycle owns the worktree; sweeper teardown removes it.
- Build Studio dispatch keeps its existing `/workspace` path. Convergence (one-worktree-per-build) is a follow-up.

### 9.4 Session expiry sweeper

Cron job, every 10 min:

```ts
SELECT * FROM "AgentThread"
WHERE "cliSessionId" IS NOT NULL
  AND "cliSessionLastUsedAt" < NOW() - interval '60 minutes';

// for each: free sandbox slot, remove worktree, null out cliSession* columns
```

Idempotent. A thread re-claims a fresh session on next message.

### 9.5 Resume on restart

Both CLIs support session resume (Claude Code via `--session-id`; Codex via `codex exec resume <uuid>`). On portal restart the sweeper does *not* drop sessions whose TTL is unexpired — they survive across restarts and are re-attached on next thread message.

## 10. Panel UX — Cockpit Shape

Per audit §6.2. The panel evolves from a transcript drawer into a compact execution cockpit. Implementation is layered.

### 10.0 Composition with shipped surfaces (2026-05-16 reconciliation)

Phase E does not own all coworker UI surfaces — it composes with two **already-shipped** surfaces and one **complementary** future surface:

- **[PR #629](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/629) — `AgentSkillAttributionChip` + `/platform/ai/skills` Telemetry tab.** These render *per-skill* attribution and telemetry. The cockpit must compose with them, not duplicate them. Phase E header carries one chip group: **adapter-kind badge ⊕ skill-attribution chip ⊕ adapter health LED** — three signals in one row, not three competing components.
- **[PR #607](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/607) — routing-topology attribution.** `RouteDecisionLog.actorKind`/`actorId`/`agentId` + `RouteOutcome.agentId` are already populated. The cockpit's trace tab consumes those rows for the operator/admin view.
- **[2026-05-10-ai-coworker-visual-control-surface-design.md](./2026-05-10-ai-coworker-visual-control-surface-design.md) — Coworker Operations Map.** Many-coworker schematic, not a per-thread cockpit. Phase E ships the per-thread cockpit; the Operations Map projects across threads using the same `NormalizedEvent` taxonomy from §8. They are complementary surfaces.

### 10.1 New panel zones

- **Header**: coworker identity + adapter kind badge ("Claude Code CLI" / "Codex" / "HTTP") + adapter health LED + thread session age.
- **Status rail**: active task title, pending approvals (count + click-to-jump), adapter degradation banner, todos from `todo.updated` events.
- **Transcript**: messages + only the normalized events that aid understanding (`tool.invoked`/`tool.completed`, `subagent.*`, `approval.*`, `artifact.*`). `thinking.delta` collapsible, `web.fetch` collapsible.
- **Artifacts panel**: aggregates `artifact.produced` events across the thread; click-through to file or diff.
- **Approvals panel**: existing proposal cards driven by `approval.required` events.
- **Trace tab**: full normalized event log, raw adapter payload available behind one more click. Operator-grade detail.

### 10.2 Progressive disclosure (audit Q7)

| Role | Default panel surface |
| --- | --- |
| User | Header (coworker + health LED only, no adapter name), status rail, transcript, approvals. Adapter identity hidden. |
| Operator | + adapter kind badge, latency, cost in trace tab, shadow comparison link |
| Admin | + full route plan, capability profile, schema-drift warnings, kill-switch controls |

Role taken from existing portal RBAC. Three CSS class hooks plus a per-zone visibility predicate; no new auth model.

### 10.3 Theme-awareness (per project standard)

All panel zones use existing CSS variables (`--surface`, `--text`, `--accent`, etc). No hardcoded colors. Adapter-kind badges use the same variables already used for capability tier badges.

## 11. MCP Boundary (audit Q3)

### 11.1 Per-route MCP allowlist

Route plan extension:

```ts
mcpAttachPolicy?: {
  allowedServers: string[];                          // from registry
  tokenScope:     "thread" | "install" | "ephemeral"; // most restrictive default
  routeSensitivityFloor: "public" | "internal" | "sensitive";
};
```

The route planner cross-references the requested MCP servers against:

1. Coworker's grants (existing tool-grant audit / governance).
2. Route sensitivity floor (no `sensitive` MCP attachment on `public`-sensitivity routes).
3. Adapter capability — does the chosen adapter support `mcpAttachPerInvoke`?

### 11.2 Token scoping

Default: tokens scoped to the thread session. When the sweeper expires the session, MCP tokens are revoked. Install-scoped tokens require admin grant.

### 11.3 Codex static-attach rule

Because Codex requires `~/.codex/config.toml` mutation for MCP attach, the Codex adapter cannot honor per-invoke allowlists cleanly. Resolution:

1. **Static config baseline** — the Codex container ships with a known, audit-logged set of MCP servers.
2. **Per-invoke negotiation** is degraded to: route plan rejects (and selects an alternative adapter) if its MCP allowlist is not a subset of the Codex container's static set.
3. **Codex MCP server adapter** (`codex-mcp-server`) sidesteps this — Codex acts as a server that DPF connects to, with DPF controlling the surrounding MCP context.

## 12. Implementation Phases

### Phase A — Schema + capability profile (foundation) — **shipped 2026-05-16**

1. Add `AdapterCapabilityProfile`, `AdapterRunTelemetry` tables; extend `AgentThread` with `cliSession*` columns.
2. Implement `probe()` for current HTTP and Claude CLI adapters; populate profile rows.
3. Remove hard-coded check at [`ai-inference.ts:353`](../../../apps/web/lib/inference/ai-inference.ts#L353) — replace with `parseExecutionAdapterSelector` + `resolveExecutionAdapter`. PR #520's mcpSession mounting is preserved verbatim.
4. Tests: probe deterministic against fixture stream; resolver returns expected adapter for current single-mode behavior; no behavior change vs today.
5. Wire `AdapterRunTelemetry` write at end of every coworker run, fire-and-forget so a DB outage cannot break a turn.

**Acceptance:** every existing coworker run works identically, the route plan carries a structured `executionAdapter` selector (with legacy-string passthrough for non-CLI/chat adapter strings), and writes one telemetry row per call. See plan's "Phase A status" table for the per-task commit hashes.

### Phase B — Codex CLI adapter + event normalizer

1. New `codex-cli-adapter.ts` modeled on `cli-adapter.ts`.
2. Event normalizer covering observed event types from [evidence/2026-04-29-codex-cli-jsonl-probe.md](../audits/evidence/2026-04-29-codex-cli-jsonl-probe.md).
3. Schema-drift detector with version-pinned fixture (Codex 0.125.0 baseline).
4. MCP-active-with-`--json` refusal guard (issue #15451 mitigation).
5. ToolExecution minting from `command_execution`, `mcp_tool_call`, `file_change`, `web_search` events.
6. Tests: Codex container probe; replay sample JSONL through normalizer; assert ToolExecution rows minted with correct shape.

**Acceptance:** a coworker with `executionAdapter.kind = codex-cli` can run a `command_execution` and have a `ToolExecution` row appear in DB tied to the thread.

### Phase C — CliSessionService + per-thread continuity

1. New `apps/web/lib/coworker/cli-session-service.ts`.
2. Sandbox-pool affinity layer over existing pool.
3. Per-thread workdir + worktree creation.
4. Sweeper cron job.
5. Resume on portal restart.
6. Tests: claim/reuse/expire cycle; concurrent message serialization; ephemeral fallback.

**Acceptance:** sequential coworker messages on the same thread share the same CLI session and observable plan/todo state.

### Phase D — Event normalizer parity for Claude Code

1. Extend existing `cli-adapter.ts` to cover thinking blocks, todos (TodoWrite), Task subagents, hook output beyond the existing `tool_use` parsing.
2. Schema-drift fixture for Claude Code current version.
3. Backfill normalized events for in-flight threads.

**Acceptance:** Claude Code CLI runs surface plan, todo, subagent, and thinking events to the panel.

### Phase E — Panel cockpit UI

1. Header / status rail / artifacts / approvals zones.
2. Adapter health LED + degradation banner.
3. Trace tab.
4. Progressive disclosure by role.
5. Theme-aware styling audit.

**Acceptance:** users see one coherent panel surface for HTTP, Claude Code CLI, and Codex CLI runs without raw harness payloads leaking into the transcript.

### Phase F — Shadow mode

1. `executionMode: "shadow"` dispatch path.
2. Budget caps + sample rate + kill switch.
3. Operator dashboard surfacing shadow comparison data from `AdapterRunTelemetry`.
4. Nightly outcome-scoring batch.

**Acceptance:** ops can run a one-week shadow of Codex CLI against Claude HTTP for the chat workload and read a comparison report at end of week.

### Phase G — Race mode + quota-pool spreading

1. `executionMode: "race"` dispatch path with cohort tracking.
2. Quota-pool saturation tracking and adapter ranking integration.
3. Race acceptance criteria implementation (§6.3).
4. Race kill switch.

**Acceptance:** under controlled rate-limit pressure, the platform automatically shifts load between `anthropic-api` and `anthropic-oauth` quota pools without user-visible degradation.

### Phase H — Refactor allocation (audit §8 — 20% budget)

Reserved through every preceding phase. Specific deliverables:

1. Extract `ExecutionAdapter` interface from existing adapter implementations.
2. Move adapter-specific code out of `routed-inference.ts` into the registry.
3. Separate panel transcript state from task / artifact / approval / trace state in the React tree.
4. Unify CLI session ID generation across `claude-dispatch.ts`, `codex-dispatch.ts`, and the new substrate adapters.
5. Cost / quota / outcome ledger consolidation (`AdapterRunTelemetry` is canonical; `ToolExecution.duration_ms` etc. cross-reference it).

## 13. BI-37719AAB integrity patch — account-aware Codex model eligibility

The live Codex CLI rejected `gpt-5.3-codex` with HTTP 400 when the `codex`
provider used ChatGPT OAuth, while the same authenticated CLI accepted
`gpt-5.4`. The existing adapter then matched the word `rate` inside
`degrade performance` and recorded a false pool-wide rate limit. This combines
two distinct faults: selection admitted a model the connected account could not
run, and failure classification used an unbounded substring.

### Research and reproduction record

The defect is named against pre-fix ref
`e7f618eae0b7481f37101654826cc8aad2a4a2d2`:

- `apps/web/lib/routing/codex-cli-adapter.ts:355` used
  `stderr.includes("rate") || stderr.includes("429")`; the observed HTTP 400
  includes `degrade performance`, so the first expression is true without a
  capacity failure.
- `apps/web/lib/routing/loader.ts:166-193` admitted every active profile whose
  provider had a configured credential, and `profileToManifest` at lines
  208-233 had no account/model compatibility field.
- `apps/web/lib/routing/types.ts:75-82` consequently had no manifest carrier for
  an account-specific hard exclusion.

The live reproduction used one healthy ChatGPT-authenticated Codex credential:
`codex login status` reported logged in with ChatGPT,
`codex exec -m gpt-5.3-codex` returned HTTP 400 unsupported-account-model, and
the same prompt immediately returned `OK` with `codex exec -m gpt-5.4`.
`CliPoolStatus` then contained a false 60-second Codex rate-limit record.

The TDD red run added the exact stderr and eligibility contracts before
production code. The focused command over the four new/affected suites reported
10 failures and 88 passes: missing `looksLikeCliRateLimit`, missing eligibility
module, no manifest exclusion, and no V2 hard-filter exclusion. After the
production change, the focused five-suite run reported 127/127 passes. The
graph-expanded run reported 323/323, and the exact-tree merged gate at candidate
`4c5aa639d50bfd7e482bd9cef247a2c2246f65e0` reported 3,541 passing tests plus a
successful production build.

Candidate causes ruled out by execution:

- **Expired or invalid auth:** ruled out because login status was healthy and
  `gpt-5.4` succeeded with the same credential and prompt.
- **Real capacity exhaustion:** ruled out because the response was HTTP 400,
  not 429, and the supported sibling succeeded immediately.
- **Provider-wide outage or local-runtime failure:** ruled out because only the
  account/model pair changed between failure and success; no local provider was
  involved.
- **Catalog-wide model invalidity:** ruled out because official OpenAI API docs
  list `gpt-5.3-codex`; the incompatibility is specifically the ChatGPT-account
  Codex transport, so API-key eligibility must remain intact.

Official OpenAI documentation establishes that both
[`gpt-5.3-codex`](https://developers.openai.com/api/docs/models/gpt-5.3-codex)
and [`gpt-5.4`](https://developers.openai.com/api/docs/models/gpt-5.4) are API
models, but does not establish identical availability through a ChatGPT-account
Codex CLI session. Therefore the account-specific compatibility rule is grounded
in the live CLI response, while the API-key path remains governed by the API
catalog.

The fix uses the existing endpoint-manifest and exclusion-trace substrate:

1. The manifest loader computes a hard `eligibilityExclusionReason` for
   `(provider=codex, auth=oauth2_authorization_code, model=gpt-5.3-codex)`.
2. The routing hard filter preserves that endpoint as an excluded candidate,
   making the reason available to dry-run previews, route decisions, and Runtime
   Health instead of silently deleting it from the candidate set.
3. A supported sibling such as `gpt-5.4` remains eligible and can win before
   dispatch. Codex API-key connections remain eligible for `gpt-5.3-codex`.
4. The adapter classifies capacity only from explicit 429, Too Many Requests,
   rate-limit, quota-limit, weekly-limit, or usage-limit signatures. Ordinary
   prose containing `rate` is a provider error and never mutates pool capacity.
5. Runtime-health exclusion bucketing gives account/model incompatibility a
   distinct explanation and corrective action.

Acceptance is proven by unit tests for the exact observed stderr, genuine 429
and weekly-limit payloads, OAuth-versus-API-key model eligibility, hard-filter
trace preservation, and owner-facing exclusion attribution. No schema migration
or seed/catalog deletion is required.

### Acceptance mapping

| Backlog acceptance target | Design/implementation contract | Executable proof |
| --- | --- | --- |
| ChatGPT-authenticated Codex never selects `gpt-5.3-codex` when unsupported | OAuth account/model policy writes `eligibilityExclusionReason` into the manifest and V2 treats it as a hard exclusion | `codex-subscription-model-eligibility.test.ts`; `loader.test.ts`; `codex-subscription-model-routing.test.ts` |
| `degrade performance` cannot trip rate limiting | Only explicit HTTP throttle/quota/usage signatures classify capacity | Exact live stderr case in `codex-cli-adapter.test.ts` |
| Genuine 429 still records capacity | `looksLikeCliRateLimit` retains 429, Too Many Requests, weekly, usage, and quota signatures; the existing record path is unchanged | Genuine 429 and weekly-limit cases in `codex-cli-adapter.test.ts` |
| `gpt-5.4` wins without local detour | Unsupported sibling remains in the excluded trace; supported user-configured sibling remains rankable ahead of bundled endpoints | Three-candidate decision in `codex-subscription-model-routing.test.ts` |
| Runtime Health explains the rejected model and action | New `account-model-eligibility` bucket maps the router reason to model-assignment remediation | `routing-exclusion-buckets.test.ts` plus existing phase/runtime-health consumers |

## 14. Open Risks

1. **Codex schema instability.** The schema-drift detector + version pin is the mitigation. If drift is constant, Codex CLI is operationally untenable for the panel and we keep it Build-Studio-only.
2. **Sandbox pool exhaustion.** Per-thread sessions pin sandbox slots. With pool size 3 and TTL 60 min, ≥3 active threads block new claims. Mitigation: pool size scales with active-thread count; ephemeral fallback when pool saturated.
3. **CLI subprocess timeout floor.** 3 min for chat (current cli-adapter), 15 min for Build Studio. Long thinking turns may hit the chat ceiling. Mitigation: per-adapter-version timeout in `AdapterCapabilityProfile`, route planner respects it.
4. **OAuth token churn.** Both Claude Code and Codex use OAuth tokens that expire / rotate. Mitigation: existing token-refresh paths in `cli-adapter.ts` extend to Codex; failure → adapter health degrades, route planner fails over.
5. **Shadow run prompt leakage.** Running the same prompt against multiple providers may surface DPF prompts to providers we didn't intend. Mitigation: shadow eligibility check excludes prompts above a sensitivity floor; only `public` and `internal` route sensitivities are shadow-eligible by default.
6. **Race-mode cost amplification.** A race against three adapters costs ~3×. Mitigation: race requires explicit opt-in env flag and per-route-plan opt-in; never default.
7. **Acceptance signal lag.** `userAccepted` may take days for asynchronous threads. Outcome scoring runs over rolling 7-day windows to absorb this lag.

## 15. Telemetry & Observability

`AdapterRunTelemetry` is the canonical run ledger. Operator dashboards read from it:

- **Adapter mix:** stacked area chart of runs-per-day by adapter kind.
- **Acceptance rate by adapter:** bar chart filtered by task class and capability requirements.
- **Schema drift incidents:** count by adapter version, alarm threshold 3 consecutive runs.
- **Shadow comparison:** for any task class, the shadow-vs-primary acceptance and cost spread.
- **Quota-pool saturation:** time series of 429 rate per pool.
- **CLI session lifecycle:** active sessions, evictions, resume successes.

Health LED in the panel header is driven by:

```
adapter_health = healthy
  if (last 100 runs success rate ≥ 95%
      and median first_event_latency_ms within capability profile bound
      and no schema drift in last 24h)
  else degraded
```

`adapter.degraded` events surface in the panel as a banner; the route planner deprioritizes degraded adapters until 5 consecutive healthy runs clear the flag.

## 16. Migration & Backwards Compatibility

- Existing coworker threads have `cliSessionId = null`. They keep working through the HTTP adapter exactly as today.
- The hard-coded check at [ai-inference.ts:353](../../../apps/web/lib/ai-inference.ts#L353) is replaced by registry resolution that, in absence of an explicit `executionAdapter`, defaults to the prior provider-id-driven choice. No silent behavior change.
- `AdapterCapabilityProfile` is populated lazily — first probe at adapter registration, refresh on version change.
- Build Studio dispatch is unchanged. Convergence happens only when Phase H has run and only as an explicit follow-up.
- Receipts spec landing first lets §7 mint full provenance receipts. If receipts spec slips, §7 still mints `ToolExecution` rows and the receipt linkage is added in a follow-up patch.

## 17. References

- [Coworker Substrate Status Review](../audits/2026-04-29-cli-substrate-status-review.md) — the audit this spec promotes
- [Codex JSONL probe evidence](../audits/evidence/2026-04-29-codex-cli-jsonl-probe.md) — empirical event taxonomy
- [Artifact Provenance Receipts Design](./2026-04-27-artifact-provenance-receipts-design.md) — hard dependency for §7
- [Routing Control / Data-Plane Design](./2026-04-27-routing-control-data-plane-design.md) — route plan extension
- [Routing Substrate Attempt History](./2026-04-27-routing-substrate-attempt-history.md) — feeds outcome scoring
- [Claude Code: slash commands](https://code.claude.com/docs/en/slash-commands), [subagents](https://code.claude.com/docs/en/sub-agents), [hooks](https://code.claude.com/docs/en/hooks)
- [Codex CLI exec docs](https://github.com/openai/codex/blob/main/docs/exec.md), [config docs](https://github.com/openai/codex/blob/main/docs/config.md)
- Codex issues: [#15451](https://github.com/openai/codex/issues/15451) (`--json` + MCP), [#4776](https://github.com/openai/codex/issues/4776) (silent rename), [#17501](https://github.com/openai/codex/issues/17501) (MCP lifecycle events), [#4181](https://github.com/openai/codex/issues/4181) (`--output-schema` model gate)
- DPF memory: [CLI vs API rate limits](../../../memory/project_cli_vs_api_rate_limits.md), [Codex CLI integration](../../../memory/project_codex_cli_integration.md), [Mirror Claude Code patterns](../../../memory/feedback_claude_code_patterns.md), [Architecture over shortcuts](../../../memory/feedback_architecture_over_shortcuts.md), [Approach zero technical debt](../../../memory/feedback_zero_technical_debt.md)
