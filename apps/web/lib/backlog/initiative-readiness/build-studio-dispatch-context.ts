import type { InitiativeRecoveryDispatchContext } from "@/lib/tak/initiative-readiness-tool-grants";

/**
 * The `feature-build-revision` canonical artifact as the reviewer recovery
 * accepts it (PR-1 widened `InitiativeRecoveryCanonicalArtifact`; this is the
 * same shape, declared here so PR-2 stands on main without PR-1).
 */
export type BuildStudioRevisionArtifact = {
  resolved: true;
  kind: "feature-build-revision";
  revisionId: string;
  valueDigest: string;
  buildId: string;
};

// BI-926A7E90 PR-2 — a Build Studio room carries a dispatch context.
//
// The reviewer recovery binds a review to a dispatch context (room, repository,
// branch, immutable head) and a canonical artifact. A Build Studio build has no
// repository spec: its design is the accepted `designDoc` revision of the
// `FeatureBuild`, and its room records no branch head (122 of 122 plan-phase
// Build Studio rooms on 2026-10-02). This module derives both from what the
// room DOES hold, so the dispatcher (PR-3) can route the owed reviews:
//
//   dispatchContext.headSha  = sandbox head when the room has one, else the
//                              design revision's value digest — the immutable
//                              identity the request key is keyed on, so a
//                              changed design yields a new request key (AC-4).
//   canonicalArtifact        = { kind: "feature-build-revision", revisionId,
//                              valueDigest, buildId } (spec §1, PR-1 binding).
//   planArtifact             = the accepted `buildPlan` revision, same shape.
//
// Pure over an injected db; no provider I/O.

export const BUILD_STUDIO_EXECUTOR_KIND = "build-studio";
export const BUILD_BRANCH_PREFIX = "build/";

export type BuildStudioDispatchUnavailableReason =
  | "room-not-found"
  | "not-a-build-studio-room"
  | "no-build"
  | "not-in-plan"
  | "no-accepted-design";

export type BuildStudioDispatchResolution =
  | {
    available: true;
    buildId: string;
    itemId: string | null;
    dispatchContext: InitiativeRecoveryDispatchContext;
    canonicalArtifact: BuildStudioRevisionArtifact;
    planArtifact: BuildStudioRevisionArtifact | null;
  }
  | { available: false; reason: BuildStudioDispatchUnavailableReason };

type RevisionRow = { id: string; valueDigest: string };

export type BuildStudioDispatchRoom = {
  capsuleId: string;
  executorKind: string | null;
  repositoryFullName: string | null;
  headSha: string | null;
  featureBuild: {
    buildId: string;
    phase: string;
    originator: { itemId: string } | null;
    artifactRevisions: Array<RevisionRow & { field: string }>;
  } | null;
};

export type BuildStudioDispatchDb = {
  workroom: {
    findUnique(args: {
      where: { capsuleId: string };
      select: typeof BUILD_STUDIO_DISPATCH_ROOM_SELECT;
    }): Promise<BuildStudioDispatchRoom | null>;
  };
};

/** The one select every caller uses, so a room always answers the same shape. */
export const BUILD_STUDIO_DISPATCH_ROOM_SELECT = {
  capsuleId: true,
  executorKind: true,
  repositoryFullName: true,
  headSha: true,
  featureBuild: {
    select: {
      buildId: true,
      phase: true,
      originator: { select: { itemId: true } },
      artifactRevisions: {
        where: { status: "accepted", field: { in: ["designDoc", "buildPlan"] } },
        orderBy: [{ revisionNumber: "desc" as const }, { createdAt: "desc" as const }],
        select: { id: true, field: true, valueDigest: true },
      },
    },
  },
} as const;

function latestAccepted(revisions: ReadonlyArray<RevisionRow & { field: string }>, field: string): RevisionRow | null {
  // The select orders newest first; the first row per field is the current one.
  return revisions.find((revision) => revision.field === field) ?? null;
}

/**
 * The digest exactly as BuildArtifactRevision stores it (bare hex on the
 * install). The reader compares the bound value with the stored one and the
 * request key is derived from it, so the binding must carry the stored form:
 * prefixing it `sha256:` made every read fail `immutable_blob_mismatch` on
 * 2026-10-06 (BI-926A7E90 live proof).
 */
function storedDigest(valueDigest: string): string {
  return valueDigest.trim();
}

/**
 * Resolve the dispatch context and canonical artifact for a Build Studio room
 * whose build is in `plan`. `canonicalRepositoryFullName` is the install's
 * canonical repository, used when the room records none.
 */
export function resolveBuildStudioDispatch(
  room: BuildStudioDispatchRoom | null,
  canonicalRepositoryFullName: string,
): BuildStudioDispatchResolution {
  if (!room) return { available: false, reason: "room-not-found" };
  if (room.executorKind !== BUILD_STUDIO_EXECUTOR_KIND) return { available: false, reason: "not-a-build-studio-room" };
  const build = room.featureBuild;
  if (!build) return { available: false, reason: "no-build" };
  if (build.phase !== "plan") return { available: false, reason: "not-in-plan" };
  const design = latestAccepted(build.artifactRevisions, "designDoc");
  if (!design) return { available: false, reason: "no-accepted-design" };
  const plan = latestAccepted(build.artifactRevisions, "buildPlan");
  const designDigest = storedDigest(design.valueDigest);
  const canonicalArtifact = {
    resolved: true as const,
    kind: "feature-build-revision" as const,
    revisionId: design.id,
    valueDigest: designDigest,
    buildId: build.buildId,
  };
  return {
    available: true,
    buildId: build.buildId,
    itemId: build.originator?.itemId ?? null,
    dispatchContext: {
      workroomId: room.capsuleId,
      repositoryFullName: room.repositoryFullName ?? canonicalRepositoryFullName,
      branchName: `${BUILD_BRANCH_PREFIX}${build.buildId}`,
      headSha: room.headSha ?? designDigest,
    },
    canonicalArtifact,
    planArtifact: plan
      ? {
        resolved: true as const,
        kind: "feature-build-revision" as const,
        revisionId: plan.id,
        valueDigest: storedDigest(plan.valueDigest),
        buildId: build.buildId,
      }
      : null,
  };
}

/** Load the room and resolve it. The repository name resolver is injected so this stays provider-free. */
export async function resolveBuildStudioDispatchContext(args: {
  db: BuildStudioDispatchDb;
  capsuleId: string;
  canonicalRepositoryFullName: () => Promise<string>;
}): Promise<BuildStudioDispatchResolution> {
  const room = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
    select: BUILD_STUDIO_DISPATCH_ROOM_SELECT,
  });
  if (!room) return { available: false, reason: "room-not-found" };
  return resolveBuildStudioDispatch(room, room.repositoryFullName ?? await args.canonicalRepositoryFullName());
}
