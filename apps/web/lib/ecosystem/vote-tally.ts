/**
 * Ecosystem votes count (BI-626A4ECA).
 *
 * Before this, an inbound dpf.demand.interest-recorded response was stored as a
 * FederatedRecordMirror and read by nothing — the original spec finding #3.
 * This recomputes the tally for the item a response is about and writes it into
 * the item's EXISTING value inputs (reach, impact), the way the scoring steward
 * does: a guarded write that only ever touches inputs that are unset or
 * machine-proposed, recomputes the RICE score, and records why on the item.
 *
 * Voter identity is the federation link the response arrived over — one link
 * per peer installation — so a second response from the same installation
 * re-weights its vote and never adds a voter.
 *
 * The weekly budget is also enforced HERE, at the receiver. The voter's own
 * installation enforces it before sending, but that is a client-side promise
 * across a trust boundary: a peer on a buggy or modified build could send
 * weight 4 on everything. So a peer whose weighted votes received this week
 * cost more than the cycle budget has every vote counted at weight 1 (plain
 * interest, never dropped), and the item's record says so.
 */

import { computeDemandScore } from "@/lib/demand/scoring";
import { DEFAULT_CYCLE_CREDITS, creditCost, isoWeekStart, tallyVotes, voteScoreUpdate } from "./vote-budget";

export const VOTE_TALLY_ACTOR = "ecosystem-votes";

type ResponseMirrorRow = { federationLinkId: string; payload: unknown };

type TallyItem = {
  id: string;
  updatedAt: Date;
  occurrenceCount: number;
  reach: number | null;
  confidence: number | null;
  jobSize: number | null;
  effortSize: string | null;
  demandInputSource: string | null;
};

type TallyTx = {
  backlogItem: { updateMany(args: unknown): Promise<{ count: number }> };
  backlogItemActivity: { create(args: unknown): Promise<unknown> };
};

export type VoteTallyDb = {
  federatedRecordMirror: { findMany(args: unknown): Promise<ResponseMirrorRow[]> };
  backlogItem: { findUnique(args: unknown): Promise<TallyItem | null> };
  $transaction<T>(fn: (tx: TallyTx) => Promise<T>): Promise<T>;
};

export type VoteTallyOutcome =
  | { written: true; voters: number; reach: number; impact: number; score: number | null; overBudgetVoters: number }
  | { written: false; reason: "no-item" | "no-votes" | "owner-set" | "changed-concurrently" };

/** Peers whose weighted interest received this ISO week costs more than the cycle budget. */
export function overBudgetLinks(rows: ResponseMirrorRow[], budget: number = DEFAULT_CYCLE_CREDITS): Set<string> {
  const spent = new Map<string, number>();
  for (const row of rows) {
    const response = (row.payload as { response?: { responseKind?: unknown; weight?: unknown } } | null)?.response;
    if (!response || response.responseKind !== "interest") continue;
    const weight = typeof response.weight === "number" ? response.weight : 1;
    spent.set(row.federationLinkId, (spent.get(row.federationLinkId) ?? 0) + creditCost(weight));
  }
  return new Set([...spent].filter(([, credits]) => credits > budget).map(([link]) => link));
}

/** The interest votes held for one item, one per responding installation. */
export function votesFromResponses(itemId: string, rows: ResponseMirrorRow[]) {
  return rows.flatMap((row) => {
    const response = (row.payload as { response?: { responseKind?: unknown; weight?: unknown } } | null)?.response;
    if (!response || response.responseKind !== "interest") return [];
    const weight = typeof response.weight === "number" ? response.weight : 1;
    return [{ ref: itemId, installationId: row.federationLinkId, weight }];
  });
}

/** This installation's own outbound interest votes, for its weekly budget. */
export function outboundVotesFromResponses(rows: Array<{ localRecordRef: string | null; payload: unknown }>) {
  return rows.flatMap((row) => {
    const response = (row.payload as {
      envelope?: { responseKind?: unknown; weight?: unknown; createdAt?: unknown };
    } | null)?.envelope;
    if (!row.localRecordRef || !response || response.responseKind !== "interest") return [];
    const createdAt = typeof response.createdAt === "string" ? new Date(response.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return [];
    return [{
      ref: row.localRecordRef,
      weight: typeof response.weight === "number" ? response.weight : 1,
      createdAt,
    }];
  });
}

export async function recordEcosystemVoteTally(
  db: VoteTallyDb,
  itemId: string,
  now: Date = new Date(),
): Promise<VoteTallyOutcome> {
  const item = await db.backlogItem.findUnique({
    where: { itemId },
    select: {
      id: true, updatedAt: true, occurrenceCount: true, reach: true,
      confidence: true, jobSize: true, effortSize: true, demandInputSource: true,
    },
  });
  if (!item) return { written: false, reason: "no-item" };

  const rows = await db.federatedRecordMirror.findMany({
    where: { recordType: "demand-response", canonicalSide: "peer", localRecordRef: itemId },
    select: { federationLinkId: true, payload: true },
  });
  const votes = votesFromResponses(itemId, rows);
  // Receiver-side budget: read this week's responses only for peers that cast a
  // weighted vote here — bounded by link and by week.
  const weightedLinks = [...new Set(votes.filter((vote) => vote.weight > 1).map((vote) => vote.installationId))];
  const overBudget = weightedLinks.length === 0 ? new Set<string>() : overBudgetLinks(
    await db.federatedRecordMirror.findMany({
      where: {
        recordType: "demand-response", canonicalSide: "peer",
        federationLinkId: { in: weightedLinks }, updatedAt: { gte: isoWeekStart(now) },
      },
      select: { federationLinkId: true, payload: true },
    }),
  );
  const [tally] = tallyVotes(votes.map((vote) => (overBudget.has(vote.installationId) ? { ...vote, weight: 1 } : vote)));
  if (!tally) return { written: false, reason: "no-votes" };

  const update = voteScoreUpdate(item, tally);
  if (!update) return { written: false, reason: "owner-set" };

  const inputs = {
    reach: update.reach,
    impact: update.impact,
    confidence: item.confidence,
    jobSize: item.jobSize,
    effortSize: item.effortSize,
  };
  const result = computeDemandScore(inputs, "rice");

  return db.$transaction(async (tx) => {
    const { count } = await tx.backlogItem.updateMany({
      where: {
        id: item.id,
        updatedAt: item.updatedAt,
        // Never over a person's judgement — the same guard the steward uses.
        OR: [{ demandInputSource: null }, { demandInputSource: "ai" }],
      },
      data: {
        reach: update.reach,
        impact: update.impact,
        demandScore: result.score,
        demandScoreFramework: "rice",
        demandScoreComputedAt: now,
        demandInputSource: "ai",
        demandInputActorRef: VOTE_TALLY_ACTOR,
        demandInputAt: now,
      },
    });
    if (count === 0) return { written: false as const, reason: "changed-concurrently" as const };
    await tx.backlogItemActivity.create({
      data: {
        backlogItemId: item.id,
        kind: "demand_scored",
        summary:
          `Ecosystem votes: ${tally.distinctInstallations} installation${tally.distinctInstallations === 1 ? "" : "s"} `
          + `weighed in, so reach ${update.reach} and impact ${update.impact} (an owner can override)`
          + (overBudget.size > 0
            ? `; ${overBudget.size} over this week's vote budget, counted as plain interest`
            : ""),
        payload: {
          framework: "rice",
          source: VOTE_TALLY_ACTOR,
          voters: tally.distinctInstallations,
          totalWeight: tally.totalWeight,
          overBudgetVoters: overBudget.size,
          inputs,
          score: result.score,
          missing: result.missing,
        },
      },
    });
    return {
      written: true as const,
      voters: tally.distinctInstallations,
      reach: update.reach,
      impact: update.impact,
      score: result.score,
      overBudgetVoters: overBudget.size,
    };
  });
}

/**
 * Tally after an inbound vote, and say what happened. A lost optimistic race is
 * the ordinary case (two peers voting at once, or any other write to the item),
 * so it is retried once against a fresh read; anything still unwritten is
 * logged with its reason rather than vanishing.
 */
export async function tallyAfterInboundVote(
  db: VoteTallyDb,
  itemId: string,
  deps: { now?: Date; warn?: (message: string) => void } = {},
): Promise<VoteTallyOutcome> {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  let outcome = await recordEcosystemVoteTally(db, itemId, deps.now);
  if (!outcome.written && outcome.reason === "changed-concurrently") {
    outcome = await recordEcosystemVoteTally(db, itemId, deps.now);
  }
  if (!outcome.written && (outcome.reason === "changed-concurrently" || outcome.reason === "no-item")) {
    warn(`[ecosystem-votes] vote for ${itemId} not counted: ${outcome.reason}; the next vote on it recomputes the tally`);
  }
  if (outcome.written && outcome.overBudgetVoters > 0) {
    warn(`[ecosystem-votes] ${outcome.overBudgetVoters} peer(s) over this week's vote budget on ${itemId}; counted at weight 1`);
  }
  return outcome;
}
