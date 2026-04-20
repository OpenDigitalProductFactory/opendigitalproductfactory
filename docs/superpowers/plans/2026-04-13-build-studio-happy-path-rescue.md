# Build Studio Happy Path Rescue Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one trustworthy Build Studio happy path that enforces taxonomy/backlog/epic intake before planning, locks the execution engine for the run, and supports cheap failed-step verification and retry for one narrow discovery slice.

**Architecture:** Add an explicit happy-path state model on top of the existing `FeatureBuild` workflow, enforce intake prerequisites before planning/build, and route one constrained discovery slice through a single chosen execution path with structured verification output. Extend the existing Build Studio state machine instead of creating a parallel subsystem.

**Tech Stack:** Next.js App Router, server actions, Prisma, Vitest, existing Build Studio orchestrator, existing MCP tool registry, existing Build Studio React components

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `docs/superpowers/specs/2026-04-13-build-studio-happy-path-rescue-design.md` | Reference | Source design for the rescue slice |
| `apps/web/lib/explore/feature-build-types.ts` | Modify | Define typed happy-path intake/execution/verification state |
| `apps/web/lib/explore/feature-build-data.ts` | Modify | Read/write normalized happy-path state from `FeatureBuild` rows |
| `apps/web/lib/actions/build.ts` | Modify | Enforce intake prerequisites before phase advance; expose retry-safe updates |
| `apps/web/lib/mcp-tools.ts` | Modify | Make taxonomy/backlog/epic intake explicit and persistable from Build Studio tools |
| `apps/web/lib/integrate/build-orchestrator.ts` | Modify | Lock execution engine per run and persist failed-stage state |
| `apps/web/lib/integrate/build-studio-config.ts` | Modify | Provide deterministic engine resolution with test coverage |
| `apps/web/components/build/BuildStudio.tsx` | Modify | Surface happy-path status and retry actions |
| `apps/web/components/build/FeatureBriefPanel.tsx` | Modify | Show missing intake anchors and constrained goal state |
| `apps/web/lib/integrate/build-orchestrator.test.ts` | Modify | Cover engine locking and failed-step retry behavior |
| `apps/web/lib/integrate/build-studio-config.test.ts` | Modify | Cover deterministic engine selection behavior |
| `apps/web/lib/mcp-tools.test.ts` | Modify | Cover intake tool behavior and gating |
| `apps/web/lib/actions/build.test.ts` or nearest existing test file | Create/Modify | Cover intake gating before plan/build |

---

## Chunk 1: Model the Happy Path State

### Task 1: Add typed happy-path state to feature build types

**Files:**
- Modify: `apps/web/lib/explore/feature-build-types.ts`

- [ ] **Step 1: Read the existing `FeatureBuildRow` shape and current evidence fields**

Run:
```bash
sed -n '1,260p' apps/web/lib/explore/feature-build-types.ts
```

Expected: Identify where `FeatureBuildRow`, build phases, evidence payloads, and existing JSON fields are defined.

- [ ] **Step 2: Add explicit types for intake, execution, and verification state**

Add a focused state model, for example:

```ts
export type HappyPathFailureStage = "connect" | "fetch" | "parse" | "persist";

export type HappyPathIntakeState = {
  status: "pending" | "ready" | "failed";
  taxonomyNodeId: string | null;
  backlogItemId: string | null;
  epicId: string | null;
  constrainedGoal: string | null;
  failureReason?: string | null;
};

export type HappyPathExecutionState = {
  engine: "claude" | "codex" | "agentic" | null;
  source: "grafana" | "prometheus" | null;
  status: "pending" | "running" | "failed" | "done";
  failureStage?: HappyPathFailureStage | null;
};

export type HappyPathVerificationState = {
  status: "pending" | "running" | "failed" | "passed";
  checks: Array<{
    stage: HappyPathFailureStage;
    passed: boolean;
    detail: string;
  }>;
};
```

- [ ] **Step 3: Add the happy-path state to `FeatureBuildRow`**

Use one existing JSON-backed field or a typed projection field that keeps the change small. Keep naming aligned with existing Build Studio naming conventions.

- [ ] **Step 4: Write or update a narrow type-level test if the repo already validates this shape indirectly**

If there is no direct type test file, defer verification to the data-layer tests in the next task.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/explore/feature-build-types.ts
git commit -m "feat(build-studio): add happy-path state model for intake and verification"
```

---

### Task 2: Normalize happy-path state in the feature build data layer

**Files:**
- Modify: `apps/web/lib/explore/feature-build-data.ts`

- [ ] **Step 1: Write a failing test for normalized happy-path state projection**

If a nearby test file exists, add a case that verifies null-safe defaults and typed projection from the raw row JSON.

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/explore/feature-build-data.test.ts
```

Expected: FAIL because the state is not yet projected or normalized.

- [ ] **Step 3: Add a normalization helper**

Implement a helper that reads the raw JSON and returns safe defaults:

```ts
function normalizeHappyPathState(raw: unknown): HappyPathState {
  return {
    intake: { status: "pending", taxonomyNodeId: null, backlogItemId: null, epicId: null, constrainedGoal: null, ... },
    execution: { engine: null, source: null, status: "pending", failureStage: null, ... },
    verification: { status: "pending", checks: [], ... },
  };
}
```

- [ ] **Step 4: Use the normalization helper everywhere `FeatureBuildRow` is assembled**

Update all code paths that materialize build rows so the UI and actions read a consistent shape.

- [ ] **Step 5: Run the targeted test**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/explore/feature-build-data.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/explore/feature-build-data.ts apps/web/lib/explore/feature-build-data.test.ts
git commit -m "feat(build-studio): normalize happy-path state in feature build data"
```

---

## Chunk 2: Enforce Intake Before Planning

### Task 3: Gate phase advance on taxonomy/backlog/epic intake completeness

**Files:**
- Modify: `apps/web/lib/actions/build.ts`
- Test: `apps/web/lib/actions/build.test.ts` or nearest existing test file

- [ ] **Step 1: Write a failing test for plan/build gating**

Add a test that attempts to advance a build without full intake anchors and expects a blocking response.

- [ ] **Step 2: Run the targeted test**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/actions/build.test.ts
```

Expected: FAIL because missing intake does not yet block progression.

- [ ] **Step 3: Add an intake readiness helper**

Implement a helper such as:

```ts
function isHappyPathIntakeReady(state: HappyPathIntakeState): boolean {
  return Boolean(
    state.taxonomyNodeId &&
    state.backlogItemId &&
    state.epicId &&
    state.constrainedGoal
  );
}
```

- [ ] **Step 4: Enforce the helper before advancing into `plan` or `build`**

Return a clear user-facing error that tells the caller which anchors are still missing.

- [ ] **Step 5: Persist intake failure reason in happy-path state**

Do not just throw an opaque error. Update state so the UI can show the missing prerequisite.

- [ ] **Step 6: Run the targeted test again**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/actions/build.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/actions/build.ts apps/web/lib/actions/build.test.ts
git commit -m "feat(build-studio): gate planning and build on intake readiness"
```

---

### Task 4: Make Build Studio tools persist taxonomy/backlog/epic anchors explicitly

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools.test.ts`

- [ ] **Step 1: Read the current Build Studio tool handlers**

Run:
```bash
sed -n '2040,2750p' apps/web/lib/mcp-tools.ts
```

Expected: Review `update_feature_brief`, `suggest_taxonomy_placement`, `save_phase_handoff`, `saveBuildEvidence`, and `reviewBuildPlan`.

- [ ] **Step 2: Write failing tests for explicit intake persistence**

Add tests that verify:

- taxonomy placement updates happy-path intake state
- backlog item creation result can be linked into intake state
- epic linkage is persisted and visible to phase gating

- [ ] **Step 3: Run the targeted tests**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/mcp-tools.test.ts
```

Expected: FAIL on the new intake persistence expectations.

- [ ] **Step 4: Add a small helper for updating happy-path intake state**

Use one helper instead of duplicating JSON merge logic across tool handlers.

- [ ] **Step 5: Update the relevant tool handlers**

When the Build Studio tools resolve taxonomy or backlog/epic information, persist that to the normalized happy-path state immediately.

- [ ] **Step 6: Run the targeted tests**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/mcp-tools.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools.test.ts
git commit -m "feat(build-studio): persist intake anchors from build tools"
```

---

## Chunk 3: Lock the Execution Engine and Persist Failure Stage

### Task 5: Make dispatcher selection explicit and deterministic

**Files:**
- Modify: `apps/web/lib/integrate/build-studio-config.ts`
- Modify: `apps/web/lib/integrate/build-studio-config.test.ts`

- [ ] **Step 1: Write failing tests for deterministic engine selection**

Add tests that cover:

- DB config wins over auto-detection
- missing provider IDs fall back safely
- no configured engines yields explicit `agentic`
- invalid or missing provider credentials do not silently select the wrong engine

- [ ] **Step 2: Run the targeted tests**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/build-studio-config.test.ts
```

Expected: FAIL on the new cases.

- [ ] **Step 3: Refine `getBuildStudioConfig()`**

Ensure the returned config is deterministic and safe for a per-run engine lock.

- [ ] **Step 4: Run the targeted tests**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/build-studio-config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/integrate/build-studio-config.ts apps/web/lib/integrate/build-studio-config.test.ts
git commit -m "fix(build-studio): make execution engine selection deterministic"
```

---

### Task 6: Persist engine selection and failed-step state in the orchestrator

**Files:**
- Modify: `apps/web/lib/integrate/build-orchestrator.ts`
- Modify: `apps/web/lib/integrate/build-orchestrator.test.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Cover:

- the chosen engine is recorded at run start
- task failures record a failed stage instead of only generic failure text
- retry decisions can target the failed stage without forcing a full rebuild

- [ ] **Step 2: Run the targeted tests**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/build-orchestrator.test.ts
```

Expected: FAIL on the new assertions.

- [ ] **Step 3: Add a small persisted run-state helper**

Implement helper(s) such as:

```ts
function updateExecutionState(...) { ... }
function setVerificationFailureStage(...) { ... }
```

Keep the JSON merge logic out of the main orchestration loop.

- [ ] **Step 4: Record the engine at the beginning of a run**

As soon as `getBuildStudioConfig()` is resolved for the run, persist it to happy-path execution state.

- [ ] **Step 5: Record failure stage when a task or verification step fails**

Use the smallest useful stage vocabulary: `connect`, `fetch`, `parse`, `persist`.

- [ ] **Step 6: Expose minimal retry targeting helpers**

Implement logic that can tell the caller whether a failure can be retried at the current stage without a full rebuild.

- [ ] **Step 7: Run the targeted tests**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/build-orchestrator.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/integrate/build-orchestrator.ts apps/web/lib/integrate/build-orchestrator.test.ts
git commit -m "feat(build-studio): persist engine and failed-step state for rescue path"
```

---

## Chunk 4: Surface the Happy Path in the UI

### Task 7: Show missing intake anchors and execution state in Build Studio

**Files:**
- Modify: `apps/web/components/build/BuildStudio.tsx`
- Modify: `apps/web/components/build/FeatureBriefPanel.tsx`

- [ ] **Step 1: Read the current Build Studio and brief UI**

Run:
```bash
sed -n '1,260p' apps/web/components/build/BuildStudio.tsx
sed -n '1,240p' apps/web/components/build/FeatureBriefPanel.tsx
```

Expected: Confirm current loading, phase, and brief rendering behavior.

- [ ] **Step 2: Add a failing UI test if one already exists nearby**

If no nearby component test exists, keep this task implementation-only and rely on later build verification.

- [ ] **Step 3: Add a compact intake status panel**

Show:

- taxonomy linked or missing
- backlog item linked or missing
- epic linked or missing
- constrained goal present or missing

Use existing theme variables only.

- [ ] **Step 4: Add an execution status panel**

Show:

- selected engine
- selected source
- current stage
- failed stage reason if present

- [ ] **Step 5: Add retry affordance placeholders**

If full retry actions are not implemented yet, at minimum surface which retry actions should be available.

- [ ] **Step 6: Run a targeted typecheck or relevant UI test**

Run:
```bash
pnpm exec tsc --noEmit
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/build/BuildStudio.tsx apps/web/components/build/FeatureBriefPanel.tsx
git commit -m "feat(build-studio): surface rescue-path intake and execution state"
```

---

## Chunk 5: Verification and Build Gate

### Task 8: Run focused tests for the rescue slice

**Files:**
- No code changes expected unless failures are found

- [ ] **Step 1: Run the focused Vitest suite**

Run:
```bash
pnpm --filter web exec vitest run \
  apps/web/lib/integrate/build-studio-config.test.ts \
  apps/web/lib/integrate/build-orchestrator.test.ts \
  apps/web/lib/mcp-tools.test.ts \
  apps/web/lib/actions/build.test.ts
```

Expected: PASS

- [ ] **Step 2: Fix any failing rescue-slice tests**

If a test fails, fix the minimal affected code before continuing.

- [ ] **Step 3: Run the production build gate**

Run:
```bash
pnpm --filter web exec next build
```

Expected: PASS with zero errors

- [ ] **Step 4: Update `tests/e2e/platform-qa-plan.md` with any rescue-path Build Studio cases**

Add at least:

- intake blocked when taxonomy/backlog/epic are missing
- run records active execution engine
- failed stage can be retried without full rebuild

- [ ] **Step 5: Re-run affected QA documentation checks if available**

Run any existing documentation or lint checks that validate the QA plan file if the repo has them.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/platform-qa-plan.md
git commit -m "test(build-studio): add happy-path rescue QA coverage"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-13-build-studio-happy-path-rescue.md`. Ready to execute?

