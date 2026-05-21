---
title: "AI Cost Governance"
area: ai-workforce
order: 4
lastUpdated: 2026-05-21
updatedBy: Claude (docs)
---

## What This Covers

AI cost governance is the layer that sits on top of model routing and turns AI spend into something you can see, attribute, and control. This page describes what an admin or operator actually sees in the platform today, the schema and telemetry behind those views, and what is still in progress.

Two adjacent pages are useful:

- [Model Routing & Lifecycle](model-routing-lifecycle.md) — how models reach the routing pool and how a single call is selected. Cost governance assumes routing is doing its job; this page is about everything that happens after a call is made.
- [Finance — AI Spend](../finance/ai-spend.md) — the supplier and contract view of the same provider activity, owned by Finance. The cost-governance page is the AI-workforce-side view; AI Spend is the AP-side view. They share the same underlying events.

The full design lives in the spec at `docs/superpowers/specs/2026-05-19-ai-cost-governance.md`. Tracking epic is **EP-COST-001**.

## The Three Cost Pools

The platform's AI spend lives in three distinct pools with different unit economics. Operating any one of them in isolation produces decisions that worsen another, so the governance surface treats them as one model with three meters:

| Pool | What it is | How it bills | Primary lever |
|------|-----------|--------------|---------------|
| **A — DPF internal API** | Every inference call made through `callProvider()` — coworker turns, Build Studio agents, background jobs. Uses provider API keys. | Per token at market rates (Anthropic, OpenAI, OpenRouter, others). | Prompt caching, model tier ladder, context compaction. |
| **B — Claude Code CLI** | Every Claude Code session — Build Studio autonomous runs, maintenance sessions, conversation with the user. Shares one bucket with claude.ai. | Message/usage rate limit on the Anthropic subscription. No per-token billing. | System-prompt size, MCP servers attached, extended-thinking discipline. |
| **C — Codex CLI** | Every Codex CLI invocation for Build Studio sandbox execution and code generation. | Message-based credit system on a 5-hour rolling window (Plus/Pro), or per-token on Business/Enterprise. | AGENTS.md depth, attached MCP servers, model selection (GPT-5.4 vs 5.5). |

Pool A is the only pool that produces real dollar amounts inside the platform. Pools B and C produce rate-limit events; the platform records those events so the operator can correlate "the build stalled" with "the CLI pool was throttled."

## What An Operator Sees Today

### Build Studio — per-phase cost breakdown

Every Build Studio run records cost on a per-phase basis. The **Cost & Tokens** card on the build detail view shows input tokens, output tokens, prompt-cache reads, and estimated USD for each of the five phases (Ideate, Plan, Build, Review, Ship). The same numbers are available via the MCP tool surface for external reporting.

The underlying schema:

| Table | Records |
|-------|---------|
| `BuildPhaseRun` | One row per phase per build. Fields: `phaseId`, `buildRunId`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `costUsd`, `agentIds`, `startedAt`, `finishedAt`. |
| `ToolExecution` | One row per tool call. Now includes `inputTokens`, `outputTokens`, `costUsd` for tools that internally call `callProvider()`. |
| `AdapterRunTelemetry` | One row per provider call. Includes `cacheCreationInputTokens` and `cachedInputTokens` (Anthropic prompt-cache extraction). |
| `AgentBudgetEvent` | One row per budget pressure event — soft alert, hard pre-dispatch block, or CLI-pool rate-limit hit. |

### Prompt-cache hit/miss telemetry

The platform extracts `cache_creation_input_tokens` and `cache_read_input_tokens` from every Anthropic API response and surfaces them on `AdapterRunTelemetry`. Two Prometheus counters expose the same data at `/api/metrics`:

- `dpf_ai_cache_read_tokens_total` — tokens served from cache at 10% of the normal rate
- `dpf_ai_cache_creation_tokens_total` — tokens written to cache at 1.25× the normal rate

If the read counter is non-zero for an Anthropic-backed agent, caching is working. If it stays at zero while the creation counter rises, the dynamic-context boundary is incorrectly placed and caching never hits — the operator's signal to investigate the prompt assembler.

### Finance AP rollup

When the runtime records provider usage, the same data also flows into Finance as actual AP spend. The supplier link, contract posture, monthly commitment, and any open work items raised by usage evaluation live at `/finance/spend/ai`. The numbers there should match the per-agent and per-phase totals in the AI Workforce views — they are the same events viewed from a different role.

### Operations Map — cost pressure overlays

The Operations Map at `/platform/ai/operations` overlays the three cost pools onto the route topology. A scheduled-window forecast shows when the CLI pool is expected to spike (from planned Build Studio runs); a quota-pressure indicator turns yellow when the bucket is depleting faster than the rolling window will refill it.

## How Token Consumption Is Kept Bounded

Two compaction mechanisms ship today; both run automatically and require no operator action under normal conditions.

### Phase-boundary summarization

Before a Build Studio specialist hands off to the next phase, the orchestrator runs `compactPhase(threadId, phaseId)`. The completed phase's messages are summarized to a 200–300 token block by a `routine`-tier model, and the working context for the next specialist starts from that summary rather than the full transcript. The full transcript is preserved in the database for audit; only the working context is compacted.

This caps a 4-phase build at roughly 1,200 tokens of prior-phase history regardless of how much conversation happened inside any one phase.

### Rolling coworker thread compaction

Coworker threads in the portal accumulate indefinitely without a cap. When the assembled message list exceeds 20 turns, the platform summarizes the oldest 10 into a single context-summary message using a `routine`-tier model. The trigger re-fires at turn 21, 31, 41, and so on, so the working context stays bounded for the rest of the thread.

The summary message is stored on the `Thread` as a special-typed message so it is visible to auditors and excluded from compaction itself.

### Tool result trimming

Many tool calls return large JSON payloads — backlog queries, wiki results, provider lists, code-graph results. A trimming utility caps tool results at 2,000 tokens by default, configurable per tool in the registry, and logs `trimmedTokens` to `ToolExecution` so the cost saved is visible.

## The Model Tier Ladder

The cost-tier vocabulary decouples agent definitions from specific model IDs. Each agent has a `costTier` in its registry profile; the routing layer resolves that tier to a concrete model through `ModelTierPolicy`.

| Tier | Anthropic | OpenAI | Use cases |
|------|-----------|--------|-----------|
| `critical` | claude-opus-4-6 | gpt-5.5 | Creative ideation, architecture decisions, final review, root-cause analysis requiring broad reasoning. |
| `standard` | claude-sonnet-4-6 | gpt-5.4 | Most Build Studio specialist work: implement, test, review. |
| `routine` | claude-haiku-4-5 | gpt-5.4-mini | Tool dispatch, format transforms, status checks, routing decisions, simple confirmations, structured extraction. |

When a new model in any tier ships, one row in `ModelTierPolicy` updates every agent on that tier — agent profiles do not need to be touched.

An agent can carry an optional `model_id_override` for tasks that genuinely require a pinned model (for example, an agent that uses extended thinking, which only runs on Sonnet+). The override is logged in `AdapterRunTelemetry.overrideReason` so drift is auditable.

## Budget Events and the CLI Pool Gate

The platform records two kinds of budget signals today:

- **Soft alerts.** A per-agent or per-build-phase soft threshold writes an `AgentBudgetEvent` with `severity: "warn"`. The build continues; the operator sees the event in the Build Studio history strip.
- **Pre-dispatch rate-limit checks.** Before dispatching work to the Claude Code CLI or Codex CLI pool, the orchestrator inspects the rolling-window state. If the pool is depleted past the configured cushion, the dispatch is deferred and an `AgentBudgetEvent` with `severity: "blocked"` is written. The Build Studio queue parks the work until the window refills.

This is the boundary between "what shipped" and "what's still in progress." Hard budget enforcement at `callProvider()` — where a per-agent or per-phase USD ceiling refuses to dispatch — is the closing piece. Until it lands, the soft-alert + pre-dispatch-check pair is the operator's visibility into budget pressure; the operator is still the enforcement point.

## What's In Progress

Tracked under EP-COST-001:

- **Hard budget enforcement at `callProvider()`** — refuse to dispatch when a per-agent or per-phase USD ceiling is exceeded, with operator override surfaces.
- **Profile-aware AGENTS.md subset for Codex sessions** — reduce CLI credit consumption by feeding Codex a context-appropriate slice rather than the full nested AGENTS.md tree.
- **CLI-pool scheduling** — schedule intensive autonomous runs into off-peak windows so they do not starve the operator's conversation budget.
- **Local-LLM grading** — let bundled local models grade local work to reduce dependence on cloud providers for evaluation traffic.

## Related Routes

- `/build/[id]` → **Cost & Tokens** tab — per-phase breakdown for a specific build
- `/platform/ai/operations` — Operations Map with cost-pool overlays
- `/platform/ai/authority` → **Tool Execution Log** — per-tool token + cost attribution
- `/finance/spend/ai` — Finance-owned supplier and contract view of the same activity
- `/api/metrics` — Prometheus scrape endpoint exposing the cost and cache counters

## Related Specs

- `docs/superpowers/specs/2026-05-19-ai-cost-governance.md` — the full EP-COST-001 design
- `docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md` — the routing foundation this layer sits on
- `docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md` — the governing principle
