// BI-BB13B599 (EP-WORK-CONVERGENCE): server loader that fetches the WorkCapsule
// linked to each Build Studio build (WorkCapsule.featureBuildId === FeatureBuild.id,
// set on every build via attachBuildStudioWorkCapsule) and projects each into the
// plain, business-safe customer-mode status. Returns a map keyed by the build's
// cuid `id` so the client can look up the active build's status without pulling
// the capsule projection into the client bundle. Pure aside from the two queries
// — unit-testable with a mock delegate.
//
// BI-46204009: also fetches the latest BuildActivity per build so the
// projection can tell genuine "Working" apart from a stalled build. This MUST
// join on FeatureBuild.buildId (the FB-* semantic key), not the cuid `id` —
// BuildActivity.buildId references FeatureBuild.buildId, not FeatureBuild.id.
import type { BuildPhase } from "@/lib/explore/feature-build-types";
import {
  projectBuildStudioCustomerStatus,
  type BuildStudioCustomerStatus,
} from "@/lib/build/customer-status-projection";

// Narrow, test-mockable delegate shape. Prisma's real `groupBy` is typed via
// a conditional generic keyed on the full args object (orderBy/skip/take
// interplay), which does not structurally satisfy a hand-written closed
// signature — callers passing the real client cast at the call site
// (`prisma as unknown as CapsuleFindManyDelegate`) rather than this file
// widening to the full Prisma delegate type, which would break test mocks.
export interface CapsuleFindManyDelegate {
  workCapsule: {
    findMany: (args: {
      where: { featureBuildId: { in: string[] } };
      select: { featureBuildId: true; capsuleId: true; status: true };
    }) => Promise<Array<{ featureBuildId: string | null; capsuleId: string; status: string }>>;
  };
  buildActivity: {
    groupBy: (args: {
      by: ["buildId"];
      where: { buildId: { in: string[] } };
      _max: { createdAt: true };
    }) => Promise<Array<{ buildId: string; _max: { createdAt: Date | null } }>>;
  };
}

/**
 * Minimal build shape the projection needs — the cuid id (map key), the FB-*
 * semantic buildId (for the BuildActivity join), title, phase, and updatedAt
 * (freshness fallback when a build has no BuildActivity rows at all).
 */
export interface CustomerStatusBuild {
  id: string;
  buildId: string;
  title: string;
  phase: BuildPhase;
  updatedAt: Date;
}

/**
 * Fetch the linked capsule + latest BuildActivity for each build in two
 * queries and project each build into its plain customer-mode status. Builds
 * with no linked capsule degrade to the phase-only fallback; builds with no
 * recent activity in an active phase surface as stalled — both inside
 * projectBuildStudioCustomerStatus.
 */
export async function loadBuildStudioCustomerStatuses(
  db: CapsuleFindManyDelegate,
  builds: ReadonlyArray<CustomerStatusBuild>,
  now: Date = new Date(),
): Promise<Record<string, BuildStudioCustomerStatus>> {
  const ids = Array.from(new Set(builds.map((b) => b.id)));
  const buildIds = Array.from(new Set(builds.map((b) => b.buildId)));
  const byBuild = new Map<string, { capsuleId: string; status: string }>();
  const lastActivityByBuildId = new Map<string, Date>();
  if (ids.length > 0) {
    const capsules = await db.workCapsule.findMany({
      where: { featureBuildId: { in: ids } },
      select: { featureBuildId: true, capsuleId: true, status: true },
    });
    for (const capsule of capsules) {
      if (capsule.featureBuildId) {
        byBuild.set(capsule.featureBuildId, { capsuleId: capsule.capsuleId, status: capsule.status });
      }
    }
  }
  if (buildIds.length > 0) {
    const activityMax = await db.buildActivity.groupBy({
      by: ["buildId"],
      where: { buildId: { in: buildIds } },
      _max: { createdAt: true },
    });
    for (const row of activityMax) {
      if (row._max.createdAt) {
        lastActivityByBuildId.set(row.buildId, row._max.createdAt);
      }
    }
  }

  const statuses: Record<string, BuildStudioCustomerStatus> = {};
  for (const build of builds) {
    statuses[build.id] = projectBuildStudioCustomerStatus({
      build: { title: build.title, phase: build.phase, updatedAt: build.updatedAt },
      capsule: byBuild.get(build.id) ?? null,
      activity: { lastActivityAt: lastActivityByBuildId.get(build.buildId) ?? null, now },
    });
  }
  return statuses;
}
