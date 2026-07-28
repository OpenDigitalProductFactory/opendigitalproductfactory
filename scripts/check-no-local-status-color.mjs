#!/usr/bin/env node
/**
 * BI-81EE4A46 (EP-8DC217EB, plan §6) — CI ratchet: no NEW local status→color map.
 *
 * The kernel principle `compose-report-kit-for-reporting-ux` (AGENTS.md §12)
 * says status/severity colors resolve through ONE registry —
 * `apps/web/components/ui/report-kit/statusColors.ts` (status → semantic
 * `Intent` → `--dpf-*` token) — surfaced via `<StatusBadge domain=… status=…>`,
 * never a per-file `Record<Status, Intent>` (or raw color) map that silently
 * drifts from the palette.
 *
 * This is a RATCHET, not a mass-rewrite mandate (same shape as
 * check-no-local-isrecord): a file that ALREADY defines a local
 * `Record<…, Intent>` status map at the baseline is in ALLOWLIST (a migration
 * backlog — delete the entry when it moves onto the registry). A NEW local
 * status→Intent map outside the allowlist fails CI.
 *
 * Scope: apps/web/lib + apps/web/components (source only, tests excluded).
 * report-kit itself IS the canonical palette home (its VARIANT_INTENT etc. are
 * the registry internals) and is skipped by path.
 *
 * Run: node scripts/check-no-local-status-color.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// The canonical palette home — its own Intent maps ARE the registry.
export const CANONICAL_DIR = "apps/web/components/ui/report-kit";

// Files that ALREADY defined a local status→Intent map at the BI-81EE4A46
// baseline. Migration backlog: delete an entry when its file resolves colors
// through <StatusBadge domain=… status=…> / statusColors instead. Do NOT add
// new entries — new reporting UI composes the registry.
export const ALLOWLIST = new Set([
  "apps/web/lib/storefront/composition-view.ts",
  "apps/web/components/portal/PortalWorkCases.tsx",
  "apps/web/components/portal/PortalWorkCaseDetail.tsx",
  "apps/web/components/platform/development/change-lanes/ChangeLaneStatusBadge.tsx",
  "apps/web/components/platform/coworker-record/ProfessionCorpusPanel.tsx",
  "apps/web/components/customer/crmToneIntent.ts",
]);

// A local `Record<…, Intent>` map definition (const or exported const). The
// value type `Intent` is the report-kit semantic-color type; a map keyed by a
// status/state/tone string onto it is the anti-pattern.
export const DEFINITION_PATTERN = /\b(?:export\s+)?const\s+\w+\s*:\s*Record<[^>]*,\s*Intent>\s*=/;

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** 1-based line numbers + text of every local Record<…, Intent> map definition. */
export function findDefinitionLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (/^\s*import\b/.test(line)) continue;
    if (DEFINITION_PATTERN.test(line)) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "__snapshots__" || entry === "dist") continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx") || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

/** Scan lib + components; return definitions outside the allowlist / canonical dir. */
export function scanRepo(root = process.cwd()) {
  const violations = [];
  for (const base of [join(root, "apps", "web", "lib"), join(root, "apps", "web", "components")]) {
    for (const file of walk(base)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel.startsWith(CANONICAL_DIR) || ALLOWLIST.has(rel)) continue;
      let body;
      try {
        body = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const h of findDefinitionLines(body)) violations.push({ file: rel, ...h });
    }
  }
  return violations;
}

/** Allowlisted files that no longer define a local status→Intent map. */
export function findStaleAllowlist(root = process.cwd()) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel);
      continue;
    }
    if (findDefinitionLines(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-81EE4A46 — a NEW local status→color (Record<…, Intent>) map was added.");
    console.error("");
    console.error("Status/severity colors resolve through ONE registry. Instead of a local map, use:");
    console.error('  <StatusBadge domain="<yourDomain>" status={value} />   // report-kit statusColors');
    console.error("or add your domain to report-kit/statusColors.ts if it is genuinely new.");
    console.error("");
    console.error("Offending definitions:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-81EE4A46 — the status-color allowlist is stale.");
    console.error("These files no longer define a local Record<…, Intent> map (migrated or removed);");
    console.error("delete them from ALLOWLIST in scripts/check-no-local-status-color.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No new local status→color maps (${ALLOWLIST.size} pre-existing maps pending migration to report-kit statusColors).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
