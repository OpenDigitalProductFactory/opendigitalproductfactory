/**
 * MDM write-time duplicate-prevention gate (EP-4A12A7CB WG-1, spec §5.1).
 *
 * The shared primitive every governed master-data create path calls BEFORE
 * insert. Candidate generation runs in SQL over the persisted normalized
 * columns (exact normalized name / web domain / email / phone equality plus
 * pg_trgm similarity blocking); scoring reuses the existing
 * `scoreMatchCandidate` weights and reasons — no parallel vocabulary.
 *
 * Contract (spec §5.1):
 *  - verdict "clear"              → caller inserts.
 *  - verdict "possible-duplicate" → caller presents candidates; an explicit
 *    `confirm-new` resolution proceeds (alert semantics).
 *  - verdict "likely-duplicate"   → insert refused without an explicit
 *    resolution: `use-existing` (never inserts) or `confirm-new` with a
 *    reason (block-with-override semantics).
 *
 * The gate never merges and never auto-links — merging stays a governed
 * steward action (doctrine 2026-05-31 §5.4).
 */
import { prisma } from "@dpf/db";
import {
  scoreMatchCandidate,
  type MatchCandidateResult,
  type MatchSubject,
} from "./match-candidate";
import { standardizeDomain, standardizeEmail, standardizeName, standardizePhone } from "./standardize";

/** Domains the write-time gate covers today (subset of MasterDataDomain). */
export type DedupGatedDomain = "customer-account" | "customer-site" | "customer-contact";

export type DedupResolution =
  | { kind: "use-existing"; existingId: string }
  | { kind: "confirm-new"; reason?: string };

export type DedupCandidate = {
  id: string;
  label: string;
  detail: string | null;
  score: number;
  reasons: MatchCandidateResult["reasons"];
  recommendation: MatchCandidateResult["recommendation"];
};

export type DedupVerdict = "clear" | "possible-duplicate" | "likely-duplicate";

export type DedupCheckResult = {
  verdict: DedupVerdict;
  candidates: DedupCandidate[];
};

/** Similarity floor for trigram blocking — recall-oriented; precision comes from scoring. */
const TRGM_SIMILARITY_FLOOR = 0.3;
const CANDIDATE_LIMIT = 10;

/**
 * Registry of the write paths gated per domain. The coverage-guard test
 * (dedup-gate-coverage.test.ts) asserts each registered path imports and
 * calls the gate — the structural substitute for interception's
 * cannot-bypass property (spec §4). Add the path here WHEN wiring the gate
 * into a new create path; the test fails on unregistered gated-domain
 * writers it can detect and on registered paths that drop the call.
 */
export const GATED_CREATE_PATHS: Readonly<Record<DedupGatedDomain, readonly string[]>> = {
  "customer-account": [
    "apps/web/lib/actions/crm.ts#createCustomerAccount",
    "apps/web/lib/mcp-tools.ts#create_customer_account",
  ],
  "customer-site": ["apps/web/lib/actions/crm.ts#createCustomerSite"],
  "customer-contact": [
    "apps/web/app/api/v1/customer/contacts/route.ts#POST",
    "apps/web/lib/actions/finance.ts#generateInvoiceFromStorefrontOrder",
    "apps/web/lib/actions/social-auth-actions.ts#signUpWithSocialProfile",
    "apps/web/app/api/storefront/sign-up/route.ts#POST",
  ],
};

export type CustomerAccountDedupSubject = {
  name: string;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
};

type AccountCandidateRow = {
  id: string;
  name: string;
  status: string;
  website: string | null;
  nameNormalized: string;
  domainNormalized: string;
};

/**
 * Check a prospective CustomerAccount against existing accounts.
 * Excludes tombstoned (`superseded`) rows.
 */
export async function checkCustomerAccountDuplicates(
  subject: CustomerAccountDedupSubject,
): Promise<DedupCheckResult> {
  const nameNormalized = standardizeName(subject.name);
  const domainNormalized = standardizeDomain(subject.website);
  if (!nameNormalized && !domainNormalized) return { verdict: "clear", candidates: [] };

  const rows = await prisma.$queryRaw<AccountCandidateRow[]>`
    SELECT "id", "name", "status", "website", "nameNormalized", "domainNormalized"
    FROM "CustomerAccount"
    WHERE "status" <> 'superseded'
      AND (
        ("nameNormalized" <> '' AND "nameNormalized" = ${nameNormalized})
        OR (${domainNormalized} <> '' AND "domainNormalized" <> '' AND "domainNormalized" = ${domainNormalized})
        OR ("nameNormalized" <> '' AND similarity("nameNormalized", ${nameNormalized}) > ${TRGM_SIMILARITY_FLOOR})
      )
    ORDER BY similarity("nameNormalized", ${nameNormalized}) DESC NULLS LAST
    LIMIT ${CANDIDATE_LIMIT}
  `;

  const subjectMatch: MatchSubject = {
    id: "__subject__",
    name: subject.name,
    website: subject.website ?? null,
    email: subject.email ?? null,
    phone: subject.phone ?? null,
  };

  return toResult(
    rows.map((row) => ({
      match: { id: row.id, name: row.name, website: row.website } satisfies MatchSubject,
      label: row.name,
      detail: row.status,
      exactNameMatch: row.nameNormalized !== "" && row.nameNormalized === nameNormalized,
    })),
    subjectMatch,
  );
}

export type CustomerContactDedupSubject = {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  accountId?: string | null;
};

type ContactCandidateRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  phone: string | null;
  accountId: string;
};

/**
 * Check a prospective CustomerContact. Email exact-uniqueness is already a DB
 * constraint; this catches the same human under a different email / typo'd
 * name within the same account (fuzzy-alert semantics — contacts never hard
 * block, they are identity-bearing and converge via Principal, spec §5.3).
 */
export async function checkCustomerContactDuplicates(
  subject: CustomerContactDedupSubject,
): Promise<DedupCheckResult> {
  const displayName =
    [subject.firstName, subject.lastName].filter(Boolean).join(" ").trim() || (subject.name ?? "");
  const nameNormalized = standardizeName(displayName);
  const email = standardizeEmail(subject.email);
  const phone = standardizePhone(subject.phone);
  if (!nameNormalized && !email && !phone) return { verdict: "clear", candidates: [] };

  const accountId = subject.accountId ?? "";
  const rows = await prisma.$queryRaw<ContactCandidateRow[]>`
    SELECT "id", "email", "firstName", "lastName", "name", "phone", "accountId"
    FROM "CustomerContact"
    WHERE (${email} <> '' AND lower("email") = ${email})
       OR (${phone} <> '' AND "phone" IS NOT NULL AND regexp_replace("phone", '[^0-9+]', '', 'g') = ${phone})
       OR (
            ${nameNormalized} <> '' AND "nameNormalized" <> ''
            AND (${accountId} = '' OR "accountId" = ${accountId})
            AND similarity("nameNormalized", ${nameNormalized}) > ${TRGM_SIMILARITY_FLOOR}
          )
    ORDER BY similarity("nameNormalized", ${nameNormalized}) DESC NULLS LAST
    LIMIT ${CANDIDATE_LIMIT}
  `;

  const subjectMatch: MatchSubject = {
    id: "__subject__",
    name: displayName,
    email: subject.email ?? null,
    phone: subject.phone ?? null,
  };

  return toResult(
    rows.map((row) => ({
      match: {
        id: row.id,
        name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.name,
        email: row.email,
        phone: row.phone,
      } satisfies MatchSubject,
      label: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.name || row.email,
      detail: row.email,
    })),
    subjectMatch,
  );
}

export type CustomerSiteDedupSubject = { accountId: string; name: string };

type SiteCandidateRow = { id: string; name: string; status: string; nameNormalized: string };

/** Check a prospective CustomerSite within its account (partial unique backs exact). */
export async function checkCustomerSiteDuplicates(
  subject: CustomerSiteDedupSubject,
): Promise<DedupCheckResult> {
  const nameNormalized = standardizeName(subject.name);
  if (!nameNormalized) return { verdict: "clear", candidates: [] };

  const rows = await prisma.$queryRaw<SiteCandidateRow[]>`
    SELECT "id", "name", "status", "nameNormalized"
    FROM "CustomerSite"
    WHERE "accountId" = ${subject.accountId}
      AND "status" <> 'superseded'
      AND (
        "nameNormalized" = ${nameNormalized}
        OR similarity("nameNormalized", ${nameNormalized}) > ${TRGM_SIMILARITY_FLOOR}
      )
    ORDER BY similarity("nameNormalized", ${nameNormalized}) DESC NULLS LAST
    LIMIT ${CANDIDATE_LIMIT}
  `;

  const subjectMatch: MatchSubject = { id: "__subject__", name: subject.name };
  return toResult(
    rows.map((row) => ({
      match: { id: row.id, name: row.name } satisfies MatchSubject,
      label: row.name,
      detail: row.status,
      exactNameMatch: row.nameNormalized !== "" && row.nameNormalized === nameNormalized,
    })),
    subjectMatch,
  );
}

/**
 * Apply the gate contract to a check result + caller-supplied resolution.
 * Returns the action the caller must take. Pure — callers own the insert.
 */
export function resolveDedupDecision(
  result: DedupCheckResult,
  resolution: DedupResolution | undefined,
):
  | { action: "proceed"; overrideReason?: string }
  | { action: "use-existing"; existingId: string }
  | { action: "needs-resolution"; result: DedupCheckResult } {
  if (resolution?.kind === "use-existing") {
    return { action: "use-existing", existingId: resolution.existingId };
  }
  if (result.verdict === "clear") return { action: "proceed" };
  if (resolution?.kind === "confirm-new") {
    return { action: "proceed", overrideReason: resolution.reason };
  }
  return { action: "needs-resolution", result };
}

/**
 * Score raw candidate rows against the subject and derive the gate verdict.
 *
 * Two write-time adjustments over the raw scorer (doctrine: prefer surfacing
 * a possible duplicate over silently missing it — match-candidate.ts header):
 *  - exact normalized-name equality is a likely-duplicate even without a
 *    corroborating domain/email signal ("Managing Digital" vs "Managing
 *    Digital Ltd" normalize equal);
 *  - any name-similarity reason keeps the candidate as at least a
 *    possible-duplicate ("Emma 3D" vs "Emma3D" scores name-weak only, which
 *    the steward-queue thresholds would drop but a create-time alert must
 *    surface).
 */
function toResult(
  rows: Array<{
    match: MatchSubject;
    label: string | null;
    detail: string | null;
    exactNameMatch?: boolean;
  }>,
  subject: MatchSubject,
): DedupCheckResult {
  const candidates: DedupCandidate[] = rows
    .map((row) => {
      const scored = scoreMatchCandidate(subject, row.match);
      let recommendation = scored.recommendation;
      if (row.exactNameMatch && recommendation !== "likely-duplicate") {
        recommendation = "likely-duplicate";
      } else if (
        recommendation === "distinct" &&
        scored.reasons.some((r) => r.attribute === "name")
      ) {
        recommendation = "possible-duplicate";
      }
      return {
        id: row.match.id,
        label: row.label ?? row.match.id,
        detail: row.detail,
        score: scored.score,
        reasons: scored.reasons,
        recommendation,
      };
    })
    .filter((c) => c.recommendation !== "distinct")
    .sort((a, b) => b.score - a.score);

  const verdict: DedupVerdict = candidates.some((c) => c.recommendation === "likely-duplicate")
    ? "likely-duplicate"
    : candidates.length > 0
      ? "possible-duplicate"
      : "clear";

  return { verdict, candidates };
}

/** Normalized-column payload the gated create/update paths persist. */
export function customerAccountNormalizedColumns(input: {
  name: string;
  website?: string | null;
}): { nameNormalized: string; domainNormalized: string } {
  return {
    nameNormalized: standardizeName(input.name),
    domainNormalized: standardizeDomain(input.website),
  };
}

export function customerSiteNormalizedColumns(input: { name: string }): {
  nameNormalized: string;
} {
  return { nameNormalized: standardizeName(input.name) };
}

export function customerContactNormalizedColumns(input: {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
}): { nameNormalized: string } {
  const displayName =
    [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || (input.name ?? "");
  return { nameNormalized: standardizeName(displayName) };
}
