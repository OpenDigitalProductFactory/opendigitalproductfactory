#!/usr/bin/env node
// scripts/check-no-unguarded-not-contains.mjs — a Prisma `NOT … contains` on a
// NULLABLE column must carry its `{ column: null }` companion.
//
// THE FAILURE THIS PREVENTS
//
// SQL is three-valued. `NOT (body LIKE '%marker%')` is NULL — not TRUE — when
// `body` IS NULL, and Prisma passes that straight through, so every row whose
// column is NULL silently disappears from the result. Nothing errors. The query
// looks obviously correct, and the rows it drops are exactly the ones nobody
// wrote prose for.
//
// It has already cost a production incident: 29 epics never synced because a
// federation read model filtered `NOT: { description: { contains: marker } }`
// on a nullable column (#5007). The fix shipped as the OR-with-null form and is
// visible in apps/web/lib/federation/work-page.ts:
//
//   OR: [{ body: null }, { NOT: { body: { contains: MARKER } } }]
//
// That fix was applied file by file, so the SHAPE was never guarded — and this
// guard's first run found the same defect still live in the sibling module
// apps/web/lib/federation/demand-read-model.ts, on the same nullable column,
// in the same federation feature.
//
// THE RULE
//
// Inside a Prisma query block, a `contains` that sits under a `NOT` is a
// finding when the column is nullable in the model that block queries, unless
// the same block also matches that column against null.
//
// Nullability comes from packages/db/prisma/schema/*.prisma, so the guard
// tracks the schema instead of a hand-maintained list: make a column nullable
// tomorrow and the guard starts protecting it. A block whose model cannot be
// resolved lexically is reported as unresolved and does NOT fail the run —
// `report-only-the-verdict-you-reached` applies to guards too, and a guard that
// guesses is worse than one that says it could not tell.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { isEntryModule } from "./lib/entry-module.mjs";

/** Query methods whose first argument carries a `where`. */
const QUERY_METHODS = [
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy", "updateMany", "deleteMany",
];

/** `<receiver>.<model>.<method>(` — receiver is prisma/db/tx/store/client/etc. */
const ACCESSOR_RE = new RegExp(
  String.raw`\.\s*([a-z][A-Za-z0-9_]*)\s*\.\s*(${QUERY_METHODS.join("|")})\s*\(`,
  "g",
);

const SOURCE_FILE = /\.(?:[cm]?ts|[cm]?js)x?$/;
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "build", "coverage", ".turbo",
  "generated", ".pnpm-store", "prisma",
]);

/** Files allowed to carry the shape; each names the trap in prose, not in code. */
export const ALLOWLIST = Object.freeze([
  "scripts/check-no-unguarded-not-contains.mjs",
  "scripts/check-no-unguarded-not-contains.test.mjs",
]);

export function toRepoPath(value) {
  return String(value).split(/[\\/]+/).join("/");
}

/**
 * Nullable scalar fields per model, read from the split Prisma schema.
 *
 * Only `Type?` counts. A list (`String[]`) is never NULL in Postgres and a
 * relation has no LIKE to be NOT-ed, so neither can produce this defect.
 */
export function parseNullableFields(schemaSources) {
  const models = new Map();
  for (const source of schemaSources) {
    let model = null;
    for (const raw of String(source).split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      const open = line.match(/^model\s+([A-Za-z0-9_]+)\s*\{/);
      if (open) {
        model = open[1];
        if (!models.has(model)) models.set(model, new Set());
        continue;
      }
      if (line === "}") { model = null; continue; }
      if (!model) continue;
      const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z0-9_]+)(\?)?/);
      if (field && field[3] === "?") models.get(model).add(field[1]);
    }
  }
  return models;
}

/** `discoveredModel` -> `DiscoveredModel`, the accessor-to-model convention. */
export function accessorToModel(accessor) {
  return String(accessor).charAt(0).toUpperCase() + String(accessor).slice(1);
}

/**
 * The argument block of the call whose `(` sits at `openIndex`, by brace
 * matching. Bounded so a malformed file cannot walk the whole source.
 */
export function extractCallBlock(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex);
}

/**
 * Columns compared with `contains` underneath a `NOT` in this block.
 *
 * Deliberately lexical: it looks for `NOT` and then reads the `column: {`
 * headers that precede a `contains` within the NOT's own braces. Both the
 * object form (`NOT: { body: { contains } }`) and the array form
 * (`NOT: [{ body: { contains } }]`) are covered, because the array form is what
 * the live defect used.
 */
export function notContainsColumns(block) {
  const columns = [];
  const text = String(block);
  const notRe = /\bNOT\s*:\s*([[{])/g;
  let match;
  while ((match = notRe.exec(text)) !== null) {
    const openChar = match[1];
    const closeChar = openChar === "[" ? "]" : "}";
    let depth = 0;
    let end = text.length;
    for (let i = match.index + match[0].length - 1; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === openChar) depth += 1;
      else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = text.slice(match.index, end);
    const columnRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{[^{}]*\bcontains\b/g;
    let column;
    while ((column = columnRe.exec(body)) !== null) columns.push(column[1]);
  }
  return [...new Set(columns)];
}

/** Does the block match this column against null anywhere (the companion)? */
export function hasNullCompanion(block, column) {
  return new RegExp(String.raw`\b${column}\s*:\s*null\b`).test(String(block));
}

/**
 * Every finding in one file. `unresolved` entries are reported but never fail
 * the run: the model could not be read lexically, so the guard cannot know
 * whether the column is nullable.
 */
export function findUnguardedNotContains(source, nullableByModel) {
  const findings = [];
  const unresolved = [];
  const text = String(source);
  ACCESSOR_RE.lastIndex = 0;
  let call;
  while ((call = ACCESSOR_RE.exec(text)) !== null) {
    const accessor = call[1];
    const block = extractCallBlock(text, call.index + call[0].length - 1);
    const columns = notContainsColumns(block);
    if (columns.length === 0) continue;
    const model = accessorToModel(accessor);
    const line = text.slice(0, call.index).split("\n").length;
    const nullable = nullableByModel.get(model);
    if (!nullable) {
      unresolved.push({ line, model, columns });
      continue;
    }
    for (const column of columns) {
      if (!nullable.has(column)) continue;
      if (hasNullCompanion(block, column)) continue;
      findings.push({ line, model, column });
    }
  }
  return { findings, unresolved };
}

export function listSourceFiles(root) {
  const acc = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        acc.push(toRepoPath(relative(root, join(dir, entry.name))));
      }
    }
  };
  walk(root);
  return acc.sort();
}

export function readSchemaSources(root) {
  const dir = join(root, "packages", "db", "prisma", "schema");
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".prisma"))
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

export function scanRepository(root, { allowlist = ALLOWLIST } = {}) {
  const schemaSources = readSchemaSources(root);
  const nullableByModel = parseNullableFields(schemaSources);
  const offenders = [];
  const unresolved = [];
  if (nullableByModel.size === 0) {
    return { offenders, unresolved, schemaModels: 0 };
  }
  for (const file of listSourceFiles(join(root, "apps"))) {
    const repoPath = `apps/${file}`;
    if (allowlist.includes(repoPath)) continue;
    const source = readFileSync(join(root, "apps", file), "utf8");
    if (!source.includes("NOT")) continue;
    const result = findUnguardedNotContains(source, nullableByModel);
    if (result.findings.length) offenders.push({ file: repoPath, findings: result.findings });
    if (result.unresolved.length) unresolved.push({ file: repoPath, entries: result.unresolved });
  }
  return { offenders, unresolved, schemaModels: nullableByModel.size };
}

function main() {
  const root = resolve(process.cwd());
  const { offenders, schemaModels } = scanRepository(root);
  if (schemaModels === 0) {
    console.error("✗ No Prisma schema found under packages/db/prisma/schema — cannot judge nullability.");
    process.exitCode = 1;
    return;
  }
  if (offenders.length === 0) {
    console.log(`✓ Every Prisma NOT-contains on a nullable column carries its null companion (${schemaModels} models).`);
    return;
  }
  const total = offenders.reduce((n, o) => n + o.findings.length, 0);
  console.error(
    `✗ ${total} NOT-contains on a nullable column without a null companion, in ${offenders.length} file(s).\n` +
    "  NOT (col LIKE '%x%') is NULL, not TRUE, when col IS NULL, so every row with a\n" +
    "  NULL in that column is silently dropped. This cost 29 epics never syncing (#5007).\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}`);
    for (const f of o.findings) console.error(`    L${f.line}  ${f.model}.${f.column}`);
  }
  console.error("\n  Fix: OR: [{ col: null }, { NOT: { col: { contains: X } } }]");
  console.error("  See apps/web/lib/federation/work-page.ts for the shape.");
  process.exitCode = 1;
}

if (isEntryModule(import.meta.url)) main();
