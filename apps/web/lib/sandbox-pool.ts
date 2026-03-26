// apps/web/lib/sandbox-pool.ts
// Manages a pool of sandbox instances for concurrent builds.
// Each slot has its own Docker container and workspace volume.
// Replaces the single persistent dpf-sandbox-1 with N isolated slots.

import { prisma } from "@dpf/db";

// ─── Configuration ──────────────────────────────────────────────────────────

const POOL_SIZE = Number(process.env.DPF_SANDBOX_POOL_SIZE) || 3;
const BASE_PORT = 3036; // slots use ports 3036, 3037, 3038, ...

export function getPoolConfig() {
  return {
    size: POOL_SIZE,
    basePort: BASE_PORT,
    slots: Array.from({ length: POOL_SIZE }, (_, i) => ({
      slotIndex: i,
      containerId: `dpf-sandbox-${i + 1}`,
      port: BASE_PORT + i,
    })),
  };
}

// ─── Pool Initialization ────────────────────────────────────────────────────

/**
 * Ensures all sandbox slots exist in the database.
 * Safe to call multiple times (upserts by slotIndex).
 * Called during portal startup and seed.
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
        // Don't overwrite status — preserve in_use slots across restarts
      },
    });
  }
}

// ─── Slot Acquisition ───────────────────────────────────────────────────────

export type SandboxSlot = {
  slotIndex: number;
  containerId: string;
  port: number;
  buildId: string;
};

/**
 * Acquires an available sandbox slot for a build.
 * Returns the slot details or null if all slots are in use.
 */
export async function acquireSandbox(
  buildId: string,
  userId: string,
): Promise<SandboxSlot | null> {
  // Check if this build already has a slot
  const existing = await prisma.sandboxSlot.findUnique({
    where: { buildId },
  });
  if (existing) {
    return {
      slotIndex: existing.slotIndex,
      containerId: existing.containerId,
      port: existing.port,
      buildId,
    };
  }

  // Find first available slot (ordered by slotIndex for deterministic assignment)
  const available = await prisma.sandboxSlot.findFirst({
    where: { status: "available" },
    orderBy: { slotIndex: "asc" },
  });

  if (!available) return null; // All slots in use

  // Claim the slot
  await prisma.sandboxSlot.update({
    where: { id: available.id },
    data: {
      status: "in_use",
      buildId,
      userId,
      acquiredAt: new Date(),
      releasedAt: null,
    },
  });

  // Also update the FeatureBuild with the sandbox info
  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      sandboxId: available.containerId,
      sandboxPort: available.port,
    },
  });

  return {
    slotIndex: available.slotIndex,
    containerId: available.containerId,
    port: available.port,
    buildId,
  };
}

/**
 * Releases a sandbox slot back to the pool.
 * Called when a build completes, fails, or is cancelled.
 */
export async function releaseSandbox(buildId: string): Promise<void> {
  const slot = await prisma.sandboxSlot.findUnique({
    where: { buildId },
  });
  if (!slot) return;

  await prisma.sandboxSlot.update({
    where: { id: slot.id },
    data: {
      status: "available",
      buildId: null,
      userId: null,
      releasedAt: new Date(),
    },
  });
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
