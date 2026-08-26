/**
 * EP-WORK-POSTURE (BI-WORKROOM-DEFAULTS) — the decreed default for rooms.
 *
 * The posture ladder had a gap the operator could feel: a room could DECLARE a
 * posture and the platform had a coworker-level default, but there was nowhere
 * to say "this is how rooms behave here unless the room says otherwise". The
 * per-coworker controls answer "how does THIS coworker behave"; this answers
 * "how does work in a room behave", which is a different question and the one
 * the founder asked.
 *
 * MIGRATION-FREE, and deliberately the same home the Golden Triangle posture
 * already uses: the `autonomyPolicy` JSON on the seeded platform
 * DecisionPerspectiveProfile, under a distinct `workroomPostureDefault` key.
 * Reads and writes preserve every other key in that column.
 *
 * WHERE IT SITS IN THE LADDER (resolve.ts §3.1):
 *   hard policy > room declaration > derived > WORKROOM DEFAULT > agent > org > platform
 * Above agent/org/platform because it is specifically about rooms and they are
 * not; below derivation because what the work actually IS outranks a blanket
 * preference about rooms. A room that declares nothing and derives nothing gets
 * this.
 */
import { prisma } from "@dpf/db";

import type { RoomPostureDeclaration } from "@/lib/work-posture";

const PLATFORM_PROFILE_ID = "mark-dpf-platform";
const DEFAULT_KEY = "workroomPostureDefault";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type WorkroomPostureDefaultsClient = {
  decisionPerspectiveProfile: {
    findFirst: (args: unknown) => Promise<{ autonomyPolicy: unknown } | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

const PROACTIVITY_LEVELS = ["quiet", "balanced", "assertive"];
const ACTION_BOUNDARIES = ["advise", "propose", "preauthorized"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Narrow an untyped JSON value to a usable default. Anything unrecognised is
 * dropped rather than coerced: a half-understood default would silently govern
 * every room in the install.
 */
export function parseWorkroomPostureDefault(value: unknown): RoomPostureDeclaration | null {
  const raw = asRecord(value);
  const level = raw.proactivityLevel;
  const boundary = raw.actionBoundary;
  const hasLevel = typeof level === "string" && PROACTIVITY_LEVELS.includes(level);
  const hasBoundary = typeof boundary === "string" && ACTION_BOUNDARIES.includes(boundary);
  if (!hasLevel && !hasBoundary) return null;
  return {
    ...(hasLevel ? { proactivityLevel: level as RoomPostureDeclaration["proactivityLevel"] } : {}),
    ...(hasBoundary
      ? { actionBoundary: boundary as RoomPostureDeclaration["actionBoundary"] }
      : {}),
    declaredBy: typeof raw.declaredBy === "string" ? raw.declaredBy : null,
    declaredAt: typeof raw.declaredAt === "string" ? raw.declaredAt : null,
  };
}

/** Read the decreed default, or null when none is set. Fail-open: never throws into a render. */
export async function getWorkroomPostureDefault(
  db?: WorkroomPostureDefaultsClient,
): Promise<RoomPostureDeclaration | null> {
  const client = db ?? (prisma as unknown as WorkroomPostureDefaultsClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: { profileId: PLATFORM_PROFILE_ID },
      select: { autonomyPolicy: true },
    });
    return parseWorkroomPostureDefault(asRecord(row?.autonomyPolicy)[DEFAULT_KEY]);
  } catch (err) {
    console.warn("[workroom-posture] default read failed (fail-open):", err);
    return null;
  }
}

/** Set the decreed default, preserving every other autonomyPolicy key. */
export async function setWorkroomPostureDefault(
  next: RoomPostureDeclaration,
  db?: WorkroomPostureDefaultsClient,
): Promise<boolean> {
  const client = db ?? (prisma as unknown as WorkroomPostureDefaultsClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: { profileId: PLATFORM_PROFILE_ID },
      select: { autonomyPolicy: true },
    });
    const policy = asRecord(row?.autonomyPolicy);
    const res = await client.decisionPerspectiveProfile.updateMany({
      where: { profileId: PLATFORM_PROFILE_ID },
      data: { autonomyPolicy: { ...policy, [DEFAULT_KEY]: next } },
    });
    return res.count > 0;
  } catch (err) {
    console.warn("[workroom-posture] default write failed (fail-open):", err);
    return false;
  }
}

/** Clear the decreed default so rooms fall back to the coworker/org/platform ladder. */
export async function clearWorkroomPostureDefault(
  db?: WorkroomPostureDefaultsClient,
): Promise<boolean> {
  const client = db ?? (prisma as unknown as WorkroomPostureDefaultsClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: { profileId: PLATFORM_PROFILE_ID },
      select: { autonomyPolicy: true },
    });
    const policy = asRecord(row?.autonomyPolicy);
    if (!(DEFAULT_KEY in policy)) return true; // already absent — treat as success
    const nextPolicy: Record<string, unknown> = { ...policy };
    delete nextPolicy[DEFAULT_KEY];
    const res = await client.decisionPerspectiveProfile.updateMany({
      where: { profileId: PLATFORM_PROFILE_ID },
      data: { autonomyPolicy: nextPolicy },
    });
    return res.count > 0;
  } catch (err) {
    console.warn("[workroom-posture] default clear failed (fail-open):", err);
    return false;
  }
}
