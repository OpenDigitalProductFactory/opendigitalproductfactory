#!/usr/bin/env node
/**
 * check-no-private-identity — CI ratchet: no NEW customer/company/person
 * identity in committed source.
 *
 * A docs PR once carried a real customer's legal entity into the OSS repo as a
 * "Customer 0" identity. Secret scanning (gitleaks) does not catch this: an
 * organization NAME is not secret-SHAPED. This guard closes that gap.
 *
 * It is a RATCHET, not a mass-scrub mandate (same shape as check-no-raw-route-
 * error + check-module-size): it freezes a per-file COUNT baseline of the
 * protected-identity tokens (scripts/private-identity-tokens.txt) and lets each
 * file only SHRINK. A NEW file, or MORE occurrences in an already-listed file,
 * fails CI. The baseline therefore encodes the audited, operator-approved set of
 * legitimate references (e.g. the public app-store publisher legal name in the
 * mobile store runbook / privacy policy) — those are allowed to stay; new
 * identity spread is blocked.
 *
 * WHY the Repo Guard Loop and not gitleaks/secrets-scan.yml: the secrets scan is
 * NOT a required status check, so it cannot block a merge. The Repo Guard Loop
 * IS required and runs on every PR regardless of author — the only surface-
 * agnostic chokepoint that actually stops the merge.
 *
 * The baseline is line-oriented (`<path>\t<count>`, sorted) with git
 * merge=union (.gitattributes) so concurrent PRs never conflict; duplicate
 * paths from a union merge resolve to the MAX count.
 *
 *   node scripts/check-no-private-identity.mjs            # check (CI)
 *   node scripts/check-no-private-identity.mjs --update   # regenerate baseline
 *
 * See docs/operations/oss-repo-identity-hygiene.md.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS_PATH = join(REPO_ROOT, "scripts", "private-identity-tokens.txt");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "private-identity-baseline.txt");

// Source trees that ship in the repo. Build output and vendored trees are
// excluded (they mirror source and would double-count).
const SCAN_DIRS = ["docs", "apps", "packages", "scripts", "services", ".github"];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".turbo",
  ".git",
  "dist",
  "build",
  "coverage",
  "__snapshots__",
  "playwright-report",
  "test-results",
  ".upgrade-workspace",
  ".claude",
]);

// Text extensions worth scanning. Binary/asset files are skipped.
const SCAN_EXT = new Set([
  ".md", ".mdx", ".markdown", ".html", ".htm", ".txt",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yml", ".yaml", ".css", ".scss", ".prisma", ".sql", ".sh",
]);

// Files that legitimately contain a token by construction — the denylist, the
// baseline (paths only), this guard, its test, and the policy doc. Excluded so
// the machinery does not flag itself.
const SELF_EXCLUDE = new Set(
  [
    "scripts/private-identity-tokens.txt",
    "scripts/private-identity-baseline.txt",
    "scripts/check-no-private-identity.mjs",
    "scripts/check-no-private-identity.test.mjs",
    "docs/operations/oss-repo-identity-hygiene.md",
  ].map((p) => p.replace(/\\/g, "/")),
);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse the denylist tokens file into one case-insensitive, word-bounded regex. */
export function buildTokenRegex(text) {
  const tokens = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (tokens.length === 0) return null;
  // \b only anchors on \w boundaries; wrap so multi-word / punctuated tokens
  // still match. Alternation of escaped literals.
  const body = tokens.map(escapeRegExp).join("|");
  return new RegExp(`\\b(?:${body})\\b`, "gi");
}

function ext(file) {
  const i = file.lastIndexOf(".");
  return i < 0 ? "" : file.slice(i).toLowerCase();
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      if (SCAN_EXT.has(ext(entry.name))) yield full;
    }
  }
}

/** Per-file count of protected-identity token matches across the scanned trees. */
export function scan(regex, { repoRoot = REPO_ROOT, scanDirs = SCAN_DIRS } = {}) {
  const counts = {};
  if (!regex) return counts;
  for (const rootName of scanDirs) {
    for (const file of walk(join(repoRoot, rootName))) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (SELF_EXCLUDE.has(rel)) continue;
      let body;
      try {
        body = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      regex.lastIndex = 0;
      const n = (body.match(regex) ?? []).length;
      if (n > 0) counts[rel] = n;
    }
  }
  return counts;
}

function serialize(counts) {
  const keys = Object.keys(counts).sort();
  if (keys.length === 0) return "";
  return `${keys.map((k) => `${k}\t${counts[k]}`).join("\n")}\n`;
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
  let tokenText;
  try {
    tokenText = readFileSync(TOKENS_PATH, "utf8");
  } catch {
    console.error(`Missing ${relative(REPO_ROOT, TOKENS_PATH)} — the denylist of protected tokens.`);
    process.exit(1);
  }
  const regex = buildTokenRegex(tokenText);
  const current = scan(regex);

  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, serialize(current));
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    console.log(
      `Wrote private-identity baseline: ${Object.keys(current).length} files, ${total} occurrences.`,
    );
    return;
  }

  let baseline;
  try {
    baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      `Missing ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-no-private-identity.mjs --update`,
    );
    process.exit(1);
  }

  const { grew, fresh } = diff(current, baseline);

  if (grew.length > 0 || fresh.length > 0) {
    console.error("");
    console.error("ERROR: private customer/company/person identity added to the OSS repo.");
    console.error("");
    console.error("A protected-identity token (scripts/private-identity-tokens.txt) appeared in a");
    console.error("NEW file, or MORE times in an already-listed file. Identity like this belongs in");
    console.error("the install's private config, not this public repo. Genericize it (see");
    console.error("docs/operations/oss-repo-identity-hygiene.md).");
    console.error("");
    if (fresh.length) {
      console.error("New files carrying protected identity:");
      for (const f of fresh) console.error(`  - ${f}`);
    }
    if (grew.length) {
      console.error("Files with MORE protected identity (baseline only allows shrinking):");
      for (const f of grew) console.error(`  - ${f}`);
    }
    console.error("");
    console.error("If this reference is genuinely legitimate and operator-approved (e.g. the public");
    console.error("app-store publisher name in a mobile/publishing doc), run --update to retighten");
    console.error("the baseline and call it out in the PR description for review.");
    process.exit(1);
  }

  const total = Object.values(baseline).reduce((a, b) => a + b, 0);
  console.log(
    `✓ No new private-identity leaks (baseline: ${Object.keys(baseline).length} files, ${total} audited occurrences).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
