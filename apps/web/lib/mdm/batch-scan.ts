/**
 * MDM batch retroactive duplicate scan (EP-4A12A7CB, BI-7BF995B9).
 *
 * The write-time gate only protects NEW writes; this scan finds duplicate
 * pairs already in the data (created before the gate shipped, or via ungated
 * identity flows). Candidate pairs come from a SQL self-join over the same
 * persisted normalized columns + pg_trgm blocking the gate uses, then each
 * pair is scored by the same `scoreMatchCandidate` — one matching vocabulary
 * everywhere. On-demand compute; persistence/workflow belongs to the steward
 * queue (BI-FEA49EC1).
 */
import { prisma } from "@dpf/db";
import { scoreMatchCandidate, type MatchCandidateResult, type MatchSubject } from "./match-candidate";
import { loadMatchConfig, type MatchConfig } from "./match-config";

export type DuplicatePair = {
  a: { id: string; label: string; detail: string | null };
  b: { id: string; label: string; detail: string | null };
  score: number;
  reasons: MatchCandidateResult["reasons"];
  recommendation: MatchCandidateResult["recommendation"];
};

/** Cap raw SQL pairs per scan; scoring trims further. */
const PAIR_LIMIT = 200;

/** Governed recommendation from raw score + surface-over-miss name upgrade. */
function recommend(
  scored: MatchCandidateResult,
  config: MatchConfig,
): MatchCandidateResult["recommendation"] {
  const banded: MatchCandidateResult["recommendation"] =
    scored.score >= config.likelyThreshold
      ? "likely-duplicate"
      : scored.score >= config.possibleThreshold
        ? "possible-duplicate"
        : "distinct";
  if (banded === "distinct" && scored.reasons.some((r) => r.attribute === "name")) {
    return "possible-duplicate";
  }
  return banded;
}

type AccountPairRow = {
  a_id: string;
  a_name: string;
  a_status: string;
  a_website: string | null;
  b_id: string;
  b_name: string;
  b_status: string;
  b_website: string | null;
};

/**
 * Scan all non-tombstoned CustomerAccounts for likely/possible duplicate
 * pairs, strongest first.
 */
export async function scanCustomerAccountDuplicates(): Promise<DuplicatePair[]> {
  const config = await loadMatchConfig("customer-account");
  const rows = await prisma.$queryRaw<AccountPairRow[]>`
    SELECT a."id" AS a_id, a."name" AS a_name, a."status" AS a_status, a."website" AS a_website,
           b."id" AS b_id, b."name" AS b_name, b."status" AS b_status, b."website" AS b_website
    FROM "CustomerAccount" a
    JOIN "CustomerAccount" b ON a."id" < b."id"
    WHERE a."status" <> 'superseded' AND b."status" <> 'superseded'
      AND (
        (a."nameNormalized" <> '' AND a."nameNormalized" = b."nameNormalized")
        OR (a."domainNormalized" <> '' AND a."domainNormalized" = b."domainNormalized")
        OR (a."nameNormalized" <> '' AND b."nameNormalized" <> ''
            AND similarity(a."nameNormalized", b."nameNormalized") > ${config.trgmFloor})
      )
    ORDER BY similarity(a."nameNormalized", b."nameNormalized") DESC NULLS LAST
    LIMIT ${PAIR_LIMIT}
  `;

  const pairs: DuplicatePair[] = [];
  for (const row of rows) {
    const subject: MatchSubject = { id: row.a_id, name: row.a_name, website: row.a_website };
    const candidate: MatchSubject = { id: row.b_id, name: row.b_name, website: row.b_website };
    const scored = scoreMatchCandidate(subject, candidate);
    // Batch semantics mirror the gate: governed thresholds band the score,
    // any name signal is worth a steward's glance (surface over miss).
    const recommendation = recommend(scored, config);
    if (recommendation === "distinct") continue;
    pairs.push({
      a: { id: row.a_id, label: row.a_name, detail: row.a_status },
      b: { id: row.b_id, label: row.b_name, detail: row.b_status },
      score: scored.score,
      reasons: scored.reasons,
      recommendation,
    });
  }
  return pairs.sort((x, y) => y.score - x.score);
}

type ContactPairRow = {
  a_id: string;
  a_email: string;
  a_name: string | null;
  b_id: string;
  b_email: string;
  b_name: string | null;
  account_id: string;
};

/**
 * Scan for same-account contact pairs with matching normalized names —
 * the "same human, second email" case. Alert-only (contacts converge via
 * Principal, never auto-merge).
 */
export async function scanCustomerContactDuplicates(): Promise<DuplicatePair[]> {
  const config = await loadMatchConfig("customer-contact");
  const rows = await prisma.$queryRaw<ContactPairRow[]>`
    SELECT a."id" AS a_id, a."email" AS a_email, a."name" AS a_name,
           b."id" AS b_id, b."email" AS b_email, b."name" AS b_name,
           a."accountId" AS account_id
    FROM "CustomerContact" a
    JOIN "CustomerContact" b ON a."id" < b."id" AND a."accountId" = b."accountId"
    WHERE a."mergedIntoId" IS NULL AND b."mergedIntoId" IS NULL
      AND a."nameNormalized" <> '' AND b."nameNormalized" <> ''
      AND similarity(a."nameNormalized", b."nameNormalized") > ${config.trgmFloor}
    ORDER BY similarity(a."nameNormalized", b."nameNormalized") DESC
    LIMIT ${PAIR_LIMIT}
  `;

  const pairs: DuplicatePair[] = [];
  for (const row of rows) {
    const scored = scoreMatchCandidate(
      { id: row.a_id, name: row.a_name, email: row.a_email },
      { id: row.b_id, name: row.b_name, email: row.b_email },
    );
    const recommendation = recommend(scored, config);
    if (recommendation === "distinct") continue;
    pairs.push({
      a: { id: row.a_id, label: row.a_name ?? row.a_email, detail: row.a_email },
      b: { id: row.b_id, label: row.b_name ?? row.b_email, detail: row.b_email },
      score: scored.score,
      reasons: scored.reasons,
      recommendation,
    });
  }
  return pairs.sort((x, y) => y.score - x.score);
}
