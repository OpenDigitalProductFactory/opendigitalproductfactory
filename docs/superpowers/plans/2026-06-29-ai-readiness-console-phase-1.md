# AI Readiness Console Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only AI Readiness Console at `/platform/ai/readiness` that gives operators one compact answer for model supply, build execution, tool access, and routing confidence.

**Architecture:** Implement a pure server-side read model that composes existing readiness sources instead of adding a new table: provider routing eligibility, Build Studio dispatch config and `BuildEngineState`, contributor MCP readiness, and `resolveModelSelectionByPhase()`. Render the result through focused platform components using DPF theme tokens and link diagnostics to existing provider, build-studio, token, and runtime-health surfaces.

**Tech Stack:** Next.js 16 App Router, React server/client components, Prisma via `@dpf/db`, Vitest, Testing Library, DPF `SectionNav`/platform navigation, lucide-react icons.

---

## Chunk 1: Read Model

### Task 1: Define Readiness Summary Types And State Precedence

**Files:**
- Create: `apps/web/lib/ai-readiness/readiness-summary.ts`
- Test: `apps/web/lib/ai-readiness/readiness-summary.test.ts`

- [x] **Step 1: Write failing tests for summary state precedence**

Create `apps/web/lib/ai-readiness/readiness-summary.test.ts` with tests for:
- `summarizeAiReadinessState()` returns `blocked` if any domain is blocked.
- It returns `attention` if no domain is blocked and at least one domain needs attention.
- It returns `ready` only when all non-diagnostic domains are ready.

Run: `pnpm --filter web exec vitest run lib/ai-readiness/readiness-summary.test.ts`
Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement minimal exported types and state helper**

Create `readiness-summary.ts` with:
- `ReadinessState = "ready" | "attention" | "blocked" | "diagnostic"`
- `AiReadinessDomain`
- `AiReadinessSummary`
- `summarizeAiReadinessState(domains)`

Keep this helper pure and exported for tests.

- [x] **Step 3: Run the read-model tests**

Run: `pnpm --filter web exec vitest run lib/ai-readiness/readiness-summary.test.ts`
Expected: PASS.

### Task 2: Project Model Supply Readiness

**Files:**
- Modify: `apps/web/lib/ai-readiness/readiness-summary.ts`
- Test: `apps/web/lib/ai-readiness/readiness-summary.test.ts`

- [x] **Step 1: Write failing tests for model supply projection**

Add tests for pure helper `projectModelSupplyDomain()`:
- Ready when at least one provider eligibility is `routable`, summarizing routable/provider counts.
- Attention when providers exist but only self-recovering or setup-needed states exist.
- Blocked when no provider can route and there are no configured providers.
- A Z.ai-style provider without tool support is still a model-supply provider, not a build engine.

Run: `pnpm --filter web exec vitest run lib/ai-readiness/readiness-summary.test.ts`
Expected: FAIL because the helper is missing.

- [x] **Step 2: Implement model supply projection**

Add a pure helper that accepts projected provider rows:

```ts
export type AiReadinessProviderInput = {
  providerId: string;
  name: string;
  eligibility: RoutingEligibility;
  supportsToolUse?: boolean;
};
```

The helper should not query the DB. The top-level loader will map live provider data into this shape.

- [x] **Step 3: Run the read-model tests**

Run: `pnpm --filter web exec vitest run lib/ai-readiness/readiness-summary.test.ts`
Expected: PASS.

### Task 3: Project Build Execution, Tool Access, And Routing Confidence

**Files:**
- Modify: `apps/web/lib/ai-readiness/readiness-summary.ts`
- Test: `apps/web/lib/ai-readiness/readiness-summary.test.ts`

- [x] **Step 1: Write failing tests for the remaining domains**

Add tests for pure helpers:
- `projectBuildExecutionDomain()` ready when selected engine has a healthy or configured path, attention when selected engine state is unknown or fallback-selected, blocked when selected engine is absent and no fallback exists.
- `projectToolAccessDomain()` maps contributor MCP statuses to ready/attention/blocked and exactly one primary action.
- `projectRoutingConfidenceDomain()` blocks on runtime-health error flags, attention on warning/info flags, and ready when phase preview has no flags.

Run: `pnpm --filter web exec vitest run lib/ai-readiness/readiness-summary.test.ts`
Expected: FAIL because the helpers are missing.

- [x] **Step 2: Implement the pure domain helpers**

Keep copy short and outcome-oriented. Each blocked domain must set one `blocker` with `primaryActionLabel` and optional `href`.

- [x] **Step 3: Add the top-level loader**

Add `getAiReadinessSummary(userId?: string)` that:
- Loads providers using existing provider data.
- Derives provider eligibility with `deriveRoutingEligibility()`.
- Loads Build Studio config and `BuildEngineState`.
- Loads contributor MCP readiness without an automatic live probe.
- Calls `resolveModelSelectionByPhase()`.
- Returns `AiReadinessSummary`.

Do not add new DB tables or mutating automation in Phase 1.

- [x] **Step 4: Run read-model tests**

Run: `pnpm --filter web exec vitest run lib/ai-readiness/readiness-summary.test.ts`
Expected: PASS.

## Chunk 2: Console UI And Navigation

### Task 4: Build Compact Readiness Components

**Files:**
- Create: `apps/web/components/platform/AiReadinessSummaryPanel.tsx`
- Create: `apps/web/components/platform/AiReadinessSummaryPanel.test.tsx`

- [x] **Step 1: Write failing component tests**

Test that the panel:
- Renders the overall verdict.
- Renders exactly four domain rows.
- Shows one primary action for a blocked domain.
- Links diagnostics to existing AI pages.

Run: `pnpm --filter web exec vitest run components/platform/AiReadinessSummaryPanel.test.tsx`
Expected: FAIL because the component does not exist.

- [x] **Step 2: Implement the panel and row components**

Use stable compact rows with `lucide-react` icons, DPF CSS variables, and no nested cards. Use action links/buttons only from read-model data. Keep raw model IDs and eval counts out of default rows except in diagnostics/evidence text already supplied by the read model.

- [x] **Step 3: Run the component tests**

Run: `pnpm --filter web exec vitest run components/platform/AiReadinessSummaryPanel.test.tsx`
Expected: PASS.

### Task 5: Add The Readiness Route And AI Navigation Entry

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/readiness/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/readiness/page.test.tsx`
- Modify: `apps/web/components/platform/platform-nav.ts`
- Modify: `apps/web/components/platform/WorkforceTabNav.tsx`
- Modify: `apps/web/components/platform/PlatformTabNav.test.tsx`

- [x] **Step 1: Write failing route/nav tests**

Tests should assert:
- `/platform/ai/readiness` renders the readiness console shell.
- AI platform nav includes `Readiness` as the first AI sub-item.
- `/platform/ai` resolves to readiness.
- Workforce tab nav includes `Readiness` without adding an `Overview` peer.

Run: `pnpm --filter web exec vitest run app/(shell)/platform/ai/readiness/page.test.tsx components/platform/PlatformTabNav.test.tsx`
Expected: FAIL because the route/nav entry is missing.

- [x] **Step 2: Implement the route**

The server page should call `auth()`, pass `session?.user.id` to `getAiReadinessSummary()`, catch loader errors into a blocked/diagnostic console state, and render `AiReadinessSummaryPanel`.

- [x] **Step 3: Update navigation**

Make `Readiness` the AI Operations front door. Remove the `Overview` peer from the AI sub-nav, redirect `/platform/ai` to `/platform/ai/readiness`, and preserve the coworker directory as the `/platform/ai/overview` drilldown.

- [x] **Step 4: Run route/nav tests**

Run: `pnpm --filter web exec vitest run app/(shell)/platform/ai/readiness/page.test.tsx components/platform/PlatformTabNav.test.tsx`
Expected: PASS.

### Task 6: Link Adjacent AI Surfaces To Readiness

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/runtime-health/page.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`
- Modify tests only where existing page tests need copy/link updates.

- [x] **Step 1: Write failing tests or source assertions for cross-links**

Add/update tests so runtime health, providers, and Build Studio expose a link to `/platform/ai/readiness`.

Run focused tests for touched pages.
Expected: FAIL before the links are added.

- [x] **Step 2: Add concise readiness links**

Place a secondary link in each page header. Do not duplicate the readiness summary inside those pages.

- [x] **Step 3: Run focused page tests**

Run the focused tests for touched pages.
Expected: PASS.

### Task 6a: Project Readiness Blockers Into Needs You

**Files:**
- Create: `apps/web/lib/ai-readiness/attention.ts`
- Create: `apps/web/lib/ai-readiness/attention.test.ts`
- Modify: `apps/web/lib/attention/types.ts`
- Modify: `apps/web/lib/attention/aggregate.ts`
- Modify: `apps/web/components/attention/AttentionInbox.tsx`
- Modify: `apps/web/components/attention/NeedsYouBand.tsx`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`
- Modify: `apps/web/app/(shell)/workspace/inbox/page.tsx`

- [x] **Step 1: Write failing attention projection tests**

Test that blocked readiness domains produce one `ai-readiness-blocker` attention item and non-blocking attention/diagnostic work does not.

- [x] **Step 2: Implement the pure projector and aggregate source**

Add the new attention source, map blocked `AiReadinessSummary` domains into `AttentionItem[]`, and pass the authenticated user id from workspace surfaces so user-scoped MCP readiness is not fabricated.

- [x] **Step 3: Run affected attention tests**

Run:
`pnpm --filter web exec vitest run lib/ai-readiness/attention.test.ts lib/attention/aggregate.test.ts components/attention/AttentionInbox.test.tsx components/attention/NeedsYouBand.test.tsx`

Expected: PASS.

## Chunk 3: Verification And Closeout

### Task 7: Source-Local Verification

**Files:**
- Verify all touched files.

- [x] **Step 1: Run focused readiness tests**

Run:
`pnpm --filter web exec vitest run lib/ai-readiness/readiness-summary.test.ts components/platform/AiReadinessSummaryPanel.test.tsx app/(shell)/platform/ai/readiness/page.test.tsx`

Expected: PASS.

- [x] **Step 2: Run broader affected tests**

Run:
`pnpm --filter web exec vitest run components/platform/PlatformTabNav.test.tsx app/(shell)/platform/ai/providers/page.test.tsx app/(shell)/platform/ai/build-studio/page.test.tsx`

Expected: PASS, or document absent tests and cover via focused source assertions.

- [x] **Step 3: Run typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 4: Run production build**

Run: `$env:NODE_OPTIONS='--max-old-space-size=8192'; pnpm --filter web build`
Expected: PASS.

- [x] **Step 5: Run diff check**

Run:
- `git diff --check`

Expected: PASS.

### Task 8: Runtime UX Verification And PR

**Files:**
- Verify `/platform/ai/readiness` in governed runtime if available.

- [x] **Step 1: Run live-install preflight or lease-governed contributor preview**

Use the DPF live-install preflight or local-integration-ci lease path required by AGENTS.md. Do not launch an ungated dev server.

- [x] **Step 2: Browser-check the console**

Verify:
- First viewport shows verdict and four readiness rows.
- Exactly one primary action appears for each blocked domain.
- Diagnostics links navigate to existing AI pages.
- Layout is compact and text does not overflow on desktop or mobile viewport.

- [x] **Step 3: Record evidence**

Record evidence on `BI-EFDD78EE` and `WC-25CCCA03`.

- [ ] **Step 4: Commit, push, PR, CI**

Commit with DCO sign-off, push `feat/ai-readiness-console`, open a ready PR after local gates pass, watch CI, fix failures, and merge only after PR health is green.
