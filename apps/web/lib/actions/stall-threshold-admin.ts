"use server";

import { auth } from "@/lib/govern/auth";
import { prisma } from "@dpf/db";

export interface StallThresholdRow {
  id: string;
  scope: string;
  heartbeatTimeoutSeconds: number;
  totalPhaseTimeoutSeconds: number;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * List all BuildStudioStallThreshold rows, ordered with phase.* first then
 * "default". Used by the admin editor at /admin/build-studio/stall-thresholds.
 */
export async function listStallThresholds(): Promise<StallThresholdRow[]> {
  const rows = await prisma.buildStudioStallThreshold.findMany();
  // Phases first in pipeline order, then default last.
  const PHASE_ORDER = ["phase.ideate", "phase.plan", "phase.build", "phase.review", "phase.ship"];
  return rows
    .map((r) => ({
      id: r.id,
      scope: r.scope,
      heartbeatTimeoutSeconds: r.heartbeatTimeoutSeconds,
      totalPhaseTimeoutSeconds: r.totalPhaseTimeoutSeconds,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedBy,
    }))
    .sort((a, b) => {
      const ai = PHASE_ORDER.indexOf(a.scope);
      const bi = PHASE_ORDER.indexOf(b.scope);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      // both not in phase order — "default" sinks to the bottom
      if (a.scope === "default") return 1;
      if (b.scope === "default") return -1;
      return a.scope.localeCompare(b.scope);
    });
}

export type UpdateResult =
  | { ok: true; row: StallThresholdRow }
  | { ok: false; error: string };

/**
 * Update one threshold row. Validates: positive integers, heartbeat <
 * total (otherwise the wall-clock cap would fire before the heartbeat
 * cap, making the latter dead code).
 */
export async function updateStallThreshold(
  scope: string,
  heartbeatTimeoutSeconds: number,
  totalPhaseTimeoutSeconds: number,
): Promise<UpdateResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "Not authenticated" };

  if (!Number.isInteger(heartbeatTimeoutSeconds) || heartbeatTimeoutSeconds <= 0) {
    return { ok: false, error: "heartbeatTimeoutSeconds must be a positive integer" };
  }
  if (!Number.isInteger(totalPhaseTimeoutSeconds) || totalPhaseTimeoutSeconds <= 0) {
    return { ok: false, error: "totalPhaseTimeoutSeconds must be a positive integer" };
  }
  if (heartbeatTimeoutSeconds >= totalPhaseTimeoutSeconds) {
    return {
      ok: false,
      error: "heartbeatTimeoutSeconds must be less than totalPhaseTimeoutSeconds (otherwise the heartbeat cap is dead code)",
    };
  }

  try {
    const updated = await prisma.buildStudioStallThreshold.update({
      where: { scope },
      data: {
        heartbeatTimeoutSeconds,
        totalPhaseTimeoutSeconds,
        updatedBy: userId,
      },
    });
    return {
      ok: true,
      row: {
        id: updated.id,
        scope: updated.scope,
        heartbeatTimeoutSeconds: updated.heartbeatTimeoutSeconds,
        totalPhaseTimeoutSeconds: updated.totalPhaseTimeoutSeconds,
        updatedAt: updated.updatedAt.toISOString(),
        updatedBy: updated.updatedBy,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
