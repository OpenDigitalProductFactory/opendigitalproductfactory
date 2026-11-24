import { isRecord } from "@/lib/shared/coerce";
import type { GithubReaderResult, PullRequestCustodySource } from "@/lib/contributor-change-lanes/github-rest-reader";
import { parseVerifiedPullRequestObservation, type PullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { WORK_CAPSULE_OPEN_PR_FRESHNESS_MS } from "./liveness";
import { authoredHeadSha } from "./authored-head";
import { resolvePullRequestBindings } from "./pull-request-binding";

const BATCH_LIMIT = 100;
const SNAPSHOT_LIMIT = 1000;

type OpenCoverage =
  | { status: "unknown"; reason: string }
  | { status: "complete"; count: number; unverifiedHeadRepository: number };

type OpenObservation = { observation: PullRequestObservation; source?: PullRequestCustodySource | null };
type OpenPopulation = { coverage: OpenCoverage; open: Map<string, OpenObservation> };

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
) {
  const { prisma } = await import("@dpf/db");
  const { coverage: openCoverage, open } = validateOpenPopulation(openScan, now);
  const result = { bound: 0, compareAndSwapLost: 0, skipped: 0, invalidObservations: 0, hasMore: false, reason: "observed", openCoverage };
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
    if (source?.headRepositoryFullName?.toLowerCase() === observation.repositoryFullName.toLowerCase()
      && !terminalNumbers.has(key)) custody.set(observation, source);
  }
  const observations = openScan ? [
    ...terminal.filter((row) => !open.has(String(row.number))),
    ...custody.keys(),
  ] : recent;
  if (!observations.length) return { ...result, reason: "no-observations" };
  const rooms = await prisma.workroom.findMany({
    where: {
      archivedAt: null, status: { notIn: ["complete", "abandoned", "archived"] },
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
      const source = custody.get(candidate);
      if (source) return source.baseBranch === room.baseBranch && candidate.headSha.toLowerCase() === head;
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
    const source = custody.get(observation);
    const saved = await prisma.$transaction(async (tx) => {
      const update = await tx.workroom.updateMany({
        where: { id: room.id, updatedAt: room.updatedAt, archivedAt: null,
          repositoryFullName: room.repositoryFullName, headBranch: room.headBranch, headSha: room.headSha,
          ...(source ? { baseBranch: source.baseBranch, status: { notIn: ["complete", "abandoned", "archived"] } } : {}),
          pullRequestNumber: room.pullRequestNumber, pullRequestUrl: room.pullRequestUrl },
        data: { pullRequestNumber: binding.pullRequestNumber, pullRequestUrl: binding.pullRequestUrl },
      });
      if (update.count !== 1) return false;
      await tx.workroomActivity.create({ data: {
        workCapsuleId: room.id, kind: "evidence",
        summary: `Observed pull request #${binding.pullRequestNumber} (${binding.state}); linked repository and branch.`,
        payload: { syncRunId, ...(source ? { headRepositoryFullName: source.headRepositoryFullName,
          baseBranch: source.baseBranch, baseSha: source.baseSha } : { snapshotRunId }),
          repositoryFullName: observation.repositoryFullName,
          pullRequestNumber: observation.number, pullRequestUrl: observation.url,
          previousPullRequestNumber: room.pullRequestNumber, previousPullRequestUrl: room.pullRequestUrl,
          headSha: observation.headSha, state: observation.state,
          observationFingerprint: observation.observationFingerprint,
          confirmedAt: source ? observation.observedAt : run!.completedAt!.toISOString() },
      } });
      return true;
    });
    if (saved) result.bound += 1;
    else result.compareAndSwapLost += 1;
  }
  return result;
}
