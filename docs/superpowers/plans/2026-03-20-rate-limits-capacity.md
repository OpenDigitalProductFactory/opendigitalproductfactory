# EP-INF-004: Rate Limits & Capacity Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the provider-level degradation bug, add model-level auto-recovery, and provide proactive rate limit awareness to the routing pipeline.

**Architecture:** In-memory sliding-window rate tracker per model (same pattern as existing `api/rate-limit.ts`). Separate recovery module handles DB-side auto-recovery timers. Pipeline integration via pre-flight capacity check (hard filter) and post-scoring capacity penalty. InferenceError extended to carry response headers for 429 learning.

**Tech Stack:** TypeScript, Vitest (globals: false), Prisma, Node.js timers

**Spec:** `docs/superpowers/specs/2026-03-20-rate-limits-capacity-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/rate-tracker.ts` | In-memory sliding-window tracker per model (RPM/TPM/RPD counters, capacity check, header learning) |
| `apps/web/lib/routing/rate-recovery.ts` | Auto-recovery timer management (schedule/cancel model status restore) |
| `apps/web/lib/routing/rate-tracker.test.ts` | Tracker unit tests |
| `apps/web/lib/routing/rate-recovery.test.ts` | Recovery timer tests (vi.useFakeTimers) |

### Modified Files

| File | Change |
|---|---|
| `apps/web/lib/ai-inference.ts` (line 36) | Add `headers` field to `InferenceError`, pass rate-limit headers from `classifyHttpError` |
| `apps/web/lib/routing/fallback.ts` (line 96) | Model-level degradation, record requests, learn from headers, schedule recovery |
| `apps/web/lib/routing/loader.ts` (line 23) | Include degraded models in query, derive manifest status from model+provider |
| `apps/web/lib/routing/pipeline.ts` (line 115, line 361) | Pre-flight capacity check in `getExclusionReason()`, post-scoring capacity penalty in `routeEndpoint()` |
| `apps/web/lib/routing/pipeline.test.ts` | Tests for capacity filter and penalty |
| `apps/web/lib/routing/index.ts` | Export new modules |

### Unchanged Files

| File | Why |
|---|---|
| `apps/web/lib/routing/scoring.ts` | Purity preserved — capacity penalty is in pipeline.ts |
| `apps/web/lib/routing/types.ts` | No type changes — capacity is runtime state |
| `apps/web/lib/routing/adapter-*.ts` | Adapters unaffected |
| `apps/web/lib/api/rate-limit.ts` | User-facing rate limiter — separate concern |

---

## Task 1: Rate Tracker Module

**Files:**
- Create: `apps/web/lib/routing/rate-tracker.ts`
- Create: `apps/web/lib/routing/rate-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/lib/routing/rate-tracker.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  recordRequest,
  checkModelCapacity,
  setModelLimits,
  learnFromRateLimitResponse,
  extractRetryAfterMs,
  _resetAllTracking,
} from "./rate-tracker";

describe("rate-tracker", () => {
  beforeEach(() => {
    _resetAllTracking();
  });

  describe("checkModelCapacity with no limits", () => {
    it("returns available when no limits set", () => {
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.available).toBe(true);
      expect(status.utilizationPercent).toBe(0);
    });
  });

  describe("recordRequest + RPM tracking", () => {
    it("tracks request count", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 10 });
      recordRequest("openai", "gpt-4o");
      recordRequest("openai", "gpt-4o");
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.available).toBe(true);
      expect(status.utilizationPercent).toBe(20); // 2/10
    });

    it("returns unavailable at RPM limit", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 3 });
      recordRequest("openai", "gpt-4o");
      recordRequest("openai", "gpt-4o");
      recordRequest("openai", "gpt-4o");
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.available).toBe(false);
      expect(status.utilizationPercent).toBe(100);
    });

    it("prunes old entries outside 60s window", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      setModelLimits("openai", "gpt-4o", { rpm: 2 });
      recordRequest("openai", "gpt-4o");
      recordRequest("openai", "gpt-4o");
      expect(checkModelCapacity("openai", "gpt-4o").available).toBe(false);

      // Advance time past 60s window
      vi.setSystemTime(1_000_000 + 61_000);
      recordRequest("openai", "gpt-4o");
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.available).toBe(true); // only 1 request in window now
      expect(status.utilizationPercent).toBe(50); // 1/2
      vi.useRealTimers();
    });
  });

  describe("TPM tracking", () => {
    it("tracks token counts against tpm limit", () => {
      setModelLimits("openai", "gpt-4o", { tpm: 10000 });
      recordRequest("openai", "gpt-4o", 3000);
      recordRequest("openai", "gpt-4o", 2000);
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.available).toBe(true);
      expect(status.utilizationPercent).toBe(50); // 5000/10000
    });

    it("returns unavailable at TPM limit", () => {
      setModelLimits("openai", "gpt-4o", { tpm: 5000 });
      recordRequest("openai", "gpt-4o", 3000);
      recordRequest("openai", "gpt-4o", 2000);
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.available).toBe(false);
      expect(status.utilizationPercent).toBe(100);
    });
  });

  describe("RPD tracking", () => {
    it("tracks daily request count against rpd limit", () => {
      setModelLimits("openai", "gpt-4o", { rpd: 100 });
      for (let i = 0; i < 50; i++) recordRequest("openai", "gpt-4o");
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.available).toBe(true);
      expect(status.utilizationPercent).toBe(50);
    });

    it("returns unavailable at RPD limit", () => {
      setModelLimits("openai", "gpt-4o", { rpd: 10 });
      for (let i = 0; i < 10; i++) recordRequest("openai", "gpt-4o");
      expect(checkModelCapacity("openai", "gpt-4o").available).toBe(false);
    });
  });

  describe("most constrained dimension wins", () => {
    it("returns highest utilization across RPM, TPM, RPD", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 100, tpm: 10000, rpd: 1000 });
      // 10/100 RPM = 10%, but 9000/10000 TPM = 90%
      recordRequest("openai", "gpt-4o", 4500);
      recordRequest("openai", "gpt-4o", 4500);
      // RPM is 2/100 = 2%, TPM is 9000/10000 = 90%, RPD is 2/1000 = 0.2%
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.utilizationPercent).toBe(90); // most constrained
    });
  });

  describe("utilizationPercent calculation", () => {
    it("returns 0% when no requests and limits set", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 50 });
      expect(checkModelCapacity("openai", "gpt-4o").utilizationPercent).toBe(0);
    });

    it("returns 50% at half capacity", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 10 });
      for (let i = 0; i < 5; i++) recordRequest("openai", "gpt-4o");
      expect(checkModelCapacity("openai", "gpt-4o").utilizationPercent).toBe(50);
    });

    it("returns 80% at 80% capacity", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 10 });
      for (let i = 0; i < 8; i++) recordRequest("openai", "gpt-4o");
      expect(checkModelCapacity("openai", "gpt-4o").utilizationPercent).toBe(80);
    });
  });

  describe("multiple models tracked independently", () => {
    it("different models have separate counters", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 5 });
      setModelLimits("openai", "o4-mini", { rpm: 5 });
      recordRequest("openai", "gpt-4o");
      recordRequest("openai", "gpt-4o");
      recordRequest("openai", "o4-mini");
      expect(checkModelCapacity("openai", "gpt-4o").utilizationPercent).toBe(40);
      expect(checkModelCapacity("openai", "o4-mini").utilizationPercent).toBe(20);
    });
  });

  describe("setModelLimits", () => {
    it("updates limits for a model", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 100 });
      for (let i = 0; i < 50; i++) recordRequest("openai", "gpt-4o");
      expect(checkModelCapacity("openai", "gpt-4o").utilizationPercent).toBe(50);
    });
  });

  describe("learnFromRateLimitResponse", () => {
    it("extracts x-ratelimit-limit-requests header (OpenAI)", () => {
      learnFromRateLimitResponse("openai", "gpt-4o", {
        "x-ratelimit-limit-requests": "60",
      });
      // Now 0 requests against limit of 60
      for (let i = 0; i < 30; i++) recordRequest("openai", "gpt-4o");
      expect(checkModelCapacity("openai", "gpt-4o").utilizationPercent).toBe(50);
    });

    it("extracts anthropic-ratelimit-requests-limit header", () => {
      learnFromRateLimitResponse("anthropic", "claude-opus-4-6", {
        "anthropic-ratelimit-requests-limit": "50",
      });
      for (let i = 0; i < 25; i++) recordRequest("anthropic", "claude-opus-4-6");
      expect(checkModelCapacity("anthropic", "claude-opus-4-6").utilizationPercent).toBe(50);
    });

    it("extracts x-ratelimit-limit-tokens header for TPM", () => {
      learnFromRateLimitResponse("openai", "gpt-4o", {
        "x-ratelimit-limit-tokens": "40000",
      });
      recordRequest("openai", "gpt-4o", 20000);
      expect(checkModelCapacity("openai", "gpt-4o").utilizationPercent).toBe(50);
    });

    it("is a no-op with no headers", () => {
      learnFromRateLimitResponse("openai", "gpt-4o", undefined);
      // No limits learned, so should be available
      expect(checkModelCapacity("openai", "gpt-4o").available).toBe(true);
    });

    it("is a no-op with empty headers", () => {
      learnFromRateLimitResponse("openai", "gpt-4o", {});
      expect(checkModelCapacity("openai", "gpt-4o").available).toBe(true);
    });
  });

  describe("extractRetryAfterMs", () => {
    it("parses numeric retry-after header (seconds)", () => {
      expect(extractRetryAfterMs({ "retry-after": "30" })).toBe(30_000);
    });

    it("parses x-ratelimit-reset-requests (duration format)", () => {
      // OpenAI uses duration format like "1m30s"
      expect(extractRetryAfterMs({ "x-ratelimit-reset-requests": "1m30s" })).toBe(90_000);
    });

    it("parses x-ratelimit-reset-requests (plain seconds)", () => {
      expect(extractRetryAfterMs({ "x-ratelimit-reset-requests": "45s" })).toBe(45_000);
    });

    it("returns undefined with no headers", () => {
      expect(extractRetryAfterMs(undefined)).toBeUndefined();
    });

    it("returns undefined with empty headers", () => {
      expect(extractRetryAfterMs({})).toBeUndefined();
    });
  });

  describe("_resetAllTracking", () => {
    it("clears all state", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 5 });
      recordRequest("openai", "gpt-4o");
      _resetAllTracking();
      expect(checkModelCapacity("openai", "gpt-4o").available).toBe(true);
      expect(checkModelCapacity("openai", "gpt-4o").utilizationPercent).toBe(0);
    });
  });

  describe("reason string", () => {
    it("includes RPM info when at limit", () => {
      setModelLimits("openai", "gpt-4o", { rpm: 5 });
      for (let i = 0; i < 5; i++) recordRequest("openai", "gpt-4o");
      const status = checkModelCapacity("openai", "gpt-4o");
      expect(status.reason).toContain("RPM");
      expect(status.reason).toContain("5");
    });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/rate-tracker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement rate tracker**

Key implementation details:
- Sliding window: 60_000ms (same as WINDOW_MS in api/rate-limit.ts)
- State: `Map<string, ModelRateState>` keyed by `${providerId}::${modelId}`
- `recordRequest()`: prune old entries first (prevent unbounded growth), then push timestamp
- `checkModelCapacity()`: prune, count, compare against limits. Return most constrained dimension.
- `learnFromRateLimitResponse()`: check OpenAI headers first (`x-ratelimit-limit-requests`), then Anthropic (`anthropic-ratelimit-requests-limit`), then standard HTTP
- `extractRetryAfterMs()`: parse `retry-after` (numeric seconds × 1000), `x-ratelimit-reset-requests` (OpenAI duration format like `"1m30s"` or `"45s"` — parse with regex `/(\d+)m/` and `/(\d+)s/`), `anthropic-ratelimit-requests-reset` (ISO timestamp → ms delta). Return undefined if none found.
- `learnFromRateLimitResponse()`: also check `x-ratelimit-limit-tokens` → sets `tpm`
- `checkModelCapacity()`: check all three dimensions (RPM, TPM, RPD) and return the most constrained
- `recordRequest()`: always increment RPD daily counter; if tokenCount provided, add to TPM window
- `setModelLimits()`: create or update the state entry's limits
- `_resetAllTracking()`: clear the Map

```typescript
export interface CapacityStatus {
  available: boolean;
  utilizationPercent: number;
  reason?: string;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/rate-tracker.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/rate-tracker.ts apps/web/lib/routing/rate-tracker.test.ts
git commit -m "feat(routing): EP-INF-004 in-memory rate tracker with TDD"
```

---

## Task 2: Rate Recovery Module

**Files:**
- Create: `apps/web/lib/routing/rate-recovery.ts`
- Create: `apps/web/lib/routing/rate-recovery.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/lib/routing/rate-recovery.test.ts
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { scheduleRecovery, cancelRecovery, _resetAllRecoveries } from "./rate-recovery";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    modelProfile: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("rate-recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetAllRecoveries();
    vi.mocked(prisma.modelProfile.updateMany).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires recovery after delay", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.modelProfile.updateMany).toHaveBeenCalledWith({
      where: { providerId: "openai", modelId: "gpt-4o", modelStatus: "degraded" },
      data: { modelStatus: "active" },
    });
  });

  it("replaces previous timer on duplicate schedule", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    scheduleRecovery("openai", "gpt-4o", 120_000); // restart clock

    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled(); // first timer was cleared

    await vi.advanceTimersByTimeAsync(60_000); // 120s total
    expect(prisma.modelProfile.updateMany).toHaveBeenCalledTimes(1);
  });

  it("cancelRecovery prevents callback", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    cancelRecovery("openai", "gpt-4o");

    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
  });

  it("_resetAllRecoveries clears all timers", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    scheduleRecovery("anthropic", "claude-opus-4-6", 60_000);
    _resetAllRecoveries();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
  });

  it("only restores models that are still degraded", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    // The updateMany where clause includes modelStatus: "degraded"
    // so models manually set to "disabled" won't be restored
    expect(prisma.modelProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ modelStatus: "degraded" }),
      }),
    );
  });

  it("uses default delay of 60s when not specified", async () => {
    scheduleRecovery("openai", "gpt-4o");

    await vi.advanceTimersByTimeAsync(59_999);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(prisma.modelProfile.updateMany).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/rate-recovery.test.ts`

- [ ] **Step 3: Implement recovery module**

```typescript
// apps/web/lib/routing/rate-recovery.ts
import { prisma } from "@dpf/db";

const DEFAULT_RECOVERY_MS = 60_000;
const recoveryTimers = new Map<string, NodeJS.Timeout>();

function rateKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function scheduleRecovery(
  providerId: string,
  modelId: string,
  delayMs: number = DEFAULT_RECOVERY_MS,
): void {
  const key = rateKey(providerId, modelId);

  // Clear existing timer if any (restart the clock)
  const existing = recoveryTimers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    recoveryTimers.delete(key);
    await prisma.modelProfile
      .updateMany({
        where: { providerId, modelId, modelStatus: "degraded" },
        data: { modelStatus: "active" },
      })
      .catch((err) =>
        console.error(`[rate-recovery] Failed to restore ${key}:`, err),
      );
  }, delayMs);

  recoveryTimers.set(key, timer);
}

export function cancelRecovery(providerId: string, modelId: string): void {
  const key = rateKey(providerId, modelId);
  const timer = recoveryTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    recoveryTimers.delete(key);
  }
}

export function _resetAllRecoveries(): void {
  for (const timer of recoveryTimers.values()) {
    clearTimeout(timer);
  }
  recoveryTimers.clear();
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/rate-recovery.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/rate-recovery.ts apps/web/lib/routing/rate-recovery.test.ts
git commit -m "feat(routing): EP-INF-004 auto-recovery timer module with TDD"
```

---

## Task 3: Extend InferenceError with Headers

**Files:**
- Modify: `apps/web/lib/ai-inference.ts` (lines 36-59)

- [ ] **Step 1: Read the current InferenceError class and classifyHttpError function**

Read `apps/web/lib/ai-inference.ts` lines 36-60 to see the current code.

- [ ] **Step 2: Add `headers` field to InferenceError**

At line 36, update the class:

```typescript
export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly code: "network" | "auth" | "rate_limit" | "model_not_found" | "provider_error",
    public readonly providerId: string,
    public readonly statusCode?: number,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "InferenceError";
  }
}
```

- [ ] **Step 3: Update classifyHttpError to accept and pass headers**

Update the function signature to accept an optional headers parameter, and extract rate-limit-relevant headers:

```typescript
function classifyHttpError(
  status: number,
  providerId: string,
  body: string,
  responseHeaders?: Headers,
): InferenceError {
  // Extract rate-limit-relevant headers
  const rateLimitHeaders: Record<string, string> | undefined = responseHeaders
    ? Object.fromEntries(
        [...responseHeaders.entries()].filter(
          ([k]) =>
            k.startsWith("x-ratelimit") ||
            k.startsWith("anthropic-ratelimit") ||
            k === "retry-after",
        ),
      )
    : undefined;

  const headers = rateLimitHeaders && Object.keys(rateLimitHeaders).length > 0
    ? rateLimitHeaders
    : undefined;

  if (status === 401 || status === 403) {
    return new InferenceError(`Auth failed for ${providerId}: ${body.slice(0, 200)}`, "auth", providerId, status, headers);
  }
  if (status === 429) {
    return new InferenceError(`Rate limited by ${providerId}`, "rate_limit", providerId, status, headers);
  }
  if (status === 404) {
    return new InferenceError(`Model not found on ${providerId}: ${body.slice(0, 200)}`, "model_not_found", providerId, status, headers);
  }
  return new InferenceError(`HTTP ${status} from ${providerId}: ${body.slice(0, 300)}`, "provider_error", providerId, status, headers);
}
```

- [ ] **Step 4: Update the call site to pass res.headers**

Find the line `throw classifyHttpError(res.status, providerId, errBody);` (around line 379) and update to:

```typescript
throw classifyHttpError(res.status, providerId, errBody, res.headers);
```

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd apps/web && npx vitest run lib/ai-inference.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ai-inference.ts
git commit -m "feat(inference): EP-INF-004 add headers to InferenceError for rate limit learning"
```

---

## Task 4: Fix Fallback Error Handling

The most critical task — fixes the provider-level degradation bug and wires in rate tracking + recovery.

**Files:**
- Modify: `apps/web/lib/routing/fallback.ts` (lines 96-134)

- [ ] **Step 1: Read the current fallback.ts**

Read the full file to understand the structure.

- [ ] **Step 2: Add imports at the top**

```typescript
import { recordRequest, learnFromRateLimitResponse, extractRetryAfterMs } from "./rate-tracker";
import { scheduleRecovery } from "./rate-recovery";
```

- [ ] **Step 3: Add request recording on success**

After the successful `callProvider()` result (around line 81, inside the `try` block after `const result = await callProvider(...)`), add:

```typescript
      // EP-INF-004: Record successful request for rate tracking
      recordRequest(entry.providerId, entry.modelId,
        (result.inputTokens ?? 0) + (result.outputTokens ?? 0));
```

- [ ] **Step 4: Replace the error handling block**

Replace the entire `if (e instanceof InferenceError)` block (lines 102-133) with:

```typescript
      if (e instanceof InferenceError) {
        // EP-INF-004: Record the failed request too
        recordRequest(entry.providerId, entry.modelId);

        if (e.code === "rate_limit") {
          // EP-INF-004: Learn from response headers if available
          learnFromRateLimitResponse(entry.providerId, entry.modelId, e.headers);

          // EP-INF-004: Degrade the specific MODEL, not the provider
          await prisma.modelProfile
            .updateMany({
              where: { providerId: entry.providerId, modelId: entry.modelId },
              data: { modelStatus: "degraded" },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to mark ${entry.providerId}/${entry.modelId} degraded:`,
                err,
              ),
            );

          // EP-INF-004: Schedule auto-recovery
          const retryMs = extractRetryAfterMs(e.headers) ?? 60_000;
          scheduleRecovery(entry.providerId, entry.modelId, retryMs);

        } else if (e.code === "model_not_found") {
          // EP-INF-004: Retire the specific model, not the provider
          await prisma.modelProfile
            .updateMany({
              where: { providerId: entry.providerId, modelId: entry.modelId },
              data: {
                modelStatus: "retired",
                retiredAt: new Date(),
                retiredReason: "model_not_found from provider",
              },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to retire ${entry.providerId}/${entry.modelId}:`,
                err,
              ),
            );

        } else if (e.code === "auth") {
          // Auth errors remain at provider level — credentials are shared
          await prisma.modelProvider
            .update({
              where: { providerId: entry.providerId },
              data: { status: "disabled" },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to mark ${entry.providerId} disabled:`,
                err,
              ),
            );
        }
      }
```

- [ ] **Step 5: Verify build compiles**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/routing/fallback.ts
git commit -m "fix(routing): EP-INF-004 model-level degradation, auto-recovery, rate tracking in fallback"
```

---

## Task 4b: Fallback Behavior Tests

The most critical behavioral change in this epic needs test coverage.

**Files:**
- Create: `apps/web/lib/routing/fallback.test.ts`

- [ ] **Step 1: Write fallback tests**

These tests verify the error handling changes from Task 4. Mock `prisma`, `callProvider`, `recordRequest`, `learnFromRateLimitResponse`, `scheduleRecovery`.

Test cases:
- 429 triggers `prisma.modelProfile.updateMany` (NOT `prisma.modelProvider.update`)
- 429 triggers `scheduleRecovery` with the model, not the provider
- 429 triggers `recordRequest` and `learnFromRateLimitResponse`
- Successful call triggers `recordRequest` with token count
- `model_not_found` retires the specific model (`modelStatus: "retired"`, `retiredAt` set, `retiredReason` set)
- `model_not_found` does NOT change `modelProvider.status`
- `auth` error disables the entire provider (`modelProvider.status: "disabled"`)
- `auth` error does NOT change `modelProfile.modelStatus`

**Note:** `callWithFallbackChain` requires a `RouteDecision` object and calls `callProvider` internally. The tests should mock `callProvider` to return success or throw `InferenceError` with specific codes, and mock `prisma` to verify the correct DB calls.

- [ ] **Step 2: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/fallback.test.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/routing/fallback.test.ts
git commit -m "test(routing): EP-INF-004 fallback behavior tests for model-level degradation"
```

---

## Task 5: Update Loader for Degraded Models

**Files:**
- Modify: `apps/web/lib/routing/loader.ts` (lines 23, 42)

- [ ] **Step 1: Read current loader.ts**

- [ ] **Step 2: Update the query to include degraded models**

Change line 24 from:
```typescript
      modelStatus: "active",
```
To:
```typescript
      modelStatus: { in: ["active", "degraded"] },
```

- [ ] **Step 3: Update the status mapping to derive from model+provider**

Change the status mapping (around line 42) from:
```typescript
    status: mp.provider.status as EndpointManifest["status"],
```
To:
```typescript
    // EP-INF-004: Derive status from worse of provider and model status
    status: (mp.modelStatus === "degraded" || mp.provider.status === "degraded"
      ? "degraded"
      : mp.provider.status) as EndpointManifest["status"],
```

- [ ] **Step 4: Run pipeline tests to verify backward compatibility**

Run: `cd apps/web && npx vitest run lib/routing/pipeline.test.ts`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/loader.ts
git commit -m "fix(routing): EP-INF-004 include degraded models in routing, derive status from model+provider"
```

---

## Task 6: Pipeline Integration — Capacity Check & Penalty

**Files:**
- Modify: `apps/web/lib/routing/pipeline.ts` (lines 115, 361)
- Modify: `apps/web/lib/routing/pipeline.test.ts`

- [ ] **Step 1: Add import to pipeline.ts**

```typescript
import { checkModelCapacity } from "./rate-tracker";
```

- [ ] **Step 2: Add pre-flight capacity check to getExclusionReason()**

After the existing modelClass check (the EP-INF-003 filter), add:

```typescript
  // EP-INF-004: Rate limit pre-flight check
  const capacity = checkModelCapacity(ep.providerId, ep.modelId);
  if (!capacity.available) {
    return `rate limit reached: ${capacity.reason}`;
  }
```

- [ ] **Step 3: Add post-scoring capacity penalty in routeEndpoint()**

In `routeEndpoint()`, after the `scored` array is built (around line 366) but BEFORE the `scored.sort(...)` call, add:

```typescript
  // EP-INF-004: Apply capacity penalty after scoring, before ranking
  for (const entry of scored) {
    const capacity = checkModelCapacity(entry.ep.providerId, entry.ep.modelId);
    if (capacity.utilizationPercent > 80) {
      const capacityFactor = 1.0 - ((capacity.utilizationPercent - 80) / 100);
      entry.fitness *= capacityFactor;
    }
  }
```

- [ ] **Step 4: Add tests to pipeline.test.ts**

```typescript
describe("filterHard – EP-INF-004 capacity filter", () => {
  it("excludes models at 100% capacity", async () => {
    // Set up rate limits and fill them
    const { setModelLimits, recordRequest, _resetAllTracking } = await import("./rate-tracker");
    _resetAllTracking();
    setModelLimits("test", "test-model", { rpm: 2 });
    recordRequest("test", "test-model");
    recordRequest("test", "test-model");

    const ep = makeEndpoint({ providerId: "test", modelId: "test-model" });
    const result = filterHard([ep], makeRequirement(), "internal");
    expect(result.eligible).toHaveLength(0);
    expect(result.excluded[0]!.excludedReason).toContain("rate limit");

    _resetAllTracking(); // cleanup
  });

  it("allows models with no rate limits set", async () => {
    const { _resetAllTracking } = await import("./rate-tracker");
    _resetAllTracking();

    const ep = makeEndpoint({ providerId: "test", modelId: "test-model" });
    const result = filterHard([ep], makeRequirement(), "internal");
    expect(result.eligible).toHaveLength(1);

    _resetAllTracking();
  });
});
```

**Note:** These tests use dynamic `import()` to get the rate-tracker module so they can set up state. An alternative is to mock `checkModelCapacity` with `vi.mock`. Choose whichever pattern the developer prefers — both work.

- [ ] **Step 5: Run all pipeline tests**

Run: `cd apps/web && npx vitest run lib/routing/pipeline.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/routing/pipeline.ts apps/web/lib/routing/pipeline.test.ts
git commit -m "feat(routing): EP-INF-004 pre-flight capacity check and post-scoring penalty"
```

---

## Task 7: Update Exports

**Files:**
- Modify: `apps/web/lib/routing/index.ts`

- [ ] **Step 1: Add exports**

```typescript
// EP-INF-004: Rate limits & capacity
export type { CapacityStatus } from "./rate-tracker";
export {
  recordRequest,
  checkModelCapacity,
  setModelLimits,
  learnFromRateLimitResponse,
  extractRetryAfterMs,
} from "./rate-tracker";
export { scheduleRecovery, cancelRecovery } from "./rate-recovery";
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/routing/index.ts
git commit -m "feat(routing): EP-INF-004 export rate tracking and recovery modules"
```

---

## Task 8: Run Full Test Suite & Verify

- [ ] **Step 1: Run all routing tests**

Run: `cd apps/web && npx vitest run lib/routing/`
Expected: All tests pass — new rate tracker/recovery tests + all existing tests.

- [ ] **Step 2: Run inference tests**

Run: `cd apps/web && npx vitest run lib/ai-inference.test.ts`
Expected: All tests pass with InferenceError header changes.

- [ ] **Step 3: Run type check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 4: Commit if any fixes needed**

```bash
git add apps/web/lib/routing/ apps/web/lib/ai-inference.ts
git commit -m "fix(routing): EP-INF-004 address test suite issues"
```
