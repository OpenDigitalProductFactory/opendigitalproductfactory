import { prisma } from "@dpf/db";

/**
 * EP-EMPLOYEE-OCCUPATION Phase 1 (BI-442E2B42) — the occupation resolver.
 *
 * Resolves a customer's in-trench employee to their OCCUPATION (dental hygienist,
 * field service technician) so downstream surfaces can focus the workspace, scope
 * the coworker roster, and drive the job-aware onboarding intro. Occupation is a
 * FOCUS + curation layer; it never widens the platform-management RBAC floor.
 *
 * Resolution walks: EmployeeProfile.positionId -> Position.occupationKey ->
 * OccupationProfile. An unmapped position resolves to `null` (honest fallback to
 * the archetype/platform home — never a broken surface).
 *
 * Caching: the employee->occupation walk is deliberately UNCACHED (reads live
 * Position each call) so a mover event — a changed Position.occupationKey — is
 * picked up immediately (spec §5.2). Only the immutable OccupationProfile config
 * is memoized by key; `invalidateOccupationCache` is the seam the Phase-5 mover
 * event and any seed re-run call to drop that memo.
 *
 * Spec: docs/superpowers/specs/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace-design.md §5.1/§5.2
 */

export const OCCUPATION_INTERACTIONS = ["summon", "assigned-only", "read-only"] as const;
export type OccupationInteraction = (typeof OCCUPATION_INTERACTIONS)[number];

export type OccupationCoworkerGrant = {
  agentSlug: string;
  interaction: OccupationInteraction;
  governanceProfileRef: string | null;
};

export type OccupationFeatureSurface = {
  tileAllowlist: string[];
  navEmphasis: string[];
  workspaceHomeOccupationId: string | null;
};

export type ResolvedOccupation = {
  occupationKey: string;
  label: string;
  summary: string;
  archetypeCategories: string[];
  archetypeIds: string[];
  baseAccessProfile: string;
  wsidProfessionFamily: string | null;
  featureSurface: OccupationFeatureSurface;
  coworkerRoster: OccupationCoworkerGrant[];
  onboardingCurriculumId: string;
  moverCurriculumId: string | null;
};

type PositionKeyRow = { position: { occupationKey: string | null } | null } | null;

/**
 * The minimal Prisma surface the resolver needs. Kept structural (not the full
 * generated `PrismaClient`) so tests can inject a small fake and the module does
 * not couple to generated types — the DI pattern that avoids `vi.mock` bleed.
 */
export interface OccupationDbClient {
  occupationProfile: {
    findFirst(args: { where: { occupationKey: string; isActive: boolean } }): Promise<unknown>;
  };
  employeeProfile: {
    findUnique(args: { where: { id: string }; select: { position: { select: { occupationKey: true } } } }): Promise<PositionKeyRow>;
    findFirst(args: { where: { userId: string }; select: { position: { select: { occupationKey: true } } } }): Promise<PositionKeyRow>;
  };
}

const defaultDb = prisma as unknown as OccupationDbClient;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseFeatureSurface(value: unknown): OccupationFeatureSurface {
  const rec = asRecord(value);
  const workspaceHomeOccupationId = rec.workspaceHomeOccupationId;
  return {
    tileAllowlist: asStringArray(rec.tileAllowlist),
    navEmphasis: asStringArray(rec.navEmphasis),
    workspaceHomeOccupationId:
      typeof workspaceHomeOccupationId === "string" ? workspaceHomeOccupationId : null,
  };
}

function parseCoworkerRoster(value: unknown): OccupationCoworkerGrant[] {
  if (!Array.isArray(value)) return [];
  const grants: OccupationCoworkerGrant[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    const agentSlug = rec.agentSlug;
    const interaction = rec.interaction;
    if (typeof agentSlug !== "string") continue;
    if (
      typeof interaction !== "string" ||
      !OCCUPATION_INTERACTIONS.includes(interaction as OccupationInteraction)
    ) {
      continue;
    }
    grants.push({
      agentSlug,
      interaction: interaction as OccupationInteraction,
      governanceProfileRef:
        typeof rec.governanceProfileRef === "string" ? rec.governanceProfileRef : null,
    });
  }
  return grants;
}

function toResolvedOccupation(value: unknown): ResolvedOccupation {
  const row = asRecord(value);
  return {
    occupationKey: String(row.occupationKey ?? ""),
    label: String(row.label ?? ""),
    summary: String(row.summary ?? ""),
    archetypeCategories: asStringArray(row.archetypeCategories),
    archetypeIds: asStringArray(row.archetypeIds),
    baseAccessProfile: String(row.baseAccessProfile ?? ""),
    wsidProfessionFamily: typeof row.wsidProfessionFamily === "string" ? row.wsidProfessionFamily : null,
    featureSurface: parseFeatureSurface(row.featureSurface),
    coworkerRoster: parseCoworkerRoster(row.coworkerRoster),
    onboardingCurriculumId: String(row.onboardingCurriculumId ?? ""),
    moverCurriculumId: typeof row.moverCurriculumId === "string" ? row.moverCurriculumId : null,
  };
}

// Memoizes the immutable OccupationProfile config keyed by occupationKey. `null`
// is cached as an explicit MISS marker so unknown keys don't re-query every call.
const OCCUPATION_MISS = Symbol("occupation-miss");
const profileCache = new Map<string, ResolvedOccupation | typeof OCCUPATION_MISS>();

/**
 * The invalidation seam (spec §5.2). Called by the Phase-5 mover event and by any
 * occupation re-seed so a changed OccupationProfile config is re-read. Pass a key
 * to drop one entry, or omit to clear all.
 */
export function invalidateOccupationCache(occupationKey?: string): void {
  if (occupationKey) profileCache.delete(occupationKey);
  else profileCache.clear();
}

/** Loads an active OccupationProfile by key (memoized). Returns null when unknown/inactive. */
export async function getOccupationByKey(
  occupationKey: string,
  db: OccupationDbClient = defaultDb,
): Promise<ResolvedOccupation | null> {
  const cached = profileCache.get(occupationKey);
  if (cached !== undefined) return cached === OCCUPATION_MISS ? null : cached;

  const row = await db.occupationProfile.findFirst({
    where: { occupationKey, isActive: true },
  });
  const resolved = row ? toResolvedOccupation(row) : null;
  profileCache.set(occupationKey, resolved ?? OCCUPATION_MISS);
  return resolved;
}

/**
 * Resolves an employee's occupation via their position. Returns null when the
 * employee has no position, the position has no occupationKey, or the referenced
 * occupation is unknown/inactive — every case an honest fallback, not an error.
 */
export async function resolveOccupationForEmployee(
  employeeProfileId: string,
  db: OccupationDbClient = defaultDb,
): Promise<ResolvedOccupation | null> {
  const employee = await db.employeeProfile.findUnique({
    where: { id: employeeProfileId },
    select: { position: { select: { occupationKey: true } } },
  });
  const occupationKey = employee?.position?.occupationKey;
  if (!occupationKey) return null;
  return getOccupationByKey(occupationKey, db);
}

/**
 * Convenience for surfaces that hold a userId (workspace resolver, coworker panel):
 * finds the linked EmployeeProfile, then resolves its occupation. Null when the
 * user has no employee profile or no mapped occupation.
 */
export async function resolveOccupationForUser(
  userId: string,
  db: OccupationDbClient = defaultDb,
): Promise<ResolvedOccupation | null> {
  const employee = await db.employeeProfile.findFirst({
    where: { userId },
    select: { position: { select: { occupationKey: true } } },
  });
  const occupationKey = employee?.position?.occupationKey;
  if (!occupationKey) return null;
  return getOccupationByKey(occupationKey, db);
}
