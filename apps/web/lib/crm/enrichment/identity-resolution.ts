/**
 * Identity-resolution gate (BI-E2449835, design decision ①).
 *
 * The top trust risk in CRM enrichment is enriching a same-named but DIFFERENT
 * company. Before findings are harvested, resolve the identity "anchor" of both
 * the record and the researched entity and compare them:
 *   - a DOMAIN CONFLICT (the record's own domain differs from the researched
 *     domain) is a hard signal the research is about the wrong company → the
 *     proposal is blocked and nothing is filed;
 *   - weaker mismatches yield a low match score ("weak") — the proposal still
 *     goes through the propose→apply gate, but the human is told the identity is
 *     not strongly confirmed before they approve.
 *
 * Anchor priority is domain-first (the strongest key), then name similarity,
 * then location corroboration — the market's accuracy-first ordering. Pure,
 * DB-free.
 */
import type { EnrichmentAnchor, EnrichmentFinding, IdentityMatch } from "./types";

/** At or above this score the identity is confirmed; below it is "weak". */
export const IDENTITY_MATCH_THRESHOLD = 0.5;

const COMPANY_SUFFIX =
  /\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|group|holdings|pllc|pc|lp|llp|sarl|bv|ag)\b/gi;

/** Reduce a URL or host to a bare registrable-ish domain (lowercase, no www). */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (s.length === 0) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
  s = s.replace(/^www\./, "");
  s = s.split(/[/?#]/)[0] ?? s; // strip path/query/hash
  s = s.replace(/:\d+$/, ""); // strip port
  return s.includes(".") && /[a-z0-9]/.test(s) ? s : null;
}

function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .toLowerCase()
    .replace(COMPANY_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameTokens(name: string | null | undefined): Set<string> {
  return new Set(
    normalizeName(name)
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/** Fraction of the smaller token set that is shared (0..1). */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function locationTokens(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/** The record's own identity anchor, from its stored fields. */
export function resolveRecordAnchor(current: Record<string, unknown>): EnrichmentAnchor {
  const str = (k: string) => {
    const v = current[k];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  };
  return {
    domain: normalizeDomain(str("website")),
    name: str("name"),
    location: str("location") ?? str("city") ?? str("region"),
  };
}

/**
 * The researched entity's anchor. An explicit caller-supplied anchor (the
 * identity the coworker resolved during research) takes precedence; otherwise a
 * `website` finding supplies the domain and name/location findings fill the rest.
 */
export function resolveResearchedAnchor(
  findings: EnrichmentFinding[],
  explicit?: EnrichmentAnchor | null,
): EnrichmentAnchor {
  const findingValue = (field: string) => findings.find((f) => f.field === field)?.value ?? null;
  return {
    domain: normalizeDomain(explicit?.domain ?? findingValue("website")),
    name: (explicit?.name ?? findingValue("name")) || null,
    location: (explicit?.location ?? findingValue("location")) || null,
  };
}

/** Compare the record's anchor against the researched anchor. */
export function scoreIdentityMatch(
  recordAnchor: EnrichmentAnchor,
  researchedAnchor: EnrichmentAnchor,
): IdentityMatch {
  const agreements: string[] = [];
  const conflicts: string[] = [];

  // Domain is the strongest key. Both present + equal = strong agreement;
  // both present + different = hard conflict (a same-named different company).
  const rd = normalizeDomain(recordAnchor.domain);
  const xd = normalizeDomain(researchedAnchor.domain);
  let domainVerdict: "agree" | "conflict" | "absent" = "absent";
  if (rd && xd) {
    if (rd === xd) {
      agreements.push("domain");
      domainVerdict = "agree";
    } else {
      conflicts.push("domain");
      domainVerdict = "conflict";
    }
  }

  const nameSim = tokenOverlap(nameTokens(recordAnchor.name), nameTokens(researchedAnchor.name));
  if (recordAnchor.name && researchedAnchor.name && nameSim >= 0.6) {
    agreements.push("name");
  }

  // Location is a weak corroborator: agree when the two share their significant
  // tokens (so "Round Rock, TX" ≈ "Round Rock, Texas" — same city).
  const locSim = tokenOverlap(locationTokens(recordAnchor.location), locationTokens(researchedAnchor.location));
  if (locSim >= 0.5) {
    agreements.push("location");
  }

  // A domain conflict is decisive: refuse regardless of other signals.
  if (domainVerdict === "conflict") {
    return { score: 0, agreements, conflicts, verdict: "conflict" };
  }

  let score = 0;
  if (domainVerdict === "agree") score += 0.7;
  score += Math.min(0.4, nameSim * 0.4);
  if (agreements.includes("location")) score += 0.2;
  score = Math.min(1, Math.round(score * 100) / 100);

  return {
    score,
    agreements,
    conflicts,
    verdict: score >= IDENTITY_MATCH_THRESHOLD ? "agree" : "weak",
  };
}

/** Convenience: resolve both anchors from a record + findings and compare. */
export function assessIdentity(
  current: Record<string, unknown>,
  findings: EnrichmentFinding[],
  explicitAnchor?: EnrichmentAnchor | null,
): { recordAnchor: EnrichmentAnchor; researchedAnchor: EnrichmentAnchor; match: IdentityMatch } {
  const recordAnchor = resolveRecordAnchor(current);
  const researchedAnchor = resolveResearchedAnchor(findings, explicitAnchor);
  return { recordAnchor, researchedAnchor, match: scoreIdentityMatch(recordAnchor, researchedAnchor) };
}
