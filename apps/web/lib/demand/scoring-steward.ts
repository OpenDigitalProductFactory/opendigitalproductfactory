// Demand-scoring steward runtime (BI-00C68162). Takes a bounded batch of
// unscored triaged backlog items, highest likely value first, and records a
// proposed RICE score for each one, marked agent-proposed.
//
// The proposal itself is the pure score-proposal.ts; this module is the
// persistence around it, written against a narrow db shape so tests run on an
// in-memory fake. The scheduled-task executor (scoring-steward-task.ts) supplies
// prisma.
//
// No-overwrite is enforced twice:
// - the read asks only for rows nobody has scored and no owner has touched
//   (demandScore null, demandInputSource null|ai);
// - the write is guarded on the row's updatedAt and the same predicate, so an
//   owner's edit that lands between read and write wins and the steward backs off.

import { computeDemandScore } from "./scoring";
import {
  STEWARD_ELIGIBLE_STATUSES,
  isStewardEligible,
  proposeDemandScoreInputs,
  selectStewardBatch,
  type DemandScoreProposal,
  type ScoreProposalSignals,
} from "./score-proposal";

export const DEFAULT_STEWARD_BATCH_SIZE = 50;
export const MAX_STEWARD_BATCH_SIZE = 200;
/** Upper bound on rows read per run to rank from. The live pool was 1,858. */
export const STEWARD_CANDIDATE_POOL_CAP = 5000;

export type DemandStewardRow = Omit<ScoreProposalSignals, "epicStatus" | "activeEvidenceCount"> & {
  id: string;
  updatedAt: Date;
  epic: { status: string } | null;
  _count: { demandEvidenceLinks: number };
};

type UpdateManyArgs = { where: Record<string, unknown>; data: Record<string, unknown> };
type StewardTx = {
  backlogItem: { updateMany(args: UpdateManyArgs): Promise<{ count: number }> };
  backlogItemActivity: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

export type DemandStewardDb = {
  backlogItem: { findMany(args: Record<string, unknown>): Promise<DemandStewardRow[]> };
  $transaction<T>(fn: (tx: StewardTx) => Promise<T>): Promise<T>;
};

export type DemandStewardOptions = {
  agentId: string;
  taskId: string;
  batchSize: number;
  now?: Date;
  /** Called after each item is written; a failure is logged, never fatal. */
  onScored?: (itemId: string) => Promise<void>;
};

export type DemandStewardResult = {
  /** Rows read that the steward may score. */
  eligible: number;
  scored: string[];
  /** Items with no effort estimate or size: left for a person. */
  noEffortSignal: string[];
  /** Items an owner changed between read and write: the steward backed off. */
  raced: string[];
  /** Eligible items still unscored after this run. */
  unscoredRemaining: number;
};

/** taskConfig.batchSize when it is a positive number, clamped; else the default. */
export function resolveStewardBatchSize(taskConfig: unknown): number {
  const raw =
    taskConfig && typeof taskConfig === "object"
      ? (taskConfig as Record<string, unknown>)["batchSize"]
      : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) return DEFAULT_STEWARD_BATCH_SIZE;
  return Math.min(Math.floor(raw), MAX_STEWARD_BATCH_SIZE);
}

function toSignals(row: DemandStewardRow): ScoreProposalSignals & { id: string; updatedAt: Date } {
  return {
    ...row,
    epicStatus: row.epic?.status ?? null,
    activeEvidenceCount: row._count?.demandEvidenceLinks ?? 0,
  };
}

async function loadCandidates(db: DemandStewardDb) {
  const rows = await db.backlogItem.findMany({
    where: {
      status: { in: [...STEWARD_ELIGIBLE_STATUSES] },
      duplicateOfId: null,
      demandScore: null,
      OR: [{ demandInputSource: null }, { demandInputSource: "ai" }],
    },
    orderBy: [{ createdAt: "asc" }, { itemId: "asc" }],
    take: STEWARD_CANDIDATE_POOL_CAP,
    select: {
      id: true, itemId: true, title: true, body: true, status: true, workType: true,
      source: true, effortSize: true, occurrenceCount: true, investmentBucket: true,
      createdAt: true, updatedAt: true, duplicateOfId: true, reach: true, impact: true,
      confidence: true, jobSize: true, demandScore: true, demandInputSource: true,
      estimateAiJobSize: true, estimateHumanJobSize: true, estimateAgreed: true,
      epic: { select: { status: true } },
      _count: { select: { demandEvidenceLinks: { where: { status: "active" } } } },
    },
  });
  return rows.map(toSignals);
}

async function writeProposal(
  db: DemandStewardDb,
  item: ScoreProposalSignals & { id: string; updatedAt: Date },
  proposal: DemandScoreProposal,
  opts: { agentId: string; taskId: string; now: Date },
): Promise<boolean> {
  const inputs = {
    reach: proposal.reach,
    impact: proposal.impact,
    confidence: proposal.confidence,
    jobSize: proposal.jobSize,
  };
  const result = computeDemandScore(inputs, "rice");
  // Attribute the effort to the agent only when nobody has estimated it yet;
  // an existing AI or human estimate keeps its own provenance.
  const attributeEffort =
    proposal.jobSizeFrom === "effortSize" &&
    item.estimateAiJobSize === null &&
    item.estimateHumanJobSize === null;
  const data: Record<string, unknown> = {
    ...inputs,
    demandScore: result.score,
    demandScoreFramework: "rice",
    demandScoreComputedAt: opts.now,
    demandInputSource: "ai",
    demandInputById: opts.agentId,
    demandInputAt: opts.now,
    ...(proposal.investmentBucket && !item.investmentBucket
      ? { investmentBucket: proposal.investmentBucket }
      : {}),
    ...(attributeEffort
      ? {
          estimateAiJobSize: proposal.jobSize,
          estimateAiById: opts.agentId,
          estimateAiAt: opts.now,
          estimateSource: "ai",
        }
      : {}),
  };
  return db.$transaction(async (tx) => {
    const { count } = await tx.backlogItem.updateMany({
      where: {
        id: item.id,
        updatedAt: item.updatedAt,
        demandScore: null,
        OR: [{ demandInputSource: null }, { demandInputSource: "ai" }],
      },
      data,
    });
    if (count === 0) return false;
    await tx.backlogItemActivity.create({
      data: {
        backlogItemId: item.id,
        kind: "demand_scored",
        summary:
          result.score === null
            ? "Agent proposed rice inputs; score incomplete"
            : `Agent proposed rice score ${result.score} (an owner can override)`,
        payload: {
          framework: "rice",
          inputs,
          score: result.score,
          contributions: result.contributions,
          missing: result.missing,
          confidence: proposal.confidence,
          effectiveJobSize: proposal.jobSize,
          investmentBucket: proposal.investmentBucket,
          proposedBy: "agent",
          inputSource: "ai",
          agentId: opts.agentId,
          stewardTaskId: opts.taskId,
          basis: proposal.basis,
        },
        recordedById: null,
        recordedByAgentId: opts.agentId,
      },
    });
    return true;
  });
}

export async function runDemandScoringSteward(
  db: DemandStewardDb,
  options: DemandStewardOptions,
): Promise<DemandStewardResult> {
  const now = options.now ?? new Date();
  const candidates = await loadCandidates(db);
  const eligible = candidates.filter(isStewardEligible).length;
  const batch = selectStewardBatch(candidates, options.batchSize);
  const scored: string[] = [];
  const noEffortSignal: string[] = [];
  const raced: string[] = [];
  for (const item of batch) {
    const proposal = proposeDemandScoreInputs(item);
    if (!proposal) {
      noEffortSignal.push(item.itemId);
      continue;
    }
    const wrote = await writeProposal(db, item, proposal, { agentId: options.agentId, taskId: options.taskId, now });
    if (!wrote) {
      raced.push(item.itemId);
      continue;
    }
    scored.push(item.itemId);
    if (options.onScored) {
      await options.onScored(item.itemId).catch((err: unknown) => {
        console.warn("[demand-scoring-steward] post-score hook failed for %s: %s", item.itemId, String(err));
      });
    }
  }
  return { eligible, scored, noEffortSignal, raced, unscoredRemaining: eligible - scored.length };
}
