// Planned-file-path resolution for the acumen-aware Build Studio phase gates
// (BI-70280889, follow-on to W16 / BI-18519A73).
//
// The plan/ship gates accept an optional `plannedFilePaths` and consult each
// IMPACTED acumen's profession gate from it. Before this module no caller
// supplied one, so `deriveImpactedAcumens([])` always returned empty and the
// whole acumen layer was inert in production. The data was never missing — it
// was simply never handed over.
//
// Two ordered sources, most-authoritative first:
//
//   1. The build's Workroom `verificationState.changeImpactContract.paths` —
//      derived and persisted by claim_workroom_scope from the edit claims, and
//      already rendered to operators as "EXPECTED FILES" in the build drawer.
//      When its `status` is "resolved" these are the paths the change-impact
//      machinery itself committed to.
//   2. The plan document / brief, via the existing extractExpectedPlanFiles
//      parser that the sandbox-state projection already uses.
//
// At the SHIP gate the actual diff is better evidence than any plan, so
// resolveShippedFilePaths prefers the diffstat and falls back to the same
// ordered sources.
//
// FAIL-OPEN by contract, exactly like the consults these feed: any resolution
// error yields an empty list, which returns the gates to their prior
// byte-identical behaviour. A gate must never fail because path resolution
// failed.

import {
  extractExpectedPlanFiles,
  parseDiffstat,
  serializePlanDocument,
} from "@/lib/build/sandbox-state";
import { getErrorMessage } from "@/lib/shared/get-error-message";

/**
 * Consulting is capped at MAX_ACUMEN_CONSULTS_PER_PHASE acumens anyway, but an
 * unbounded path list would still make deriveImpactedAcumens do needless work
 * on a large refactor plan. Impact derivation is order-insensitive, so a cap is
 * safe: the acumen set converges long before this many paths.
 */
export const MAX_PLANNED_FILE_PATHS = 200;

// Minimal Prisma surface this resolver needs — keeps tests DB-free without
// reaching for `any`. The argument types are the EXACT shapes called below
// (parameters are contravariant, so a wider `unknown` would make the real
// PrismaClient unassignable), and the results are PromiseLike because Prisma's
// fluent client is thenable rather than a true Promise.
type WorkroomContractQuery = {
  where: { featureBuildId: string };
  select: { verificationState: true };
  orderBy: { updatedAt: "desc" };
};

type BuildPlanQuery = {
  where: { buildId: string };
  select: { buildPlan: true; description: true; diffPatch: true };
};

export type PlannedFilePathsClient = {
  workroom: {
    findFirst: (
      args: WorkroomContractQuery,
    ) => PromiseLike<{ verificationState: unknown } | null>;
  };
  featureBuild: {
    findUnique: (
      args: BuildPlanQuery,
    ) => PromiseLike<
      { buildPlan: unknown; description: string | null; diffPatch: string | null } | null
    >;
  };
};

type ChangeImpactContract = {
  paths?: unknown;
  status?: unknown;
};

/**
 * Read `verificationState.changeImpactContract.paths` defensively — the column
 * is untyped JSON, so every level may be absent or the wrong shape.
 */
export function readChangeImpactPaths(verificationState: unknown): string[] {
  if (!verificationState || typeof verificationState !== "object") return [];
  const contract = (verificationState as { changeImpactContract?: unknown })
    .changeImpactContract as ChangeImpactContract | undefined;
  if (!contract || typeof contract !== "object") return [];
  if (!Array.isArray(contract.paths)) return [];
  return normalizeFilePaths(contract.paths);
}

/**
 * Keep repo-relative source paths and drop anything that cannot be one.
 * Absolute paths and parent-escapes are rejected rather than normalized: a path
 * outside the repo is a signal something upstream is wrong, and silently
 * rewriting it would hide that.
 */
export function normalizeFilePaths(candidates: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const path = candidate.trim().replace(/^\.\//, "");
    if (path.length === 0) continue;
    if (path.startsWith("/") || path.includes("..")) continue;
    if (!path.includes("/")) continue;
    seen.add(path);
    if (seen.size >= MAX_PLANNED_FILE_PATHS) break;
  }
  return [...seen];
}

async function pathsFromWorkroom(
  db: PlannedFilePathsClient,
  buildRowId: string,
): Promise<string[]> {
  const room = await db.workroom.findFirst({
    where: { featureBuildId: buildRowId },
    select: { verificationState: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!room) return [];
  return readChangeImpactPaths(room.verificationState);
}

async function pathsFromPlan(
  db: PlannedFilePathsClient,
  buildId: string,
): Promise<{ planned: string[]; changed: string[] }> {
  const build = await db.featureBuild.findUnique({
    where: { buildId },
    select: { buildPlan: true, description: true, diffPatch: true },
  });
  if (!build) return { planned: [], changed: [] };
  const planned = normalizeFilePaths(
    extractExpectedPlanFiles({
      planDocument:
        typeof build.buildPlan === "string"
          ? build.buildPlan
          : serializePlanDocument(build.buildPlan),
      description: build.description,
    }),
  );
  const changed = build.diffPatch
    ? normalizeFilePaths(parseDiffstat(build.diffPatch).sourceDiffstat.map((entry) => entry.path))
    : [];
  return { planned, changed };
}

/**
 * Paths the PLAN→BUILD gate should consult acumens about.
 * Workroom change-impact contract first, plan document second.
 *
 * `buildRowId` is the FeatureBuild primary key (the Workroom FK target);
 * `buildId` is the semantic FB-* id. Callers usually hold both.
 */
export async function resolvePlannedFilePaths(input: {
  db: PlannedFilePathsClient;
  buildId: string;
  buildRowId?: string | null;
}): Promise<string[]> {
  try {
    if (input.buildRowId) {
      const fromRoom = await pathsFromWorkroom(input.db, input.buildRowId);
      if (fromRoom.length > 0) return fromRoom;
    }
    const { planned } = await pathsFromPlan(input.db, input.buildId);
    return planned;
  } catch (error) {
    console.warn(
      "[acumen-paths] plan-path resolution failed build=%s error=%s",
      JSON.stringify(input.buildId),
      JSON.stringify(getErrorMessage(error)),
    );
    return [];
  }
}

/**
 * Paths the SHIP gate should consult acumens about. The realized diff wins over
 * any plan — at ship time what the build actually touched is known, and a plan
 * the build diverged from would consult the wrong acumens.
 */
export async function resolveShippedFilePaths(input: {
  db: PlannedFilePathsClient;
  buildId: string;
  buildRowId?: string | null;
  /** Already-loaded diff, when the caller has one (saves a round-trip). */
  diffPatch?: string | null;
}): Promise<string[]> {
  try {
    if (input.diffPatch) {
      const fromDiff = normalizeFilePaths(
        parseDiffstat(input.diffPatch).sourceDiffstat.map((entry) => entry.path),
      );
      if (fromDiff.length > 0) return fromDiff;
    }
    const { planned, changed } = await pathsFromPlan(input.db, input.buildId);
    if (changed.length > 0) return changed;
    if (input.buildRowId) {
      const fromRoom = await pathsFromWorkroom(input.db, input.buildRowId);
      if (fromRoom.length > 0) return fromRoom;
    }
    return planned;
  } catch (error) {
    console.warn(
      "[acumen-paths] ship-path resolution failed build=%s error=%s",
      JSON.stringify(input.buildId),
      JSON.stringify(getErrorMessage(error)),
    );
    return [];
  }
}
