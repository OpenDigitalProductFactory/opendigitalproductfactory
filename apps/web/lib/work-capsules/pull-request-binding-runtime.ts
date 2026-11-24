import { randomUUID } from "node:crypto";
import { operatesASourceRepository, type ArchetypeDefinition } from "@dpf/storefront-templates";
import {
  createBuildPrDeliveryState,
  readBuildPrDeliveryState,
  writeBuildPrDeliveryState,
} from "@/lib/build/build-pr-delivery-state";
import {
  resolveRepoIdentity,
  type GithubReaderResult,
  type PullRequestCustodySource,
} from "@/lib/contributor-change-lanes/github-rest-reader";
import { parseVerifiedPullRequestObservation, type PullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { isRecord } from "@/lib/shared/coerce";
import { readOrganizationTopAccountablePrincipalId } from "@/lib/work-management/organization-accountable.server";
import { withWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { WORK_CAPSULE_OPEN_PR_FRESHNESS_MS } from "./liveness";
import { authoredHeadSha } from "./authored-head";
import { resolvePullRequestBindings } from "./pull-request-binding";

const BATCH_LIMIT = 100;
const SNAPSHOT_LIMIT = 1000;
const TERMINAL_STATUSES = ["complete", "abandoned", "archived"] as const;

type OpenCoverage =
  | { status: "unknown"; reason: string }
  | { status: "complete"; count: number; unverifiedHeadRepository: number };

type OpenObservation = { observation: PullRequestObservation; source?: PullRequestCustodySource | null };
type OpenPopulation = { coverage: OpenCoverage; open: Map<string, OpenObservation> };

export type ReconcileBindingsOptions = {
  reconcileCustody?: boolean;
};

export type PullRequestCustodySummary = {
  adopted: number;
  handedOff: number;
  alreadyOwned: number;
  awaitingAuthorization: number;
  staleSkipped: number;
  compareAndSwapLost: number;
  skippedReason: string | null;
};

export function buildPullRequestCustodyKey(repositoryFullName: string, prNumber: number): string {
  return `pr-custody:${repositoryFullName.toLowerCase()}#${prNumber}`;
}

function emptyCustodySummary(skippedReason: string | null): PullRequestCustodySummary {
  return {
    adopted: 0,
    handedOff: 0,
    alreadyOwned: 0,
    awaitingAuthorization: 0,
    staleSkipped: 0,
    compareAndSwapLost: 0,
    skippedReason,
  };
}

function isSameRepositoryPullRequest(
  observation: PullRequestObservation,
  source: PullRequestCustodySource | null | undefined,
): boolean {
  return Boolean(source?.headRepositoryFullName)
    && source!.headRepositoryFullName!.toLowerCase() === observation.repositoryFullName.toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function nextCapsuleId(): string {
  return `WC-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

type CustodyRecoveryReason =
  | "unverified-head-repository"
  | "fork-pull-request"
  | "draft-pull-request"
  | "accountable-owner-missing";

function classifyCustodyRecoveryReason(input: {
  observation: PullRequestObservation;
  source: PullRequestCustodySource | null | undefined;
  accountableOwnerPrincipalId: string | null;
}): CustodyRecoveryReason | null {
  if (!input.source || !input.source.headRepositoryFullName) return "unverified-head-repository";
  if (!isSameRepositoryPullRequest(input.observation, input.source)) return "fork-pull-request";
  if (input.observation.isDraft) return "draft-pull-request";
  if (!input.accountableOwnerPrincipalId) return "accountable-owner-missing";
  return null;
}

function buildPrCustodyMetadata(input: {
  observation: PullRequestObservation;
  source: PullRequestCustodySource | null | undefined;
  accountableOwnerPrincipalId: string | null;
  standingRoomCapsuleId: string | null;
  recoveryReason: CustodyRecoveryReason | null;
  now: Date;
}) {
  return {
    mode: input.recoveryReason === null ? "build-studio-custody" : "observe-only",
    recoveryReason: input.recoveryReason,
    repositoryFullName: input.observation.repositoryFullName,
    prNumber: input.observation.number,
    prUrl: input.observation.url,
    headRepositoryFullName: input.source?.headRepositoryFullName ?? null,
    headRef: input.observation.headBranch,
    baseBranch: input.source?.baseBranch ?? null,
    headSha: input.observation.headSha,
    isDraft: input.observation.isDraft,
    authorLogin: input.source?.authorLogin ?? null,
    authorType: input.source?.authorType ?? null,
    accountableOwnerPrincipalId: input.accountableOwnerPrincipalId,
    standingRoomCapsuleId: input.standingRoomCapsuleId,
    reconciledAt: input.now.toISOString(),
  };
}

function mergeCustodyWorkspaceState(
  existingState: unknown,
  observation: PullRequestObservation,
  prCustody: Record<string, unknown>,
) {
  const base = isRecord(existingState) ? { ...existingState, prCustody } : { prCustody };
  const delivery = readBuildPrDeliveryState(existingState)
    ?? createBuildPrDeliveryState({
      repository: observation.repositoryFullName,
      prNumber: observation.number,
      prUrl: observation.url,
    });
  return writeBuildPrDeliveryState(base, delivery) as unknown as import("@dpf/db").Prisma.InputJsonValue;
}

async function resolveAccountableStandingDuty(prisma: typeof import("@dpf/db").prisma) {
  const standingRoom = await prisma.workroom.findFirst({
    where: {
      idempotencyKey: { startsWith: "standing-room:pull-request-flow" },
      archivedAt: null,
      status: { notIn: [...TERMINAL_STATUSES] },
    },
    select: {
      id: true,
      capsuleId: true,
      createdByPrincipalId: true,
      requestedByPrincipalId: true,
      participants: {
        where: { lifecycle: "active", roles: { hasSome: ["accountable", "coordinator"] } },
        select: { principalId: true, roles: true },
        take: 10,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const standingOwner =
    standingRoom?.participants.find((p) => p.roles.includes("accountable"))?.principalId
    ?? standingRoom?.participants.find((p) => p.roles.includes("coordinator"))?.principalId
    ?? null;
  const accountableOwnerPrincipalId = standingOwner
    ?? (await readOrganizationTopAccountablePrincipalId(prisma as never));
  return { standingRoom, accountableOwnerPrincipalId };
}

async function reconcileOpenPullRequestCustody(input: {
  prisma: typeof import("@dpf/db").prisma;
  syncRunId: string;
  now: Date;
  openCoverage: OpenCoverage;
  open: Map<string, OpenObservation>;
  terminalNumbers: Set<string>;
}): Promise<PullRequestCustodySummary> {
  const { prisma, syncRunId, now, openCoverage, open, terminalNumbers } = input;
  if (openCoverage.status !== "complete") return emptyCustodySummary(openCoverage.reason);
  const summary = emptyCustodySummary(null);
  if (open.size === 0) return summary;

  const storefront = await prisma.storefrontConfig.findFirst({
    select: { archetype: { select: { category: true } } },
  });
  const category = storefront?.archetype?.category ?? null;
  if (!category || !operatesASourceRepository({ category } as Pick<ArchetypeDefinition, "category"> as ArchetypeDefinition)) {
    return emptyCustodySummary("archetype-not-applicable");
  }

  const managedRepo = await resolveRepoIdentity(prisma as never);
  const managedRepoFullName = `${managedRepo.owner}/${managedRepo.name}`.toLowerCase();
  const { standingRoom, accountableOwnerPrincipalId } = await resolveAccountableStandingDuty(prisma);
  const standingRoomRef = standingRoom ? `standing-room:${standingRoom.capsuleId}` : "standing-duty:pull-request-flow";

  const openEntries: Array<{ key: string; observation: PullRequestObservation; source?: PullRequestCustodySource | null }> = [];
  for (const [key, entry] of open) {
    if (terminalNumbers.has(key) || entry.observation.repositoryFullName.toLowerCase() !== managedRepoFullName) {
      summary.staleSkipped += 1;
      continue;
    }
    openEntries.push({ key, ...entry });
  }
  if (!openEntries.length) return summary;

  const existingRooms = await prisma.workroom.findMany({
    where: {
      archivedAt: null,
      status: { notIn: [...TERMINAL_STATUSES] },
      OR: openEntries.flatMap(({ observation, source }) => {
        const sameRepo = isSameRepositoryPullRequest(observation, source);
        return [
          { repositoryFullName: observation.repositoryFullName, pullRequestNumber: observation.number },
          ...(sameRepo ? [{ repositoryFullName: observation.repositoryFullName, headBranch: observation.headBranch }] : []),
        ];
      }),
    },
    select: {
      id: true,
      capsuleId: true,
      repositoryFullName: true,
      baseBranch: true,
      headBranch: true,
      headSha: true,
      pullRequestNumber: true,
      pullRequestUrl: true,
      executorKind: true,
      executorRef: true,
      featureBuildId: true,
      leaseHolderPrincipalId: true,
      leaseExpiresAt: true,
      createdByPrincipalId: true,
      requestedByPrincipalId: true,
      lastSyncedAt: true,
      workspaceState: true,
      updatedAt: true,
    },
  });

  for (const { observation, source } of openEntries.slice(0, BATCH_LIMIT)) {
    const sameRepo = isSameRepositoryPullRequest(observation, source);
    const matchedByPr = existingRooms.find(
      (r) => r.repositoryFullName?.toLowerCase() === observation.repositoryFullName.toLowerCase()
        && r.pullRequestNumber === observation.number,
    );
    const matchedByBranch = sameRepo
      ? existingRooms.find(
          (r) => r.repositoryFullName?.toLowerCase() === observation.repositoryFullName.toLowerCase()
            && r.headBranch === observation.headBranch,
        )
      : undefined;
    const existing = matchedByPr ?? matchedByBranch;

    if (existing) {
      if (!matchedByPr && (existing.baseBranch !== source?.baseBranch || existing.headSha?.toLowerCase() !== observation.headSha.toLowerCase())) {
        summary.staleSkipped += 1;
        continue;
      }
      if (
        matchedByPr
        && existing.headSha
        && existing.headSha.toLowerCase() !== observation.headSha.toLowerCase()
        && existing.lastSyncedAt
        && existing.lastSyncedAt.getTime() > Date.parse(observation.observedAt)
      ) {
        summary.staleSkipped += 1;
        continue;
      }
      const liveLease = existing.leaseExpiresAt != null && existing.leaseExpiresAt.getTime() > now.getTime();
      if (existing.featureBuildId != null || existing.executorKind === "build-studio" || liveLease) {
        summary.alreadyOwned += 1;
        continue;
      }
      if (existing.leaseExpiresAt != null && existing.leaseExpiresAt.getTime() <= now.getTime()) {
        const recoveryReason = classifyCustodyRecoveryReason({ observation, source, accountableOwnerPrincipalId });
        const roomOwner = existing.leaseHolderPrincipalId ?? existing.requestedByPrincipalId ?? existing.createdByPrincipalId;
        const sameOwnerEligible = recoveryReason === null
          && (roomOwner === null || roomOwner === accountableOwnerPrincipalId);
        if (!sameOwnerEligible) {
          summary.awaitingAuthorization += 1;
          continue;
        }
        const prCustody = buildPrCustodyMetadata({
          observation,
          source,
          accountableOwnerPrincipalId,
          standingRoomCapsuleId: standingRoom?.capsuleId ?? null,
          recoveryReason: null,
          now,
        });
        const handedOff = await prisma.$transaction(async (tx) => {
          const update = await tx.workroom.updateMany({
            where: {
              id: existing.id,
              updatedAt: existing.updatedAt,
              archivedAt: null,
              status: { notIn: [...TERMINAL_STATUSES] },
              executorKind: existing.executorKind,
              leaseHolderPrincipalId: existing.leaseHolderPrincipalId,
              leaseExpiresAt: existing.leaseExpiresAt,
            },
            data: {
              executorKind: "build-studio",
              executorRef: standingRoomRef,
              leaseHolderPrincipalId: accountableOwnerPrincipalId,
              leaseExpiresAt: null,
              headSha: observation.headSha,
              lastSyncedAt: now,
              workspaceState: mergeCustodyWorkspaceState(existing.workspaceState, observation, prCustody),
            },
          });
          if (update.count !== 1) return false;
          await tx.workroomActivity.create({
            data: {
              workCapsuleId: existing.id,
              kind: "executor-changed",
              summary: `Handed lapsed PR #${observation.number} custody from ${existing.executorKind ?? "none"} to build-studio.`,
              payload: {
                syncRunId,
                fromExecutorKind: existing.executorKind ?? null,
                fromExecutorRef: existing.executorRef ?? null,
                toExecutorKind: "build-studio",
                toExecutorRef: standingRoomRef,
                fromLeaseHolderPrincipalId: existing.leaseHolderPrincipalId ?? null,
                toLeaseHolderPrincipalId: accountableOwnerPrincipalId,
                reason: "lapsed-lease-pr-custody-handoff",
                pullRequestNumber: observation.number,
                pullRequestUrl: observation.url,
                headSha: observation.headSha,
              },
            },
          });
          return true;
        });
        if (handedOff) summary.handedOff += 1;
        else summary.compareAndSwapLost += 1;
        continue;
      }
      summary.alreadyOwned += 1;
      const recordedCustody = isRecord(existing.workspaceState) && isRecord(existing.workspaceState.prCustody)
        ? existing.workspaceState.prCustody
        : null;
      if (recordedCustody?.mode === "observe-only") summary.awaitingAuthorization += 1;
      continue;
    }

    const recoveryReason = classifyCustodyRecoveryReason({ observation, source, accountableOwnerPrincipalId });
    const actionable = recoveryReason === null;
    const custodyKey = buildPullRequestCustodyKey(observation.repositoryFullName, observation.number);
    const prCustody = buildPrCustodyMetadata({
      observation,
      source,
      accountableOwnerPrincipalId,
      standingRoomCapsuleId: standingRoom?.capsuleId ?? null,
      recoveryReason,
      now,
    });
    const scopeClaims = (actionable
      ? []
      : withWorkroomPostureClaim([], { proactivityLevel: "balanced", actionBoundary: "advise" }, now)
    ) as unknown as import("@dpf/db").Prisma.InputJsonValue;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const collision = await tx.workroom.findFirst({
          where: {
            OR: [
              { idempotencyKey: custodyKey },
              {
                archivedAt: null,
                status: { notIn: [...TERMINAL_STATUSES] },
                repositoryFullName: observation.repositoryFullName,
                pullRequestNumber: observation.number,
              },
              ...(sameRepo
                ? [{
                    archivedAt: null,
                    status: { notIn: [...TERMINAL_STATUSES] },
                    repositoryFullName: observation.repositoryFullName,
                    headBranch: observation.headBranch,
                  }]
                : []),
            ],
          },
          select: { id: true },
        });
        if (collision) return "lost" as const;

        const created = await tx.workroom.create({
          data: {
            capsuleId: nextCapsuleId(),
            title: `PR #${observation.number}: ${observation.title || observation.headBranch}`.slice(0, 200),
            objective: actionable
              ? `Own open PR #${observation.number} (${observation.url}) through verified checks, protected merge queue, and terminal closeout.`
              : `Track open PR #${observation.number} (${observation.url}); awaiting authorization (${recoveryReason}).`,
            status: "ready",
            source: "scheduled-steward",
            portfolioRole: "manufactureAndDeliver",
            executorKind: actionable ? "build-studio" : "human",
            executorRef: standingRoomRef,
            repositoryFullName: observation.repositoryFullName,
            baseBranch: source?.baseBranch ?? null,
            baseSha: source?.baseSha ?? null,
            headBranch: sameRepo ? observation.headBranch : null,
            headSha: observation.headSha,
            pullRequestNumber: observation.number,
            pullRequestUrl: observation.url,
            idempotencyKey: custodyKey,
            scopeClaims,
            workspaceState: mergeCustodyWorkspaceState({}, observation, prCustody),
            createdByPrincipalId: accountableOwnerPrincipalId,
            requestedByPrincipalId: accountableOwnerPrincipalId,
            leaseHolderPrincipalId: accountableOwnerPrincipalId,
            leaseExpiresAt: null,
            lastSyncedAt: now,
          },
        });
        await tx.workroomActivity.create({
          data: {
            workCapsuleId: created.id,
            kind: "adopted",
            summary: actionable
              ? `Adopted open PR #${observation.number} into Build Studio custody.`
              : `Recorded observe-only custody for open PR #${observation.number} (${recoveryReason}).`,
            payload: {
              syncRunId,
              repositoryFullName: observation.repositoryFullName,
              pullRequestNumber: observation.number,
              pullRequestUrl: observation.url,
              headRepositoryFullName: source?.headRepositoryFullName ?? null,
              headBranch: observation.headBranch,
              baseBranch: source?.baseBranch ?? null,
              headSha: observation.headSha,
              custodyMode: prCustody.mode,
              recoveryReason,
              accountableOwnerPrincipalId,
              standingRoomCapsuleId: standingRoom?.capsuleId ?? null,
            },
          },
        });
        if (standingRoom?.id && tx.workroomRelation?.createMany) {
          await tx.workroomRelation.createMany({
            data: [{ fromWorkroomId: standingRoom.id, toWorkroomId: created.id, relation: "contains" }],
            skipDuplicates: true,
          });
        }
        return "created" as const;
      });
      if (outcome === "created") {
        summary.adopted += 1;
        if (!actionable) summary.awaitingAuthorization += 1;
      } else {
        summary.compareAndSwapLost += 1;
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        summary.compareAndSwapLost += 1;
        continue;
      }
      throw error;
    }
  }

  return summary;
}

function validateOpenPopulation(scan: GithubReaderResult | undefined, now: Date): OpenPopulation {
  const unknown = (reason: string): OpenPopulation => ({ coverage: { status: "unknown", reason }, open: new Map() });
  if (!scan) return unknown("not-scanned");
  if (!scan.ok) return unknown(scan.error);
  if (scan.unchanged) return unknown("open-population-unconfirmed");
  if (scan.rows.length > SNAPSHOT_LIMIT) return unknown("open-population-limit");
  const open = new Map<string, OpenObservation>();
  for (const { sourceKey, payload, custodySource } of scan.rows) {
    const observation = parseVerifiedPullRequestObservation(payload);
    const age = observation ? now.getTime() - Date.parse(observation.observedAt) : Infinity;
    if (!observation || observation.state !== "open" || sourceKey !== String(observation.number)
      || open.has(sourceKey) || age < 0 || age > WORK_CAPSULE_OPEN_PR_FRESHNESS_MS) {
      return unknown("open-population-invalid");
    }
    open.set(sourceKey, { observation, source: custodySource });
  }
  const unverifiedHeadRepository = [...open.values()].filter(({ source }) => !source?.headRepositoryFullName).length;
  return { coverage: { status: "complete", count: open.size, unverifiedHeadRepository }, open };
}

/** The existing inventory owns provider reads and scheduling. */
export async function reconcileInventoryPullRequestBindings(
  syncRunId: string,
  now = new Date(),
  openScan?: GithubReaderResult,
  options?: ReconcileBindingsOptions,
) {
  const { prisma } = await import("@dpf/db");
  const { coverage: openCoverage, open } = validateOpenPopulation(openScan, now);
  const reconcileCustody = options?.reconcileCustody === true;
  const result = {
    bound: 0,
    compareAndSwapLost: 0,
    skipped: 0,
    invalidObservations: 0,
    hasMore: false,
    reason: "observed",
    openCoverage,
    custody: emptyCustodySummary(reconcileCustody ? (openCoverage.status === "unknown" ? openCoverage.reason : null) : "not-requested"),
  };
  const run = await prisma.contributorInventorySyncRun.findUnique({
    where: { syncRunId }, select: { completedAt: true, perSourceResult: true },
  });
  const summary = isRecord(run?.perSourceResult) ? run.perSourceResult["github-pr"] : null;
  const source = isRecord(summary) ? summary : {};
  const age = run?.completedAt ? now.getTime() - run.completedAt.getTime() : Infinity;
  const recentConfirmed = source.ok === true && age >= 0 && age <= WORK_CAPSULE_OPEN_PR_FRESHNESS_MS;
  if (!recentConfirmed && openCoverage.status === "unknown") {
    return { ...result, reason: "source-unconfirmed" };
  }
  const snapshotRunId = typeof source.snapshotRunId === "string" ? source.snapshotRunId : syncRunId;
  const snapshots = recentConfirmed ? await prisma.contributorInventorySnapshot.findMany({
    where: { syncRunId: snapshotRunId, source: "github-pr" },
    select: { payload: true }, orderBy: { sourceKey: "asc" }, take: SNAPSHOT_LIMIT + 1,
  }) : [];
  if (snapshots.length > SNAPSHOT_LIMIT) return { ...result, hasMore: true, reason: "snapshot-limit" };
  const recent = snapshots.flatMap(({ payload }) => {
    const observation = parseVerifiedPullRequestObservation(payload);
    return observation ? [observation] : [];
  });
  result.invalidObservations = snapshots.length - recent.length;
  // A PR reported both open and terminal can be changing during the two reads.
  // Wait for the next observation instead of picking either state on this tick.
  const terminal = recent.filter((row) => row.state !== "open");
  const terminalNumbers = new Set(terminal.map((row) => String(row.number)));
  const custody = new Map<PullRequestObservation, PullRequestCustodySource>();
  for (const [key, { observation, source }] of open) {
    if (isSameRepositoryPullRequest(observation, source) && !terminalNumbers.has(key)) {
      custody.set(observation, source!);
    }
  }
  const observations = openScan ? [
    ...terminal.filter((row) => !open.has(String(row.number))),
    ...custody.keys(),
  ] : recent;
  if (observations.length) {
    const rooms = await prisma.workroom.findMany({
      where: {
        archivedAt: null, status: { notIn: [...TERMINAL_STATUSES] },
        OR: observations.map((observation) => ({
            repositoryFullName: observation.repositoryFullName, headBranch: observation.headBranch,
            ...(custody.has(observation) ? { baseBranch: custody.get(observation)!.baseBranch, headSha: observation.headSha } : {}),
            AND: [
              // A room with no authored head yet (null, or still its claim-time
              // base: BI-A7797C2C) can only be matched in memory, because the
              // base comparison is column-to-column. The pure resolver applies
              // authoredHeadSha; this pre-filter admits every candidate for it.
              { OR: [{ headSha: observation.headSha }, { AND: [
                { OR: [{ pullRequestNumber: null }, { pullRequestNumber: observation.number }] },
                { OR: [{ pullRequestUrl: null }, { pullRequestUrl: observation.url }] },
              ] }] },
              { OR: [{ pullRequestNumber: null }, { pullRequestUrl: null },
                { pullRequestNumber: { not: observation.number } }, { pullRequestUrl: { not: observation.url } }] },
            ],
          })),
      },
      select: { id: true, capsuleId: true, repositoryFullName: true, headBranch: true,
        headSha: true, baseSha: true, baseBranch: true, pullRequestNumber: true, pullRequestUrl: true, updatedAt: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: BATCH_LIMIT + 1,
    });
    result.hasMore = rooms.length > BATCH_LIMIT;
    const batch = rooms.slice(0, BATCH_LIMIT);
    for (const room of batch) {
      const head = authoredHeadSha(room)?.toLowerCase();
      const candidates = observations.filter((candidate) => {
        if (candidate.repositoryFullName !== room.repositoryFullName || candidate.headBranch !== room.headBranch) return false;
        const candidateSource = custody.get(candidate);
        if (candidateSource) return candidateSource.baseBranch === room.baseBranch && candidate.headSha.toLowerCase() === head;
        // A terminal observation can identify a previously unbound room. Keep an
        // existing occurrence until a verified open replacement is observed.
        return !openScan || room.pullRequestNumber === null || room.pullRequestNumber === candidate.number;
      });
      const [binding] = resolvePullRequestBindings({ rooms: [room], observations: candidates }).bindings;
      if (!binding) {
        result.skipped += 1;
        continue;
      }
      const observation = candidates.find((candidate) => candidate.number === binding.pullRequestNumber
        && candidate.state === binding.state && (!head || candidate.headSha.toLowerCase() === head))!;
      const candidateSource = custody.get(observation);
      const saved = await prisma.$transaction(async (tx) => {
        const update = await tx.workroom.updateMany({
          where: { id: room.id, updatedAt: room.updatedAt, archivedAt: null,
            repositoryFullName: room.repositoryFullName, headBranch: room.headBranch, headSha: room.headSha,
            ...(candidateSource ? { baseBranch: candidateSource.baseBranch, status: { notIn: [...TERMINAL_STATUSES] } } : {}),
            pullRequestNumber: room.pullRequestNumber, pullRequestUrl: room.pullRequestUrl },
          data: { pullRequestNumber: binding.pullRequestNumber, pullRequestUrl: binding.pullRequestUrl },
        });
        if (update.count !== 1) return false;
        await tx.workroomActivity.create({ data: {
          workCapsuleId: room.id, kind: "evidence",
          summary: `Observed pull request #${binding.pullRequestNumber} (${binding.state}); linked repository and branch.`,
          payload: { syncRunId, ...(candidateSource ? { headRepositoryFullName: candidateSource.headRepositoryFullName,
            baseBranch: candidateSource.baseBranch, baseSha: candidateSource.baseSha } : { snapshotRunId }),
            repositoryFullName: observation.repositoryFullName,
            pullRequestNumber: observation.number, pullRequestUrl: observation.url,
            previousPullRequestNumber: room.pullRequestNumber, previousPullRequestUrl: room.pullRequestUrl,
            headSha: observation.headSha, state: observation.state,
            observationFingerprint: observation.observationFingerprint,
            confirmedAt: candidateSource ? observation.observedAt : run!.completedAt!.toISOString() },
        } });
        return true;
      });
      if (saved) result.bound += 1;
      else result.compareAndSwapLost += 1;
    }
  } else if (!reconcileCustody || openCoverage.status !== "complete" || open.size === 0) {
    return { ...result, reason: "no-observations" };
  }

  if (reconcileCustody) {
    result.custody = await reconcileOpenPullRequestCustody({
      prisma,
      syncRunId,
      now,
      openCoverage,
      open,
      terminalNumbers,
    });
  }
  return result;
}
