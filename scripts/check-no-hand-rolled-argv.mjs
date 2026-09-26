#!/usr/bin/env node
/**
 * Plan 2026-09-08 §10.5 S2: CI ratchet on hand-written CLI argument parsing in scripts/.
 *
 * Scripts used to carry more than thirty local `parseArgs` loops, each with its
 * own answer to missing values, `--flag=value`, repeated flags and unknown
 * flags. The single home is Node's built-in parser, which adds no dependency:
 *
 *   import { parseArgs as utilParseArgs } from "node:util";
 *
 * A script that tolerated unknown flags keeps doing so with `strict: false`.
 * A thin local adapter that maps `values` onto the shape its callers use is
 * fine; the tokenising is what must not be hand-written.
 *
 * This guard flags, outside comments:
 *   1. process.argv indexed with anything but [1] (the entry-module check),
 *      searched (indexOf / findIndex / ...), or iterated (for...of, forEach,
 *      map, filter, ...), including on process.argv.slice(n);
 *   2. the same flag-lookup shapes on a local copy named argv / args
 *      (`args.indexOf(flag)`, `argv[++i]`, `args.shift()`);
 *   3. a function named like a parser (parseArgs, parseXArgs, parseArgv,
 *      parseFlags, parseArguments, parseCli...) in a file that does not use
 *      node:util parseArgs.
 * `process.argv.slice(2)` handed on whole and `process.argv.includes("--flag")`
 * presence checks are not flagged: neither can mis-consume a value.
 *
 * ALLOWLIST is closed: each entry names why the file legitimately remains.
 * Delete an entry when its file moves to util.parseArgs. Do NOT add entries.
 *
 * Scope: scripts/**\/*.mjs, tests excluded.
 *
 * Run: node scripts/check-no-hand-rolled-argv.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "scripts/check-no-hand-rolled-argv.mjs";

const POSITIONAL = "reads one positional by literal index and parses no flags; util.parseArgs positionals would skip a leading flag and change what it reads";

// Closed. Remove entries as files migrate; never add.
export const ALLOWLIST = new Map([
  ["scripts/apply-runtime-capability-transition.mjs", "promoter contract: the transition id is accepted only as argv[2] === \"--runtime-capability-transition\" followed by argv[3]"],
  ["scripts/bind-worktree-cli.mjs", POSITIONAL],
  ["scripts/hooks/run-hook.mjs", POSITIONAL],
  ["scripts/installer/validate-install-state.mjs", POSITIONAL],
  ["scripts/lib/git-fetch-shared-safe.mjs", POSITIONAL],
  ["scripts/lib/git-shallow-preflight.mjs", POSITIONAL],
  ["scripts/lib/local-ci-failure-summary.mjs", POSITIONAL],
  ["scripts/merge-readiness-policy.mjs", POSITIONAL],
  ["scripts/pr-health.mjs", POSITIONAL],
  ["scripts/semantic-review-gate.mjs", POSITIONAL],
]);

const ARRAY_WALK = "indexOf|lastIndexOf|findIndex|findLastIndex|find|findLast|forEach|map|flatMap|filter|reduce|some|every|entries|keys|values|at|shift|splice";
const ARGV = String.raw`process\s*\.\s*argv`;
// A local copy, not process.argv itself (rule 1 covers that).
const LOCAL = String.raw`(?<![.\w$])(?:argv|args|argList|rawArgs|cliArgs)`;

export const RULES = [
  { id: "argv-index", pattern: new RegExp(String.raw`${ARGV}\s*\[(?!\s*1\s*\])`, "g") },
  { id: "argv-walk", pattern: new RegExp(String.raw`${ARGV}(?:\s*\.\s*slice\([^)]*\))?\s*\.\s*(?:${ARRAY_WALK})\s*\(`, "g") },
  { id: "argv-slice-index", pattern: new RegExp(String.raw`${ARGV}\s*\.\s*slice\([^)]*\)\s*\[`, "g") },
  { id: "argv-loop", pattern: new RegExp(String.raw`\b(?:of|in)\s+${ARGV}\b`, "g") },
  { id: "local-flag-lookup", pattern: new RegExp(String.raw`${LOCAL}\s*\.\s*(?:indexOf|lastIndexOf|findIndex)\s*\(`, "g") },
  { id: "local-value-consume", pattern: new RegExp(String.raw`${LOCAL}\s*\[\s*\+\+\s*\w+\s*\]|${LOCAL}\s*\.\s*shift\s*\(\s*\)`, "g") },
];

const PARSER_NAME = /^\s*(?:export\s+)?(?:async\s+)?function\s+(parse(?:\w*(?:Args|Argv|Arguments|Flags)|Cli\w*))\s*\(|^\s*(?:export\s+)?const\s+(parse(?:\w*(?:Args|Argv|Arguments|Flags)|Cli\w*))\s*=/gm;
const USES_UTIL_PARSER = /import\s*\{[^}]*\bparseArgs\b[^}]*\}\s*from\s*["']node:util["']|\butil\s*\.\s*parseArgs\s*\(/;

function lineOf(body, index) {
  return body.slice(0, index).split("\n").length;
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Every hand-rolled argument-parsing site in `body`: { line, rule, text }. */
export function findHandRolledArgv(body) {
  const lines = body.split(/\r?\n/);
  const hits = [];
  const add = (index, rule) => {
    const line = lineOf(body, index);
    const text = lines[line - 1] ?? "";
    if (isCommentLine(text)) return;
    if (hits.some((h) => h.line === line && h.rule === rule)) return;
    hits.push({ line, rule, text: text.trim() });
  };
  for (const { id, pattern } of RULES) {
    for (const match of body.matchAll(pattern)) add(match.index, id);
  }
  if (!USES_UTIL_PARSER.test(body)) {
    for (const match of body.matchAll(PARSER_NAME)) add(match.index + match[0].search(/\S/), "hand-rolled-parser");
  }
  return hits.sort((a, b) => a.line - b.line);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "fixtures" || entry === "__fixtures__") continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && full.endsWith(".mjs") && !full.endsWith(".test.mjs")) yield full;
  }
}

/** Hand-rolled parsing outside the allowlist. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const file of walk(join(root, "scripts"))) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel === SELF || ALLOWLIST.has(rel)) continue;
    for (const h of findHandRolledArgv(readFileSync(file, "utf8"))) violations.push({ file: rel, ...h });
  }
  return violations;
}

/** Allowlisted files that no longer hand-roll argv access: stale entries to prune. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const stale = [];
  for (const rel of ALLOWLIST.keys()) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel);
      continue;
    }
    if (findHandRolledArgv(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();
  if (violations.length > 0) {
    console.error("\nERROR: a script parses its command line by hand.\n");
    console.error("Declare the flags and let Node parse them (strict: false if unknown flags must be tolerated):");
    console.error('  import { parseArgs as utilParseArgs } from "node:util";\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error(`\nERROR: stale ALLOWLIST entries in ${SELF} (delete them):`);
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ No hand-rolled argument parsing in scripts/ (${ALLOWLIST.size} allowlisted positional readers).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
