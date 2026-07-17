#!/usr/bin/env node
/**
 * BI-16B32BA3 — CI ratchet: no NEW `superpowers:<skill>` references in specs/plans.
 *
 * The upstream superpowers skill pack was retired and replaced by DPF-native
 * equivalents (docs/superpowers/specs/2026-05-30-dpf-native-skill-equivalents-design.md):
 * `dpf-tdd`, `dpf-local-merge-ci-before-push`, `dpf-pr-with-dco`, etc. But ~275
 * historical plans still open with a "REQUIRED: use
 * `superpowers:subagent-driven-development` …" preamble, and new plans are
 * written by imitating old ones — so every surface (Claude, Codex, Grok,
 * Build Studio) keeps copying retired skill names forward, and an executing
 * agent that takes the line literally looks for skills that do not exist
 * (observed live: the 2026-07-17 data-management-governance plan inherited it
 * and had to be fixed by hand).
 *
 * This is a RATCHET, not a mass-rewrite mandate (same shape as
 * check-no-raw-route-error): it freezes a per-file COUNT baseline of
 * `superpowers:<skill>` references under docs/superpowers/{plans,specs} and
 * lets each file only SHRINK. A new file, or MORE references in a listed file,
 * fails CI. Historical done-plan text stays as-is; only the propagation path
 * is closed.
 *
 * The baseline is line-oriented (`<path>\t<count>`, sorted) with git
 * merge=union (.gitattributes) so concurrent cleanup PRs never conflict;
 * duplicate paths from a union merge resolve to the MAX count.
 *
 *   node scripts/check-no-retired-superpowers-skills.mjs            # check (CI)
 *   node scripts/check-no-retired-superpowers-skills.mjs --update   # regenerate baseline
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = [
  join(REPO_ROOT, "docs", "superpowers", "plans"),
  join(REPO_ROOT, "docs", "superpowers", "specs"),
];
const BASELINE_PATH = join(REPO_ROOT, "scripts", "superpowers-skill-baseline.txt");

// An invocation-style reference to a retired upstream skill, e.g.
// `superpowers:subagent-driven-development`. Deliberately does NOT match the
// directory path `docs/superpowers/…` (no colon) or prose like
// "superpowers:*" (no skill slug).
export const RETIRED_SKILL_RE = /\bsuperpowers:[a-z][a-z0-9-]+/g;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile()) {
      if (!full.endsWith(".md") && !full.endsWith(".html")) continue;
      yield full;
    }
  }
}

/** Per-file count of retired `superpowers:<skill>` references. */
export function scan() {
  const counts = {};
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      const body = readFileSync(file, "utf8");
      const n = (body.match(RETIRED_SKILL_RE) ?? []).length;
      if (n > 0) counts[rel] = n;
    }
  }
  return counts;
}

function serialize(counts) {
  return `${Object.keys(counts)
    .sort()
    .map((k) => `${k}\t${counts[k]}`)
    .join("\n")}\n`;
}

/** Parse `<path>\t<count>` lines; union-merge duplicates resolve to MAX. */
export function parseBaseline(text) {
  const counts = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    const [, file, n] = m;
    const count = Number(n);
    if (!(file in counts) || count > counts[file]) counts[file] = count;
  }
  return counts;
}

export function diff(current, baseline) {
  const grew = [];
  const fresh = [];
  for (const [file, n] of Object.entries(current)) {
    if (file in baseline) {
      if (n > baseline[file]) grew.push(`${file} (${baseline[file]} -> ${n})`);
    } else {
      fresh.push(`${file} (${n})`);
    }
  }
  return { grew, fresh };
}

function main() {
  const current = scan();

  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, serialize(current));
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    console.log(
      `Wrote superpowers-skill baseline: ${Object.keys(current).length} files, ${total} retired references.`,
    );
    return;
  }

  let baseline;
  try {
    baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      `Missing ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-no-retired-superpowers-skills.mjs --update`,
    );
    process.exit(1);
  }

  const { grew, fresh } = diff(current, baseline);

  if (grew.length > 0 || fresh.length > 0) {
    console.error("");
    console.error("ERROR: BI-16B32BA3 — new reference(s) to retired `superpowers:*` skills.");
    console.error("");
    console.error("Those upstream skills no longer exist in this repo. Use the DPF-native");
    console.error("equivalents in plan/spec preambles instead:");
    console.error("  dpf-tdd, dpf-local-merge-ci-before-push (+ the per-BI completion");
    console.error("  gate), dpf-pr-with-dco — see the dpf-writing-plans skill and");
    console.error("  docs/superpowers/specs/2026-05-30-dpf-native-skill-equivalents-design.md");
    console.error("");
    if (fresh.length) {
      console.error("New files referencing retired skills:");
      for (const f of fresh) console.error(`  - ${f}`);
    }
    if (grew.length) {
      console.error("Files that GREW retired references (baseline only allows shrinking):");
      for (const f of grew) console.error(`  - ${f}`);
    }
    console.error("");
    console.error("If you intentionally CLEANED a file (count dropped), run --update to retighten.");
    process.exit(1);
  }

  const total = Object.values(baseline).reduce((a, b) => a + b, 0);
  console.log(
    `✓ No new retired superpowers-skill references (baseline: ${Object.keys(baseline).length} files, ${total} pending cleanup).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
