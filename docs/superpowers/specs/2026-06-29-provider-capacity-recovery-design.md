---
title: Provider Capacity Recovery
date: 2026-06-29
status: Draft
owner: Platform AI
related:
  - docs/superpowers/specs/2026-05-19-ai-cost-governance.md
  - docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md
  - docs/superpowers/specs/2026-06-19-build-studio-reliability-analysis.md
  - docs/architecture/2026-06-09-long-running-agentic-process-architecture.md
---

# Provider Capacity Recovery

## 1. Problem

DPF already has partial recovery behavior when an AI provider hits a wall:

- API failover can pause a provider for a fixed one-hour quota window in `apps/web/lib/inference/ai-provider-priority.ts`.
- CLI pool status records `Retry-After` / `X-RateLimit-Reset` hints for CLI-backed pools in `apps/web/lib/routing/cli-pool-status.ts`.
- Provider health projects low-cardinality labels such as `rate_limited`, `billing`, and `needs_reauth` in `apps/web/lib/routing/provider-health.ts`.
- Route and adapter telemetry already record provider errors through `RouteOutcome` and `AdapterRunTelemetry`.

The missing piece is the normalizer between provider-specific error details and the platform behavior humans expect. A provider response like Z.ai `1113` does not mean "wait one hour"; it means "the account has no usable balance or coding resource package." A provider response that includes `next_flush_time` does mean "resume after that time." Those must not collapse into one generic `rate_limit` bucket.

For non-technical operators, the UX should answer one question: **is DPF waiting automatically, using another provider, or does a human need to fix the account?**

## 2. Research And Benchmarking

This design follows common resilient-client patterns used by API clients and job schedulers:

- **HTTP standard headers.** `Retry-After` and reset headers are the canonical source when a provider returns them. DPF already parses these for CLI pools; the parser should become shared capacity infrastructure.
- **Provider body codes.** Modern AI providers often put the real capacity reason in a JSON body rather than a standard header. Z.ai is the proving case: error code `1113` means insufficient balance or no resource package; timed quota codes may include `next_flush_time`.
- **Durable job schedulers.** Build Studio should park resumable work until `retryAt`, not spin, fail permanently, or ask a human to remember to retry.
- **Cloud console UX.** Commercial cloud providers distinguish transient throttles from billing/account action. DPF should mirror that distinction in plain language: wait, switch provider, reduce request, reconnect, or add credits/plan.

Patterns adopted:

- Provider-specific classifiers at the edge.
- One canonical capacity result inside DPF.
- Retry only when a deterministic or bounded wait exists.
- Human action only for billing, auth, unsupported plan, or repeated unknown exhaustion.

Patterns rejected:

- Fixed one-hour retries for all quota errors.
- Marking billing failures as `inactive` lifecycle state.
- Making each Build Studio engine implement its own throttling logic.
- Showing raw provider codes as the primary UX.

## 3. Goals

1. Classify provider-specific auth, quota, throttle, billing, and plan-limit errors into a canonical DPF capacity state.
2. Persist the current provider capacity state separately from provider lifecycle (`ModelProvider.status`).
3. Let Build Studio pause and resume automatically when capacity will return.
4. Give humans plain, action-oriented choices when provider action is required.
5. Make Z.ai the first provider-specific classifier, covering the GLM Coding Plan errors observed during setup.
6. Reuse this for API, OAuth subscription, and CLI-dispatch providers.

## 4. Non-Goals

- This does not redesign model routing quality scores.
- This does not create a new billing ledger.
- This does not bypass provider limits or retry aggressively against known exhausted pools.
- This does not expose raw API keys, raw response bodies, or detailed provider internals in user-facing UI.

## 5. Canonical Capacity States

Create a canonical classifier output:

```ts
type ProviderCapacityState =
  | "available"
  | "cooling_down"
  | "quota_resets_at"
  | "rate_limited"
  | "billing_action_required"
  | "reauth_required"
  | "unsupported_plan"
  | "request_too_large"
  | "provider_degraded"
  | "unknown";

type ProviderCapacityAction =
  | "retry_at"
  | "retry_with_backoff"
  | "switch_provider"
  | "reduce_request"
  | "reconnect"
  | "add_credits_or_plan"
  | "change_plan_or_model"
  | "contact_provider"
  | "none";
```

The classifier returns:

- `state`
- `action`
- `retryAt` when known
- `retryAfterSeconds` when known
- `providerCode` for audit only
- `safeSummary` for UX
- `rawSnippet` capped and sanitized for diagnostics
- `confidence`: `exact`, `header`, `heuristic`, or `unknown`
- `isHumanActionRequired`

This output is the only format consumed by Build Studio, provider health, and routing.

## 6. Provider-Specific Classifiers

Add `apps/web/lib/routing/provider-capacity-classifiers/` with:

- `types.ts`
- `headers.ts`
- `zai.ts`
- `openai-compatible.ts`
- `index.ts`

Classifier contract:

```ts
export type ProviderCapacityClassifierInput = {
  providerId: string;
  statusCode?: number;
  headers?: Headers | Record<string, string | string[] | undefined>;
  bodyText?: string;
  errorMessage?: string;
  now: Date;
};

export type ProviderCapacityClassification = {
  state: ProviderCapacityState;
  action: ProviderCapacityAction;
  retryAt?: Date;
  retryAfterSeconds?: number;
  providerCode?: string;
  safeSummary: string;
  confidence: "exact" | "header" | "heuristic" | "unknown";
  isHumanActionRequired: boolean;
};
```

Dispatch:

- `zai` and `zai-coding` use `classifyZaiCapacity`.
- OpenAI-compatible fallback parses standard headers and common JSON shapes.
- Unknown providers fall back to status/header heuristics.

### Z.ai Classifier

Known mappings:

| Z.ai signal | Canonical state | Action | Notes |
| --- | --- | --- | --- |
| `1113` insufficient balance or no resource package | `billing_action_required` | `add_credits_or_plan` | Human must add balance or coding package. Do not auto-retry forever. |
| subscription expired / unavailable package signals | `unsupported_plan` or `billing_action_required` | `change_plan_or_model` | Human action. |
| timed quota codes with `next_flush_time` | `quota_resets_at` | `retry_at` | Resume automatically at returned time. |
| HTTP `429` with `Retry-After` | `rate_limited` | `retry_at` | Shared header parser. |
| HTTP `429` with no reset | `rate_limited` | `retry_with_backoff` | Bounded backoff. |
| request/context too large | `request_too_large` | `reduce_request` | No provider account action. |

The exact Z.ai mapping file must be test-driven with recorded sanitized fixtures. The live smoke result from 2026-06-29 is a fixture:

```json
{
  "error": {
    "code": "1113",
    "message": "Insufficient balance or no resource package. Please recharge."
  }
}
```

Expected classification:

```json
{
  "state": "billing_action_required",
  "action": "add_credits_or_plan",
  "providerCode": "1113",
  "isHumanActionRequired": true
}
```

## 7. Persistence

Add a new table instead of overloading `ModelProvider.status` or `CliPoolStatus`:

```prisma
model ProviderCapacityStatus {
  id                    String   @id @default(cuid())
  providerId            String   @unique
  state                 String
  action                String
  retryAt               DateTime?
  retryAfterSeconds     Int?
  providerCode          String?
  safeSummary           String
  confidence            String
  isHumanActionRequired Boolean  @default(false)
  lastObservedAt        DateTime @default(now())
  lastSuccessAt         DateTime?
  source                String   // "api" | "cli" | "opencode" | "oauth" | "manual"
  rawSnippet            String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  provider ModelProvider @relation(fields: [providerId], references: [providerId], onDelete: Cascade)

  @@index([state, retryAt])
  @@index([isHumanActionRequired, updatedAt])
}
```

This table is the current live capacity view. Historical detail remains in `RouteOutcome`, `AdapterRunTelemetry`, `BuildDispatchAttempt`, and related evidence rows.

Clear or downgrade the status on success:

- successful provider call sets `state="available"`, `lastSuccessAt=now`, clears `retryAt`, clears human-action fields.
- manual provider test also updates this table.
- provider config changes clear stale capacity state for that provider.

## 8. Routing And Dispatch Integration

### API Inference

`classifyHttpError` in `apps/web/lib/inference/ai-inference.ts` should call the provider capacity classifier before reducing the error to `InferenceError.code`. `InferenceError` should carry the classification so downstream code does not re-parse raw strings.

The V2 routing fallback in `apps/web/lib/routing/fallback.ts` should use classification:

- `retry_at` / `retry_with_backoff`: mark runtime circuit until `retryAt` or bounded backoff.
- `add_credits_or_plan`, `change_plan_or_model`, `reconnect`: do not auto-clear; route around if possible and raise action.
- `reduce_request`: return actionable request-size error.

The deprecated `callWithFailover` one-hour auto-disable should be replaced or shimmed through the same classifier. It must not set `ModelProvider.status="inactive"` for a temporary quota event.

### CLI And OpenCode

`CliPoolStatus` should either be folded into `ProviderCapacityStatus` or mirrored into it. The CLI-specific table may remain as a low-level pool diagnostic, but Build Studio and provider health should read the canonical capacity table.

`apps/web/lib/integrate/opencode-dispatch.ts` should classify:

- OpenCode process stderr/stdout errors.
- Provider HTTP errors surfaced by OpenCode.
- direct preflight failures against `/models` and `/chat/completions`.

For `zai-coding`, classification uses the parent `zai` credential but stores capacity against `zai-coding` and optionally mirrors a summary to `zai` so the user sees one account-level problem.

## 9. Build Studio Behavior

When a Build Studio task hits a capacity classification:

| Classification | Build Studio behavior |
| --- | --- |
| `retry_at` | park the current task, show the resume time, and schedule resume. |
| `retry_with_backoff` | retry with bounded exponential backoff and jitter; then escalate if repeated. |
| `switch_provider` possible | route to the next eligible provider and record failover evidence. |
| `billing_action_required` | pause the build as `awaiting_external_capacity`; show the account action. |
| `reauth_required` | pause and deep-link to reconnect. |
| `unsupported_plan` | pause and offer alternate provider/model if available. |
| `request_too_large` | ask the platform to reduce/split the request; do not ask for billing. |

Add a Build Studio status reason such as `awaiting_external_capacity`. This is distinct from a build failure. The message should be:

- what is blocked
- whether DPF will resume automatically
- when it will retry, if known
- what action is needed, if not automatic
- a "Use another provider" option when routing has a viable candidate

Example plain copy:

> Z.ai can connect, but this account does not currently have GLM Coding credits. Add a coding plan or credits in Z.ai, then DPF will retry this build.

For a timed throttle:

> Z.ai is temporarily out of coding quota. DPF will retry this task at 3:20 PM. You can wait or switch this build to another coding provider.

## 10. UX Surfaces

### Provider Detail

Show a compact provider health card:

- Status: `Waiting for quota`, `Needs credits`, `Needs reconnect`, `Available`, `Recovering`
- Next automatic retry time when known.
- Primary action button: `Add credits`, `Reconnect`, `Change plan`, `Retry now`, or `Use another provider`.
- Secondary details collapsed: provider code, last observed time, sanitized snippet.

### Providers & Routing

Rows should use the same capacity state:

- `Rate-limited until 3:20 PM`
- `Needs Z.ai coding credits`
- `Needs reconnect`
- `Available`

Avoid making hidden execution providers like `zai-coding` into a second human-managed problem. The visible account provider should explain any inherited coding endpoint issue.

### AI Operations Map

Quota markers should distinguish:

- timed throttle
- account/billing
- unsupported plan/model
- request-size pressure

This makes capacity problems visible as operational signals rather than generic failures.

## 11. Scheduling And Resume

Use `ScheduledJob` for the first slice if that is the lowest-risk path, but name jobs by provider and classification:

- `provider-capacity-retry-zai-coding`
- `build-capacity-resume-FB-...`

When the platform has moved Build Studio orchestration onto the durable process substrate, capacity waits should become durable sleeps/steps rather than page-render side effects. Until then:

- provider page rendering must not be the only place that re-enables capacity.
- boot reconciliation should scan due `ProviderCapacityStatus.retryAt` rows and trigger queued resumes.
- Build Studio should schedule its own resume when a build is parked.

## 12. Tests

Unit tests:

- Z.ai `1113` maps to `billing_action_required` / `add_credits_or_plan`.
- Z.ai timed quota with `next_flush_time` maps to `quota_resets_at` / `retry_at`.
- `Retry-After: 120` maps to `rate_limited` / `retry_at`.
- epoch reset headers map to the correct retry time.
- unknown `429` maps to bounded `retry_with_backoff`.
- success clears capacity state.

Integration tests:

- `classifyHttpError` carries capacity classification into `InferenceError`.
- `fallback.ts` marks runtime cooldown from classification, not fixed durations.
- `opencode-dispatch.ts` records Z.ai `1113` as human action and does not retry forever.
- Build Studio parks a task on `retry_at` and resumes after due time.
- Build Studio parks as `awaiting_external_capacity` for `billing_action_required`.

UX tests:

- provider detail shows "Needs credits" and the right action for Z.ai `1113`.
- timed throttle shows the retry time.
- hidden `zai-coding` issue is surfaced on visible `zai` account context.

## 13. Migration Slices

### Slice 1: Classifier And Persistence

- Add `ProviderCapacityStatus`.
- Add classifier types and shared header parser.
- Add Z.ai classifier.
- Wire API error classification and success clearing.
- Add tests for Z.ai and generic headers.

### Slice 2: Build Studio Capacity Pause

- Wire OpenCode dispatch classification.
- Add `awaiting_external_capacity` Build Studio state/reason.
- Schedule resume for `retry_at`.
- Stop retrying billing/action-required failures.

### Slice 3: UX Consolidation

- Provider detail capacity card.
- Provider list row status.
- Build Studio plain-language capacity panel.
- AI Operations Map marker refinement.

### Slice 4: Broader Provider Adapters

- OpenAI, Anthropic, xAI/Grok, Gemini, and local runtime classifiers.
- Fixture-based tests for each.
- Monthly provider-doc review reminder for changing error semantics.

## 14. Acceptance Criteria

1. The Z.ai `1113` smoke result is classified as human action, not timed throttle.
2. A timed quota response schedules a retry at the provider-supplied time.
3. Build Studio can park and resume a build after capacity returns without operator polling.
4. The provider detail page tells a non-technical operator the next action in one sentence.
5. Hidden execution endpoints do not require duplicate human setup or diagnosis.
6. No capacity recovery path depends on visiting the provider list page.
7. No implementation mutates `ModelProvider.status` for temporary provider capacity exhaustion.

## 15. Open Questions

1. Should account-level capacity problems for linked providers be stored only on the visible parent provider, or mirrored to hidden execution providers too? Recommendation: store both, but render the parent as the human action surface.
2. Should the first Build Studio resume use `ScheduledJob` or the durable process substrate directly? Recommendation: start with `ScheduledJob`, but keep the contract compatible with durable sleeps.
3. Should repeated unknown provider errors become human action after N attempts? Recommendation: yes, after bounded retries with evidence.

