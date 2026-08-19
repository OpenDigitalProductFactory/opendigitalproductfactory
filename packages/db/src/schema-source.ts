// packages/db/src/schema-source.ts
// Canonical Prisma schema source reader. Lets app-side code (e.g. the
// data-model mirror in apps/web) obtain the schema text without guessing a
// runtime path — resolved relative to this package's own prisma/schema folder.
//
// Since the Simplify & Strengthen B5 Seam C split (BI-134DD02F) the schema is
// a folder of domain files (prisma/schema/*.prisma). Reading "the schema"
// means concatenating every *.prisma file in that folder in sorted filename
// order — the same recursive load order the Prisma CLI uses — so downstream
// text-level parsers (mirror, guards, tests) see one equivalent document.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the canonical Prisma schema folder bundled with @dpf/db. */
export const CANONICAL_PRISMA_SCHEMA_DIR = join(here, "..", "prisma", "schema");

/**
 * Back-compat alias: the canonical schema location (now a folder, previously
 * the schema.prisma monolith). Prefer CANONICAL_PRISMA_SCHEMA_DIR.
 */
export const CANONICAL_PRISMA_SCHEMA_PATH = CANONICAL_PRISMA_SCHEMA_DIR;

/** Sorted absolute paths of every *.prisma file in the canonical schema folder. */
export function listCanonicalPrismaSchemaFiles(): string[] {
  return readdirSync(CANONICAL_PRISMA_SCHEMA_DIR)
    .filter((name) => name.endsWith(".prisma"))
    .sort()
    .map((name) => join(CANONICAL_PRISMA_SCHEMA_DIR, name));
}

/** Read the canonical Prisma schema source text (all domain files, concatenated). */
export function readCanonicalPrismaSchema(): string {
  return listCanonicalPrismaSchemaFiles()
    .map((file) => readFileSync(file, "utf-8"))
    .join("\n");
}
