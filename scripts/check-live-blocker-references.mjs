#!/usr/bin/env node
// scripts/check-live-blocker-references.mjs
//
// BI-38A353B2 — a CLOSED backlog id must not be cited as a live blocker from
// user-facing runtime text.
//
// THE PROBLEM IT FIXES: `record_plan_backlog_coverage` told every caller to
// "cite BI-B9403248 for the blocked receipt". BI-B9403248 closed on
// 2026-08-21 while the block it named stayed live, so the gate instructed
// contributors to blame a fixed defect, and anyone auditing a plan that
// followed the instruction found a closed id and concluded the block was
// stale. Remediation text is written inline as a literal and then never
// revisited when the referenced work closes. This is "absence is invisible to
// every gate" applied to references: check-doc-anchor-existence.mjs proves a
// cited id EXISTS; nothing proved it was still OPEN.
//
// THE CONTRACT (deliberately narrow — a mention is not a citation):
//   - Only CHANGED source files (vs BASE_SHA, default origin/main) under
//     apps/ and packages/, extensions .ts/.tsx/.mjs/.js, excluding tests.
//   - Only ids inside a STRING LITERAL that also carries remediation language
//     ("cite", "blocked by", "tracked in", "see BI-", "blocker"). A BI- id in
//     a CODE COMMENT is provenance, not instruction, and is never flagged —
//     comments are exactly where a closed id SHOULD stay recorded.
//   - Existing pairs are grandfathered in scripts/live-blocker-baseline.txt.
//   - Verified over MCP: a BI whose status is terminal (done / retired /
//     cancelled) FAILS. Anything else — open, triaging, unknown — passes.
//   - DEGRADES GRACEFULLY: no bearer token, unreachable endpoint, or an
//     ambiguous response ⇒ WARN and pass, printing exactly what was skipped.
//     A gate that cannot reach the install must never invent a defect.
//   - DOES NOT degrade on an unresolvable BASE_SHA (BI-B263E76C / twin of
//     BI-B6433DC6). Reuses listChangedFiles from check-doc-anchor-existence.
//
//   node scripts/check-live-blocker-references.mjs            # check (CI)
//   node scripts/check-live-blocker-references.mjs --update   # regenerate the baseline

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { callTool, DEFAULT_ENDPOINT } from "./check-doc-anchor-existence.mjs";
import { listChangedFiles, runGit } from "./lib/git-changed-files.mjs";
import { formatTxtBudgetHeader, parseTxtBudgetHeader } from "./lib/baseline-budget.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts", "live-blocker-baseline.txt");
const DEFAULT_BUDGET = Object.freeze({ owner: "platform-architecture", expiry: "2026-11-16" });
const BUDGET_NOTE_LINES = Object.freeze([
  "Grandfathered source-string -> backlog-id citations (BI-38A353B2). One",
  "<source-path>\\t<id> pair per line. Regenerate with --update.",
]);

const ID_RE = /\b(?:EP|BI)-[0-9A-F]{8}\b/g;
/** Language that turns a mention into an instruction to the reader. */
const CITATION_CUE = /\b(?:cite|citing|blocked by|blocker|tracked (?:in|on|by)|see|refer to|filed as|follow)\b/i;
/** Terminal backlog statuses — a citation to one of these is the defect. */
export const TERMINAL_STATUSES = Object.freeze(["done", "retired", "cancelled", "canceled", "superseded"]);

const SOURCE_EXT = /\.(?:ts|tsx|mjs|js)$/;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;

/**
 * Extract (id) citations that live inside a string literal carrying citation
 * language. Comments are skipped: a closed id recorded as provenance in a
 * comment is desirable, not a defect.
 */
export function extractLiveBlockerCitations(source) {
  const found = new Set();
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    // Strip a trailing line comment so `foo(); // see BI-XXXXXXXX` is not read
    // as instruction text.
    const code = line.replace(/\/\/.*$/, "");
    for (const literal of code.match(/(?:"[^"]*"|'[^']*'|`[^`]*`)/g) ?? []) {
      if (!CITATION_CUE.test(literal)) continue;
      for (const id of literal.match(ID_RE) ?? []) found.add(id);
    }
  }
  return [...found];
}

export function parseBlockerBaseline(text) {
  const pairs = new Set();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    pairs.add(trimmed);
  }
  return pairs;
}

export function serializeBlockerBaseline(pairs, budget = DEFAULT_BUDGET) {
  const unique = [...new Set(pairs.map((p) => `${p.file}\t${p.id}`))].sort();
  return `${formatTxtBudgetHeader({ ...budget, noteLines: BUDGET_NOTE_LINES })}${unique.join("\n")}\n`;
}

/** "terminal" | "live" | "unknown" from a get_backlog_item response body. */
export function interpretStatus(id, body) {
  let parsed;
  try {
    parsed = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return "unknown";
  }
  if (!parsed || typeof parsed !== "object" || parsed.error) return "unknown";
  const result = parsed.result ?? parsed;
  const text = typeof result === "string" ? result : JSON.stringify(result);
  if (!text.includes(id)) return "unknown";
  const match = /"status"\s*:\s*"([^"]+)"/.exec(text);
  if (!match) return "unknown";
  return TERMINAL_STATUSES.includes(match[1].toLowerCase()) ? "terminal" : "live";
}

const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || "";
  }
}

function isScannedSource(file) {
  return (file.startsWith("apps/") || file.startsWith("packages/"))
    && SOURCE_EXT.test(file) && !TEST_FILE.test(file);
}

function scanAllSources() {
  const listed = runGit(["ls-files"]);
  if (!listed.ok) {
    console.error("[live-blocker] git ls-files failed — the --update scan did not run. This is not a pass.");
    if (listed.stderr) console.error(`[live-blocker] git: ${listed.stderr.trim()}`);
    process.exit(1);
  }
  const pairs = [];
  for (const file of listed.stdout.split("\n").map((s) => s.trim()).filter(isScannedSource)) {
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs)) continue;
    for (const id of extractLiveBlockerCitations(fs.readFileSync(abs, "utf8"))) pairs.push({ file, id });
  }
  return pairs;
}

async function main() {
  if (process.argv.includes("--update")) {
    let budget = DEFAULT_BUDGET;
    try {
      const existing = parseTxtBudgetHeader(fs.readFileSync(BASELINE_PATH, "utf8"));
      if (existing.owner && existing.expiry) budget = existing;
    } catch { /* first run — defaults */ }
    const pairs = scanAllSources();
    fs.writeFileSync(BASELINE_PATH, serializeBlockerBaseline(pairs, budget));
    console.log(`Wrote live-blocker baseline: ${new Set(pairs.map((p) => `${p.file}\t${p.id}`)).size} grandfathered citation(s).`);
    return;
  }

  let baseline;
  try {
    baseline = parseBlockerBaseline(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`[live-blocker] Missing ${path.relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-live-blocker-references.mjs --update`);
    process.exit(1);
  }

  const base = process.env.BASE_SHA || "origin/main";
  if (!REF_RE.test(base) || base.startsWith("-")) {
    console.error(`[live-blocker] refusing unsafe BASE_SHA: ${JSON.stringify(base)}`);
    process.exit(1);
  }
  const listed = listChangedFiles(base);
  if (listed.status === "unresolvable") {
    console.error(`[live-blocker] cannot resolve ${base} — the guard did not run. This is not a pass.`);
    console.error("[live-blocker] Remedy: git fetch --deepen 50 origin  (or git fetch origin main) and re-run.");
    if (listed.detail) console.error(`[live-blocker] git: ${listed.detail}`);
    process.exit(1);
  }
  if (listed.files.length === 0) {
    console.log(`[live-blocker] No diff against ${base} — nothing to check. OK.`);
    return;
  }
  const changed = listed.files.filter(isScannedSource);

  const newPairs = [];
  for (const file of changed) {
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs)) continue;
    for (const id of extractLiveBlockerCitations(fs.readFileSync(abs, "utf8"))) {
      if (!baseline.has(`${file}\t${id}`)) newPairs.push({ file, id });
    }
  }

  if (newPairs.length === 0) {
    console.log(`[live-blocker] ${changed.length} changed source file(s), no new backlog-id citations in user-facing strings. OK.`);
    return;
  }

  const token = process.env.DPF_MCP_BEARER_TOKEN;
  const endpoint = process.env.DPF_MCP_ENDPOINT || DEFAULT_ENDPOINT;
  if (!token) {
    console.warn(`[live-blocker] WARN: ${newPairs.length} new citation(s) NOT verified — DPF_MCP_BEARER_TOKEN unset (no live install on this runner). Skipped:`);
    for (const p of newPairs) console.warn(`  ~ ${p.file}: ${p.id}`);
    console.warn("[live-blocker] Passing (degraded). Verify on an install with the portal up before merge.");
    return;
  }

  const terminal = [];
  const skipped = [];
  for (const pair of newPairs) {
    if (pair.id.startsWith("EP-")) { skipped.push(pair); continue; }
    const body = await callTool(endpoint, token, "get_backlog_item", { itemId: pair.id });
    const verdict = body === null ? "unknown" : interpretStatus(pair.id, body);
    if (verdict === "terminal") terminal.push(pair);
    else if (verdict === "unknown") skipped.push(pair);
  }

  if (skipped.length > 0) {
    console.warn(`[live-blocker] WARN: ${skipped.length} citation(s) not verified — no governed status lookup, endpoint unreachable, or ambiguous response (never treated as closed):`);
    for (const p of skipped) console.warn(`  ~ ${p.file}: ${p.id}`);
  }

  if (terminal.length > 0) {
    console.error("");
    console.error("[live-blocker] FAILED — user-facing text cites a backlog id that is CLOSED, so it names a fixed defect as a live blocker:");
    for (const p of terminal) console.error(`  ✗ ${p.file}: ${p.id}`);
    console.error("");
    console.error("Name the CONDITION the reader is actually hitting rather than an id — a condition does not go stale");
    console.error("when the work behind it ships. If the id genuinely belongs in the text, repoint it at the live item.");
    console.error("A closed id recorded in a CODE COMMENT as provenance is fine and is never flagged.");
    process.exit(1);
  }
  console.log(`[live-blocker] ${newPairs.length} new citation(s) checked, none closed. OK.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
