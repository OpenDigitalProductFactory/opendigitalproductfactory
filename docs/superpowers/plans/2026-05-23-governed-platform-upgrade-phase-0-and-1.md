# Governed Platform Upgrade — Phase 0 (Substrate Cleanup) + Phase 1 (Versioning Baseline) Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the split self-upgrade code path so there is exactly one runnable upgrade flow with consistent DTO vocabulary, then introduce a first-class `platform.version` concept whose canonical source is `version.json` and whose runtime mirror, API, and `/ops/self-upgrade` UI all agree.

**Architecture:** Phase 0 deletes the legacy `portal-self-upgrade.ts` Inngest function family (currently registered but calling deprecated stubs) and aligns the `listSelfUpgradeRuns` action + `SelfUpgradeClient.tsx` UI to the actual `SelfUpgradeRun` Prisma schema column names. Phase 1 adds a canonical `version.json` at the repo root, copies it into the Docker image, loads and validates it through `apps/web/lib/platform/version.ts`, mirrors it to `PlatformConfig["platform.version"]` on boot, exposes it through `/api/platform/version`, and surfaces the same value in `/ops/self-upgrade`. No new dependencies; all changes are TDD with vitest.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Prisma + Postgres (`@dpf/db`), Inngest for queues, vitest + `@testing-library/jest-dom` for tests, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md) (committed at `0bc912ed`)

**Backlog item:** `BI-5B3FA415`

**Live backlog check:** 2026-05-24 via DPF MCP: `BI-5B3FA415` is `triaging`, type `portfolio`, not linked to an epic, and there is no current open platform-upgrade epic to extend. Re-check this before execution; do not rely on this snapshot if the backlog has moved.

**Architectural review corrections baked into this plan:**
- Phase 1 is not complete until `PlatformConfig["platform.version"]` is written from the same `version.json` source as the API and UI. A UI/API-only implementation would make the spec look complete while leaving runtime state unqueryable.
- `SelfUpgradeRun.currentSha` / `targetSha` stay SHA-named in Phase 0+1. Do not rename them to version vocabulary until channel manifests and version-bearing runs exist.
- The current route at `/ops/self-upgrade` renders `SelfUpgradeClient`; `SelfUpgradePanel` exists but is not used by this route today. Update the rendered route unless you deliberately migrate the route in the same task.
- Reserve roughly the first 20% of implementation attention for refactoring and deletion: remove the legacy substrate, collapse duplicate DTO vocabulary, and keep the version loader/API/UI path small and reusable before adding display polish.

---

## Pre-flight checks (do these before Task 1)

- [ ] Confirm you are on a fresh branch off `origin/main`:
  ```
  git fetch origin
  git status --short --branch
  git log origin/main..HEAD --oneline   # should show only the spec commit if continuing this worktree
  ```
  If the worktree is dirty, classify the changes before continuing and leave unrelated files untouched. If the branch is `main` or detached, stop and create/switch to a topic branch first. If the branch tracks `origin/main` directly, set an upstream branch for the topic before the first push.
- [ ] Re-check live backlog through DPF MCP before executing:
  - `list_backlog_items` filtered to `triaging` (confirm `BI-5B3FA415` status and epic link).
  - `list_epics` filtered to open epics (confirm no overlapping platform-upgrade epic appeared).
  If MCP is unavailable, use live DB fallback and say so in the evidence note. Do not use seed files or docs as backlog truth.
- [ ] Confirm vitest runs clean for the existing self-upgrade coverage:
  ```
  pnpm --filter web test -- --run apps/web/lib/self-upgrade
  pnpm --filter web test -- --run apps/web/lib/queue/functions/self-upgrade.test.ts
  pnpm --filter web test -- --run apps/web/lib/queue/functions/portal-self-upgrade.test.ts
  pnpm --filter web test -- --run apps/web/lib/actions/promotions.self-upgrade.test.ts
  ```
  Note any pre-existing failures so they're not attributed to your changes.
- [ ] Confirm Prisma client is generated:
  ```
  pnpm --filter @dpf/db generate
  ```
- [ ] Confirm the exact runtime stack before editing:
  ```
  pnpm --filter web exec next --version
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

### Task 2: Convert existing `listSelfUpgradeRuns` tests into the DTO-drift reproducer

**Why:** `apps/web/lib/actions/promotions.ts:561-570` selects `triggeredBy`, `fromVersion`, `toVersion`, `error` from `prisma.selfUpgradeRun.findMany`, but the `SelfUpgradeRun` model in `packages/db/prisma/schema.prisma:4971` has columns `trigger`, `currentSha`, `targetSha`, `failureLog`. This is a runtime bug — the query will throw `PrismaClientValidationError`. We write the failing test first.

**Files:**
- Modify: `apps/web/lib/actions/promotions.self-upgrade.test.ts` (already exists)

- [ ] **Step 1: Update the existing DTO fixtures and select assertions**

  In `apps/web/lib/actions/promotions.self-upgrade.test.ts`, replace the self-upgrade run fixtures and DTO shape expectations so they use the Prisma schema column names:

  ```ts
  const mockRunRow1 = {
    runId: "SUR-AAAA0001",
    status: "succeeded",
    trigger: "scheduled",
    currentSha: "abc1234",
    targetSha: "def5678",
    deployedSha: "def5678",
    startedAt: new Date("2026-05-20T02:00:00Z"),
    completedAt: new Date("2026-05-20T02:05:00Z"),
    failureLog: null,
    createdAt: new Date("2026-05-20T02:00:00Z"),
  };
  ```

  Update the DTO-shape test to assert `trigger`, `currentSha`, `targetSha`, `deployedSha`, and `failureLog`, and assert the `select` object includes those fields while excluding the old `triggeredBy`, `fromVersion`, `toVersion`, and `error` properties. This existing test file already has auth mocks; do not create a second narrower reproducer.

- [ ] **Step 2: Run test to verify it fails on the stale select clause**

  ```
  pnpm --filter web test -- --run apps/web/lib/actions/promotions.self-upgrade.test.ts
  ```

  Expect the DTO/select assertion to fail because `promotions.ts` still selects `triggeredBy`, `fromVersion`, `toVersion`, and `error`. The Prisma runtime error is the production symptom; the unit test should pin the bad select without requiring a live database.

  If the test PASSES, stop — the schema may have been migrated between this plan and now. Re-read `packages/db/prisma/schema.prisma:4971` and adjust Task 3 accordingly.

- [ ] **Step 3: Keep the red test uncommitted and continue directly to Task 3**

  Do not push a deliberately red commit. Task 2 is the TDD red step; Task 3 is the green step. Commit the test and implementation together once the action, UI consumers, and tests pass.

---

### Task 3: Align `listSelfUpgradeRuns` and `SelfUpgradeRunDto` to schema column names

**Files:**
- Modify: `apps/web/lib/actions/promotions.ts:536-578`
- Modify (if it references the DTO): `apps/web/components/ops/SelfUpgradeClient.tsx`
- Modify: `apps/web/components/ops/SelfUpgradeClient.test.tsx` — this exists today and almost certainly references the renamed DTO fields; update it in lockstep with the component
- Modify: `apps/web/app/(shell)/ops/self-upgrade/page.test.tsx` — its typed fixture imports `SelfUpgradeRunDto`; update it with the same schema-aligned fields

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

  Open `apps/web/components/ops/SelfUpgradeClient.tsx`, `apps/web/components/ops/SelfUpgradeClient.test.tsx`, and `apps/web/app/(shell)/ops/self-upgrade/page.test.tsx`. Find references to `triggeredBy`, `fromVersion`, `toVersion`, `error` from `SelfUpgradeRunDto`. Replace:
  - `run.triggeredBy` → `run.trigger`
  - `run.fromVersion` → `run.currentSha`
  - `run.toVersion` → `run.targetSha`
  - `run.error` → `run.failureLog`

  Display labels can stay user-friendly (`"Triggered by"`, `"From version"`, etc. on screen) — only the property accesses change.

- [ ] **Step 4: Run the existing action test to verify it now passes**

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
  git add apps/web/lib/actions/promotions.ts apps/web/lib/actions/promotions.self-upgrade.test.ts apps/web/components/ops/SelfUpgradeClient.tsx apps/web/components/ops/SelfUpgradeClient.test.tsx "apps/web/app/(shell)/ops/self-upgrade/page.test.tsx"
  git commit -s apps/web/lib/actions/promotions.ts apps/web/lib/actions/promotions.self-upgrade.test.ts apps/web/components/ops/SelfUpgradeClient.tsx apps/web/components/ops/SelfUpgradeClient.test.tsx "apps/web/app/(shell)/ops/self-upgrade/page.test.tsx" -m "fix(promotions): align SelfUpgradeRunDto to SelfUpgradeRun schema columns

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
- Modify: `apps/web/lib/self-upgrade/promoter.test.ts` (remove or rewrite tests that only cover the deprecated legacy API)
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
  git rm apps/web/lib/queue/functions/portal-self-upgrade.ts
  git rm apps/web/lib/queue/functions/portal-self-upgrade.test.ts
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
  git add -u apps/web/lib/queue/functions apps/web/lib/self-upgrade apps/web/lib/actions/self-upgrade.ts
  git commit -s apps/web/lib/queue/functions apps/web/lib/self-upgrade apps/web/lib/actions/self-upgrade.ts -m "chore(self-upgrade): delete deprecated stubs and legacy promoter API

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
    remains deferred until channel manifests and version-bearing runs exist.

  ## Out of scope (handled in later phases)

  - Implementing `resolveTargetSha` — Phase 2 (channel manifest).
  - Wiring `emitUpgradeEvent` to a real event bus — Phase 5 (graceful recycle).
  - Replacing the 5-min activity defer with a graceful drain protocol — Phase 5.
  - Replacing SHA-based run vocabulary throughout — later phase after channel manifests.
  - Publishing the install's platform version — Phase 1 (`platform.version`).
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
- [ ] `pnpm --filter web build` — must pass clean; this is the only local gate that reliably catches Next/TypeScript route build errors.
- [ ] Manual verification (do this yourself, do not ask the user): rebuild/restart the Docker-served portal path per AGENTS.md, authenticate as `admin@dpf.local` using `ADMIN_PASSWORD` from repo-root `.env`, and load `/ops/self-upgrade`. The page must render without server-action errors and the history table must list runs (or empty state) without throwing.

If any of the above fails, stop and investigate. Do not proceed to Phase 1 with a regressed substrate.

---

## Phase 1 — Versioning Baseline

The goal of Phase 1 is **establishing a single canonical platform version** that the runtime mirror, API, and `/ops/self-upgrade` UI all derive from one source. Phase 1 does **not** implement automatic bumping (Phase 2) or channel feeds (Phase 2). It only declares "this install is on version X" and exposes that consistently.

### Task 8: Add `version.json` at repo root with baseline v1.0.0

**Files:**
- Create: `version.json`
- Modify: `Dockerfile` (copy `version.json` into the runner image)

- [ ] **Step 1: Write `version.json`**

  At the repository root, create `version.json`. Use the current UTC timestamp when executing this task; the timestamp below is an example shape, not a stale fixed value:

  ```json
  {
    "version": "1.0.0",
    "publishedAt": "2026-05-24T00:00:00Z",
    "note": "Phase 1 baseline - first explicit platform version. See docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §4.2."
  }
  ```

  Bump automation is Phase 2. Until then, this file is hand-edited by the release operator/agent.

- [ ] **Step 2: Verify the file is valid JSON**

  ```
  node -e "console.log(JSON.parse(require('fs').readFileSync('version.json','utf8')))"
  ```

- [ ] **Step 3: Copy `version.json` into the production runner image**

  In `Dockerfile`, copy the root `version.json` into `/app/version.json` in the `runner` stage. The loader in Task 9 must work inside the Docker-served portal, not only in a workspace checkout.

  Recommended placement: near the existing `COPY --from=init /app/pnpm-workspace.yaml ...` runner-stage copies:

  ```dockerfile
  COPY version.json ./version.json
  ```

  This is a deliberate cache boundary: a version bump should invalidate the runtime image layer that carries runtime metadata.

- [ ] **Step 4: Commit**

  ```
  git add version.json Dockerfile
  git commit -s version.json Dockerfile -m "feat(platform): baseline platform version 1.0.0

  Introduces version.json at repo root as the canonical platform version
  source and bakes it into the portal image. Phase 1 of the governed
  upgrade lifecycle: every install boot reads this, /api/platform/version
  returns it, and /ops/self-upgrade displays it.

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
  import { afterEach, describe, expect, it, vi } from "vitest";
  import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";

  describe("loadPlatformVersion", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it("reads version.json and returns a validated version/publishedAt", async () => {
      const dir = mkdtempSync(join(tmpdir(), "dpf-version-test-"));
      const path = join(dir, "version.json");
      writeFileSync(path, JSON.stringify({
        version: "1.0.0",
        publishedAt: "2026-05-24T00:00:00.000Z",
        note: "test",
      }));
      vi.stubEnv("DPF_VERSION_FILE", path);

      const { loadPlatformVersion } = await import("./version");
      const v = await loadPlatformVersion();
      expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(v.publishedAt).toBeInstanceOf(Date);

      rmSync(dir, { recursive: true, force: true });
    });

    it("includes gitSha from DEPLOYED_SHA when present", async () => {
      vi.stubEnv("DEPLOYED_SHA", "abc1234567890abcdef1234567890abcdef12345");
      const { loadPlatformVersion } = await import("./version");
      const v = await loadPlatformVersion();
      expect(v.gitSha).toBe("abc1234567890abcdef1234567890abcdef12345");
    });

    it("returns null gitSha when DEPLOYED_SHA is unset", async () => {
      vi.stubEnv("DEPLOYED_SHA", "");
      const { loadPlatformVersion } = await import("./version");
      const v = await loadPlatformVersion();
      expect(v.gitSha).toBeNull();
    });

    it("throws a useful error for invalid semver", async () => {
      const dir = mkdtempSync(join(tmpdir(), "dpf-version-test-"));
      const path = join(dir, "version.json");
      writeFileSync(path, JSON.stringify({ version: "latest", publishedAt: "2026-05-24T00:00:00.000Z" }));
      vi.stubEnv("DPF_VERSION_FILE", path);

      const { loadPlatformVersion } = await import("./version");
      await expect(loadPlatformVersion()).rejects.toThrow(/Invalid platform version/);

      rmSync(dir, { recursive: true, force: true });
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
  import { existsSync } from "node:fs";
  import { readFile } from "node:fs/promises";
  import { resolve } from "node:path";
  import { readImageVersion } from "./image-version";

  export type PlatformVersion = {
    version: string;
    publishedAt: Date;
    gitSha: string | null;
    note: string | null;
  };

  let cached: Promise<PlatformVersion> | null = null;
  const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  /**
   * Reads version.json from the repo root and returns the canonical platform
   * version. Memoized for the lifetime of the process. gitSha is read from
   * DEPLOYED_SHA when set, then from the existing image-version helper when
   * the baked image marker is a git SHA; null in dev/content-hash builds.
   *
   * See docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §4.1
   */
  export async function loadPlatformVersion(): Promise<PlatformVersion> {
    if (!cached) {
      cached = (async () => {
        const path = resolveVersionJsonPath();
        const raw = await readFile(path, "utf8");
        const parsed = parseVersionJson(JSON.parse(raw));
        const image = await readImageVersion();
        const envSha = process.env.DEPLOYED_SHA;
        return {
          version: parsed.version,
          publishedAt: new Date(parsed.publishedAt),
          gitSha:
            envSha && envSha.length > 0
              ? envSha
              : image?.source === "git-sha"
                ? image.raw
                : null,
          note: parsed.note ?? null,
        };
      })();
    }
    return cached;
  }

  /** Test-only: reset the memoized value. */
  export function resetPlatformVersionCacheForTests(): void {
    cached = null;
  }

  function parseVersionJson(raw: unknown): { version: string; publishedAt: string; note?: string } {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid platform version: version.json must be an object");
    }
    const value = raw as Record<string, unknown>;
    if (typeof value.version !== "string" || !SEMVER_RE.test(value.version)) {
      throw new Error("Invalid platform version: version must be SemVer");
    }
    if (typeof value.publishedAt !== "string" || Number.isNaN(Date.parse(value.publishedAt))) {
      throw new Error("Invalid platform version: publishedAt must be an ISO timestamp");
    }
    return {
      version: value.version,
      publishedAt: value.publishedAt,
      note: typeof value.note === "string" ? value.note : undefined,
    };
  }

  function resolveVersionJsonPath(): string {
    const candidates = [
      process.env.DPF_VERSION_FILE,
      resolve(process.cwd(), "version.json"),
      resolve(process.cwd(), "../../version.json"),
      "/app/version.json",
    ].filter((value): value is string => Boolean(value));

    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new Error(`version.json not found; checked ${candidates.join(", ")}`);
    }
    return found;
  }
  ```

  Do not hardcode a developer-machine absolute path. The loader must work in three contexts: `pnpm --filter web test` (`cwd=apps/web`), root workspace commands (`cwd` at repo root), and the Docker runner (`/app/version.json`).

- [ ] **Step 4: Run the test to verify it passes**

  ```
  pnpm --filter web test -- --run apps/web/lib/platform/version.test.ts
  ```

  If path resolution fails, log `process.cwd()` in the test and adjust the `resolve()` argument accordingly.

- [ ] **Step 5: Commit**

  ```
  git add apps/web/lib/platform/version.ts apps/web/lib/platform/version.test.ts
  git commit -s apps/web/lib/platform/version.ts apps/web/lib/platform/version.test.ts -m "feat(platform): loader for canonical platform version

  Reads version.json from repo root or the runner image, memoized per process.
  gitSha is sourced from DEPLOYED_SHA when set, otherwise from the existing
  image-version marker when it is git-SHA shaped.

  Refs: BI-5B3FA415, spec §4.1"
  ```

---

### Task 9b: Mirror platform version into `PlatformConfig` on boot

**Files:**
- Create: `apps/web/lib/platform/version-config.ts`
- Create: `apps/web/lib/platform/version-config.test.ts`
- Modify: `apps/web/instrumentation.ts`
- Modify: `apps/web/instrumentation.test.ts`

**Why:** The spec requires `PlatformConfig["platform.version"]` to be the runtime mirror. Without this task, Phase 1 would expose a version through API/UI but leave live runtime state unable to answer the same question through the database.

- [ ] **Step 1: Write the failing mirror test**

  Create `apps/web/lib/platform/version-config.test.ts` with a narrow dependency-injection test. Do not hit a real database.

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { syncPlatformVersionConfig, PLATFORM_VERSION_CONFIG_KEY } from "./version-config";

  describe("syncPlatformVersionConfig", () => {
    it("upserts PlatformConfig platform.version from loaded version metadata", async () => {
      const upsert = vi.fn().mockResolvedValue({});

      await syncPlatformVersionConfig({
        load: async () => ({
          version: "1.0.0",
          publishedAt: new Date("2026-05-24T00:00:00.000Z"),
          gitSha: "abc123",
          note: "baseline",
        }),
        platformConfig: { upsert },
      });

      expect(upsert).toHaveBeenCalledWith({
        where: { key: PLATFORM_VERSION_CONFIG_KEY },
        update: {
          value: {
            version: "1.0.0",
            publishedAt: "2026-05-24T00:00:00.000Z",
            gitSha: "abc123",
            note: "baseline",
            source: "version.json",
          },
        },
        create: {
          key: PLATFORM_VERSION_CONFIG_KEY,
          value: {
            version: "1.0.0",
            publishedAt: "2026-05-24T00:00:00.000Z",
            gitSha: "abc123",
            note: "baseline",
            source: "version.json",
          },
        },
      });
    });
  });
  ```

- [ ] **Step 2: Implement the mirror helper**

  Create `apps/web/lib/platform/version-config.ts`:

  ```ts
  import { loadPlatformVersion, type PlatformVersion } from "./version";

  export const PLATFORM_VERSION_CONFIG_KEY = "platform.version";

  type PlatformConfigHandle = {
    upsert: (args: {
      where: { key: string };
      update: { value: Record<string, unknown> };
      create: { key: string; value: Record<string, unknown> };
    }) => Promise<unknown>;
  };

  export async function syncPlatformVersionConfig(deps?: {
    load?: () => Promise<PlatformVersion>;
    platformConfig?: PlatformConfigHandle;
  }): Promise<void> {
    const load = deps?.load ?? loadPlatformVersion;
    const platformConfig = deps?.platformConfig ?? (await import("@dpf/db")).prisma.platformConfig;
    const version = await load();
    const value = {
      version: version.version,
      publishedAt: version.publishedAt.toISOString(),
      gitSha: version.gitSha,
      note: version.note,
      source: "version.json",
    };

    await platformConfig.upsert({
      where: { key: PLATFORM_VERSION_CONFIG_KEY },
      update: { value },
      create: { key: PLATFORM_VERSION_CONFIG_KEY, value },
    });
  }
  ```

- [ ] **Step 3: Wire startup sync through instrumentation**

  In `apps/web/instrumentation.ts`, export a small helper so the behavior is unit-testable without invoking the full `register()` startup routine:

  ```ts
  export async function syncPlatformVersionOnBoot(
    logger: Pick<Console, "log" | "error"> = console,
  ): Promise<boolean> {
    try {
      const { syncPlatformVersionConfig } = await import("@/lib/platform/version-config");
      await syncPlatformVersionConfig();
      logger.log("[platform-version] Synced PlatformConfig platform.version");
      return true;
    } catch (err) {
      logger.error("[platform-version] Failed to sync PlatformConfig platform.version:", err);
      return false;
    }
  }
  ```

  Call `void syncPlatformVersionOnBoot();` near the top of `register()` after `warnIfLegacyHiveTokenEnvSet();`. Keep it non-fatal for dev/test startup, but fail loud in logs. The API and loader still throw if `version.json` is invalid.

- [ ] **Step 4: Add instrumentation unit tests**

  In `apps/web/instrumentation.test.ts`, mock `@/lib/platform/version-config` and test both success and failure paths for `syncPlatformVersionOnBoot`.

- [ ] **Step 5: Run tests**

  ```
  pnpm --filter web test -- --run apps/web/lib/platform/version-config.test.ts
  pnpm --filter web test -- --run apps/web/instrumentation.test.ts
  ```

- [ ] **Step 6: Commit**

  ```
  git add apps/web/lib/platform/version-config.ts apps/web/lib/platform/version-config.test.ts apps/web/instrumentation.ts apps/web/instrumentation.test.ts
  git commit -s apps/web/lib/platform/version-config.ts apps/web/lib/platform/version-config.test.ts apps/web/instrumentation.ts apps/web/instrumentation.test.ts -m "feat(platform): mirror platform version into PlatformConfig on boot

  Syncs PlatformConfig[platform.version] from the canonical version.json
  loader during startup. This closes the runtime-state leg of Phase 1 so
  API, UI, and DB-backed runtime metadata agree.

  Refs: BI-5B3FA415, spec §4.1"
  ```

---

### Task 10: Expose `/api/platform/version` endpoint

**Files:**
- Create: `apps/web/app/api/platform/version/route.ts`
- Create: `apps/web/app/api/platform/version/route.test.ts`

- [ ] **Step 1: Write the failing test**

  ```ts
  import { describe, it, expect, vi } from "vitest";

  vi.mock("@/lib/platform/version", () => ({
    loadPlatformVersion: async () => ({
      version: "1.0.0",
      publishedAt: new Date("2026-05-24T00:00:00.000Z"),
      gitSha: "abc123",
      note: "baseline",
    }),
  }));

  import { GET } from "./route";

  describe("GET /api/platform/version", () => {
    it("returns version, publishedAt, gitSha, and note as JSON", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        version: "1.0.0",
        publishedAt: "2026-05-24T00:00:00.000Z",
        gitSha: "abc123",
        note: "baseline",
      });
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

  export const dynamic = "force-dynamic";
  export const revalidate = 0;

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
        note: v.note,
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

  Public read of canonical platform version. Used by /ops/self-upgrade
  (Task 11) and reserved for future external introspection (e.g. hive scout,
  beta channel telemetry).

  Refs: BI-5B3FA415, spec §4.1, §5.1"
  ```

---

### Task 11: Surface platform version in `/ops/self-upgrade`

**Files:**
- Modify: `apps/web/lib/actions/promotions.ts` (`getSelfUpgradeStatus`)
- Modify: `apps/web/lib/actions/promotions.self-upgrade.test.ts`
- Modify: `apps/web/app/(shell)/ops/self-upgrade/page.test.tsx`
- Modify: `apps/web/components/ops/SelfUpgradeClient.tsx`
- Modify: `apps/web/components/ops/SelfUpgradeClient.test.tsx`

`SelfUpgradePanel.tsx` exists, but the current `/ops/self-upgrade` route renders `SelfUpgradeClient`. Do not spend this slice polishing the unused panel unless you also migrate the route and tests deliberately.

- [ ] **Step 1: Add platform version to the status action contract**

  In `apps/web/lib/actions/promotions.ts`, import `loadPlatformVersion` and include the result in `getSelfUpgradeStatus()`:

  ```ts
  const [config, latestRun, platformVersion] = await Promise.all([
    getSelfUpgradeConfig(),
    getLatestRun(),
    loadPlatformVersion(),
  ]);
  ```

  Return a serializable `platformVersion` object with `version`, `publishedAt` ISO string, `gitSha`, and `note`.

- [ ] **Step 2: Write the failing test**

  Update the existing action/page/client tests. Do not create a parallel component test if the current files already cover the contract.

  ```tsx
  vi.mock("@/lib/platform/version", () => ({
    loadPlatformVersion: async () => ({
      version: "1.0.0",
      publishedAt: new Date("2026-05-24T00:00:00.000Z"),
      gitSha: "abc1234",
      note: "baseline",
    }),
  }));
  ```

  Add assertions:
  - `promotions.self-upgrade.test.ts`: `getSelfUpgradeStatus()` includes `platformVersion.version === "1.0.0"`.
  - `page.test.tsx`: the mocked `SelfUpgradeClient` receives a `platformVersion` prop.
  - `SelfUpgradeClient.test.tsx`: rendered markup includes `Platform version` and `1.0.0`.

- [ ] **Step 3: Run the test to verify it fails**

  ```
  pnpm --filter web test -- --run apps/web/lib/actions/promotions.self-upgrade.test.ts
  pnpm --filter web test -- --run "apps/web/app/(shell)/ops/self-upgrade/page.test.tsx"
  pnpm --filter web test -- --run apps/web/components/ops/SelfUpgradeClient.test.tsx
  ```

- [ ] **Step 4: Add the UI row to the rendered client**

  Extend `SelfUpgradeClient` props with:

  ```ts
  platformVersion: {
    version: string;
    publishedAt: string;
    gitSha: string | null;
    note: string | null;
  };
  ```

  Render `Platform version: <version>` in the summary block above the SHA rows, with `gitSha.slice(0, 7)` as secondary text when present. Keep styling theme-aware (`text-[var(--dpf-*)]`, no hardcoded colors). This is a compact ops control surface, not a hero/card redesign.

  UI quality bar:
  - Keep the information hierarchy scannable: platform version first, then deployed/target SHA, then status.
  - Use the existing compact ops-control styling; no marketing hero, no nested cards, no new color palette.
  - Do not introduce hardcoded colors. Use DPF CSS variables for text, muted text, surfaces, borders, and status accents.
  - The row must survive long semver/pre-release strings and null `gitSha` without wrapping over adjacent controls.

- [ ] **Step 5: Run the test to verify it passes**

  ```
  pnpm --filter web test -- --run apps/web/lib/actions/promotions.self-upgrade.test.ts
  pnpm --filter web test -- --run "apps/web/app/(shell)/ops/self-upgrade/page.test.tsx"
  pnpm --filter web test -- --run apps/web/components/ops/SelfUpgradeClient.test.tsx
  ```

- [ ] **Step 6: Manual verification**

  Rebuild/restart the Docker-served portal path, open `/ops/self-upgrade`, and confirm the version shows `1.0.0` in the control surface. Capture a screenshot/evidence path for the PR body, including a narrow viewport check so the version row does not overlap the trigger control.

- [ ] **Step 7: Commit**

  ```
  git add apps/web/lib/actions/promotions.ts apps/web/lib/actions/promotions.self-upgrade.test.ts "apps/web/app/(shell)/ops/self-upgrade/page.test.tsx" apps/web/components/ops/SelfUpgradeClient.tsx apps/web/components/ops/SelfUpgradeClient.test.tsx
  git commit -s apps/web/lib/actions/promotions.ts apps/web/lib/actions/promotions.self-upgrade.test.ts "apps/web/app/(shell)/ops/self-upgrade/page.test.tsx" apps/web/components/ops/SelfUpgradeClient.tsx apps/web/components/ops/SelfUpgradeClient.test.tsx -m "feat(ops): show platform version in /ops/self-upgrade header

  Closes the spec §9 acceptance criterion 'answer to what version am I on
  is identical from UI, API, and PlatformConfig' for the Phase 1 legs.
  Manifest, image-label, and tag agreement arrive in Phase 2.

  Refs: BI-5B3FA415, spec §4.1, §9"
  ```

---

### Phase 1 verification gate

Before moving to Phase 2, confirm the Phase 1 sources agree:

- [ ] `cat version.json` → version field
- [ ] `curl http://localhost:3000/api/platform/version` against the Docker-served portal → version field matches
- [ ] `PlatformConfig["platform.version"]` in the live DB → version field matches and `source` is `version.json`
- [ ] `/ops/self-upgrade` UI → displays the same version
- [ ] (Future: channel manifest, image labels, and git tag will agree once Phase 2 ships)

- [ ] Run the full test suite:
  ```
  pnpm typecheck
  pnpm --filter web test
  pnpm --filter @dpf/db test
  pnpm --filter web build
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

Recommended execution mode (one reviewable task at a time, per the dpf-writing-plans preamble):

- **One subagent per task**, fresh context each time
- **Operator review between tasks** — particularly between Task 5 (deletions) and Task 6 (resolveTargetSha log)
- **Hard checkpoint at the Phase 0 verification gate** before Phase 1 begins
- **Hard checkpoint at the Phase 1 verification gate** before opening the PR

If you prefer inline execution, run tasks sequentially in the same session, but pause at the two verification gates for operator confirmation.

## PR opening

After all tasks in Phase 0+1 are committed and both verification gates pass:

- [ ] Sweep `git log origin/main..HEAD --oneline` and confirm only your commits are present (no concurrent-session sweep).
- [ ] Per `feedback_pr_overlap_check_before_pushing.md`, search recent main commits + open PRs for any concurrent work on `apps/web/lib/self-upgrade/` or `apps/web/lib/queue/functions/self-upgrade*`. Surface conflicts to operator before pushing.
- [ ] Push the topic branch. Per AGENTS.md, each task commit should already have been pushed; this step is a final `git push` plus confirmation that the remote branch contains every commit.
- [ ] Open PR with title: `feat(platform): governed-upgrade Phase 0+1 — substrate consolidation and version baseline`
- [ ] PR body should reference spec, BI, and link to this plan.

---

## Notes for the executor

- **Never ask the operator to run commands.** Every step here is something you run yourself. If a command fails, debug it; if you can't, report concrete output to the operator.
- **DCO sign-off is mandatory** on every commit (`-s` flag). Per `feedback_dco_signoff_required.md`.
- **Push after every task commit.** If the first push discovers the branch has no upstream, push with `git push -u origin HEAD`; subsequent task commits use `git push`.
- **Scope commits with positional path args** per `feedback_git_commit_only_for_concurrent_sessions.md` — concurrent sessions can sweep staged files into your commit otherwise.
- **Do not skip the test-first pattern** even for "obvious" deletions. The characterization tests in Task 1 and the failing test in Task 2 are what give us confidence the deletions are safe.
- **Frequent commits** — every green task is one logical commit. The one intentional red step (Task 2) is committed with Task 3 after the fix passes.
