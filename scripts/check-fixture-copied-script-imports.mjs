#!/usr/bin/env node
// check-fixture-copied-script-imports.mjs — the test-fixture twin of
// check-dockerfile-copied-script-imports.mjs.
//
// Some contract tests build a throwaway tree by copying modules one at a time:
//
//   cpSync(join(repoRoot, "scripts", "lib", "x.mjs"), join(temp, "scripts", "lib", "x.mjs"));
//
// That couples the fixture to the import graph of every file it names. Give a
// copied module a new static import and the temp tree dies on
// ERR_MODULE_NOT_FOUND, while the module itself resolves everywhere else, so
// only the CI job that happens to run that test notices.
//
// Measured twice on 2026-09-25 in tests/release/pregate-node-gate-contract.test.mjs:
// sandbox-freshness.mjs gained `import ... from "./pnpm-lock.mjs"` (PR #5690) and
// gate-resume-pin.mjs gained `import ... from "./git.mjs"` (PR #5707). Both
// failed under Policy Guards (source) -> Janitor Tests.
//
// Invariant: when a test file copies a repo module into a temp tree, every
// relative module that copy statically imports must also be copied into the
// same place by that test file. v1 treats all copies in one test file as one
// set; it does not tell two temp trees in the same file apart.
//
// Recognised copy shapes (cpSync or copyFileSync):
//   copy(join(<root>, "lit", ...), join(<temp>, "lit", ...))
//   copy(<name>, join(<temp>, ...))  where  const <name> = join(<root>, "lit", ...)
//   for (const f of ["a.mjs", "b.mjs"]) copy(join(<root>, f), join(<temp>, f))
// <root> resolves through `fileURLToPath(new URL("<rel>", import.meta.url))`,
// `dirname(fileURLToPath(import.meta.url))`, or another such join. Anything else
// is not a recognised copy and is ignored. Node builtins and bare package
// imports are ignored: only relative specifiers can land inside the temp tree.
//
// Static imports come from the Dockerfile guard's parser, so both guards agree
// on what "statically imported" means (multi-line binding lists included).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { staticRelativeImports } from "./check-dockerfile-copied-script-imports.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(new URL(import.meta.url))), "..");

/** Directories scanned for `*.test.mjs` fixtures, repo-relative. */
export const SCAN_ROOTS = ["scripts", "tests", "packages"];

/**
 * Closed allowlist of fixtures that intentionally omit an import, keyed
 * `<test file>|<copied module>|<specifier>`. Empty: no current fixture omits
 * one on purpose. An entry needs a reason a reviewer can check.
 * @type {Record<string, string>}
 */
export const ALLOWLIST = {};

const COPY_FNS = new Set(["cpSync", "copyFileSync"]);
const JOIN_FNS = new Set(["join", "path.join", "resolve", "path.resolve"]);

/** Index just past the string literal that opens at `i`. */
function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== quote) j += src[j] === "\\" ? 2 : 1;
  return j + 1;
}

/**
 * Split the argument list of the call whose `(` sits at `open`.
 * @returns {{ args: string[], end: number } | null}
 */
export function readCallArgs(src, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i) - 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        const last = src.slice(start, i).trim();
        if (last) args.push(last);
        return { args, end: i + 1 };
      }
    } else if (ch === "," && depth === 1) {
      args.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

/** The value of a plain string literal (no template substitutions), else null. */
function literalValue(text) {
  const m = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/s.exec(text.trim());
  if (!m) return null;
  if (m[1] === "`" && m[2].includes("${")) return null;
  return m[2].replace(/\\(.)/g, "$1");
}

/** `const <name> = <expr>;` bindings; a name bound to two different texts is ambiguous (null). */
function collectBindings(src) {
  const bindings = new Map();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  for (const m of src.matchAll(re)) {
    const start = m.index + m[0].length;
    let depth = 0;
    let end = start;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === '"' || ch === "'" || ch === "`") {
        end = skipString(src, end) - 1;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth--;
      } else if ((ch === ";" || ch === "\n" || ch === ",") && depth === 0) break;
    }
    const text = src.slice(start, end).trim();
    const prior = bindings.get(m[1]);
    bindings.set(m[1], prior === undefined || prior === text ? text : null);
  }
  return bindings;
}

/**
 * Evaluate a path expression.
 *   { kind: "abs", path }        an absolute path on disk (under the test's own tree)
 *   { kind: "opaque", rel }      a path relative to an unknown root, e.g. a mkdtemp dir
 * or null when the expression is not a recognised shape.
 */
function evaluate(expr, ctx, loopVars, seen = new Set()) {
  const text = expr.trim();
  const lit = literalValue(text);
  if (lit !== null) return { kind: "literal", value: lit };
  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    if (loopVars.has(text)) return { kind: "literal", value: loopVars.get(text) };
    if (seen.has(text)) return null;
    const bound = ctx.bindings.get(text);
    if (bound == null) return { kind: "opaque", rel: "" };
    const value = evaluate(bound, ctx, loopVars, new Set([...seen, text]));
    return value && value.kind !== "literal" ? value : { kind: "opaque", rel: "" };
  }
  const url = /^fileURLToPath\(\s*new URL\(\s*(["'`][^"'`]*["'`])\s*,\s*import\.meta\.url\s*\)\s*\)$/.exec(text);
  if (url) return { kind: "abs", path: path.resolve(ctx.testDir, literalValue(url[1])) };
  if (/^(?:path\.)?dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)$/.test(text)) {
    return { kind: "abs", path: ctx.testDir };
  }
  const call = /^([\w$.]+)\s*\(/.exec(text);
  if (call && JOIN_FNS.has(call[1])) {
    const parsed = readCallArgs(text, call[0].length - 1);
    if (!parsed || parsed.end !== text.length || parsed.args.length === 0) return null;
    const base = evaluate(parsed.args[0], ctx, loopVars, seen);
    if (!base || base.kind === "literal") return null;
    const segments = [];
    for (const arg of parsed.args.slice(1)) {
      const seg = evaluate(arg, ctx, loopVars, seen);
      if (!seg || seg.kind !== "literal") return null;
      segments.push(seg.value);
    }
    return base.kind === "abs"
      ? { kind: "abs", path: path.resolve(base.path, ...segments) }
      : { kind: "opaque", rel: path.posix.join(base.rel || ".", ...segments) };
  }
  return null;
}

/** `for (const x of ["a", "b"])` loops over literal arrays, with their body ranges. */
function literalLoops(src) {
  const loops = [];
  const re = /\bfor\s*\(\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s+of\s*\[/g;
  for (const m of src.matchAll(re)) {
    const header = readCallArgs(src, src.indexOf("(", m.index));
    const array = readCallArgs(src, m.index + m[0].length - 1);
    if (!header || !array) continue;
    const values = array.args.map(literalValue);
    if (values.some((v) => v === null)) continue;
    let bodyStart = header.end;
    while (/\s/.test(src[bodyStart] ?? "")) bodyStart++;
    let bodyEnd;
    if (src[bodyStart] === "{") {
      const body = readCallArgs(src, bodyStart);
      bodyEnd = body ? body.end : src.length;
    } else {
      bodyEnd = src.indexOf(";", bodyStart);
      if (bodyEnd === -1) bodyEnd = src.length;
    }
    loops.push({ name: m[1], values, start: bodyStart, end: bodyEnd });
  }
  return loops;
}

/**
 * Every recognised copy in one test file.
 *
 * @param {string} source          test file text
 * @param {string} testFileAbs     absolute path of the test file
 * @returns {Array<{ src: string, dest: string }>}  src absolute, dest temp-relative (posix)
 */
export function findFixtureCopies(source, testFileAbs) {
  const ctx = { bindings: collectBindings(source), testDir: path.dirname(testFileAbs) };
  const loops = literalLoops(source);
  const copies = [];
  const re = /\b(cpSync|copyFileSync)\s*\(/g;
  for (const m of source.matchAll(re)) {
    if (!COPY_FNS.has(m[1])) continue;
    const call = readCallArgs(source, m.index + m[0].length - 1);
    if (!call || call.args.length < 2) continue;
    // Expand the enclosing literal loops (usually none, sometimes one).
    let envs = [new Map()];
    for (const loop of loops) {
      if (m.index < loop.start || m.index >= loop.end) continue;
      envs = envs.flatMap((env) => loop.values.map((v) => new Map([...env, [loop.name, v]])));
    }
    for (const env of envs) {
      const src = evaluate(call.args[0], ctx, env);
      const dest = evaluate(call.args[1], ctx, env);
      if (!src || src.kind !== "abs" || !dest || dest.kind !== "opaque" || !dest.rel) continue;
      copies.push({ src: src.path, dest: path.posix.normalize(dest.rel) });
    }
  }
  return copies;
}

/**
 * @param {Array<{ file: string, source: string }>} testFiles  file is repo-relative (posix)
 * @param {{ repoRoot: string, readSource: (abs: string) => string|null, isDirectory: (abs: string) => boolean }} io
 * @returns {Array<{ testFile: string, importer: string, importerDest: string, specifier: string, missing: string }>}
 */
export function findMissingFixtureImports(testFiles, io, allowlist = ALLOWLIST) {
  const violations = [];
  for (const { file, source } of testFiles) {
    const copies = findFixtureCopies(source, path.join(io.repoRoot, file));
    if (copies.length === 0) continue;
    const copiedFiles = new Set();
    const copiedDirs = [];
    for (const c of copies) {
      if (io.isDirectory(c.src)) copiedDirs.push(c.dest);
      else copiedFiles.add(c.dest);
    }
    const covered = (rel) => copiedFiles.has(rel) || copiedDirs.some((d) => rel.startsWith(`${d}/`));

    for (const copy of copies) {
      if (!/\.[cm]?js$/.test(copy.dest)) continue;
      const text = io.readSource(copy.src);
      if (text == null) continue;
      const importer = path.relative(io.repoRoot, copy.src).split(path.sep).join("/");
      for (const spec of staticRelativeImports(text)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(copy.dest), spec));
        // Outside the temp tree: not something this fixture can copy in.
        if (target === ".." || target.startsWith("../")) continue;
        if (covered(target)) continue;
        if (Object.hasOwn(allowlist, `${file}|${importer}|${spec}`)) continue;
        violations.push({ testFile: file, importer, importerDest: copy.dest, specifier: spec, missing: target });
      }
    }
  }
  return violations;
}

/** Repo-relative `*.test.mjs` files under SCAN_ROOTS, skipping node_modules and dot dirs. */
export function listTestFiles(repoRoot, roots = SCAN_ROOTS) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(path.join(repoRoot, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.isFile() && e.name.endsWith(".test.mjs")) out.push(child);
    }
  };
  for (const root of roots) walk(root);
  return out.sort();
}

function main() {
  const files = listTestFiles(REPO_ROOT).map((file) => ({
    file,
    source: readFileSync(path.join(REPO_ROOT, file), "utf8"),
  }));
  const violations = findMissingFixtureImports(files, {
    repoRoot: REPO_ROOT,
    readSource: (abs) => (existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf8") : null),
    isDirectory: (abs) => existsSync(abs) && statSync(abs).isDirectory(),
  });

  if (violations.length === 0) {
    console.log(
      `[fixture-script-imports] OK — ${files.length} test files scanned; every statically imported module of a fixture-copied script is copied too.`,
    );
    return;
  }

  console.error(
    "[fixture-script-imports] FAILED — a test copies a module into a temp tree but not the module it statically imports.",
  );
  console.error("That test dies with ERR_MODULE_NOT_FOUND before it reaches its assertion.\n");
  for (const v of violations) {
    console.error(`  ${v.testFile}: ${v.importer}`);
    console.error(`    imports ${v.specifier} -> <temp>/${v.missing} (not copied)`);
    console.error(`    add a cpSync of ${path.posix.join(path.posix.dirname(v.importer), v.specifier)} to <temp>/${v.missing}\n`);
  }
  process.exit(1);
}

if (isEntryModule(import.meta.url)) main();
