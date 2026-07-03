#!/usr/bin/env node
//
// migration-safety-guard.mjs — block a NEW Prisma migration that adds a
// "tightening" constraint which is valid against a clean schema but can FAIL
// against real fleet data (pre-existing rows that violate it).
//
// Why this exists (EP-056D2A5E / BI-5B3FA415, 2026-07-03): migrations are
// forward-only and the self-upgrade promoter is fail-closed (migrate runs
// pre-swap under `set -e`). A tightening migration that fails on existing data
// does not brick, but it WEDGES the forward-only chain — the busiest installs
// (most data) freeze on the old version and stop receiving all future updates.
// PR #2554 shipped exactly this (an EXCLUDE constraint with no remediation).
// The existing schema-regression-guard only catches REMOVALS, never risky
// ADDITIONS — this closes that gap.
//
// What it flags in a NEW migration.sql:
//   - ADD CONSTRAINT ... (UNIQUE | EXCLUDE | CHECK | FOREIGN KEY | PRIMARY KEY)
//   - ADD (UNIQUE | EXCLUDE | CHECK | FOREIGN KEY | PRIMARY KEY)  (unnamed)
//   - CREATE UNIQUE INDEX
//   - ALTER COLUMN ... SET NOT NULL
//   - ADD COLUMN ... NOT NULL   (without a DEFAULT — PG backfills a DEFAULT)
//
// What makes a tightening statement SAFE (no flag):
//   1. NOT VALID on the statement (FK/CHECK deferred validation)
//   2. The target table is CREATE TABLE'd earlier in the SAME migration
//      (a fresh table cannot hold violating rows)
//   3. In-file remediation of the same table earlier in the migration
//      (DELETE/UPDATE/INSERT or a DO $$ … $$ block referencing the table)
//   4. An explicit attestation the author consciously added:
//        -- @migration-safety: <status>: <reason>
//      status ∈ data-safe | remediated | expand-contract | reviewed
//      (file-level, or on the line immediately preceding the statement)
//
// The attestation is the pressure valve: the guard never hard-blocks a
// legitimately-safe migration, it forces the author to either remediate or
// consciously assert (with a reason, creating an audit trail) that the data is
// safe. That is the discipline — enforced, not memory (AGENTS.md §11).
//
// Usage:   node packages/db/scripts/migration-safety-guard.mjs <base-ref>
// Exit:    0 no risky-unattested migrations · 1 at least one · 2 invocation error
//
// Wired into:
//   - .github/workflows/migration-safety-guard.yml (CI)
//   - .githooks/pre-commit Guard 7 (local, when a migration.sql is staged)
//   - packages/db/scripts/migration-safety-guard.test.ts (vitest)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = "packages/db/prisma/migrations";

// ─── SQL utilities ───────────────────────────────────────────────────────────

/** Strip -- line comments and /* *​/ block comments (for DDL detection). */
export function stripComments(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      out += " ";
      i = nl; // keep the newline
    } else if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      out += " ";
      i = end === -1 ? n : end + 2;
    } else if (sql[i] === "'") {
      // copy a single-quoted string verbatim (handles '' escape)
      out += sql[i++];
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
    } else {
      out += sql[i++];
    }
  }
  return out;
}

/**
 * Split SQL into top-level statements on `;`, respecting dollar-quoted blocks
 * ($$ … $$ / $tag$ … $tag$) and single-quoted strings. Comment-stripped input
 * expected. Returns array of { text, start } with start = char offset in input.
 */
export function splitStatements(sql) {
  const stmts = [];
  let i = 0;
  const n = sql.length;
  let start = 0;
  let dollarTag = null;
  let inString = false;
  while (i < n) {
    if (inString) {
      if (sql[i] === "'") inString = false;
      i++;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }
    if (sql[i] === "'") {
      inString = true;
      i++;
      continue;
    }
    const dq = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
    if (dq) {
      dollarTag = dq[0];
      i += dollarTag.length;
      continue;
    }
    if (sql[i] === ";") {
      const text = sql.slice(start, i);
      if (text.trim()) stmts.push({ text, start });
      i++;
      start = i;
      continue;
    }
    i++;
  }
  const tail = sql.slice(start);
  if (tail.trim()) stmts.push({ text: tail, start });
  return stmts;
}

const RISKY = [
  { re: /\bADD\s+CONSTRAINT\s+"?[\w-]+"?\s+(UNIQUE|EXCLUDE|CHECK|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i, kind: "ADD CONSTRAINT" },
  { re: /\bADD\s+(UNIQUE|EXCLUDE|CHECK|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i, kind: "ADD constraint (unnamed)" },
  { re: /\bCREATE\s+UNIQUE\s+INDEX\b/i, kind: "CREATE UNIQUE INDEX" },
  { re: /\bALTER\s+COLUMN\s+"?[\w-]+"?\s+SET\s+NOT\s+NULL\b/i, kind: "SET NOT NULL" },
];

function tableOf(stmt) {
  const m =
    /\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?"?([\w-]+)"?/i.exec(stmt) ||
    /\bON\s+"?([\w-]+)"?/i.exec(stmt) || // CREATE UNIQUE INDEX ... ON "T"
    /\bINDEX\s+.*\bON\s+"?([\w-]+)"?/i.exec(stmt);
  return m ? m[1] : null;
}

/** Analyse one migration's SQL. Returns array of unattested risky findings. */
export function analyzeMigration(rawSql) {
  const withComments = rawSql;
  const sql = stripComments(rawSql);
  const stmts = splitStatements(sql);

  // Tables created within this migration (fresh → cannot hold violating rows).
  const createdTables = new Set();
  for (const s of stmts) {
    const m = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w-]+)"?/i.exec(s.text);
    if (m) createdTables.add(m[1]);
  }

  // File-level attestation marker anywhere in the (raw) file.
  const fileMarker = /--\s*@migration-safety:\s*(data-safe|remediated|expand-contract|reviewed)\b/i.test(
    withComments,
  );

  // Remediation statements keyed by table, with their offset, so we only count
  // remediation that appears BEFORE the risky statement.
  const remediations = []; // { table, start }
  for (const s of stmts) {
    const dml = /\b(DELETE\s+FROM|UPDATE|INSERT\s+INTO)\s+"?([\w-]+)"?/i.exec(s.text);
    if (dml) remediations.push({ table: dml[2], start: s.start });
    if (/\bDO\s+\$/i.test(s.text)) {
      // DO block is opaque; record every table it references textually.
      for (const t of s.text.matchAll(/"([\w-]+)"/g)) remediations.push({ table: t[1], start: s.start });
    }
  }

  const findings = [];
  for (const s of stmts) {
    const hit = RISKY.find((r) => r.re.test(s.text));
    if (!hit) continue;
    if (/\bNOT\s+VALID\b/i.test(s.text)) continue; // deferred validation
    const table = tableOf(s.text);
    if (table && createdTables.has(table)) continue; // fresh table
    if (table && remediations.some((r) => r.table === table && r.start < s.start)) continue;

    // Per-statement attestation: marker on the line(s) immediately preceding.
    const before = withComments.slice(Math.max(0, s.start - 240), s.start + 40);
    const localMarker = /--\s*@migration-safety:\s*(data-safe|remediated|expand-contract|reviewed)\b/i.test(before);
    if (fileMarker || localMarker) continue;

    findings.push({
      kind: hit.kind,
      table: table || "(unknown)",
      snippet: s.text.trim().replace(/\s+/g, " ").slice(0, 120),
    });
  }
  return findings;
}

// ─── ADD COLUMN … NOT NULL without DEFAULT (separate pass — column-level) ────
export function analyzeAddColumnNotNull(rawSql) {
  const sql = stripComments(rawSql);
  const findings = [];
  for (const s of splitStatements(sql)) {
    for (const m of s.text.matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w-]+)"?[^,;]*/gi)) {
      const clause = m[0];
      if (/\bNOT\s+NULL\b/i.test(clause) && !/\bDEFAULT\b/i.test(clause)) {
        const withComments = rawSql;
        const fileMarker = /--\s*@migration-safety:\s*(data-safe|remediated|expand-contract|reviewed)\b/i.test(withComments);
        if (fileMarker) continue;
        findings.push({ kind: "ADD COLUMN NOT NULL (no DEFAULT)", table: tableOf(s.text) || "(unknown)", snippet: clause.trim().replace(/\s+/g, " ").slice(0, 120) });
      }
    }
  }
  return findings;
}

// ─── driver ──────────────────────────────────────────────────────────────────
function main() {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error("Usage: node packages/db/scripts/migration-safety-guard.mjs <base-ref>");
    process.exit(2);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

  // New migration.sql files = present in working tree but absent at base ref.
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", `${MIGRATIONS_DIR}/**/migration.sql`], {
      cwd: repoRoot, encoding: "utf8",
    }).split("\n").filter(Boolean);
  } catch (err) {
    console.error(`❌ git ls-files failed: ${err.message.split("\n")[0]}`);
    process.exit(2);
  }

  const newFiles = tracked.filter((f) => {
    try {
      execFileSync("git", ["cat-file", "-e", `${baseRef}:${f}`], { cwd: repoRoot, stdio: "ignore" });
      return false; // exists at base → not new
    } catch {
      return true; // absent at base → new migration
    }
  });

  const flagged = [];
  for (const f of newFiles) {
    let sql;
    try {
      sql = readFileSync(resolve(repoRoot, f), "utf8");
    } catch {
      continue;
    }
    const findings = [...analyzeMigration(sql), ...analyzeAddColumnNotNull(sql)];
    if (findings.length) flagged.push({ file: f, findings });
  }

  if (flagged.length === 0) {
    console.log("✅ No unattested tightening migrations detected.");
    process.exit(0);
  }

  console.error("❌ Migration safety: tightening DDL without remediation or attestation.");
  console.error("");
  console.error("A constraint that is valid on a clean schema can FAIL on an install that");
  console.error("already holds violating rows, wedging its forward-only self-upgrade.");
  console.error("");
  for (const { file, findings } of flagged) {
    console.error(`  ${file}`);
    for (const fd of findings) {
      console.error(`    • ${fd.kind} on "${fd.table}" — ${fd.snippet}`);
    }
  }
  console.error("");
  console.error("Resolve each by ONE of:");
  console.error("  1. Remediate in the SAME migration BEFORE the constraint (idempotent");
  console.error("     DELETE/UPDATE or a DO $$ block — see the three precedents in AGENTS.md §11).");
  console.error("  2. Split expand→contract across two releases (loose+backfill now, tighten later).");
  console.error("  3. Add NOT VALID (FK/CHECK) and validate in a later release.");
  console.error("  4. If genuinely data-safe, attest with a reason (creates the audit trail):");
  console.error("       -- @migration-safety: data-safe: <why no existing row can violate this>");
  console.error("");
  process.exit(1);
}

// Only run when invoked directly (not when imported by the test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
