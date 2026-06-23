// EP-GOLDEN-TRIANGLE Slice 4 (BI-85B2E96C) — migration-free persistence of a
// saved posture per authority scope.
//
// The posture is stored under the `goldenTriangle` key of a
// DecisionPerspectiveProfile's `autonomyPolicy` JSON column — the home the
// Slice 0 audit identified (no schema change; sidesteps the missing
// `datasource.url` migration constraint in worktrees). Reads/writes preserve the
// other autonomyPolicy keys (e.g. the risk-envelope policy). Fail-open: a
// settings read/write must never throw into a page render or an action.
import { prisma } from "@dpf/db";

import type { GoldenTrianglePreference, GoldenTrianglePreset } from "@/lib/golden-triangle";

/** WWMD/platform default lives on the seeded platform profile; WWWD on the org profile. */
export type GoldenTriangleScope =
  | { kind: "platform" }
  | { kind: "organization"; organizationId: string };

const PLATFORM_PROFILE_ID = "mark-dpf-platform";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type GoldenTrianglePersistenceClient = {
  decisionPerspectiveProfile: {
    findFirst: (args: unknown) => Promise<{ autonomyPolicy: unknown } | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

const PRESETS: GoldenTrianglePreset[] = ["fast", "frugal", "assured", "balanced", "custom"];

function whereForScope(scope: GoldenTriangleScope): Record<string, unknown> {
  return scope.kind === "platform"
    ? { profileId: PLATFORM_PROFILE_ID }
    : { ownerOrganizationId: scope.organizationId, kind: "organization" };
}

/** Narrow an unknown JSON value to a valid preference (defensive — JSON is untyped). */
export function isGoldenTrianglePreference(v: unknown): v is GoldenTrianglePreference {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.costWeight === "number" &&
    typeof o.qualityWeight === "number" &&
    typeof o.timeWeight === "number" &&
    typeof o.preset === "string" &&
    PRESETS.includes(o.preset as GoldenTrianglePreset)
  );
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export async function getGoldenTrianglePosture(
  scope: GoldenTriangleScope,
  db?: GoldenTrianglePersistenceClient,
): Promise<GoldenTrianglePreference | null> {
  const client = db ?? (prisma as unknown as GoldenTrianglePersistenceClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: whereForScope(scope),
      select: { autonomyPolicy: true },
    });
    const gt = asRecord(row?.autonomyPolicy).goldenTriangle;
    return isGoldenTrianglePreference(gt) ? gt : null;
  } catch (err) {
    console.warn("[golden-triangle] posture read failed (fail-open):", err);
    return null;
  }
}

/** Merge the posture into the scoped profile's autonomyPolicy. Returns true if a row was updated. */
export async function setGoldenTrianglePosture(
  scope: GoldenTriangleScope,
  preference: GoldenTrianglePreference,
  db?: GoldenTrianglePersistenceClient,
): Promise<boolean> {
  const client = db ?? (prisma as unknown as GoldenTrianglePersistenceClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: whereForScope(scope),
      select: { autonomyPolicy: true },
    });
    const nextPolicy = { ...asRecord(row?.autonomyPolicy), goldenTriangle: preference };
    const res = await client.decisionPerspectiveProfile.updateMany({
      where: whereForScope(scope),
      data: { autonomyPolicy: nextPolicy },
    });
    return res.count > 0;
  } catch (err) {
    console.warn("[golden-triangle] posture write failed (fail-open):", err);
    return false;
  }
}

/** The scope a resolved posture came from — surfaced so the UI can show "why this default". */
export type ResolvedPostureSource = "organization" | "platform";

export interface ResolvedPosture {
  preference: GoldenTrianglePreference;
  source: ResolvedPostureSource;
}

/**
 * Resolve the posture that should apply, layering scopes most-specific first:
 * organization (WWWD, the org's own choice) → platform (WWMD, the shipped seed
 * default) → null (the caller falls back to Balanced, the byte-identical-to-off
 * cold start). Pure composition over the fail-open reader, so it inherits
 * fail-open behaviour. `organizationId` may be null when there is no org context.
 */
export async function getEffectiveGoldenTrianglePosture(
  organizationId: string | null,
  db?: GoldenTrianglePersistenceClient,
): Promise<ResolvedPosture | null> {
  if (organizationId) {
    const org = await getGoldenTrianglePosture({ kind: "organization", organizationId }, db);
    if (org) return { preference: org, source: "organization" };
  }
  const platform = await getGoldenTrianglePosture({ kind: "platform" }, db);
  if (platform) return { preference: platform, source: "platform" };
  return null;
}
