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
 */

import { computeDemandScore } from "@/lib/demand/scoring";
import { tallyVotes, voteScoreUpdate } from "./vote-budget";

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
  | { written: true; voters: number; reach: number; impact: number; score: number | null }
  | { written: false; reason: "no-item" | "no-votes" | "owner-set" | "changed-concurrently" };

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
  const [tally] = tallyVotes(votesFromResponses(itemId, rows));
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
          + `weighed in, so reach ${update.reach} and impact ${update.impact} (an owner can override)`,
        payload: {
          framework: "rice",
          source: VOTE_TALLY_ACTOR,
          voters: tally.distinctInstallations,
          totalWeight: tally.totalWeight,
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
    };
  });
}
