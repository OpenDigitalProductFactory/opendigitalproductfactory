# Provider Activation Routing Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly activated provider models immediately routable, add `gpt-5-codex` to the known/seeded Codex catalog, and keep routing aligned when provider model catalogs or invocation interfaces drift.

**Architecture:** Implement this in three layers. First, normalize the Codex known-model catalog and seed data so Codex-family models use canonical routing metadata. Second, update routing eligibility and Build Studio defaults so `code`-class models can actually win where they should. Third, add a small provider-reconciliation helper that reacts to runtime provider drift signals and re-runs catalog/profile reconciliation instead of leaving stale models falsely eligible.

**Tech Stack:** Next.js server/runtime TypeScript, Prisma model profiles, Vitest, Next.js production build

---

## File Structure

### Files to modify

- `apps/web/lib/routing/known-provider-models.ts`
  Responsibility: source-of-truth runtime catalog for non-discoverable providers such as `codex` and `chatgpt`.

- `packages/db/src/seed.ts`
  Responsibility: bootstrap/default known models written during first-run seed; must stay consistent with runtime known-model catalog.

- `apps/web/lib/auto-discover.test.ts`
  Responsibility: regression coverage for known non-discoverable provider catalogs.

- `apps/web/lib/routing/pipeline-v2.ts`
  Responsibility: hard eligibility filter for routing.

- `apps/web/lib/routing/pipeline-v2.test.ts`
  Responsibility: unit coverage for routing eligibility behavior.

- `apps/web/lib/tak/agent-routing.ts`
  Responsibility: default coworker route-to-agent model preferences.

- `apps/web/lib/tak/agent-routing.test.ts`
  Responsibility: route agent defaults and route-derived model requirements.

- `apps/web/lib/routing/fallback.ts`
  Responsibility: runtime fallback behavior after provider/model execution failures.

- `apps/web/lib/routing/fallback.test.ts`
  Responsibility: regression coverage for runtime retire/degrade/fallback behavior.

### Files to create

- `apps/web/lib/inference/provider-reconciliation.ts`
  Responsibility: focused helper for provider-drift detection and reconciliation trigger decisions so those heuristics do not spread through fallback and activation code.

- `apps/web/lib/inference/provider-reconciliation.test.ts`
  Responsibility: unit tests for runtime provider-drift heuristics.

---

## Chunk 1: Canonicalize Codex Runtime Catalog

### Task 1: Write failing catalog tests for canonical Codex metadata

**Files:**
- Modify: `apps/web/lib/auto-discover.test.ts`
- Reference: `apps/web/lib/routing/known-provider-models.ts`
- Reference: `packages/db/src/seed.ts`

- [ ] **Step 1: Extend the existing catalog test to describe the desired Codex state**

Add failing assertions that:

- `KNOWN_PROVIDER_MODELS.codex` contains `gpt-5-codex`
- `KNOWN_PROVIDER_MODELS.codex` keeps `codex-mini-latest`
- both Codex entries use `modelClass: "code"`
- `gpt-5-codex` is the stronger Codex option

Example test shape:

```ts
it("codex catalog uses canonical code model class and includes GPT-5-Codex", () => {
  const codexModels = KNOWN_PROVIDER_MODELS.codex.map((m) => m.modelId);
  expect(codexModels).toContain("codex-mini-latest");
  expect(codexModels).toContain("gpt-5-codex");
  for (const model of KNOWN_PROVIDER_MODELS.codex) {
    expect(model.modelClass).toBe("code");
  }
});
```

- [ ] **Step 2: Run the targeted test to verify it fails for the right reason**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/auto-discover.test.ts
```

Expected:

- FAIL because the current catalog does not yet include `gpt-5-codex`
- FAIL because `codex-mini-latest` is still marked `"agent"`

- [ ] **Step 3: Update the runtime known-model catalog**

Modify `apps/web/lib/routing/known-provider-models.ts` to:

- change `codex-mini-latest` from `modelClass: "agent"` to `modelClass: "code"`
- add `gpt-5-codex`
- give `gpt-5-codex` stronger coding/reasoning scores than `codex-mini-latest`
- keep both entries tool-capable and structured-output-capable

Use current OpenAI docs as the source for:

- model ID
- context/output limits
- modality support
- tool/structured-output support

Keep the catalog canonical:

- no `"agent"` class values
- only model classes accepted by `ModelClass`

- [ ] **Step 4: Update bootstrap seed parity**

Modify `packages/db/src/seed.ts` so `seedCodexModels()` matches the runtime catalog:

- add `gpt-5-codex`
- switch Codex family entries to `modelClass: "code"`
- keep prices/tiers/score intent aligned with the runtime catalog

Do not change unrelated provider seeds.

- [ ] **Step 5: Re-run the catalog test and keep it green**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/auto-discover.test.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/routing/known-provider-models.ts packages/db/src/seed.ts apps/web/lib/auto-discover.test.ts
git commit -m "feat(routing): canonicalize Codex catalog and add gpt-5-codex"
```

---

## Chunk 2: Make Codex Actually Eligible For The Right Routes

### Task 2: Write failing routing tests for `code` model eligibility

**Files:**
- Modify: `apps/web/lib/routing/pipeline-v2.test.ts`
- Reference: `apps/web/lib/routing/pipeline-v2.ts`

- [ ] **Step 1: Add failing tests that capture the current routing bug**

Add tests that assert:

- a `code`-class endpoint is eligible by default for coding-style routes instead of being filtered out as non-chat
- `unknown` / generic sync routes no longer hard-exclude `code`-class endpoints when no stricter class is required

Example shapes:

```ts
it("allows code-class endpoints in the default general-purpose eligibility set", () => {
  const codeEndpoint = makeEndpoint({ modelClass: "code" });
  const contract = makeContract({ taskType: "unknown" });
  expect(getExclusionReasonV2(codeEndpoint, contract)).toBeNull();
});

it("does not exclude code-class endpoints for coding-oriented requests", () => {
  const codeEndpoint = makeEndpoint({ modelClass: "code" });
  const contract = makeContract({ taskType: "code-gen" });
  expect(getExclusionReasonV2(codeEndpoint, contract)).toBeNull();
});
```

- [ ] **Step 2: Run the targeted routing test and verify red**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/pipeline-v2.test.ts
```

Expected:

- FAIL because the default filter currently allows only `chat` / `reasoning`

- [ ] **Step 3: Update routing hard-filter logic**

Modify `apps/web/lib/routing/pipeline-v2.ts` so the default no-`requiredModelClass` path accepts:

- `chat`
- `reasoning`
- `code`

Keep exact matching behavior when `requiredModelClass` is explicitly set.

This is the least invasive fix because it:

- preserves the contract-based router
- makes Codex-family models eligible
- still lets ranking choose the best candidate by task dimensions and cost

- [ ] **Step 4: Re-run the routing test**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/pipeline-v2.test.ts
```

Expected:

- PASS

### Task 3: Write failing Build Studio preference test

**Files:**
- Modify: `apps/web/lib/tak/agent-routing.test.ts`
- Modify: `apps/web/lib/tak/agent-routing.ts`

- [ ] **Step 1: Add a failing test for Build Studio's default Codex preference**

Add a test asserting `/build` resolves to model requirements that prefer the Codex provider by default:

```ts
it("prefers codex for the build route by default", () => {
  const result = resolveAgentForRoute("/build", superuser);
  expect(result.modelRequirements?.preferredProviderId).toBe("codex");
});
```

- [ ] **Step 2: Run the route-agent test and verify red**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/tak/agent-routing.test.ts
```

Expected:

- FAIL because `/build` does not yet declare a Codex preference

- [ ] **Step 3: Add the default Build Studio Codex preference**

Modify `apps/web/lib/tak/agent-routing.ts` so the `/build` route model requirements include:

- `preferredProviderId: "codex"`
- keep the existing frontier / quality-first posture

Do not add this preference to generic coworker routes.

This gives Build Studio Codex-first behavior while still allowing runtime fallback if Codex is missing or excluded.

- [ ] **Step 4: Re-run the route-agent test**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/tak/agent-routing.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/pipeline-v2.ts apps/web/lib/routing/pipeline-v2.test.ts apps/web/lib/tak/agent-routing.ts apps/web/lib/tak/agent-routing.test.ts
git commit -m "feat(routing): admit code models and prefer codex for build"
```

---

## Chunk 3: Reconcile Runtime Provider Drift

### Task 4: Create provider-drift decision helper with failing tests first

**Files:**
- Create: `apps/web/lib/inference/provider-reconciliation.ts`
- Create: `apps/web/lib/inference/provider-reconciliation.test.ts`

- [ ] **Step 1: Write failing tests for runtime reconciliation triggers**

Create `apps/web/lib/inference/provider-reconciliation.test.ts` with cases like:

- `model_not_found` should request reconciliation
- unsupported parameter / unsupported tool / invalid request shape should request reconciliation
- auth failures should not request catalog reconciliation
- plain network failures should not request catalog reconciliation

Example shape:

```ts
import { describe, expect, it } from "vitest";
import { shouldReconcileProviderAfterError } from "./provider-reconciliation";

describe("shouldReconcileProviderAfterError", () => {
  it("returns true for model_not_found", () => {
    expect(
      shouldReconcileProviderAfterError("model_not_found", "Model not found"),
    ).toBe(true);
  });

  it("returns true for unsupported parameter drift", () => {
    expect(
      shouldReconcileProviderAfterError("provider_error", "Unsupported parameter: reasoning_effort"),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new test file and verify red**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/inference/provider-reconciliation.test.ts
```

Expected:

- FAIL because the helper does not exist yet

- [ ] **Step 3: Implement the helper**

Create `apps/web/lib/inference/provider-reconciliation.ts` with:

- `shouldReconcileProviderAfterError(code: string, message: string): boolean`
- `shouldDegradeModelForInterfaceDrift(code: string, message: string): boolean`

Keep the heuristic small and explicit. Match phrases such as:

- `unsupported parameter`
- `unknown parameter`
- `tool_choice`
- `response_format`
- `structured output`
- `function calling`
- `not supported`

Do not embed DB writes in this helper. It should only make decisions.

- [ ] **Step 4: Re-run the helper test**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/inference/provider-reconciliation.test.ts
```

Expected:

- PASS

### Task 5: Write failing fallback reconciliation test

**Files:**
- Modify: `apps/web/lib/routing/fallback.test.ts`
- Modify: `apps/web/lib/routing/fallback.ts`
- Reference: `apps/web/lib/inference/ai-provider-internals.ts`

- [ ] **Step 1: Add a failing test for interface-drift reconciliation**

Add a test proving that a provider-error caused by interface drift:

- degrades the model
- triggers a background provider reconciliation refresh

Mock the new helper and `autoDiscoverAndProfile()` so the test can assert both calls.

Example shape:

```ts
it("degrades and reconciles a model after interface drift", async () => {
  // provider_error with unsupported parameter text
  // expect modelProfile.updateMany(... modelStatus: "degraded")
  // expect autoDiscoverAndProfile("prov1") toHaveBeenCalled()
});
```

- [ ] **Step 2: Run the fallback test and verify red**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/fallback.test.ts
```

Expected:

- FAIL because fallback does not yet reconcile after provider drift signals

- [ ] **Step 3: Implement reconciliation in fallback**

Modify `apps/web/lib/routing/fallback.ts` to:

- import the new helper
- import `autoDiscoverAndProfile`
- on `provider_error`, inspect the message
- if the helper says this looks like interface drift:
  - degrade the specific model
  - fire-and-forget `autoDiscoverAndProfile(entry.providerId)`
  - continue fallback routing

Do not disable the whole provider for interface drift.
Do not change the existing `model_not_found` retirement behavior.

- [ ] **Step 4: Re-run fallback tests**

Run:

```bash
pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/fallback.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inference/provider-reconciliation.ts apps/web/lib/inference/provider-reconciliation.test.ts apps/web/lib/routing/fallback.ts apps/web/lib/routing/fallback.test.ts
git commit -m "feat(routing): reconcile provider drift after runtime failures"
```

---

## Chunk 4: Verification Gate

### Task 6: Run the affected test suite and production build

**Files:**
- Verify only; no file edits expected unless failures appear

- [ ] **Step 1: Run the targeted affected tests together**

Run:

```bash
pnpm --filter @dpf/web exec vitest run \
  apps/web/lib/auto-discover.test.ts \
  apps/web/lib/routing/pipeline-v2.test.ts \
  apps/web/lib/tak/agent-routing.test.ts \
  apps/web/lib/inference/provider-reconciliation.test.ts \
  apps/web/lib/routing/fallback.test.ts
```

Expected:

- all tests PASS

- [ ] **Step 2: Run any additional failing affected tests if the targeted run exposes breakage**

If any neighboring tests fail, fix them before proceeding. Do not defer breakage caused by this work.

- [ ] **Step 3: Run the production build gate**

Run:

```bash
cd apps/web
npx next build
```

Expected:

- build succeeds with zero errors

- [ ] **Step 4: Commit the final verification fixes if needed**

```bash
git add <affected-files>
git commit -m "fix(routing): complete provider activation routing reconciliation"
```

---

## Notes for the Implementer

- Keep the change set focused on runtime reconciliation and routing eligibility. Do not redesign provider management UI in this pass.
- Preserve local-model fallback behavior; the goal is to stop it masking eligible cloud models, not to remove it.
- Do not invent a new model class. Use canonical `ModelClass` values only.
- Treat Build Studio specially through default preference, not through a global hard override.
- If `gpt-5-codex` turns out to require a different execution path in practice, keep the catalog entry but document that as a follow-up adapter/recipe issue instead of blocking the catalog normalization work.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-04-provider-activation-routing-reconciliation.md`. Ready to execute?
