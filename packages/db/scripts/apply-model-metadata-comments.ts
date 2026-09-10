// packages/db/scripts/apply-model-metadata-comments.ts
//
// EP-A33A5C61 slice 4 (BI-D9F158AF) — converge the Postgres catalog to the
// schema's `/// @dpf` declarations. Runs at every portal boot right after
// `prisma migrate deploy` (scripts/portal-migrate-boot.sh), and on demand.
//
// For every tagged model: COMMENT ON TABLE "<table>" IS 'dpf:{...}' when the
// current obj_description differs. COMMENT ON is idempotent and transactional,
// costs nothing at query time, travels with the table, and is what every
// catalog crawler reads. Tables the schema does not tag are left alone — a
// hand-written comment is never overwritten, and a stale dpf: comment on a
// model that lost its tag is removed so the catalog never claims a disposition
// the schema no longer declares.
//
//   pnpm --filter @dpf/db exec tsx scripts/apply-model-metadata-comments.ts [--dry-run]
//
// Exit code is always 0 on a reachable database: a comment that cannot be
// applied is reported, not fatal — the portal must not refuse to start over
// metadata (the guard in CI is where a missing tag is a hard failure).

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { prisma } from "../src/client";
import { parseModelMetadataSources, parseCatalogComment, toCatalogComment, MODEL_METADATA_COMMENT_PREFIX } from "../src/model-metadata";
import { listCanonicalPrismaSchemaFiles } from "../src/schema-source";

const dryRun = process.argv.includes("--dry-run");

type CatalogRow = { table: string; comment: string | null };

export async function applyModelMetadataComments(opts: { dryRun?: boolean } = {}): Promise<{
  applied: number;
  unchanged: number;
  removed: number;
  missingTables: string[];
  issues: number;
}> {
  const sources = listCanonicalPrismaSchemaFiles().map((file) => ({ file: basename(file), source: readFileSync(file, "utf8") }));
  const parsed = parseModelMetadataSources(sources);
  for (const issue of parsed.issues) {
    console.error(`[model-metadata] ${issue.file}:${issue.line} ${issue.model ?? ""} ${issue.message}`);
  }

  const rows = await prisma.$queryRawUnsafe<CatalogRow[]>(
    `SELECT c.relname AS "table", obj_description(c.oid, 'pg_class') AS "comment"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')`,
  );
  const current = new Map(rows.map((r) => [r.table, r.comment]));

  let applied = 0;
  let unchanged = 0;
  let removed = 0;
  const missingTables: string[] = [];
  const declaredTables = new Set<string>();

  for (const entry of parsed.entries) {
    declaredTables.add(entry.table);
    if (!current.has(entry.table)) {
      missingTables.push(entry.table);
      continue;
    }
    const want = toCatalogComment(entry.metadata, entry.model);
    if (current.get(entry.table) === want) {
      unchanged += 1;
      continue;
    }
    if (!opts.dryRun) {
      await prisma.$executeRawUnsafe(`COMMENT ON TABLE "${entry.table}" IS $1`, want);
    }
    applied += 1;
  }

  // A dpf: comment on a table the schema no longer tags is stale metadata.
  for (const [table, comment] of current) {
    if (!comment || !comment.startsWith(MODEL_METADATA_COMMENT_PREFIX)) continue;
    if (declaredTables.has(table)) continue;
    if (parseCatalogComment(comment) === null && !comment.startsWith(MODEL_METADATA_COMMENT_PREFIX)) continue;
    if (!opts.dryRun) await prisma.$executeRawUnsafe(`COMMENT ON TABLE "${table}" IS NULL`);
    removed += 1;
  }

  return { applied, unchanged, removed, missingTables, issues: parsed.issues.length };
}

async function main(): Promise<void> {
  const result = await applyModelMetadataComments({ dryRun });
  console.log(
    `[model-metadata] ${dryRun ? "dry-run" : "applied"}: comments applied=${result.applied} unchanged=${result.unchanged} stale-removed=${result.removed} declared-but-no-table=${result.missingTables.length} schema-issues=${result.issues}`,
  );
  if (result.missingTables.length > 0) {
    console.warn(`[model-metadata] tagged models with no table yet (migration pending?): ${result.missingTables.join(", ")}`);
  }
}

const invokedDirectly = process.argv[1]?.endsWith("apply-model-metadata-comments.ts");
if (invokedDirectly) {
  main()
    .catch((err) => {
      console.error("[model-metadata] failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
