#!/usr/bin/env node
// Client/server boundary guard — BI-25EF1456.
//
// THE FAILURE THIS PREVENTS
//
// A "use client" component imports a lib module for a label map or a status
// vocabulary, and that module — or something it imports — pulls in `@dpf/db`,
// `server-only`, or a Node built-in. Nothing local notices: vitest resolves it,
// `tsc` type-checks it, the dev server may even serve it. The production build
// is the first thing that fails, with "Module not found: Can't resolve 'fs'"
// pointing at Prisma, twenty minutes into CI. Twice in the 2026-09-17 session
// (daily-care and adoption) the fix was the same split into a `*-vocabulary.ts`
// client-safe module. This guard finds the edge in under a second.
//
// WHAT IT CHECKS (diff-scoped, like the clock-bomb guard)
//
// For each changed TypeScript file under apps/web it collects the "use client"
// modules that are affected — the changed file itself if it is a client module,
// and every client module that imports a changed file directly — then walks
// value imports (not `import type`) through `./`, `../` and `@/` specifiers.
// A module that imports a server-only surface ends the walk with a finding; a
// `"use server"` module ends it cleanly, because Next replaces server actions
// with references at the boundary. `.server.ts` modules are server by name.
//
// HOW TO FIX A FINDING
//
//   Move the values the client needs (labels, enums, pure formatters) into a
//   client-safe module with no server imports — the `*-vocabulary.ts` pattern
//   under apps/web/lib — and import that from the component.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { exitUnresolvable, listChangedFiles } from "./lib/git-changed-files.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = "apps/web";
const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?tsx?$/;
const DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["'](use client|use server)["']\s*;?/;

/** Specifiers that can never be bundled into a browser. */
export const SERVER_ONLY_SPECIFIERS = new Set([
  "@dpf/db",
  "server-only",
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "net",
  "node:net",
  "tls",
  "node:tls",
  "child_process",
  "node:child_process",
  "dns",
  "node:dns",
]);

/** `import x from "y"`, `import {a} from "y"`, `export {a} from "y"`, `import "y"` — value imports only. */
const IMPORT_RE = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^"'\n;]*?\s+from\s+)?["']([^"']+)["']/g;

export function directiveOf(source) {
  const match = DIRECTIVE.exec(source);
  return match ? match[1] : null;
}

/** Value-import specifiers of a module (type-only imports are erased by the compiler and cannot reach a bundle). */
export function valueImportSpecifiers(source) {
  const out = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const [, , typeOnly, specifier] = match;
    if (typeOnly) continue;
    out.push(specifier);
  }
  return out;
}

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", "/index.ts", "/index.tsx"];

/** Resolve a `./`, `../` or `@/` specifier to a repo-relative path, or null for packages and unknowns. */
export function resolveLocalImport(fromFile, specifier, { exists = (p) => existsSync(join(REPO_ROOT, p)) && !isDir(p) } = {}) {
  let candidate;
  if (specifier.startsWith("@/")) candidate = join(WEB_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) candidate = join(dirname(fromFile), specifier);
  else return null;
  candidate = candidate.split(sep).join("/");
  for (const suffix of RESOLVE_SUFFIXES) {
    const path = `${candidate}${suffix}`;
    if (exists(path)) return path;
  }
  return null;
}

function isDir(p) {
  try {
    return statSync(join(REPO_ROOT, p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk value imports from a client module. Returns the first server-only edge as
 * `{ chain: [files...], specifier }`, or null when the module is client-safe.
 * `read(path)` returns the module source or null.
 */
export function findServerImportChain(clientFile, { read, resolveImport = resolveLocalImport, maxDepth = 12 } = {}) {
  const seen = new Set();
  const stack = [{ file: clientFile, chain: [clientFile], depth: 0 }];
  while (stack.length) {
    const { file, chain, depth } = stack.pop();
    if (seen.has(file) || depth > maxDepth) continue;
    seen.add(file);
    const source = read(file);
    if (source == null) continue;
    if (file !== clientFile) {
      if (directiveOf(source) === "use server") continue;
      if (/\.server\.[cm]?tsx?$/.test(file)) return { chain, specifier: file };
    }
    for (const specifier of valueImportSpecifiers(source)) {
      if (SERVER_ONLY_SPECIFIERS.has(specifier)) return { chain, specifier };
      const next = resolveImport(file, specifier);
      if (next && !seen.has(next)) stack.push({ file: next, chain: [...chain, next], depth: depth + 1 });
    }
  }
  return null;
}

function listSourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(join(REPO_ROOT, d), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
      const path = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/** Client modules affected by the change: changed client files plus client files that import a changed file directly. */
export function affectedClientModules(changed, { allSources, read, resolveImport = resolveLocalImport }) {
  const changedSet = new Set(changed);
  const affected = new Set();
  for (const file of allSources) {
    const source = read(file);
    if (source == null || directiveOf(source) !== "use client") continue;
    if (changedSet.has(file)) {
      affected.add(file);
      continue;
    }
    for (const specifier of valueImportSpecifiers(source)) {
      const target = resolveImport(file, specifier);
      if (target && changedSet.has(target)) {
        affected.add(file);
        break;
      }
    }
  }
  return [...affected].sort();
}

function resolveBase() {
  const value = process.env.BASE_SHA || process.env.BASE_REF || process.env.DPF_PREPUSH_BASE_REF || "origin/main";
  if (!/^[\w./-]+$/.test(value)) {
    console.error(`[client-boundary] refusing suspicious base ref: ${JSON.stringify(value)}`);
    process.exit(1);
  }
  return value;
}

function main() {
  const base = resolveBase();
  const listed = listChangedFiles(base);
  if (listed.status === "unresolvable") exitUnresolvable("client-boundary", base, listed.detail);
  const changed = listed.files.filter((f) => f.startsWith(`${WEB_ROOT}/`) && SOURCE_FILE.test(f) && !TEST_FILE.test(f));
  if (changed.length === 0) {
    console.log("✓ Client/server boundary guard: this change touches no apps/web source files.");
    return;
  }
  const cache = new Map();
  const read = (file) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, readFileSync(join(REPO_ROOT, file), "utf8"));
      } catch {
        cache.set(file, null);
      }
    }
    return cache.get(file);
  };
  const allSources = [...listSourceFiles(`${WEB_ROOT}/app`), ...listSourceFiles(`${WEB_ROOT}/components`), ...listSourceFiles(`${WEB_ROOT}/lib`)];
  const clients = affectedClientModules(changed, { allSources, read });
  if (clients.length === 0) {
    console.log(`✓ Client/server boundary guard: no "use client" module is affected by ${changed.length} changed file(s).`);
    return;
  }
  const findings = [];
  for (const client of clients) {
    const chain = findServerImportChain(client, { read });
    if (chain) findings.push({ client, ...chain });
  }
  if (findings.length === 0) {
    console.log(`✓ ${clients.length} affected "use client" module(s) reach no server-only import.`);
    return;
  }
  console.error(`✗ ${findings.length} "use client" module(s) reach a server-only import. The production build will fail with "Module not found" — vitest and tsc cannot see this.\n`);
  for (const f of findings) {
    console.error(`  ${f.client}`);
    f.chain.slice(1).forEach((hop, i) => console.error(`    ${"  ".repeat(i)}→ ${hop}`));
    console.error(`    ${"  ".repeat(Math.max(0, f.chain.length - 1))}→ ${f.specifier}   ← server-only`);
  }
  console.error("\n  Fix: move the values the client needs (labels, enums, pure formatters) into a");
  console.error("  client-safe module with no server imports (the `*-vocabulary.ts` pattern) and import that.");
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
