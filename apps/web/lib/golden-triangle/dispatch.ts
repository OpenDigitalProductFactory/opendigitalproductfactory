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
//     non-Balanced default is explicitly chosen on /platform/ai/priority.
// It only FEEDS routing (the compiler never re-implements routing).
import { compileGoldenTrianglePolicy } from "./compile";
import { applyPostureToRouteContext, type AppliedPosture } from "./compose";
import { getEffectiveGoldenTrianglePosture, type GoldenTrianglePersistenceClient } from "./persistence";
import type { GoldenTrianglePreset } from "./types";

export interface DispatchPosture extends AppliedPosture {
  preset: GoldenTrianglePreset;
  /** Which scope supplied the posture — for telemetry/explanation, never routing. */
  source: "organization" | "platform";
}

/**
 * Resolve the posture to apply to a dispatch, or null when nothing should change.
 * `organizationId` is null in single-org installs (falls back to the platform
 * default). Returns null for Balanced/no-op postures so callers can skip work.
 */
export async function resolveDispatchPosture(
  organizationId: string | null = null,
  taskClass = "conversation",
  db?: GoldenTrianglePersistenceClient,
): Promise<DispatchPosture | null> {
  try {
    const resolved = await getEffectiveGoldenTrianglePosture(organizationId, db);
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
