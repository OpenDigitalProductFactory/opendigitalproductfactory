/**
 * The ecosystem vote budget (BI-4D1CAD69).
 *
 * Submitters asked to vote on what matters most where capacity is limited and
 * inputs conflict. Raw vote counts do not survive that: they reward whoever
 * shouts most often, and one busy install can drown a hundred quiet ones.
 *
 * So each installation gets a per-cycle CREDIT budget, and concentrating credits
 * on one item costs the SQUARE of the weight applied — the quadratic-voting
 * result (Gitcoin Grants, the Colorado legislature's 2019 budget prioritisation).
 * Intensity of preference stays expressible; domination does not.
 *
 *     weight   1    2    3    4
 *     credits  1    4    9   16
 *
 * The tally feeds the demand scorer's EXISTING inputs and nothing else. A vote
 * is a signal, not a decision: it moves `reach` and `impact`, and precedence is
 * still ratified by the accountable human.
 */

/** One week, aligned to the capacity reset the drain already uses. */
export const DEFAULT_CYCLE_CREDITS = 16;

import { DEMAND_RESPONSE_MAX_WEIGHT } from "@dpf/db/federated-demand-contract";

/** Beyond this, one item would consume a whole default budget on its own. The
 *  wire contract owns the number, so the budget and the validator cannot disagree. */
export const MAX_VOTE_WEIGHT = DEMAND_RESPONSE_MAX_WEIGHT;

export interface EcosystemVote {
  ref: string;
  weight: number;
}

/** A vote outcome is a DOMAIN result, not a server-action result: it carries a
 *  typed refusal reason a caller branches on, which the canonical
 *  `ActionResult`'s single `error` string cannot express. Discriminated on
 *  `accepted` rather than `ok` so it does not masquerade as one. */
export type VoteRefusal =
  | { accepted: false; reason: "invalid-weight"; message: string }
  | { accepted: false; reason: "budget-exhausted"; message: string; creditsRemaining: number };

export interface VoteLedger {
  installationId: string;
  cycle: string;
  creditsBudget: number;
  votes: EcosystemVote[];
}

/** Quadratic cost. The whole anti-capture property lives in this one line. */
export function creditCost(weight: number): number {
  return weight * weight;
}

export function creditsSpent(votes: EcosystemVote[]): number {
  return votes.reduce((total, vote) => total + creditCost(vote.weight), 0);
}

export function creditsRemaining(ledger: VoteLedger): number {
  return ledger.creditsBudget - creditsSpent(ledger.votes);
}

/**
 * Cast or re-weight a vote.
 *
 * A vote that cannot be afforded is REFUSED with its reason, never silently
 * clamped or dropped: a voter who believes they voted, and did not, is worse off
 * than one who was told no.
 */
export function castVote(
  ledger: VoteLedger,
  vote: EcosystemVote,
): { accepted: true; ledger: VoteLedger; creditsRemaining: number } | VoteRefusal {
  if (!Number.isInteger(vote.weight) || vote.weight < 1 || vote.weight > MAX_VOTE_WEIGHT) {
    return {
      accepted: false,
      reason: "invalid-weight",
      message: `weight must be a whole number from 1 to ${MAX_VOTE_WEIGHT}`,
    };
  }

  // Re-weighting replaces the prior vote rather than stacking on it, so the
  // refund is implicit and a voter can always correct themselves.
  const others = ledger.votes.filter((existing) => existing.ref !== vote.ref);
  const spent = creditsSpent(others) + creditCost(vote.weight);
  if (spent > ledger.creditsBudget) {
    const remaining = ledger.creditsBudget - creditsSpent(others);
    return {
      accepted: false,
      reason: "budget-exhausted",
      message:
        `weight ${vote.weight} costs ${creditCost(vote.weight)} credits and only ${remaining} remain this cycle`,
      creditsRemaining: remaining,
    };
  }

  const next: VoteLedger = { ...ledger, votes: [...others, vote] };
  return { accepted: true, ledger: next, creditsRemaining: ledger.creditsBudget - spent };
}

/** Withdraw a vote, returning its credits to the cycle. */
export function withdrawVote(ledger: VoteLedger, ref: string): VoteLedger {
  return { ...ledger, votes: ledger.votes.filter((vote) => vote.ref !== ref) };
}

export interface VoteTally {
  ref: string;
  /** Distinct installations that voted — BREADTH. */
  distinctInstallations: number;
  /** Summed weight — INTENSITY. */
  totalWeight: number;
}

/**
 * Aggregate votes across installations.
 *
 * Counts DISTINCT INSTALLATIONS, not raw votes: the Debian popcon and Sentry
 * fingerprinting lesson is that counting events lets one noisy source outrank a
 * silent structural defect. A second vote from the same installation re-weights
 * it; it never adds a voter.
 */
export function tallyVotes(
  votes: Array<{ ref: string; installationId: string; weight: number }>,
): VoteTally[] {
  const byRef = new Map<string, Map<string, number>>();
  for (const vote of votes) {
    if (!Number.isFinite(vote.weight) || vote.weight < 1) continue;
    const perInstall = byRef.get(vote.ref) ?? new Map<string, number>();
    // Last write wins for a given installation — a re-weight, not a second voice.
    perInstall.set(vote.installationId, vote.weight);
    byRef.set(vote.ref, perInstall);
  }

  return [...byRef.entries()]
    .map(([ref, perInstall]) => ({
      ref,
      distinctInstallations: perInstall.size,
      totalWeight: [...perInstall.values()].reduce((sum, weight) => sum + weight, 0),
    }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

export interface VoteDerivedScoreInputs {
  reach: number;
  impact: number;
}

/**
 * Project a tally onto the demand scorer's existing inputs.
 *
 * Breadth becomes `reach` and intensity becomes `impact`, which is the same
 * shape RICE already consumes. Nothing new is invented and no second priority
 * field is written — an ecosystem vote enters precedence the way every other
 * demand signal does.
 */
export function toScoreInputs(tally: VoteTally): VoteDerivedScoreInputs {
  return {
    reach: tally.distinctInstallations,
    impact: tally.distinctInstallations === 0
      ? 0
      : impactOnLadder(tally.totalWeight / tally.distinctInstallations),
  };
}

/**
 * Mean vote weight onto the RICE impact ladder the platform already scores on
 * (score-proposal.ts RICE_IMPACT_LADDER: 0.25, 0.5, 1, 2, 3).
 *
 * The MEAN, not the sum: breadth is already carried by reach, and summing would
 * double-count it, so a broadly-but-mildly wanted item would bury a
 * narrowly-but-urgently needed one. A single plain interest is medium impact; a
 * vote of three or four is massive. The two lowest rungs are never produced by
 * votes — nobody votes to say something matters little.
 */
export function impactOnLadder(meanWeight: number): number {
  if (meanWeight < 1.5) return 1;
  if (meanWeight < 2.5) return 2;
  return 3;
}

/** One outbound interest this installation has already spent credits on. */
export interface OutboundVoteRow {
  /** Stable per voted-on item: the response mirror's localRecordRef. */
  ref: string;
  weight: number;
  createdAt: Date;
}

/** Start of the ISO-8601 week containing `date` (Monday 00:00 UTC). */
export function isoWeekStart(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - (weekday - 1));
  return day;
}

/**
 * The budget ledger for this week, DERIVED from this installation's own
 * outbound responses — the votes are already recorded once, as the responses
 * that carry them, so the ledger is never stored a second time.
 */
export function ledgerFromOutboundVotes(
  installationId: string,
  rows: OutboundVoteRow[],
  now: Date,
  creditsBudget: number = DEFAULT_CYCLE_CREDITS,
): VoteLedger {
  const start = isoWeekStart(now).getTime();
  const votes = rows
    .filter((row) => row.createdAt.getTime() >= start && row.createdAt.getTime() <= now.getTime())
    .map((row) => ({ ref: row.ref, weight: row.weight }));
  return { installationId, cycle: isoWeekStart(now).toISOString().slice(0, 10), creditsBudget, votes };
}

export interface VoteScoreItem {
  occurrenceCount: number;
  reach: number | null;
  demandInputSource: string | null;
}

/**
 * The reach and impact a tally implies for an item, or null when votes must not
 * touch it.
 *
 * Never over a person's judgement: an item whose inputs a human entered or
 * confirmed (human | agreed) is left alone, exactly as the scoring steward
 * leaves it. Reach counts every organization affected — the voters plus the
 * installation that raised it — and never falls below what the item already
 * carried, because a vote adds breadth; it cannot take it away.
 */
export function voteScoreUpdate(item: VoteScoreItem, tally: VoteTally): VoteDerivedScoreInputs | null {
  if (item.demandInputSource === "human" || item.demandInputSource === "agreed") return null;
  if (tally.distinctInstallations === 0) return null;
  const derived = toScoreInputs(tally);
  return {
    reach: Math.max(item.reach ?? 0, item.occurrenceCount, tally.distinctInstallations + 1),
    impact: derived.impact,
  };
}
