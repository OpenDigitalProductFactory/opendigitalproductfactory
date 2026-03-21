# EP-INF-009b: Legacy Failover Retirement

**Date:** 2026-03-21
**Status:** Draft
**Epic:** EP-INF-009b
**Scope:** Replace all `callWithFailover` usage with the V2 routing pipeline, making contract-based routing + execution recipes the sole inference path
**Dependencies:** EP-INF-005a (RequestContract), EP-INF-005b (ExecutionRecipes), EP-INF-006 (Champion/Challenger), EP-INF-008a (Adapter Framework)

## Problem Statement

The platform has two parallel inference dispatch paths:

1. **V2 pipeline** (`routeEndpointV2` → `callWithFallbackChain`): Contract-based routing with capability filtering, cost-per-success ranking, execution recipes, champion/challenger exploration, rate tracking, and route outcome recording.

2. **Legacy** (`callWithFailover`): Priority-list ordering with basic sensitivity filtering and model requirements. No capability filtering, no recipes, no champion/challenger, no outcome telemetry.

The V2 pipeline was designed as the replacement, but the legacy path persists because:
- V2 is gated behind a feature flag (`USE_UNIFIED_COWORKER`) in agent-coworker
- V2 has a try/catch fallback to legacy `routeEndpoint` if it errors
- 6 other modules call `callWithFailover` directly, never touching V2

This means most inference calls bypass the routing intelligence built in EP-INF-001 through EP-INF-008. Champion/challenger can't learn, recipes aren't applied, and capability filtering doesn't protect against sending requests to models that can't handle them.

### Current Callers of `callWithFailover`

| Module | Usage Pattern | Notes |
|--------|--------------|-------|
| `agentic-loop.ts` | Fallback when no `routeDecision` | Only hit when feature flag off or V2 returns no endpoint |
| `coding-agent.ts` | One-shot code generation | Task: `code_generation` |
| `mcp-tools.ts` | Design/plan review tools | Task: `analysis` (implicit) |
| `orchestrator-evaluator.ts` | Quality evaluation calls | Uses `preferredProviderId` |
| `actions/build.ts` | Build discipline reviewers | Task: `analysis` |
| `endpoint-test-runner.ts` | Capability probes & scenarios | Uses `preferredProviderId`, checks for failover |
| `actions/regulatory-monitor.ts` | Compliance scans | Simple one-shot |

## Design

### Core Idea: `routeAndCall()` Convenience Function

Instead of modifying each caller to manually run contract inference → manifest loading → V2 routing → fallback chain dispatch, create a single function that encapsulates the full V2 pipeline behind an interface as simple as `callWithFailover`:

```typescript
export async function routeAndCall(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity,
  options?: {
    tools?: Array<Record<string, unknown>>;
    taskType?: string;
    preferredProviderId?: string;
    requiresTools?: boolean;
    requiresCodeExecution?: boolean;
    requiresWebSearch?: boolean;
    requiresComputerUse?: boolean;
  },
): Promise<RoutedInferenceResult>
```

Internally, `routeAndCall()`:
1. Infers a `RequestContract` from the task type and messages (via `inferContract`)
2. Applies any `options` overrides (preferred provider, capability requirements)
3. Loads endpoint manifests, policy rules, and overrides
4. Runs `routeEndpointV2` to select the best endpoint
5. Calls `callWithFallbackChain` with the resulting `RouteDecision`
6. Returns a unified result type compatible with both the agentic loop and one-shot callers

**The result type** (`RoutedInferenceResult`) is a superset of both `FailoverResult` and `FallbackResult`, unifying the two incompatible return shapes that currently force callers to handle both:

```typescript
export interface RoutedInferenceResult {
  providerId: string;
  modelId: string;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  inputTokens: number;
  outputTokens: number;
  downgraded: boolean;
  downgradeMessage: string | null;
  // V2 metadata (available for telemetry/debugging)
  routeDecision?: RouteDecision;
  recipeId?: string;
}
```

### Migration Plan

#### Phase 1: Build `routeAndCall()` (this spec)

Create `apps/web/lib/routed-inference.ts` with the convenience function. It wraps the full V2 pipeline. If V2 produces no eligible endpoints (e.g., no manifests loaded yet during initial setup), it throws `NoEligibleEndpointsError` rather than silently falling back to a different routing mechanism.

#### Phase 2: Migrate callers (this spec)

Replace each `callWithFailover` call site with `routeAndCall`. The migration is mechanical — the interfaces are nearly identical. Specific notes per caller:

| Caller | Migration Notes |
|--------|----------------|
| `agentic-loop.ts` | Remove the `if (routeDecision?.selectedEndpoint)` branch. The loop always calls `routeAndCall`. The `routeDecision` param becomes unnecessary — `routeAndCall` handles routing internally per iteration. |
| `coding-agent.ts` | Replace with `routeAndCall(messages, systemPrompt, "internal", { taskType: "code_generation" })` |
| `mcp-tools.ts` | Replace with `routeAndCall(messages, systemPrompt, "internal", { taskType: "analysis" })` |
| `orchestrator-evaluator.ts` | Replace with `routeAndCall(messages, systemPrompt, sensitivity, { preferredProviderId })` |
| `actions/build.ts` | Replace with `routeAndCall(messages, systemPrompt, "internal", { taskType: "analysis" })` |
| `endpoint-test-runner.ts` | **Special case.** Test probes target a specific provider+model and need to detect failover. `routeAndCall` supports `preferredProviderId` but can still fall back. The test runner's existing `result.downgraded` check handles this. |
| `actions/regulatory-monitor.ts` | Replace with `routeAndCall(messages, systemPrompt, "internal")` |

#### Phase 3: Remove feature flag gate (this spec)

In `agent-coworker.ts`, remove the `useUnified` check and the fallback to legacy `routeEndpoint`. V2 routing is always active. The `isUnifiedCoworkerEnabled` feature flag becomes unnecessary.

The `agent-coworker.ts` caller is special because it already runs V2 routing at the top level and passes `routeDecision` to the agentic loop. After migration, `agent-coworker.ts` no longer needs to do routing itself — the agentic loop calls `routeAndCall` per iteration. However, to preserve the routing trace in the conversation metadata (task type, routed endpoint ID), `routeAndCall` returns the `routeDecision` in its result.

#### Phase 4: Deprecate legacy (this spec)

- Mark `callWithFailover` as `@deprecated` with a JSDoc pointing to `routeAndCall`
- Remove its export from `ai-provider-priority.ts` in a follow-up once all tests are migrated
- The functions it depends on (`getProviderPriority`, `buildBootstrapPriority`, `filterByModelRequirements`, `autoDisableProvider`, `retireDeprecatedModel`) remain — some are used by other paths (e.g., the weekly optimizer)

### Error Handling

When `routeEndpointV2` finds no eligible endpoints:
- **During initial setup** (no providers configured): `NoEligibleEndpointsError` with a message guiding the admin to configure a provider
- **All providers rate-limited**: The error includes the earliest recovery time from the rate tracker
- **Capability mismatch**: The error lists which capabilities were required and which endpoints were excluded

This replaces the silent degradation in the legacy path (where `callWithFailover` would try increasingly inappropriate models). Explicit failures are better than wrong answers.

### Token Format Unification

Currently:
- `FailoverResult` has flat `inputTokens`/`outputTokens` fields
- `FallbackResult` has nested `tokenUsage.inputTokens`/`tokenUsage.outputTokens`

The agentic loop handles both with a messy conditional at line 205:
```typescript
const inputTok = "inputTokens" in result ? (result as FailoverResult).inputTokens : result.tokenUsage?.inputTokens;
```

`RoutedInferenceResult` normalizes to flat fields, eliminating this.

## Files to Create or Modify

### Create
- `apps/web/lib/routed-inference.ts` — `routeAndCall()` function and `RoutedInferenceResult` type
- `apps/web/lib/routed-inference.test.ts` — Unit tests for the new function

### Modify
- `apps/web/lib/agentic-loop.ts` — Remove dual-path dispatch, use `routeAndCall`
- `apps/web/lib/coding-agent.ts` — Replace `callWithFailover` → `routeAndCall`
- `apps/web/lib/mcp-tools.ts` — Replace `callWithFailover` → `routeAndCall`
- `apps/web/lib/orchestrator-evaluator.ts` — Replace `callWithFailover` → `routeAndCall`
- `apps/web/lib/actions/build.ts` — Replace `callWithFailover` → `routeAndCall`
- `apps/web/lib/endpoint-test-runner.ts` — Replace `callWithFailover` → `routeAndCall`
- `apps/web/lib/actions/regulatory-monitor.ts` — Replace `callWithFailover` → `routeAndCall`
- `apps/web/lib/actions/agent-coworker.ts` — Remove `useUnified` gate, simplify routing to metadata-only (task type, endpoint ID for conversation records)
- `apps/web/lib/ai-provider-priority.ts` — Add `@deprecated` to `callWithFailover`
- `apps/web/lib/agentic-loop.test.ts` — Update mocks from `callWithFailover` → `routeAndCall`
- `apps/web/lib/actions/agent-coworker-external.test.ts` — Update mocks

### Do NOT Modify
- `apps/web/lib/routing/pipeline-v2.ts` — The V2 pipeline is stable
- `apps/web/lib/routing/fallback.ts` — `callWithFallbackChain` is the dispatch layer, stays as-is
- `apps/web/lib/ai-provider-priority.test.ts` — Tests for legacy functions remain valid (they test the functions, not the integration)

## Test Plan

- `routeAndCall` unit tests: verify contract inference, manifest loading, V2 routing, and dispatch work end-to-end with mocked dependencies
- Verify `routeAndCall` returns `routeDecision` metadata for audit trail
- Verify `routeAndCall` throws `NoEligibleEndpointsError` (not silent degradation) when no endpoints match
- Verify `preferredProviderId` option biases routing without breaking fallback
- Verify token format is unified (flat fields, no nested `tokenUsage`)
- Existing test suites continue passing — `agentic-loop.test.ts` updated to mock `routeAndCall` instead of `callWithFailover`
- Manual: start platform without `USE_UNIFIED_COWORKER` flag, verify co-worker still routes correctly (V2 is now the default)

## What This Enables

| Before | After |
|--------|-------|
| 2 routing paths with different behaviors | 1 routing path for all inference |
| Only feature-flagged conversations use recipes | All inference uses recipes |
| Champion/challenger only sees unified-mode traffic | Champion/challenger sees all traffic |
| Rate tracking split between two systems | Unified rate tracking via `recordRequest` |
| No outcome telemetry for legacy calls | All calls recorded via `recordRouteOutcome` |
| Token format differs by path | Unified `RoutedInferenceResult` |
| Capability filtering only in V2 | All calls capability-filtered |
