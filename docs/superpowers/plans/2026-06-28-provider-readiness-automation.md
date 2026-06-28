# Provider Readiness Automation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce cognitive load on AI provider detail pages by replacing manual model/test/eval decisions with a single managed readiness flow and advanced-only diagnostics.

**Architecture:** Keep the existing provider actions as the automation substrate: `configureProvider` already activates providers and runs discovery/profile work, while `testProviderAuth`, `discoverModels`, `profileModels`, and endpoint test jobs remain callable for diagnostic use. Change the UI contract so the normal operator sees connection readiness and automation status; raw model family toggles, search, per-model eval, tier override, and probe/full-test controls move behind advanced diagnostics.

**Tech Stack:** Next.js 16, React Server/Client Components, Vitest, Testing Library server rendering via `renderToStaticMarkup`.

---

## Chunk 1: Provider Detail Simplification

### Task 1: Provider action contract and primary UI

**Files:**
- Modify: `apps/web/components/platform/ProviderDetailForm.tsx`
- Test: `apps/web/components/platform/ProviderDetailForm.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests proving the default provider setup UI exposes one primary managed action and does not expose separate `Save`, `Test & Discover`, `Discover & Profile Models`, or model-family choices outside advanced diagnostics.

- [ ] **Step 2: Run the provider form test and verify it fails**

Run: `pnpm --filter web exec vitest run apps/web/components/platform/ProviderDetailForm.test.tsx`

- [ ] **Step 3: Implement minimal UI changes**

Replace the separate `Save` and `Test & Discover` buttons with one `Save & ready provider` action that persists settings, tests the connection, discovers models, and profiles them. Replace the visible setup stepper with a compact readiness summary. Move model-family controls into an advanced diagnostics disclosure.

- [ ] **Step 4: Run the provider form test and verify it passes**

Run: `pnpm --filter web exec vitest run apps/web/components/platform/ProviderDetailForm.test.tsx`

### Task 2: Model list as evidence

**Files:**
- Modify: `apps/web/components/platform/ModelSection.tsx`
- Modify: `apps/web/components/platform/ModelCard.tsx`
- Test: `apps/web/components/platform/ModelSection.test.tsx`
- Test: `apps/web/components/platform/ModelCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests proving the default model section shows readiness counts without search, per-model eval, or tier override controls. Add tests proving routing scores and manual model controls appear only when `showDiagnostics` is true.

- [ ] **Step 2: Run model tests and verify they fail**

Run: `pnpm --filter web exec vitest run apps/web/components/platform/ModelSection.test.tsx apps/web/components/platform/ModelCard.test.tsx`

- [ ] **Step 3: Implement minimal UI changes**

Add a `showDiagnostics` prop to `ModelSection` and `ModelCard`. Default normal mode renders compact model cards with tier, class, pricing, and capabilities. Diagnostics mode keeps search, pagination, routing scores, per-model eval, and tier override.

- [ ] **Step 4: Run model tests and verify they pass**

Run: `pnpm --filter web exec vitest run apps/web/components/platform/ModelSection.test.tsx apps/web/components/platform/ModelCard.test.tsx`

### Task 3: Endpoint performance diagnostics

**Files:**
- Modify: `apps/web/components/platform/EndpointPerformancePanel.tsx`
- Test: `apps/web/components/platform/EndpointPerformancePanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests proving `Run Probes` and `Run Full Tests` are hidden by default and visible only inside advanced diagnostics.

- [ ] **Step 2: Run endpoint panel tests and verify they fail**

Run: `pnpm --filter web exec vitest run apps/web/components/platform/EndpointPerformancePanel.test.tsx`

- [ ] **Step 3: Implement minimal UI changes**

Move probe/full-test buttons and explanatory test-running copy into a diagnostics disclosure. Keep read-only performance/evaluation/test-run history visible.

- [ ] **Step 4: Run endpoint panel tests and verify they pass**

Run: `pnpm --filter web exec vitest run apps/web/components/platform/EndpointPerformancePanel.test.tsx`

## Chunk 2: Verification

- [ ] Run focused component/action tests:

`pnpm --filter web exec vitest run apps/web/components/platform/ProviderDetailForm.test.tsx apps/web/components/platform/ModelSection.test.tsx apps/web/components/platform/ModelCard.test.tsx apps/web/components/platform/EndpointPerformancePanel.test.tsx apps/web/lib/actions/ai-providers.test.ts`

- [ ] Run production build:

`pnpm --filter web build`

- [ ] If runtime UX verification is available through a governed preview or local-CI lease, verify `/platform/ai/providers/[providerId]` default mode no longer asks the operator to choose save/test/discover/profile/eval/probe actions.
