#!/usr/bin/env node
/**
 * BI-REFACTOR-CC46703A — CI ratchet: the "no-seventh-finding-table guard".
 *
 * The architect-reviewed Assurance Ledger spec
 * (docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md
 * §3.3) identified six existing finding-shaped models with overlapping
 * lifecycle semantics, then Phase 1 landed a seventh (`AssuranceFinding`).
 * The spec's exit criterion (§3.3, §9) requires that before ANY further
 * finding-shaped model is introduced, Phase 2 must EITHER unify
 * `AssuranceFinding` with `AuditFinding` (extract a shared `Finding` base)
 * OR carry an explicit dated owner and a no-seventh-finding-table guard.
 *
 * The unify decision is a founder-reserved architecture call and is NOT made
 * here. This script is the GUARD half of that fallback: it freezes the known
 * set of finding-shaped models and fails CI when a NEW one is added without an
 * explicit decision. It mirrors DPF's existing ratchet pattern
 * (scripts/check-module-size.mjs + baseline, scripts/check-no-local-isrecord.mjs).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Guard owner / dated-deferral (spec §3.3 fallback):
 *   Owner:  founder (markbodman)
 *   Dated:  2026-07-16
 *   State:  Phase-2 finding-substrate unify decision PENDING. Until it lands,
 *           this guard is the sanctioned "no-seventh-finding-table" backstop
 *           per BI-REFACTOR-CC46703A. It prevents an EIGHTH finding table from
 *           silently landing while the unify vs. keep decision is open.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * How it works: parse packages/db/prisma/schema/*.prisma for `model <Name> {`
 * declarations, flag any model whose name matches the finding-shape suffix
 * (`Finding` | `Issue` | `Report`) that is NOT in the explicit ALLOWLIST.
 * The allowlist is curated (not a pure heuristic) so unrelated suffix
 * collisions don't false-positive — those live in SUFFIX_COLLISION_EXCLUSIONS.
 *
 * Run: node scripts/check-finding-substrate.mjs
 */
import { readFileSync } from "node:fs";
import { readPrismaSchemaText } from "./lib/prisma-schema-source.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SCRIPTS_DIR, "..");
export const SCHEMA_DIR = "packages/db/prisma/schema";

// The frozen set of finding-shaped models — the six named in spec §3.3 plus
// the seventh (AssuranceFinding) that Phase 1 landed. One comment per entry
// naming what each carries. A NEW model whose name ends in Finding/Issue/Report
// that is NOT here fails the guard: either unify it into AuditFinding, or, if a
// new table is genuinely justified, add it here AND record the decision per
// BI-REFACTOR-CC46703A / Assurance Ledger spec §3.3.
export const ALLOWLIST = new Set([
  "PortfolioQualityIssue", // Portfolio quality reports (severity/status/ownership/affected object)
  "AuditFinding", // Compliance audit findings (status/severity/evidence link/control linkage)
  "WikiLintFinding", // Wiki/documentation lint findings (status/severity/normalized run output)
  "EaConformanceIssue", // Enterprise-architecture conformance issues (severity/owner/lifecycle)
  "LicenseReadinessIssue", // Licensing-readiness issues (severity/status/evidence)
  "PlatformIssueReport", // Cross-platform issue intake (status/owner/severity)
  "AssuranceFinding", // Supply-chain + fleet assurance findings — Phase 1, the seventh (spec §5)
]);

// Models whose name ENDS in a finding suffix but which are NOT part of the
// finding substrate the spec §3.3 governs. These are genuine naming collisions
// and are intentionally excluded so the guard stays precise. Grep-verified
// against schema.prisma; add here (with a reason) only for a real collision.
export const SUFFIX_COLLISION_EXCLUSIONS = new Set([
  // Tax-obligation issue tied to OrganizationTaxProfile / TaxRegistration —
  // a tax-domain compliance record, not a discovery/audit/assurance finding.
  "TaxIssue",
]);

// A finding-shape suffix: the naming convention every finding-shaped model in
// the schema follows.
export const FINDING_SUFFIX_RE = /(?:Finding|Issue|Report)$/;

/** Every `model <Name> {` declaration name in a Prisma schema string. */
export function extractModelNames(schema) {
  const names = [];
  const re = /^\s*model\s+([A-Za-z_]\w*)\s*\{/gm;
  let m;
  while ((m = re.exec(schema)) !== null) names.push(m[1]);
  return names;
}

/**
 * Names in `schema` that look finding-shaped (suffix match) but are neither in
 * the ALLOWLIST nor the SUFFIX_COLLISION_EXCLUSIONS — i.e. a new finding-shaped
 * table that slipped in without a decision. Pure function of the schema string.
 */
export function findFindingShapedViolations(schema) {
  return extractModelNames(schema).filter(
    (name) =>
      FINDING_SUFFIX_RE.test(name) &&
      !ALLOWLIST.has(name) &&
      !SUFFIX_COLLISION_EXCLUSIONS.has(name),
  );
}

/** ALLOWLIST entries no longer present in the schema (unified/removed → prune). */
export function findStaleAllowlist(schema) {
  const present = new Set(extractModelNames(schema));
  return [...ALLOWLIST].filter((name) => !present.has(name));
}

/** SUFFIX_COLLISION_EXCLUSIONS entries no longer present in the schema. */
export function findStaleExclusions(schema) {
  const present = new Set(extractModelNames(schema));
  return [...SUFFIX_COLLISION_EXCLUSIONS].filter((name) => !present.has(name));
}

export function readSchema(root = REPO_ROOT) {
  return readPrismaSchemaText(root);
}

function main() {
  const schema = readSchema();
  const violations = findFindingShapedViolations(schema);
  const staleAllow = findStaleAllowlist(schema);
  const staleExcl = findStaleExclusions(schema);

  if (violations.length > 0) {
    console.error("");
    console.error(
      "ERROR: BI-REFACTOR-CC46703A — a NEW finding-shaped model was added.",
    );
    console.error("");
    console.error("New finding-shaped table(s):");
    for (const v of violations) console.error(`  model ${v}`);
    console.error("");
    console.error("The finding substrate is frozen pending the Phase-2 unify");
    console.error("decision. Do ONE of:");
    console.error(
      "  1. Unify this data into an existing finding model (AuditFinding), OR",
    );
    console.error(
      "  2. If a new table is genuinely justified, add the model to ALLOWLIST",
    );
    console.error(
      "     in scripts/check-finding-substrate.mjs AND record the decision per",
    );
    console.error(
      "     BI-REFACTOR-CC46703A / the Assurance Ledger spec §3.3 (docs/superpowers/",
    );
    console.error(
      "     specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md).",
    );
    console.error("");
    process.exit(1);
  }

  const stale = [...staleAllow, ...staleExcl];
  if (stale.length > 0) {
    console.error("");
    console.error(
      "ERROR: BI-REFACTOR-CC46703A — the finding-substrate allowlist is stale.",
    );
    console.error(
      "These models are listed but no longer exist in schema.prisma",
    );
    console.error(
      "(unified or removed — the good outcome). Remove them from ALLOWLIST /",
    );
    console.error(
      "SUFFIX_COLLISION_EXCLUSIONS in scripts/check-finding-substrate.mjs:",
    );
    for (const s of stale) console.error(`  ${s}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ Finding substrate frozen — ${ALLOWLIST.size} known finding-shaped models, ` +
      `${SUFFIX_COLLISION_EXCLUSIONS.size} suffix-collision exclusion(s), no eighth table.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
