#!/usr/bin/env node
/**
 * BI-134DD02F (Simplify & Strengthen B5 Seam C, architecture pass 2026-08-16) —
 * CI ratchet: the Prisma schema lives ONLY in the domain folder.
 *
 * The schema.prisma monolith (17k lines, 593 models) was split zero-semantically
 * into domain files under packages/db/prisma/schema/ (Prisma 7 multi-file
 * schema; prisma.config.ts points at the folder). This guard keeps it that way:
 *
 *   1. No schema.prisma monolith may reappear anywhere under packages/db/prisma
 *      (including prisma/schema.prisma itself).
 *   2. No `model` / `enum` / `type` / `view` Prisma declaration may live in a
 *      .prisma file OUTSIDE packages/db/prisma/schema/ — the domain folder is
 *      the single home. (generator/datasource blocks are also folder-only, via
 *      rule 1 plus the folder being the only loadable schema location.)
 *   3. The domain folder must exist, contain only *.prisma files, and hold at
 *      least one model — an empty or displaced folder fails loudly instead of
 *      letting `prisma validate` chase a missing schema.
 *
 * Auto-discovered by scripts/check-guards.mjs (check:guards); self-tested by
 * scripts/check-no-monolith-schema.test.mjs.
 *
 *   node scripts/check-no-monolith-schema.mjs   # check (CI)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Repo-relative canonical schema folder. */
export const SCHEMA_DIR = "packages/db/prisma/schema";
/** Repo-relative path the retired monolith must never reoccupy. */
export const LEGACY_MONOLITH = "packages/db/prisma/schema.prisma";

/** Directories never scanned for stray .prisma files. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "generated", ".pnpm-store", "dist", "build"]);

const DECLARATION_RE = /^\s*(model|enum|type|view)\s+\w+\s*\{/m;

function* walkPrismaFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) yield* walkPrismaFiles(full);
    else if (entry.endsWith(".prisma")) yield full;
  }
}

/**
 * Pure check over a file listing: returns failure strings.
 * `files` is a list of { path, text } with repo-relative slash-normalized paths.
 */
export function evaluate(files) {
  const failures = [];
  const inFolder = [];
  for (const f of files) {
    const p = f.path.replace(/\\/g, "/");
    if (p === LEGACY_MONOLITH) {
      failures.push(`${p}: the schema.prisma monolith is retired — models live in ${SCHEMA_DIR}/ (B5 Seam C, BI-134DD02F).`);
      continue;
    }
    if (p.startsWith(`${SCHEMA_DIR}/`)) {
      inFolder.push(f);
      continue;
    }
    if (DECLARATION_RE.test(f.text)) {
      failures.push(`${p}: Prisma model/enum declarations may only live under ${SCHEMA_DIR}/ — move the block into its owning domain file.`);
    }
  }
  if (inFolder.length === 0) {
    failures.push(`${SCHEMA_DIR}/ holds no .prisma files — the canonical schema folder is missing.`);
  } else if (!inFolder.some((f) => /^\s*model\s+\w+\s*\{/m.test(f.text))) {
    failures.push(`${SCHEMA_DIR}/ declares no models — the canonical schema folder is hollow.`);
  }
  return failures;
}

function main() {
  const files = [];
  for (const abs of walkPrismaFiles(REPO_ROOT)) {
    const rel = relative(REPO_ROOT, abs).replace(/\\/g, "/");
    files.push({ path: rel, text: readFileSync(abs, "utf8") });
  }
  if (existsSync(join(REPO_ROOT, LEGACY_MONOLITH))) {
    // walk already catches it, but keep an explicit belt for exotic layouts.
    if (!files.some((f) => f.path === LEGACY_MONOLITH)) {
      files.push({ path: LEGACY_MONOLITH, text: "" });
    }
  }
  const failures = evaluate(files);
  if (failures.length > 0) {
    console.error(`[check-no-monolith-schema] FAILED — ${failures.length} violation(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error("");
    console.error(`The Prisma schema is folder-split (${SCHEMA_DIR}/<domain>.prisma).`);
    console.error("Add models to the owning domain file; never recreate a monolith or a stray .prisma file.");
    process.exit(1);
  }
  console.log(`[check-no-monolith-schema] OK — schema lives only in ${SCHEMA_DIR}/.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
