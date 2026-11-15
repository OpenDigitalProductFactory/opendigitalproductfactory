// apps/web/lib/build/published-head-review.ts
//
// BI-C49EC080: a Build Studio PR could never pass Failure Readiness. The review
// pipeline earns its evidence and its semantic-review receipt on the build's
// sandbox commit, but publication mints a different commit through the GitHub
// API (the build's files laid over current main, github-api-commit.ts), and the
// room's head is that published commit (BI-ECA50241). Failure Readiness accepts
// only a receipt and evidence at the room's head, so nothing could match. A
// republish (BI-F31DB5F8) or a CI-repair follow-up (BI-085A37EC) moves the PR
// head again, and their published diff is not even the one that was reviewed.
//
// WWMD DI-58FE467DB115 settled the remedy: never weaken the exact-head rule;
// make the published commit earn its own review. The ship reconciler aligns the
// build's own clone to the exact PR head and returns the build to review, where
// the existing pipeline (finalize: gauntlet and in-platform scoped tests bound
// to the room head, failure analysis, semantic review) runs on that commit.
// When it passes, ship skips republication because the PR exists, and the PR
// reconciler finds a receipt at the PR head.

import { errorTail } from "./error-tail";

export const PUBLISHED_HEAD_REVIEW_TOOL = "published_head_review";
/** A refused or unfinished attempt for the same head waits this long. */
export const PUBLISHED_HEAD_REVIEW_RETRY_MS = 6 * 60 * 60 * 1000;
/** Attempts per published head before the reconciler stops trying it. */
export const PUBLISHED_HEAD_REVIEW_MAX_ATTEMPTS = 3;

export type PublishedHeadReviewResult =
  | "not-applicable"
  | "reviewed"
  | "recently-attempted"
  | "exhausted"
  | "not-aligned"
  | "returned-to-review";

export type PublishedHeadAlignment =
  | { status: "aligned"; headSha: string }
  | { status: "refused"; reason: string };

export type PublishedHeadReviewDeps = {
  /** The build's phase and exec state, and the head of its open PR (null before one exists). */
  load(buildId: string): Promise<{ phase: string; buildExecState: unknown; publishedHeadSha: string | null } | null>;
  /** True when the build's room holds any semantic-review receipt for this exact commit. */
  hasReceiptAt(sha: string, buildId: string): Promise<boolean>;
  /** Earlier attempts for this build, any head. */
  attempts(buildId: string): Promise<Array<{ headSha: string; at: Date }>>;
  /** Put the build's clone on the published commit. */
  align(buildId: string, publishedHeadSha: string): Promise<PublishedHeadAlignment>;
  /** Guarded ship→review flip; false when the row was no longer in ship. */
  returnToReview(buildId: string, buildExecState: Record<string, unknown>): Promise<boolean>;
  queueReview(buildId: string): Promise<void>;
  record(buildId: string, summary: string): Promise<void>;
  now(): Date;
};

/** Every attempt's trail row starts with this, so attempts are counted per head. */
export function publishedHeadAttemptMarker(headSha: string): string {
  return `[published head=${headSha}]`;
}

const MARKER = /^\[published head=([0-9a-f]{40})\]/;

export function parsePublishedHeadAttempt(summary: string): string | null {
  return MARKER.exec(summary)?.[1] ?? null;
}

export async function reviewPublishedHeadForShipBuild(
  buildId: string,
  deps: PublishedHeadReviewDeps = defaultDeps(),
): Promise<PublishedHeadReviewResult> {
  const build = await deps.load(buildId);
  const head = build?.publishedHeadSha ?? null;
  if (!build || build.phase !== "ship" || !head || !/^[0-9a-f]{40}$/.test(head)) return "not-applicable";
  if (await deps.hasReceiptAt(head, buildId)) return "reviewed";

  const earlier = (await deps.attempts(buildId)).filter((attempt) => attempt.headSha === head);
  if (earlier.length >= PUBLISHED_HEAD_REVIEW_MAX_ATTEMPTS) return "exhausted";
  const last = earlier.reduce<Date | null>((latest, attempt) => (!latest || attempt.at > latest ? attempt.at : latest), null);
  if (last && deps.now().getTime() - last.getTime() < PUBLISHED_HEAD_REVIEW_RETRY_MS) return "recently-attempted";

  const marker = publishedHeadAttemptMarker(head);
  const alignment = await deps.align(buildId, head).catch((err: unknown): PublishedHeadAlignment => ({
    status: "refused",
    reason: errorTail(err),
  }));
  if (alignment.status !== "aligned" || alignment.headSha !== head) {
    const reason = alignment.status === "refused"
      ? alignment.reason
      : `the clone landed on ${alignment.headSha}, not the published commit`;
    await deps.record(buildId, `${marker} Could not put the build on its published pull request commit (attempt ${earlier.length + 1} of ${PUBLISHED_HEAD_REVIEW_MAX_ATTEMPTS}): ${reason}. Failure Readiness stays unmet until that commit is reviewed.`);
    return "not-aligned";
  }

  // The published commit is a different tree from the one last reviewed: drop
  // the stored snapshot so review captures the new one.
  const state = build.buildExecState && typeof build.buildExecState === "object" && !Array.isArray(build.buildExecState)
    ? { ...(build.buildExecState as Record<string, unknown>) }
    : {};
  delete state.sourceCurrency;
  if (!(await deps.returnToReview(buildId, state))) return "not-applicable";
  await deps.record(
    buildId,
    `${marker} The pull request's commit ${head.slice(0, 9)} had no review of its own (the earlier review judged an unpublished sandbox commit). ` +
      "Put the build on that exact commit and Returned to review, so its evidence and semantic review bind the commit Failure Readiness checks.",
  );
  await deps.queueReview(buildId);
  return "returned-to-review";
}

function defaultDeps(): PublishedHeadReviewDeps {
  return {
    async load(buildId) {
      const { prisma } = await import("@dpf/db");
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { id: true, phase: true, buildExecState: true } });
      if (!build) return null;
      const room = await prisma.workroom.findFirst({
        where: { featureBuildId: build.id, archivedAt: null, pullRequestUrl: { not: null } },
        orderBy: { updatedAt: "desc" },
        select: { headSha: true, workspaceState: true },
      });
      const { readBuildPrDeliveryState } = await import("./build-pr-delivery-state");
      const observed = room ? readBuildPrDeliveryState(room.workspaceState)?.lastObservedHeadSha : null;
      return { phase: build.phase, buildExecState: build.buildExecState, publishedHeadSha: observed ?? room?.headSha ?? null };
    },
    async hasReceiptAt(sha, buildId) {
      const { prisma } = await import("@dpf/db");
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { id: true } });
      if (!build) return false;
      const row = await prisma.externalEvidenceRecord.findFirst({
        where: {
          operationType: "semantic-change-review.receipt",
          workCapsule: { featureBuildId: build.id },
          details: { path: ["sourceHeadSha"], equals: sha },
        },
        select: { id: true },
      });
      return Boolean(row);
    },
    async attempts(buildId) {
      const { prisma } = await import("@dpf/db");
      const rows = await prisma.buildActivity.findMany({
        where: { buildId, tool: PUBLISHED_HEAD_REVIEW_TOOL },
        select: { summary: true, createdAt: true },
      });
      return rows.flatMap((row) => {
        const headSha = parsePublishedHeadAttempt(row.summary);
        return headSha ? [{ headSha, at: row.createdAt }] : [];
      });
    },
    async align(buildId, publishedHeadSha) {
      const { alignBuildBranchToPublishedHead } = await import("./sandbox/build-branch");
      const outcome = await alignBuildBranchToPublishedHead(buildId, publishedHeadSha);
      return outcome.status === "aligned" ? outcome : { status: "refused", reason: outcome.reason };
    },
    async returnToReview(buildId, buildExecState) {
      const { returnShipBuildToReview } = await import("./ship-source-refresh");
      return returnShipBuildToReview(buildId, buildExecState);
    },
    async queueReview(buildId) {
      const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
      await queueBuildReviewVerification(buildId);
    },
    async record(buildId, summary) {
      const { prisma } = await import("@dpf/db");
      await prisma.buildActivity.create({ data: { buildId, tool: PUBLISHED_HEAD_REVIEW_TOOL, summary } }).catch(() => {});
    },
    now: () => new Date(),
  };
}
