"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { requireCapability } from "@/lib/actions/shared/guards";
import { prisma, type Prisma } from "@dpf/db";
import { slugify } from "@/lib/shared/slugify";
import { revalidatePath } from "next/cache";
import { generateRfcId } from "./change-management";
import { generatePromotionId } from "@/lib/version-tracking";
import { getSelfUpgradeConfig, nextMaintenanceWindowStart } from "@/lib/self-upgrade/config";
import { resolveReleaseBatchStatus } from "@/lib/self-upgrade/release-batch-status";
import { readSelfUpgradeSupport } from "@/lib/self-upgrade/support";
import { resolveSelfUpgradeStatusTarget } from "@/lib/self-upgrade/status-target";
import { computeNextScheduledUpgradeCheckAt } from "@/lib/self-upgrade/next-check";
import { isShaFresh } from "@/lib/self-upgrade/version";
import { getDeployedSha } from "@/lib/self-upgrade/completion";
import { readCurrentContainerConfigDigest } from "@/lib/self-upgrade/runtime-image-identity";
import { getJobEngineHealth } from "@/lib/queue/job-engine-health";
import { getLatestRun, getLatestSucceededRun } from "@/lib/self-upgrade/run-store";
import { isEligibleRecoveryPredecessor } from "@/lib/self-upgrade/recovery-eligibility";
import { admitSelfUpgrade, resolveCurrentSelfUpgradeTarget } from "@/lib/self-upgrade/admission";
import { selectSelfUpgradeAdmissionTarget } from "@/lib/self-upgrade/target-admission";
import {
  getCurrentImpactSummaryId,
  loadRunImpactDigest,
  loadRunImpactDigests,
  loadRunImpactSummary,
} from "@/lib/self-upgrade/impact";
import type {
  RunImpactDigest,
  UpgradeImpactSummary,
} from "@/lib/self-upgrade/impact/types";
import {
  isStoreOpen,
  isUpgradeWindowOpen,
  nextUpgradeWindowOpen,
} from "@/lib/self-upgrade/window";
import {
  resolveAutoUpgradeWindow,
  nextAutoWindowOpen,
  describeWindows,
} from "@/lib/self-upgrade/auto-window";
import { getActiveSelfUpgradeBlackout } from "@/lib/self-upgrade/blackout";
import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import { getLastCheckedAt } from "@/lib/self-upgrade/last-check";
import {
  getQuiescenceActivity,
  abortQuiescence,
  escalateQuiescenceToForced,
} from "@/lib/self-upgrade/quiescence";
import { getCooldownUntil } from "@/lib/self-upgrade/cooldown";
import { loadPlatformVersion } from "@/lib/platform/version";
import { readBuildPipelineLimit } from "@/lib/queue/admission";
import { buildAdmissionSnapshot } from "@/lib/queue/admission-observability";
import { getErrorMessage } from "@/lib/shared/get-error-message";

async function requireOpsAccess(): Promise<string> {
  return (await requireCapability("view_operations")).userId;
}

export async function getPromotions(status?: string) {
  await requireOpsAccess();
  return prisma.changePromotion.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      productVersion: {
        select: {
          version: true,
          gitTag: true,
          gitCommitHash: true,
          shippedBy: true,
          shippedAt: true,
          changeCount: true,
          changeSummary: true,
          digitalProduct: { select: { productId: true, name: true } },
        },
      },
    },
  });
}

export async function getGitPromotionCandidates() {
  await requireOpsAccess();
  const candidates = await prisma.gitPromotionCandidate.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      candidateId: true,
      provider: true,
      repositoryFullName: true,
      branch: true,
      afterSha: true,
      status: true,
      statusReason: true,
      sandboxProviderId: true,
      sandboxId: true,
      verificationStartedAt: true,
      verificationCompletedAt: true,
      verificationResult: true,
      createdAt: true,
    },
  });

  const refs = candidates.map((candidate) => candidateReviewRef(candidate.candidateId));
  const reviewItems = refs.length > 0
    ? await prisma.changeItem.findMany({
        where: { externalSystemRef: { in: refs } },
        select: {
          externalSystemRef: true,
          changePromotion: { select: { promotionId: true, status: true } },
          changeRequest: { select: { rfcId: true, status: true } },
        },
      })
    : [];
  const reviewsByRef = new Map(reviewItems.map((item) => [item.externalSystemRef, item]));

  return candidates.map((candidate) => {
    const review = reviewsByRef.get(candidateReviewRef(candidate.candidateId));
    return {
      ...candidate,
      promotionReview: review?.changePromotion && review.changeRequest
        ? {
            promotionId: review.changePromotion.promotionId,
            promotionStatus: review.changePromotion.status,
            rfcId: review.changeRequest.rfcId,
            rfcStatus: review.changeRequest.status,
          }
        : null,
    };
  });
}

// Re-export Promotion type shape for the UI component
export type PromotionRow = Awaited<ReturnType<typeof getPromotions>>[number];
export type GitPromotionCandidateRow = Awaited<ReturnType<typeof getGitPromotionCandidates>>[number];

function candidateReviewRef(candidateId: string): string {
  return `git-promotion-candidate:${candidateId}`;
}

function shortSha(value: string | null): string {
  return value?.slice(0, 12) ?? "unknown";
}

function slugPart(value: string | null): string {
  return slugify(value ?? "unknown") || "unknown";
}

function buildCandidateImpactReport(candidate: {
  candidateId: string;
  provider: string;
  repositoryFullName: string;
  repositoryCloneUrl: string | null;
  branch: string | null;
  beforeSha: string | null;
  afterSha: string | null;
  sandboxProviderId: string | null;
  sandboxId: string | null;
  verificationStartedAt: Date | null;
  verificationCompletedAt: Date | null;
  verificationResult: Prisma.JsonValue | null;
  payload: Prisma.JsonValue | null;
}): Prisma.InputJsonObject {
  return {
    source: "git-promotion-candidate",
    candidateId: candidate.candidateId,
    provider: candidate.provider,
    repository: {
      fullName: candidate.repositoryFullName,
      cloneUrl: candidate.repositoryCloneUrl,
      branch: candidate.branch,
      beforeSha: candidate.beforeSha,
      afterSha: candidate.afterSha,
    },
    sandbox: {
      providerId: candidate.sandboxProviderId,
      id: candidate.sandboxId,
      verificationStartedAt: candidate.verificationStartedAt?.toISOString() ?? null,
      verificationCompletedAt: candidate.verificationCompletedAt?.toISOString() ?? null,
    },
    verificationResult: candidate.verificationResult ?? null,
    webhookPayload: candidate.payload ?? null,
  };
}

function buildCandidateDeploymentLog(candidate: {
  candidateId: string;
  repositoryFullName: string;
  branch: string | null;
  afterSha: string | null;
  sandboxProviderId: string | null;
  sandboxId: string | null;
  verificationCompletedAt: Date | null;
}): string {
  return [
    `Git promotion candidate: ${candidate.candidateId}`,
    `Repository: ${candidate.repositoryFullName}`,
    `Branch: ${candidate.branch ?? "unknown"}`,
    `Commit: ${candidate.afterSha ?? "unknown"}`,
    `Sandbox provider: ${candidate.sandboxProviderId ?? "unknown"}`,
    `Sandbox ID: ${candidate.sandboxId ?? "unknown"}`,
    `Sandbox verification completed: ${candidate.verificationCompletedAt?.toISOString() ?? "unknown"}`,
    "Production deployment has not been executed. This record is waiting for operator review in /ops/promotions.",
  ].join("\n");
}

export async function createPromotionReviewFromGitCandidate(candidateId: string): Promise<{
  created: boolean;
  promotionId: string;
  rfcId: string;
}> {
  const userId = await requireOpsAccess();
  const candidate = await prisma.gitPromotionCandidate.findUnique({
    where: { candidateId },
    select: {
      candidateId: true,
      provider: true,
      repositoryFullName: true,
      repositoryCloneUrl: true,
      branch: true,
      beforeSha: true,
      afterSha: true,
      status: true,
      sandboxProviderId: true,
      sandboxId: true,
      verificationStartedAt: true,
      verificationCompletedAt: true,
      verificationResult: true,
      payload: true,
    },
  });

  if (!candidate) throw new Error(`Git promotion candidate not found: ${candidateId}`);
  if (candidate.status !== "sandbox-verification-complete") {
    throw new Error("Only sandbox-verified Git candidates can enter promotion review.");
  }
  if (!candidate.afterSha) {
    throw new Error("Git promotion candidate is missing the verified commit SHA.");
  }

  const externalSystemRef = candidateReviewRef(candidate.candidateId);
  const existingReview = await prisma.changeItem.findFirst({
    where: { externalSystemRef, itemType: "promotion" },
    select: {
      changePromotion: { select: { promotionId: true } },
      changeRequest: { select: { rfcId: true } },
    },
  });
  if (existingReview?.changePromotion && existingReview.changeRequest) {
    return {
      created: false,
      promotionId: existingReview.changePromotion.promotionId,
      rfcId: existingReview.changeRequest.rfcId,
    };
  }

  const platformProduct = await prisma.digitalProduct.findUnique({
    where: { productId: "DP-ODPF" },
    select: { id: true },
  });
  if (!platformProduct) {
    throw new Error("Platform product DP-ODPF is not seeded; cannot create a governed promotion review.");
  }

  const afterSha = candidate.afterSha;
  const promotionId = generatePromotionId();
  const rfcId = await generateRfcId();
  const sha = shortSha(afterSha);
  const branch = slugPart(candidate.branch);
  const summary = `Sandbox-verified Git update ${candidate.repositoryFullName}@${sha}`;

  const result = await prisma.$transaction(async (tx) => {
    const productVersion = await tx.productVersion.create({
      data: {
        digitalProductId: platformProduct.id,
        version: `git-${candidate.candidateId.toLowerCase()}`,
        gitTag: `git-${branch}-${sha}`,
        gitCommitHash: afterSha,
        shippedBy: userId,
        changeCount: 1,
        changeSummary: summary,
      },
      select: { id: true },
    });

    const promotion = await tx.changePromotion.create({
      data: {
        promotionId,
        productVersionId: productVersion.id,
        status: "pending",
        requestedBy: userId,
        deploymentLog: buildCandidateDeploymentLog(candidate),
      },
      select: { id: true },
    });

    const rfc = await tx.changeRequest.create({
      data: {
        rfcId,
        title: `Review Git update ${sha}`,
        description: summary,
        type: "normal",
        scope: "platform",
        riskLevel: "medium",
        status: "draft",
        impactReport: buildCandidateImpactReport(candidate),
      },
      select: { id: true },
    });

    await tx.changeItem.create({
      data: {
        changeRequestId: rfc.id,
        changePromotionId: promotion.id,
        itemType: "promotion",
        title: `Promote Git update ${sha}`,
        description: summary,
        impactDescription: "Sandbox verification completed successfully; operator approval is required before production deployment.",
        digitalProductId: platformProduct.id,
        externalSystemRef,
        status: "pending",
      },
    });

    return { promotionId, rfcId };
  });

  revalidatePath("/ops/promotions");
  return { created: true, ...result };
}

export async function createPromotionReviewFromGitCandidateForm(formData: FormData) {
  const candidateId = String(formData.get("candidateId") ?? "");
  if (!candidateId) throw new Error("candidateId is required");
  await createPromotionReviewFromGitCandidate(candidateId);
}

export async function approvePromotion(promotionId: string, rationale: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "approved",
      approvedBy: userId,
      approvedAt: new Date(),
      rationale: rationale || null,
    },
  });
}

export async function rejectPromotion(promotionId: string, rationale: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "rejected",
      rejectedBy: userId,
      rejectedAt: new Date(),
      rationale: rationale || null,
    },
  });
}

export async function markDeployed(promotionId: string, deploymentLog?: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "deployed",
      deployedAt: new Date(),
      ...(deploymentLog ? { deploymentLog } : {}),
    },
  });
}

/**
 * Execute an approved promotion through the in-portal promotion pipeline
 * (backup production DB → scan destructive migrations → apply patch →
 * post-deploy health check → mark deployed, or roll back with a recorded
 * reason).
 *
 * This deliberately does NOT launch the `dpf-promoter` container: that image
 * is a self-upgrade-only contract (its promote.sh hard-requires `--self-upgrade`
 * plus PROMOTE_SOURCE/PROMOTE_TARGET_SHA/…), so starting it for a ChangePromotion
 * (PROMOTION_ID env, no flag) made promote.sh exit 1 at its guard — the
 * container died non-zero, the promotion never reached "deployed", and no
 * rollbackReason was ever set, surfacing as a bare "Rolled back: unknown".
 * BI-B8A6E80B routes change promotions to the deployer whose contract matches
 * the operation.
 */
export async function executePromotionAction(
  promotionId: string,
  overrideReason?: string,
) {
  await requireOpsAccess();

  if (!promotionId || !/^[a-zA-Z0-9_-]+$/.test(promotionId)) {
    return { success: false, step: "validate", message: "Invalid promotion ID." };
  }

  const promo = await prisma.changePromotion.findFirst({
    where: { promotionId },
    select: { status: true },
  });
  if (!promo) return { success: false, step: "validate", message: "Promotion not found." };
  if (promo.status !== "approved") return { success: false, step: "validate", message: `Status is ${promo.status}, not approved.` };

  const { executePromotion } = await import("@/lib/sandbox-promotion");
  return executePromotion(promotionId, overrideReason);
}

/**
 * Acknowledge destructive operations in a promotion's migrations.
 * Required before deploying promotions that contain DROP, TRUNCATE, etc.
 */
export async function acknowledgeDestructiveOps(promotionId: string) {
  await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: { destructiveAcknowledged: true },
  });
}

/**
 * Get deployment window availability for a promotion.
 * Returns current window status without requiring the promotion to be approved.
 */
export async function getPromotionWindowStatus(promotionId: string) {
  await requireOpsAccess();

  const promotion = await prisma.changePromotion.findUnique({
    where: { promotionId },
    include: {
      changeItem: {
        include: { changeRequest: { select: { type: true, riskLevel: true } } },
      },
    },
  });
  if (!promotion) return { available: false, message: "Promotion not found" };

  const rfcType = promotion.changeItem?.changeRequest?.type ?? "normal";
  const riskLevel = promotion.changeItem?.changeRequest?.riskLevel ?? "low";

  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: { deploymentWindows: true, blackoutPeriods: true },
  });

  if (!profile) return { available: true, message: "No business profile configured — deployment unrestricted." };

  const now = new Date();

  // Check blackouts
  const activeBlackout = profile.blackoutPeriods.find(
    (bp) => bp.startAt <= now && bp.endAt >= now && !bp.exceptions.includes(rfcType),
  );
  if (activeBlackout) {
    return {
      available: false,
      message: `Blackout active until ${activeBlackout.endAt.toISOString()}. Reason: ${activeBlackout.reason ?? "Scheduled blackout"}.`,
      blackoutEnd: activeBlackout.endAt.toISOString(),
    };
  }

  // Check windows
  const { isNowInWindow } = await import("@/lib/sandbox-promotion");
  const matchingWindows = profile.deploymentWindows.filter(
    (w) => w.allowedChangeTypes.includes(rfcType) && w.allowedRiskLevels.includes(riskLevel),
  );

  if (matchingWindows.length === 0) {
    return { available: true, message: "No deployment windows configured — deployment unrestricted." };
  }

  if (isNowInWindow(matchingWindows)) {
    return { available: true, message: "Deployment window is open now." };
  }

  const windowSummary = matchingWindows
    .map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`)
    .join("; ");

  return {
    available: false,
    message: `Not in a deployment window. Available: ${windowSummary}`,
    windows: windowSummary,
  };
}

export type SelfUpgradeRunDto = {
  runId: string;
  recoveryOfRunId: string | null;
  status: string;
  trigger: string | null;       // schema: trigger (was: triggeredBy)
  currentSha: string | null;    // schema: currentSha (was: fromVersion)
  targetSha: string | null;     // schema: targetSha (was: toVersion)
  deployedSha: string | null;   // schema: deployedSha (was: absent — adding for completeness)
  reason: string | null;        // why a run was skipped (audit + operator-facing explanation)
  completionEvidence?: Prisma.JsonValue | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failureLog: string | null;    // schema: failureLog (was: error)
  createdAt: Date;
  /** The summary this run carried, when one was recorded at launch. */
  impactSummaryId?: string | null;
  /**
   * "What did this run carry?" — headline + counts for the history row, so an
   * adverse change can be traced back to the upgrade that introduced it without
   * a DB read. Null when the run recorded no summary.
   */
  impact?: RunImpactDigest | null;
};

export async function listSelfUpgradeRuns(opts?: {
  limit?: number;
  cursor?: string;
}): Promise<{ runs: SelfUpgradeRunDto[]; nextCursor: string | null }> {
  await requireOpsAccess();

  const limit = Math.min(opts?.limit ?? 20, 50);
  const cursor = opts?.cursor;

  const rows = await prisma.selfUpgradeRun.findMany({
    ...(cursor ? { cursor: { runId: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: {
      runId: true,
      recoveryOfRunId: true,
      status: true,
      trigger: true,
      currentSha: true,
      targetSha: true,
      deployedSha: true,
      reason: true,
      completionEvidence: true,
      startedAt: true,
      completedAt: true,
      failureLog: true,
      createdAt: true,
      impactSummaryId: true,
    },
  });

  const hasNext = rows.length > limit;
  const page = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext ? page[page.length - 1].runId : null;

  // One batched, Postgres-projected read for the whole page — never a query per
  // row, and never the full item list of every summary (see
  // getPersistedSummaryDigests). Best-effort: a digest read failure leaves the
  // rows as they were rather than failing the history table.
  const digests = await loadRunImpactDigests(page.map((r) => r.impactSummaryId));
  const runs = page.map((run) => ({
    ...run,
    impact: run.impactSummaryId ? (digests.get(run.impactSummaryId) ?? null) : null,
  }));

  return { runs, nextCursor };
}

/**
 * The item-level detail behind one Run History row, fetched only when the
 * operator expands it. Read-only, ops-gated, and loaded by the run's OWN
 * recorded summary id — so a completed run keeps reporting the changes it
 * applied even after upstream has moved on.
 */
export async function getSelfUpgradeRunImpact(
  runId: string,
): Promise<UpgradeImpactSummary | null> {
  await requireOpsAccess();
  const run = await prisma.selfUpgradeRun.findUnique({
    where: { runId },
    select: { impactSummaryId: true },
  });
  return loadRunImpactSummary(run?.impactSummaryId ?? null);
}

export async function getSelfUpgradeStatus() {
  await requireOpsAccess();

  const [
    config,
    latestRun,
    latestSucceededRun,
    platformVersion,
    deployedSha,
    currentConfigDigest,
    lastCheckedAt,
    quiescence,
    cooldownUntil,
    jobEngine,
    selfUpgradeBlackout,
  ] = await Promise.all([
    getSelfUpgradeConfig(),
    getLatestRun(),
    // The upstream lineage marker for the freshness banner below: the targetSha
    // of the latest succeeded run is the upstream commit the running build
    // absorbed (see isFresh).
    getLatestSucceededRun(),
    loadPlatformVersion(),
    getDeployedSha(),
    readCurrentContainerConfigDigest(),
    getLastCheckedAt(),
    // Live drain activity (what's holding an upgrade) + the post-defer/fail
    // backoff window, so the panel can explain "what's happening" truthfully.
    getQuiescenceActivity(),
    getCooldownUntil(),
    // Background-job-engine (Inngest) registration health — a self-upgrade
    // can't dispatch without it, so the panel must surface a dead job engine.
    getJobEngineHealth(),
    // Active operator blackout that pauses scheduled upgrades (BI-59591B14), so
    // the panel explains a paused schedule instead of leaving it opaque.
    getActiveSelfUpgradeBlackout(),
  ]);
  const support = await readSelfUpgradeSupport(config.enabled);

  // Human-readable "what did this run carry?" for the Latest Run card, loaded by
  // the run's OWN impactSummaryId (the summary the operator reviewed at launch).
  // Null when the run recorded no summary (e.g. a scheduled run, or one launched
  // before a summary was generated) — the card then shows the SHA pair alone.
  const latestRunImpact = await loadRunImpactDigest(latestRun?.impactSummaryId ?? null);

  // Upgrade timing follows the storefront's open/closed state (single source of
  // truth: operating hours). inMaintenanceWindow = "upgrades may run now" = store
  // closed (or inside an explicit override / auto-overnight window). storeOpen
  // lets the panel explain WHY truthfully.
  const { schedule, timezone, timezoneKnown, lowTrafficWindows } =
    await resolveOperatingScheduleForSystem();
  const hasExplicitWindows = config.maintenanceWindows.length > 0;
  const storeOpen = isStoreOpen(schedule, new Date(), timezone);
  const now = new Date();
  // A 24/7 store has no derived "closed" window. With a known timezone we
  // auto-pick a low-traffic overnight window (observed trough if available, else
  // ~02:00-04:00 local); with no known timezone we surface a prompt instead of
  // guessing. Explicit operator windows still win. (BI-A6382FB9)
  const auto = hasExplicitWindows
    ? null
    : resolveAutoUpgradeWindow({ schedule, timeZone: timezone, timezoneKnown, lowTrafficWindows, now });
  const effectiveWindows = hasExplicitWindows
    ? config.maintenanceWindows
    : auto?.kind === "auto-overnight"
      ? auto.windows
      : undefined;
  const inMaintenanceWindow = isUpgradeWindowOpen({
    explicitWindows: effectiveWindows,
    schedule,
    timeZone: timezone,
  });
  // The window is always defined now (operating-hours or auto-overnight), so it
  // is never "unconfigured". windowSource tells the panel which model is in play;
  // "needs-timezone" is the only state that asks the operator for input.
  const windowConfigured = true;
  const windowSource: "explicit" | "operating-hours" | "auto-overnight" | "needs-timezone" =
    hasExplicitWindows
      ? "explicit"
      : auto?.kind === "auto-overnight"
        ? "auto-overnight"
        : auto?.kind === "needs-timezone"
          ? "needs-timezone"
          : "operating-hours";
  // Friendly "2:00 AM-4:00 AM" summary for the auto-overnight schedule note (display only).
  const autoWindowSummary =
    auto?.kind === "auto-overnight" ? describeWindows(auto.windows) : null;
  // Next time the upgrade window opens, so the panel can show WHEN scheduled
  // upgrades will next be eligible. Explicit + auto-overnight windows use their
  // configured/derived start; the operating-hours model derives it from the next
  // store-close transition (null while already in-window, or for needs-timezone,
  // where the panel asks for a timezone instead).
  const nextWindowStart = hasExplicitWindows
    ? nextMaintenanceWindowStart(config, now, timezone)?.toISOString() ?? null
    : auto?.kind === "auto-overnight"
      ? inMaintenanceWindow
        ? null
        : nextAutoWindowOpen(auto.windows, now, timezone)?.toISOString() ?? null
      : auto?.kind === "needs-timezone"
        ? null
        : inMaintenanceWindow
          ? null
          : nextUpgradeWindowOpen(schedule, now, timezone)?.toISOString() ?? null;
  const nextWindowStartDate = nextWindowStart ? new Date(nextWindowStart) : null;
  const nextScheduledCheckAt = computeNextScheduledUpgradeCheckAt({
    enabled: support.enabled,
    inMaintenanceWindow,
    nextWindowStart: nextWindowStartDate,
    lastCheckedAt,
    checkIntervalHours: config.checkIntervalHours,
    now,
  });
  const {
    targetSha,
    targetTag,
    availability: targetAvailability,
    unavailableReason: targetUnavailableReason,
    releaseFreshness,
  } = await resolveSelfUpgradeStatusTarget({ support, config, currentConfigDigest });
  // Merge-mode-aware freshness. In upstream/merge mode the deployed stamp is the
  // merge-commit identity, which CONTAINS but never EQUALS the upstream target —
  // so strict deployedSha===targetSha alone reports "Update available" forever,
  // even right after a fully successful upgrade (the banner disagreeing with the
  // impact summary, which already reads the lineage marker). Also treat the
  // build as fresh when the upstream lineage marker — the targetSha of the
  // latest succeeded run, i.e. the upstream commit the running build absorbed —
  // already equals the target. This is the same signal the §5.0 worker skip-gate
  // (self-upgrade.ts: `lastOk?.targetSha === upstreamSha`) and the impact summary
  // use, so all three surfaces agree.
  const isFresh = releaseFreshness ?? (support.supported && targetSha
    ? isShaFresh(deployedSha, targetSha) ||
      isShaFresh(latestSucceededRun?.targetSha ?? null, targetSha)
    : false);

  // Release-batch tally for the panel ("N of M merged updates accumulated").
  // No fetch here — display rides the hourly scheduled fetch; a stale-by-
  // minutes tally is fine for a status line and keeps page load off the
  // network. Never throws (degrades to an uncomputable tally).
  const releaseBatch = await resolveReleaseBatchStatus({ config, now, support });

  return {
    enabled: support.enabled,
    support,
    channel: config.channel,
    inMaintenanceWindow,
    windowConfigured,
    windowSource,
    // Friendly window-time summary for the auto-overnight note (null otherwise).
    autoWindowSummary,
    // Active operator blackout pausing scheduled upgrades, or null (BI-59591B14).
    blackoutUntil: selfUpgradeBlackout?.endAt.toISOString() ?? null,
    blackoutName: selfUpgradeBlackout?.name ?? null,
    storeOpen,
    // The IANA timezone the window is evaluated in (store operating-hours zone).
    // Surfaced so the panel's "next window" is never ambiguous — the symptom that
    // a UTC-evaluated window read as noon for a US Central store.
    windowTimezone: timezone,
    nextWindowStart,
    nextScheduledCheckAt: nextScheduledCheckAt?.toISOString() ?? null,
    deployedSha,
    deployedShaSource: platformVersion.imageVersion?.source ?? "unknown",
    targetSha,
    targetTag,
    targetAvailability,
    targetUnavailableReason,
    currentConfigDigest,
    isFresh,
    releaseBatch: {
      applicable: support.supported && releaseBatch.applicable,
      eligible: support.enabled && releaseBatch.eligible,
      reason: support.supported ? releaseBatch.reason : support.reason,
      pendingCount: releaseBatch.pendingCount,
      minPendingPrs: releaseBatch.minPendingPrs,
      maxWaitHours: releaseBatch.maxWaitHours,
      oldestPendingAt: releaseBatch.oldestPendingAt?.toISOString() ?? null,
      summary: support.message ?? releaseBatch.summary,
    },
    latestRun,
    latestRunImpact,
    quiescence,
    // §4.5 admission observability — derived from the lane config + the
    // quiescence blockers already captured above (no extra query).
    admission: buildAdmissionSnapshot(readBuildPipelineLimit(), quiescence.blockers),
    cooldownUntil: cooldownUntil?.toISOString() ?? null,
    jobEngine,
    platformVersion: {
      version: platformVersion.version,
      publishedAt: platformVersion.publishedAt.toISOString(),
      gitSha: platformVersion.gitSha,
      imageVersion: platformVersion.imageVersion,
      buildDate: platformVersion.buildDate,
      note: platformVersion.note,
    },
  };
}

export async function triggerSelfUpgrade(opts?: {
  dryRun?: boolean; force?: boolean;
  targetBinding?: string;
}) {
  const userId = await requireOpsAccess();
  const triggeredBy = `manual:${userId}`;
  const config = await getSelfUpgradeConfig();
  const support = await readSelfUpgradeSupport(config.enabled);
  if (!support.supported) {
    return {
      queued: false,
      reason: support.reason,
      message: support.message,
    } as const;
  }
  if (!opts?.dryRun) {
    if (!support.enabled) {
      return { queued: false, reason: "disabled" } as const;
    }
    // Manual triggers skip the routine window; force is only for an emergency drain override.
  }
  const latestRun = await getLatestRun();
  if (latestRun?.status === "running") {
    return { queued: false, reason: "already-running", runId: latestRun.runId } as const;
  }
  if (latestRun?.status === "queued" || latestRun?.status === "pending") {
    return { queued: false, reason: "already-queued", runId: latestRun.runId } as const;
  }
  if (latestRun?.status === "failed" && latestRun.completedAt == null) return { queued: false, reason: "recovery-predecessor-not-terminal", runId: latestRun.runId } as const;
  const recoveryRun = isEligibleRecoveryPredecessor(latestRun) ? latestRun : null;
  if (recoveryRun && !opts?.targetBinding) return { queued: false, reason: "recovery-binding-required", runId: recoveryRun.runId } as const;
  const resolvedTarget = await resolveCurrentSelfUpgradeTarget();
  const selection = selectSelfUpgradeAdmissionTarget({
    targetBinding: opts?.targetBinding,
    supportTargetKind: support.targetKind,
    resolvedTarget,
  });
  if (!selection.ok) return { queued: false, reason: selection.error } as const;
  const target = selection.data;
  // Attach the "What's in this update?" summary the operator just reviewed (if
  // any) so the run records the changes it carried. Best effort — the upgrade
  // proceeds whether or not a summary was generated.
  const impactSummaryId = await getCurrentImpactSummaryId();
  const admission = await admitSelfUpgrade({ triggeredBy, target, recoveryOfRunId: recoveryRun?.runId ?? null,
    requestedForce: opts?.force === true,
    dryRun: opts?.dryRun === true,
    routine: false,
    impactSummaryId,
  });
  if (!admission.admitted) return { queued: false,
    reason: admission.disposition === "recovery_conflict" ? "recovery-conflict"
      : admission.disposition === "recovery_refused" ? admission.reason : "already-active",
    runId: admission.runId } as const;
  return { queued: true, admitted: true, runId: admission.runId,
    dispatchStatus: admission.dispatchStatus } as const;
}

/**
 * BI-4F3B2FA9 — emergency "Force Now" on an ALREADY-RUNNING drain. Promotes the
 * active QuiescenceRun to forced mode so the coordinator bypasses all hard
 * blockers on its next tick (within ~5s) and proceeds to swap — no restart.
 * The operator and timestamp are audit-recorded on the run's forcedSurfaces.
 */
export async function forceActiveRun(
  runId: string,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireOpsAccess();
  const result = await escalateQuiescenceToForced(runId, userId);
  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true };
}

/**
 * BI-4F3B2FA9 — abort an in-flight drain. Delegates to abortQuiescence, which
 * sends the swap-complete event with outcome=aborted; the coordinator flips the
 * level back to normal and the operator can immediately start a fresh run.
 */
export async function abortActiveRun(
  runId: string,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireOpsAccess();
  try {
    await abortQuiescence(runId, userId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "abort failed" };
  }
  return { ok: true };
}

/**
 * BI-F2C53237 — operator-visible "Build engine now" for the promoter-unavailable
 * skip. Builds the promoter image in place from the portal's baked-in /promoter/
 * files (the same recipe self-upgrade auto-heal and the repair_promoter_image
 * MCP tool use), so a non-technical operator resolves "Upgrade engine not ready"
 * with one click instead of a docker command. Idempotent; the next scheduled
 * attempt resumes automatically once the image is present.
 */
export async function repairPromoterImage(): Promise<{
  ok: boolean;
  built?: boolean;
  message: string;
}> {
  await requireOpsAccess();
  const config = await getSelfUpgradeConfig();
  const support = await readSelfUpgradeSupport(config.enabled);
  if (!support.supported) {
    return { ok: false, message: support.message };
  }
  const image = config.promoterImage ?? "dpf-promoter";
  const result = await (await import("@/lib/self-upgrade/promoter")).ensurePromoterImage(config.promoterImage);

  if (result.ok) {
    revalidatePath("/ops/self-upgrade");
    return {
      ok: true,
      built: result.built,
      message: result.alreadyPresent
        ? `The promoter engine image (${image}) is already built — self-upgrade can proceed.`
        : `Built the promoter engine image (${image}). The next upgrade attempt resumes automatically.`,
    };
  }

  return {
    ok: false,
    message:
      result.skipReason === "custom-image"
        ? `A custom promoter image (${image}) is configured; it must be provided by the operator rather than built here.`
        : `Could not build the promoter engine image${
            result.detail ? `: ${result.detail.split("\n").pop()}` : "."
          }`,
  };
}

export async function rollbackSelfUpgrade(
  runId: string,
  typedConfirmation: string,
): Promise<{
  ok: boolean;
  status?: "ok" | "failed";
  error?: string;
  restores?: Array<{
    target: string;
    sourceBackupRunId: string;
    restoreId: string | null;
    status: "ok" | "failed";
    error?: string;
  }>;
}> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_operations",
    ) ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return { ok: false, error: "You do not have permission to restore upgrade recovery points." };
  }

  const {
    SELF_UPGRADE_ROLLBACK_CONFIRMATION_TEXT,
    SelfUpgradeRollbackError,
    RestoreIntegrityError,
    RestoreLockedError,
    runSelfUpgradeRollback,
  } = await import("@/lib/self-upgrade/rollback");

  if (typedConfirmation !== SELF_UPGRADE_ROLLBACK_CONFIRMATION_TEXT) {
    return {
      ok: false,
      error: `Confirmation text must be exactly "${SELF_UPGRADE_ROLLBACK_CONFIRMATION_TEXT}" to proceed.`,
    };
  }

  try {
    const result = await runSelfUpgradeRollback({
      runId,
      initiatedByUserId: user.id ?? null,
    });
    revalidatePath("/ops/self-upgrade");
    revalidatePath("/admin/backups");
    return {
      ok: result.ok,
      status: result.status,
      restores: result.restores,
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (err) {
    if (
      err instanceof SelfUpgradeRollbackError ||
      err instanceof RestoreIntegrityError ||
      err instanceof RestoreLockedError
    ) {
      return { ok: false, error: err.message };
    }
    const message = getErrorMessage(err);
    return { ok: false, error: message };
  }
}
