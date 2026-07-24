#!/usr/bin/env node
// Instruction-plane size ratchet — BI-0020D511 (Phase 0 of the agent
// instruction-plane split; design doc
// docs/superpowers/specs/2026-07-24-agent-instruction-plane-split-and-ratchet-design.md).
//
// WHY THIS EXISTS
// The always-on agent instruction plane (AGENTS.md, forced by the CLAUDE.md
// pointer) grew ~4,000 chars in a single day while the audit that measured it
// was still open — proof that, absent a ratchet, doctrine re-accretes. This
// guard freezes a byte baseline of the always-on plane and lets it only
// SHRINK, exactly like scripts/check-module-size.mjs freezes LOC.
//
// It measures the WHOLE pointer-forced set (a manifest), not one filename, so
// the obvious evasion — shrink AGENTS.md, then have the pointer also force
// `doctrine-extras.md` — is caught: a second always-read file must appear in
// the manifest (and thus in the measured total), or the closure check fails.
//
// THREE CHECKS
//   1. Byte ratchet (HARD): sum of bytes across manifest.alwaysOn may not
//      exceed the baseline. Deterministic — bytes, never an approximate token
//      count (tokens drift across tokenizer versions and would flake CI).
//   2. Manifest closure (HARD): every markdown file the pointerFile marks as
//      always-read must be listed in manifest.alwaysOn.
//   3. Structural signal (ADVISORY in Phase 0; HARD when manifest
//      structuralStrict=true or --strict): flag any always-on-doc section over
//      perSectionCharBudget and any line over maxLineChars. A content signal
//      that survives header renaming — catches a procedure block re-inlined
//      under a fresh heading. Kept advisory until Phase 1 performs the split.
//
//   node scripts/check-instruction-plane-size.mjs            # check (CI)
//   node scripts/check-instruction-plane-size.mjs --update   # re-baseline (run after an intentional shrink)
//   node scripts/check-instruction-plane-size.mjs --strict   # make the structural signal a hard failure

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(REPO_ROOT, "scripts", "instruction-plane-manifest.json");
// Line-oriented `<path>\t<bytes>` baseline, merged with git's `merge=union`
// driver (.gitattributes) so concurrent PRs that each re-baseline never
// conflict. A union merge can leave duplicate paths; parseBaseline resolves a
// duplicate to the LARGEST recorded value (never falsely green after a merge —
// the next --update rewrites sorted + deduped).
const BASELINE_PATH = join(REPO_ROOT, "scripts", "instruction-plane-baseline.txt");

/** UTF-8 byte length — matches `wc -c`, deterministic across environments. */
export function byteLen(text) {
  return Buffer.byteLength(text, "utf8");
}

/** Parse `<path>\t<bytes>` lines; duplicates (union merge) resolve to max. */
export function parseBaseline(text) {
  const baseline = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    const [, file, n] = m;
    const v = Number(n);
    if (!(file in baseline) || v > baseline[file]) baseline[file] = v;
  }
  return baseline;
}

export function serializeBaseline(baseline) {
  return (
    Object.keys(baseline)
      .sort()
      .map((k) => `${k}\t${baseline[k]}`)
      .join("\n") + "\n"
  );
}

/**
 * Repo-relative markdown paths the pointer file marks as always-read. Matches
 * markdown link targets `](foo.md)` and bare `/foo.md` tokens; ignores external
 * URLs and anchors. Leading `/` is stripped so `/AGENTS.md` == `AGENTS.md`.
 */
export function pointerReferences(pointerText) {
  const refs = new Set();
  const linkRe = /\]\(([^)]+?\.md)(?:#[^)]*)?\)/g;
  const bareRe = /(?:^|\s)\/?([A-Za-z0-9_][A-Za-z0-9_./-]*\.md)\b/g;
  let m;
  while ((m = linkRe.exec(pointerText)) !== null) {
    if (/:\/\//.test(m[1])) continue;
    refs.add(m[1].replace(/^\//, ""));
  }
  while ((m = bareRe.exec(pointerText)) !== null) {
    refs.add(m[1].replace(/^\//, ""));
  }
  return [...refs];
}

/** Section byte sizes for a doctrine doc, keyed by `##`/`###` header line. */
export function sectionSizes(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (/^#{2,3} /.test(line)) {
      if (cur) sections.push(cur);
      cur = { header: line.replace(/^#+\s*/, "").trim(), bytes: byteLen(line) + 1 };
    } else if (cur) {
      cur.bytes += byteLen(line) + 1;
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

/**
 * Pure evaluation, exported for tests.
 * @returns {{ errors: string[], warnings: string[], currentTotal: number, baselineTotal: number }}
 */
export function evaluate({ manifest, fileTexts, baseline, strict }) {
  const errors = [];
  const warnings = [];
  const alwaysOn = Array.isArray(manifest.alwaysOn) ? manifest.alwaysOn : [];
  const set = new Set(alwaysOn);

  // 1. Byte ratchet (per file, so the message points at the culprit).
  let currentTotal = 0;
  let baselineTotal = 0;
  for (const file of alwaysOn) {
    const cur = fileTexts[file] != null ? byteLen(fileTexts[file]) : 0;
    currentTotal += cur;
    const base = baseline[file];
    if (base != null) baselineTotal += base;
    if (base != null && cur > base) {
      errors.push(`${file} grew ${base} -> ${cur} bytes (always-on plane may only shrink)`);
    } else if (base == null) {
      errors.push(`${file} is in the manifest but missing from the baseline — run --update`);
    }
  }

  // 2. Manifest closure — the pointer may only force files in alwaysOn.
  const pointerFile = manifest.pointerFile;
  if (pointerFile && fileTexts[pointerFile] != null) {
    for (const ref of pointerReferences(fileTexts[pointerFile])) {
      if (!set.has(ref)) {
        errors.push(
          `pointer ${pointerFile} references always-read file "${ref}" which is NOT in ` +
            `manifest.alwaysOn — add it to the manifest (so it is measured) or remove the reference`,
        );
      }
    }
  }

  // 3. Structural signal — advisory unless strict.
  const budget = Number(manifest.perSectionCharBudget) || Infinity;
  const maxLine = Number(manifest.maxLineChars) || Infinity;
  const hardStructural = strict || manifest.structuralStrict === true;
  for (const file of alwaysOn) {
    const text = fileTexts[file];
    if (text == null) continue;
    for (const s of sectionSizes(text)) {
      if (s.bytes > budget) {
        const msg = `${file} § "${s.header}" is ${s.bytes} bytes (> ${budget} budget) — move procedure/history out`;
        (hardStructural ? errors : warnings).push(msg);
      }
    }
    let lineNo = 0;
    for (const line of text.split(/\r?\n/)) {
      lineNo += 1;
      if (byteLen(line) > maxLine) {
        const msg = `${file}:${lineNo} line is ${byteLen(line)} bytes (> ${maxLine}) — likely re-inlined detail`;
        (hardStructural ? errors : warnings).push(msg);
      }
    }
  }

  return { errors, warnings, currentTotal, baselineTotal };
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function readFileTexts(manifest) {
  const texts = {};
  for (const file of manifest.alwaysOn) {
    try {
      texts[file] = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      texts[file] = null;
    }
  }
  if (manifest.pointerFile && texts[manifest.pointerFile] == null) {
    try {
      texts[manifest.pointerFile] = readFileSync(join(REPO_ROOT, manifest.pointerFile), "utf8");
    } catch {
      /* left null */
    }
  }
  return texts;
}

function main() {
  const manifest = loadManifest();
  const fileTexts = readFileTexts(manifest);

  if (process.argv.includes("--update")) {
    const baseline = {};
    for (const file of manifest.alwaysOn) {
      baseline[file] = fileTexts[file] != null ? byteLen(fileTexts[file]) : 0;
    }
    writeFileSync(BASELINE_PATH, serializeBaseline(baseline));
    const total = Object.values(baseline).reduce((a, b) => a + b, 0);
    console.log(
      `Wrote instruction-plane baseline: ${manifest.alwaysOn.length} files, ${total} bytes total (ratchet down as the split lands).`,
    );
    process.exit(0);
  }

  let baseline;
  try {
    baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-instruction-plane-size.mjs --update`,
    );
    process.exit(1);
  }

  const strict = process.argv.includes("--strict");
  const { errors, warnings, currentTotal, baselineTotal } = evaluate({
    manifest,
    fileTexts,
    baseline,
    strict,
  });

  for (const w of warnings) console.warn(`  [advisory] ${w}`);

  if (errors.length > 0) {
    console.error("Instruction-plane ratchet failed (BI-0020D511).\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("");
    console.error(
      "The always-on plane may only shrink. Move procedure to skills and history to spec/BI links,",
    );
    console.error(
      "or if the growth is intentional, justify it in the commit body and run --update to re-baseline.",
    );
    process.exit(1);
  }

  const approxTokens = Math.round(currentTotal / 4);
  console.log(
    `Instruction-plane OK — ${currentTotal} bytes across ${manifest.alwaysOn.length} always-on files ` +
      `(baseline ${baselineTotal}; ~${approxTokens} tokens advisory).` +
      (warnings.length ? ` ${warnings.length} advisory structural note(s).` : ""),
  );
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-instruction-plane-size.mjs")) {
  main();
}
