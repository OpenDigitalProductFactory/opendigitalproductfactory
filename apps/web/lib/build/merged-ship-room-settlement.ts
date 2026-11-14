// apps/web/lib/build/merged-ship-room-settlement.ts
//
// BI-8129F585 (WWMD DI-3C0499710B23): a ship build whose PR merged after its
// room was closed could never complete. The PR reconciler only scans open
// rooms, so the merge was never recorded; the July rooms of FB-E50E3024 (#3029)
// and FB-C1CE0E72 (#3028) also carry no repository or head; and the deployment
// closure only read inventory snapshots, which exist for recent PRs and age out
// after seven days.
//
// This settles such a room from one verified GitHub observation of its PR: the
// room gets the PR's repository and head (never rebinding a different source),
// a delivery state (awaiting-release when merged, closed when closed unmerged),
// and the fingerprinted observation itself, which the deployment closure reads
// when no inventory snapshot exists. The closure still requires the canonical
// self-upgrade run and the git lineage check; nothing here declares a build
// deployed.

import {
  parseVerifiedPullRequestObservation,
  type PullRequestObservation,
} from "@/lib/contributor-change-lanes/pull-request-observation";
import {
  createBuildPrDeliveryState,
  readBuildPrDeliveryState,
  writeBuildPrDeliveryState,
} from "./build-pr-delivery-state";

/** Where the verified merged-PR observation is kept on the room's workspaceState. */
export const MERGED_PR_OBSERVATION_KEY = "mergedPullRequestObservation";

export type SettlementRoom = {
  id: string;
  capsuleId: string;
  status: string;
  repositoryFullName: string | null;
  headSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  workspaceState: unknown;
};

export type RoomSettlement = {
  repositoryFullName: string;
  headSha: string;
  workspaceState: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The verified observation a room recorded, or null when absent or altered. */
export function readRecordedMergedObservation(workspaceState: unknown): PullRequestObservation | null {
  return parseVerifiedPullRequestObservation(object(workspaceState)[MERGED_PR_OBSERVATION_KEY]);
}

function repositoryFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  } catch {
    return null;
  }
}

/**
 * The room update a verified observation justifies, or null when it justifies
 * none: an open PR, a different repository, PR or head, or a room already
 * settled.
 */
export function planMergedRoomSettlement(
  room: SettlementRoom,
  observation: PullRequestObservation,
  observedAt: string,
): RoomSettlement | null {
  if (observation.state === "open") return null;
  if (room.pullRequestNumber !== observation.number) return null;
  const repository = room.repositoryFullName ?? repositoryFromUrl(room.pullRequestUrl);
  if (repository !== observation.repositoryFullName) return null;
  if (room.headSha && room.headSha.toLowerCase() !== observation.headSha.toLowerCase()) return null;

  const existing = readBuildPrDeliveryState(room.workspaceState);
  if (existing && ["awaiting-release", "deployed", "closed"].includes(existing.status)
    && readRecordedMergedObservation(room.workspaceState)) {
    return null;
  }

  const base = existing ?? createBuildPrDeliveryState({
    repository: observation.repositoryFullName,
    prNumber: observation.number,
    prUrl: observation.url,
  });
  const merged = observation.state === "merged";
  const delivery = {
    ...base,
    status: merged ? "awaiting-release" as const : "closed" as const,
    lastObservedHeadSha: observation.headSha,
    lastReadiness: merged ? "merged" as const : "closed" as const,
    lastObservedAt: observedAt,
    lastError: null,
  };
  return {
    repositoryFullName: observation.repositoryFullName,
    headSha: observation.headSha,
    workspaceState: {
      ...writeBuildPrDeliveryState(room.workspaceState, delivery),
      [MERGED_PR_OBSERVATION_KEY]: observation,
    },
  };
}

export type SettlementDeps = {
  /** Closed rooms with a bound PR whose FeatureBuild is still in ship. */
  listCandidates(): Promise<SettlementRoom[]>;
  readObservation(input: { repository: string; prNumber: number }): Promise<PullRequestObservation | null>;
  saveRoom(room: SettlementRoom, settlement: RoomSettlement): Promise<unknown>;
  now(): Date;
};

/** One pass: observe each candidate's PR once and record what it proves. Never throws per room. */
export async function settleMergedShipBuildRooms(deps: SettlementDeps): Promise<{ observed: number; settled: number }> {
  let observed = 0;
  let settled = 0;
  for (const room of await deps.listCandidates()) {
    const repository = room.repositoryFullName ?? repositoryFromUrl(room.pullRequestUrl);
    if (!repository || !room.pullRequestNumber) continue;
    try {
      const observation = await deps.readObservation({ repository, prNumber: room.pullRequestNumber });
      if (!observation) continue;
      observed++;
      const plan = planMergedRoomSettlement(room, observation, deps.now().toISOString());
      if (!plan) continue;
      await deps.saveRoom(room, plan);
      settled++;
    } catch {
      // A rate limit or unreachable provider is not evidence; the next pass retries.
    }
  }
  return { observed, settled };
}

/** Production wiring for the ship reconciler (apps/web/instrumentation.ts). */
export async function settleMergedShipBuildRoomsNow(): Promise<{ observed: number; settled: number }> {
  const { prisma } = await import("@dpf/db");
  const { resolveGithubToken, readGithubPullRequestObservation } = await import(
    "@/lib/contributor-change-lanes/github-rest-reader"
  );
  const token = await resolveGithubToken(prisma as never);
  if (!token) return { observed: 0, settled: 0 };
  return settleMergedShipBuildRooms({
    listCandidates: async () => {
      const builds = await prisma.featureBuild.findMany({ where: { phase: "ship" }, select: { id: true } });
      if (builds.length === 0) return [];
      const rooms = await prisma.workroom.findMany({
        where: {
          featureBuildId: { in: builds.map((b) => b.id) },
          pullRequestNumber: { not: null },
          status: { in: ["complete", "abandoned", "archived"] },
        },
        select: {
          id: true, capsuleId: true, status: true, repositoryFullName: true, headSha: true,
          pullRequestNumber: true, pullRequestUrl: true, workspaceState: true,
        },
      });
      // A settled room needs no further GitHub reads.
      return rooms.filter((room) => !readRecordedMergedObservation(room.workspaceState));
    },
    readObservation: ({ repository, prNumber }) =>
      readGithubPullRequestObservation({ repositoryFullName: repository, number: prNumber, token }),
    saveRoom: (room, plan) => prisma.workroom.updateMany({
      where: { id: room.id, status: room.status },
      data: {
        repositoryFullName: plan.repositoryFullName,
        headSha: plan.headSha,
        workspaceState: plan.workspaceState as never,
      },
    }),
    now: () => new Date(),
  });
}
