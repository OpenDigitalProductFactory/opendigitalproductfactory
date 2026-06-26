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
export type ResolvedPostureSource = "agent" | "organization" | "platform";

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

// ─── Per-coworker (per-agent) posture ────────────────────────────────────────
//
// Each AI coworker can remember its OWN Cost/Quality/Time posture. Stored
// migration-free as a map keyed by agentId under the platform profile's
// autonomyPolicy.goldenTrianglePerAgent — a single existing JSON column, no new
// rows or schema. The per-agent posture layers ABOVE org/platform at dispatch so
// a coworker's own choice tunes its runs (see getEffectivePostureForAgent).

const PER_AGENT_KEY = "goldenTrianglePerAgent";

/**
 * Guard the agentId before it is used as an object property name, so a hostile
 * value can never inject into Object.prototype (CWE-915 / js/remote-property-
 * injection). Rejects the prototype-pollution keys outright and constrains the
 * shape to the real agentId charset (e.g. "build-specialist", "coo").
 */
function isSafeAgentKey(agentId: string): boolean {
  return (
    typeof agentId === "string" &&
    agentId.length > 0 &&
    agentId.length <= 128 &&
    agentId !== "__proto__" &&
    agentId !== "prototype" &&
    agentId !== "constructor" &&
    /^[A-Za-z0-9_.:-]+$/.test(agentId)
  );
}

/** Read a coworker's own saved posture, or null if it has none. Fail-open. */
export async function getAgentGoldenTrianglePosture(
  agentId: string,
  db?: GoldenTrianglePersistenceClient,
): Promise<GoldenTrianglePreference | null> {
  if (!isSafeAgentKey(agentId)) return null;
  const client = db ?? (prisma as unknown as GoldenTrianglePersistenceClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: whereForScope({ kind: "platform" }),
      select: { autonomyPolicy: true },
    });
    const map = asRecord(asRecord(row?.autonomyPolicy)[PER_AGENT_KEY]);
    const gt = map[agentId];
    return isGoldenTrianglePreference(gt) ? gt : null;
  } catch (err) {
    console.warn("[golden-triangle] per-agent posture read failed (fail-open):", err);
    return null;
  }
}

/** Merge a coworker's posture into the per-agent map. Returns true if a row was updated. */
export async function setAgentGoldenTrianglePosture(
  agentId: string,
  preference: GoldenTrianglePreference,
  db?: GoldenTrianglePersistenceClient,
): Promise<boolean> {
  if (!isSafeAgentKey(agentId)) return false;
  const client = db ?? (prisma as unknown as GoldenTrianglePersistenceClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: whereForScope({ kind: "platform" }),
      select: { autonomyPolicy: true },
    });
    const policy = asRecord(row?.autonomyPolicy);
    const nextMap = { ...asRecord(policy[PER_AGENT_KEY]), [agentId]: preference };
    const res = await client.decisionPerspectiveProfile.updateMany({
      where: whereForScope({ kind: "platform" }),
      data: { autonomyPolicy: { ...policy, [PER_AGENT_KEY]: nextMap } },
    });
    return res.count > 0;
  } catch (err) {
    console.warn("[golden-triangle] per-agent posture write failed (fail-open):", err);
    return false;
  }
}

/**
 * Remove a coworker's OWN posture so it falls back to inheriting org/platform.
 * The "Reset to inherited" path on the record's Priority section. Idempotent:
 * returns true when a row was updated (whether or not the key was present),
 * false on a fail-open error. Preserves every other per-agent entry and the
 * rest of the autonomyPolicy.
 */
export async function clearAgentGoldenTrianglePosture(
  agentId: string,
  db?: GoldenTrianglePersistenceClient,
): Promise<boolean> {
  if (!isSafeAgentKey(agentId)) return false;
  const client = db ?? (prisma as unknown as GoldenTrianglePersistenceClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: whereForScope({ kind: "platform" }),
      select: { autonomyPolicy: true },
    });
    const policy = asRecord(row?.autonomyPolicy);
    const currentMap = asRecord(policy[PER_AGENT_KEY]);
    if (!(agentId in currentMap)) {
      // Nothing to clear; treat as success so the UI reflects "inherited".
      return true;
    }
    const nextMap: Record<string, unknown> = { ...currentMap };
    delete nextMap[agentId];
    const res = await client.decisionPerspectiveProfile.updateMany({
      where: whereForScope({ kind: "platform" }),
      data: { autonomyPolicy: { ...policy, [PER_AGENT_KEY]: nextMap } },
    });
    return res.count > 0;
  } catch (err) {
    console.warn("[golden-triangle] per-agent posture clear failed (fail-open):", err);
    return false;
  }
}

/**
 * Resolve the posture for a specific coworker, layering most-specific first:
 * agent (the coworker's own choice) → organization (WWWD) → platform (WWMD) →
 * null (caller falls back to Balanced). This is what dispatch consults so a
 * coworker's posture actually tunes its runs.
 */
export async function getEffectivePostureForAgent(
  agentId: string | null,
  organizationId: string | null,
  db?: GoldenTrianglePersistenceClient,
): Promise<ResolvedPosture | null> {
  if (agentId) {
    const agent = await getAgentGoldenTrianglePosture(agentId, db);
    if (agent) return { preference: agent, source: "agent" };
  }
  return getEffectiveGoldenTrianglePosture(organizationId, db);
}
