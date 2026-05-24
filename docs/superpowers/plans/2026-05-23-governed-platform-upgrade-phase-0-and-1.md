# Governed Platform Upgrade — Phase 0 (Substrate Cleanup) + Phase 1 (Versioning Baseline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stabilize the split self-upgrade code path so there is exactly one runnable upgrade flow with consistent DTO vocabulary, then introduce a first-class `platform_version` concept that the runtime, API, and Admin UI all read from one source.

**Architecture:** Phase 0 deletes the legacy `portal-self-upgrade.ts` Inngest function family (currently registered but calling deprecated stubs) and aligns the `listSelfUpgradeRuns` action + `SelfUpgradeClient.tsx` UI to the actual `SelfUpgradeRun` Prisma schema column names. Phase 1 adds a canonical `version.json` at the repo root, a runtime loader that exposes it via `/api/platform/version`, and surfaces the value in `/ops/self-upgrade`. No new dependencies; all changes are TDD with vitest.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Prisma + Postgres (`@dpf/db`), Inngest for queues, vitest + `@testing-library/jest-dom` for tests, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md) (committed at `0bc912ed`)

**Backlog item:** `BI-5B3FA415`

---

## Pre-flight checks (do these before Task 1)

- [ ] Confirm you are on a fresh branch off `origin/main`:
  ```
  git fetch origin && git status
  git log origin/main..HEAD --oneline   # should show only the spec commit if continuing this worktree
  ```
- [ ] Confirm vitest runs clean:
  ```
  pnpm --filter web test -- --run apps/web/lib/self-upgrade
  pnpm --filter web test -- --run apps/web/lib/queue/functions/self-upgrade.test.ts
  pnpm --filter web test -- --run apps/web/lib/queue/functions/portal-self-upgrade.test.ts
  ```
  Note any pre-existing failures so they're not attributed to your changes.
- [ ] Confirm Prisma client is generated:
  ```
  pnpm --filter @dpf/db generate
  ```

If any pre-flight step fails, stop and surface to the human rather than working around it.

---

## Phase 0 — Substrate Cleanup

The goal of Phase 0 is **fewer running code paths**, not more. After Phase 0, there must be exactly one Inngest function family handling self-upgrade, exactly one DTO vocabulary in the API surface, and the deprecated stubs that currently no-op must be physically removed from the codebase.

### Task 1: Pin down current substrate behavior with characterization tests

**Why:** Before we delete code, we write tests that capture exactly what the current system does. These tests will guide the deletions — when a deletion breaks a characterization test, that tells us whether the removal was clean or whether we missed a caller.

**Files:**
- Create: `apps/web/lib/queue/functions/substrate-audit.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `apps/web/lib/queue/functions/substrate-audit.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { allFunctions } from "@/lib/queue/functions";
  import { runSelfUpgradeCycle } from "@/lib/self-upgrade";
  import { completePendingSelfUpgradeRuns } from "@/lib/self-upgrade/completion";

  describe("self-upgrade substrate audit (Phase 0 baseline)", () => {
    it("currently registers BOTH legacy and new Inngest families", () => {
      const ids = allFunctions.map((fn) => (fn as { id: () => string }).id());
      // Legacy family — will be removed in Task 4
      expect(ids).toContain("portal/self-upgrade-scheduled");
      expect(ids).toContain("portal/self-upgrade-requested");
      expect(ids).toContain("portal/self-upgrade-completion-sweep");
      // Newer family — will be the survivor
      expect(ids).toContain("ops/self-upgrade-scheduled");
      expect(ids).toContain("ops/self-upgrade-manual");
    });

    it("legacy runSelfUpgradeCycle is a no-op stub", async () => {
      const result = await runSelfUpgradeCycle({ trigger: "scheduled" });
      expect(result).toEqual({ status: "skipped", reason: "use-inngest-function" });
    });

    it("legacy completePendingSelfUpgradeRuns is a no-op stub", async () => {
      const result = await completePendingSelfUpgradeRuns();
      expect(result).toEqual({ processedRunIds: [] });
    });
  });
  ```

- [ ] **Step 2: Run test to verify it passes (these are characterization tests of current behavior)**

  ```
  pnpm --filter web test -- --run apps/web/lib/queue/functions/substrate-audit.test.ts
  ```

  All three tests should pass against current code. If they don't, stop and investigate — the substrate state may have changed since this plan was written.

- [ ] **Step 3: Commit**

  ```
  git add apps/web/lib/queue/functions/substrate-audit.test.ts
  git commit -s apps/web/lib/queue/functions/substrate-audit.test.ts -m "test(self-upgrade): characterization tests for current substrate (Phase 0 baseline)

  Pin down current behavior before deletions: both Inngest families are
  registered, runSelfUpgradeCycle and completePendingSelfUpgradeRuns are
  stubs. Tests will be updated/removed as Phase 0 progresses.

  Refs: BI-5B3FA415"
  ```

---

### Task 2: Reproduce the `listSelfUpgradeRuns` DTO drift bug

**Why:** `apps/web/lib/actions/promotions.ts:561-570` selects `triggeredBy`, `fromVersion`, `toVersion`, `error` from `prisma.selfUpgradeRun.findMany`, but the `SelfUpgradeRun` model in `packages/db/prisma/schema.prisma:4971` has columns `trigger`, `currentSha`, `targetSha`, `failureLog`. This is a runtime bug — the query will throw `PrismaClientValidationError`. We write the failing test first.

**Files:**
- Create: `apps/web/lib/actions/promotions.self-upgrade.test.ts`

- [ ] **Step 1: Write the failing test**

  ```ts
  import { describe, it, expect } from "vitest";
  import { listSelfUpgradeRuns } from "@/lib/actions/promotions";

  // This test is INTENTIONALLY EXPECTED TO FAIL today because of the
  // DTO drift in promotions.ts. Task 3 will make it pass.
  describe("listSelfUpgradeRuns DTO alignment", () => {
    it("returns runs without throwing PrismaClientValidationError", async () => {
      // Auth is required — this test must be wired through the test harness'
      // mock-auth path. If your harness doesn't have it, mark this `it.todo`
      // and add the harness wiring as a follow-up step (out of scope here).
      const result = await listSelfUpgradeRuns({ limit: 1 });
      expect(result).toHaveProperty("runs");
      expect(result).toHaveProperty("nextCursor");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails with the expected Prisma validation error**

  ```
  pnpm --filter web test -- --run apps/web/lib/actions/promotions.self-upgrade.test.ts
  ```

  Expect: `PrismaClientValidationError` mentioning unknown fields `triggeredBy`, `fromVersion`, `toVersion`, `error`. If you get a different failure (e.g. auth), wire the auth mock first and re-run.

  If the test PASSES, stop — the schema may have been migrated between this plan and now. Re-read `packages/db/prisma/schema.prisma:4971` and adjust Task 3 accordingly.

- [ ] **Step 3: Mark the test `it.skip` so it does not gate CI red**

  Repo convention (confirmed by grep against `apps/web/lib/orchestration/structural.test.ts` and `apps/web/lib/integrate/build-orchestrator.test.ts`) is `it.skip` / `it.todo` for known-failing or pending tests, NOT a `[FAIL]` commit marker. Change `it(...)` to `it.skip(...)` in the test you just wrote. Task 3 will unskip it after the fix.

- [ ] **Step 4: Commit the skipped reproducer**

  ```
  git add apps/web/lib/actions/promotions.self-upgrade.test.ts
  git commit -s apps/web/lib/actions/promotions.self-upgrade.test.ts -m "test(promotions): reproducer (skipped) for listSelfUpgradeRuns DTO drift

  Schema columns: trigger, currentSha, targetSha, failureLog
  Action selects: triggeredBy, fromVersion, toVersion, error
  → PrismaClientValidationError at runtime.

  Test is it.skip per repo convention; Task 3 aligns the action to
  schema names and unskips.

  Refs: BI-5B3FA415"
  ```

---

### Task 3: Align `listSelfUpgradeRuns` and `SelfUpgradeRunDto` to schema column names

**Files:**
- Modify: `apps/web/lib/actions/promotions.ts:536-578`
- Modify (if it references the DTO): `apps/web/components/ops/SelfUpgradeClient.tsx`
- Modify (if it references the DTO): `apps/web/components/ops/SelfUpgradePanel.tsx`
- Modify: `apps/web/components/ops/SelfUpgradeClient.test.tsx` — this exists today and almost certainly references the renamed DTO fields; update it in lockstep with the component

- [ ] **Step 1: Replace the DTO type definition**

  In `apps/web/lib/actions/promotions.ts` replace lines 536-546:

  ```ts
  export type SelfUpgradeRunDto = {
    runId: string;
    status: string;
    trigger: string | null;       // schema: trigger (was: triggeredBy)
    currentSha: string | null;    // schema: currentSha (was: fromVersion)
    targetSha: string | null;     // schema: targetSha (was: toVersion)
    deployedSha: string | null;   // schema: deployedSha (was: absent — adding for completeness)
    startedAt: Date | null;
    completedAt: Date | null;
    failureLog: string | null;    // schema: failureLog (was: error)
    createdAt: Date;
  };
  ```

- [ ] **Step 2: Replace the `select` clause in `listSelfUpgradeRuns`**

  Lines 561-571:

  ```ts
  select: {
    runId: true,
    status: true,
    trigger: true,
    currentSha: true,
    targetSha: true,
    deployedSha: true,
    startedAt: true,
    completedAt: true,
    failureLog: true,
    createdAt: true,
  },
  ```

- [ ] **Step 3: Update UI components AND their tests to use the renamed fields**

  Open `apps/web/components/ops/SelfUpgradeClient.tsx`, `SelfUpgradePanel.tsx`, and `apps/web/components/ops/SelfUpgradeClient.test.tsx`. Find references to `triggeredBy`, `fromVersion`, `toVersion`, `error` from `SelfUpgradeRunDto`. Replace:
  - `run.triggeredBy` → `run.trigger`
  - `run.fromVersion` → `run.currentSha`
  - `run.toVersion` → `run.targetSha`
  - `run.error` → `run.failureLog`

  Display labels can stay user-friendly (`"Triggered by"`, `"From version"`, etc. on screen) — only the property accesses change.

- [ ] **Step 4: Unskip the reproducer test from Task 2 and run it to verify it now passes**

  Change `it.skip(...)` back to `it(...)` in `apps/web/lib/actions/promotions.self-upgrade.test.ts`, then:

  ```
  pnpm --filter web test -- --run apps/web/lib/actions/promotions.self-upgrade.test.ts
  ```

  Expect green.

- [ ] **Step 5: Run typecheck across the workspace to catch other DTO consumers**

  ```
  pnpm typecheck
  ```

  Address any new type errors that reference the renamed fields. They are by definition consumers we missed.

- [ ] **Step 6: Run the full web test suite to catch component test regressions**

  ```
  pnpm --filter web test
  ```

- [ ] **Step 7: Commit**

  ```
  git add apps/web/lib/actions/promotions.ts apps/web/lib/actions/promotions.self-upgrade.test.ts apps/web/components/ops/SelfUpgradeClient.tsx apps/web/components/ops/SelfUpgradePanel.tsx apps/web/components/ops/SelfUpgradeClient.test.tsx
  git commit -s apps/web/lib/actions/promotions.ts apps/web/lib/actions/promotions.self-upgrade.test.ts apps/web/components/ops/SelfUpgradeClient.tsx apps/web/components/ops/SelfUpgradePanel.tsx apps/web/components/ops/SelfUpgradeClient.test.tsx -m "fix(promotions): align SelfUpgradeRunDto to SelfUpgradeRun schema columns

  listSelfUpgradeRuns selected DTO field names that did not exist in the
  Prisma model, causing PrismaClientValidationError at runtime. Aligned
  the action and downstream UI consumers to the schema column names
  (trigger, currentSha, targetSha, failureLog). DTO names are accurate
  to what the columns hold today (git SHAs); renaming to semver-friendly
  vocabulary happens in Phase 1+ when those columns actually carry versions.

  Refs: BI-5B3FA415, spec §2.2"
  ```

---

### Task 4: Stop running the legacy Inngest function family

**Why:** Removing the functions from `allFunctions` stops Inngest from invoking them on cron. We do this BEFORE deleting the files, so we get a clean "stopped running" commit separate from "code removed."

**Files:**
- Modify: `apps/web/lib/queue/functions/index.ts:22-76`
- Modify: `apps/web/lib/queue/functions/substrate-audit.test.ts` (created in Task 1)

- [ ] **Step 1: Update the characterization test to expect the new state**

  In `apps/web/lib/queue/functions/substrate-audit.test.ts`, replace the first test:

  ```ts
  it("registers only the ops/self-upgrade family (legacy removed)", () => {
    const ids = allFunctions.map((fn) => (fn as { id: () => string }).id());
    expect(ids).toContain("ops/self-upgrade-scheduled");
    expect(ids).toContain("ops/self-upgrade-manual");
    expect(ids).not.toContain("portal/self-upgrade-scheduled");
    expect(ids).not.toContain("portal/self-upgrade-requested");
    expect(ids).not.toContain("portal/self-upgrade-completion-sweep");
  });
  ```

  Leave the two stub tests in place — Task 5 will remove them with the stubs.

- [ ] **Step 2: Run test to verify it fails**

  ```
  pnpm --filter web test -- --run apps/web/lib/queue/functions/substrate-audit.test.ts
  ```

  First test should fail (legacy family still registered).

- [ ] **Step 3: Remove the legacy family from `index.ts`**

  In `apps/web/lib/queue/functions/index.ts`:
  - Remove the import lines for `portalSelfUpgradeCompletionSweep`, `portalSelfUpgradeRequested`, `portalSelfUpgradeScheduled` (lines 28-30 area).
  - Remove those three entries from the `allFunctions` array (lines 67-69 area).
  - Do NOT touch the `selfUpgradeScheduled` / `selfUpgradeManual` import or array entries.

- [ ] **Step 4: Run test to verify it passes**

  ```
  pnpm --filter web test -- --run apps/web/lib/queue/functions/substrate-audit.test.ts
  ```

- [ ] **Step 5: Run the existing `portal-self-upgrade.test.ts` — expect failures**

  ```
  pnpm --filter web test -- --run apps/web/lib/queue/functions/portal-self-upgrade.test.ts
  ```

  These tests reference the removed exports. They will be deleted with the file in Task 5. For now, this red is expected — note it in the commit message so it's not a surprise.

- [ ] **Step 6: Commit**

  ```
  git add apps/web/lib/queue/functions/index.ts apps/web/lib/queue/functions/substrate-audit.test.ts
  git commit -s apps/web/lib/queue/functions/index.ts apps/web/lib/queue/functions/substrate-audit.test.ts -m "chore(self-upgrade): unregister legacy portal/* Inngest family

  Stops the daily 8am cron, the portal/self-upgrade.requested manual event,
  and the 15-min completion sweep from firing. These functions called
  runSelfUpgradeCycle and completePendingSelfUpgradeRuns, both of which
  have been compatibility stubs returning skipped/empty since the
  ops/self-upgrade Inngest family replaced them.

  Files for those functions are removed in the next commit; this commit
  ensures Inngest stops invoking them first.

  Known temporary red: apps/web/lib/queue/functions/portal-self-upgrade.test.ts
  references removed exports; file deleted in next commit.

  Refs: BI-5B3FA415, spec §2.2"
  ```

---

### Task 5: Delete legacy self-upgrade code

**Files:**
- Delete: `apps/web/lib/queue/functions/portal-self-upgrade.ts`
- Delete: `apps/web/lib/queue/functions/portal-self-upgrade.test.ts`
- Modify: `apps/web/lib/self-upgrade/index.ts` (remove `runSelfUpgradeCycle` stub)
- Modify: `apps/web/lib/self-upgrade/completion.ts` (remove `completePendingSelfUpgradeRuns` stub)
- Modify: `apps/web/lib/self-upgrade/config.ts` (remove deprecated `loadSelfUpgradeConfig` alias)
- Modify: `apps/web/lib/actions/self-upgrade.ts` — **live caller** of `loadSelfUpgradeConfig` at lines 11 and 79; rename call site to `getSelfUpgradeConfig` (the canonical name)
- Modify: `apps/web/lib/self-upgrade/promoter.ts` (remove deprecated legacy API: `shellQuote`, `buildPromoterDockerArgs`, `startSelfUpgradePromoter`, `PromoterStartResult` type, `LegacyPromoterConfig` type)
- Modify: `apps/web/lib/queue/functions/substrate-audit.test.ts` (remove the two stub-behavior tests since the stubs are gone — they were intentional characterization tests pinning the pre-Phase-0 state, NOT spec coverage; their job is done once the stubs no longer exist)

**Pre-Task note on `shellQuote`:** grep will surface additional `shellQuote` matches in `git-promotion-sandbox-verification.ts:3`, `sandbox-source-currency.ts:282`, and `sandbox-admin.ts:601`. These are **independent local definitions**, not imports from `promoter.ts` — they are harmless and out of scope for this task. Verify by reading the import statements, not just the symbol grep.

- [ ] **Step 1: Search for callers of each deprecated symbol before deleting**

  Use the Grep tool. Expected results (as of plan authoring):
  - `runSelfUpgradeCycle` — only in `apps/web/lib/self-upgrade/index.ts` (definition) and in the substrate-audit test
  - `completePendingSelfUpgradeRuns` — only in `apps/web/lib/self-upgrade/completion.ts` (definition), the deleted `portal-self-upgrade.ts`, and the substrate-audit test
  - `loadSelfUpgradeConfig` — definition in `apps/web/lib/self-upgrade/config.ts` AND **live caller in `apps/web/lib/actions/self-upgrade.ts:11,79`**. Rename the call site to `getSelfUpgradeConfig` BEFORE deleting the alias.
  - `shellQuote` — definition in `apps/web/lib/self-upgrade/promoter.ts`. Other `shellQuote` matches in `git-promotion-sandbox-verification.ts`, `sandbox-source-currency.ts`, `sandbox-admin.ts` are independent local definitions; verify by reading import lines.
  - `buildPromoterDockerArgs`, `startSelfUpgradePromoter` — only in `apps/web/lib/self-upgrade/promoter.ts` (definition) and `promoter.test.ts`. Delete the test cases that exercise only the deprecated API.

  If you find ANY OTHER callers beyond these, STOP and surface to the operator. Do not delete a symbol with live external callers.

- [ ] **Step 1b: Rename the `loadSelfUpgradeConfig` caller before the alias is deleted**

  In `apps/web/lib/actions/self-upgrade.ts`:
  - Line 11: change the import from `loadSelfUpgradeConfig` to `getSelfUpgradeConfig`
  - Line 79 (call site): change `loadSelfUpgradeConfig()` to `getSelfUpgradeConfig()`

  Run typecheck to confirm: `pnpm typecheck`. Must pass before continuing to Step 2.

- [ ] **Step 2: Delete the files**

  ```
  rm apps/web/lib/queue/functions/portal-self-upgrade.ts
  rm apps/web/lib/queue/functions/portal-self-upgrade.test.ts
  ```

- [ ] **Step 3: Remove deprecated stubs from the surviving files**

  - `apps/web/lib/self-upgrade/index.ts` — remove lines 8-22 (the entire "Legacy orchestrator API" section including the `SelfUpgradeCycleResult` type and `runSelfUpgradeCycle` stub).
  - `apps/web/lib/self-upgrade/completion.ts` — remove lines 51-60 (the "Legacy completion sweep API" section and `completePendingSelfUpgradeRuns` stub).
  - `apps/web/lib/self-upgrade/config.ts` — remove line 45-46 (the `loadSelfUpgradeConfig` deprecated alias).
  - `apps/web/lib/self-upgrade/promoter.ts` — remove lines 4-46 (the entire "Legacy API" section: `PromoterStartResult`, `shellQuote`, `LegacyPromoterConfig`, `buildPromoterDockerArgs`, `startSelfUpgradePromoter`).

- [ ] **Step 4: Delete the now-obsolete characterization tests from substrate-audit**

  The two stub-behavior tests in `apps/web/lib/queue/functions/substrate-audit.test.ts` were **intentional characterization tests** pinning the pre-Phase-0 state (Task 1) — not permanent spec coverage. Their job ends when the stubs they characterize no longer exist. Delete the two `it(...)` blocks that test the stubs. Keep only the registration test from Task 4.

- [ ] **Step 5: Run the affected unit tests**

  ```
  pnpm --filter web test -- --run apps/web/lib/self-upgrade/
  pnpm --filter web test -- --run apps/web/lib/queue/functions/
  ```

  Any test that imports a deleted symbol must be either deleted (if its only purpose was testing the deprecated symbol) or updated.

- [ ] **Step 6: Run typecheck**

  ```
  pnpm typecheck
  ```

  Address any remaining references.

- [ ] **Step 7: Commit**

  ```
  git add -u apps/web/lib/queue/functions apps/web/lib/self-upgrade
  git commit -s apps/web/lib/queue/functions apps/web/lib/self-upgrade -m "chore(self-upgrade): delete deprecated stubs and legacy promoter API

  Removed:
  - apps/web/lib/queue/functions/portal-self-upgrade.ts (+ test)
  - runSelfUpgradeCycle stub from self-upgrade/index.ts
  - completePendingSelfUpgradeRuns stub from self-upgrade/completion.ts
  - loadSelfUpgradeConfig deprecated alias
  - Legacy promoter API: shellQuote, buildPromoterDockerArgs,
    startSelfUpgradePromoter, PromoterStartResult, LegacyPromoterConfig

  Single surviving substrate: selfUpgradeScheduled (hourly cron) +
  selfUpgradeManual (event ops/self-upgrade.run) → runSelfUpgrade →
  runPromoter (scripts/promote.sh --self-upgrade).

  Refs: BI-5B3FA415, spec §2.2"
  ```

---

### Task 6: Make `resolveTargetSha`'s null-return loud instead of silent

**Why:** `apps/web/lib/self-upgrade/version.ts:102-104` currently returns `null` and the hourly cron skips with `reason: "no-target"`. This is correct behavior pending Phase 2 channel manifest, but it's silent — operators have no signal that self-upgrade is gated on missing infrastructure. We add a structured log so the gating is visible.

**Files:**
- Modify: `apps/web/lib/self-upgrade/version.ts:102-104`
- Modify: `apps/web/lib/self-upgrade/version.test.ts` (add test for the new log behavior)

- [ ] **Step 1: Write the failing test**

  Append to `apps/web/lib/self-upgrade/version.test.ts`:

  ```ts
  describe("resolveTargetSha", () => {
    it("returns null and logs a structured INFO message about pending channel resolution", async () => {
      const { resolveTargetSha } = await import("./version");
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      const result = await resolveTargetSha("stable");

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("self-upgrade.no-target"),
        expect.objectContaining({ channel: "stable", reason: "channel-resolution-not-implemented" }),
      );

      consoleSpy.mockRestore();
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```
  pnpm --filter web test -- --run apps/web/lib/self-upgrade/version.test.ts
  ```

- [ ] **Step 3: Implement the log**

  Replace lines 102-104 of `apps/web/lib/self-upgrade/version.ts`:

  ```ts
  export async function resolveTargetSha(channel: string): Promise<string | null> {
    // TODO(BI-UPGRADE-003): implement channel manifest resolution
    // See docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §4.4
    // Until then, the hourly self-upgrade cron always skips with reason="no-target".
    console.info("self-upgrade.no-target", {
      channel,
      reason: "channel-resolution-not-implemented",
      tracking: "BI-UPGRADE-003",
    });
    return null;
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  ```
  pnpm --filter web test -- --run apps/web/lib/self-upgrade/version.test.ts
  ```

- [ ] **Step 5: Commit**

  ```
  git add apps/web/lib/self-upgrade/version.ts apps/web/lib/self-upgrade/version.test.ts
  git commit -s apps/web/lib/self-upgrade/version.ts apps/web/lib/self-upgrade/version.test.ts -m "chore(self-upgrade): make resolveTargetSha null-return observable

  Previously silent — the hourly cron always skipped with no-target and
  there was no log signal that self-upgrade was gated on infrastructure
  not yet built. Adds a structured INFO log per call so operators can see
  that channel resolution is the blocker, with explicit BI tracking.

  Refs: BI-5B3FA415, BI-UPGRADE-003 (proposed), spec §4.4"
  ```

---

### Task 7: Write the substrate-state Architecture Decision Record

**Why:** The next engineer (or future-you) needs to know which path is alive, which APIs are stopgaps, and which infrastructure is intentionally missing pending later phases. A short ADR captures the post-Phase-0 state.

**Files:**
- Create: `docs/superpowers/decisions/2026-05-23-self-upgrade-substrate-consolidation.md`

- [ ] **Step 1: Verify the decisions directory exists; create it if not**

  ```
  ls docs/superpowers/decisions 2>/dev/null || mkdir -p docs/superpowers/decisions
  ```

- [ ] **Step 2: Write the ADR**

  Create `docs/superpowers/decisions/2026-05-23-self-upgrade-substrate-consolidation.md`:

  ```markdown
  # Self-Upgrade Substrate Consolidation (Phase 0)

  | Field | Value |
  | --- | --- |
  | Date | 2026-05-23 |
  | Status | Accepted |
  | Spec | docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md |
  | BI | BI-5B3FA415 |

  ## Context

  Prior to Phase 0, two parallel Inngest function families handled self-upgrade:

  - `portal/self-upgrade-*` (legacy, daily 8am + 15min completion sweep): called
    `runSelfUpgradeCycle` and `completePendingSelfUpgradeRuns`, both compatibility
    stubs returning skipped/empty.
  - `ops/self-upgrade-*` (newer, hourly + manual event): the substantive
    implementation, gated on `resolveTargetSha` which returns `null`.

  `apps/web/lib/actions/promotions.ts` `listSelfUpgradeRuns` selected DTO field
  names (`triggeredBy`, `fromVersion`, `toVersion`, `error`) that did not match
  the `SelfUpgradeRun` Prisma model columns (`trigger`, `currentSha`,
  `targetSha`, `failureLog`), producing a runtime `PrismaClientValidationError`.

  ## Decision

  1. Delete the legacy `portal/self-upgrade-*` Inngest functions and their
     stub backends. There is exactly one runnable self-upgrade family:
     `selfUpgradeScheduled` (hourly) + `selfUpgradeManual` (event
     `ops/self-upgrade.run`).
  2. Align the API DTO surface to the schema column names rather than rename
     the columns. Rationale: the column names accurately describe what they
     hold today (git SHAs). Renaming to `fromVersion` / `toVersion` would be
     incorrect until Phase 1 introduces a versioning concept.
  3. Make `resolveTargetSha`'s null return observable via structured log,
     with explicit tracking reference to the future channel-manifest BI.

  ## Consequences

  - Inngest dashboard now shows only the `ops/*` family.
  - `SelfUpgradeRun` history queries return live data without throwing.
  - Hourly cron still skips every fire (`reason: "no-target"`), but the log
    signal makes the gating visible.
  - Future schema rename of `currentSha`/`targetSha` to `fromVersion`/`toVersion`
    is unblocked once Phase 1+ make those fields actually carry versions.

  ## Out of scope (handled in later phases)

  - Implementing `resolveTargetSha` — Phase 2 (channel manifest).
  - Wiring `emitUpgradeEvent` to a real event bus — Phase 5 (graceful recycle).
  - Replacing the 5-min activity defer with a graceful drain protocol — Phase 5.
  - Replacing the SHA-based vocabulary throughout — Phase 1 (platform_version).
  ```

- [ ] **Step 3: Commit**

  ```
  git add docs/superpowers/decisions/2026-05-23-self-upgrade-substrate-consolidation.md
  git commit -s docs/superpowers/decisions/2026-05-23-self-upgrade-substrate-consolidation.md -m "docs(decision): record Phase 0 self-upgrade substrate consolidation

  ADR capturing the post-Phase-0 state: one Inngest family, schema-aligned
  DTO, observable null-target. Future phases unblocked.

  Refs: BI-5B3FA415, spec §2.2"
  ```

---

### Phase 0 verification gate

Before moving to Phase 1, run the full test suite and confirm zero new failures:

- [ ] `pnpm typecheck` — must pass clean
- [ ] `pnpm --filter web test` — must pass clean (or only show pre-existing failures noted in pre-flight)
- [ ] `pnpm --filter @dpf/db test` — must pass clean
- [ ] Manual verification (do this yourself, do not ask the user): start the dev portal (`pnpm dev:portal`) and load `/ops/self-upgrade`. The page must render without server-action errors and the history table must list runs (or empty state) without throwing.

If any of the above fails, stop and investigate. Do not proceed to Phase 1 with a regressed substrate.

---

## Phase 1 — Versioning Baseline

The goal of Phase 1 is **establishing a single canonical platform version** that the runtime, API, and Admin UI all read from one source. Phase 1 does **not** implement automatic bumping (Phase 2) or channel feeds (Phase 2). It only declares "this install is on version X" and exposes that consistently.

### Task 8: Add `version.json` at repo root with baseline v1.0.0

**Files:**
- Create: `version.json`

- [ ] **Step 1: Write `version.json`**

  At the repository root, create `version.json`:

  ```json
  {
    "version": "1.0.0",
    "publishedAt": "2026-05-23T00:00:00Z",
    "note": "Phase 1 baseline — first explicit platform version. See docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §4.2."
  }
  ```

  Use the current UTC date for `publishedAt`. Bump-to-2.0.0 automation is Phase 2 — this file is hand-edited until then.

- [ ] **Step 2: Verify the file is valid JSON**

  ```
  node -e "console.log(JSON.parse(require('fs').readFileSync('version.json','utf8')))"
  ```

- [ ] **Step 3: Commit**

  ```
  git add version.json
  git commit -s version.json -m "feat(platform): baseline platform version 1.0.0

  Introduces version.json at repo root as the canonical platform version
  source. Phase 1 of the governed upgrade lifecycle: every install boot
  reads this; /api/platform/version returns it; Admin UI displays it.

  Future bumps are hand-edited until Phase 2 CI automation lands.

  Refs: BI-5B3FA415, spec §4.1, §4.2"
  ```

---

### Task 9: Implement the platform-version loader

**Files:**
- Create: `apps/web/lib/platform/version.ts`
- Create: `apps/web/lib/platform/version.test.ts`

- [ ] **Step 1: Write the failing test**

  ```ts
  import { describe, it, expect, vi, afterEach } from "vitest";

  describe("loadPlatformVersion", () => {
    afterEach(() => vi.resetModules());

    it("reads version.json from the repo root and returns version/publishedAt", async () => {
      const { loadPlatformVersion } = await import("./version");
      const v = await loadPlatformVersion();
      expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(v.publishedAt).toBeInstanceOf(Date);
    });

    it("includes gitSha from DEPLOYED_SHA env when set", async () => {
      vi.stubEnv("DEPLOYED_SHA", "abc1234567890abcdef1234567890abcdef12345");
      const { loadPlatformVersion } = await import("./version");
      const v = await loadPlatformVersion();
      expect(v.gitSha).toBe("abc1234567890abcdef1234567890abcdef12345");
      vi.unstubAllEnvs();
    });

    it("returns null gitSha when DEPLOYED_SHA is unset", async () => {
      vi.stubEnv("DEPLOYED_SHA", "");
      const { loadPlatformVersion } = await import("./version");
      const v = await loadPlatformVersion();
      expect(v.gitSha).toBeNull();
      vi.unstubAllEnvs();
    });

    it("memoizes the result across calls", async () => {
      const { loadPlatformVersion } = await import("./version");
      const a = await loadPlatformVersion();
      const b = await loadPlatformVersion();
      expect(a).toBe(b); // same object reference
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  pnpm --filter web test -- --run apps/web/lib/platform/version.test.ts
  ```

- [ ] **Step 3: Implement the loader**

  Create `apps/web/lib/platform/version.ts`:

  ```ts
  import { readFile } from "node:fs/promises";
  import { resolve } from "node:path";

  export type PlatformVersion = {
    version: string;
    publishedAt: Date;
    gitSha: string | null;
  };

  let cached: Promise<PlatformVersion> | null = null;

  /**
   * Reads version.json from the repo root and returns the canonical platform
   * version. Memoized for the lifetime of the process. gitSha is read from the
   * DEPLOYED_SHA env var if set (populated by the deploy pipeline); null in
   * dev or when running outside a self-upgrade context.
   *
   * See docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §4.1
   */
  export async function loadPlatformVersion(): Promise<PlatformVersion> {
    if (!cached) {
      cached = (async () => {
        const path = resolveVersionJsonPath();
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw) as { version: string; publishedAt: string };
        const envSha = process.env.DEPLOYED_SHA;
        return {
          version: parsed.version,
          publishedAt: new Date(parsed.publishedAt),
          gitSha: envSha && envSha.length > 0 ? envSha : null,
        };
      })();
    }
    return cached;
  }

  /** Test-only: reset the memoized value. */
  export function resetPlatformVersionCacheForTests(): void {
    cached = null;
  }

  function resolveVersionJsonPath(): string {
    // version.json lives at the monorepo root. process.cwd() under the
    // Next.js server is the apps/web package directory; under pnpm
    // workspace scripts it can be either. existsSync-based fallback is
    // overkill for a one-time-per-process read; the path is stable.
    //
    // Both vitest (per workspace config) and `next start` run with cwd
    // at apps/web, so "../../version.json" resolves to the monorepo root.
    return resolve(process.cwd(), "../../version.json");
  }
  ```

  Note: this assumes vitest and the Next runtime both run with cwd at `apps/web`. Verify by logging `process.cwd()` in the test if path resolution fails; if your harness uses monorepo-root cwd, drop the `../../` prefix. Do NOT hardcode an absolute path.

- [ ] **Step 4: Run the test to verify it passes**

  ```
  pnpm --filter web test -- --run apps/web/lib/platform/version.test.ts
  ```

  If path resolution fails, log `process.cwd()` in the test and adjust the `resolve()` argument accordingly.

- [ ] **Step 5: Commit**

  ```
  git add apps/web/lib/platform/version.ts apps/web/lib/platform/version.test.ts
  git commit -s apps/web/lib/platform/version.ts apps/web/lib/platform/version.test.ts -m "feat(platform): loader for canonical platform version

  Reads version.json from repo root, memoized per process. gitSha sourced
  from DEPLOYED_SHA env (populated by deploy pipeline; null in dev).

  Refs: BI-5B3FA415, spec §4.1"
  ```

---

### Task 10: Expose `/api/platform/version` endpoint

**Files:**
- Create: `apps/web/app/api/platform/version/route.ts`
- Create: `apps/web/app/api/platform/version/route.test.ts`

- [ ] **Step 1: Write the failing test**

  ```ts
  import { describe, it, expect } from "vitest";
  import { GET } from "./route";

  describe("GET /api/platform/version", () => {
    it("returns version, publishedAt, and gitSha as JSON", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(typeof body.publishedAt).toBe("string");
      expect("gitSha" in body).toBe(true);
    });

    it("has cache headers preventing stale responses", async () => {
      const res = await GET();
      // Version is small + cheap; clients can poll. We want no edge caching
      // of stale values across deploys.
      expect(res.headers.get("cache-control")).toMatch(/no-store|no-cache/);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  pnpm --filter web test -- --run apps/web/app/api/platform/version/route.test.ts
  ```

- [ ] **Step 3: Implement the route**

  Create `apps/web/app/api/platform/version/route.ts`:

  ```ts
  import { NextResponse } from "next/server";
  import { loadPlatformVersion } from "@/lib/platform/version";

  /**
   * Public read of the canonical platform version. No auth — the install's
   * version is not sensitive. See spec §4.1, §5.1.
   */
  export async function GET() {
    const v = await loadPlatformVersion();
    return NextResponse.json(
      {
        version: v.version,
        publishedAt: v.publishedAt.toISOString(),
        gitSha: v.gitSha,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  ```
  pnpm --filter web test -- --run apps/web/app/api/platform/version/route.test.ts
  ```

- [ ] **Step 5: Commit**

  ```
  git add apps/web/app/api/platform/version/route.ts apps/web/app/api/platform/version/route.test.ts
  git commit -s apps/web/app/api/platform/version/route.ts apps/web/app/api/platform/version/route.test.ts -m "feat(platform): /api/platform/version endpoint

  Public read of canonical platform version. Used by Admin UI (Task 11)
  and reserved for future external introspection (e.g. hive scout, beta
  channel telemetry).

  Refs: BI-5B3FA415, spec §4.1, §5.1"
  ```

---

### Task 11: Surface platform version in `/ops/self-upgrade`

**Files:**
- Modify: `apps/web/components/ops/SelfUpgradePanel.tsx` (add a "Platform Version" row near the top)
- OR: Modify: `apps/web/components/ops/SelfUpgradeClient.tsx` if it owns the header area

(Choose based on which component owns the page header — read both to decide.)

- [ ] **Step 1: Read both components to identify the header section**

  Use Read tool on:
  - `apps/web/components/ops/SelfUpgradeClient.tsx`
  - `apps/web/components/ops/SelfUpgradePanel.tsx`

  Decide which file owns the section above the runs table.

- [ ] **Step 2: Write the failing test**

  Create or modify a test file alongside the chosen component, e.g. `apps/web/components/ops/SelfUpgradePanel.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { SelfUpgradePanel } from "./SelfUpgradePanel";

  // Mock the version loader at the action layer used by the panel
  vi.mock("@/lib/platform/version", () => ({
    loadPlatformVersion: async () => ({
      version: "1.0.0",
      publishedAt: new Date("2026-05-23T00:00:00Z"),
      gitSha: "abc1234",
    }),
  }));

  describe("SelfUpgradePanel header", () => {
    it("displays the current platform version", async () => {
      const ui = await SelfUpgradePanel({ /* required props */ });
      render(ui);
      expect(screen.getByText(/Platform version/i)).toBeInTheDocument();
      expect(screen.getByText("1.0.0")).toBeInTheDocument();
    });
  });
  ```

  If `SelfUpgradePanel` is a server component that takes data via props rather than fetching, pass the version through a new prop instead of mocking the loader.

- [ ] **Step 3: Run the test to verify it fails**

  ```
  pnpm --filter web test -- --run apps/web/components/ops/SelfUpgradePanel.test.tsx
  ```

- [ ] **Step 4: Add the header row to the component**

  Edit the chosen component to display `Platform version: <version>` (and optionally `Git SHA: <gitSha.slice(0,7)>` when present) near the top, above the runs table. Style consistent with the existing panel.

- [ ] **Step 5: Run the test to verify it passes**

  ```
  pnpm --filter web test -- --run apps/web/components/ops/SelfUpgradePanel.test.tsx
  ```

- [ ] **Step 6: Manual verification**

  Start the dev portal: `pnpm dev:portal`. Open `/ops/self-upgrade`. Confirm the version shows `1.0.0` in the panel header. Take a screenshot for the commit message reference.

- [ ] **Step 7: Commit**

  ```
  git add apps/web/components/ops/SelfUpgradePanel.tsx apps/web/components/ops/SelfUpgradePanel.test.tsx
  git commit -s apps/web/components/ops/SelfUpgradePanel.tsx apps/web/components/ops/SelfUpgradePanel.test.tsx -m "feat(ops): show platform version in /ops/self-upgrade header

  Closes the spec §9 acceptance criterion 'answer to what version am I on
  is identical from UI, API, manifest, git tag' for the UI + API legs.
  Manifest + tag legs are Phase 2.

  Refs: BI-5B3FA415, spec §4.1, §9"
  ```

---

### Phase 1 verification gate

Before moving to Phase 2, confirm the four sources agree:

- [ ] `cat version.json` → version field
- [ ] `curl http://localhost:3000/api/platform/version` (with dev portal running) → version field matches
- [ ] `/ops/self-upgrade` UI → displays the same version
- [ ] (Future: git tag will agree once Phase 2 ships)

- [ ] Run the full test suite:
  ```
  pnpm typecheck
  pnpm --filter web test
  pnpm --filter @dpf/db test
  ```

- [ ] Per `feedback_run_full_tests_before_push.md`, also run vitest at root if there's a root config:
  ```
  pnpm test
  ```

  All green before opening the PR.

---

## Phase 2 — Release CI + Channel Manifest (high-level only)

Phase 2 is substantial CI/infrastructure work. **Recommend writing Phase 2 as its own plan** in a separate session once Phase 0+1 ships, because:

1. It touches GitHub Actions infrastructure (new config + secrets).
2. It introduces release signing (Sigstore decision per spec §11.2).
3. It introduces the gh-pages branch as the channel manifest host (spec §11.1).
4. It needs operator decisions on the open questions in spec §11.

**Phase 2 task headlines (not yet expanded to bite-sized steps):**

- Task 12: Conventional-commit lint + PR-label fallback (`.github/workflows/commit-lint.yml`)
- Task 13: Release workflow on push to main (`.github/workflows/release.yml`) — bump version.json, tag, push tag
- Task 14: Build bundle artifact + checksum + signature
- Task 15: Publish GitHub Release with artifacts + auto-generated notes
- Task 16: Migration kind classifier (additive/modifying/destructive from SQL parse)
- Task 17: Seed-delta manifest generator (hash shipped content per Q6 fingerprint patterns)
- Task 18: Channel manifest schema + `edge.json` publisher (gh-pages branch)
- Task 19: Wire `resolveTargetSha` to fetch+verify the channel manifest (closes the Phase 0 TODO from Task 6)

When you reach Phase 2, dispatch a fresh writing-plans run with this section as input.

---

## Execution Handoff

Recommended execution mode per [superpowers:subagent-driven-development](../../Reference/superpowers/prompts/subagent-driven-development.md):

- **One subagent per task**, fresh context each time
- **Operator review between tasks** — particularly between Task 5 (deletions) and Task 6 (resolveTargetSha log)
- **Hard checkpoint at the Phase 0 verification gate** before Phase 1 begins
- **Hard checkpoint at the Phase 1 verification gate** before opening the PR

If you prefer inline execution, run tasks sequentially in the same session, but pause at the two verification gates for operator confirmation.

## PR opening

After all tasks in Phase 0+1 are committed and both verification gates pass:

- [ ] Sweep `git log origin/main..HEAD --oneline` and confirm only your commits are present (no concurrent-session sweep).
- [ ] Per `feedback_pr_overlap_check_before_pushing.md`, search recent main commits + open PRs for any concurrent work on `apps/web/lib/self-upgrade/` or `apps/web/lib/queue/functions/self-upgrade*`. Surface conflicts to operator before pushing.
- [ ] Push branch.
- [ ] Open PR with title: `feat(platform): governed-upgrade Phase 0+1 — substrate consolidation and version baseline`
- [ ] PR body should reference spec, BI, and link to this plan.

---

## Notes for the executor

- **Never ask the operator to run commands.** Every step here is something you run yourself. If a command fails, debug it; if you can't, report concrete output to the operator.
- **DCO sign-off is mandatory** on every commit (`-s` flag). Per `feedback_dco_signoff_required.md`.
- **Scope commits with positional path args** per `feedback_git_commit_only_for_concurrent_sessions.md` — concurrent sessions can sweep staged files into your commit otherwise.
- **Do not skip the test-first pattern** even for "obvious" deletions. The characterization tests in Task 1 and the failing test in Task 2 are what give us confidence the deletions are safe.
- **Frequent commits** — every task is one logical commit. Do not batch.
