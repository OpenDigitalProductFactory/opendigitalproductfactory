# EP-INF-013: Adaptive Effort Parameter — Per-Request Thinking Control

**Date:** 2026-04-06
**Status:** Draft → Implementing
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic ID:** EP-INF-013
**IT4IT Alignment:** SS-2 Portfolio Management (resource governance), S2S Run IT (operational efficiency)

**Predecessor specs:**
- `2026-03-29-model-routing-simplification-design.md` — EP-INF-012 (tier system)
- Anthropic adaptive-model guidance (April 2026) — effort levels, thinking cap behaviour

---

## Problem Statement

The routing system now correctly gates which models are eligible (quality tier), but all calls to a given model use the same depth of reasoning. This produces two failure modes:

1. **Over-spend on simple tasks.** A COO status-check invokes Claude Sonnet with no thinking budget constraint, consuming the same resources as a complex reasoning task. For subscription providers this has no marginal cost, but it affects latency and token quota.

2. **Under-spend on complex tasks.** Build Studio's code-generation loop runs at the default inference depth. Extended thinking — which materially improves multi-step tool-calling accuracy — is never activated, even though the task warrants it.

Anthropic's adaptive-model guidance introduces the `effort` control (`low` / `medium` / `high` / `max`) that maps to how much the model reasons before responding. This spec integrates that control into the platform without requiring any database migration.

---

## Goals

1. Callers can pass `effort` on every `routeAndCall` invocation.
2. Agents declare a `defaultEffort` alongside their tier and budget class.
3. Anthropic providers translate `effort` → `thinking.budget_tokens`.
4. OpenAI o-series providers translate `effort` → `reasoning_effort`.
5. All other providers (Gemini, local, Responses API) degrade gracefully — they receive the `effort` hint and apply what they support, or ignore it.
6. Backward compatibility: callers that pass no `effort` get the current behaviour (no thinking, equivalent to `low`).

---

## Non-Goals

1. `AgentModelConfig.defaultEffort` DB field — deferred to EP-INF-013b. Admin UI override of effort is a next-sprint item.
2. Dynamic mid-conversation effort escalation (`EscalationPolicy`) — separate epic once production data shows where it's needed.
3. Automated benchmark comparison across effort levels — EP-INF-006.
4. Cache-affinity routing (stay on same endpoint+effort for a session) — future enhancement.

---

## Design

### Effort levels

| Level | Anthropic thinking tokens | Anthropic max_tokens floor | OpenAI reasoning_effort | Intended use |
|-------|--------------------------|---------------------------|------------------------|--------------|
| `low`  | none (thinking disabled) | plan default              | `"low"`                | Greetings, status queries, COO oversight |
| `medium` | 8 000                  | 10 048                    | `"medium"`             | Data extraction, moderate reasoning |
| `high`  | 32 000                  | 34 048                    | `"high"`               | Code generation, multi-step tool use |
| `max`   | 64 000                  | 66 048                    | `"high"` (capped)      | Build Studio deep reasoning, Opus-only |

**Anthropic constraints when thinking is enabled:**
- `max_tokens` must be ≥ `budget_tokens`. We set floor = budget + 2 048 for output headroom.
- `temperature` must not be set (Anthropic returns 422 if it is). We strip it.
- Supported on: Claude Sonnet 4, Haiku 4.5, Opus 4 (and all claude-3-7-sonnet+). Not on claude-3-haiku or claude-3-opus.

### Integration point

Effort flows through `providerSettings` on `RoutedExecutionPlan`, which already exists and is already read by both adapters. No new type fields on the plan are needed.

```
routeAndCall({ ..., effort: "high" })
  → inject into decision.executionPlan.providerSettings.effort
    → chat-adapter.ts (Anthropic branch):
         effort=high → thinking.budget_tokens=32000, max_tokens=max(plan,34048)
    → chat-adapter.ts (OpenAI branch):
         effort=high → reasoning_effort="high"
    → responses-adapter.ts:
         effort=high → reasoning.effort="high"
    → Gemini / local: providerSettings.effort ignored
```

### Agent defaults (code-level, no migration)

| Agent | defaultEffort | Rationale |
|-------|--------------|-----------|
| `build-specialist` | `high` | Multi-step tool loops, code generation — max reasoning quality |
| `coo` | `low` | Routine oversight, status summaries — fast and cheap |
| All others | _(none — inherits `low` default)_ | Moderate tasks that don't need extended thinking |

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/lib/tak/agent-coworker-types.ts` | Add `defaultEffort` to `AgentModelRequirements` |
| `apps/web/lib/tak/agent-routing.ts` | Set `defaultEffort` on `build-specialist` and `coo` |
| `apps/web/lib/tak/agentic-loop.ts` | Read `defaultEffort` from code/DB config, include in `routeOptions` as `effort` |
| `apps/web/lib/inference/routed-inference.ts` | Add `effort` to `RouteAndCallOptions`; inject into `executionPlan.providerSettings` |
| `apps/web/lib/routing/chat-adapter.ts` | Map `providerSettings.effort` → Anthropic `thinking` + `max_tokens` floor; OpenAI `reasoning_effort` |
| `apps/web/lib/routing/responses-adapter.ts` | Map `providerSettings.effort` → `reasoning.effort` (already handles `reasoning_effort` — add `effort` fallback) |

---

## What the subscription cost fix looks like

The existing `preferCheap` blend in `task-router.ts` already handles subscription providers correctly:
- Subscription endpoints report `costPerOutputMToken = 0`.
- `costFactor = 1 - 0 / maxCost = 1.0` → maximum cost efficiency score.
- When ALL endpoints are subscription (or free local), `maxCost = 0` and the blend is skipped entirely.

No code change required. The math is sound. A comment is added to document this behaviour.

---

## Backlog items created

| ID | Title | Priority |
|----|-------|----------|
| EP-INF-013-001 | Add effort param to RouteAndCallOptions + agentic-loop | 1 |
| EP-INF-013-002 | Map effort → Anthropic thinking in chat-adapter | 2 |
| EP-INF-013-003 | Map effort → reasoning_effort in OpenAI/Responses adapters | 3 |
| EP-INF-013b-001 | Add defaultEffort to AgentModelConfig schema + admin UI | Next sprint |
| EP-INF-013b-002 | Dynamic escalation policy on TaskRequirement | Deferred |
