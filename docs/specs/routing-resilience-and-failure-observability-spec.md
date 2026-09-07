# Routing Resilience and Failure Observability - Spec

**Status:** Draft, chief-architect revision
**Owner:** Platform / AI Routing
**Date:** 2026-06-02
**Surface:** `apps/web` routing layer, agentic loop, provider health UI, AI Operations Map
**Backlog posture:** no live `EP-ROUTE-RESILIENCE` epic exists as of the 2026-06-03 UTC MCP check. Treat the work items in this spec as proposed backlog, preferably under `EP-ROUTING-11` unless a later backlog overlap check justifies a new epic.

## 0. Architecture Review Summary

The incident diagnosis is sound, but the first draft blurred four things that must stay separate:

| Concern | Current substrate | Architect decision |
|---|---|---|
| Admin lifecycle | `ModelProvider.status`, `ModelProfile.modelStatus` | Keep these as lifecycle/profile states. Do not overload them with every hot-path retry failure. |
| Runtime circuit state | `rate-tracker.ts`, `fallback.ts`, `RouteOutcome`, `AdapterRunTelemetry` | Add turn-scoped and process-local cooldown state first. Persist only the telemetry needed for audit and UI. |
| Operator visibility | Provider pages, AI Operations Map, `RouteOutcome` projection | Surface live reachability and remediation as derived health, not as the static active flag. |
| Model fabrication guard | `agentic-loop.ts` and `RoutedInferenceResult` | Do not convert infrastructure failover into "the underlying work was not recorded" copy. |

Chief-architect corrections folded into this revision:

- The backlog section now reflects live MCP truth: `EP-ROUTE-RESILIENCE` is proposed, not current. Existing overlap is `EP-ROUTING-11`.
- The circuit breaker design no longer says "mark provider active/degraded" as the primary runtime gate. Runtime cooldown is a separate routing exclusion.
- The observability design composes existing `RouteOutcome`, `AdapterRunTelemetry`, and AI Operations Map projection before proposing any new table.
- The UI section requires the existing platform tokens/report-kit conventions for status, tables, KPIs, and export rather than hand-rolled badges or color maps.
- Implementation explicitly reserves refactoring effort: each code slice should spend about 20% of implementation effort simplifying the touched routing boundary before adding new behavior.

## 1. Problem

On June 2, 2026 local time, a coworker turn took about 60 seconds and then showed generic guardrail copy instead of useful failure guidance. The observed user-facing message was:

> I couldn't complete that - the underlying work wasn't recorded.

That message is not the model's answer. It is the agentic loop's fabrication guard substituting a build-oriented failure message after infrastructure failover and fallback-model behavior.

### 1.1 Canonical Runtime Evidence

Read-only verification against the canonical local runtime on 2026-06-03 UTC, corresponding to the late June 2 local incident window, showed:

- `docker ps` reported `dpf-portal-1` and `dpf-postgres-1` healthy.
- `ModelProvider` rows for `codex`, `chatgpt`, `anthropic-sub`, and `local` were all `status = active`.
- Recent `RouteOutcome` rows showed `codex/gpt-5.3-codex` failing with `latencyMs = 0` and `providerErrorCode in ('rate_limit', 'provider_error')`.
- The same window showed fallback `anthropic-sub/claude-opus-4-6` successes with `fallbackOccurred = true` and representative latencies of `25760`, `29973`, and `61602` ms.
- Portal logs contained repeated `Codex CLI rate limited` failures and repeated `Rate limited on pinned provider codex. Waiting 30s before retry...` lines.

This proves the user-visible delay is not a single slow model call. It is a chain of fast primary failures, explicit 30 second waits on the pinned provider, and slower fallback completions.

### 1.2 Current Repo Truth

The material repo anchors are:

- `apps/web/lib/routing/fallback.ts`
  - `markModelDegraded()` writes `ModelProfile.modelStatus = "degraded"`.
  - `rateLimitRetried`, `overloadRetried`, and `transientRetried` are scoped to one `callWithFallbackChain()` invocation.
  - The `rate_limit` branch waits up to 60 seconds for the selected endpoint before falling through.
  - Error outcomes are recorded as `RouteOutcome.latencyMs = 0`, so the route outcome row captures the failed attempt but not the wait that preceded the next attempt.
  - A typed local-CI capacity deferral skips a local endpoint without degrading it and preserves an eligible cloud fallback. The policy uses lease ownership; it does not infer RAM consumption from Docker's displayed model residency or conflate GPU VRAM, WSL/shared memory, and Windows physical-memory telemetry.
  - If a cloud call fails and a local fallback is capacity-deferred, the aggregate failure keeps the failed-attempt details and the typed local deferral as its `cause`. Local-only deferral remains a direct typed error. Semantic reviews rely on this provider boundary instead of vetoing eligible cloud routes before dispatch.
- `apps/web/lib/routing/pipeline-v2.ts`
  - `getExclusionReasonV2()` allows both `active` and `degraded` endpoints through the hard filter.
  - Cost-per-success ranking then applies the normal endpoint scoring path.
- `apps/web/lib/routing/rate-tracker.ts`
  - `ModelRateState` tracks request/token counters and parses retry headers.
  - It has no `unavailableUntil`, `degradedUntil`, or reason-scoped runtime cooldown.
- `apps/web/lib/tak/agentic-loop.ts`
  - `MAX_ITERATIONS = 200` is a safety ceiling, not a task-mode policy.
  - `detectFabrication()` runs without awareness that the turn may have degraded due to provider failure.
- `apps/web/lib/actions/coworker-tool-filter.ts`
  - Tool filtering is mode/build-phase aware.
  - It does not yet filter by route/screen/persona despite `ToolDefinition.screenSurface` existing in `apps/web/lib/mcp-tools.ts`.
- `packages/db/prisma/schema.prisma`
  - `RouteOutcome` has provider, model, task type, latency, fallback, and error code.
  - `AdapterRunTelemetry` already has adapter kind/version, provider/model, duration, status, HTTP status, error class, token fields, and tool-call validity fields.
  - No dedicated provider-runtime-health table exists.
- `apps/web/lib/ai-operations-map/project-routing-topology.ts`
  - The AI Operations Map already projects provider status markers and route outcome outage/fallback markers.

### 1.3 Failure Chain

1. A coworker is pinned to or selects `codex`.
2. `codex` fails immediately in the adapter path, typically as `rate_limit` or `provider_error`.
3. `fallback.ts` treats selected-endpoint rate limit as wait-and-retry, sleeps 30 seconds, and retries.
4. Because retry state is scoped to one fallback-chain call and the agentic loop can call the chain again on later iterations, the wait can recur across a single turn.
5. The route falls back to `anthropic-sub`, which completes but can take 25-62 seconds in the observed window.
6. The fallback reply can then trip `detectFabrication()`, producing user-facing copy that describes a supposed work-recording failure rather than a provider/routing failure.

## 2. Standards and DPF Contracts

This design follows these standards and project contracts:

- DPF `AGENTS.md`: architecture over shortcuts, single source of truth, live state over seed data, use standards, and theme-aware UI.
- Existing routing architecture docs:
  - `docs/superpowers/specs/2026-04-20-routing-architecture-current.md`
  - `docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md`
  - `docs/user-guide/ai-workforce/model-routing-lifecycle.md`
  - `docs/superpowers/plans/2026-05-13-ai-routing-topology-map.md`
- Microsoft Azure Architecture Center, [Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker): circuit breakers stop repeated calls to likely-failed dependencies, expose state changes, and combine with retries only when retry logic respects breaker state.
- AWS Builders Library, [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): retries amplify load when failures are caused by overload, so retry budgets and jitter/backoff must be explicit.
- OpenTelemetry, [GenAI spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) and [GenAI exceptions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-exceptions/): GenAI calls, tool calls, provider/model attribution, and provider exceptions should use consistent low-cardinality attributes/events.
- W3C [Trace Context](https://www.w3.org/TR/trace-context/): route attempts, adapter spans, and tool execution should preserve or create trace context so a coworker turn can be inspected end-to-end.

Adopted standard:

- Separate retry from circuit breaking.
- Record provider exceptions as first-class telemetry with provider/model/task/error classification.
- Surface circuit state and remediation to operators.
- Prefer existing telemetry/read-model substrate before adding a new table.

Rejected anti-patterns:

- Hiding provider failure behind generic model-fabrication copy.
- Retrying every loop layer independently.
- Writing every transient runtime failure into admin lifecycle fields.
- Showing provider `active` as if it means live reachability.

## 3. Goals and Non-goals

### Goals

- A provider that has just returned a hard failure does not consume repeated 30 second waits in the same coworker turn.
- Rate limits, auth failures, provider errors, fallbacks, and retry waits are visible as routing telemetry.
- The provider page and AI Operations Map show live reachability and remediation separate from static provider activation.
- User-facing copy names infrastructure degradation honestly without exposing internal provider/model details.
- Conversation-mode coworker turns carry a scoped tool catalog rather than the entire platform catalog.
- Fabrication detection remains strict for genuine false completion claims but does not fire on infrastructure failover.

### Non-goals

- Replacing the cost-per-success ranker.
- Rebuilding routing control/data plane in one PR.
- Adding a new provider-health table before exhausting `RouteOutcome`, `AdapterRunTelemetry`, and the AI Operations Map read model.
- Replacing Inngest recovery/probe infrastructure.
- Multi-tenant provider isolation. This install is currently single-organization.

## 4. Design

### 4.1 Runtime Circuit Breaker and Retry Budget

Add runtime circuit state to the routing path without treating it as a permanent provider lifecycle mutation.

Implementation shape:

1. Extend `ModelRateState` in `rate-tracker.ts` with:
   - `unavailableUntilMs?: number`
   - `unavailableReason?: "rate_limit" | "auth" | "billing" | "overloaded" | "transient" | "provider_error"`
   - `lastFailureMessageDigest?: string`
   - helpers: `markEndpointUnavailable()`, `clearEndpointUnavailable()`, `getEndpointRuntimeState()`
2. Add a turn-scoped retry ledger passed from `agentic-loop.ts` into `routeAndCall()` and `callWithFallbackChain()`.
   - Key: `${providerId}:${modelId}:${errorClass}`
   - Selected endpoint may wait at most once per turn per error class.
   - If a second matching failure happens in the same turn, skip to fallback immediately.
3. Feed runtime state into route selection.
   - Either annotate `EndpointManifest` with runtime state during manifest load, or pass a `RuntimeEndpointState` map into `routeEndpointV2()`.
   - `getExclusionReasonV2()` returns a clear reason such as `runtime_cooldown:rate_limit` when `unavailableUntilMs > now`.
4. Preserve lifecycle writes only for durable conditions:
   - Auth/billing failures may disable provider lifecycle state after explicit classification.
   - Rate limit and transient provider overload should open the runtime circuit, not permanently mutate `ModelProvider.status`.
   - Existing `ModelProfile.modelStatus = "degraded"` can remain for model quality/profile degradation, but it is not sufficient as the circuit gate because degraded endpoints are intentionally eligible today.
5. Recovery:
   - For rate limit/overload/transient: use retry headers where present; otherwise capped cooldown with jitter.
   - For auth/billing: open until manual remediation or a successful explicit provider test clears the condition.
   - Recovery probe clears runtime cooldown only after a successful provider/model call or provider-specific health check.

Acceptance:

- With `codex` returning rate-limit failures, the first selected-endpoint wait is bounded to one per turn.
- Subsequent agentic-loop iterations skip `codex` while cooldown is active.
- `pipeline-v2` candidate traces explain the runtime exclusion.
- No rate-limit-only path flips `ModelProvider.status` from `active` to `disabled`.

#### 4.1a Local pool refusal is not an upstream rate limit (implemented)

The wait-and-retry in step 2 is correct for an **upstream** 429: the provider was
asked, answered "later", and may answer on retry.

It is wrong for a **local** refusal. `ai-inference.ts` consults `getCliPoolStatus`
and throws `rate_limit` *before the call leaves the process* when a CLI pool is
known-saturated, expressly so the chain falls through — nothing was asked of the
provider, and the reset is wall-clock, so waiting cannot make it answer sooner.
Honouring the wait there defeats the pool check's whole purpose, and the two
mechanisms cancelled each other out.

Measured cost on a live install: every governed review ended
`missing-terminal-writer`. The reviewer read its artifact successfully with
`toolAccuracy=1.00`, then its next inference call spent the entire
`MAX_DURATION_REVIEW_MS` (300s) budget on repeated 30s sleeps against a saturated
`codex` pool — one turn ran 344s with `provider=unknown`, never binding a model —
while a healthy provider sat at index 1 of the chain.

Implemented shape:

- `InferenceError` carries `localPoolExhausted`, set **only** by the EP-COST pool
  check in `ai-inference.ts`.
- `callWithFallbackChain` skips its wait-and-retry for that case **and only when
  an untried entry remains in the chain**.

The second condition is load-bearing for installs other than the one this was
found on. Where the saturated pool is the *whole* chain — a single-provider
install — the wait is the only recovery there is, and skipping it would convert a
30 second delay into an immediate hard failure. The first draft of this change
skipped unconditionally and would have regressed exactly those installs; a
regression test now pins the single-provider case.

Residual case, deliberately not handled: if every remaining entry is itself a
saturated CLI pool, the chain now exhausts without the one extra post-wait
attempt it previously got. That is a narrow shape (two CLI adapters, both
saturated, no API adapter configured) and it fails fast rather than silently
consuming a turn budget, but it is a real behaviour change and belongs in the
next revision if it is observed.

Acceptance:

- A local pool refusal with an untried alternative advances immediately; the
  `Rate limited on pinned provider` log does not appear.
- A local pool refusal with no alternative still waits and retries.
- A genuine upstream 429 still waits and retries unchanged.

### 4.2 Error Classification and Remediation Propagation

The adapter and fallback layer must preserve the difference between auth failure, rate limit, overload, provider error, and request-too-large.

Implementation shape:

1. In CLI adapters, classify explicit re-authentication or login-required text as `InferenceError.code = "auth"` before generic rate-limit/provider-error matching.
2. Add structured remediation to fallback results:
   - `failureClass`
   - `failedProviderId`
   - `failedModelId`
   - `remediationKind?: "reauth" | "wait" | "provider_settings" | "choose_smaller_request"`
   - `adminActionHref?: string`
   - `safeUserMessage?: string`
3. Preserve the exact engineering error in telemetry/logs but expose plain-language copy in UI:
   - User: "The primary AI connection is temporarily unavailable, so I used a backup. I may need a narrower request."
   - Admin/provider page: "Codex is rate limited" or "Codex needs re-authentication" with the reconnect action.
4. For auth/billing failures, write provider lifecycle state only after the explicit class is established. Do not let a co-occurring rate-limit string mask auth.

Acceptance:

- An explicit re-auth signal appears as `providerErrorCode = "auth"` in route telemetry.
- The provider page shows the exact remediation action.
- User-facing coworker copy does not mention internal table names, model IDs, or tool schema.

### 4.3 Failure Observability

Compose existing telemetry first.

Existing write models:

- `RouteOutcome`: routing attempt outcome, selected/fallback provider, task type, latency, error code.
- `AdapterRunTelemetry`: adapter-level attempt status, duration, error class, HTTP status, tool-call validity, tokens.
- `ToolExecution`: tool audit rows, including route context and duration.
- AI Operations Map projection: existing read-model projection for provider markers and route outcome fallbacks.

Required extensions:

1. Add route-attempt correlation.
   - Carry `threadId`, `agentMessageId`, and a generated `routeAttemptId` through route decision, fallback, adapter telemetry, and route outcome.
   - Use W3C trace context where HTTP/OTel surfaces are available; store the trace id or route attempt id in local DB rows where full tracing is not yet wired.
2. Split latency.
   - Preserve `RouteOutcome.latencyMs` for adapter completion duration.
   - Add or derive `retryWaitMs` and `totalAttemptElapsedMs` so 30 second waits are visible.
   - If this requires a schema change, add nullable columns to `RouteOutcome`; do not create a new table for v1.
3. Add provider health projection.
   - Provider pages and AI Operations Map derive "live reachability" from recent route outcomes, adapter telemetry, credential state, and runtime cooldown.
   - Static `ModelProvider.status` remains "configured/active/disabled"; live health is displayed as "healthy", "cooling down", "needs re-auth", "rate limited", or "unknown".
4. Add low-cardinality classes.
   - Use stable values: `rate_limit`, `auth`, `billing`, `overloaded`, `transient`, `provider_error`, `request_too_large`, `tool_schema`, `timeout`.
   - Do not store raw provider error bodies as status labels.

UI requirements:

- Provider status and AI Operations reporting must use `apps/web/components/ui/report-kit/` for status badges, tables, KPI cards, filters, and export if those primitives cover the shape.
- Colors must resolve through DPF CSS variables and `statusColors`, not local raw hex or new per-page color maps.
- The first-viewport provider detail should make the action obvious: reconnect, wait for cooldown, test connection, or inspect recent failures.

Acceptance:

- A route attempt can be traced from coworker message to selected provider, failed primary, fallback provider, retry wait, final copy, and tool/fabrication guard outcome.
- The provider page no longer presents static `active` as equivalent to live reachability.
- AI Operations Map shows provider outage and fallback markers using recent route outcomes.

### 4.4 Tool Surface Scoping

The current coworker filter strips unsafe tools in advise mode and phase-filters Build Studio tools, but ordinary route/persona turns can still carry a large tool catalog.

Implementation shape:

1. Extend `filterToolsForCoworkerRuntime()` input with:
   - `routeContext`
   - `agentId`
   - `personaTags` or current agent grants
   - `coworkerIntent`
2. Apply `ToolDefinition.screenSurface`:
   - `undefined`: globally eligible
   - `"*"`: platform screen-control tool, eligible only when screen-control context is present
   - route-specific value: eligible only when matching the current route/surface
3. Keep grant enforcement as the authority gate. Tool scoping is a prompt/catalog reduction layer, not a permission bypass.
4. Log both counts:
   - `eligibleByGrant`
   - `eligibleForTurn`
5. Create tests that prove:
   - Build-phase tools still appear in active Build Studio phases.
   - Advice-only route explanations carry no mutation tools.
   - Route-specific tools are not offered on unrelated routes.
   - Screen-control tools appear only when page manifest context supports them.

Acceptance:

- The estate-posture conversational turn carries a scoped tool set, target under 25 tools unless the route has a specific reason to exceed it.
- The log line explains why the catalog changed.
- No coworker loses a tool required by its grants and current route.

### 4.5 Fabrication Guard Versus Infrastructure Failure

The fabrication guard should protect against false completion claims. It should not become the default copy for provider failover.

Implementation shape:

1. Extend `RoutedInferenceResult`/`AgenticResult` with failure context from fallback:
   - `downgraded`
   - `downgradeMessage`
   - `lastProviderErrorCode`
   - `runtimeFailureClass`
   - `remediationKind`
2. In `agentic-loop.ts`, when `result.downgraded` or `runtimeFailureClass` is present:
   - Skip `buildFabricationFailureMessage()` for fallback text-only answers.
   - If the response still looks like a false completion, use infra-aware copy rather than build-recording copy.
3. Keep fabrication detection active for healthy provider paths and genuine build/action claims without authoritative tools.
4. Add focused tests for:
   - healthy provider + false completion -> fabrication guard still fires.
   - downgraded provider + conversational answer -> answer is kept or infra copy is used.
   - max-iterations path with downgraded provider -> `buildMaxIterationsExhaustedMessage()` wins over fabrication copy unless a real tool hallucination is present.

Acceptance:

- Infra failover never produces "the underlying work was not recorded" unless the actual failure is an unrecorded work/action claim.
- Build Studio still blocks false "I shipped it" claims when no authoritative tool or evidence was produced.

## 5. Migration and Refactoring Inventory

### No new table in v1

Do not add a provider-health table in this slice. Existing telemetry can support the first provider-health projection.

### Possible nullable columns

If implementation cannot derive wait and total elapsed time from existing rows, add nullable columns to `RouteOutcome`:

- `routeAttemptId String?`
- `agentMessageId String?`
- `threadId String?`
- `retryWaitMs Int?`
- `totalAttemptElapsedMs Int?`
- `failureClass String?`

Any migration must include tests and a clean migration-apply verification against the canonical runtime or shared local-CI convergence sandbox.

### Refactoring reserve

Each implementation PR should reserve about 20% of effort for simplifying touched routing boundaries:

- Extract retry/cooldown helpers from `fallback.ts` into a focused routing-runtime module.
- Keep `detectFabrication()` pure; pass infra context at the call site rather than smuggling provider state into text parsing.
- Keep provider UI health derivation in a single loader/projection helper instead of duplicating status logic across provider list, detail page, and AI Operations Map.

## 6. Sequencing

1. **Slice A: classification + turn retry ledger**
   - Add tests around `callWithFallbackChain()` for repeated selected-endpoint rate-limit failures.
   - Classify explicit re-auth/login text before rate-limit/provider-error matching.
   - Thread a turn-scoped retry ledger through the agentic loop.

2. **Slice B: runtime cooldown exclusion**
   - Add runtime cooldown state to `rate-tracker.ts`.
   - Feed cooldown state into `pipeline-v2` hard-filter candidate traces.
   - Keep provider lifecycle state separate from runtime cooldown.

3. **Slice C: observability projection**
   - Add route-attempt correlation and retry wait visibility.
   - Update AI Operations Map/provider health projection from existing telemetry.
   - Use report-kit primitives for any tables/badges/KPIs/export controls.

4. **Slice D: fabrication guard infra awareness**
   - Add result context fields.
   - Update `agentic-loop.ts` and tests so infra failure copy is honest and fabrication checks remain strict.

5. **Slice E: route/persona tool scoping**
   - Extend `filterToolsForCoworkerRuntime()` with route/persona/screen inputs.
   - Apply `screenSurface` and log eligible catalog counts.
   - Verify high-tool-count turns shrink without losing route-required tools.

## 7. Backlog Plan

Live MCP check showed no `EP-ROUTE-RESILIENCE` epic. Existing related epic:

- `EP-ROUTING-11` - Routing substrate attempt #11 + CLI/execution adapters.

Open or in-progress overlaps to coordinate with:

- `BI-PIR-8e89c2b1` - System warmup check.
- `BI-PIR-d5b008ba` - Investigate intermittent failures in model warmup ping health check.
- `BI-A2CE8264` - Coworker execution adapter substrate.
- `BI-BEC399AD` - AI routing topology map.

Filed 2026-06-02 after a fresh MCP overlap check (no duplicates; adjacent items noted per row). Status: `triaging`, advisory `proposedOutcome=build`, linked to the parent epic shown. No new epic created.

| Filed BI | Proposed item | Work type | Size | Parent | Notes |
|---|---|---|---|---|---|
| `BI-609C7918` | Provider runtime circuit breaker + turn retry ledger | `bug` | large | `EP-ROUTING-11` | Slices A+B. Separates runtime cooldown from lifecycle state. Coordinate: `BI-PIR-8e89c2b1`, `BI-PIR-d5b008ba`, `BI-D89C1D01`. |
| `BI-2B7091EF` | Provider live health + remediation surfacing | `feature` | large | `EP-ROUTING-11` | Slice C. Coordinate with `BI-BEC399AD` / `EP-AI-OPSMAP` for fleet view. |
| `BI-EFFF19B4` | Infra-aware fabrication guard | `bug` | small | `EP-ROUTING-11` | Slice D. Lands alongside circuit breaker, own PR. |
| `BI-F970577F` | Route/persona tool-catalog scoping | `refactor` | medium | `EP-COWORKER-RT` | Slice E. Parented to coworker-runtime epic so it is not hidden inside the circuit-breaker PR. Coordinate: `BI-A2CE8264`, `BI-2685C1E5` (done, codex E2BIG). |

No new epic was created — items land under `EP-ROUTING-11` (and `EP-COWORKER-RT` for tool scoping) per Open Question 1. Re-parent only if the routing owner decides to separate this work later.

## 8. Verification Plan

Source-local gates in the worktree:

- `pnpm --filter web exec vitest run apps/web/lib/routing/fallback.test.ts`
- `pnpm --filter web exec vitest run apps/web/lib/routing/pipeline-v2.test.ts apps/web/lib/routing/pipeline-v2.capability.test.ts`
- `pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts`
- `pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker-tool-filter.test.ts`
- Provider UI/AI Ops projection tests for any changed components/loaders.

Canonical-runtime gates:

- Production build: `cd apps/web && pnpm exec next build` through the canonical local install or shared local-CI convergence sandbox, per `AGENTS.md`.
- UX verification:
  - Break or simulate a selected `codex` provider failure.
  - Ask a coworker a conversational estate/routing question.
  - Verify failover starts without repeated 30 second waits.
  - Verify provider page shows live reachability/remediation.
  - Verify AI Operations Map shows provider failure/fallback markers.
  - Verify user-facing copy is infrastructure-aware and not the fabrication failure text.
- Migration apply, if nullable `RouteOutcome` columns are added.

Runtime evidence to capture:

- Candidate trace showing `runtime_cooldown:<reason>` exclusion.
- RouteOutcome/AdapterRunTelemetry rows for failed primary and fallback.
- Logs with at most one selected-provider wait per turn.
- Screenshot or browser verification of provider health UI.

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Cooldown excludes a provider that would have recovered quickly. | Use reason-specific cooldowns, retry headers, jitter, and explicit recovery probes. |
| Auth and rate-limit text co-occur. | Prefer explicit re-auth/login patterns over generic rate-limit strings; add adapter tests for both. |
| Tool scoping removes a legitimate tool. | Use grant enforcement as authority, add route/persona tests, log before/after counts, and land separately from circuit breaker. |
| Provider UI duplicates status logic. | Centralize provider health projection and compose provider list/detail/AI Ops Map from it. |
| Observability columns become another partial truth. | Store correlation/elapsed fields only where existing telemetry cannot derive them; keep `AdapterRunTelemetry` as adapter attempt detail. |

## 10. Open Questions

1. Should the first implementation land under `EP-ROUTING-11`, or should platform leadership create a new focused epic after overlap review?
2. Should runtime cooldown survive portal restarts in v1? Recommendation: no for rate-limit/transient; yes only if auth/billing/manual remediation state must survive.
3. Should provider-health UI live first on provider detail pages, AI Operations Map, or both? Recommendation: provider detail for remediation, AI Operations Map for fleet awareness.
4. Should `RouteOutcome` gain nullable correlation/wait fields, or should the first slice derive from logs plus `AdapterRunTelemetry`? Recommendation: add correlation fields if needed for deterministic tests; avoid a new table.

## 11. Definition of Done

- `codex` rate-limit failure no longer causes repeated selected-provider 30 second waits in one coworker turn.
- Runtime cooldown is visible in candidate traces and does not rely on `ModelProvider.status` as the hot-path circuit gate.
- Provider health UI distinguishes static activation from live reachability and gives the admin a concrete next action.
- AI Operations Map can show the primary failure and fallback path from recent telemetry.
- Fabrication guard still catches false work claims but does not mask infrastructure failover.
- Tool catalog scoping reduces ordinary coworker turns without bypassing grants or breaking Build Studio phases.
- Verification results name the substrate where they ran.
