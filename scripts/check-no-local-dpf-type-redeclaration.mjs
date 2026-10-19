#!/usr/bin/env node
/**
 * Plan 2026-09-08 §10.5 S9 — CI ratchet: no NEW copy of a `@dpf/types` type.
 *
 * `@dpf/types` is the wire contract shared by the portal, the API client and
 * the mobile app. Copies of its types had grown beside the routes that produce
 * them, and they drifted: `MeResponse.platformRole` was `string | null` at the
 * route and `string` in the contract, and the mobile activity feed rendered
 * `action` / `target` / `actor` while the route sent `title` / `status` /
 * `type` / `updatedAt`. The copies are gone; routes now import the contract and
 * check what they return with `satisfies <Type>`.
 *
 * This guard reads every exported type and interface name from
 * packages/types/src and flags a declaration of the same name anywhere else in
 * apps/, packages/ or services/. Import lists (`type Foo,`) and re-exports
 * (`export type { Foo }`) are not declarations and never match.
 *
 * ALLOWLIST is closed: each entry is a different concept that shares a name,
 * with the reason recorded. Do NOT add entries for a copy of the contract —
 * import it from `@dpf/types`. If a name collision is genuinely a different
 * concept, prefer renaming the local type over allowlisting it.
 *
 * Run: node scripts/check-no-local-dpf-type-redeclaration.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The one sanctioned home for the shared wire types.
export const CANONICAL_DIR = "packages/types/src";

// Trees scanned for copies.
export const SCAN_ROOTS = ["apps", "packages", "services"];

// `generated` holds the Prisma client, whose model types share names with the entity DTOs by design.
const SKIP_DIRS = new Set(["node_modules", "generated", ".next", ".expo", "dist", "build", "coverage", ".turbo"]);

// Closed. Key: "<repo-relative file>::<TypeName>". Value: why it is not a copy.
export const ALLOWLIST = new Map([
  [
    "apps/web/lib/queue/queue-types.ts::WorkItemStatus",
    "The full work-queue lifecycle (10 states). @dpf/types WorkItemStatus is the 4-state field check-in/out projection the mobile My Jobs surface uses.",
  ],
  [
    "apps/web/lib/workbooks/types.ts::FieldType",
    "Workbook column types (formula, lookup, rollup, currency, ...). @dpf/types FieldType is the dynamic-form field kind (camera, signature, location, ...).",
  ],
  [
    "packages/db/src/backlog-recovery-bundle.ts::JsonValue",
    "Strict serialized JSON for the backlog recovery bundle (no undefined members). @dpf/types JsonValue admits undefined members to accept Prisma JSON; packages/db does not depend on @dpf/types.",
  ],
]);

const EXPORT_NAME = /^export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;

/** Exported type and interface names declared in the canonical package source. */
export function contractTypeNames(root = REPO_ROOT) {
  const names = new Set();
  const dir = join(root, CANONICAL_DIR);
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".ts")) continue;
    const body = readFileSync(join(dir, entry), "utf8");
    for (const m of body.matchAll(EXPORT_NAME)) names.add(m[1]);
  }
  return names;
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

// `type Foo =` / `type Foo<T> =` or `interface Foo`, optionally exported/declared.
const DECLARATION = /^\s*(?:export\s+)?(?:declare\s+)?(?:type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=|interface\s+([A-Za-z_$][\w$]*)\b)/;

/** 1-based line numbers of declarations in `body` whose name is in `names`. */
export function findRedeclarations(body, names) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    const m = DECLARATION.exec(line);
    if (!m) continue;
    const name = m[1] ?? m[2];
    if (names.has(name)) hits.push({ line: i + 1, name, text: line.trim() });
  }
  return hits;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile() && /\.(?:ts|tsx|mts|cts)$/.test(entry) && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}

/** Every declaration of a contract name outside the canonical package, allowlisted ones excluded. */
export function scanRepo(root = REPO_ROOT) {
  const names = contractTypeNames(root);
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel.startsWith(`${CANONICAL_DIR}/`)) continue;
      for (const h of findRedeclarations(readFileSync(file, "utf8"), names)) {
        if (ALLOWLIST.has(`${rel}::${h.name}`)) continue;
        violations.push({ file: rel, ...h });
      }
    }
  }
  return violations;
}

/** Allowlist entries whose declaration no longer exists — stale, to prune. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const names = contractTypeNames(root);
  const stale = [];
  for (const key of ALLOWLIST.keys()) {
    const [rel, name] = key.split("::");
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(key);
      continue;
    }
    if (!names.has(name) || !findRedeclarations(body, new Set([name])).length) stale.push(key);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();
  if (violations.length > 0) {
    console.error("\nERROR: a type from @dpf/types is declared again outside packages/types.\n");
    console.error("Import the shared contract instead, and check route payloads with `satisfies`:");
    console.error('  import type { MeResponse } from "@dpf/types";');
    console.error("  return apiSuccess({ ... } satisfies MeResponse);\n");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error("\nERROR: stale ALLOWLIST entries in scripts/check-no-local-dpf-type-redeclaration.mjs:");
    for (const k of stale) console.error(`  ${k}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ No @dpf/types type is redeclared outside ${CANONICAL_DIR} (${ALLOWLIST.size} allowlisted name collisions).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
