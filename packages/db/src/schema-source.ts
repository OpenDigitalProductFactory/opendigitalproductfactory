// packages/db/src/schema-source.ts
// Canonical Prisma schema source reader. Lets app-side code (e.g. the
// data-model mirror in apps/web) obtain the schema text without guessing a
// runtime path — resolved relative to this package's own prisma/schema.prisma.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the canonical Prisma schema bundled with @dpf/db. */
export const CANONICAL_PRISMA_SCHEMA_PATH = join(here, "..", "prisma", "schema.prisma");

/** Read the canonical Prisma schema source text. */
export function readCanonicalPrismaSchema(): string {
  return readFileSync(CANONICAL_PRISMA_SCHEMA_PATH, "utf-8");
}
