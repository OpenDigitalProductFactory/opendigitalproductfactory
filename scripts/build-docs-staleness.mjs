#!/usr/bin/env node
// scripts/build-docs-staleness.mjs
//
// The doc-staleness DETECTOR — the deterministic half of BI-AA5DFEA2.
//
// The Doc Reference Integrity gate (check-doc-reference-integrity.mjs) catches
// *dead* references — a link that no longer resolves. It CANNOT catch *semantic*
// staleness: a doc whose links still resolve but whose words describe behaviour
// that changed. That is this detector's job.
//
// SIGNAL (purely deterministic — the "program" rung of the EP-1155CEF3 load-descent
// ladder): a live doc is a stale-candidate when a repo file it references was
// committed MORE RECENTLY than the doc itself. The doc points at code/spec that has
// since moved on while the doc stood still. Same-commit edits (doc + target in one
// PR) share a timestamp and are NOT flagged — only genuine "target moved on after
// the doc" drift is.
//
// WHY A SCRIPT, NOT A LIVE RUNNER (topology): the signal is git-derived, but the
// deployed single-tenant portal ships no git history and CI cannot reach a
// customer's DB. So the signal is computed where git EXISTS (here / CI) and shipped
// as a committed report. A weekly workflow (refresh-docs-staleness.yml) regenerates
// it and opens a bot PR — the PR diff IS the surface, and reviewing it is the agent/
// human VERDICT step (is it actually stale, or did the change not touch what the doc
// says?). Kernel scored persist-to-db vs this at low confidence (margin 0.11); the
// topology constraint the scoring didn't encode breaks the tie toward a shipped
// artifact.
//
// SCOPE: references FROM live docs (docs/**, excluding docs/superpowers/ — frozen
// history), TO tracked repo files. Non-file references (routes, external URLs,
// permalinks) have no commit to compare and are ignored.
//
// Usage:
//   node scripts/build-docs-staleness.mjs            # write the report
//   node scripts/build-docs-staleness.mjs --check    # exit 1 if report is stale (CI)

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO_ROOT = process.env.DOC_STALE_ROOT
  ? resolve(process.env.DOC_STALE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_ROOT = join(REPO_ROOT, "docs");
const REPORT_PATH = join(REPO_ROOT, "docs", "maintenance", "staleness-report.md");
const EXCLUDE_SOURCE_RE = /^docs\/superpowers\//;
const ROOT_DOCS = ["AGENTS.md", "README.md", "CONTRIBUTING.md"];

const LINK_RE = /!?\[[^\]]*\]\(\s*((?:[^()\s]|\([^()]*\))+)(?:\s+"[^"]*")?\s*\)/g;
const FENCE_RE = /^([`~]{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const isExternal = (h) => /^(https?:|mailto:|tel:|data:|#)/i.test(h);

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** path → most-recent commit unix-ts, from a single git-log pass over the whole tree. */
function lastCommitTimes() {
  const out = git(["log", "--format=C%ct", "--name-only", "--no-renames"]);
  const ts = new Map();
  let cur = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("C")) {
      cur = Number.parseInt(line.slice(1), 10);
    } else if (line.trim()) {
      // First (most-recent) commit touching a path wins.
      if (!ts.has(line)) ts.set(line, cur);
    }
  }
  return ts;
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.isFile() && e.name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

function sourceDocs() {
  const docs = existsSync(DOC_ROOT) ? walk(DOC_ROOT) : [];
  const roots = ROOT_DOCS.map((f) => join(REPO_ROOT, f)).filter(existsSync);
  return [...docs, ...roots]
    .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
    .filter((r) => !EXCLUDE_SOURCE_RE.test(r))
    .sort();
}

/** Resolve an href to a repo-relative path IF it points at a real tracked file. */
function resolveRepoFile(sourceRel, href, tracked) {
  if (isExternal(href) || href.startsWith("/")) return null; // routes/site-abs/external: no file ts
  let clean = href.split("#")[0].split("?")[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* keep raw */
  }
  clean = clean.replace(/:\d+(?:-\d+)?$/, "");
  if (!clean) return null;
  const abs = normalize(resolve(REPO_ROOT, dirname(sourceRel), clean));
  if (!abs.startsWith(REPO_ROOT)) return null;
  const rel = relative(REPO_ROOT, abs).split("\\").join("/");
  return tracked.has(rel) ? rel : null;
}

const DAY = 86400;

function computeStale() {
  const ts = lastCommitTimes();
  const tracked = new Set(ts.keys());
  const stale = [];
  for (const doc of sourceDocs()) {
    const docTs = ts.get(doc);
    if (!docTs) continue; // untracked/new doc — nothing to compare yet
    const raw = readFileSync(join(REPO_ROOT, doc), "utf8").replace(FENCE_RE, "");
    const seen = new Map();
    for (const m of raw.matchAll(LINK_RE)) {
      const target = resolveRepoFile(doc, m[1].trim(), tracked);
      if (!target || target === doc) continue;
      const tTs = ts.get(target);
      if (tTs && tTs > docTs && !seen.has(target)) seen.set(target, tTs);
    }
    if (seen.size === 0) continue;
    const refs = [...seen.entries()]
      .map(([target, tTs]) => ({ target, targetCommittedTs: tTs, agoDays: Math.floor((tTs - docTs) / DAY) }))
      .sort((a, b) => b.agoDays - a.agoDays || a.target.localeCompare(b.target));
    stale.push({ doc, docCommittedTs: docTs, staleReferences: refs, maxAgoDays: refs[0].agoDays });
  }
  // Most-drifted first, then stable alphabetical.
  stale.sort((a, b) => b.maxAgoDays - a.maxAgoDays || a.doc.localeCompare(b.doc));
  return stale;
}

/** Deterministic markdown report — no absolute timestamps (non-reproducible),
 *  only relative drift, so re-runs on the same tree produce identical output. */
function renderReport(stale) {
  const lines = [];
  lines.push("# Documentation staleness report");
  lines.push("");
  lines.push("> Generated by `scripts/build-docs-staleness.mjs`. Do not edit by hand — a");
  lines.push("> weekly workflow regenerates it and opens a PR. Each row is a *candidate*:");
  lines.push("> a live doc that references a repo file committed more recently than the doc");
  lines.push("> itself. That is a deterministic signal, not a verdict — a reviewer confirms");
  lines.push("> whether the doc's wording actually needs updating (BI-AA5DFEA2). It does NOT");
  lines.push("> mean the doc is definitely wrong.");
  lines.push("");
  lines.push(`**${stale.length}** stale-candidate doc(s).`);
  lines.push("");
  if (stale.length === 0) {
    lines.push("No live doc references a repo file newer than itself. ✅");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("| Doc | Drift | Most-recently-changed reference(s) |");
  lines.push("| --- | ----- | ---------------------------------- |");
  for (const s of stale) {
    const refs = s.staleReferences
      .slice(0, 3)
      .map((r) => `\`${r.target}\` (+${r.agoDays}d)`)
      .join("<br>");
    const more = s.staleReferences.length > 3 ? `<br>…+${s.staleReferences.length - 3} more` : "";
    lines.push(`| \`${s.doc}\` | ${s.maxAgoDays}d | ${refs}${more} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── main ──────────────────────────────────────────────────────────────────────
const check = process.argv.includes("--check");
const report = renderReport(computeStale());

if (check) {
  const current = existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH, "utf8") : "";
  if (current.trim() !== report.trim()) {
    console.error("[docs-staleness] report is out of date — run `node scripts/build-docs-staleness.mjs` and commit.");
    process.exit(1);
  }
  console.log("[docs-staleness] report is up to date.");
  process.exit(0);
}

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, report + "\n");
console.log(`[docs-staleness] wrote ${relative(REPO_ROOT, REPORT_PATH)}.`);
