/**
 * Duplicate-candidate scoring for master data (MDM spec §6.3).
 *
 * Scores how likely two canonical records are the same real-world entity, with
 * human-readable reasons. This NEVER merges: per doctrine (spec §5.4 / Non-Goals)
 * uncertain matches route to stewardship — the score is advisory input to the
 * steward queue (MDM-3), not an auto-merge trigger.
 */
import {
  diceCoefficient,
  standardizeDomain,
  standardizeEmail,
  standardizeName,
  standardizePhone,
} from "./standardize";

export type MatchSubject = {
  id: string;
  name?: string | null;
  website?: string | null;
  domain?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type MatchReason = {
  attribute: "domain" | "name" | "email" | "phone";
  kind: "exact" | "strong" | "weak";
  detail: string;
};

/** Advisory recommendation — a steward still decides the action (link/reject/create-new). */
export type MatchRecommendation =
  | "likely-duplicate"
  | "possible-duplicate"
  | "distinct";

export type MatchCandidateResult = {
  /** 0..1 confidence that the two records are the same entity. */
  score: number;
  reasons: MatchReason[];
  recommendation: MatchRecommendation;
};

const LIKELY_THRESHOLD = 0.8;
// A single strong identity signal (shared domain, exact normalized name, or
// shared email) is enough to put a pair in front of a steward — doctrine
// prefers surfacing a possible duplicate over silently missing it (spec §6.3).
const POSSIBLE_THRESHOLD = 0.45;
const NAME_STRONG_SIMILARITY = 0.85;
const NAME_WEAK_SIMILARITY = 0.6;

/**
 * Score a candidate match between two records. Weights reflect signal strength:
 * a shared web domain is the single strongest identity signal; exact name,
 * email, and phone add corroboration; a fuzzy name match adds partial weight.
 */
export function scoreMatchCandidate(
  a: MatchSubject,
  b: MatchSubject,
): MatchCandidateResult {
  const reasons: MatchReason[] = [];
  let score = 0;

  const domainA = standardizeDomain(a.domain ?? a.website);
  const domainB = standardizeDomain(b.domain ?? b.website);
  if (domainA && domainB && domainA === domainB) {
    score += 0.6;
    reasons.push({ attribute: "domain", kind: "exact", detail: domainA });
  }

  const nameA = standardizeName(a.name);
  const nameB = standardizeName(b.name);
  if (nameA && nameB) {
    if (nameA === nameB) {
      score += 0.45;
      reasons.push({ attribute: "name", kind: "exact", detail: nameA });
    } else {
      const similarity = diceCoefficient(nameA, nameB);
      if (similarity >= NAME_STRONG_SIMILARITY) {
        score += 0.3;
        reasons.push({ attribute: "name", kind: "strong", detail: `~${similarity.toFixed(2)}` });
      } else if (similarity >= NAME_WEAK_SIMILARITY) {
        score += 0.15;
        reasons.push({ attribute: "name", kind: "weak", detail: `~${similarity.toFixed(2)}` });
      }
    }
  }

  const emailA = standardizeEmail(a.email);
  const emailB = standardizeEmail(b.email);
  if (emailA && emailB && emailA === emailB) {
    score += 0.5;
    reasons.push({ attribute: "email", kind: "exact", detail: emailA });
  }

  const phoneA = standardizePhone(a.phone);
  const phoneB = standardizePhone(b.phone);
  if (phoneA && phoneB && phoneA === phoneB) {
    score += 0.4;
    reasons.push({ attribute: "phone", kind: "exact", detail: phoneA });
  }

  score = Math.min(1, Number(score.toFixed(2)));
  const recommendation: MatchRecommendation =
    score >= LIKELY_THRESHOLD
      ? "likely-duplicate"
      : score >= POSSIBLE_THRESHOLD
        ? "possible-duplicate"
        : "distinct";

  return { score, reasons, recommendation };
}

/**
 * Find candidate duplicates of `subject` among `pool` (excluding itself),
 * ranked by score, keeping only possible/likely duplicates. Output feeds the
 * steward queue — it does not act.
 */
export function findMatchCandidates(
  subject: MatchSubject,
  pool: readonly MatchSubject[],
): Array<{ candidate: MatchSubject; result: MatchCandidateResult }> {
  return pool
    .filter((candidate) => candidate.id !== subject.id)
    .map((candidate) => ({ candidate, result: scoreMatchCandidate(subject, candidate) }))
    .filter((entry) => entry.result.recommendation !== "distinct")
    .sort((x, y) => y.result.score - x.result.score);
}
