# AI Cost Governance — Observability, Model Tiering, Context Compaction, and Budget Enforcement

> **Status: DRAFT spec** — covers all four areas of the AI cost governance initiative.
> Feeds `writing-plans` for phased execution.
> Epic: Create **EP-COST-001** in the backlog before the plan is written. EP-GOVERN already exists
> (EP-GOVERN-002 is the Tool Evaluation Pipeline). AI cost governance is a distinct domain — a
> separate EP-COST epic keeps it from inflating EP-GOVERN scope. Planner: query the live backlog for
> the new epic ID before decomposing tasks.
>
> Related specs:
> - `2026-03-18-ai-routing-and-profiling-design.md` — routing foundation this spec extends
> - `2026-03-20-adaptive-model-routing-design.md` — contract-based selection EP-INF-005a
> - `2026-03-20-contract-based-selection-design.md` — cost-ranking already in routing layer
> - `docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md` — governing principle

---

## Why this exists

DPF is burning through provider tokens faster than the current plan tiers can absorb. Hits to Claude Code
and Codex rate limits are interrupting Build Studio runs. The root cause is not a single wasteful call —
it is a cluster of unconnected decisions (model selection, context management, prompt structure, CLI usage
patterns) that each look reasonable in isolation but compound into expensive behavior at the system level.

Making this harder: there are **three distinct cost pools** with different unit economics, rate-limit
windows, and optimization levers. Treating them as one problem produces solutions that optimize one pool
while worsening another.

This spec establishes the governance layer that connects the three pools under a single observable,
enforceable framework. It does not replace the routing architecture (EP-INF-005a) — it sits on top of it.

---

## Research & Benchmarking

### Anthropic prompt caching (primary lever, DPF internal API)

Anthropic's prompt caching charges **cache_creation_input_tokens** at 1.25× the normal input rate and
**cache_read_input_tokens** at 0.1× (10% of normal). For a 20KB system prompt sent on every coworker
turn:

- Without caching: every turn pays full input price for ~5,000 tokens
- With caching active and hitting: turns 2–N pay 10% of that — 90% reduction on the static prefix

The `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker is already architected in `prompt-assembler.ts`. The gap is
that `chat-adapter.ts` does not extract `cache_creation_input_tokens` / `cache_read_input_tokens` from
Anthropic API responses, so `cachedInputTokens` in `AdapterRunTelemetry` is always null. There is no
way to verify whether caching is actually working.

**References:**
- Anthropic docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- OpenRouter (used as fallback): passes-through Anthropic cache headers unchanged
- Industry pattern: static system prompt (identity, rules, mode) marked as cacheable; per-turn dynamic
  context (wiki, route data, skills list) placed after the boundary — exactly what DPF's assembler does.

### OpenAI/Codex token efficiency (Codex CLI pool)

Codex CLI uses a **message-based credit system on a 5-hour rolling window** for Plus/Pro plans.
Credits are consumed per message, not per token, but message cost is proportional to prompt length.
OpenAI's own optimization guidance calls out two DPF-specific items:

1. "Limit AGENTS.md nesting in larger projects" — DPF has a 192-line root AGENTS.md plus per-area
   extension files, all read into every Codex session context.
2. "Disable unused MCP servers" — each connected MCP server whose tool schemas are injected adds
   to the system prompt size the model must process.

At Business/Enterprise API pricing (pay-per-token), the levers shift to: prefer GPT-5.4 over GPT-5.5
for non-creative tasks (2× cheaper input, 2× cheaper output); use cached input at 10% of full price.

### Claude Code CLI (shared Anthropic subscription pool)

Claude Code CLI shares the same Anthropic usage limit as claude.ai. There is no separate rate-limit
pool. Intensive autonomous Build Studio sessions (which spawn Claude Code subagents in worktrees) drain
the budget Mark uses for conversation. The subscription article confirms all surfaces share one bucket;
it does not publish per-tier numerical limits.

The primary levers for CLI sessions:
- System prompt size (AGENTS.md + CLAUDE.md injected into every session)
- Number of active MCP servers (each adds tool schema tokens)
- Extended thinking (should be off for routine dispatch/routing decisions)
- Context window compaction (Claude Code has built-in summarization; Build Studio worktrees do not)

### Industry patterns

**LLM gateway / cost layer (Portkey, LiteLLM, Helicone):** Route by task complexity to the smallest
capable model; track cost per agent, per workflow phase, per user; enforce budget guardrails before the
call rather than logging after. DPF's existing routing layer (EP-INF-005a) handles selection; this spec
adds the cost-gate and phase-aggregation layers.

**Context window management:** Techniques used by production agentic systems — phase-boundary
summarization (summarize completed phase before handing off to next agent), message windowing (keep last
N turns in full fidelity, summarize earlier), tool-result compression (tool outputs often return large
JSON; trim to the fields the model actually needs).

**Model cascading:** Start with a fast/cheap model; escalate to a more capable model only on failure or
when a complexity signal is triggered. Used by Cursor (light model for completions, full model for
architect-level tasks). DPF's contract-based routing already scores capability — adding a cost-tier
preference layer is a small delta.

---

## Three Cost Pools

### Pool A — DPF internal API (callProvider path)

**What:** Every inference call made by a coworker, Build Studio agent, or background job through
`apps/web/lib/inference/ai-inference.ts`. Uses provider API keys; billed per token at market rates.

**Instrumentation status:** Good foundation. `TokenUsage`, `AdapterRunTelemetry`, `RouteOutcome`, and
Prometheus metrics are all wired. Critical gap: `cachedInputTokens` never populated (chat-adapter.ts
does not extract Anthropic cache response fields).

**Primary levers:**
1. Confirm and measure prompt caching hit rate (fills the cachedInputTokens gap)
2. Model tier ladder — route routine tasks to Haiku/mini instead of Sonnet/Opus
3. Context compaction at Build Studio phase boundaries
4. Budget enforcement via per-agent and per-build-phase limits

### Pool B — Claude Code CLI (Claude subscription)

**What:** Every Claude Code session — Build Studio autonomous runs, maintenance sessions, this
conversation. Shared with claude.ai. No per-token billing; a message/usage rate limit applies.

**Primary levers:**
1. Reduce AGENTS.md + CLAUDE.md total size sent per session
2. Disable MCP servers not needed for the current worktree's task
3. Avoid extended thinking for dispatch/routing decisions inside autonomous runs
4. Schedule intensive autonomous runs at off-peak times to avoid starving conversation budget

### Pool C — Codex CLI (OpenAI Codex subscription)

**What:** Every Codex CLI invocation for Build Studio sandbox execution, code generation, and
self-dev tasks. 5-hour rolling window; message-based credits on Plus/Pro.

**Primary levers:**
1. Trim AGENTS.md nesting depth visible to Codex (profile-aware subset, not full file)
2. Reduce MCP servers connected to Codex sessions
3. Prefer GPT-5.4 over GPT-5.5 for routine code tasks (2× lower cost, same quality for formatting,
   tests, and CRUD)
4. Consider upgrading to Business API billing when monthly volume justifies per-token pricing

---

## Current State Assessment

### What exists and works

| Component | File | Status |
|-----------|------|--------|
| Token usage logging | `lib/inference/ai-inference.ts:506` | Active — fires on every coworker turn |
| AdapterRunTelemetry write | `lib/routing/adapter-telemetry-writer.ts` | Active — success + error paths |
| RouteOutcome token fields | `schema.prisma:2191` | Active |
| Prometheus token + cost counters | `lib/operate/metrics.ts` | Active, scraped at `/api/metrics` |
| Cost-ranking in routing | `lib/routing/cost-ranking.ts` | Active for contract selection |
| Prompt cache boundary marker | `lib/tak/prompt-assembler.ts:80` | Defined, not yet wired end-to-end |
| Agent tier taxonomy | `packages/db/data/agent_registry.json` | `orchestrator` / `specialist` tiers exist |
| Token budget config | `agent_registry.json` (token_budget) | Defined; not enforced at runtime |

### Confirmed gaps

| Gap | Impact | Root cause |
|-----|--------|------------|
| `cachedInputTokens` always null | Cannot verify prompt caching ROI | `chat-adapter.ts` doesn't extract Anthropic cache fields from usage response |
| No per-build-phase cost rollup | Cannot see which BS phase burns most tokens | `build-orchestrator.ts` dispatches to callProvider but does not aggregate by phase |
| Token budgets not enforced | 500K daily / 50K per-task limits are aspirational only | No gate in `callProvider()` checks actuals against registry config |
| All orchestrators on claude-opus-4-6 | Routine routing decisions (formatting, status checks) pay Opus pricing | Registry has no tiering below orchestrator/specialist; no haiku-class tier |
| Context window not compacted at BS phase boundaries | By ship phase, context carries full conversation history | No summarization step between specialist handoffs |
| ToolExecution has no cost fields | Tool-level spend invisible | Schema gap — no migration yet |
| Codex sees full AGENTS.md nesting | CLI credit consumption elevated per session | No profile-aware AGENTS.md subset mechanism |

---

## Design

### Area 1 — Observability Closure

**Goal:** Every inference call, in every pool, produces a complete cost record including cache hits.
Dashboards and DB queries can answer: "what did Build Studio run X cost, by phase, by agent, by model?"

#### 1a. Prompt cache extraction (Pool A)

Extend `chat-adapter.ts` to read `usage.cache_creation_input_tokens` and
`usage.cache_read_input_tokens` from Anthropic API responses and surface them on `AdapterResult`:

```typescript
// AdapterResult (existing type) — add optional cache fields
cacheCreationTokens?: number;
cacheReadTokens?: number;
```

Pipe these through `callProvider()` into `writeAdapterTelemetry()` as `cachedInputTokens`
(mapped to `cache_read_input_tokens` — the field that represents cache savings).

Add a separate `cacheCreationInputTokens` column to `AdapterRunTelemetry` to preserve the write cost.
Migration: nullable Int column, no backfill needed.

**Success signal:** After this lands, `/api/metrics` exposes non-zero
`dpf_ai_cache_read_tokens_total` and `dpf_ai_cache_creation_tokens_total` counters for
Anthropic-backed agents.

#### 1b. Per-build-phase cost rollup

Introduce `BuildPhaseRun` — a new table; no existing build-phase or build-run table exists in
`schema.prisma`. The orchestrator stamps a `phaseId` on each `callProvider()` attribution, and a
post-phase hook queries `AdapterRunTelemetry WHERE threadId = ? AND phaseId = ?` to roll up totals.

Schema for `BuildPhaseRun` (new table):

```
phaseId          String
buildRunId       String   FK → BuildRun
inputTokens      Int      @default(0)
outputTokens     Int      @default(0)
cacheReadTokens  Int      @default(0)
costUsd          Float    @default(0)
agentIds         String[] -- which specialist agents ran in this phase
startedAt        DateTime
finishedAt       DateTime?
```

**Audit surface:** Expose phase cost breakdown in the Build Studio detail view
(`/build/[id]` → new "Cost & Tokens" tab).

#### 1c. ToolExecution cost attribution

Add `inputTokens Int?`, `outputTokens Int?`, `costUsd Float?` to `ToolExecution`. Populate from
the `InferenceResult` returned by any tool that internally calls `callProvider()`. Fire-and-forget
update after the tool returns, keyed on `ToolExecution.id`.

---

### Area 2 — Model Tier Ladder

**Goal:** Right-size every inference call to the smallest model capable of the task. Never pay Opus
rates for a task a Haiku-class model handles correctly.

#### 2a. Three-tier taxonomy

| Tier | Model (Anthropic) | Model (OpenAI) | Use cases |
|------|-------------------|----------------|-----------|
| `critical` | claude-opus-4-6 | gpt-5.5 | Creative ideation, architecture decisions, final review, root-cause analysis requiring broad reasoning |
| `standard` | claude-sonnet-4-6 | gpt-5.4 | Most Build Studio specialist work: implement, test, review |
| `routine` | claude-haiku-4-5-20251001 | gpt-5.4-mini | Tool dispatch, format transforms, status checks, routing decisions, simple confirmations, structured extraction |

**Note on `gpt-5.4-mini`:** "GPT-5.4-mini" is the Codex product name, not a verified API model ID.
Implementer must call `GET /v1/models` on the OpenAI provider before seeding `ModelTierPolicy` to
confirm the exact string. A wrong ID silently routes to a more expensive model.

The `routine` tier does not exist in the current registry — only `orchestrator` (→ Opus) and
`specialist` (→ Sonnet). Orchestrators that do routing and dispatch decisions should be `routine`,
not `critical`.

#### 2b. Registry update

Add `costTier: "critical" | "standard" | "routine"` to each agent's `config_profile`.
The routing layer resolves `costTier → modelId` from a new `ModelTierPolicy` table (seeded, admin-editable).
This decouples agent definitions from specific model IDs — when a new Haiku drops, one seed update
changes all `routine` agents.

```typescript
// New table: ModelTierPolicy
id          String  @id
tier        String  // "critical" | "standard" | "routine"
providerId  String
modelId     String  // e.g. "claude-haiku-4-5-20251001"
isDefault   Boolean // per provider, per tier
```

#### 2c. Override path

Agents retain an optional `model_id_override` that pins a specific model when a task genuinely
requires it (e.g., an agent that calls extended thinking, which only works on Sonnet+). The override
is logged in `AdapterRunTelemetry.overrideReason` so drift is auditable.

#### 2d. Expected impact

Back-of-envelope for a Build Studio run that makes 40 specialist calls:
- Current: 40 × Sonnet + 8 × Opus (orchestrator turns) ≈ $0.40–0.80 per run
- With tier ladder: 20 routine calls → Haiku (10× cheaper), 16 standard → Sonnet, 4 critical → Opus
  ≈ $0.08–0.16 per run — roughly 70–80% reduction per run, before caching

---

### Area 3 — Context Compaction Protocol

**Goal:** Prevent context window accumulation from multiplying token spend across Build Studio phases.

#### 3a. Phase-boundary summarization

Before a specialist agent hands off to the next phase, the orchestrator runs a compaction step:

1. Call a `routine`-tier model with: `[completed phase messages] → produce a 200–300 token summary`
2. Replace the full phase transcript with the summary in the thread before the next specialist sees it
3. The full transcript is preserved in the DB for audit; only the working context is compacted

This capping means a 4-phase build (Ideate → Design → Implement → Review) carries at most ~1,200
tokens of prior-phase history rather than accumulating the full conversation.

Implementation point: `build-orchestrator.ts` — add `compactPhase(threadId, phaseId)` before
dispatching each new specialist.

#### 3b. Tool result trimming

Many tool calls return large JSON payloads (backlog queries, wiki results, provider lists). Introduce
a `trimToolResult(result, maxTokens)` utility that:
- Truncates array results to the most relevant N items (using existing relevance scoring)
- Strips fields the model doesn't need (audit metadata, internal IDs not referenced in the prompt)
- Logs `trimmedTokens` count to `ToolExecution` for observability

Target: tool results capped at 2,000 tokens by default; configurable per tool in the tool registry.

#### 3c. Coworker thread compaction

Coworker threads in the portal accumulate indefinitely. Apply a **rolling** compaction trigger:
whenever the assembled message list exceeds 20 turns, summarize the oldest 10 into a single context
summary message, then re-check the count. This fires repeatedly — at turn 21, again at turn 31,
again at turn 41, and so on — so the working context stays bounded regardless of thread length.

The summary message uses the `routine` tier model and is stored in `Thread` as a special
`role: "summary"` message so it survives page reload.

Implementation: `apps/web/lib/actions/agent-coworker.ts` — apply the rolling compaction loop
before assembling messages for each turn.

---

### Area 4 — Budget Enforcement

**Goal:** Token budgets defined in `agent_registry.json` are enforced at runtime, not aspirational.
Rate-limit pressure produces visible warnings and graceful degradation, not silent failures.

#### 4a. Pre-call budget gate

In `callProvider()`, before dispatching to the adapter, query `TokenUsage` for:
- `agentId` daily spend (sum of `inputTokens + outputTokens` for today)
- `buildRunId` phase spend (if in a Build Studio context)

Compare against `token_budget.daily_limit` and `token_budget.per_task_limit` from the agent config.

**Gate behavior:**

| Condition | Action |
|-----------|--------|
| < 80% of limit | Proceed normally |
| 80–95% of limit | Proceed; emit a warning event to the `AgentBudgetEvent` table |
| > 95% of limit | Downgrade model to `routine` tier for this call; log downgrade |
| > 100% of limit | Reject call; throw `InferenceError` with code `"billing"`; surface in coworker UI |

The 80% and 95% thresholds are configurable via `StorefrontConfig` or a new `PlatformPolicy` key.

#### 4b. AgentBudgetEvent table

New table for tracking budget pressure signals:

```
id          String   @id
agentId     String
providerId  String
eventType   String   // "warning_80" | "warning_95" | "downgrade" | "rejected"
limitType   String   // "daily" | "per_task"
actualTokens Int
limitTokens  Int
buildRunId  String?  // present if inside a Build Studio run
createdAt   DateTime
```

Visible at `/platform/ai/authority` alongside existing ToolExecution rows.

#### 4c. Build Studio budget envelope

Introduce a per-`BuildRun` budget envelope: a total token ceiling for the entire run, not per-agent.
The orchestrator distributes the envelope across phases proportionally (Ideate: 15%, Design: 25%,
Implement: 40%, Review: 15%, Ship: 5%). If a phase exhausts its share, the orchestrator compacts
aggressively before continuing rather than aborting the run.

The envelope is configurable at build submission time, with a platform default seeded in
`StorefrontConfig`.

#### 4d. CLI pool management (Pool B and C)

The DPF platform cannot directly enforce CLI rate limits (they are enforced by Anthropic/OpenAI
infrastructure), but it can inform scheduling decisions:

- Add a `CliPoolStatus` table updated by the `cli-adapter.ts` and `codex-cli-adapter.ts` when they
  receive 429 responses, including the `Retry-After` or `X-RateLimit-Reset` header values.
- The Build Studio orchestrator consults `CliPoolStatus` before dispatching CLI-backed tasks. If a
  pool is exhausted, it either waits or routes to the API adapter for that call.
- Surface pool status in the Admin > AI Providers panel so the state is visible without needing to
  trigger a failing call first.

---

## Schema Changes Summary

| Table | Change | Migration |
|-------|--------|-----------|
| `AdapterRunTelemetry` | Add `cacheCreationInputTokens Int?` | Additive, nullable — safe |
| `BuildPhaseRun` | New table — phase-level token/cost rollup. Confirmed: no existing BuildPhase or BuildRun table in schema.prisma. | New table |
| `ToolExecution` | Add `inputTokens Int?`, `outputTokens Int?`, `costUsd Float?` | Additive, nullable |
| `ModelTierPolicy` | New table — maps tier → providerId + modelId | New table + seed |
| `AgentBudgetEvent` | New table — budget pressure event log | New table |
| `CliPoolStatus` | New table — last-known CLI pool window state per adapter | New table |

All migrations are additive. No existing columns altered; no backfills needed.

---

## Prometheus Metrics Extensions

Add the following counters to `lib/operate/metrics.ts`:

```typescript
dpf_ai_cache_creation_tokens_total   // counter, labels: provider, model, agent
dpf_ai_cache_read_tokens_total       // counter, labels: provider, model, agent
dpf_ai_budget_events_total           // counter, labels: agent, event_type, limit_type
dpf_ai_model_downgrade_total         // counter, labels: agent, from_model, to_model
dpf_build_phase_cost_usd_total       // counter, labels: phase, agent
```

---

## Implementation Phases

### Phase 1 — Observability (unblock measurement, ~1 week)

Priority: nothing else can be measured without this.

1. Extend `chat-adapter.ts` to extract Anthropic cache fields; populate `AdapterRunTelemetry.cachedInputTokens` + new `cacheCreationInputTokens`
2. Add Prometheus counters for cache metrics
3. Add `inputTokens`, `outputTokens`, `costUsd` to `ToolExecution`
4. Add `AgentBudgetEvent` table (ready for Phase 2 gate)

Deliverable: first non-null `cachedInputTokens` rows visible in DB; `/api/metrics` shows cache counters.

**Functional verification (mandatory before Phase 2):** Make a live Anthropic call through a
coworker turn, then query `AdapterRunTelemetry` and confirm at least one row has `cachedInputTokens`
non-null. A passing typecheck or schema migration alone does not satisfy this gate — a real DB row
with a non-null cache value is required.

### Phase 2 — Budget Gate + Model Tier Ladder (~1.5 weeks)

1. Add `ModelTierPolicy` table + seed with Anthropic and OpenAI tiers
2. Add `costTier` to agent `config_profile` — migrate all `orchestrator` dispatch/routing agents
   to `routine`, keep creative/review agents at `critical`
3. Implement pre-call budget gate in `callProvider()`
4. Add `AgentBudgetEvent` writes at 80%/95%/100% thresholds
5. Surface budget events in `/platform/ai/authority`

Deliverable: Build Studio runs automatically downgrade model tier when budget pressure detected;
budget warnings visible in the authority log.

### Phase 3 — Context Compaction (~1 week)

1. Add `compactPhase()` to `build-orchestrator.ts` — phase-boundary summarization
2. Add `trimToolResult()` utility; wire to tool execution paths with highest token output
3. Implement coworker thread compaction trigger at 20 turns
4. Add `BuildPhaseRun` table with cost rollup; expose in Build Studio detail view

Deliverable: Build Studio run cost measurably lower; phase cost breakdown visible in UI.

### Phase 4 — CLI Pool Visibility + Build Envelope (~1 week)

1. Add `CliPoolStatus` table; wire from `cli-adapter.ts` and `codex-cli-adapter.ts` 429 responses
2. Orchestrator consults `CliPoolStatus` before dispatching CLI-backed tasks
3. Implement per-`BuildRun` budget envelope with phase proportioning
4. Surface CLI pool status in Admin > AI Providers

Deliverable: Build Studio degrades gracefully on CLI rate-limit rather than silently failing;
per-build total cost visible.

---

## Success Metrics

| Metric | Baseline (before) | Target (after Phase 3) |
|--------|-------------------|------------------------|
| Cache hit rate on coworker system prompts | Unknown (0 in DB) | > 70% of turns on warm threads |
| Average cost per Build Studio run | Unknown (no phase rollup) | Measured + trending down |
| % of inference calls on `routine` tier | 0% | > 30% |
| Budget limit violations per week | Unknown | Tracked; < 5% of runs |
| CLI pool exhaustion events surfaced | 0 (silent 429s) | 100% surfaced in CliPoolStatus |
| TokenUsage rows with non-null cachedInputTokens | 0 | > 50% of Anthropic turns |

---

## Open Questions

1. **ModelTierPolicy admin UI**: **Decision: Phase 2 ships seed-only.** The seed is written to be
   admin-editable (the `ModelTierPolicy` table is exposed in Admin > AI Providers in a later release),
   but the edit UI is out of scope for this spec to avoid scope creep on a correctness-critical table.
   A follow-on spec covers the provider management UI surface. Planner: do not include a UI task for
   ModelTierPolicy in Phase 2.

2. **Phase proportion defaults**: The Implement:40% allocation is a guess. Real measurement after
   Phase 1 will reveal actual phase cost distribution and allow tuning.

3. **Codex AGENTS.md subsetting**: The cleanest solution is a `[codex]` front-matter tag in
   AGENTS.md sections to control which sections Codex sees. This requires a pre-processor in the
   Codex CLI dispatch path. Defer to Phase 5 unless rate-limit pressure is acute.

4. **Upgrade path for Codex plan**: The current Plus/Pro message-based plan may be less cost-
   efficient than Business API billing once run volume increases. This spec does not recommend a
   plan change — it recommends measuring first (Phase 1) before making that call.
