# Provider Catalog Reconciler Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a procedural provider catalog reconciler that keeps non-discoverable providers like Codex aligned with official sources and verified runtime probes, without relying on seed data alone.

**Architecture:** Implement a dedicated reconciliation module that classifies providers by catalog strategy, fetches official catalog candidates for supported providers, compares them with the platform's known catalog, and reseeds runtime-discoverable records for verified non-discoverable providers. Wire this through a scheduled job and provider actions using the existing `mcp-catalog-sync` / `scheduledJob` pattern so the system can refresh over time instead of only at install.

**Tech Stack:** Next.js server TypeScript, Prisma, scheduled jobs, provider actions, targeted Vitest, Next.js production build

---

## File Structure

### Files to create

- `apps/web/lib/provider-catalog-reconciliation.ts`
  Responsibility: official-source fetch, provider strategy selection, catalog diffing, and staged runtime reconciliation.

- `apps/web/lib/provider-catalog-reconciliation.test.ts`
  Responsibility: regression coverage for provider strategy selection, OpenAI docs parsing, known-catalog diffing, and safe reconciliation behavior.

### Files to modify

- `apps/web/lib/actions/ai-providers.ts`
  Responsibility: expose manual trigger and due-run helpers; route known-catalog discovery through reconciliation results.

- `apps/web/lib/actions/ai-providers.test.ts`
  Responsibility: verify manual trigger / discovery behavior for non-discoverable providers.

- `apps/web/lib/inference/ai-provider-internals.ts`
  Responsibility: reuse reconciliation for known-catalog providers where activation should seed runtime models and retire stale ones safely.

- `apps/web/lib/inference/ai-provider-data.ts`
  Responsibility: surface the new scheduled job in platform data if needed by the existing providers page.

- `docs/user-guide/ai-workforce/model-routing-lifecycle.md`
  Responsibility: document the new catalog reconciliation path for non-discoverable providers.

---

## Chunk 1: Add the Reconciliation Core

### Task 1: Write the failing reconciliation tests

**Files:**
- Create: `apps/web/lib/provider-catalog-reconciliation.test.ts`
- Reference: `apps/web/lib/routing/known-provider-models.ts`

- [ ] **Step 1: Write tests for strategy selection and catalog diffing**

Cover:
- non-discoverable providers (`codex`, `chatgpt`) use `known_catalog`
- discoverable providers use `provider_api`
- OpenAI-family docs parsing can extract model ids and deprecation hints from official HTML
- reconciliation reports `newCandidates`, `deprecatedCandidates`, and `verifiedSeeded`

- [ ] **Step 2: Run the new file and confirm it fails for missing implementation**

Run:

```bash
pnpm --filter web exec vitest run lib/provider-catalog-reconciliation.test.ts
```

Expected:
- FAIL because the module does not exist yet

- [ ] **Step 3: Implement the reconciliation module minimally**

Create `apps/web/lib/provider-catalog-reconciliation.ts` with:
- provider strategy selection
- official-source fetch for OpenAI-family providers using official docs pages
- HTML parsing for model id presence and deprecation markers
- known-catalog diffing against `KNOWN_PROVIDER_MODELS`
- reconciliation result shape that can be consumed by actions

- [ ] **Step 4: Re-run the test**

Run:

```bash
pnpm --filter web exec vitest run lib/provider-catalog-reconciliation.test.ts
```

Expected:
- PASS

---

## Chunk 2: Wire the Reconciler into Provider Actions

### Task 2: Route known-catalog discovery through reconciliation

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`
- Modify: `apps/web/lib/actions/ai-providers.test.ts`

- [ ] **Step 1: Write/extend failing tests for discovery and manual trigger**

Cover:
- `discoverModels("codex")` returns reconciled seeded counts rather than `0 discovered`
- a manual action can trigger catalog reconciliation for a provider
- safe fallback if official-source fetch fails

- [ ] **Step 2: Run the focused action tests and verify failure**

Run:

```bash
pnpm --filter web exec vitest run lib/actions/ai-providers.test.ts
```

- [ ] **Step 3: Implement the action wiring**

Add:
- `reconcileProviderCatalog(providerId)`
- optional `runProviderCatalogReconciliationIfDue()`
- scheduled job handling parallel to `mcp-catalog-sync`

- [ ] **Step 4: Re-run the focused action tests**

Run:

```bash
pnpm --filter web exec vitest run lib/actions/ai-providers.test.ts
```

Expected:
- PASS

---

## Chunk 3: Integrate Runtime Seeding and Stale-Model Retirement

### Task 3: Reconcile known-catalog runtime state during activation

**Files:**
- Modify: `apps/web/lib/inference/ai-provider-internals.ts`
- Modify: `apps/web/lib/provider-catalog-reconciliation.test.ts`

- [ ] **Step 1: Extend tests to cover stale runtime rows**

Cover:
- known-catalog reconciliation reseeds current models
- stale discovered/profile rows not in the curated catalog are retired or disabled safely
- disabled-by-default models remain out of routing unless explicitly enabled

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --filter web exec vitest run lib/provider-catalog-reconciliation.test.ts
```

- [ ] **Step 3: Implement minimal safe retirement/reseed behavior**

Update activation/reconciliation so:
- known models are re-seeded idempotently
- missing curated entries are retired with a clear reason
- newly documented-but-unverified candidates are not auto-routed

- [ ] **Step 4: Re-run tests**

Run:

```bash
pnpm --filter web exec vitest run lib/provider-catalog-reconciliation.test.ts lib/actions/ai-providers.test.ts
```

Expected:
- PASS

---

## Chunk 4: Verification and Documentation

### Task 4: Document and verify the first slice

**Files:**
- Modify: `docs/user-guide/ai-workforce/model-routing-lifecycle.md`

- [ ] **Step 1: Update the lifecycle doc**

Document:
- provider API discovery vs curated-catalog reconciliation
- official docs as candidate source
- runtime probes as usability gate
- why non-discoverable providers do not use `/v1/models`

- [ ] **Step 2: Run compiler verification**

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
- PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/provider-catalog-reconciliation.ts apps/web/lib/provider-catalog-reconciliation.test.ts apps/web/lib/actions/ai-providers.ts apps/web/lib/actions/ai-providers.test.ts apps/web/lib/inference/ai-provider-internals.ts docs/user-guide/ai-workforce/model-routing-lifecycle.md docs/superpowers/plans/2026-04-04-provider-catalog-reconciler.md
git commit -m "Add provider catalog reconciliation for non-discoverable models"
```
