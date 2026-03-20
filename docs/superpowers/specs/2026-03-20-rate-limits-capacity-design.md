# EP-INF-004: Rate Limits & Capacity Management

**Date:** 2026-03-20
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-004

**Prerequisites:**
- EP-INF-003 (Provider Model Registry) — implemented, provides `perRequestLimits` seed data

**Related:**
- [2026-03-20-adaptive-model-routing-design.md](2026-03-20-adaptive-model-routing-design.md) — master vision
- [2026-03-20-provider-model-registry-design.md](2026-03-20-provider-model-registry-design.md) — EP-INF-003 (provides perRequestLimits data)

---

## Problem Statement

The platform discovers rate limits by hitting them. When a provider returns a 429 (`rate_limit`), the system degrades the **entire provider** — not the specific model that hit the limit. A single embedding model rate-limiting causes all 100+ chat models from the same provider to become degraded. There is no auto-recovery; degraded providers stay degraded until manually re-enabled.

Verified problems:

1. **Provider-level degradation on model-level rate limits.** At `fallback.ts` lines 102-116, a 429 from any model runs `prisma.modelProvider.update({ where: { providerId }, data: { status: "degraded" } })`. This affects every model under that provider.

2. **No auto-recovery.** Once degraded, the provider status stays "degraded" indefinitely. There is no timer, no re-check, no automatic return to "active." Manual intervention required.

3. **No proactive awareness.** The system has zero knowledge of RPM/TPM/RPD limits until it hits them. Providers publish rate limits in documentation and response headers, but the platform ignores both.

4. **No pre-flight check.** The routing pipeline dispatches requests to models without checking whether they have remaining capacity. The request is wasted when it inevitably 429s.

5. **EP-INF-003 stores `perRequestLimits` from OpenRouter but nobody reads them.** The data exists in `ModelProfile` but is not used for routing decisions.

---

## Goals

1. Fix degradation to be model-level, not provider-level.
2. Auto-recover degraded models after a configurable time window.
3. Track per-model request rates with in-memory sliding window counters.
4. Add a pre-flight capacity check to the routing pipeline — exclude models at 100%, penalize models approaching their limit.
5. Learn actual rate limits from 429 response headers when available.
6. Seed declared limits from provider API data (EP-INF-003 `perRequestLimits`) and curated provider documentation.

## Non-Goals

1. Request queuing or retry-after waiting (adds latency and complexity).
2. Token budget estimation before dispatch (requires knowing request size upfront — deferred to EP-INF-005).
3. Multi-tenant rate limit isolation (single-tenant deployment).
4. Persistent rate limit state in database (in-memory is correct — resets on restart, models start fresh at full capacity).
5. Shadow mode or production validation gates (dev deployment).

---

## Section 1: Model-Level Degradation & Auto-Recovery

### 1.1 Fix the Degradation Target

Replace the provider-level degradation in `fallback.ts`:

**Current (broken):**
```typescript
// Degrades ALL models under this provider
await prisma.modelProvider.update({
  where: { providerId: entry.providerId },
  data: { status: "degraded" },
});
```

**Fixed:**
```typescript
// Degrades only the specific model that rate-limited
await prisma.modelProfile.updateMany({
  where: { providerId: entry.providerId, modelId: entry.modelId },
  data: { modelStatus: "degraded" },
});
```

The `modelStatus` field already exists on `ModelProfile` (default "active"). The routing pipeline already respects it — `loadEndpointManifests()` filters on `modelStatus`, and `scoring.ts` applies a 0.7 multiplier for degraded status.

**Auth and model_not_found errors remain at provider level.** Invalid credentials or removed models correctly affect the entire provider — those errors are not model-specific.

### 1.2 Auto-Recovery

When a model is degraded due to rate limiting, schedule automatic recovery.

```typescript
interface RecoveryEntry {
  timer: NodeJS.Timeout;
  scheduledAt: number;
  delayMs: number;
}

const recoveryTimers = new Map<string, RecoveryEntry>();
```

**Default recovery delay:** 60 seconds. Covers most provider rate limit windows (OpenAI RPM resets every 60s, Anthropic similar).

**Override from response:** If the 429 response includes a `Retry-After` header (seconds or HTTP-date), use that value instead. If it includes `x-ratelimit-reset-requests` (timestamp), compute delay from that.

**Behavior:**
- `scheduleRecovery(providerId, modelId, delayMs)` — sets a timer to restore `modelStatus: "active"`
- Duplicate call replaces the previous timer (model rate-limited again during recovery window → restart the clock)
- On timer fire: `prisma.modelProfile.updateMany({ where: { providerId, modelId, modelStatus: "degraded" }, data: { modelStatus: "active" } })` — only restores if still degraded (not manually disabled)
- On server restart: all timers are lost, but all models start at their DB status. Since the DB was written to "degraded," models stay degraded after restart. This is acceptable — manual recovery on restart is a rare edge case, and the rate limit window has likely passed by then. If this becomes a problem, a startup sweep can re-activate models that have been degraded for longer than their recovery window.

### 1.3 Recovery Module

Standalone file: `apps/web/lib/routing/rate-recovery.ts`

Separate from the rate tracker because degradation is a DB write (side effect) while tracking is in-memory (pure state).

```typescript
export function scheduleRecovery(providerId: string, modelId: string, delayMs?: number): void;
export function cancelRecovery(providerId: string, modelId: string): void;
export function _resetAllRecoveries(): void;  // for tests
```

---

## Section 2: Rate Limit Tracker

### 2.1 Data Structures

Per-model sliding window counters, keyed by `providerId::modelId`.

```typescript
interface ModelRateLimits {
  /** Requests per minute — provider-declared or learned from 429s */
  rpm: number | null;
  /** Tokens per minute — provider-declared or null if unknown */
  tpm: number | null;
  /** Requests per day — provider-declared or null if unknown */
  rpd: number | null;
}

interface ModelRateState {
  limits: ModelRateLimits;
  /** Timestamps of recent requests (sliding 60s window) */
  requestTimestamps: number[];
  /** Tokens consumed in recent requests (sliding 60s window) */
  tokenCounts: Array<{ timestamp: number; tokens: number }>;
  /** Daily request count (resets when UTC date changes) */
  dailyRequests: number;
  dailyResetDate: string;  // "2026-03-20"
}
```

### 2.2 Limit Sources (Priority Cascade)

```
1. Learned from 429 response headers    (most authoritative — actual provider limit)
2. Curated from provider documentation  (manually entered, e.g., "Anthropic Tier 1: 50 RPM")
3. Seeded from EP-INF-003 perRequestLimits  (per-request token limits from OpenRouter)
4. No limit assumed                     (don't block requests we can't prove will fail)
```

Each level overrides the previous. `learnFromRateLimitResponse()` always wins because it reflects the actual enforced limit.

### 2.3 Recording Requests

After every `callProvider()` attempt (success or failure), record:

```typescript
function recordRequest(providerId: string, modelId: string, tokenCount?: number): void
```

Pushes timestamp into the sliding window. If `tokenCount` is provided, records it for TPM tracking.

### 2.4 Checking Capacity

Before dispatching, check remaining capacity:

```typescript
interface CapacityStatus {
  available: boolean;         // false = at or over limit
  utilizationPercent: number; // 0-100, for fitness penalty
  reason?: string;            // "RPM 48/50 (96%)" for logging
}

function checkModelCapacity(providerId: string, modelId: string): CapacityStatus
```

**Logic:**
1. Prune timestamps older than 60s from the window
2. Count recent requests → compare against `rpm` limit
3. Sum recent tokens → compare against `tpm` limit
4. Check daily counter against `rpd` limit
5. Return the most constrained dimension

If no limits are declared, returns `{ available: true, utilizationPercent: 0 }` — we don't restrict what we can't measure.

### 2.5 Learning From 429 Headers

When `fallback.ts` catches a `rate_limit` error:

```typescript
function learnFromRateLimitResponse(
  providerId: string,
  modelId: string,
  headers?: Record<string, string>,
): void
```

Extracts common rate limit headers:
- `x-ratelimit-limit-requests` → sets `rpm`
- `x-ratelimit-remaining-requests` → cross-check / logging
- `x-ratelimit-reset-requests` → compute recovery delay
- `retry-after` → compute recovery delay (seconds or HTTP-date)
- `x-ratelimit-limit-tokens` → sets `tpm`

If no headers available (e.g., `InferenceError` doesn't carry them), the function is a no-op — the 429 still triggers degradation and auto-recovery.

### 2.6 Module

File: `apps/web/lib/routing/rate-tracker.ts`

In-memory singleton, same pattern as `api/rate-limit.ts`.

```typescript
export function recordRequest(providerId: string, modelId: string, tokenCount?: number): void;
export function checkModelCapacity(providerId: string, modelId: string): CapacityStatus;
export function setModelLimits(providerId: string, modelId: string, limits: Partial<ModelRateLimits>): void;
export function learnFromRateLimitResponse(providerId: string, modelId: string, headers?: Record<string, string>): void;
export function seedLimitsFromProfile(providerId: string, modelId: string, perRequestLimits: { promptTokens: number | null; completionTokens: number | null } | null): void;
export function _resetAllTracking(): void;  // for tests
```

---

## Section 3: Pipeline Integration

### 3.1 Pre-Flight Capacity Check in `pipeline.ts`

Add to `getExclusionReason()` after existing hard filters:

```typescript
const capacity = checkModelCapacity(ep.providerId, ep.modelId);
if (!capacity.available) {
  return `rate limit reached: ${capacity.reason}`;
}
```

Models at 100% capacity are excluded from the candidate pool. This prevents dispatching requests that will 429.

### 3.2 Fitness Penalty in `scoring.ts`

In `computeFitness()`, add a capacity factor:

```typescript
const capacity = checkModelCapacity(ep.providerId, ep.modelId);
const capacityFactor = capacity.utilizationPercent > 80
  ? 1.0 - ((capacity.utilizationPercent - 80) / 100)
  : 1.0;
finalScore *= capacityFactor;
```

Scale: 80% → 1.0 (no penalty), 90% → 0.9, 95% → 0.85, 100% → excluded by hard filter before scoring. This makes alternatives more attractive as capacity fills — traffic naturally spreads before hitting the wall.

### 3.3 Request Recording in `fallback.ts`

After each `callProvider()` call:

**On success:**
```typescript
recordRequest(entry.providerId, entry.modelId,
  result.inputTokens + result.outputTokens);
```

**On rate_limit error:**
```typescript
recordRequest(entry.providerId, entry.modelId);
learnFromRateLimitResponse(entry.providerId, entry.modelId,
  e instanceof InferenceError ? e.headers : undefined);
// Model-level degradation (not provider)
await prisma.modelProfile.updateMany({
  where: { providerId: entry.providerId, modelId: entry.modelId },
  data: { modelStatus: "degraded" },
});
scheduleRecovery(entry.providerId, entry.modelId,
  extractRetryAfterMs(e) ?? 60_000);
```

### 3.4 Seed Limits on Manifest Load

In `loadEndpointManifests()` (or at the call site), seed the tracker:

```typescript
for (const manifest of manifests) {
  if (manifest.perRequestLimits) {
    seedLimitsFromProfile(manifest.providerId, manifest.modelId, manifest.perRequestLimits);
  }
}
```

### 3.5 InferenceError Headers

The existing `InferenceError` class in `ai-inference.ts` needs to optionally carry response headers. Add an optional `headers?: Record<string, string>` field. When catching HTTP errors from provider SDKs, populate this field with the rate-limit-relevant headers if available. If this change is too invasive for this epic, defer it — `learnFromRateLimitResponse()` handles missing headers gracefully (no-op).

---

## Section 4: Testing Strategy

### `rate-tracker.test.ts` — Pure unit tests, no DB

- Recording requests increments counter
- `checkModelCapacity` returns available when no limits set
- `checkModelCapacity` returns unavailable when at RPM limit
- `utilizationPercent` calculation at 0%, 50%, 80%, 95%, 100%
- Sliding window prunes entries older than 60s
- `setModelLimits` updates limits for a model
- `learnFromRateLimitResponse` extracts `x-ratelimit-limit-requests` header
- `learnFromRateLimitResponse` with no headers is a no-op
- `seedLimitsFromProfile` sets per-request limits
- Daily counter resets when UTC date changes
- `_resetAllTracking` clears all state
- Multiple models tracked independently

### `rate-recovery.test.ts` — Timer tests with `vi.useFakeTimers()`

- `scheduleRecovery` fires callback after delay
- Duplicate schedule replaces previous timer (restart clock)
- `cancelRecovery` prevents callback from firing
- `_resetAllRecoveries` clears all timers
- Recovery only restores models that are still degraded (not manually disabled)

### `pipeline.test.ts` additions

- Model at 100% capacity excluded by hard filter (uses mock/spy on `checkModelCapacity`)
- Model at 50% capacity passes hard filter

### `scoring.test.ts` additions

- Model at 90% utilization gets 0.9 fitness multiplier
- Model at 0% utilization gets 1.0 fitness multiplier (no penalty)

### Backward compatibility

- All existing pipeline, scoring, and fallback tests still pass
- Models with no declared limits are unaffected (available=true, utilization=0)

---

## Section 5: Files Summary

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/rate-tracker.ts` | In-memory sliding window tracker per model |
| `apps/web/lib/routing/rate-recovery.ts` | Auto-recovery timer management |
| `apps/web/lib/routing/rate-tracker.test.ts` | Tracker unit tests |
| `apps/web/lib/routing/rate-recovery.test.ts` | Recovery timer tests |

### Modified Files

| File | Change |
|---|---|
| `apps/web/lib/routing/fallback.ts` | Model-level degradation, record requests, learn from headers, schedule recovery |
| `apps/web/lib/routing/pipeline.ts` | Pre-flight capacity check in `getExclusionReason()` |
| `apps/web/lib/routing/scoring.ts` | Capacity fitness penalty |
| `apps/web/lib/routing/loader.ts` | Seed limits from `perRequestLimits` |
| `apps/web/lib/routing/index.ts` | Export new modules |
| `apps/web/lib/ai-inference.ts` | Optional: add `headers` field to `InferenceError` |

### Unchanged Files

| File | Why |
|---|---|
| `apps/web/lib/routing/types.ts` | No type changes needed — capacity is runtime state |
| `apps/web/lib/routing/model-card-types.ts` | No changes |
| `apps/web/lib/routing/adapter-*.ts` | Adapters unaffected |
| `apps/web/lib/api/rate-limit.ts` | User-facing rate limit — separate concern |

---

## Section 6: Relationship to Subsequent Epics

| This Epic Delivers | Next Epic Consumes It |
|---|---|
| Per-model capacity signals | EP-INF-005: cost-per-success ranking factors in capacity |
| `checkModelCapacity()` function | EP-INF-005: RequestContract can specify `latencyClass` that considers rate limit headroom |
| Learned rate limits | EP-INF-006: recipe re-evaluation when rate limits change |
| Auto-recovery mechanism | EP-INF-006: drift detection can trigger re-evaluation after recovery |

---

## Appendix: Provider Rate Limit Documentation

Known rate limit structures by provider (for curated seed data):

**Anthropic** — By tier, per model:
- Rate limits vary by subscription tier (1-4)
- Published at: https://platform.claude.com/docs/en/api/rate-limits
- Includes RPM, TPM (input + output separately), RPD

**OpenAI** — By tier, per model:
- Rate limits vary by usage tier (1-5)
- Published at: https://platform.openai.com/docs/guides/rate-limits
- Includes RPM, RPD, TPM
- Response headers: `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`

**OpenRouter** — Per-request limits in API response:
- `per_request_limits.prompt_tokens`, `per_request_limits.completion_tokens`
- Credit-based rate limiting (not simple RPM)
- Free models have separate RPM/RPD limits

**Gemini** — By model:
- Published at: https://ai.google.dev/gemini-api/docs/rate-limits
- Includes RPM, RPD, TPM

**Ollama** — No rate limits (local inference, limited by hardware).
