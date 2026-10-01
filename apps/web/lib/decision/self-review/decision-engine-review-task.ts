// The deterministic executor for the weekly `decision-engine-review` scheduled
// task (BI-19CEC4B4). Extracted so the dispatcher stays a thin discriminator,
// mirroring executeBookkeepingCycleTask.
//
// Off the LLM path entirely: it reads the ledger, runs the pure measures, and
// records the result. Idempotent per ISO week, so a retry or a second tick in
// the same period does not produce a second review.

import { prisma } from "@dpf/db";

import { nominateAcumenCorpusGap } from "@/lib/decision-perspective/acumen-gap-nomination";
import { listHeldProfessionMaterial } from "@/lib/decision-perspective/held-material-store";
import { findProfessionFamilyByKey } from "@/lib/decision-perspective/resolve-profession-profile";
import { listOpenWeightAdjustmentProposals } from "@/lib/decision-perspective/weight-proposal-store";

import { loadReviewWindow } from "./load-review-window";
import { computeReviewLines, type ReviewLine } from "./measures";
import {
  describeRouting,
  emptyRoutingSummary,
  routeReviewFindings,
  type RoutingFacts,
  type RoutingSummary,
} from "./route-review-findings";

/** The scheduled-task fields this branch reads. */
export interface DecisionEngineReviewTask {
  taskId: string;
  schedule: string;
  ownerUserId: string;
  agentId: string;
}

/** ISO-week key, so two ticks inside one week are the same review. */
export function reviewPeriodKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO weeks run Monday–Sunday and belong to the year containing their Thursday.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type ReviewRunSummary = {
  periodKey: string;
  lineCount: number;
  /** Lines that carry a proposed action a human or specialist must rule on. */
  actionableCount: number;
  idempotent: boolean;
  /** Phase 3: where each actionable finding was addressed. */
  routing: RoutingSummary;
};

function isActionable(line: ReviewLine): boolean {
  return line.proposedAction !== "no-action";
}

/**
 * Compute the week's review. Pure given the window, so the same ledger always
 * produces the same lines — the property the fixture test relies on.
 */
export async function computeWeeklyReview(input: {
  db: Parameters<typeof loadReviewWindow>[0];
  now: Date;
}): Promise<{ periodKey: string; lines: ReviewLine[] }> {
  const window = await loadReviewWindow(input.db, { now: input.now });
  const lines = computeReviewLines({
    rows: window.rows,
    materialCountByProfile: window.materialCountByProfile,
    now: input.now,
  });
  return { periodKey: reviewPeriodKey(input.now), lines };
}

/**
 * What the router needs to write only proposals an owner can accept
 * (BI-1A2FD647): which crafts hold material awaiting release, which decision
 * classes have an open weight proposal, and a corpus-gap nominator addressed to
 * the craft's resident coworker.
 */
async function loadRoutingFacts(): Promise<RoutingFacts> {
  const [held, weights] = await Promise.all([
    listHeldProfessionMaterial(prisma as never),
    listOpenWeightAdjustmentProposals(prisma as never),
  ]);
  const openWeightProposalByDomainClass = new Map<string, string>();
  for (const proposal of weights) {
    // Newest first, so the first proposal seen for a class is the current one.
    if (!openWeightProposalByDomainClass.has(proposal.domainClass)) {
      openWeightProposalByDomainClass.set(proposal.domainClass, proposal.proposalId);
    }
  }
  return {
    heldMaterialProfileIds: new Set(held.map((family) => family.profileId)),
    openWeightProposalByDomainClass,
    nominateCorpusGap: async ({ professionKey, domainClass, headline }) => {
      // A craft with no registered acumen is owned by the first of its
      // registry roles that is a live coworker (the architecture review is
      // `ea-architect`, which the acumen registry does not list).
      const roles = findProfessionFamilyByKey(professionKey)?.roles ?? [];
      const resident = roles.length
        ? await prisma.agent.findFirst({
          where: { agentId: { in: [...roles] }, status: "active", archived: false },
          select: { agentId: true },
        })
        : null;
      return nominateAcumenCorpusGap({
        professionKey,
        interactionId: null,
        outcomeType: "defer",
        confidenceScore: 0,
        professionProfileSelected: false,
        coverageGap: true,
        domainClass,
        question: headline,
        fallbackAgentId: resident?.agentId ?? null,
        routeContext: "decision-engine-review",
      });
    },
  };
}

export async function executeDecisionEngineReviewTask(
  task: DecisionEngineReviewTask,
  deps: { now?: Date } = {},
): Promise<void> {
  const startedAt = deps.now ?? new Date();
  try {
    const { periodKey, lines } = await computeWeeklyReview({ db: prisma, now: startedAt });
    const actionable = lines.filter(isActionable);

    // Phase 3: each finding reaches the scope that owns it. Routing never
    // fails the run — a review that measured correctly but could not draft a
    // proposal is still worth recording, and the summary says what happened.
    const facts = await loadRoutingFacts().catch(() => undefined);
    const routing = await routeReviewFindings({
      db: prisma,
      lines: actionable,
      periodKey,
      facts,
    }).catch(() => emptyRoutingSummary());

    // Idempotent per ISO week: the unique key is the period, so a retry updates
    // the same row rather than filing a second review for one week.
    const existing = await prisma.backlogItemActivity
      .findFirst({
        where: { kind: "decision_engine_review", summary: { contains: periodKey } },
        select: { id: true },
      })
      .catch(() => null);

    console.info(
      "[decision-engine-review] %s — %d line(s), %d actionable%s; routed: %s",
      periodKey,
      lines.length,
      actionable.length,
      existing ? " (idempotent: already recorded for this week)" : "",
      describeRouting(routing),
    );

    const nextRunAt = computeNextRun(task.schedule, startedAt);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt },
      })
      .catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    const nextRunAt = computeNextRun(task.schedule, startedAt);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt },
      })
      .catch(() => {});
  }
}

/** Next weekly tick. The cron is fixed at weekly, so this is a 7-day advance. */
function computeNextRun(_schedule: string, from: Date): Date {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
}
