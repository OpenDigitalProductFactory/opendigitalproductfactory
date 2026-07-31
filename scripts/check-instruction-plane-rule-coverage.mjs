#!/usr/bin/env node
// Instruction-plane RULE-COVERAGE guard — BI-0020D511 §12f (design doc
// docs/superpowers/specs/2026-07-24-agent-instruction-plane-split-and-ratchet-design.md).
//
// WHY THIS EXISTS
// check-instruction-plane-size.mjs counts BYTES. Bytes are the whole point of the
// Phase 1 split, but a byte gate cannot tell a good cut from a lossy one: deleting a
// commandment scores exactly like relocating it. §12f names this gap outright — "the
// ratchet is a byte gate with no behavioural counterpart, so a 58% cut is currently
// unfalsifiable". Phase 1's own acceptance criterion says "no rule *statement* lost
// (diff-reviewed against the commandment set)", and a hand diff-review across a 58%
// rewrite of a 90kB file is exactly the check that silently degrades into a rubber stamp.
//
// This guard makes that criterion machine-checked.
//
// WHAT IS A "RULE", MECHANICALLY
// Rule identity is the KERNEL-PRINCIPLE ANCHOR, not the prose. AGENTS.md states each
// load-bearing rule as a bullet ending in `→ [kernel principle](docs/.../foo.md)`. That
// target path is a durable identifier: Phase 1 is *supposed* to reword, shorten, and
// relocate the prose, so keying on sentences would fire on every intended edit and teach
// everyone to run --update reflexively. Keying on the anchor fires only when a rule stops
// being reachable at all — which is the actual defect.
//
// THE INVARIANT
// Every anchor baselined from the pre-split plane must remain reachable from either:
//   (a) an always-on file (the rule stayed in doctrine), or
//   (b) a registered destination — manifest.ruleDestinations (the rule moved to its skill
//       or reference doc, which is what Phase 1 is FOR).
// A rule that appears in neither has been dropped, and that fails.
//
// WHAT THIS IS NOT
// This is the DETERMINISTIC half of §12f. It proves a rule still EXISTS somewhere an agent
// can reach; it does NOT prove a shortened rule still STEERS an agent the same way. That
// second half needs behavioural evals against real surfaces and is deliberately out of
// scope here — see §12f. Do not let a green run here be read as "the cut was safe",
// only as "the cut lost nothing outright".
//
// Prior art deliberately mirrored: scripts/check-golden-decisions.mjs, which gates the
// kernel-principle CORPUS on canonical decision outcomes with no vitest dependency. Same
// spirit (doctrine regression, pure node, fast), different plane — golden-decisions cannot
// see AGENTS.md, so relocating a rule out of the always-on plane is invisible to it.
//
//   node scripts/check-instruction-plane-rule-coverage.mjs            # check (CI)
//   node scripts/check-instruction-plane-rule-coverage.mjs --update   # re-baseline
//   node scripts/check-instruction-plane-rule-coverage.mjs --strict   # duplicates become errors

import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(REPO_ROOT, "scripts", "instruction-plane-manifest.json");
// Line-oriented `<anchor>\t<label>`, merge=union like the size baseline so concurrent
// re-baselines never conflict. Duplicate anchors after a union merge collapse to one.
const BASELINE_PATH = join(REPO_ROOT, "scripts", "instruction-plane-rule-baseline.txt");

/**
 * Default: anything under a kernel/profession `wiki/` tree is a rule anchor. BOTH shapes
 * occur and both are load-bearing — `founder-kernel/wiki/principles/<rule>.md` (35 today)
 * and the flat profession shape `professions/<prof>/wiki/<rule>.md` (11 today, e.g.
 * strongly-typed-string-enums, backlog-lives-in-postgresql). An earlier pattern that
 * required a directory under `wiki/` silently dropped all 11, which is precisely the
 * false-green this guard exists to prevent — hence the optional group, and hence
 * `check-instruction-plane-rule-coverage.test.mjs` asserts a profession anchor is caught.
 */
const DEFAULT_ANCHOR_RE = "wiki/(?:[a-z0-9-]+/)?[a-z0-9-]+\\.md$";

/** Parse `<anchor>\t<label>` lines; later duplicates keep the first label. */
export function parseRuleBaseline(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)(?:\s+(.*))?$/);
    if (!m) continue;
    if (!out.has(m[1])) out.set(m[1], (m[2] ?? "").trim());
  }
  return out;
}

export function serializeRuleBaseline(anchors) {
  return (
    [...anchors.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([anchor, label]) => (label ? `${anchor}\t${label}` : anchor))
      .join("\n") + "\n"
  );
}

/**
 * The bolded lead-in of a rule bullet — `- **Never fabricate.** Ground claims…` yields
 * "Never fabricate.". Human-readable only; never part of anchor identity, because Phase 1
 * rewording it is intended behaviour, not a regression.
 */
export function ruleLabel(line) {
  const m = line.match(/^\s*[-*]\s+\*\*(.+?)\*\*/);
  if (m) return m[1].replace(/\s+/g, " ").trim().slice(0, 80);
  const h = line.match(/^#{2,4}\s+(.+?)\s*$/);
  if (h) return h[1].replace(/\s+/g, " ").trim().slice(0, 80);
  return "";
}

/**
 * Every rule anchor referenced by a doc, with the label of the line that carries it.
 * Returns `Array<{ anchor, label, line }>` — one entry per OCCURRENCE, so a rule linked
 * twice yields two entries (the duplicate signal below depends on that).
 */
export function ruleAnchors(text, anchorRe = DEFAULT_ANCHOR_RE) {
  const re = new RegExp(anchorRe);
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const linkRe = /\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g;
    let m;
    while ((m = linkRe.exec(lines[i])) !== null) {
      if (/:\/\//.test(m[1])) continue;
      const anchor = m[1].replace(/^\.\//, "").replace(/^\//, "");
      if (!re.test(anchor)) continue;
      found.push({ anchor, label: ruleLabel(lines[i]), line: i + 1 });
    }
  }
  return found;
}

/** Union of anchors referenced anywhere in a set of `path -> text` entries. */
export function anchorsIn(fileTexts, anchorRe) {
  const set = new Set();
  for (const text of Object.values(fileTexts)) {
    if (text == null) continue;
    for (const { anchor } of ruleAnchors(text, anchorRe)) set.add(anchor);
  }
  return set;
}

/**
 * Pure evaluation, exported for tests.
 *
 * @param {object} a
 * @param {Map<string,string>} a.baseline      anchor -> label, from the pre-split plane
 * @param {Record<string,string|null>} a.alwaysOnTexts
 * @param {Record<string,string|null>} a.destinationTexts  registered relocation targets
 * @param {(p: string) => boolean} a.targetExists
 */
export function evaluateRuleCoverage({
  baseline,
  alwaysOnTexts,
  destinationTexts = {},
  targetExists = () => true,
  anchorRe = DEFAULT_ANCHOR_RE,
  strict = false,
}) {
  const errors = [];
  const warnings = [];

  const inPlane = anchorsIn(alwaysOnTexts, anchorRe);
  const inDestinations = anchorsIn(destinationTexts, anchorRe);

  // 1. Preservation (HARD) — the whole point of the guard.
  const lost = [];
  for (const [anchor, label] of baseline) {
    if (inPlane.has(anchor) || inDestinations.has(anchor)) continue;
    lost.push(
      `rule anchor "${anchor}"${label ? ` (${label})` : ""} is no longer referenced from ` +
        `the always-on plane OR any registered destination — the rule statement was DROPPED, ` +
        `not relocated`,
    );
  }
  errors.push(...lost.sort());

  // 2. Dangling target (HARD) — a rule pointing at a deleted principle page is a rule an
  //    agent cannot actually read, which is the same defect one hop later.
  for (const anchor of [...inPlane].sort()) {
    if (!targetExists(anchor)) {
      errors.push(`rule anchor "${anchor}" is referenced from the always-on plane but the target file does not exist`);
    }
  }

  // 3. Duplicate anchor (ADVISORY) — the same rule linked from two places in always-on
  //    prose is the SSOT drift shape this BI's Problem 2 describes. Advisory because the
  //    pre-split file already has instances and fixing them is Phase 1 work.
  for (const [file, text] of Object.entries(alwaysOnTexts)) {
    if (text == null) continue;
    const seen = new Map();
    for (const { anchor, line } of ruleAnchors(text, anchorRe)) {
      if (!seen.has(anchor)) seen.set(anchor, []);
      seen.get(anchor).push(line);
    }
    for (const [anchor, lines] of [...seen.entries()].sort()) {
      if (lines.length < 2) continue;
      const msg = `${file} links rule anchor "${anchor}" ${lines.length}× (lines ${lines.join(", ")}) — state a rule once, per single-source-of-truth`;
      (strict ? errors : warnings).push(msg);
    }
  }

  // 4. Net-new anchors are NOT an error — adding a rule is always allowed. Reported so an
  //    intentional addition shows up in the run and lands in the baseline on --update.
  const added = [...inPlane].filter((a) => !baseline.has(a)).sort();

  return { errors, warnings, added, planCount: inPlane.size, baselineCount: baseline.size };
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function readTexts(paths) {
  const texts = {};
  for (const p of paths) {
    try {
      texts[p] = readFileSync(join(REPO_ROOT, p), "utf8");
    } catch {
      texts[p] = null;
    }
  }
  return texts;
}

function destinationPaths(manifest) {
  const globs = Array.isArray(manifest.ruleDestinations) ? manifest.ruleDestinations : [];
  const out = new Set();
  for (const g of globs) {
    for (const f of globSync(g, { cwd: REPO_ROOT })) out.add(f.replace(/\\/g, "/"));
  }
  return [...out].sort();
}

function main() {
  const manifest = loadManifest();
  const anchorRe = manifest.ruleAnchorPattern || DEFAULT_ANCHOR_RE;
  const alwaysOnTexts = readTexts(manifest.alwaysOn);

  if (process.argv.includes("--update")) {
    const anchors = new Map();
    for (const text of Object.values(alwaysOnTexts)) {
      if (text == null) continue;
      for (const { anchor, label } of ruleAnchors(text, anchorRe)) {
        if (!anchors.has(anchor) || (!anchors.get(anchor) && label)) anchors.set(anchor, label);
      }
    }
    writeFileSync(BASELINE_PATH, serializeRuleBaseline(anchors));
    console.log(
      `Wrote instruction-plane rule baseline: ${anchors.size} rule anchors from ${manifest.alwaysOn.length} always-on files.`,
    );
    process.exit(0);
  }

  let baseline;
  try {
    baseline = parseRuleBaseline(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-instruction-plane-rule-coverage.mjs --update`,
    );
    process.exit(1);
  }

  const destinationTexts = readTexts(destinationPaths(manifest));
  const { errors, warnings, added, planCount, baselineCount } = evaluateRuleCoverage({
    baseline,
    alwaysOnTexts,
    destinationTexts,
    targetExists: (p) => existsSync(join(REPO_ROOT, p)),
    anchorRe,
    strict: process.argv.includes("--strict"),
  });

  for (const w of warnings) console.warn(`  [advisory] ${w}`);
  for (const a of added) console.log(`  [new rule] ${a} — will be baselined on --update`);

  if (errors.length > 0) {
    console.error("Instruction-plane rule coverage FAILED (BI-0020D511 §12f).\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("");
    console.error(
      "The split may relocate a rule; it may not delete one. Move the rule to a skill or",
    );
    console.error(
      "reference doc listed in manifest.ruleDestinations, or — if the rule is genuinely",
    );
    console.error("retired — say so in the commit body and run --update.");
    process.exit(1);
  }

  console.log(
    `Instruction-plane rule coverage OK — ${planCount} rule anchors reachable ` +
      `(baseline ${baselineCount})` +
      (warnings.length ? `. ${warnings.length} advisory duplicate(s).` : "."),
  );
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-instruction-plane-rule-coverage.mjs")) {
  main();
}
