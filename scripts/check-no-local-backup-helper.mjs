#!/usr/bin/env node
/**
 * BI-B72328D5 (EP-8DC217EB BET-11) — CI ratchet: no NEW local backup-runner
 * helpers, inline backup heartbeat blocks, or stray backup/restore
 * Prometheus registrations.
 *
 * The six backup/restore runners under apps/web/lib/operate/backups each
 * carried byte-identical (or engine-token-swapped) copies of
 * `isoTsForDirectory`, `nextDailyRunAt`, `applyRetention` and
 * `summarizeFailure`, plus three inline `prisma.scheduledJob.update`
 * heartbeat blocks apiece. They now have exactly two canonical homes:
 *
 *   apps/web/lib/operate/backups/managed-backup.ts   (backup lifecycle)
 *   apps/web/lib/operate/backups/managed-restore.ts  (restore lifecycle)
 *
 * and every `dpf_*_backup_*` / `dpf_*_restore_*` Prometheus metric is
 * registered ONLY in apps/web/lib/operate/metrics.ts (dashboards depend on
 * those names; new engines add spec entries, not new registrations).
 *
 * The migration completed in one PR, so there is NO allowlist: any new copy
 * anywhere in apps/web/lib fails CI.
 *
 * Three rules:
 *   1. helper-definition — a local definition (function decl / const arrow)
 *      of one of the canonical helper names anywhere in apps/web/lib outside
 *      the canonical files.
 *   2. inline-heartbeat — a `scheduledJob.update(` call inside
 *      apps/web/lib/operate/backups outside the canonical files (the shared
 *      `recordJobHeartbeat` is the only sanctioned writer there; heartbeats
 *      for OTHER jobs elsewhere in the tree are out of scope).
 *   3. stray-metric — a `name: "dpf_..._backup_..."` (or `_restore_`)
 *      Prometheus registration outside apps/web/lib/operate/metrics.ts.
 *
 * Run: node scripts/check-no-local-backup-helper.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// The two sanctioned homes for the shared backup/restore lifecycle helpers.
export const CANONICAL_HELPER_FILES = new Set([
  "apps/web/lib/operate/backups/managed-backup.ts",
  "apps/web/lib/operate/backups/managed-restore.ts",
]);

// The one sanctioned home for backup/restore Prometheus registrations.
export const CANONICAL_METRICS_FILE = "apps/web/lib/operate/metrics.ts";

// Directory where the inline-heartbeat rule applies (the dedup boundary).
export const HEARTBEAT_SCOPE = "apps/web/lib/operate/backups/";

// Migration is complete — intentionally empty. Do NOT add entries; import
// the shared helpers from managed-backup.ts / managed-restore.ts instead.
export const ALLOWLIST = new Set([]);

const HELPER_NAMES =
  "(?:isoTsForDirectory|nextDailyRunAt|applyRetention|summarizeFailure|summarizeScriptFailure|recordJobHeartbeat)";

// A local helper DEFINITION (function decl or const arrow), not a call site
// or an import.
export const DEFINITION_PATTERNS = [
  new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${HELPER_NAMES}\\s*\\(`),
  new RegExp(`\\b(?:export\\s+)?const\\s+${HELPER_NAMES}\\s*[:=]`),
];

// Inline heartbeat write: `scheduledJob.update(` — possibly split across
// lines (`prisma.scheduledJob\n  .update({`) as the original runners did.
export const HEARTBEAT_PATTERN = /\bscheduledJob\s*(?:\r?\n\s*)?\.\s*update\s*\(/g;

// A backup/restore Prometheus registration: `name: "dpf_..._backup_..."`.
export const METRIC_NAME_PATTERN =
  /name:\s*["'`]dpf_[a-z0-9_]*(?:backup|restore)[a-z0-9_]*["'`]/g;

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** 1-based line numbers + text of every local helper definition in `body`. */
export function findHelperDefinitionLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    // `import { nextDailyRunAt } from ...` is the sanctioned adoption.
    if (/^\s*import\b/.test(line)) continue;
    if (DEFINITION_PATTERNS.some((p) => p.test(line))) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

/** 1-based line numbers of every match of a body-level regex in `body`. */
export function findBodyPatternLines(body, pattern) {
  const hits = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  for (let m = re.exec(body); m !== null; m = re.exec(body)) {
    const upTo = body.slice(0, m.index);
    const line = upTo.split(/\r?\n/).length;
    const lineText = body.split(/\r?\n/)[line - 1] ?? "";
    if (isCommentLine(lineText)) continue;
    hits.push({ line, text: lineText.trim() || m[0].replace(/\s+/g, " ") });
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
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

/** Scan apps/web/lib under `root`; return all rule violations. */
export function scanRepo(root = process.cwd()) {
  const scanDir = join(root, "apps", "web", "lib");
  const violations = [];
  for (const file of walk(scanDir)) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (ALLOWLIST.has(rel)) continue;
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (!CANONICAL_HELPER_FILES.has(rel)) {
      for (const h of findHelperDefinitionLines(body)) {
        violations.push({ rule: "helper-definition", file: rel, ...h });
      }
      if (rel.startsWith(HEARTBEAT_SCOPE)) {
        for (const h of findBodyPatternLines(body, HEARTBEAT_PATTERN)) {
          violations.push({ rule: "inline-heartbeat", file: rel, ...h });
        }
      }
    }

    if (rel !== CANONICAL_METRICS_FILE) {
      for (const h of findBodyPatternLines(body, METRIC_NAME_PATTERN)) {
        violations.push({ rule: "stray-metric", file: rel, ...h });
      }
    }
  }
  return violations;
}

function main() {
  const violations = scanRepo();

  if (violations.length > 0) {
    console.error("");
    console.error(
      "ERROR: BI-B72328D5 — a NEW local backup helper / inline heartbeat / stray backup metric was added.",
    );
    console.error("");
    console.error("The backup/restore lifecycle has exactly two canonical homes:");
    console.error("  apps/web/lib/operate/backups/managed-backup.ts");
    console.error("  apps/web/lib/operate/backups/managed-restore.ts");
    console.error("Import the shared helpers (isoTsForDirectory, nextDailyRunAt,");
    console.error("applyRetention, summarizeScriptFailure, recordJobHeartbeat) from");
    console.error("there instead of re-defining them, and register backup/restore");
    console.error("Prometheus metrics only in apps/web/lib/operate/metrics.ts.");
    console.error("");
    console.error("Offending lines:");
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}:${v.line}  ${v.text}`);
    }
    console.error("");
    process.exit(1);
  }

  console.log(
    "✓ No new local backup helpers, inline backup heartbeats, or stray backup/restore metric registrations.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
