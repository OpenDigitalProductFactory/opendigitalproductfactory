#!/usr/bin/env node
// scripts/gen-architecture-counts.mjs
//
// BI-79BCE3F2 (Simplify & Strengthen W8, pass §3.5) — generate the volatile
// architecture counts from source instead of hand-maintaining them in prose.
//
// THE PROBLEM IT FIXES: hand-typed counts diverge immediately at this repo's
// production rate — kernel principles were cited as 157/95/101/92 across four
// docs while 87 sat on disk; model counts drifted within a day. A number a
// human retypes is a number that lies (same class of defect as the BET-5 doc
// staleness, PR #3871 — this follows that generated-artifact pattern).
//
// THE FIX: one generated include, docs/architecture/architecture-counts.generated.md,
// derived from the artifacts that actually decide each number. Registered in
// scripts/lib/derived-artifacts-registry.mjs, so pre-commit regenerates it when
// a source changes and CI (`derived-artifacts-gate.mjs check-all`) fails on
// staleness. Living docs LINK the include instead of retyping the numbers.
//
// Deliberately timestamp-free: the content changes only when a count changes,
// so `--check` is a byte comparison and re-runs are idempotent.
//
//   node scripts/gen-architecture-counts.mjs           # write the include
//   node scripts/gen-architecture-counts.mjs --check   # CI staleness gate

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPrismaSchemaText } from "./lib/prisma-schema-source.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = path.join(REPO_ROOT, "docs", "architecture", "architecture-counts.generated.md");

export function countsFromSources({
  schemaText,
  migrationEntries,
  principleFiles,
  routeManifest,
}) {
  return {
    models: (schemaText.match(/^model /gm) ?? []).length,
    enums: (schemaText.match(/^enum /gm) ?? []).length,
    migrations: migrationEntries.filter((name) => /^\d{14}_/.test(name)).length,
    principles: principleFiles.filter((name) => name.endsWith(".md")).length,
    routes: routeManifest.routeCount ?? (routeManifest.routes?.length ?? 0),
  };
}

export function renderCounts(counts) {
  return `# Architecture counts (generated)

<!-- GENERATED FILE — do not edit. Regenerate: node scripts/gen-architecture-counts.mjs -->

Generated from source by \`scripts/gen-architecture-counts.mjs\` (registered in the
derived-artifacts registry — a stale copy fails CI). Cite these numbers by LINKING
this file; never retype them into prose, where they drift (Simplify & Strengthen pass §3.5).

| Count | Value | Source of truth |
|---|---:|---|
| Prisma models | ${counts.models} | \`packages/db/prisma/schema/\` |
| Prisma enums | ${counts.enums} | \`packages/db/prisma/schema/\` |
| Migrations | ${counts.migrations} | \`packages/db/prisma/migrations/\` |
| Kernel principles | ${counts.principles} | \`docs/founder-kernel/wiki/principles/\` |
| App routes | ${counts.routes} | \`apps/web/lib/ea/route-manifest.json\` |
`;
}

export function generate() {
  const schemaText = readPrismaSchemaText(REPO_ROOT);
  const migrationEntries = fs.readdirSync(path.join(REPO_ROOT, "packages", "db", "prisma", "migrations"));
  const principleFiles = fs.readdirSync(path.join(REPO_ROOT, "docs", "founder-kernel", "wiki", "principles"));
  const routeManifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "apps", "web", "lib", "ea", "route-manifest.json"), "utf8"),
  );
  return renderCounts(countsFromSources({ schemaText, migrationEntries, principleFiles, routeManifest }));
}

function main() {
  const next = generate();
  if (process.argv.includes("--check")) {
    let current = null;
    try {
      current = fs.readFileSync(OUT_PATH, "utf8");
    } catch { /* missing counts as stale */ }
    if (current !== next) {
      console.error("[architecture-counts] STALE — docs/architecture/architecture-counts.generated.md does not match source.");
      console.error("Regenerate and commit: node scripts/gen-architecture-counts.mjs");
      process.exit(1);
    }
    console.log("[architecture-counts] fresh.");
    return;
  }
  fs.writeFileSync(OUT_PATH, next);
  console.log(`[architecture-counts] wrote ${path.relative(REPO_ROOT, OUT_PATH)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
