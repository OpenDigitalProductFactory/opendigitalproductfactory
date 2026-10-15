// apps/web/lib/sandbox-pool.ts
// Manages a pool of sandbox instances for concurrent builds.
// Each slot has its own Docker container and workspace volume.
// Replaces the single persistent dpf-sandbox-1 with N isolated slots.

import { prisma } from "@dpf/db";
import { getQuiescenceLevel, QuiescingError } from "@/lib/self-upgrade/quiescence";
import { recordQueueTransition } from "@/lib/queue/queue-telemetry";
import { sandboxPoolSize } from "@/lib/build/wip-cap";

/**
 * Flow-telemetry queue key for the shared sandbox-slot pool (EP-3516E23D). The
 * pool is a scarce-compute lane; acquire=started, release=finished so its hold
 * time (process time), throughput, and utilization become measurable.
 */
const SANDBOX_QUEUE_KEY = "compute:sandbox-pool";

// ─── Configuration ──────────────────────────────────────────────────────────

const POOL_SIZE = sandboxPoolSize();

/**
 * Docker Compose container names and ports for the sandbox pool.
 * These must match docker-compose.yml service definitions:
 *   sandbox   → dpf-sandbox-1   (port 3035)
 *   sandbox-2 → dpf-sandbox-2-1 (port 3037)
 *   sandbox-3 → dpf-sandbox-3-1 (port 3038)
 */
const SANDBOX_SLOTS = [
  { containerId: "dpf-sandbox-1", port: 3035 },
  { containerId: "dpf-sandbox-2-1", port: 3037 },
  { containerId: "dpf-sandbox-3-1", port: 3038 },
];

export function getPoolConfig() {
  return {
    size: POOL_SIZE,
    basePort: SANDBOX_SLOTS[0].port,
    slots: SANDBOX_SLOTS.slice(0, POOL_SIZE).map((s, i) => ({
      slotIndex: i,
      containerId: s.containerId,
      port: s.port,
    })),
  };
}

/** Container ids the running compose stack actually defines for this pool size. */
export function configuredSandboxContainerIds(): string[] {
  return getPoolConfig().slots.map((slot) => slot.containerId);
}

/**
 * Build phases that still need a sandbox they can reach. Terminal builds keep
 * whatever they recorded; nothing will exec into it again.
 */
const SANDBOX_BOUND_ACTIVE_PHASES = ["build", "review", "ship"] as const;

// ─── Pool Initialization ────────────────────────────────────────────────────

/**
 * Ensures all sandbox slots exist in the database.
 * Safe to call multiple times (upserts by slotIndex).
 * Called during portal startup and seed.
 *
 * Slots are reset to available on every init. There is no reliable way for
 * the portal to know whether a previous session's in_use assignments are
 * still valid after a restart — containers stay running but the portal's
 * in-memory state is gone. Stale in_use slots block every new build until
 * manually cleared. Resetting on startup is safe: if a build genuinely needs
 * a slot it will re-acquire one on the next tool call.
 *
 * Rows beyond the configured pool size are removed and builds still pointed
 * at a container the stack does not define are re-pointed at the first
 * configured slot. A slot row that outlives its container (an old seed named
 * `dpf-sandbox-2` while compose only runs `dpf-sandbox-1`) is otherwise handed
 * out as "available", and every build that draws it runs its build, review
 * and gauntlet against a container that does not exist (BI pending —
 * SandboxSlot phantom container).
 */
export async function initializePool(): Promise<void> {
  const config = getPoolConfig();
  for (const slot of config.slots) {
    await prisma.sandboxSlot.upsert({
      where: { slotIndex: slot.slotIndex },
      create: {
        slotIndex: slot.slotIndex,
        containerId: slot.containerId,
        port: slot.port,
        status: "available",
      },
      update: {
        containerId: slot.containerId,
        port: slot.port,
        status: "available",
        buildId: null,
        userId: null,
      },
    });
  }
  await retireUnconfiguredSlots(config);
}

/**
 * Drop slot rows the stack no longer defines and heal builds bound to them.
 * RuntimeTarget.slotId is `onDelete: SetNull`, so removing a row detaches its
 * targets instead of failing.
 */
async function retireUnconfiguredSlots(config: ReturnType<typeof getPoolConfig>): Promise<void> {
  const configuredIds = config.slots.map((slot) => slot.containerId);
  const removed = await prisma.sandboxSlot.deleteMany({
    where: { OR: [{ slotIndex: { gte: config.size } }, { containerId: { notIn: configuredIds } }] },
  });
  if (removed.count > 0) {
    console.warn(`[sandbox-pool] removed ${removed.count} slot row(s) outside the configured pool of ${config.size}`);
  }
  const fallback = config.slots[0];
  if (!fallback) return;
  const healed = await prisma.featureBuild.updateMany({
    where: {
      phase: { in: [...SANDBOX_BOUND_ACTIVE_PHASES] },
      sandboxId: { notIn: configuredIds },
    },
    data: { sandboxId: fallback.containerId, sandboxPort: fallback.port },
  });
  if (healed.count > 0) {
    console.warn(
      `[sandbox-pool] re-pointed ${healed.count} active build(s) from an unconfigured sandbox to ${fallback.containerId}`,
    );
  }
}

// ─── Slot Acquisition ───────────────────────────────────────────────────────

export type SandboxSlot = {
  slotIndex: number;
  containerId: string;
  port: number;
  buildId: string;
};

export type SandboxLease = {
  slotIndex: number;
  containerId: string;
  port: number;
  buildId: string | null;
};

export type AcquireSandboxLeaseInput = {
  userId: string;
  buildId: string;
};

export type ReleaseSandboxLeaseInput = {
  buildId: string;
};

async function syncFeatureBuildSandbox(buildId: string, containerId: string, port: number) {
  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      sandboxId: containerId,
      sandboxPort: port,
    },
  });
}

export async function acquireSandboxLease(
  input: AcquireSandboxLeaseInput,
): Promise<SandboxLease | null> {
  // Idempotency: if this build already holds a slot, return it.
  // Uses buildId @unique so no extra DB fields are needed.
  const existing = await prisma.sandboxSlot.findUnique({
    where: { buildId: input.buildId },
  });
  if (existing?.status === "in_use") {
    return {
      slotIndex: existing.slotIndex,
      containerId: existing.containerId,
      port: existing.port,
      buildId: existing.buildId ?? null,
    };
  }

  // BI-QUIESCE-005 entry-point gate: refuse NEW sandbox acquisitions
  // during quiescence drain. The idempotent early-return above means
  // builds that already hold a slot are unaffected — only fresh
  // acquisitions are gated.
  const level = await getQuiescenceLevel();
  if (level !== "normal") {
    throw new QuiescingError(level);
  }

  // Only a slot whose container the stack defines is a slot at all; a stale
  // row for a container that never started must not be handed out.
  const available = await prisma.sandboxSlot.findFirst({
    where: { status: "available", containerId: { in: configuredSandboxContainerIds() } },
    orderBy: { slotIndex: "asc" },
  });

  if (!available) return null;

  const claimed = await prisma.sandboxSlot.update({
    where: { id: available.id },
    data: {
      status: "in_use",
      buildId: input.buildId,
      userId: input.userId,
      acquiredAt: new Date(),
      releasedAt: null,
    },
  });

  await syncFeatureBuildSandbox(input.buildId, claimed.containerId, claimed.port);

  // The build began holding a scarce slot — start of the service interval.
  void recordQueueTransition({
    queueKey: SANDBOX_QUEUE_KEY,
    itemKind: "sandbox-slot",
    itemId: input.buildId,
    transition: "started",
    laneKey: claimed.containerId,
    actorType: "system",
  });

  return {
    slotIndex: claimed.slotIndex,
    containerId: claimed.containerId,
    port: claimed.port,
    buildId: input.buildId,
  };
}

export async function releaseSandboxLease(
  input: ReleaseSandboxLeaseInput,
): Promise<void> {
  const slot = await prisma.sandboxSlot.findUnique({
    where: { buildId: input.buildId },
  });
  if (!slot || slot.status !== "in_use") return;

  const releasedAt = new Date();
  await prisma.sandboxSlot.update({
    where: { id: slot.id },
    data: {
      status: "available",
      buildId: null,
      userId: null,
      releasedAt,
    },
  });

  // Slot returned to the pool — terminal transition; process time = hold duration.
  const processMs = slot.acquiredAt
    ? Math.max(0, releasedAt.getTime() - slot.acquiredAt.getTime())
    : null;
  void recordQueueTransition({
    queueKey: SANDBOX_QUEUE_KEY,
    itemKind: "sandbox-slot",
    itemId: input.buildId,
    transition: "finished",
    outcome: "success",
    laneKey: slot.containerId,
    actorType: "system",
    durations: { processMs },
  });
}

/**
 * Acquires an available sandbox slot for a build.
 * Returns the slot details or null if all slots are in use.
 */
export async function acquireSandbox(
  buildId: string,
  userId: string,
): Promise<SandboxSlot | null> {
  const lease = await acquireSandboxLease({ buildId, userId });
  if (!lease) return null;

  return {
    slotIndex: lease.slotIndex,
    containerId: lease.containerId,
    port: lease.port,
    buildId,
  };
}

/**
 * Releases a sandbox slot back to the pool.
 * Called when a build completes, fails, or is cancelled.
 * Safe to call even if the build never acquired a slot (no-op).
 */
export async function releaseSandbox(buildId: string): Promise<void> {
  await releaseSandboxLease({ buildId });
}

/**
 * Returns the sandbox slot currently assigned to a build.
 * Used by sandbox tools to find the correct container.
 */
export async function getSlotForBuild(
  buildId: string,
): Promise<SandboxSlot | null> {
  const slot = await prisma.sandboxSlot.findUnique({
    where: { buildId },
  });
  if (!slot || slot.status !== "in_use") return null;

  return {
    slotIndex: slot.slotIndex,
    containerId: slot.containerId,
    port: slot.port,
    buildId,
  };
}

/**
 * Returns the sandbox slot assigned to a user's active build.
 * Convenience wrapper for sandbox tools that resolve by userId.
 */
export async function getSlotForUser(
  userId: string,
): Promise<SandboxSlot | null> {
  const slot = await prisma.sandboxSlot.findFirst({
    where: { userId, status: "in_use" },
  });
  if (!slot || !slot.buildId) return null;

  return {
    slotIndex: slot.slotIndex,
    containerId: slot.containerId,
    port: slot.port,
    buildId: slot.buildId,
  };
}

// ─── Slot Waiting / Queue ──────────────────────────────────────────────────

export type WaitForSlotOptions = {
  /** How long to wait between acquisition attempts. Default: 30 000 ms. */
  pollIntervalMs?: number;
  /** Maximum total wait time before giving up. Default: 30 min. */
  timeoutMs?: number;
  /** Called on each failed acquisition attempt (for logging / UI events). */
  onWaiting?: (attempt: number) => void;
};

/**
 * Acquires a sandbox slot, polling until one becomes available.
 *
 * Design: builds waiting on human approval or review do NOT hold a slot —
 * they release it when the pipeline ends (via the finally block in
 * runBuildPipeline). Only the active execution steps hold the slot, so
 * multiple builds can be in-flight while only one runs in the sandbox at a
 * time.
 *
 * Throws if no slot is free within `timeoutMs`.
 */
export async function waitForSandboxSlot(
  buildId: string,
  userId: string,
  opts: WaitForSlotOptions = {},
): Promise<SandboxSlot> {
  const pollInterval = opts.pollIntervalMs ?? 30_000;
  const timeout = opts.timeoutMs ?? 1_800_000; // 30 min
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
    `Sandbox slot unavailable after ${Math.round(timeout / 60_000)} min (${attempt} poll attempt${attempt !== 1 ? "s" : ""}). ` +
    `Another build is using the sandbox. This build will automatically retry when the slot is released.`,
  );
}

/**
 * Returns pool status for monitoring/display.
 */
export async function getPoolStatus(): Promise<{
  total: number;
  available: number;
  inUse: number;
  slots: Array<{
    slotIndex: number;
    containerId: string;
    port: number;
    status: string;
    buildId: string | null;
    userId: string | null;
  }>;
}> {
  const slots = await prisma.sandboxSlot.findMany({
    orderBy: { slotIndex: "asc" },
  });

  return {
    total: slots.length,
    available: slots.filter((s) => s.status === "available").length,
    inUse: slots.filter((s) => s.status === "in_use").length,
    slots: slots.map((s) => ({
      slotIndex: s.slotIndex,
      containerId: s.containerId,
      port: s.port,
      status: s.status,
      buildId: s.buildId,
      userId: s.userId,
    })),
  };
}
