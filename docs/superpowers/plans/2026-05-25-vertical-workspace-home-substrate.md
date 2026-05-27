# Vertical Workspace Home Substrate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable workspace-home substrate that resolves the worker home from `StorefrontConfig -> StorefrontArchetype`, exposes setup-time activation summaries, and keeps the existing platform workspace as the fallback.

**Architecture:** Add a new `apps/web/lib/workspace-home/` boundary for typed contributions, resolver logic, primitive/component registries, and setup activation summaries. Extract the current `/workspace` command-center screen into reusable platform-home loader and component files, then make the route a thin authenticated resolver/render shell. The first production vertical renderer remains out of scope for this BI; Dale HVAC lands in `BI-CE6AF925` using this substrate.

**Tech Stack:** Next.js 16 App Router, React server/client components, Vitest, Prisma client, DPF theme CSS variables.

---

## File Structure

- Create `apps/web/lib/workspace-home/types.ts`
  - Owns typed contribution, slot, primitive, component, setup activation, resolver, and loader contracts.
- Create `apps/web/lib/workspace-home/registry.ts`
  - Owns contribution validation, exact semantic matching, category fallback, component key validation, and the platform fallback registry boundary.
- Create `apps/web/lib/workspace-home/activation-summary.ts`
  - Builds setup-callable summaries from archetype data and contribution metadata without rendering `/workspace`.
- Create `apps/web/lib/workspace-home/platform-loader.ts`
  - Moves current workspace page data loading out of the route and into a reusable service.
- Create `apps/web/lib/workspace-home/index.ts`
  - Small export barrel for the new substrate.
- Create `apps/web/components/workspace-home/PlatformWorkspaceHome.tsx`
  - Extracts the existing platform operator workspace presentation intact.
- Create `apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.tsx`
  - Honest, theme-aware setup notice rendered above platform fallback when no vertical home is configured.
- Modify `apps/web/app/(shell)/workspace/page.tsx`
  - Keep auth/redirect; load platform data; resolve workspace home; render unconfigured notice plus platform fallback.
- Modify `apps/web/app/(shell)/storefront/setup/page.tsx`
  - Pass setup activation summaries for each archetype into `SetupWizard`.
- Modify `apps/web/components/storefront-admin/SetupWizard.tsx`
  - Carry optional workspace-home activation summary through archetype selection.
- Modify `apps/web/components/storefront-admin/ArchetypeActivationSummary.tsx`
  - Render a compact worker-home setup summary next to existing capability/billing activation.
- Add tests:
  - `apps/web/lib/workspace-home/registry.test.ts`
  - `apps/web/lib/workspace-home/activation-summary.test.ts`
  - `apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx`
  - Update `apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx`
  - Update `apps/web/app/(shell)/workspace/page.test.tsx`

## Chunk 1: Resolver, Registry, and Activation Summary

### Task 1: Define the workspace-home contribution contract

**Files:**
- Create: `apps/web/lib/workspace-home/types.ts`
- Test: `apps/web/lib/workspace-home/registry.test.ts`

- [ ] **Step 1: Write failing contribution validation tests**

Add tests that demonstrate:
- A contribution missing any baseline slot (`today-now`, `exceptions-needs-review`, `coworker-handoffs`) is rejected.
- Unknown component keys are marked as fail-closed placeholders.
- `dataRef` values are typed as canonical projection references, not inline data payloads.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/registry.test.ts
```

Expected: FAIL because `@/lib/workspace-home/registry` does not exist.

- [ ] **Step 2: Implement the minimal types and validators**

Create:
- `WorkspaceHomeSlotId = "today-now" | "exceptions-needs-review" | "coworker-handoffs" | string`
- `BASELINE_WORKSPACE_HOME_SLOTS`
- `WorkspaceHomePrimitiveKey`
- `WorkspaceHomeComponentKey`
- `WorkspaceHomeDataRef`
- `WorkspaceHomeContribution`
- `WorkspaceHomeResolution`
- `WorkspaceHomeSetupActivationSummary`

Implement validators in `registry.ts`:
- `validateWorkspaceHomeContribution(contribution)`
- `validateWorkspaceHomeComponent(component)`
- `registerWorkspaceHomeContribution(registry, contribution)`

- [ ] **Step 3: Run and fix until green**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/registry.test.ts
```

Expected: PASS.

### Task 2: Implement exact/category resolver semantics

**Files:**
- Modify: `apps/web/lib/workspace-home/registry.ts`
- Test: `apps/web/lib/workspace-home/registry.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Add tests for:
- Missing `StorefrontConfig` resolves to `mode: "unconfigured"` with platform fallback.
- Exact semantic archetype id match beats category fallback.
- Category fallback applies when no exact match exists.
- No match returns `mode: "unconfigured"` and includes setup action metadata.
- Re-running the resolver after archetype changes returns a new resolution.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/registry.test.ts
```

Expected: FAIL because resolver behavior is missing.

- [ ] **Step 2: Implement minimal resolver**

Implement:
- `createWorkspaceHomeRegistry(contributions = [])`
- `resolveWorkspaceHomeContribution({ storefrontConfig, registry })`

Resolution order:
1. No config or no archetype: `unconfigured`.
2. Exact `semanticArchetypeIds` match.
3. `archetypeCategories` fallback.
4. `unconfigured` with platform fallback.

Production registry starts empty in this BI; vertical contributions are supplied by downstream BIs.

- [ ] **Step 3: Run and fix until green**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/registry.test.ts
```

Expected: PASS.

### Task 3: Add setup-time worker-home activation summaries

**Files:**
- Create: `apps/web/lib/workspace-home/activation-summary.ts`
- Modify: `apps/web/lib/workspace-home/index.ts`
- Test: `apps/web/lib/workspace-home/activation-summary.test.ts`

- [ ] **Step 1: Write failing activation summary tests**

Add tests for:
- Exact contribution summary includes home label, primitive widget keys, required canonical data, and setup state.
- Category fallback summary identifies the fallback source.
- No contribution summary says the vertical worker home is not configured yet and lists the platform fallback.
- Summary accepts the same archetype shape loaded by `storefront/setup/page.tsx`.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/activation-summary.test.ts
```

Expected: FAIL because activation summary module does not exist.

- [ ] **Step 2: Implement summary builder**

Implement:
- `buildWorkspaceHomeActivationSummary({ archetype, registry })`
- `buildWorkspaceHomeActivationSummaries(archetypes, registry)`

Keep output serializable for client components.

- [ ] **Step 3: Run and fix until green**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/activation-summary.test.ts
```

Expected: PASS.

## Chunk 2: Platform Fallback Extraction

### Task 4: Extract existing platform workspace loader

**Files:**
- Create: `apps/web/lib/workspace-home/platform-loader.ts`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`
- Test: `apps/web/app/(shell)/workspace/page.test.tsx`

- [ ] **Step 1: Write failing loader import test**

Update the workspace page test so it imports `loadPlatformWorkspaceHomeData` and verifies it is a function.

Run:

```powershell
pnpm --filter web exec vitest run "apps/web/app/(shell)/workspace/page.test.tsx"
```

Expected: FAIL because the loader does not exist.

- [ ] **Step 2: Move data loading into the loader**

Move the current route data assembly into:

```ts
loadPlatformWorkspaceHomeData({
  prisma,
  user,
  now?: Date,
})
```

The loader returns:
- `workspaceSections`
- `workspaceCommandCenter`
- `calendarEvents`
- `archetypeCategory`
- `feedItems`
- `storefrontConfig`

- [ ] **Step 3: Keep route thin**

`page.tsx` should authenticate, call the loader, resolve the home, and render components.

- [ ] **Step 4: Run and fix until green**

Run:

```powershell
pnpm --filter web exec vitest run "apps/web/app/(shell)/workspace/page.test.tsx"
```

Expected: PASS.

### Task 5: Extract platform home presentation and unconfigured notice

**Files:**
- Create: `apps/web/components/workspace-home/PlatformWorkspaceHome.tsx`
- Create: `apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.tsx`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`
- Test: `apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx`
- Test: `apps/web/app/(shell)/workspace/page.test.tsx`

- [ ] **Step 1: Write failing component tests**

Add tests that assert:
- `UnconfiguredWorkspaceHomeNotice` renders honest setup copy and no gear/architecture language.
- New components use DPF theme tokens and no hardcoded neutral color classes.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement theme-aware components**

Extract current route markup into `PlatformWorkspaceHome` with no content changes other than removing platform-operator-only description copy from the worker home header.

Add `UnconfiguredWorkspaceHomeNotice` with copy like:
- "Workspace home is using the platform view"
- "Choose or finish a business setup template to activate a worker home tailored to this business."

Do not mention gears, contribution model, specialist/platform/business/vertical layers, or architecture internals.

- [ ] **Step 3: Run and fix until green**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx "apps/web/app/(shell)/workspace/page.test.tsx"
```

Expected: PASS.

## Chunk 3: Setup Activation Presentation

### Task 6: Add worker-home activation to storefront setup preview

**Files:**
- Modify: `apps/web/app/(shell)/storefront/setup/page.tsx`
- Modify: `apps/web/components/storefront-admin/SetupWizard.tsx`
- Modify: `apps/web/components/storefront-admin/ArchetypeActivationSummary.tsx`
- Test: `apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx`

- [ ] **Step 1: Write failing setup summary tests**

Update `ArchetypeActivationSummary.test.tsx` to pass a `workspaceHomeActivation` prop and assert:
- Configured summaries show the worker-home label and primitive widgets.
- Unconfigured summaries show the platform fallback without pretending a vertical home exists.
- Existing capability summary behavior remains.

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx
```

Expected: FAIL because the component does not accept the new prop.

- [ ] **Step 2: Wire summaries through setup**

In `storefront/setup/page.tsx`, call `buildWorkspaceHomeActivationSummaries(archetypes, defaultWorkspaceHomeRegistry)` and attach the serializable summary to each archetype passed to `SetupWizard`.

In `SetupWizard.tsx`, extend the `Archetype` type with `workspaceHomeActivation?: WorkspaceHomeSetupActivationSummary` and pass it to `ArchetypeActivationSummary`.

- [ ] **Step 3: Render compact setup summary**

In `ArchetypeActivationSummary`, render a second compact row/section for worker home activation. Use existing inline CSS variable style pattern and avoid hardcoded colors.

- [ ] **Step 4: Run and fix until green**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx
```

Expected: PASS.

## Chunk 4: Integration Verification and Commit

### Task 7: Run focused checks

**Files:**
- All touched files.

- [ ] **Step 1: Run focused test suite**

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/registry.test.ts apps/web/lib/workspace-home/activation-summary.test.ts apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx "apps/web/app/(shell)/workspace/page.test.tsx"
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

```powershell
pnpm --filter web exec next build
```

Expected: PASS.

### Task 8: UX verification

**Files:**
- Runtime only.

- [ ] **Step 1: Set safe worktree compose project if Docker verification is needed**

Create or verify ignored `.env` in the worktree with:

```dotenv
COMPOSE_PROJECT_NAME=dpf-vertical-workspace-home-substrate
```

- [ ] **Step 2: Exercise affected paths**

Verify:
- `/workspace` renders the platform fallback and no old platform-operator command-center description appears in the header.
- Setup preview renders worker-home activation summary without rendering `/workspace`.
- Theme tokens render in light/dark branded context.

Use the in-app Browser or Playwright where possible and capture the result in execution evidence.

### Task 9: Publish branch

**Files:**
- All touched files.

- [ ] **Step 1: Inspect diff and status**

```powershell
git status --short --branch
git diff --stat
```

- [ ] **Step 2: Commit with DCO signoff**

```powershell
git add apps/web/lib/workspace-home apps/web/components/workspace-home apps/web/app/(shell)/workspace/page.tsx apps/web/app/(shell)/workspace/page.test.tsx apps/web/app/(shell)/storefront/setup/page.tsx apps/web/components/storefront-admin/SetupWizard.tsx apps/web/components/storefront-admin/ArchetypeActivationSummary.tsx apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx docs/superpowers/plans/2026-05-25-vertical-workspace-home-substrate.md
git commit -s -m "feat: add vertical workspace home substrate"
```

- [ ] **Step 3: Push branch**

```powershell
git push -u origin feat/vertical-workspace-home-substrate
```

- [ ] **Step 4: Update backlog and evidence**

Use DPF MCP:
- `record_execution_evidence` for test/build/UX evidence.
- `update_backlog_item_status itemId=BI-1CCC6264 status=done` only after all required checks pass.

