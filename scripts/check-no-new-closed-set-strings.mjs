#!/usr/bin/env node
// Closed-set string ratchet — BI-817ED2D4 (Simplify & Strengthen W4,
// architecture pass 2026-08-16 §3.2-a).
//
// AGENTS.md §8: closed-set string fields are typed enums, never free-form
// strings. This guard freezes the residual violation set in a shrink-only
// baseline (sibling pattern: check-fk-index-coverage.mjs).
//
// A String column in packages/db/prisma/schema.prisma is a CANDIDATE when
// either:
//   - its name ends in one of the closed-set suffixes (Status/State/Kind/Type,
//     case-insensitive — configurable via CLOSED_SET_SUFFIXES), or
//   - its same-line comment documents a closed set in `// a | b | c` form.
//
// A candidate is COMPLIANT (not a violation) when:
//   (a) its Prisma type is a declared enum (then it isn't a String at all), or
//   (b) a committed migration this guard can see adds a
//       `"<Table>_<column>_closed_set"` CHECK constraint for it (the
//       expand→contract holding state — new writes enforced, enum flip
//       pending; see docs/superpowers/plans/2026-08-16-enum-contract-step-proposal.md), or
//   (c) it is in the owned baseline (scripts/closed-set-strings-baseline.json,
//       owner platform-architecture, expiry-dated — an expired baseline fails
//       until deliberately re-reviewed).
//
// A NEW violation beyond the baseline fails; a shrink passes and reports so
// the author retightens with --update in the same PR.
//
//   node scripts/check-no-new-closed-set-strings.mjs            # check (CI)
//   node scripts/check-no-new-closed-set-strings.mjs --update   # retighten

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
export const SCHEMA_PATH = join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
export const MIGRATIONS_DIR = join(REPO_ROOT, "packages", "db", "prisma", "migrations");
export const BASELINE_PATH = join(REPO_ROOT, "scripts", "closed-set-strings-baseline.json");

// Configurable suffix list (brief: *Status / *State / *Kind / *Type). Matched
// case-insensitively against the END of the field name, so both `status` and
// `claimStatus` match.
export const CLOSED_SET_SUFFIXES = Object.freeze(["status", "state", "kind", "type"]);

// `// a | b | c` — at least one pipe between word-ish tokens. Quoted variants
// (`// "a" | "b"`) count too.
const CLOSED_SET_COMMENT_RE = /\/\/.*?"?[\w-]+"?\s*\|\s*"?[\w-]+"?/;

/**
 * Parse schema.prisma into models (with @@map-resolved table names and
 * same-line field comments) plus the set of declared enum names.
 */
export function parseSchema(source) {
  const enumNames = new Set();
  for (const m of source.matchAll(/^enum\s+(\w+)\s+\{/gm)) enumNames.add(m[1]);

  const models = [];
  const modelRe = /^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm;
  let match;
  while ((match = modelRe.exec(source))) {
    const [, name, body] = match;
    let tableName = name;
    const fields = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("///")) continue;
      const map = line.match(/^@@map\("([^"]+)"\)/);
      if (map) {
        tableName = map[1];
        continue;
      }
      if (line.startsWith("@@")) continue;
      const commentIdx = line.indexOf("//");
      const decl = commentIdx === -1 ? line : line.slice(0, commentIdx);
      const comment = commentIdx === -1 ? "" : line.slice(commentIdx);
      const field = decl.match(/^(\w+)\s+([A-Za-z_]\w*)(\[\])?(\?)?(\s|$)/);
      if (!field) continue;
      fields.push({
        name: field[1],
        type: field[2],
        isList: field[3] === "[]",
        comment,
      });
    }
    models.push({ name, tableName, fields });
  }
  return { models, enumNames };
}

/**
 * Columns governed by a `"<Table>_<column>_closed_set"` CHECK constraint in
 * any committed migration. Returns a Set of "Table.column".
 */
export function parseCheckCoveredColumns(migrationTexts) {
  const covered = new Set();
  const re = /ADD\s+CONSTRAINT\s+"([A-Za-z0-9_]+)_closed_set"\s+CHECK/gi;
  for (const sql of migrationTexts) {
    for (const m of sql.matchAll(re)) {
      const conName = m[1]; // "<Table>_<column>"
      const us = conName.lastIndexOf("_");
      if (us <= 0) continue;
      covered.add(`${conName.slice(0, us)}.${conName.slice(us + 1)}`);
    }
  }
  return covered;
}

export function isClosedSetCandidate(field, suffixes = CLOSED_SET_SUFFIXES) {
  if (field.type !== "String" || field.isList) return false;
  const lower = field.name.toLowerCase();
  if (suffixes.some((s) => lower.endsWith(s))) return true;
  return CLOSED_SET_COMMENT_RE.test(field.comment);
}

/** All violations (before baseline): sorted "Model.field" keys. */
export function computeViolations({ models, enumNames }, checkCovered, suffixes = CLOSED_SET_SUFFIXES) {
  void enumNames; // enum-typed fields already fail the `type === "String"` test
  const out = [];
  for (const model of models) {
    for (const field of model.fields) {
      if (!isClosedSetCandidate(field, suffixes)) continue;
      if (checkCovered.has(`${model.tableName}.${field.name}`)) continue;
      out.push(`${model.name}.${field.name}`);
    }
  }
  return out.sort();
}

export function validateBaseline(baseline, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const failures = [];
  if (baseline?.version !== 1) failures.push("Baseline version must be 1.");
  if (!baseline?.owner?.trim()) failures.push("Baseline requires an owner.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline?.expiry ?? "")) {
    failures.push("Baseline requires expiry in YYYY-MM-DD form.");
  } else if (baseline.expiry < today) {
    failures.push(
      `Baseline expired on ${baseline.expiry} — re-review the residual closed-set strings and deliberately extend the expiry.`,
    );
  }
  if (!Array.isArray(baseline?.entries)) failures.push("Baseline entries must be an array.");
  return failures;
}

export function evaluateRatchet(current, baselined) {
  const baseSet = new Set(baselined);
  const currentSet = new Set(current);
  return {
    newViolations: current.filter((k) => !baseSet.has(k)),
    stale: baselined.filter((k) => !currentSet.has(k)),
  };
}

export function runCheck({ schemaSource, migrationTexts, baseline, today }) {
  const schema = parseSchema(schemaSource);
  const checkCovered = parseCheckCoveredColumns(migrationTexts);
  const violations = computeViolations(schema, checkCovered);
  const baselineFailures = validateBaseline(baseline, today ? { today } : {});
  if (baselineFailures.length) return { ok: false, baselineFailures, violations };
  const ratchet = evaluateRatchet(violations, baseline.entries);
  return { ok: ratchet.newViolations.length === 0, baselineFailures: [], violations, ratchet };
}

function readMigrationTexts() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const texts = [];
  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(MIGRATIONS_DIR, entry.name, "migration.sql");
    if (existsSync(file)) texts.push(readFileSync(file, "utf8"));
  }
  return texts;
}

function main() {
  const schemaSource = readFileSync(SCHEMA_PATH, "utf8");
  const migrationTexts = readMigrationTexts();

  if (process.argv.includes("--update")) {
    let owner = "platform-architecture";
    let expiry = "2026-11-16";
    try {
      const existing = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
      owner = existing.owner ?? owner;
      expiry = existing.expiry ?? expiry;
    } catch {
      // first write — defaults above
    }
    const schema = parseSchema(schemaSource);
    const baseline = {
      version: 1,
      owner,
      expiry,
      note:
        "Closed-set string ratchet baseline (BI-817ED2D4). Shrink-only: a closed-set column leaves this list by becoming an enum or gaining a *_closed_set CHECK, never by expanding the baseline. Regenerate with: node scripts/check-no-new-closed-set-strings.mjs --update",
      entries: computeViolations(schema, parseCheckCoveredColumns(migrationTexts)),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote closed-set string baseline: ${baseline.entries.length} residual columns.`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      "Missing/unreadable scripts/closed-set-strings-baseline.json — run: node scripts/check-no-new-closed-set-strings.mjs --update",
    );
    process.exit(1);
  }

  const result = runCheck({ schemaSource, migrationTexts, baseline });
  if (result.baselineFailures.length) {
    console.error("Closed-set string baseline is invalid:");
    for (const f of result.baselineFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error("Closed-set string ratchet failed (BI-817ED2D4, AGENTS.md §8).\n");
    console.error("NEW closed-set String columns (make each a Prisma enum, or — for a");
    console.error("long-lived column whose fleet values may drift — add a NOT VALID");
    console.error('CHECK named "<Table>_<column>_closed_set" in the same migration):');
    for (const k of result.ratchet.newViolations) console.error(`  - ${k}`);
    console.error("\nDo not expand the baseline without an owned data-architecture decision.");
    process.exit(1);
  }

  if (result.ratchet.stale.length > 0) {
    console.warn(
      `Closed-set string debt shrank by ${result.ratchet.stale.length} — retighten the baseline in this PR with --update:`,
    );
    for (const k of result.ratchet.stale) console.warn(`  - ${k}`);
  }
  console.log(
    `Closed-set strings OK — ${result.violations.length} residual (budget ${baseline.entries.length}), ` +
      `owner ${baseline.owner}, review by ${baseline.expiry}.`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
