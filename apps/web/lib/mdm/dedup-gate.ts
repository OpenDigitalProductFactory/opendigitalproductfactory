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
import { MATCH_CONFIG_DEFAULTS, loadMatchConfig, type MatchConfig } from "./match-config";

/**
 * Minimal transaction surface the heap-forced candidate lookups need: the raw
 * query builder plus the raw executor for the planner GUCs. Kept structural so
 * the queries stay testable with an in-memory fake.
 */
export interface HeapForcedTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string): Promise<number>;
}

/**
 * Run a candidate-lookup query with index scans DISABLED, so every predicate —
 * including the exact-equality arms on email / phone / domain / name — is
 * evaluated against the true heap rather than a btree that may silently disagree
 * with it (BI-FEAEB715 / BI-8CCF7F13, collation drift).
 *
 * Why this and not a trgm index: the gate's name arm uses `similarity() > floor`,
 * which no GIN index can serve — it is already a heap seq scan and is therefore
 * already collation-immune. The EXPOSED arms are the exact-equality ones with no
 * heap-forcing companion (an email-only or domain-only check drives a plain
 * btree index scan that a collation flip makes descend the wrong subtree and
 * return zero — the gate then reports "clear" for a record that exists). Forcing
 * a heap scan is the fix the repair migrations already use everywhere
 * (SET LOCAL enable_indexscan = off, e.g.
 * 20260720180000_repair_scheduled_job_index_integrity) and the one thing the
 * write-time gate did not do. SET LOCAL is transaction-scoped, so it reverts on
 * commit and touches no other query.
 *
 * Cost: a full heap scan per gated check. The name arm already seq-scans, so the
 * only NEW cost falls on exact-only checks — which are exactly the ones that
 * were silently unsafe. For a write-time correctness gate that is the right
 * trade: never miss a duplicate the database constraint could also miss.
 */
export async function runHeapForcedCandidateQuery<T>(
  run: (tx: HeapForcedTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
    await tx.$executeRawUnsafe("SET LOCAL enable_indexonlyscan = off");
    await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
    return run(tx as unknown as HeapForcedTx);
  });
}

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

// The trigram floor is no longer a module constant — it comes from the
// governed per-domain MdmMatchConfig (loadMatchConfig), falling back to
// MATCH_CONFIG_DEFAULTS.trgmFloor inside each check.
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
    "apps/web/lib/mcp/packs/crm-sales-pipeline-pack.ts#create_customer_account",
    "apps/web/app/api/v1/customer/accounts/[id]/route.ts#PATCH",
  ],
  "customer-site": ["apps/web/lib/actions/crm.ts#createCustomerSite"],
  "customer-contact": [
    "apps/web/app/api/v1/customer/contacts/route.ts#POST",
    "apps/web/lib/actions/finance.ts#generateInvoiceFromStorefrontOrder",
    "apps/web/lib/actions/social-auth-actions.ts#signUpWithSocialProfile",
    "apps/web/app/api/storefront/sign-up/route.ts#POST",
    "apps/web/app/api/v1/customer/contacts/[id]/route.ts#PATCH",
  ],
};

export type CustomerAccountDedupSubject = {
  name: string;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Update-path checks pass the record's own id so it never matches itself. */
  excludeId?: string | null;
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
  const excludeId = subject.excludeId ?? "";
  if (!nameNormalized && !domainNormalized) return { verdict: "clear", candidates: [] };
  const config = await loadMatchConfig("customer-account");

  const rows = await runHeapForcedCandidateQuery((tx) => tx.$queryRaw<AccountCandidateRow[]>`
    SELECT "id", "name", "status", "website", "nameNormalized", "domainNormalized"
    FROM "CustomerAccount"
    WHERE "status" <> 'superseded'
      AND (${excludeId} = '' OR "id" <> ${excludeId})
      AND (
        ("nameNormalized" <> '' AND "nameNormalized" = ${nameNormalized})
        OR (${domainNormalized} <> '' AND "domainNormalized" <> '' AND "domainNormalized" = ${domainNormalized})
        OR ("nameNormalized" <> '' AND similarity("nameNormalized", ${nameNormalized}) > ${config.trgmFloor})
      )
    ORDER BY similarity("nameNormalized", ${nameNormalized}) DESC NULLS LAST
    LIMIT ${CANDIDATE_LIMIT}
  `);

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
    config,
  );
}

export type CustomerContactDedupSubject = {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  accountId?: string | null;
  /** Update-path checks pass the record's own id so it never matches itself. */
  excludeId?: string | null;
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
  const excludeId = subject.excludeId ?? "";
  const config = await loadMatchConfig("customer-contact");
  const rows = await runHeapForcedCandidateQuery((tx) => tx.$queryRaw<ContactCandidateRow[]>`
    SELECT "id", "email", "firstName", "lastName", "name", "phone", "accountId"
    FROM "CustomerContact"
    WHERE (${excludeId} = '' OR "id" <> ${excludeId})
      AND ((${email} <> '' AND lower("email") = ${email})
       OR (${phone} <> '' AND "phone" IS NOT NULL AND regexp_replace("phone", '[^0-9+]', '', 'g') = ${phone})
       OR (
            ${nameNormalized} <> '' AND "nameNormalized" <> ''
            AND (${accountId} = '' OR "accountId" = ${accountId})
            AND similarity("nameNormalized", ${nameNormalized}) > ${config.trgmFloor}
          ))
    ORDER BY similarity("nameNormalized", ${nameNormalized}) DESC NULLS LAST
    LIMIT ${CANDIDATE_LIMIT}
  `);

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
    config,
  );
}

export type CustomerSiteDedupSubject = {
  accountId: string;
  name: string;
  /** Update-path checks pass the record's own id so it never matches itself. */
  excludeId?: string | null;
};

type SiteCandidateRow = { id: string; name: string; status: string; nameNormalized: string };

/** Check a prospective CustomerSite within its account (partial unique backs exact). */
export async function checkCustomerSiteDuplicates(
  subject: CustomerSiteDedupSubject,
): Promise<DedupCheckResult> {
  const nameNormalized = standardizeName(subject.name);
  const excludeId = subject.excludeId ?? "";
  if (!nameNormalized) return { verdict: "clear", candidates: [] };
  const config = await loadMatchConfig("customer-site");

  const rows = await runHeapForcedCandidateQuery((tx) => tx.$queryRaw<SiteCandidateRow[]>`
    SELECT "id", "name", "status", "nameNormalized"
    FROM "CustomerSite"
    WHERE "accountId" = ${subject.accountId}
      AND "status" <> 'superseded'
      AND (${excludeId} = '' OR "id" <> ${excludeId})
      AND (
        "nameNormalized" = ${nameNormalized}
        OR similarity("nameNormalized", ${nameNormalized}) > ${config.trgmFloor}
      )
    ORDER BY similarity("nameNormalized", ${nameNormalized}) DESC NULLS LAST
    LIMIT ${CANDIDATE_LIMIT}
  `);

  const subjectMatch: MatchSubject = { id: "__subject__", name: subject.name };
  return toResult(
    rows.map((row) => ({
      match: { id: row.id, name: row.name } satisfies MatchSubject,
      label: row.name,
      detail: row.status,
      exactNameMatch: row.nameNormalized !== "" && row.nameNormalized === nameNormalized,
    })),
    subjectMatch,
    config,
  );
}

/**
 * Parse the wire form of a dedup resolution from an API/tool payload:
 * `duplicateResolution`: "use-existing:<id>" | "confirm-new" (+ optional
 * `duplicateReason`). Returns undefined when absent or malformed.
 */
export function parseDedupResolution(body: unknown): DedupResolution | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const raw = (body as Record<string, unknown>)["duplicateResolution"];
  if (typeof raw !== "string") return undefined;
  if (raw.startsWith("use-existing:")) {
    const existingId = raw.slice("use-existing:".length).trim();
    return existingId ? { kind: "use-existing", existingId } : undefined;
  }
  if (raw === "confirm-new") {
    const reason = (body as Record<string, unknown>)["duplicateReason"];
    return { kind: "confirm-new", reason: typeof reason === "string" ? reason : undefined };
  }
  return undefined;
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
  config: MatchConfig = MATCH_CONFIG_DEFAULTS,
): DedupCheckResult {
  const candidates: DedupCandidate[] = rows
    .map((row) => {
      const scored = scoreMatchCandidate(subject, row.match);
      // Governed thresholds (MdmMatchConfig) decide the recommendation from
      // the raw score; the scorer's built-in bands are the code default.
      let recommendation: MatchCandidateResult["recommendation"] =
        scored.score >= config.likelyThreshold
          ? "likely-duplicate"
          : scored.score >= config.possibleThreshold
            ? "possible-duplicate"
            : "distinct";
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
