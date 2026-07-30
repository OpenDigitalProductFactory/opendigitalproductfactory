// EP-GOLDEN-TRIANGLE Slice 3 (BI-CF28CCF0) — wire the saved posture into live dispatch.
//
// resolveDispatchPosture() reads the effective posture (organization → platform →
// none), compiles it, and returns the routing overrides + effort to apply at the
// prepareRoute seam. Two safety properties make this safe to ship on the inference
// hot path:
//   • Fail-open — any error, a missing default, or a malformed value returns null,
//     so dispatch proceeds exactly as it does today.
//   • Balanced-inert — a Balanced (no-op) posture produces no overrides and
//     returns null, so merging this in is byte-identical to flag-off until a
//     non-Balanced default is explicitly chosen on the Priority & Models surface.
// It only FEEDS routing (the compiler never re-implements routing).
import { compileGoldenTrianglePolicy } from "./compile";
import { applyPostureToRouteContext, type AppliedPosture } from "./compose";
import { getEffectivePostureForAgent, type GoldenTrianglePersistenceClient } from "./persistence";
import type { GoldenTrianglePreset } from "./types";
import { prisma } from "@dpf/db";

export interface DispatchPosture extends AppliedPosture {
  preset: GoldenTrianglePreset;
  /** Which scope supplied the posture — for telemetry/explanation, never routing. */
  source: "agent" | "organization" | "platform";
}

/**
 * Resolve the posture to apply to a dispatch, or null when nothing should change.
 * Layers the calling coworker's own posture ABOVE org/platform: agent → org →
 * platform → null. `agentId` is the dispatching coworker (null for non-coworker
 * runs); `organizationId` is null in single-org installs. Returns null for
 * Balanced/no-op postures so callers can skip work.
 */
export async function resolveDispatchPosture(
  agentId: string | null = null,
  taskClass = "conversation",
  organizationId: string | null = null,
  db?: GoldenTrianglePersistenceClient,
): Promise<DispatchPosture | null> {
  try {
    const resolved = await getEffectivePostureForAgent(agentId, organizationId, db);
    if (!resolved) return null;
    const decoded = compileGoldenTrianglePolicy({
      preference: resolved.preference,
      taskClass,
      authorityScope: { kind: "wwmd" },
    });
    const applied = applyPostureToRouteContext(decoded.postureOverride);
    const hasRouteContext = Object.keys(applied.routeContext).length > 0;
    if (!hasRouteContext && applied.effort === undefined) return null; // Balanced / no-op → inert
    return { ...applied, preset: resolved.preference.preset, source: resolved.source };
  } catch {
    return null;
  }
}

/**
 * Resolve many coworker postures from one platform-profile read. The roster
 * needs the same effective posture as live dispatch, but must not issue one
 * identical profile query per coworker.
 */
export async function resolveDispatchPostures(
  agentIds: readonly string[],
  taskClass = "conversation",
  db?: GoldenTrianglePersistenceClient,
): Promise<Map<string, DispatchPosture | null>> {
  const client =
    db ?? (prisma as unknown as GoldenTrianglePersistenceClient);
  let platformProfilePromise:
    | ReturnType<
        GoldenTrianglePersistenceClient["decisionPerspectiveProfile"]["findFirst"]
      >
    | undefined;
  const cachedClient: GoldenTrianglePersistenceClient = {
    decisionPerspectiveProfile: {
      findFirst: async (args) => {
        if (!platformProfilePromise) {
          platformProfilePromise =
            client.decisionPerspectiveProfile.findFirst(args);
        }
        return platformProfilePromise;
      },
      updateMany: (args) =>
        client.decisionPerspectiveProfile.updateMany(args),
    },
  };

  return new Map(
    await Promise.all(
      [...new Set(agentIds)].map(async (agentId) => [
        agentId,
        await resolveDispatchPosture(
          agentId,
          taskClass,
          null,
          cachedClient,
        ),
      ] as const),
    ),
  );
}
