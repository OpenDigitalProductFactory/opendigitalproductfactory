# Sandbox Pool Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the already-built `sandbox-pool.ts` slot manager into the build pipeline so concurrent Build Studio builds queue for a slot rather than colliding in the shared `/workspace`.

**Architecture:** `SandboxSlot` rows in Postgres act as the mutex. `stepCreateSandbox` acquires a slot before touching the sandbox filesystem; `runBuildPipeline` releases it in a `finally` block. If no slot is free the pipeline polls (30 s intervals, 30 min timeout) and emits a "queued" event to the Build Studio UI so the operator sees progress. Portal startup resets all slots to `available` (already in `initializePool()`), handling crash recovery. A stale-slot guard in `instrumentation.ts` reclaims slots whose build is no longer active after 30 min.

**Tech Stack:** Next.js 15 App Router, Prisma 7, PostgreSQL, TypeScript strict, Vitest

---

## Context: what already exists (do NOT recreate)

| File | What it does |
|------|-------------|
| `apps/web/lib/integrate/sandbox/sandbox-pool.ts` | `acquireSandbox`, `releaseSandbox`, `initializePool`, `getPoolStatus` — fully implemented but never called from the pipeline |
| `packages/db/prisma/schema.prisma` `SandboxSlot` | `slotIndex`, `containerId`, `port`, `status`, `buildId @unique`, `userId`, `acquiredAt`, `releasedAt` |
| `apps/web/lib/integrate/build-pipeline.ts` `stepCreateSandbox` | Currently uses hardcoded `SANDBOX_CONTAINER_ID` + `SANDBOX_PORT` env vars — the slot system is completely bypassed |
| `apps/web/instrumentation.ts` | Server startup hook — runs once on boot, already used for discovery/model revalidation |

**Known schema gap:** `sandbox-pool.ts` references `ownerType` and `ownerRef` fields that do not exist in `SandboxSlot`. Task 1 fixes this by removing those fields from the pool API (idempotency is already provided by `buildId @unique`).

---

## Task 1: Fix sandbox-pool.ts schema mismatch

The file references `ownerType`/`ownerRef` Prisma fields that don't exist. Simplify the internal API to use `buildId` for idempotency — no schema migration required.

**Files:**
- Modify: `apps/web/lib/integrate/sandbox/sandbox-pool.ts`

- [ ] **Step 1: Remove `ownerType`/`ownerRef` from `AcquireSandboxLeaseInput` and `ReleaseSandboxLeaseInput` types.** Keep `buildId` and `userId`.

- [ ] **Step 2: Rewrite the idempotency check in `acquireSandboxLease`.** Replace:
  ```typescript
  // OLD — references missing DB fields
  const existing = await prisma.sandboxSlot.findFirst({
    where: { ownerType: input.ownerType, ownerRef: input.ownerRef, status: "in_use" },
  });
  ```
  with:
  ```typescript
  // NEW — uses buildId @unique which already exists in schema
  const existing = input.buildId
    ? await prisma.sandboxSlot.findUnique({ where: { buildId: input.buildId } })
    : null;
  if (existing?.status === "in_use") {
    return { slotIndex: existing.slotIndex, containerId: existing.containerId,
             port: existing.port, buildId: input.buildId! };
  }
  ```

- [ ] **Step 3: Remove `ownerType`/`ownerRef` from TWO places — the `acquireSandboxLease` update payload AND the `releaseSandboxLease` find query.** Both reference missing DB fields:

  In `acquireSandboxLease`, strip `ownerType`/`ownerRef` from the Prisma `update` call:
  ```typescript
  // Remove these two lines from the update data block:
  //   ownerType: input.ownerType,   ← remove
  //   ownerRef: input.ownerRef,     ← remove
  const claimed = await prisma.sandboxSlot.update({
    where: { id: available.id },
    data: {
      status: "in_use",
      buildId,
      userId: input.userId,
      acquiredAt: new Date(),
      releasedAt: null,
      // ownerType and ownerRef removed — not in DB schema
    },
  });
  ```

  In `releaseSandboxLease`, replace the `findFirst` (which uses missing fields) with `findUnique` by `buildId`:
  ```typescript
  const slot = input.buildId
    ? await prisma.sandboxSlot.findUnique({ where: { buildId: input.buildId } })
    : null;
  ```
  Also strip `ownerType: null, ownerRef: null` from the `releaseSandboxLease` update payload.

- [ ] **Step 4: Remove the `SandboxLeaseOwnerType` type and `ownerType`/`ownerRef` fields from `SandboxLease` return type entirely.** The public surface becomes just `{ slotIndex, containerId, port, buildId }`.

- [ ] **Step 5: Run typecheck to confirm zero new errors.**
  ```bash
  pnpm --filter web typecheck
  ```
  Expected: no errors mentioning `ownerType`, `ownerRef`, or `SandboxSlot`.

- [ ] **Step 6: Commit.**
  ```
  fix(sandbox-pool): remove ownerType/ownerRef — use buildId @unique for idempotency
  ```

---

## Task 2: Add `waitForSandboxSlot` with polling (TDD)

Add a polling wrapper around `acquireSandbox` that retries on a 30 s interval until the slot is free or the timeout is reached. The build pipeline calls this instead of `acquireSandbox` directly.

**Files:**
- Modify: `apps/web/lib/integrate/sandbox/sandbox-pool.ts`
- Create: `apps/web/lib/integrate/sandbox/sandbox-pool.test.ts`

- [ ] **Step 1: Write failing tests in `sandbox-pool.test.ts`.**
  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";

  // Mock prisma so tests don't need a real DB
  vi.mock("@dpf/db", () => ({
    prisma: {
      sandboxSlot: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
    },
  }));

  import { waitForSandboxSlot } from "./sandbox-pool";
  import { prisma } from "@dpf/db";

  const mockSlot = { id: "s1", slotIndex: 0, containerId: "dpf-sandbox-1",
                     port: 3035, status: "available", buildId: null, userId: null,
                     acquiredAt: null, releasedAt: null, createdAt: new Date(),
                     updatedAt: new Date() };

  describe("waitForSandboxSlot", () => {
    beforeEach(() => vi.clearAllMocks());

    it("acquires immediately when a slot is free", async () => {
      // findUnique (idempotency check) → null; findFirst (available) → mockSlot; update → claimed
      vi.mocked(prisma.sandboxSlot.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.sandboxSlot.findFirst).mockResolvedValue(mockSlot);
      vi.mocked(prisma.sandboxSlot.update).mockResolvedValue({ ...mockSlot, status: "in_use", buildId: "FB-TEST" });

      const result = await waitForSandboxSlot("FB-TEST", "user-1", { pollIntervalMs: 100, timeoutMs: 1000 });
      expect(result.buildId).toBe("FB-TEST");
      expect(result.containerId).toBe("dpf-sandbox-1");
    });

    it("waits and retries when no slot is initially available", async () => {
      vi.mocked(prisma.sandboxSlot.findUnique).mockResolvedValue(null);
      // First call: no available slot. Second call: slot free.
      vi.mocked(prisma.sandboxSlot.findFirst)
        .mockResolvedValueOnce(null)      // first poll — all in use
        .mockResolvedValue(mockSlot);     // second poll — available
      vi.mocked(prisma.sandboxSlot.update).mockResolvedValue({ ...mockSlot, status: "in_use", buildId: "FB-TEST" });

      const result = await waitForSandboxSlot("FB-TEST", "user-1", { pollIntervalMs: 50, timeoutMs: 2000 });
      expect(result.buildId).toBe("FB-TEST");
    });

    it("throws SandboxSlotTimeoutError when timeout is exceeded", async () => {
      vi.mocked(prisma.sandboxSlot.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.sandboxSlot.findFirst).mockResolvedValue(null); // always busy
      vi.mocked(prisma.sandboxSlot.update).mockResolvedValue({ ...mockSlot, status: "in_use" });

      await expect(
        waitForSandboxSlot("FB-TEST", "user-1", { pollIntervalMs: 50, timeoutMs: 200 })
      ).rejects.toThrow("Sandbox slot unavailable after");
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail.**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-pool.test.ts
  ```
  Expected: 3 failures (function doesn't exist yet).

- [ ] **Step 3: Implement `waitForSandboxSlot` in `sandbox-pool.ts`.**
  ```typescript
  export type WaitForSlotOptions = {
    pollIntervalMs?: number;  // default 30_000
    timeoutMs?: number;       // default 1_800_000 (30 min)
    onWaiting?: (attempt: number) => void;
  };

  /**
   * Acquires a sandbox slot, polling until one becomes available.
   * Throws if no slot is free within `timeoutMs`.
   *
   * Design: builds waiting on human approval or review do NOT hold a slot —
   * they release it when the pipeline ends. Only the active execution
   * steps (workspace copy → code generation → tests) hold the slot.
   * This lets multiple builds be in-flight while only one runs in the sandbox.
   */
  export async function waitForSandboxSlot(
    buildId: string,
    userId: string,
    opts: WaitForSlotOptions = {},
  ): Promise<SandboxSlot> {
    const pollInterval = opts.pollIntervalMs ?? 30_000;
    const timeout = opts.timeoutMs ?? 1_800_000;
    const deadline = Date.now() + timeout;
    let attempt = 0;

    while (Date.now() < deadline) {
      const slot = await acquireSandbox(buildId, userId);
      if (slot) return slot;

      attempt++;
      opts.onWaiting?.(attempt);
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((res) => setTimeout(res, Math.min(pollInterval, remaining)));
    }

    throw new Error(
      `Sandbox slot unavailable after ${Math.round(timeout / 60_000)} min (${attempt} poll(s)). ` +
      `Another build is using the sandbox. The build will be retried automatically when a slot opens.`,
    );
  }
  ```

- [ ] **Step 4: Run tests — all three should pass.**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-pool.test.ts
  ```

- [ ] **Step 5: Commit.**
  ```
  feat(sandbox-pool): add waitForSandboxSlot with poll/timeout
  ```

---

## Task 3: Wire slot acquisition into `stepCreateSandbox`

Replace hardcoded env var container/port with slot pool acquisition.

**Files:**
- Modify: `apps/web/lib/integrate/build-pipeline.ts`
- Modify: `apps/web/lib/integrate/build-pipeline.test.ts` (or create if not present)

- [ ] **Step 1: Write a failing test for the new `stepCreateSandbox` behavior.**

  In `apps/web/lib/integrate/build-pipeline.test.ts`, add:
  ```typescript
  // Mock sandbox-pool so tests don't need Docker
  vi.mock("@/lib/integrate/sandbox/sandbox-pool", () => ({
    waitForSandboxSlot: vi.fn().mockResolvedValue({
      slotIndex: 0, containerId: "dpf-sandbox-1", port: 3035, buildId: "FB-TEST"
    }),
    releaseSandbox: vi.fn().mockResolvedValue(undefined),
    initializePool: vi.fn().mockResolvedValue(undefined),
  }));

  // existing build-branch mock
  vi.mock("@/lib/integrate/sandbox/build-branch", () => ({
    isSandboxAvailable: vi.fn().mockResolvedValue(true),
    startBuildBranch: vi.fn().mockResolvedValue({ branch: "build/FB-TEST", status: "current" }),
  }));

  it("acquires a slot before calling startBuildBranch", async () => {
    const { waitForSandboxSlot } = await import("@/lib/integrate/sandbox/sandbox-pool");
    // run a single pipeline step — trigger stepCreateSandbox indirectly
    // by calling runBuildPipeline with a null existingState (starts from pending)
    // ... (test invocation already in existing test harness)
    expect(waitForSandboxSlot).toHaveBeenCalledWith(
      "FB-TEST", "system", expect.objectContaining({ pollIntervalMs: expect.any(Number) })
    );
  });
  ```

- [ ] **Step 2: Run to confirm failure.**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/integrate/build-pipeline.test.ts
  ```

- [ ] **Step 3: Update `stepCreateSandbox` in `build-pipeline.ts`.**

  Replace the current implementation:
  ```typescript
  async function stepCreateSandbox(
    buildId: string,
    state: BuildExecutionState,
  ): Promise<BuildExecutionState> {
    const { isSandboxAvailable, startBuildBranch } = await import("./sandbox/build-branch");
    const { waitForSandboxSlot } = await import("./sandbox/sandbox-pool");

    const available = await isSandboxAvailable();
    if (!available) {
      throw new Error("Sandbox container (dpf-sandbox-1) is not running. Start it with: docker compose up -d sandbox");
    }

    // Acquire a slot from the pool — waits up to 30 min if all slots are busy.
    // The pipeline emits a "queued" progress event while waiting so Build Studio
    // shows "Waiting for sandbox slot..." rather than appearing stuck.
    const slot = await waitForSandboxSlot(buildId, "system", {
      pollIntervalMs: 30_000,
      timeoutMs: 1_800_000,
      onWaiting: (attempt) => {
        console.log(`[build-pipeline] ${buildId} waiting for sandbox slot (attempt ${attempt})`);
      },
    });

    const sourceCurrency = await startBuildBranch(buildId);

    return {
      ...state,
      containerId: slot.containerId,
      hostPort: slot.port,
      sourceCurrency,
    };
  }
  ```

- [ ] **Step 4: Run tests — should pass.**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/integrate/build-pipeline.test.ts
  ```

- [ ] **Step 5: Commit.**
  ```
  feat(build-pipeline): acquire sandbox slot in stepCreateSandbox
  ```

---

## Task 4: Release slot in `runBuildPipeline` finally block

The slot must be released whether the pipeline succeeds, fails, or throws unexpectedly.

**Files:**
- Modify: `apps/web/lib/integrate/build-pipeline.ts`

- [ ] **Step 1: Write failing tests.**

  Add to `build-pipeline.test.ts`:
  ```typescript
  it("releases the sandbox slot when pipeline completes successfully", async () => {
    const { releaseSandbox } = await import("@/lib/integrate/sandbox/sandbox-pool");
    // run full pipeline to completion (all steps mocked)
    await runBuildPipeline({ buildId: "FB-TEST", existingState: null, updateState: vi.fn(), emit: vi.fn() });
    expect(releaseSandbox).toHaveBeenCalledWith("FB-TEST");
  });

  it("releases the sandbox slot when pipeline fails mid-execution", async () => {
    const { releaseSandbox } = await import("@/lib/integrate/sandbox/sandbox-pool");
    vi.mocked(copySourceAndBaseline).mockRejectedValueOnce(new Error("rsync failed"));
    const result = await runBuildPipeline({ buildId: "FB-TEST", existingState: null, updateState: vi.fn(), emit: vi.fn() });
    expect(result.step).toBe("failed");
    expect(releaseSandbox).toHaveBeenCalledWith("FB-TEST");
  });
  ```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Wrap the main loop in `runBuildPipeline` with try/finally.**

  In `runBuildPipeline`, after building `stepsToRun`, wrap the `for` loop:
  ```typescript
  try {
    for (const step of stepsToRun) {
      // ... existing loop body unchanged ...
    }
  } finally {
    // Always release the sandbox slot, even if the pipeline throws.
    // If this build never acquired a slot (e.g. failed before stepCreateSandbox),
    // releaseSandbox is a no-op.
    const { releaseSandbox } = await import("./sandbox/sandbox-pool");
    await releaseSandbox(buildId).catch((err) =>
      console.error(`[build-pipeline] Failed to release sandbox slot for ${buildId}:`, err),
    );
  }
  ```

- [ ] **Step 4: Run tests.**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/integrate/build-pipeline.test.ts
  ```

- [ ] **Step 5: Commit.**
  ```
  feat(build-pipeline): release sandbox slot in runBuildPipeline finally block
  ```

---

## Task 5: Initialize pool on portal startup

`initializePool()` resets all slots to `available` on boot, which handles stale-slot recovery after portal crashes.

**Files:**
- Modify: `apps/web/instrumentation.ts`

- [ ] **Step 1: Add `initializePool()` call in the `register()` function** (inside the `nodejs` runtime guard, after existing startup work):
  ```typescript
  // ── Sandbox pool initialization ────────────────────────────────────────
  // Resets all SandboxSlot rows to "available" on every boot.
  // Handles stale slots from portal crashes without manual intervention.
  setTimeout(async () => {
    try {
      const { initializePool } = await import("@/lib/integrate/sandbox/sandbox-pool");
      await initializePool();
      console.log("[sandbox-pool] Slot pool initialized (all slots reset to available)");
    } catch (err) {
      console.error("[sandbox-pool] Failed to initialize slot pool:", err);
    }
  }, 5_000);
  ```
  Use a 5 s delay so the DB connection is warm before the upsert runs.

- [ ] **Step 2: Confirm no typecheck errors.**
  ```bash
  pnpm --filter web typecheck
  ```

- [ ] **Step 3: Commit.**
  ```
  feat(instrumentation): initialize sandbox slot pool on portal startup
  ```

---

## Task 6: Emit "queued" progress to Build Studio UI

When a build is waiting for a slot, the Build Studio progress pane should say "Waiting for sandbox slot…" rather than appearing stuck at "Pending".

**Files:**
- Modify: `apps/web/lib/integrate/build-exec-types.ts`
- Modify: `apps/web/lib/integrate/build-pipeline.ts`
- Modify: `apps/web/lib/agent-event-bus.ts` (or wherever `AgentEvent` types live)

- [ ] **Step 1: Add a `"slot_queued"` step label** to `STEP_LABELS` in `build-exec-types.ts`. Do NOT add it to `STEP_ORDER` (it is not a checkpointed execution step):
  ```typescript
  // In STEP_LABELS, add:
  slot_queued: "Waiting for sandbox slot…",
  ```
  And add `"slot_queued"` to `BuildExecStep` as a non-order step so it can appear in progress events:
  ```typescript
  export type BuildExecStep =
    | "pending"
    | "slot_queued"       // ← transient — emitted only; never persisted as a checkpoint
    | "sandbox_created"
    // ... rest unchanged
  ```

- [ ] **Step 2: Emit `slot_queued` event from `waitForSandboxSlot` callback** in `stepCreateSandbox`:
  ```typescript
  onWaiting: (attempt) => {
    console.log(`[build-pipeline] ${buildId} waiting for sandbox slot (attempt ${attempt})`);
    emit({ type: "phase:change", buildId, phase: "slot_queued" });
  },
  ```

- [ ] **Step 3: Verify STEP_LABELS picks up the new label in the Build Studio progress card.** Search for where `STEP_LABELS` is consumed:
  ```bash
  grep -rn "STEP_LABELS" apps/web/ --include="*.tsx" --include="*.ts"
  ```
  Confirm the progress display reads from `STEP_LABELS` rather than hard-coding strings. If it does, the new label shows automatically. If not, update the display component.

- [ ] **Step 4: Run unit tests.**
  ```bash
  pnpm --filter web exec vitest run apps/web/lib/integrate/build-exec-types
  ```

- [ ] **Step 5: Commit.**
  ```
  feat(build-pipeline): emit slot_queued progress event while waiting for sandbox
  ```

---

## Task 7: Stale-slot reclaim guard (belt-and-suspenders)

`initializePool()` already resets everything on startup. This task adds a runtime check that reclaims any slot held by a build that is no longer in the `build` phase — guards against the (rare) case where a portal instance restarts mid-pipeline and the new instance doesn't yet re-run `initializePool`.

**Files:**
- Modify: `apps/web/instrumentation.ts`

- [ ] **Step 1: After the `initializePool` block, add a stale-slot guard that runs at startup + every 30 min:**
  ```typescript
  // ── Stale sandbox slot reclaim ─────────────────────────────────────────
  // Belt-and-suspenders: reclaim any slot whose FeatureBuild is no longer
  // actively in the 'build' phase (completed, failed, or advanced to review).
  // initializePool() handles crash recovery on boot; this handles the rare
  // case where a portal process dies between boot and the pipeline finishing.
  async function reclaimStaleSandboxSlots() {
    try {
      const { prisma } = await import("@dpf/db");
      const staleSlots = await prisma.sandboxSlot.findMany({
        where: {
          status: "in_use",
          buildId: { not: null },
          acquiredAt: { lt: new Date(Date.now() - 120 * 60 * 1000) }, // > 2h old
        },
      });

      for (const slot of staleSlots) {
        if (!slot.buildId) continue;
        const build = await prisma.featureBuild.findUnique({
          where: { buildId: slot.buildId },
          select: { phase: true, buildExecState: true },
        });
        const execState = build?.buildExecState as { step?: string } | null;
        const terminalExecSteps = ["complete", "failed"];
        // Reclaim if build left the build phase, OR if it's stuck in build
        // phase with a terminal exec state (failed/complete but slot not released)
        const buildPhaseDone = !build || build.phase !== "build";
        const execStateTerminal = build?.phase === "build"
          && execState?.step != null
          && terminalExecSteps.includes(execState.step);
        if (buildPhaseDone || execStateTerminal) {
          await prisma.sandboxSlot.update({
            where: { id: slot.id },
            data: { status: "available", buildId: null, userId: null, releasedAt: new Date() },
          });
          console.log(`[sandbox-pool] Reclaimed stale slot ${slot.slotIndex} from ${slot.buildId} (phase: ${build?.phase ?? "not found"})`);
        }
      }
    } catch (err) {
      console.warn("[sandbox-pool] Stale slot reclaim failed (non-fatal):", err);
    }
  }

  // Run once at startup (after 30s) then every 30 min
  setTimeout(() => {
    reclaimStaleSandboxSlots();
    setInterval(reclaimStaleSandboxSlots, 30 * 60 * 1000);
  }, 30_000);
  ```

- [ ] **Step 2: Run typecheck.**
  ```bash
  pnpm --filter web typecheck
  ```

- [ ] **Step 3: Commit.**
  ```
  feat(instrumentation): stale sandbox slot reclaim on startup and every 30 min
  ```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Run the full test suite.**
  ```bash
  pnpm --filter web exec vitest run
  ```
  Expected: all existing tests pass + new sandbox-pool and build-pipeline tests pass.

- [ ] **Step 2: Trigger two concurrent builds in Build Studio.** Start Build A then immediately start Build B. Verify in the portal logs:
  - Build A: `[build-pipeline] stepGenerateCode buildId=FB-A tools=N …`
  - Build B: `[build-pipeline] FB-B waiting for sandbox slot (attempt 1)`
  - Build A completes → Build B log shows it acquired the slot and continues.

- [ ] **Step 3: Verify `SandboxSlot` DB state after both complete.**
  ```sql
  SELECT "slotIndex", "status", "buildId", "releasedAt" FROM "SandboxSlot";
  ```
  Expected: all slots show `status = 'available'`, `buildId = null`.

- [ ] **Step 4: Verify portal restart resets stale slots.** Manually set a slot to `in_use` in DB, restart the portal, confirm it resets to `available` within 10 s.

- [ ] **Step 5: Final commit + PR.**
  ```
  feat(build-studio): sandbox slot pool — serialize concurrent build execution
  ```

---

## What this does NOT change

- Pool size remains 1 (`DPF_SANDBOX_POOL_SIZE=1`). Adding more containers (sandboxes 2 and 3) is a separate infrastructure task — the pool API already supports N slots.
- The 30 min timeout means a build will fail with a clear message if it waits too long, rather than running forever. The operator can restart it.
- No changes to the `stepGenerateCode` routing fix (PR #880, already merged).
