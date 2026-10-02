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
 * It also flags a node:util parseArgs call that tolerates positionals
 * (`allowPositionals: true` or `strict: false`) whose `args` do not come from
 * scriptArgv (scripts/lib/script-argv.mjs). pnpm 10 forwards the `--` in
 * `pnpm <script> -- --flag v` literally, and such a call reads every flag
 * after it as a positional: the flag is silently ignored, not refused.
 * Accepted: `args: scriptArgv(...)`, `args` naming a const/let bound to
 * `scriptArgv(...)`, an array literal (not a command line), or an ARGS_EXEMPT
 * entry. A strict call
 * that refuses positionals fails loudly on its own and is not flagged.
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

// The scan must see the tree it guards: an empty walk is not a clean one.
export const MIN_FILES_SCANNED = 300;
export const MIN_PERMISSIVE_CALLS = 45;

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

// Shipped into the promoter / installer from an explicit file list (promoter-contract.json,
// Dockerfile.promoter.dockerignore) and run by promote.sh or the installer with node, never
// through pnpm. Importing script-argv.mjs would widen the promoter contract for a `--` that
// cannot arrive.
const PROMOTER = "promoter/installer runtime: run with node by promote.sh or the installer, never through pnpm; script-argv.mjs is not in its file list";
const TERMINATOR = "a leading `--` is this script's own terminator (the command follows it), never one pnpm forwarded: it is run with node, flags first";

// parseArgs calls whose `args` must not pass through scriptArgv. Keyed by
// file, then by the exact `args` expression. Closed: never add a pnpm script's argv here.
export const ARGS_EXEMPT = new Map([
  ["scripts/sbom/check-typecheck-baseline.mjs", new Map([["report.args ?? []", "the tsc argument list recorded in a run-tsc report, not this script's argv"]])],
  ["scripts/host-resource-runner.mjs", new Map([["argv", TERMINATOR]])],
  ["scripts/apply-runtime-capability-transition.mjs", new Map([["process.argv.slice(2)", PROMOTER]])],
  ["scripts/installer/install-release-assets.mjs", new Map([["argv", PROMOTER]])],
  ["scripts/installer/install-state-transaction.mjs", new Map([["argv", PROMOTER]])],
  ["scripts/installer/migrate-install-state.mjs", new Map([["argv", PROMOTER]])],
  ["scripts/lib/resolve-capability-compose-profiles.mjs", new Map([["argv", PROMOTER]])],
  ["scripts/rotate-runtime-transition-secret.mjs", new Map([["args", PROMOTER]])],
  ["scripts/runtime-transition-authority.mjs", new Map([["process.argv.slice(2)", PROMOTER]])],
  ["scripts/salvage-sweep.mjs", new Map([["argv", PROMOTER]])],
  ["scripts/local-ci-durable-wait-resumer.mjs", new Map([["argv", TERMINATOR]])],
]);

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

/**
 * Blank comments (and, with `strings`, string/template contents) to spaces,
 * keeping every index and newline in place so offsets map back to `body`.
 */
export function maskSource(body, { strings }) {
  const out = body.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  let i = 0;
  let prev = "";
  while (i < body.length) {
    const c = body[i];
    const next = body[i + 1];
    if (c === "/" && next === "/") {
      const end = body.indexOf("\n", i);
      const stop = end === -1 ? body.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = body.indexOf("*/", i + 2);
      const stop = end === -1 ? body.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`" || (c === "/" && /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < body.length) {
        const d = body[j];
        if (d === "\\") { j += 2; continue; }
        if (c === "/") {
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) break;
          else if (d === "\n") break;
        } else if (d === c) break;
        j++;
      }
      if (strings) blank(i + 1, j);
      i = j + 1;
      prev = c;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

const OPEN = { "(": ")", "[": "]", "{": "}" };

/** Index of the bracket closing the one at `open` in masked `code`, or -1. */
function closingIndex(code, open) {
  const stack = [];
  for (let k = open; k < code.length; k++) {
    const c = code[k];
    if (OPEN[c]) stack.push(OPEN[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return k;
    }
  }
  return -1;
}

/** [from, to) ranges of the depth-0, comma-separated members between `from` and `to`. */
function topLevelMembers(code, from, to) {
  const members = [];
  let depth = 0;
  let start = from;
  for (let k = from; k < to; k++) {
    const c = code[k];
    if (OPEN[c]) depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      members.push([start, k]);
      start = k + 1;
    }
  }
  members.push([start, to]);
  return members.filter(([a, b]) => code.slice(a, b).trim() !== "");
}

const UTIL_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']node:util["']/g;
const UTIL_NAMESPACE = /import\s+(?:\*\s+as\s+)?([\w$]+)\s+from\s*["']node:util["']/g;
const SCRIPT_ARGV_IMPORT = /import\s*\{[^}]*\bscriptArgv\b[^}]*\}\s*from\s*["'][^"']*\/script-argv\.mjs["']/;

/** The callee patterns that reach node:util parseArgs in this file. */
function utilParseArgsCallees(noComments) {
  const callees = [];
  for (const m of noComments.matchAll(UTIL_IMPORT)) {
    for (const spec of m[1].split(",")) {
      const named = spec.trim().match(/^parseArgs(?:\s+as\s+([\w$]+))?$/);
      if (named) callees.push(String.raw`(?<![\w$.]|function\s+)${named[1] ?? "parseArgs"}\s*\(`);
    }
  }
  for (const m of noComments.matchAll(UTIL_NAMESPACE)) {
    callees.push(String.raw`(?<![\w$.])${m[1]}\s*\.\s*parseArgs\s*\(`);
  }
  return callees;
}

/**
 * Every node:util parseArgs call in `body` that tolerates positionals, with
 * whether its `args` are normalised by scriptArgv:
 * { line, permissive: true, ok, reason, args }.
 */
export function findPermissiveParseArgs(body, file = "") {
  const noComments = maskSource(body, { strings: false });
  const code = maskSource(body, { strings: true });
  const exempt = ARGS_EXEMPT.get(file) ?? new Map();
  const importsScriptArgv = SCRIPT_ARGV_IMPORT.test(noComments);
  const calls = [];
  for (const callee of utilParseArgsCallees(noComments)) {
    for (const m of code.matchAll(new RegExp(callee, "g"))) {
      const open = m.index + m[0].length - 1;
      const close = closingIndex(code, open);
      const line = lineOf(body, m.index);
      const first = code.slice(open + 1, close).search(/\S/);
      const argStart = open + 1 + first;
      if (close === -1 || first === -1 || code[argStart] !== "{") {
        calls.push({ line, ok: false, reason: "options-not-literal", args: "" });
        continue;
      }
      const objEnd = closingIndex(code, argStart);
      const props = new Map();
      let spread = false;
      for (const [a, b] of topLevelMembers(code, argStart + 1, objEnd)) {
        const text = noComments.slice(a, b).trim();
        if (text.startsWith("...")) { spread = true; continue; }
        const kv = text.match(/^([\w$]+)\s*:\s*([\s\S]*)$/);
        if (kv) props.set(kv[1], kv[2].trim());
        else if (/^[\w$]+$/.test(text)) props.set(text, text);
      }
      const literal = (key, value) => props.has(key) && props.get(key) === value;
      const strictOff = props.has("strict") && !literal("strict", "true");
      const positionalsOn = props.has("allowPositionals") && !literal("allowPositionals", "false");
      if (!strictOff && !positionalsOn && !spread) continue;
      const args = props.get("args");
      let ok = false;
      let reason = "";
      if (args === undefined) {
        reason = spread ? "options-not-literal" : "args-default";
      } else if (/^\[/.test(args) || exempt.has(args)) {
        ok = true;
      } else if (/^scriptArgv\s*\(/.test(args)) {
        ok = importsScriptArgv;
        reason = ok ? "" : "scriptArgv-not-imported";
      } else if (/^[\w$]+$/.test(args)
        && new RegExp(String.raw`\b(?:const|let)\s+${args.replace(/\$/g, "\\$")}\s*=\s*scriptArgv\s*\(`).test(code)) {
        ok = importsScriptArgv;
        reason = ok ? "" : "scriptArgv-not-imported";
      } else {
        reason = "args-not-scriptArgv";
      }
      calls.push({ line, ok, reason, args: args ?? "" });
    }
  }
  return calls.sort((a, b) => a.line - b.line);
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

/**
 * Permissive util parseArgs calls across scripts/ whose args skip scriptArgv.
 * Returns { violations, filesScanned, permissiveCalls } so the caller can
 * refuse a scan that saw too little to mean anything.
 */
export function scanPermissiveParseArgs(root = REPO_ROOT) {
  const violations = [];
  let filesScanned = 0;
  let permissiveCalls = 0;
  for (const file of walk(join(root, "scripts"))) {
    const rel = relative(root, file).replace(/\\/g, "/");
    filesScanned++;
    for (const call of findPermissiveParseArgs(readFileSync(file, "utf8"), rel)) {
      permissiveCalls++;
      if (!call.ok) violations.push({ file: rel, line: call.line, rule: call.reason, text: `args: ${call.args || "(none)"}` });
    }
  }
  return { violations, filesScanned, permissiveCalls };
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
  const permissive = scanPermissiveParseArgs();
  if (permissive.filesScanned < MIN_FILES_SCANNED || permissive.permissiveCalls < MIN_PERMISSIVE_CALLS) {
    console.error(`\nERROR: the scan saw ${permissive.filesScanned} files and ${permissive.permissiveCalls} permissive parseArgs calls;`);
    console.error(`expected at least ${MIN_FILES_SCANNED} and ${MIN_PERMISSIVE_CALLS}. A scan that sees nothing proves nothing.\n`);
    process.exit(1);
  }
  if (permissive.violations.length > 0) {
    console.error("\nERROR: a parseArgs call tolerates positionals but reads args that skip scriptArgv.\n");
    console.error("pnpm 10 forwards `--` literally, so `pnpm <script> -- --flag v` silently drops --flag. Route the args through:");
    console.error('  import { scriptArgv } from "./lib/script-argv.mjs";   // args: scriptArgv(argv)\n');
    for (const v of permissive.violations) console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ No hand-rolled argument parsing in scripts/ (${ALLOWLIST.size} allowlisted positional readers).`);
  console.log(`✓ ${permissive.permissiveCalls} permissive parseArgs calls in ${permissive.filesScanned} files all read scriptArgv.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
