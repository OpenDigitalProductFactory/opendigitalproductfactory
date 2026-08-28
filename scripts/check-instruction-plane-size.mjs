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

import { globSync, readFileSync, writeFileSync } from "node:fs";
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
 * YAML frontmatter fields of a SKILL.md-style doc, as `key: value` pairs.
 * Deliberately shallow: only top-level scalar keys, which is all the harness
 * reads when it builds the session skill listing. A value may be quoted and may
 * span continuation lines (indented, or a `>`/`|` block) — those are included,
 * because the harness pays for them too.
 */
export function frontmatterFields(text, fields) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const want = new Set(fields);
  const out = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (kv) {
      key = want.has(kv[1]) ? kv[1] : null;
      if (key) out[key] = kv[2].trim();
    } else if (key && /^\s+\S/.test(line)) {
      out[key] += `\n${line.trim()}`;
    } else if (!/^\s/.test(line)) {
      key = null;
    }
  }
  return out;
}

/**
 * Resolve one `alwaysOnExtracted` group to its measured byte total.
 *
 * WHY THIS TIER EXISTS
 * `alwaysOn` measures whole files the POINTER forces. It cannot see the plane
 * the HARNESS injects: Claude Code (and Codex) load every installed skill's
 * frontmatter `name` + `description` into the system prompt of every session,
 * while the skill BODY stays progressive-disclosure. Measuring the whole
 * SKILL.md would over-count ~16x; measuring nothing lets Phase 1 "win" by
 * moving prose out of AGENTS.md and into skill descriptions — shrinking the
 * baseline while the true always-on cost is unchanged. That is the same
 * evasion manifest closure blocks one layer up.
 *
 * TWO DIFFERENT MEASURES COME OUT OF THIS, AND THEY ARE NOT INTERCHANGEABLE
 *   `bytes`            — UTF-8 bytes of the whole serialised `name: …\ndescription: …\n`
 *                        block. This is what the HARNESS pays for, per session, and it
 *                        is what the ratchet totals. Ours to choose a budget for.
 *   `descriptionChars` — CHARACTERS in the `description` value alone. This is what the
 *                        Agent Skills API validates against its hard 1,024-character
 *                        ceiling. Not ours to choose: over it, the skill is rejected.
 *
 * Conflating them would be a real bug — a 1,100-byte block whose description is 400
 * chars is fine by the API and merely fat, while a 1,030-char description is a platform
 * validation failure no byte budget would catch.
 *
 * @returns {{ id: string, bytes: number, items: Array<{ file: string, bytes: number, descriptionChars: number, description: string }> }}
 */
export function extractGroup(group, repoRoot) {
  const fields = Array.isArray(group.fields) ? group.fields : ["name", "description"];
  const files = globSync(group.glob, { cwd: repoRoot }).sort();
  const items = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    const parsed = frontmatterFields(text, fields);
    // `key: value\n` is what the harness serialises, so bill the key too.
    const bytes = fields.reduce(
      (n, f) => (parsed[f] == null ? n : n + byteLen(`${f}: ${parsed[f]}\n`)),
      0,
    );
    const description = parsed.description ?? "";
    // [...str] counts code points, not UTF-16 units — an emoji or CJK glyph is one
    // character to the API's validator, two to `.length`.
    items.push({
      file: file.replace(/\\/g, "/"),
      bytes,
      descriptionChars: [...description].length,
      description,
    });
  }
  return { id: group.id, bytes: items.reduce((a, b) => a + b.bytes, 0), items };
}

export function extractGroups(manifest, repoRoot) {
  const groups = Array.isArray(manifest.alwaysOnExtracted) ? manifest.alwaysOnExtracted : [];
  return groups.map((g) => extractGroup(g, repoRoot));
}

/**
 * Contingency markers in an always-on doc, by kind.
 *
 * THREE KINDS, THREE CLOCKS — this is the whole point of keeping them separate:
 *   ⟦runtime: …⟧  drifts with the ENVIRONMENT (version pins, host literals, install
 *                 shape, in-flight states). Re-verify against the install. BI-ACC7A2B5.
 *   ⟦model:   …⟧  drifts with MODEL RELEASES. A rule written to compensate for a model's
 *                 tendency can invert on the next upgrade — Opus 4.8 needed prompting to
 *                 delegate to subagents, Opus 5 needs a cap; Opus 4.8 wanted verification
 *                 instructions, Opus 5 documents that they cause over-verification and
 *                 should be deleted. Nothing else in this repo tracks that clock, so a
 *                 rule tuned for one model silently becomes wrong prose in the always-on
 *                 plane. Re-verify on model upgrade. BI-0020D511 §12d.
 *   ⟦situational: …⟧ drifts with CIRCUMSTANCE — business phase, customer mix, team size, a
 *                 regulatory moment. The generalisation of the other two: a rule that reads
 *                 as absolute but was a response to conditions. Carries its own review
 *                 trigger because no external clock ticks for it.
 *
 * A marker that is never grepped is worthless, so `malformed` (an opener with no `⟧`)
 * is reported as a HARD error by the caller rather than being silently skipped.
 *
 * @returns {{ runtime: number, model: number, situational: number,
 *             malformed: Array<{ kind: string, line: number }> }}
 */
export function assumptionMarkers(text) {
  const counts = { runtime: 0, model: 0, situational: 0, malformed: [] };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const opener = /⟦(runtime|model|situational):/g;
    let m;
    while ((m = opener.exec(lines[i])) !== null) {
      // Markers are single-line by construction; a missing close means a broken grep.
      if (lines[i].indexOf("⟧", m.index) === -1) {
        counts.malformed.push({ kind: m[1], line: i + 1 });
      } else {
        counts[m[1]] += 1;
      }
    }
  }
  return counts;
}

/** Baseline key for an extracted group — namespaced so it cannot collide with a path. */
export const extractedKey = (id) => `extracted:${id}`;

/**
 * Pure evaluation, exported for tests.
 * @returns {{ errors: string[], warnings: string[], currentTotal: number, baselineTotal: number }}
 */
export function evaluate({ manifest, fileTexts, baseline, strict, extracted = [] }) {
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

  // 1b. Same ratchet over the harness-injected (extracted) tier.
  const maxItem = Number(manifest.maxExtractedItemChars) || Infinity;
  // The Agent Skills API rejects a `description` over 1,024 CHARACTERS. Unlike every
  // other threshold in this guard that is a budget we chose and ship advisory, this one
  // is a platform limit: exceed it and the skill fails validation at install. So it is
  // HARD regardless of `structuralStrict` / `--strict`, and it is deliberately NOT the
  // same measure as maxExtractedItemChars (see extractGroup's header).
  const maxDescription = Number(manifest.maxDescriptionChars) || Infinity;
  for (const group of extracted) {
    const key = extractedKey(group.id);
    currentTotal += group.bytes;
    const base = baseline[key];
    if (base != null) baselineTotal += base;
    if (base != null && group.bytes > base) {
      errors.push(
        `${key} grew ${base} -> ${group.bytes} bytes (always-on plane may only shrink) — ` +
          `skill descriptions are injected into every session; tighten them, do not relocate prose into them`,
      );
    } else if (base == null) {
      errors.push(`${key} is in the manifest but missing from the baseline — run --update`);
    }
    for (const item of group.items) {
      if (item.bytes > maxItem) {
        const msg =
          `${item.file} always-on frontmatter is ${item.bytes} bytes (> ${maxItem}) — ` +
          `a description states WHEN to use the skill; the how-to belongs in the body`;
        // `extractedItemStrict` makes the per-description budget hard WITHOUT waiting on
        // `structuralStrict`. The structural signal is Phase-0 advisory because the AGENTS.md
        // split has not landed; skill descriptions are already separate files, so their budget
        // has no reason to be gated on that split. BI-58F6755A.
        const itemStrict =
          strict || manifest.structuralStrict === true || manifest.extractedItemStrict === true;
        (itemStrict ? errors : warnings).push(msg);
      }
      if (item.descriptionChars > maxDescription) {
        errors.push(
          `${item.file} description is ${item.descriptionChars} characters (hard limit ${maxDescription}) — ` +
            `the Agent Skills API rejects a description over ${maxDescription} chars; this is a platform ` +
            `limit, not a DPF budget. Move the how-to into the SKILL.md body.`,
        );
      } else if (item.descriptionChars > maxDescription * 0.9) {
        // Advisory shoulder: the hard failure mode is an install-time rejection, which is
        // a bad place to discover it. 995/1024 today — flag the approach, not just the hit.
        warnings.push(
          `${item.file} description is ${item.descriptionChars} of ${maxDescription} characters ` +
            `(${Math.round((item.descriptionChars / maxDescription) * 100)}% of the hard API limit) — ` +
            `little headroom before the skill fails validation`,
        );
      }
    }
  }

  // 1c. Contingency markers — a malformed one breaks the grep the convention rests on.
  const markers = { runtime: 0, model: 0, situational: 0 };
  for (const file of alwaysOn) {
    const text = fileTexts[file];
    if (text == null) continue;
    const found = assumptionMarkers(text);
    markers.runtime += found.runtime;
    markers.model += found.model;
    markers.situational += found.situational;
    for (const bad of found.malformed) {
      errors.push(
        `${file}:${bad.line} has an unterminated ⟦${bad.kind}:⟧ marker — the convention is only ` +
          `useful because it greps cleanly; close it with ⟧ on the same line`,
      );
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

  return { errors, warnings, currentTotal, baselineTotal, markers };
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
  const extracted = extractGroups(manifest, REPO_ROOT);

  if (process.argv.includes("--update")) {
    const baseline = {};
    for (const file of manifest.alwaysOn) {
      baseline[file] = fileTexts[file] != null ? byteLen(fileTexts[file]) : 0;
    }
    for (const group of extracted) baseline[extractedKey(group.id)] = group.bytes;
    writeFileSync(BASELINE_PATH, serializeBaseline(baseline));
    const total = Object.values(baseline).reduce((a, b) => a + b, 0);
    console.log(
      `Wrote instruction-plane baseline: ${manifest.alwaysOn.length} files + ${extracted.length} extracted group(s), ${total} bytes total (ratchet down as the split lands).`,
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
  const { errors, warnings, currentTotal, baselineTotal, markers } = evaluate({
    manifest,
    fileTexts,
    baseline,
    strict,
    extracted,
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
  const extractedTotal = extracted.reduce((a, g) => a + g.bytes, 0);
  const extractedNote = extracted.length
    ? ` + ${extractedTotal} bytes harness-injected across ${extracted.reduce((a, g) => a + g.items.length, 0)} skill frontmatters`
    : "";
  console.log(
    `Instruction-plane OK — ${currentTotal} bytes across ${manifest.alwaysOn.length} always-on files${extractedNote} ` +
      `(baseline ${baselineTotal}; ~${approxTokens} tokens advisory).` +
      ` Contingency markers: ${markers.runtime} ⟦runtime⟧ / ${markers.model} ⟦model⟧ / ${markers.situational} ⟦situational⟧.` +
      (warnings.length ? ` ${warnings.length} advisory structural note(s).` : ""),
  );
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-instruction-plane-size.mjs")) {
  main();
}
