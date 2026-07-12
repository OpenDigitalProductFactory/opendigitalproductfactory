// BI-BB13B599 (EP-WORK-CONVERGENCE): server loader that fetches the WorkCapsule
// linked to each Build Studio build (WorkCapsule.featureBuildId === FeatureBuild.id,
// set on every build via attachBuildStudioWorkCapsule) and projects each into the
// plain, business-safe customer-mode status. Returns a map keyed by the build's
// cuid `id` so the client can look up the active build's status without pulling
// the capsule projection into the client bundle. Pure aside from the single
// findMany — unit-testable with a mock delegate.
import type { BuildPhase } from "@/lib/explore/feature-build-types";
import {
  projectBuildStudioCustomerStatus,
  type BuildStudioCustomerStatus,
} from "@/lib/build/customer-status-projection";

interface CapsuleFindManyDelegate {
  workCapsule: {
    findMany: (args: {
      where: { featureBuildId: { in: string[] } };
      select: { featureBuildId: true; capsuleId: true; status: true };
    }) => Promise<Array<{ featureBuildId: string | null; capsuleId: string; status: string }>>;
  };
}

/** Minimal build shape the projection needs — the cuid id, title, and phase. */
export interface CustomerStatusBuild {
  id: string;
  title: string;
  phase: BuildPhase;
}

/**
 * Fetch the linked capsule for each build in one query and project each build
 * into its plain customer-mode status. Builds with no linked capsule degrade to
 * the phase-only fallback inside projectBuildStudioCustomerStatus.
 */
export async function loadBuildStudioCustomerStatuses(
  db: CapsuleFindManyDelegate,
  builds: ReadonlyArray<CustomerStatusBuild>,
): Promise<Record<string, BuildStudioCustomerStatus>> {
  const ids = Array.from(new Set(builds.map((b) => b.id)));
  const byBuild = new Map<string, { capsuleId: string; status: string }>();
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

  const statuses: Record<string, BuildStudioCustomerStatus> = {};
  for (const build of builds) {
    statuses[build.id] = projectBuildStudioCustomerStatus({
      build: { title: build.title, phase: build.phase },
      capsule: byBuild.get(build.id) ?? null,
    });
  }
  return statuses;
}
