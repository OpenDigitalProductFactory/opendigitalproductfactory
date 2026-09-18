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

/** Beyond this, one item would consume a whole default budget on its own. */
export const MAX_VOTE_WEIGHT = 4;

export interface EcosystemVote {
  ref: string;
  weight: number;
}

export type VoteRefusal =
  | { ok: false; reason: "invalid-weight"; message: string }
  | { ok: false; reason: "budget-exhausted"; message: string; creditsRemaining: number };

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
): { ok: true; ledger: VoteLedger; creditsRemaining: number } | VoteRefusal {
  if (!Number.isInteger(vote.weight) || vote.weight < 1 || vote.weight > MAX_VOTE_WEIGHT) {
    return {
      ok: false,
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
      ok: false,
      reason: "budget-exhausted",
      message:
        `weight ${vote.weight} costs ${creditCost(vote.weight)} credits and only ${remaining} remain this cycle`,
      creditsRemaining: remaining,
    };
  }

  const next: VoteLedger = { ...ledger, votes: [...others, vote] };
  return { ok: true, ledger: next, creditsRemaining: ledger.creditsBudget - spent };
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
    // Mean weight, so a broadly-but-mildly wanted item does not out-score a
    // narrowly-but-urgently needed one purely by having more voters; breadth is
    // already carried by reach, and double-counting it here would hide intensity.
    impact: tally.distinctInstallations === 0
      ? 0
      : tally.totalWeight / tally.distinctInstallations,
  };
}
