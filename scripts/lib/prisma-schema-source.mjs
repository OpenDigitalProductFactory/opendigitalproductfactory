// scripts/lib/prisma-schema-source.mjs
//
// Shared reader for the canonical Prisma schema, which is a FOLDER of domain
// files (packages/db/prisma/schema/*.prisma) since the Simplify & Strengthen
// B5 Seam C split (BI-134DD02F). Guards and generators that used to
// readFileSync the schema.prisma monolith read the concatenated folder text
// through here instead, in sorted filename order — the same recursive load
// order the Prisma CLI uses — so their text-level parsers keep identical
// outputs over one equivalent document.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Repo-relative path of the canonical Prisma schema folder. */
export const PRISMA_SCHEMA_DIR = "packages/db/prisma/schema";

/** Sorted repo-relative paths of every *.prisma domain file. */
export function listPrismaSchemaFiles(repoRoot) {
  return readdirSync(join(repoRoot, PRISMA_SCHEMA_DIR))
    .filter((name) => name.endsWith(".prisma"))
    .sort()
    .map((name) => `${PRISMA_SCHEMA_DIR}/${name}`);
}

/** Read the full schema text (all domain files, concatenated). */
export function readPrismaSchemaText(repoRoot) {
  return listPrismaSchemaFiles(repoRoot)
    .map((relative) => readFileSync(join(repoRoot, relative), "utf-8"))
    .join("\n");
}

/** True when a repo-relative path is part of the Prisma schema (folder file or legacy monolith). */
export function isPrismaSchemaPath(path) {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  return (
    normalized === "packages/db/prisma/schema.prisma" ||
    (normalized.startsWith(`${PRISMA_SCHEMA_DIR}/`) && normalized.endsWith(".prisma"))
  );
}
