#!/usr/bin/env node
// scripts/check-spec-status-frontmatter.mjs
//
// BI-79BCE3F2 (Simplify & Strengthen W8, pass §3.5 / §4-P2) — ONE status &
// supersession convention for the spec/plan corpus.
//
// THE PROBLEM IT FIXES: ~654 specs + ~784 plans carried status in ≥4 free-text
// formats; exactly one spec was marked binding while the doctrine it anchors
// said DRAFT; supersession was free prose in four shapes, so superseded specs
// sat unmarked in the active directory and every reader had to re-derive which
// document wins. Generations coexisted because retirement had no mechanical
// form (pass §4-P2: "supersession must become a mechanical act").
//
// THE CONVENTION (normative, single source of truth = this header):
//   Every file under docs/superpowers/specs/ and docs/superpowers/plans/
//   opens with YAML frontmatter carrying a `status` key:
//
//     ---
//     status: draft | active | binding | superseded
//     supersededBy: <repo-relative path of the successor>   # optional
//     ---
//
//   - draft       — proposed; not yet the design of record.
//   - active      — the current design/plan of record for its scope.
//   - binding     — ratified doctrine; changing it requires an operator decision.
//   - superseded  — retired; kept for history. `supersededBy` names the
//                   successor when one exists and is ONLY legal on status:
//                   superseded; the named path must exist in the repo.
//   Prose "**Status:** …" lines may remain as human context, but the
//   frontmatter key is what tooling reads.
//
// THE RATCHET (diff-scoped + grandfathered, like check-doc-anchor-existence):
//   - The untouched legacy corpus is grandfathered in
//     scripts/spec-status-frontmatter-baseline.txt (owned expiring budget).
//   - A NEW spec/plan (not in the baseline) must carry valid frontmatter.
//   - A CHANGED spec/plan must carry it too — migrate-as-touched: editing a
//     grandfathered file is the moment its status becomes explicit.
//   - `supersededBy` on a non-superseded status, an unknown status value, or a
//     dangling successor path fails everywhere, baseline or not.
//
//   node scripts/check-spec-status-frontmatter.mjs            # check (CI)
//   node scripts/check-spec-status-frontmatter.mjs --update   # regenerate the grandfather baseline

import fs from "node:fs";
import path from "node:path";
import { requireChangedFiles } from "./lib/git-changed-files.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { formatTxtBudgetHeader, parseTxtBudgetHeader } from "./lib/baseline-budget.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts", "spec-status-frontmatter-baseline.txt");
const SCOPE_DIRS = ["docs/superpowers/specs", "docs/superpowers/plans"];

export const VALID_STATUSES = Object.freeze(["draft", "active", "binding", "superseded"]);

const DEFAULT_BUDGET = Object.freeze({ owner: "platform-architecture", expiry: "2026-11-16" });
const BUDGET_NOTE_LINES = Object.freeze([
  "Spec/plan files WITHOUT valid status frontmatter at adoption (BI-79BCE3F2).",
  "Shrink-only, migrate-as-touched: editing a listed file requires adding the",
  "frontmatter; a NEW file is never added here. Regenerate with:",
  "node scripts/check-spec-status-frontmatter.mjs --update",
]);

/**
 * Parse the leading YAML frontmatter block. Deliberately minimal — we read the
 * two governed keys, not general YAML.
 * Returns { present, status, supersededBy }.
 */
export function parseStatusFrontmatter(text) {
  const result = { present: false, status: null, supersededBy: null };
  const lines = String(text).split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return result;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") {
      result.present = true;
      return result;
    }
    const m = line.match(/^(status|supersededBy)\s*:\s*(.+?)\s*$/);
    if (m) result[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { present: false, status: null, supersededBy: null }; // unterminated block
}

/**
 * Validate one file's frontmatter fully. Returns failure strings. The caller
 * decides WHICH files are validated: grandfathered untouched files are skipped
 * entirely (their legacy free-text statuses stay as-is until touched — the
 * pass's "do not mass-edit the corpus" constraint), so any file that reaches
 * this function must fully conform.
 */
export function validateSpecFrontmatter(relPath, text, { successorExists }) {
  const failures = [];
  const fm = parseStatusFrontmatter(text);

  if (!fm.present || fm.status === null) {
    failures.push(
      `${relPath}: missing status frontmatter — open the file with '---\\nstatus: draft|active|binding|superseded\\n---'.`,
    );
    return failures;
  }
  if (!VALID_STATUSES.includes(fm.status)) {
    failures.push(`${relPath}: invalid status "${fm.status}" — use one of: ${VALID_STATUSES.join(" | ")}.`);
  }
  if (fm.supersededBy !== null) {
    if (fm.status !== "superseded") {
      failures.push(`${relPath}: supersededBy is only legal with status: superseded (found status: ${fm.status}).`);
    }
    if (!successorExists(fm.supersededBy)) {
      failures.push(`${relPath}: supersededBy names a missing file: ${fm.supersededBy}.`);
    }
  }
  return failures;
}

function listScopeFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(path.relative(REPO_ROOT, full).replaceAll("\\", "/"));
      }
    }
  };
  for (const dir of SCOPE_DIRS) walk(path.join(REPO_ROOT, dir));
  return out.sort();
}

export function parsePathBaseline(text) {
  const paths = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    paths.add(line);
  }
  return paths;
}

function serializeBaseline(paths, budget = DEFAULT_BUDGET) {
  const header = formatTxtBudgetHeader({ ...budget, noteLines: BUDGET_NOTE_LINES });
  return `${header}${[...new Set(paths)].sort().join("\n")}\n`;
}

const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || "";
  }
}

function main() {
  const files = listScopeFiles();
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const successorExists = (p) => fs.existsSync(path.join(REPO_ROOT, p));
  const hasValid = (rel) => {
    const fm = parseStatusFrontmatter(read(rel));
    return fm.present && VALID_STATUSES.includes(fm.status ?? "");
  };

  if (process.argv.includes("--update")) {
    let budget = DEFAULT_BUDGET;
    try {
      const existing = parseTxtBudgetHeader(fs.readFileSync(BASELINE_PATH, "utf8"));
      if (existing.owner && existing.expiry) budget = existing;
    } catch { /* first run — defaults */ }
    const lacking = files.filter((rel) => !hasValid(rel));
    fs.writeFileSync(BASELINE_PATH, serializeBaseline(lacking, budget));
    console.log(`Wrote spec-status baseline: ${lacking.length} grandfathered file(s) without status frontmatter.`);
    return;
  }

  let baseline;
  try {
    baseline = parsePathBaseline(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`[spec-status] Missing ${path.relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-spec-status-frontmatter.mjs --update`);
    process.exit(1);
  }

  const base = process.env.BASE_SHA || "origin/main";
  if (!REF_RE.test(base) || base.startsWith("-")) {
    console.error(`[spec-status] refusing unsafe BASE_SHA: ${JSON.stringify(base)}`);
    process.exit(1);
  }
  const changed = new Set(requireChangedFiles(base, "spec-status"));

  const failures = [];
  for (const rel of files) {
    // Grandfathered AND untouched ⇒ fully skipped: legacy free-text statuses
    // stay until the file is next edited (migrate-as-touched, no mass-edit).
    if (baseline.has(rel) && !changed.has(rel)) continue;
    failures.push(...validateSpecFrontmatter(rel, read(rel), { successorExists }));
  }

  if (failures.length > 0) {
    console.error("[spec-status] FAILED — the spec/plan status convention (BI-79BCE3F2):");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error("");
    console.error("Convention: YAML frontmatter 'status: draft|active|binding|superseded' (+ optional");
    console.error("'supersededBy: <path>' on superseded files). Editing a grandfathered file is the");
    console.error("moment its status becomes explicit — migrate as touched.");
    process.exit(1);
  }

  const covered = files.filter(hasValid).length;
  console.log(
    `[spec-status] OK — ${covered}/${files.length} spec/plan file(s) carry status frontmatter; ` +
      `${baseline.size} grandfathered (migrate as touched).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
