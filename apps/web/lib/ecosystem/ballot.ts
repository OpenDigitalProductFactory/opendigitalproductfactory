/**
 * Ballot assembly (BI-4D924DB4).
 *
 * The vote goes to every participant, but not on everything: a ballot is
 * consent-gated and relevance-scoped to the install reading it. Three tiers,
 * because "your own submission" is not the same claim as "relevant to you", and
 * "might be relevant" must not masquerade as "is".
 */

import {
  classifyBallotItem,
  mayAppearOnBallot,
  type BallotApplicability,
  type BallotConsentEnvelope,
  type InstallRelevanceProfile,
} from "./ballot-applicability";

export interface BallotCandidate extends BallotConsentEnvelope {
  /** Stable id of the underlying item (backlog item id or envelope ref). */
  ref: string;
  title: string;
  summary: string;
  /** Installation that submitted it, as a stable pseudonym. */
  submitter: string | null;
  archetypeRefs?: string[] | null;
  /** Precedence input — already computed by the demand scorer. Never recomputed here. */
  score?: number | null;
  occurrenceCount?: number;
  affectedOrganizations?: number | null;
}

export interface BallotEntry {
  ref: string;
  title: string;
  summary: string;
  submitter: string | null;
  applicability: BallotApplicability;
  score: number | null;
  affectedOrganizations: number | null;
}

export interface Ballot {
  /** This install's own submissions. Always present, whatever the verdict. */
  yours: BallotEntry[];
  /** Relevant to this install — the substance of the ballot. */
  applies: BallotEntry[];
  /** Possibly relevant, shown below the fold with its reason. */
  mightApply: BallotEntry[];
  /** Counts only — never the items themselves. */
  withheld: { notRelevant: number; noConsent: number };
}

export interface AssembleBallotInput {
  candidates: BallotCandidate[];
  /** The install reading this ballot. */
  viewer: { installationId: string; audience: string; profile: InstallRelevanceProfile };
  now?: Date;
}

function toEntry(candidate: BallotCandidate, applicability: BallotApplicability): BallotEntry {
  return {
    ref: candidate.ref,
    title: candidate.title,
    summary: candidate.summary,
    submitter: candidate.submitter,
    applicability,
    score: candidate.score ?? null,
    affectedOrganizations: candidate.affectedOrganizations ?? null,
  };
}

/**
 * Order by the score the demand engine ALREADY computed, then by breadth, then
 * by title for stability. Breadth over intensity is the spec's second tie-break;
 * the first (a defect blocking a core value stream) belongs to arbitration,
 * where the work type and the score inputs live, not to ballot presentation.
 *
 * A null score sorts last rather than as zero — "not scored" is not "scored
 * zero", and fabricating a zero would silently outrank genuinely low-scored work.
 */
function byPrecedence(a: BallotEntry, b: BallotEntry): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  const reach = (b.affectedOrganizations ?? 0) - (a.affectedOrganizations ?? 0);
  if (reach !== 0) return reach;
  return a.title.localeCompare(b.title);
}

export function assembleBallot(input: AssembleBallotInput): Ballot {
  const ballot: Ballot = {
    yours: [],
    applies: [],
    mightApply: [],
    withheld: { notRelevant: 0, noConsent: 0 },
  };
  const now = input.now ?? new Date();

  for (const candidate of input.candidates) {
    const applicability = classifyBallotItem(candidate, input.viewer.profile);

    // Tier 1 — your own submission. Consent is not consulted: an install may
    // always see what it itself submitted, and relevance is not in question.
    if (candidate.submitter && candidate.submitter === input.viewer.installationId) {
      ballot.yours.push(toEntry(candidate, applicability));
      continue;
    }

    // Gate 1 — consent, BEFORE relevance. A submission its owner never released
    // must not surface merely because it happens to be relevant here.
    const consent = mayAppearOnBallot(candidate, { audience: input.viewer.audience, now });
    if (!consent.permitted) {
      ballot.withheld.noConsent++;
      continue;
    }

    // Gate 2 — relevance.
    if (applicability.scope === "applies") ballot.applies.push(toEntry(candidate, applicability));
    else if (applicability.scope === "review") ballot.mightApply.push(toEntry(candidate, applicability));
    else ballot.withheld.notRelevant++;
  }

  ballot.yours.sort(byPrecedence);
  ballot.applies.sort(byPrecedence);
  ballot.mightApply.sort(byPrecedence);
  return ballot;
}
