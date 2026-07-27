// apps/web/lib/build/capture-build-pr.ts
//
// Capture a Build Studio build's pull request onto its Work Capsule so the PR
// becomes a first-class, queryable, surfaceable fact instead of a free-text line
// buried in BuildActivity.
//
// Why this exists (delivery visibility — "where are my PRs?"):
//   A FeatureBuild auto-attaches a WorkCapsule at draft time
//   (work-capsules/build-studio-attachment.ts, featureBuildId = FeatureBuild.id),
//   and that capsule already carries `pullRequestUrl` / `pullRequestNumber`.
//   Those columns are READ in many places — the change-lanes projection
//   (lib/contributor-change-lanes/lane-projection.ts), the runtime-target rollup
//   (lib/runtime-coordination/runtime-targets.ts), and the capsule presenters —
//   but NOTHING wrote them at PR-creation time. `create_portal_pr` opened the PR,
//   logged it as free text, and the capsule fields stayed null, so every reader
//   fell back to a delayed, branch-name-matched GitHub inventory snapshot (or to
//   nothing). The model and the readers existed; only the writer was missing.
//   This is that writer: the moment a PR exists, stamp it onto the build's
//   capsule(s) so the delivery surfaces show it immediately.
//
// Migration-free: the columns already exist. Best-effort by contract: opening a
// PR must never hinge on this write — the caller wraps it in try/catch, and a
// build with no capsule yet (or missing inputs) is a non-error that returns
// `{ captured: 0 }` rather than throwing.

import {
  createBuildPrDeliveryState,
  writeBuildPrDeliveryState,
  type BuildPrDeliveryStateV1,
} from "./build-pr-delivery-state";

/** The narrow slice of the Prisma client this helper needs (injectable for tests). */
export interface CaptureBuildPrDeps {
  workCapsule: {
    findMany: (args: {
      where: { featureBuildId: string };
      select: { id: true; workspaceState: true };
    }) => Promise<Array<{ id: string; workspaceState: unknown }>>;
    update: (args: {
      where: { id: string };
      data: { pullRequestUrl: string; pullRequestNumber: number; workspaceState: Record<string, unknown> };
    }) => Promise<unknown>;
  };
}

export interface CaptureBuildPrArgs {
  db: CaptureBuildPrDeps;
  /**
   * FeatureBuild.id (the cuid) — the capsule's `featureBuildId` link.
   * NOT the FB-* semantic build id (that is the capsule's `executorRef`).
   */
  featureBuildId: string;
  prNumber: number;
  prUrl: string;
  repository?: string;
}

export async function persistBuildPrDeliveryStateForBuild(input: {
  db: CaptureBuildPrDeps;
  featureBuildId: string;
  delivery: BuildPrDeliveryStateV1;
}): Promise<number> {
  const capsules = await input.db.workCapsule.findMany({
    where: { featureBuildId: input.featureBuildId },
    select: { id: true, workspaceState: true },
  });
  await Promise.all(capsules.map((capsule) =>
    input.db.workCapsule.update({
      where: { id: capsule.id },
      data: {
        pullRequestUrl: input.delivery.prUrl,
        pullRequestNumber: input.delivery.prNumber,
        workspaceState: writeBuildPrDeliveryState(capsule.workspaceState, input.delivery),
      },
    }),
  ));
  return capsules.length;
}

/**
 * Stamp the PR (url + number) onto every Work Capsule linked to this build.
 *
 * @returns the number of capsules updated. `0` is a normal outcome — the build
 *   may not have a capsule yet, or a required input may be absent; neither is an
 *   error.
 */
export async function captureBuildPrOntoCapsule(
  args: CaptureBuildPrArgs,
): Promise<{ captured: number }> {
  const { db, featureBuildId, prNumber, prUrl } = args;

  // Guard: only write a real PR onto a real build. A blank id, an empty url, or
  // a non-positive/NaN number means there is nothing meaningful to capture.
  if (!featureBuildId || !prUrl || !Number.isFinite(prNumber) || prNumber <= 0) {
    return { captured: 0 };
  }

  const repository = args.repository ?? (() => {
    try {
      const url = new URL(prUrl);
      return url.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
    } catch {
      return "";
    }
  })();
  if (!repository) return { captured: 0 };

  const delivery = createBuildPrDeliveryState({ repository, prNumber, prUrl });
  const captured = await persistBuildPrDeliveryStateForBuild({ db, featureBuildId, delivery });
  return { captured };
}
