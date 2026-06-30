# Provider Capacity Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first provider-capacity recovery slice so DPF can classify provider-specific quota, throttle, billing, and plan errors into canonical actions.

**Architecture:** Add a provider-capacity classifier layer under routing, persist current live capacity in a dedicated Prisma model, and feed classifications into inference errors and provider health. Z.ai is the first exact provider classifier; generic OpenAI-compatible headers remain the fallback.

**Tech Stack:** Next.js app code, TypeScript, Vitest, Prisma migration.

---

## Chunk 1: Classifier And Persistence

### Task 1: Provider Capacity Classifier

**Files:**
- Create: `apps/web/lib/routing/provider-capacity/types.ts`
- Create: `apps/web/lib/routing/provider-capacity/headers.ts`
- Create: `apps/web/lib/routing/provider-capacity/zai.ts`
- Create: `apps/web/lib/routing/provider-capacity/index.ts`
- Test: `apps/web/lib/routing/provider-capacity/provider-capacity.test.ts`

- [ ] Write failing tests for Z.ai `1113`, Z.ai `next_flush_time`, `Retry-After`, reset epoch headers, and unknown `429`.
- [ ] Run targeted Vitest and verify tests fail because modules do not exist.
- [ ] Implement minimal classifier code.
- [ ] Run targeted Vitest and verify tests pass.

### Task 2: Persistence

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_provider_capacity_status/migration.sql`
- Create: `apps/web/lib/routing/provider-capacity/store.ts`
- Test: `apps/web/lib/routing/provider-capacity/provider-capacity-store.test.ts`

- [ ] Write failing store tests using mocked Prisma for upsert on error and clear on success.
- [ ] Add Prisma model and migration SQL.
- [ ] Implement store helpers.
- [ ] Run targeted tests.

### Task 3: Inference And Health Integration

**Files:**
- Modify: `apps/web/lib/inference/ai-inference.ts`
- Modify: `apps/web/lib/routing/provider-health.ts`
- Modify: `apps/web/lib/routing/provider-health-loader.ts`
- Test: `apps/web/lib/inference/ai-inference.test.ts`
- Test: `apps/web/lib/routing/provider-health.test.ts`

- [ ] Write failing tests proving `classifyHttpError` carries a capacity classification for Z.ai `1113`.
- [ ] Write failing provider-health tests proving capacity state overrides recent generic telemetry.
- [ ] Implement minimal integration.
- [ ] Run targeted tests.

## Chunk 2: First Build Studio/OpenCode Hook

### Task 4: OpenCode Capacity Recording

**Files:**
- Modify: `apps/web/lib/integrate/opencode-dispatch.ts`
- Test: existing or new OpenCode dispatch tests.

- [ ] Write failing tests for Z.ai/OpenCode error text classification.
- [ ] Record capacity status from OpenCode failures without exposing credentials.
- [ ] Run targeted tests.

## Verification

- [ ] `pnpm --filter web exec vitest run apps/web/lib/routing/provider-capacity/provider-capacity.test.ts apps/web/lib/routing/provider-health.test.ts apps/web/lib/inference/ai-inference.test.ts`
- [ ] `pnpm --filter web typecheck`
- [ ] Production build if runtime/UI integration lands in this PR.

