// The deterministic executor for the weekly `decision-engine-review` scheduled
// task (BI-19CEC4B4). Extracted so the dispatcher stays a thin discriminator,
// mirroring executeBookkeepingCycleTask.
//
// Off the LLM path entirely: it reads the ledger, runs the pure measures, and
// records the result. Idempotent per ISO week, so a retry or a second tick in
// the same period does not produce a second review.

import { prisma } from "@dpf/db";

import { findOpenAcumenCorpusGap, nominateAcumenCorpusGap } from "@/lib/decision-perspective/acumen-gap-nomination";
import { listHeldProfessionMaterial } from "@/lib/decision-perspective/held-material-store";
import { findProfessionFamilyByKey } from "@/lib/decision-perspective/resolve-profession-profile";
import { listOpenWeightAdjustmentProposals } from "@/lib/decision-perspective/weight-proposal-store";

import { withCurrentScheduledTask } from "@/lib/actions/agent-task-claim";
import { executeDurableReview } from "./durable-review-store";
import { assessmentDbForClient, submitCoworkerSelfAssessment, listCoworkerCapabilityNeeds, fileCapabilityNeedToBacklog, resolveAiWorkforceBacklogLinks } from "@/lib/coworker-self-assessment/assessment-service";
import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import { storePlatformKnowledge } from "@/lib/semantic-memory";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isRecord } from "@/lib/shared/coerce";
import { getAcumenRoomShape } from "@/lib/work-management/acumen-room-shapes";
import { loadReviewWindow, REVIEW_WINDOW_ROW_CAP } from "./load-review-window";
import { computeReviewLines, type ReviewLine, RECOMMENDATION_MATURITY_DAYS } from "./measures";
import {
  routeReviewFindings,
  planFinding, ownerProfileIdForLine, reviewDomainClass, emptyRoutingSummary,
  type RoutingFacts, type FindingPlan,
  type RoutingSummary,
} from "./route-review-findings";

/** The scheduled-task fields this branch reads. */
export interface DecisionEngineReviewTask {
  taskId: string;
  schedule: string;
  ownerUserId: string;
  agentId: string;
  taskRunId?: string | null;
  nextRunAt?: Date | null;
  isActive?: boolean;
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

/**
 * Compute the week's review. Pure given the window, so the same ledger always
 * produces the same lines — the property the fixture test relies on.
 */
export async function computeWeeklyReview(input: {
  db: Parameters<typeof loadReviewWindow>[0];
  now: Date;
}): Promise<{ periodKey: string; lines: ReviewLine[]; coverage: Record<string, unknown> }> {
  const window = await loadReviewWindow(input.db, { now: input.now });
  const lines = computeReviewLines({
    rows: window.rows,
    overdueRows: window.overdueRows,
    overdueCoverage: window.overdueCoverage,
    materialCountByProfile: window.materialCountByProfile,
    now: input.now,
  });
  return { periodKey: reviewPeriodKey(input.now), lines, coverage: {
    queryVersion: "review-populations.v1", since: window.since.toISOString(), until: window.until.toISOString(),
    recent: { rows: window.rows.length, rowLimit: REVIEW_WINDOW_ROW_CAP, complete: window.rows.length < REVIEW_WINDOW_ROW_CAP },
    mature: { rows: window.overdueRows.length, until: new Date(input.now.getTime() - RECOMMENDATION_MATURITY_DAYS * 86_400_000).toISOString(), ...window.overdueCoverage },
    materialCountByProfile: window.materialCountByProfile,
    effectQualityCoverage: "unknown", humanChoiceIsEffectQuality: false,
  } };
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
  // Carry the admitted dispatcher snapshot; never borrow a newer commission.
  const commission = { ...task };
  if (commission.isActive !== true || !Object.hasOwn(commission, "nextRunAt")) return;
  try {
    let facts: RoutingFacts | undefined;
    const indexQueue: Array<{ entityId: string; title: string; content: string }> = [];
    const completed = await executeDurableReview({
      task, commission, periodKey: reviewPeriodKey(startedAt), now: startedAt,
      measure: async (cutoff) => computeWeeklyReview({ db: prisma, now: cutoff }),
      prepare: async (line) => {
        facts ??= await loadRoutingFacts();
        const profileId = ownerProfileIdForLine(line);
        const plan = profileId ? planFinding(line, profileId, facts) : { kind: "report", reason: "unroutable" };
        let agentId: string | null = null;
        if (plan.kind === "nominate" && "professionKey" in plan) {
          agentId = getAcumenRoomShape(String(plan.professionKey))?.coworkerAgentId ?? null;
          if (!agentId) {
            const roles = findProfessionFamilyByKey(String(plan.professionKey))?.roles ?? [];
            agentId = roles.length ? (await prisma.agent.findFirst({ where: { agentId: { in: [...roles] }, status: "active", archived: false }, select: { agentId: true } }))?.agentId ?? null : null;
          }
        }
        return { profileId, domainClass: reviewDomainClass(line), plan, agentId };
      },
      reconcile: async (line, intent) => {
        if (!isRecord(intent) || !isRecord(intent.destination)) return undefined;
        const destination = intent.destination;
        if (!isRecord(destination.plan)) return undefined;
        const plan = destination.plan;
        const summary = emptyRoutingSummary();
        if (plan.kind === "proposal" && typeof destination.profileId === "string" && typeof destination.domainClass === "string") {
          const proposal = await prisma.decisionResolutionProposal.findUnique({ where: { proposalId: `DRP-g-${destination.profileId}-${destination.domainClass}` } });
          if (!proposal) return undefined; // Absence cannot prove non-execution.
          const outcome = proposal.status === "proposed" ? "already-open" : "already-ruled";
          if (outcome === "already-open") summary.alreadyOpen = 1; else summary.alreadyRuled = 1;
          summary.routed.push({ lineKey: line.lineKey, profileId: proposal.profileId, domainClass: proposal.domainClass ?? "", actionKind: proposal.actionKind, proposalId: proposal.proposalId, outcome });
          return summary;
        }
        if (plan.kind === "nominate" && typeof destination.agentId === "string" && typeof plan.professionKey === "string" && typeof plan.domainClass === "string") {
          const need = await findOpenAcumenCorpusGap(destination.agentId, plan.professionKey, plan.domainClass);
          if (!need) return undefined;
          summary.nominated = 1;
          summary.routed.push({ lineKey: line.lineKey, profileId: String(destination.profileId ?? ""), domainClass: String(destination.domainClass ?? ""), actionKind: "no_change", proposalId: null, outcome: `nominated:${need.needId}` });
          return summary;
        }
        if (plan.kind === "report" || line.proposedAction === "no-action" || line.proposedAction === "file-defect") {
          summary.reported = 1;
          summary.routed.push({ lineKey: line.lineKey, profileId: String(destination.profileId ?? ""), domainClass: String(destination.domainClass ?? ""), actionKind: "no_change", proposalId: null, outcome: `reported:${String(plan.reason ?? "no external effect")}` });
          return summary;
        }
        return undefined;
      },
      route: async (line, periodKey, tx, destination) => {
        if (line.proposedAction === "no-action") return emptyRoutingSummary();
        if (!isRecord(destination) || !isRecord(destination.plan)) throw new Error("Prepared review destination unavailable");
        const plan = destination.plan as FindingPlan;
        const assessmentDb = assessmentDbForClient(tx);
        const routedFacts: RoutingFacts = { ...(facts ?? { heldMaterialProfileIds: new Set(), openWeightProposalByDomainClass: new Map() }),
          nominateCorpusGap: async ({ professionKey, domainClass, headline }) => {
            if (typeof destination.agentId !== "string") return { nominated: false, reason: "unknown-acumen" };
            const target = await tx.agent.findFirst({ where: { agentId: destination.agentId, status: "active", archived: false }, select: { agentId: true } });
            if (!target) throw new Error("Prepared craft owner no longer active");
            return nominateAcumenCorpusGap({ professionKey, domainClass, question: headline, interactionId: null,
              outcomeType: "defer", confidenceScore: 0, professionProfileSelected: false, coverageGap: true, routeContext: "decision-engine-review",
            }, { targetAgentId: target.agentId,
              listNeeds: filters => listCoworkerCapabilityNeeds(filters, { db: assessmentDb }),
              submitAssessment: value => submitCoworkerSelfAssessment(value, { db: assessmentDb,
                fileBacklogItem: need => fileCapabilityNeedToBacklog(need, {
                  resolveWorkforceLinks: () => resolveAiWorkforceBacklogLinks({ db: tx as never }),
                  ingest: async entry => {
                    const result = await ingestBacklogItem(entry, { store: tx as never,
                      indexKnowledge: entry => { indexQueue.push(entry); },
                      listRepoFiles: async () => [],
                      searchSimilarItems: async () => ({ status: "unavailable", reason: "deferred outside fenced review mutation", results: [] }),
                    });
                    if (result.created) await tx.backlogItemActivity.create({ data: {
                      backlogItemId: result.id, kind: "intake_origin", summary: "Review intake advisory scans deferred",
                      payload: { createdBy: "decision-engine-review", advisory: true, implementationScan: "unavailable", semanticDuplicateScan: "unavailable", reason: "fenced transaction performs database work only" },
                    } });
                    return result;
                  },
                }),
              }),
            });
          },
        };
        return routeReviewFindings({ db: tx, lines: [line], periodKey, facts: routedFacts,
          preparedFinding: { lineKey: line.lineKey, profileId: typeof destination.profileId === "string" ? destination.profileId : null, plan },
        });
      },
      afterRoutingCommit: () => { for (const entry of indexQueue.splice(0)) void storePlatformKnowledge({ ...entry, entityType: "backlog" }).catch(() => console.warn("Review backlog knowledge projection deferred")); },
    });
    if (!completed) return; // Another tick owns this run; do not advance its schedule.

    await settle("ok", null);
  } catch (err) {
    await settle("error", getErrorMessage(err));
  }
  async function settle(status: string, error: string | null) {
    const nextRunAt = computeNextRun(task.schedule, startedAt);
    await withCurrentScheduledTask(prisma, commission!, commission!.taskRunId ?? null, async tx => {
      const data = { lastRunAt: startedAt, lastStatus: status, lastError: error, nextRunAt };
      await tx.scheduledAgentTask.update({ where: { taskId: task.taskId }, data });
      await tx.scheduledJob.updateMany({ where: { jobId: task.taskId }, data });
    });
  }
}

/** Next weekly tick. The cron is fixed at weekly, so this is a 7-day advance. */
function computeNextRun(_schedule: string, from: Date): Date {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
}
