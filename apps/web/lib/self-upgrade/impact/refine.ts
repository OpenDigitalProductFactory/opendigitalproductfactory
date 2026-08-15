// apps/web/lib/self-upgrade/impact/refine.ts
//
// Second classification pass — the part the commit subject alone cannot decide.
//
// `conventional.ts` derives a category from the subject grammar (type + scope).
// That is enough to separate a feature from a fix from a docs commit from a
// dependency bump, but NOT enough to tell a routine version bump from one that
// closes a published advisory: upstream emits both as `build(deps): bump X`.
// The distinguishing evidence — advisory ids, `security` / `dependabot` labels,
// "vulnerability" wording — lives on the PR, so this pass runs AFTER pr-enrich
// and re-buckets the affected commits before counts are taken.
//
// Deliberately conservative: it only ever PROMOTES a commit to `security`, and
// only on explicit evidence. A commit with no PR enrichment keeps the category
// the subject earned it — we never guess a security fix into existence.

import type { ParsedCommit, PrEnrichment } from "./types";

/** Labels that state, unambiguously, that a PR is security work. */
const SECURITY_LABELS: ReadonlySet<string> = new Set([
  "security",
  "vulnerability",
  "cve",
  "advisory",
  "dependabot-security",
  "security-fix",
]);

// Advisory identifiers + the words a security PR title/body actually uses.
// `GHSA-…` / `CVE-…` are the load-bearing signals; the prose terms are the
// fallback for hand-written subjects that reference no id.
const SECURITY_TEXT_RE =
  /\b(cve-\d{4}-\d{4,}|ghsa-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|vulnerabilit(?:y|ies)|security advisor(?:y|ies)|osv (?:finding|alert)s?)\b/i;

// A category `security` may override. A breaking change stays breaking (it is
// the higher-risk signal and the one the operator must not lose), and a commit
// we could not parse stays honest as `other`.
const PROMOTABLE: ReadonlySet<ParsedCommit["category"]> = new Set([
  "fix",
  "dependency",
  "maintenance",
  "feature",
]);

function isSecurity(commit: ParsedCommit, pr: PrEnrichment | undefined): boolean {
  if (pr) {
    for (const label of pr.labels) {
      if (SECURITY_LABELS.has(label)) return true;
    }
    if (pr.title && SECURITY_TEXT_RE.test(pr.title)) return true;
    if (pr.body && SECURITY_TEXT_RE.test(pr.body)) return true;
  }
  return SECURITY_TEXT_RE.test(commit.description);
}

/**
 * Apply PR-derived evidence to the subject-derived categories. Returns a new
 * array; input is not mutated. Counts MUST be taken from the output of this
 * pass, not from `parseCommits`, or the headline and the badges disagree.
 */
export function refineCategories(
  commits: ParsedCommit[],
  enrichmentByPr: Map<number, PrEnrichment>,
): ParsedCommit[] {
  return commits.map((commit) => {
    if (!PROMOTABLE.has(commit.category)) return commit;
    const pr = commit.prNumber != null ? enrichmentByPr.get(commit.prNumber) : undefined;
    if (!isSecurity(commit, pr)) return commit;
    return { ...commit, category: "security" };
  });
}
