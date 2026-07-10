#!/usr/bin/env node
/**
 * BI-11AC7524 — Static guard: no TYPE RE-EXPORT from a "use server" module.
 *
 * Background: a Next.js/turbopack "use server" file has EVERY named export
 * enumerated into the runtime server-reference registry — the compiler emits
 * `ensureServerEntryExports([... , X])` + `registerServerReference(X, hash)`
 * for each export so the client can call it as a server action. That is fine
 * for `export async function foo()` (the only thing a "use server" file is
 * meant to export), but a TYPE RE-EXPORT — `export type { Foo }` or
 * `export { type Foo }` — puts a reference to `Foo` in that runtime array.
 * `Foo` is a type: it is ERASED at emit, so at module-eval time the runtime
 * references an identifier that does not exist →
 *   `ReferenceError: Foo is not defined`
 * which poisons the whole co-bundled server-actions chunk and 500s EVERY route
 * that imports anything from it (this is exactly how the AI-coworker
 * conversation load 500'd on /ops and /employee via the workbooks Grid — see
 * BI-303E1BD6 / #2753). The build gate stays GREEN because the failure is a
 * request-time module-eval error, not a compile error — so only a static guard
 * catches it.
 *
 * IMPORTANT — this bans only the RE-EXPORT form, which references an (erased)
 * imported binding. It does NOT ban inline type declarations
 * (`export type X = ...`, `export interface X { ... }`): those introduce a pure
 * type with no runtime binding and are correctly erased — they do not leak and
 * are a normal, useful way for a "use server" module to publish its I/O shapes.
 *
 * Fix a violation by importing the type for internal use and letting callers
 * import it from the SOURCE (non-"use server") module instead of re-exporting
 * it from the action module.
 *
 * Run: node scripts/check-no-type-reexport-in-use-server.mjs
 * Exit 0 = clean; exit 1 = violations (with a clear, actionable report).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  join(ROOT, "apps", "web", "app"),
  join(ROOT, "apps", "web", "components"),
  join(ROOT, "apps", "web", "lib"),
];

// `export type { … }`  and  `export { … type X … }` — the two syntactic forms
// that re-export an (erased) type binding from the module's export surface.
export const EXPORT_TYPE_BLOCK = /^\s*export\s+type\s*\{/;
export const EXPORT_BLOCK_WITH_TYPE = /^\s*export\s*\{[^}]*\btype\s+\w/;

// A "use server" directive is a string-literal statement that is the first
// executable line of the module (leading comments/blank lines are allowed).
export function isUseServerModule(lines) {
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    return line === '"use server";' || line === "'use server';" ||
           line === '"use server"' || line === "'use server'";
  }
  return false;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (["node_modules", ".next", "__snapshots__", "dist", "public", "coverage"].includes(entry)) continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (/\.(test|spec)\.[cm]?tsx?$/.test(full) || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

// Scan a single file's already-split lines for the banned re-export forms.
// Exported so the self-test can exercise it without touching the filesystem.
export function findViolationsInLines(lines) {
  if (!isUseServerModule(lines)) return [];
  const found = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (EXPORT_TYPE_BLOCK.test(line) || EXPORT_BLOCK_WITH_TYPE.test(line)) {
      found.push({ line: i + 1, text: trimmed.slice(0, 100) });
    }
  });
  return found;
}

function main() {
const violations = [];

for (const baseDir of SCAN_DIRS) {
  for (const file of walk(baseDir)) {
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = body.split(/\r?\n/);
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    for (const v of findViolationsInLines(lines)) {
      violations.push(`${rel}:${v.line}  ${v.text}`);
    }
  }
}

if (violations.length > 0) {
  console.error("");
  console.error('ERROR: BI-11AC7524 — a "use server" module re-exports a TYPE.');
  console.error("");
  console.error('Every named export of a "use server" file is registered as a runtime server');
  console.error("reference. A type re-export (`export type { X }` / `export { type X }`) puts an");
  console.error("erased identifier in that runtime array → `ReferenceError: X is not defined` at");
  console.error("module eval → a request-time 500 on every route importing this module. CI build");
  console.error("+ typecheck stay green (the error is runtime-only), so this static guard is the");
  console.error("only catch. See BI-303E1BD6 / #2753 (coworker 500 on /ops + /employee).");
  console.error("");
  console.error("Fix: import the type for internal use, and let callers import it from the SOURCE");
  console.error('(non-"use server") module. Inline `export type X = …` / `export interface X` are');
  console.error("fine — only the re-export of a type binding leaks.");
  console.error("");
  for (const v of violations) console.error("  " + v);
  console.error("");
  process.exit(1);
}

  console.log('✓ No type re-exports from "use server" modules (BI-11AC7524).');
}

// Run the scan only when invoked directly, not when imported by the self-test.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
