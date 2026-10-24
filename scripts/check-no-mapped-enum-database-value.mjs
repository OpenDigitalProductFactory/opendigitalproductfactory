#!/usr/bin/env node
// scripts/check-no-mapped-enum-database-value.mjs — a Prisma query must spell a
// @map'd enum with its MEMBER, never with the database value.
//
// THE FAILURE THIS PREVENTS
//
// Every DPF enum whose values contain hyphens declares members with underscores
// and @maps them to the hyphenated database value:
//
//   post_implementation_review @map("post-implementation-review")
//
// Prisma accepts only the MEMBER in a query. The database spelling throws
// `Invalid value for argument 'gateKey'. Expected InitiativeGateKey.` at
// runtime — and rows read back carry the member too, so `row.gateKey ===
// "post-implementation-review"` silently never matches.
//
// Unit tests cannot catch either shape, because they mock Prisma and a mock
// does not enforce the enum. `structural-verification-is-not-functional`
// applies exactly here: the defect only appears on a live install.
//
// It has already shipped a feature completely broken: `declare_break_fix` in
// v2026.09.07-work-shape-taxonomy.1 (BI-D36E2916, fixed in PR #5185). Every
// unit test passed.
//
// THE RULE
//
// Inside a Prisma query block, a string literal assigned to a field whose type
// is a @map'd enum on THAT model must be a member, not a mapped database value.
//
// Scoped that tightly on purpose. The hyphenated spelling is the legitimate
// wire key nearly everywhere else — receipt schemas, tool grants, readiness
// codes, GATE_NAMES — so the same gate genuinely has two spellings in one file.
// Matching the bare string anywhere would be unusable noise. Only a literal
// standing where Prisma will parse it as an enum is a finding.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { isEntryModule } from "./lib/entry-module.mjs";

const QUERY_METHODS = [
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy", "updateMany", "deleteMany", "create", "createMany",
  "update", "upsert", "delete",
];

const ACCESSOR_RE = new RegExp(
  String.raw`\.\s*([a-z][A-Za-z0-9_]*)\s*\.\s*(${QUERY_METHODS.join("|")})\s*\(`,
  "g",
);

const SOURCE_FILE = /\.(?:[cm]?ts|[cm]?js)x?$/;
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "build", "coverage", ".turbo",
  "generated", ".pnpm-store", "prisma",
]);

export const ALLOWLIST = Object.freeze([
  "scripts/check-no-mapped-enum-database-value.mjs",
  "scripts/check-no-mapped-enum-database-value.test.mjs",
]);

export function toRepoPath(value) {
  return String(value).split(/[\\/]+/).join("/");
}

/**
 * Parse enums and model fields out of the split Prisma schema.
 *
 * Returns `enums`: enum name -> Map(databaseValue -> member), holding ONLY
 * members whose @map differs from the member itself; and `fields`: model name
 * -> Map(field -> enum name), for fields typed by one of those enums.
 */
export function parseSchema(schemaSources) {
  const enums = new Map();
  const fieldTypes = new Map();
  for (const source of schemaSources) {
    let block = null;
    let kind = null;
    for (const raw of String(source).split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      const open = line.match(/^(model|enum)\s+([A-Za-z0-9_]+)\s*\{/);
      if (open) {
        kind = open[1];
        block = open[2];
        if (kind === "enum" && !enums.has(block)) enums.set(block, new Map());
        if (kind === "model" && !fieldTypes.has(block)) fieldTypes.set(block, new Map());
        continue;
      }
      if (line === "}") { block = null; kind = null; continue; }
      if (!block) continue;
      if (kind === "enum") {
        const member = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:@map\("([^"]+)"\))?/);
        if (!member) continue;
        const mapped = member[2];
        // A member that maps to itself can never be spelled wrong.
        if (mapped && mapped !== member[1]) enums.get(block).set(mapped, member[1]);
        continue;
      }
      const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z0-9_]+)/);
      if (field) fieldTypes.get(block).set(field[1], field[2]);
    }
  }
  // Keep only fields whose type is an enum that has at least one mapped value.
  const fields = new Map();
  for (const [model, typed] of fieldTypes) {
    const mapped = new Map();
    for (const [field, type] of typed) {
      if (enums.has(type) && enums.get(type).size > 0) mapped.set(field, type);
    }
    if (mapped.size > 0) fields.set(model, mapped);
  }
  return { enums, fields };
}

export function accessorToModel(accessor) {
  return String(accessor).charAt(0).toUpperCase() + String(accessor).slice(1);
}

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
 * String literals assigned to `field` inside this block, covering the direct
 * form (`gateKey: "x"`), the filter forms (`gateKey: { equals: "x" }`) and the
 * list forms (`gateKey: { in: ["x", "y"] }`).
 */
export function literalsAssignedTo(block, field) {
  const found = [];
  const re = new RegExp(String.raw`\b${field}\s*:\s*(\{[^{}]*\}|"[^"]*"|'[^']*')`, "g");
  let match;
  while ((match = re.exec(String(block))) !== null) {
    const value = match[1];
    const strings = value.match(/["']([^"']+)["']/g) || [];
    for (const raw of strings) found.push(raw.slice(1, -1));
  }
  return found;
}

export function findMappedEnumDatabaseValues(source, schema) {
  const findings = [];
  const text = String(source);
  ACCESSOR_RE.lastIndex = 0;
  let call;
  while ((call = ACCESSOR_RE.exec(text)) !== null) {
    const model = accessorToModel(call[1]);
    const enumFields = schema.fields.get(model);
    if (!enumFields) continue;
    const block = extractCallBlock(text, call.index + call[0].length - 1);
    const line = text.slice(0, call.index).split("\n").length;
    for (const [field, enumName] of enumFields) {
      const mapped = schema.enums.get(enumName);
      for (const literal of literalsAssignedTo(block, field)) {
        const member = mapped.get(literal);
        if (!member) continue;
        findings.push({ line, model, field, enumName, used: literal, expected: member });
      }
    }
  }
  return findings;
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
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".prisma"))
      .map((name) => readFileSync(join(dir, name), "utf8"));
  } catch {
    return [];
  }
}

export function scanRepository(root, { allowlist = ALLOWLIST } = {}) {
  const schema = parseSchema(readSchemaSources(root));
  const offenders = [];
  if (schema.enums.size === 0) return { offenders, mappedEnums: 0 };
  const base = join(root, "apps");
  for (const file of listSourceFiles(base)) {
    const repoPath = `apps/${file}`;
    if (allowlist.includes(repoPath)) continue;
    const source = readFileSync(join(base, file), "utf8");
    if (!source.includes("-")) continue;
    const findings = findMappedEnumDatabaseValues(source, schema);
    if (findings.length) offenders.push({ file: repoPath, findings });
  }
  return { offenders, mappedEnums: schema.enums.size };
}

function main() {
  const root = resolve(process.cwd());
  const { offenders, mappedEnums } = scanRepository(root);
  if (mappedEnums === 0) {
    console.error("✗ No Prisma schema found under packages/db/prisma/schema — cannot judge enum spellings.");
    process.exitCode = 1;
    return;
  }
  if (offenders.length === 0) {
    console.log(`✓ Every Prisma query spells a @map'd enum with its member (${mappedEnums} enums).`);
    return;
  }
  const total = offenders.reduce((n, o) => n + o.findings.length, 0);
  console.error(
    `✗ ${total} Prisma query value(s) using a mapped DATABASE spelling instead of the enum member, ` +
    `in ${offenders.length} file(s).\n` +
    "  Prisma accepts only the member; the database spelling throws at runtime, and a\n" +
    "  mocked Prisma in a unit test will not catch it (BI-D36E2916 shipped broken).\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}`);
    for (const f of o.findings) {
      console.error(`    L${f.line}  ${f.model}.${f.field} (${f.enumName}): "${f.used}" -> ${f.expected}`);
    }
  }
  console.error("\n  Rows read back carry the member too, so normalise for display:");
  console.error("  value?.replaceAll(\"_\", \"-\") — see entry-adapter.ts normalizeGate.");
  process.exitCode = 1;
}

if (isEntryModule(import.meta.url)) main();
