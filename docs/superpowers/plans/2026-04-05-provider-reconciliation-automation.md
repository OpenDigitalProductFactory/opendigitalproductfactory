# Provider Reconciliation Automation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make configured AI providers self-heal on startup and lifecycle events by automatically reconciling health, model metadata, routing state, recipes, and advisories, while preserving manual debug controls.

**Architecture:** Build one canonical provider reconciliation orchestrator and route every automatic and manual repair path through it. The orchestrator will classify provider failures, choose the correct catalog strategy (`known_catalog` vs `provider_api`), run repair stages idempotently, and persist visible provider/advisory status. Existing functions like `autoDiscoverAndProfile()`, `backfillModelCards()`, and `seedAllRecipes()` should be reused rather than duplicated.

**Tech Stack:** Next.js server actions, Prisma, TypeScript, Vitest, scheduled jobs, Next.js production build

---

## File Structure

### Files to create

- `apps/web/lib/inference/provider-reconciliation-orchestrator.ts`
  Responsibility: canonical orchestration for provider reconciliation stages, strategy selection, failure classification, repair sequencing, and result summaries.

- `apps/web/lib/inference/provider-reconciliation-orchestrator.test.ts`
  Responsibility: focused unit coverage for orchestration behavior, failure classification, and strategy-specific repair sequencing.

### Files to modify

- `apps/web/lib/actions/ai-providers.ts`
  Responsibility: provider admin actions, startup-triggered reconciliation entry points, and manual controls that must call the shared orchestrator.

- `apps/web/lib/govern/provider-oauth.ts`
  Responsibility: OAuth completion path that must trigger immediate reconciliation for the activated provider and any linked sibling provider.

- `apps/web/lib/inference/ai-provider-internals.ts`
  Responsibility: low-level discovery/profile/backfill/recipe repair functions reused by the orchestrator; keep idempotent and side-effect boundaries clear.

- `apps/web/lib/routing/fallback.ts`
  Responsibility: runtime provider/model failures that should trigger orchestrator-based reconciliation instead of ad hoc refresh behavior.

- `apps/web/app/(shell)/platform/ai/providers/page.tsx`
  Responsibility: provider-page load trigger for stale/failing providers.

- `apps/web/components/platform/ProviderDetailForm.tsx`
  Responsibility: provider UX status display, new “Run full reconciliation” entry point, and clearer automated/manual state messaging.

- `apps/web/components/monitoring/CoworkerHealthStatus.tsx`
  Responsibility: status display should reflect reconciled provider availability/advisories instead of implying AI is unavailable without context.

- `apps/web/lib/actions/ai-providers.test.ts`
  Responsibility: regression coverage for manual admin actions calling the shared orchestrator.

- `apps/web/lib/govern/provider-oauth.test.ts`
  Responsibility: regression coverage for OAuth-triggered reconciliation.

- `apps/web/lib/routing/fallback.test.ts`
  Responsibility: regression coverage for runtime failure-triggered reconciliation.

- `apps/web/components/platform/ProviderDetailForm.test.tsx`
  Responsibility: UI coverage for provider health/action-required status and new manual/full reconciliation action.

- `apps/web/components/monitoring/CoworkerHealthStatus.test.tsx`
  Responsibility: UI coverage for reconciled provider state display.

- `packages/db/prisma/schema.prisma`
  Responsibility: add any missing reconciliation/advisory persistence fields only if existing `RuntimeAdvisory` / `ScheduledJob` / `ModelProvider` fields are insufficient.

- `packages/db/src/seed.ts`
  Responsibility: seed any new scheduled job defaults required for provider reconciliation automation, but not day-to-day runtime state.

## Chunk 1: Create the Orchestrator Core

### Task 1: Write failing unit tests for reconciliation orchestration

**Files:**
- Create: `apps/web/lib/inference/provider-reconciliation-orchestrator.test.ts`
- Reference: `apps/web/lib/actions/ai-providers.ts`
- Reference: `apps/web/lib/inference/ai-provider-internals.ts`

- [ ] **Step 1: Write the failing test for known-catalog provider reconciliation**

Add a test that expects a configured `codex` provider to:

- probe health,
- choose `known_catalog`,
- run known-model reseed,
- run routing metadata repair,
- run recipe repair,
- return a structured result with `status: "healthy"` when all stages succeed.

Example shape:

```ts
it("reconciles a known-catalog provider end to end", async () => {
  const result = await reconcileProvider("codex", { trigger: "startup" });
  expect(result.strategy).toBe("known_catalog");
  expect(result.status).toBe("healthy");
  expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("codex");
  expect(mockBackfillModelCards).toHaveBeenCalled();
  expect(mockSeedAllRecipes).toHaveBeenCalled();
});
```

- [ ] **Step 2: Write the failing test for failure classification**

Add tests that expect the orchestrator to classify representative failures as:

- `reconnect_required`
- `missing_scope`
- `billing_issue`
- `interface_drift`
- `provider_outage`

- [ ] **Step 3: Run the new test file and verify it fails**

Run:

```bash
pnpm --filter web exec vitest run lib/inference/provider-reconciliation-orchestrator.test.ts
```

Expected:

- FAIL because the orchestrator does not exist yet

- [ ] **Step 4: Implement the minimal orchestrator**

Create `apps/web/lib/inference/provider-reconciliation-orchestrator.ts` with:

- a `reconcileProvider(providerId, options)` entry point
- `classifyProviderFailure(...)`
- strategy selection (`known_catalog` vs `provider_api`)
- a small structured result type

The minimal implementation should:

- load provider state,
- run the real health probe through existing provider test/probe helpers where possible,
- call `autoDiscoverAndProfile()`,
- call `backfillModelCards()`,
- call `seedAllRecipes()`,
- return a summary without UI concerns.

- [ ] **Step 5: Re-run the orchestrator test**

Run:

```bash
pnpm --filter web exec vitest run lib/inference/provider-reconciliation-orchestrator.test.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/inference/provider-reconciliation-orchestrator.ts apps/web/lib/inference/provider-reconciliation-orchestrator.test.ts
git commit -m "feat(ai): add provider reconciliation orchestrator core"
```

## Chunk 2: Wire Automatic Triggers

### Task 2: Add failing tests for OAuth and provider-test triggers

**Files:**
- Modify: `apps/web/lib/govern/provider-oauth.test.ts`
- Modify: `apps/web/lib/actions/ai-providers.test.ts`
- Modify: `apps/web/lib/govern/provider-oauth.ts`
- Modify: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Add a failing OAuth test for automatic full reconciliation**

Extend `provider-oauth.test.ts` to assert that successful OAuth completion triggers the new orchestrator for:

- the primary provider
- any linked sibling provider (`codex` / `chatgpt`)

Expected failure before implementation:

- previous tests may only see `autoDiscoverAndProfile()`, not the full orchestrator

- [ ] **Step 2: Add a failing admin action test for `Test connection`**

Extend `ai-providers.test.ts` to assert that a successful `testProviderAuth(providerId)` triggers the shared orchestrator, not just discovery/profile.

- [ ] **Step 3: Run the affected tests and verify red**

Run:

```bash
pnpm --filter web exec vitest run lib/govern/provider-oauth.test.ts lib/actions/ai-providers.test.ts
```

Expected:

- FAIL for missing orchestrator calls

- [ ] **Step 4: Wire OAuth completion to the orchestrator**

Update `apps/web/lib/govern/provider-oauth.ts` so successful OAuth completion:

- still preserves the fast path for token storage,
- then calls the shared orchestrator in fire-and-forget or awaited mode as appropriate,
- does the same for any linked sibling provider.

- [ ] **Step 5: Wire provider test/configure paths to the orchestrator**

Update `apps/web/lib/actions/ai-providers.ts` so successful provider test/configuration paths call the shared orchestrator rather than only `autoDiscoverAndProfile()`.

- [ ] **Step 6: Re-run the affected tests**

Run:

```bash
pnpm --filter web exec vitest run lib/govern/provider-oauth.test.ts lib/actions/ai-providers.test.ts
```

Expected:

- PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/govern/provider-oauth.ts apps/web/lib/govern/provider-oauth.test.ts apps/web/lib/actions/ai-providers.ts apps/web/lib/actions/ai-providers.test.ts
git commit -m "feat(ai): trigger full provider reconciliation on auth and test"
```

## Chunk 3: Add Startup and Provider-Page Automation

### Task 3: Write failing tests for startup/provider-page reconciliation

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`
- Modify: `apps/web/lib/actions/ai-providers.test.ts`
- Modify: `packages/db/src/seed.ts` only if a new scheduled job default is required

- [ ] **Step 1: Add a failing test for stale provider-page reconciliation**

Add a test that expects the provider page load path to trigger reconciliation for configured providers when:

- last reconciliation is missing,
- provider state is stale,
- or the provider is already flagged failing/action-required.

- [ ] **Step 2: Decide whether startup should be page-load-driven or job-driven**

Use the existing platform pattern:

- server component page-load trigger for immediate admin visibility
- scheduled job for recurring background runs

Do not invent a parallel startup mechanism if page-load plus scheduled job already covers the requirement.

- [ ] **Step 3: Implement the minimal provider-page/startup trigger**

Update `apps/web/app/(shell)/platform/ai/providers/page.tsx` and related action helpers so the provider page can invoke the orchestrator when due.

If a scheduled job default is required:

- add it in `packages/db/src/seed.ts`
- keep the seed change limited to bootstrap job creation

- [ ] **Step 4: Re-run the affected test**

Run:

```bash
pnpm --filter web exec vitest run lib/actions/ai-providers.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/providers/page.tsx apps/web/lib/actions/ai-providers.test.ts packages/db/src/seed.ts
git commit -m "feat(ai): auto-reconcile providers on startup-facing load"
```

## Chunk 4: Persist Advisories and Status

### Task 4: Write failing tests for operator-visible failure state

**Files:**
- Modify: `apps/web/components/platform/ProviderDetailForm.tsx`
- Modify: `apps/web/components/platform/ProviderDetailForm.test.tsx`
- Modify: `apps/web/components/monitoring/CoworkerHealthStatus.tsx`
- Modify: `apps/web/components/monitoring/CoworkerHealthStatus.test.tsx`
- Modify: `packages/db/prisma/schema.prisma` only if needed

- [ ] **Step 1: Add a failing provider-detail test**

Add a test for `ProviderDetailForm` that expects:

- `Healthy`
- `Reconciling`
- `Degraded`
- `Action required`

to display with:

- short reason text
- last reconciliation timestamp
- next recommended action

- [ ] **Step 2: Add a failing coworker-health test**

Add a test that expects the coworker health surface to distinguish:

- provider action required
- degraded but fallback available
- no usable provider

instead of flattening everything into generic “unavailable.”

- [ ] **Step 3: Implement the minimal status/advisory display**

Update the components so they consume reconciled provider state and any existing advisory storage.

Only add DB fields if current structures cannot represent:

- last reconciliation timestamp
- current provider operational status
- failure class / recommended action

If a schema change is truly required:

- add a migration with inline data/backfill SQL as needed
- verify it applies cleanly

- [ ] **Step 4: Re-run the UI tests**

Run:

```bash
pnpm --filter web exec vitest run components/platform/ProviderDetailForm.test.tsx components/monitoring/CoworkerHealthStatus.test.tsx
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/platform/ProviderDetailForm.tsx apps/web/components/platform/ProviderDetailForm.test.tsx apps/web/components/monitoring/CoworkerHealthStatus.tsx apps/web/components/monitoring/CoworkerHealthStatus.test.tsx packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(ai): surface reconciled provider status and advisories"
```

## Chunk 5: Unify Manual Controls and Runtime Failure Hooks

### Task 5: Write failing tests for manual/full reconciliation and runtime-triggered repair

**Files:**
- Modify: `apps/web/lib/routing/fallback.test.ts`
- Modify: `apps/web/lib/routing/fallback.ts`
- Modify: `apps/web/components/platform/ProviderDetailForm.tsx`
- Modify: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Add a failing fallback test for orchestrator invocation**

Extend `fallback.test.ts` so unsupported-parameter or model-drift failures trigger the shared orchestrator rather than piecemeal repair.

- [ ] **Step 2: Add a failing provider-detail/manual-control test**

Add or extend tests so `Run full reconciliation` invokes the shared orchestrator and reports progress/result cleanly.

- [ ] **Step 3: Run the affected tests and verify red**

Run:

```bash
pnpm --filter web exec vitest run lib/routing/fallback.test.ts components/platform/ProviderDetailForm.test.tsx
```

Expected:

- FAIL because the shared manual/full-reconciliation path is not yet wired

- [ ] **Step 4: Implement unified manual and runtime hooks**

Update:

- `apps/web/lib/routing/fallback.ts`
- `apps/web/lib/actions/ai-providers.ts`
- `apps/web/components/platform/ProviderDetailForm.tsx`

so:

- runtime drift/failure hooks call the orchestrator
- manual controls call the same orchestrator
- status reporting is consistent across automatic and manual runs

- [ ] **Step 5: Re-run the affected tests**

Run:

```bash
pnpm --filter web exec vitest run lib/routing/fallback.test.ts components/platform/ProviderDetailForm.test.tsx
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/routing/fallback.ts apps/web/lib/routing/fallback.test.ts apps/web/lib/actions/ai-providers.ts apps/web/components/platform/ProviderDetailForm.tsx apps/web/components/platform/ProviderDetailForm.test.tsx
git commit -m "feat(ai): unify manual and automatic provider reconciliation"
```

## Chunk 6: Verification Gate

### Task 6: Run the affected suite and production build

**Files:**
- Verify only unless failures require targeted fixes

- [ ] **Step 1: Run the affected Vitest suite**

Run:

```bash
pnpm --filter web exec vitest run \
  lib/inference/provider-reconciliation-orchestrator.test.ts \
  lib/govern/provider-oauth.test.ts \
  lib/actions/ai-providers.test.ts \
  lib/routing/fallback.test.ts \
  lib/routing/adapter-registry.test.ts \
  lib/routing/responses-adapter.test.ts \
  components/platform/ProviderDetailForm.test.tsx \
  components/monitoring/CoworkerHealthStatus.test.tsx
```

Expected:

- all tests PASS

- [ ] **Step 2: Run TypeScript verification**

Run:

```bash
pnpm --filter web exec tsc --noEmit
```

Expected:

- PASS

- [ ] **Step 3: Run the production build gate**

Run:

```bash
pnpm --filter web exec next build
```

Expected:

- build succeeds with zero errors

- [ ] **Step 4: Perform a manual runtime sanity checklist**

Record concise results for:

- startup after rebuild with configured Codex/ChatGPT
- provider page shows reconciled status automatically
- stale known-catalog rows self-heal without manual repair clicks
- a billing/scope/provider failure yields visible remediation guidance
- Build Studio no longer depends on the user remembering the repair sequence

- [ ] **Step 5: Commit any final fixes**

```bash
git add <affected-files>
git commit -m "fix(ai): complete provider reconciliation automation"
```

---

## Notes for the Implementer

- Prefer reusing `autoDiscoverAndProfile()`, `backfillModelCards()`, and `seedAllRecipes()` over copying their logic into new call sites.
- Keep the orchestrator thin and procedural; the goal is one shared lifecycle, not a second provider framework.
- Preserve manual buttons because they are valuable for debugging, but make them wrappers around the same orchestration flow.
- Be conservative about schema changes. Only add persistence if existing provider/advisory fields cannot represent the needed state.
- Avoid expensive or noisy probing loops. Use due/staleness checks and backoff.
- Keep the messaging specific. “Action required” should always have a concrete cause and next step.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-05-provider-reconciliation-automation.md`. Ready to execute?
