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

/**
 * Merge live plane anchors into an existing baseline — the `--update` semantics.
 *
 * UNION, NEVER RESCAN. The baseline is a ratchet on rule EXISTENCE, so an update
 * may only ADD protection. Rescanning the plane alone looks right and is quietly
 * destructive: every rule already relocated to a registered destination silently
 * drops out of protection, which is the exact loss this guard exists to prevent.
 * That regression shipped twice (BI-0020D511 §12f) — hence this seam and its tests.
 *
 * Consolidation REQUIRES an --update, so union semantics is what makes the
 * curation `commons-are-curated-not-just-appended` mandates safe: no amount of
 * rewording can lose a rule by accident. Retirement is a deliberate hand edit.
 *
 * Labels refresh from the live plane (consolidation rewords rules); an anchor
 * absent from the plane keeps its recorded label rather than being emptied.
 *
 * @param {Map<string,string>} existing  parsed committed baseline
 * @param {Array<{anchor: string, label: string}>} planeAnchors  anchors found in the plane
 * @returns {Map<string,string>}
 */
export function mergeRuleBaseline(existing, planeAnchors) {
  const merged = new Map(existing);
  for (const { anchor, label } of planeAnchors) {
    if (label || !merged.has(anchor)) merged.set(anchor, label);
  }
  return merged;
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
 * Resolve a markdown link target to a repo-relative path.
 *
 * WHY THIS EXISTS
 * A rule's anchor identity must be the file it points AT, not the string used to reach
 * it. When Phase 1 relocated procedure from `AGENTS.md` (repo root) into
 * `docs/architecture/*.md`, every anchor's link text correctly changed from
 * `docs/founder-kernel/…` to `../founder-kernel/…` — same target, different string.
 * Comparing raw strings reported all six as DELETED. That false positive is worse than
 * no guard: it fires on the exact operation Phase 1 exists to perform, and the cheapest
 * way to silence it is `--update`, which is how a ratchet quietly stops ratcheting.
 */
export function resolveAnchor(target, fromFile = "") {
  const clean = target.replace(/^\.\//, "");
  if (clean.startsWith("/")) return clean.slice(1);
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const segs = (dir ? `${dir}/${clean}` : clean).split("/");
  const out = [];
  for (const seg of segs) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * Do two rule lead-ins state the same rule, or two different rules under one principle?
 *
 * Deliberately crude and deliberately CONSERVATIVE: this drives an advisory, and a false
 * positive here is what teaches people to delete anchors.
 *
 * Similarity is JACCARD (shared ÷ union), not shared-over-shorter. A min-based ratio
 * rewards short labels: "Single source of truth." has three significant words, so merely
 * sharing "single" and "source" with "Coworker capability filtering is single-source"
 * cleared a 60% min-ratio — flagging two genuinely different rules. Jaccard scores that
 * pair 2/6 and stays quiet, while "All changes land via PR against main" vs "All changes
 * must land via a PR against main" scores 1.0 and is caught.
 */
export function labelsRestateEachOther(a, b) {
  const words = (s) =>
    new Set(
      String(s)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  if (shared < 2) return false;
  const union = wa.size + wb.size - shared;
  return shared / union >= 0.6;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "not", "but", "with", "from", "into", "via", "per", "its",
  "that", "this", "than", "then", "when", "what", "each", "any", "all", "one",
  "are", "was", "has", "have", "been", "must", "only", "your", "you", "before",
]);

/**
 * Every rule anchor referenced by a doc, with the label of the line that carries it.
 * Returns `Array<{ anchor, label, line }>` — one entry per OCCURRENCE, so a rule linked
 * twice yields two entries (the duplicate signal below depends on that). `fromFile` is
 * the doc's own repo-relative path, used to resolve relative link targets to a stable
 * identity — pass it whenever you have it.
 */
export function ruleAnchors(text, anchorRe = DEFAULT_ANCHOR_RE, fromFile = "") {
  const re = new RegExp(anchorRe);
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const linkRe = /\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g;
    let m;
    while ((m = linkRe.exec(lines[i])) !== null) {
      if (/:\/\//.test(m[1])) continue;
      const anchor = resolveAnchor(m[1], fromFile);
      if (!re.test(anchor)) continue;
      found.push({ anchor, label: ruleLabel(lines[i]), line: i + 1 });
    }
  }
  return found;
}

/** Union of anchors referenced anywhere in a set of `path -> text` entries. */
/**
 * Source files that READ an always-on doc from disk and assert on its content.
 *
 * WHY THIS EXISTS
 * This guard keys rule identity on the kernel-principle anchor. Some rules are pinned by
 * a CODE ASSERTION instead, and those are invisible to it. Phase 1 relocated the
 * `principle_decide` cost-axis sign rule ("on the five cost axes, higher is worse") into
 * a runbook; the anchor check stayed green, and `dimension-catalog.test.ts` — which parses
 * AGENTS.md and cross-checks the axis names against the code registry — went red in CI.
 * The test was right: that is a rule, and the cut had quietly demoted it to procedure.
 *
 * We cannot infer which prose a test depends on. What we CAN do is keep the set of such
 * couplings known, so whoever relocates doctrine next knows which tests to run. A reader
 * missing from `manifest.contentAssertions` is reported, so the set cannot grow silently.
 *
 * The pattern is deliberately narrow — a read call whose own argument names the doc.
 * Matching "mentions AGENTS.md anywhere" would flag ~20 files that only cite it in a
 * comment, and a noisy signal is one people learn to ignore.
 */
export function contentAssertionReaders(files, readText, alwaysOn) {
  const names = alwaysOn.map((f) => f.split("/").pop());
  const found = [];
  for (const file of files) {
    const text = readText(file);
    if (text == null) continue;
    for (const name of names) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(readFileSync|readFile|new URL)\\s*\\([^)]*${esc}`);
      if (re.test(text)) {
        found.push({ file, doc: name });
        break;
      }
    }
  }
  return found;
}

export function anchorsIn(fileTexts, anchorRe) {
  const set = new Set();
  for (const [file, text] of Object.entries(fileTexts)) {
    if (text == null) continue;
    for (const { anchor } of ruleAnchors(text, anchorRe, file)) set.add(anchor);
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
  contentAssertions = { registered: [], unregistered: [] },
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

  // 3. RESTATED rule (ADVISORY) — the SSOT drift shape this BI's Problem 2 describes.
  //
  //    An earlier version flagged any anchor cited twice, which was wrong. One kernel
  //    principle legitimately governs several DISTINCT rules: `single-source-of-truth`
  //    backs both "each rule in exactly one place" and "coworker capability filtering is
  //    single-source"; `never-fabricate` backs both itself and "report outcomes
  //    faithfully". All four "duplicates" in the post-Phase-1 plane were of that kind —
  //    zero were real. Deleting anchors to silence the advisory would have cut
  //    discoverability to satisfy a mis-specified check, which is the failure mode this
  //    guard exists to prevent, not cause.
  //
  //    The real defect is the SAME rule restated: same anchor AND a materially similar
  //    lead-in label. Distinct labels under one principle are normal and stay quiet.
  for (const [file, text] of Object.entries(alwaysOnTexts)) {
    if (text == null) continue;
    const seen = new Map();
    for (const { anchor, label, line } of ruleAnchors(text, anchorRe, file)) {
      if (!seen.has(anchor)) seen.set(anchor, []);
      seen.get(anchor).push({ label, line });
    }
    for (const [anchor, hits] of [...seen.entries()].sort()) {
      if (hits.length < 2) continue;
      const restated = hits.filter((h, i) =>
        hits.some((other, j) => j !== i && labelsRestateEachOther(h.label, other.label)),
      );
      if (restated.length < 2) continue;
      const lines = restated.map((h) => h.line).join(", ");
      const msg =
        `${file} restates the same rule for anchor "${anchor}" at lines ${lines} ` +
        `(“${restated[0].label}” / “${restated[1].label}”) — state a rule once, per single-source-of-truth`;
      (strict ? errors : warnings).push(msg);
    }
  }

  // 3b. Content assertions — rules pinned by code, which section 1 structurally cannot see.
  for (const reader of contentAssertions.unregistered) {
    warnings.push(
      `${reader.file} reads ${reader.doc} and asserts on its content, but is not in ` +
        `manifest.contentAssertions — register it so a future relocation knows to run it`,
    );
  }

  // 4. Net-new anchors are NOT an error — adding a rule is always allowed. Reported so an
  //    intentional addition shows up in the run and lands in the baseline on --update.
  const added = [...inPlane].filter((a) => !baseline.has(a)).sort();

  return {
    errors,
    warnings,
    added,
    planCount: inPlane.size,
    baselineCount: baseline.size,
    contentAssertionCount: contentAssertions.registered.length,
  };
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
    // The baseline is a RATCHET ON RULE EXISTENCE, so --update is a UNION with
    // what is already protected — never a rescan-from-scratch.
    //
    // Rescanning the plane alone looks right and is quietly destructive: every
    // rule already relocated to a skill or runbook silently drops out of
    // protection, which is the exact loss this guard exists to prevent. It bit
    // twice (BI-0020D511 §12f) before being fixed. Rescanning plane+destinations
    // over-corrects the other way — it would protect anchors that were never
    // plane rules and freeze ordinary runbook edits.
    //
    // Union is the correct semantics, and it is what makes curation safe:
    // consolidation REQUIRES an --update, so an --update that can only ADD
    // protection means no consolidation can ever lose a rule by accident.
    // Retiring a rule is therefore a deliberate hand edit of this file —
    // `commons-are-curated-not-just-appended` reserves retirement to the human.
    let existing = new Map();
    try {
      existing = parseRuleBaseline(readFileSync(BASELINE_PATH, "utf8"));
    } catch {
      /* first run — no baseline yet */
    }
    const planeAnchors = [];
    for (const [file, text] of Object.entries(alwaysOnTexts)) {
      if (text == null) continue;
      planeAnchors.push(...ruleAnchors(text, anchorRe, file));
    }
    const anchors = mergeRuleBaseline(existing, planeAnchors);
    const carried = existing.size;
    writeFileSync(BASELINE_PATH, serializeRuleBaseline(anchors));
    console.log(
      `Wrote instruction-plane rule baseline: ${anchors.size} rule anchors ` +
        `(${carried} carried forward, ${anchors.size - carried} newly added). ` +
        `Retiring a rule is a deliberate edit of this file, never an --update.`,
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

  const scanGlobs = Array.isArray(manifest.contentAssertionScan) ? manifest.contentAssertionScan : [];
  const scanned = [...new Set(scanGlobs.flatMap((g) => globSync(g, { cwd: REPO_ROOT })))]
    .map((f) => f.replace(/\\/g, "/"))
    .sort();
  const registered = new Set(manifest.contentAssertions ?? []);
  const readers = contentAssertionReaders(
    scanned,
    (f) => {
      try {
        return readFileSync(join(REPO_ROOT, f), "utf8");
      } catch {
        return null;
      }
    },
    manifest.alwaysOn,
  );
  const contentAssertions = {
    registered: readers.filter((r) => registered.has(r.file)),
    unregistered: readers.filter((r) => !registered.has(r.file)),
  };
  const { errors, warnings, added, planCount, baselineCount, contentAssertionCount } = evaluateRuleCoverage({
    baseline,
    alwaysOnTexts,
    destinationTexts,
    targetExists: (p) => existsSync(join(REPO_ROOT, p)),
    anchorRe,
    strict: process.argv.includes("--strict"),
    contentAssertions,
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
      `(baseline ${baselineCount}; ${contentAssertionCount} code assertion(s) also pin doctrine — run them when relocating)` +
      (warnings.length ? `. ${warnings.length} advisory duplicate(s).` : "."),
  );
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-instruction-plane-rule-coverage.mjs")) {
  main();
}
