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

/**
 * `COMMENT ON` is a PostgreSQL UTILITY statement: it cannot be prepared, so it
 * cannot take a bind parameter (BI-EA61F512). `COMMENT ON TABLE "x" IS $1`
 * fails with `syntax error at or near "COMMENT"` at execution time — and the
 * first cut of this script shipped exactly that, because `--dry-run` never
 * executed the statement and so could not fail the way the real run failed.
 * Every install therefore booted with an empty catalog while the dry-run
 * reported 198 comments ready.
 *
 * The payload must be inlined as a quoted literal instead. Both helpers below
 * quote defensively even though their inputs are constrained (table names come
 * from pg_catalog, payloads are machine-generated JSON): an identifier or a
 * literal built by string concatenation is exactly where an injection lives, so
 * the escaping is explicit rather than assumed.
 */
export function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function quoteSqlIdentifier(value: string): string {
  if (value.includes(String.fromCharCode(0))) throw new Error(`Refusing to quote an identifier containing a NUL byte: ${JSON.stringify(value)}`);
  return `"${value.replace(/"/g, '""')}"`;
}

/** Sentinel that unwinds a dry-run probe transaction; never escapes the applier. */
class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}

/** The exact statement the applier runs. Exported so a test can assert its shape without a database. */
export function commentOnTableStatement(table: string, payload: string | null): string {
  const target = quoteSqlIdentifier(table);
  return `COMMENT ON TABLE ${target} IS ${payload === null ? "NULL" : quoteSqlLiteral(payload)}`;
}

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

  const runCommentStatement = async (statement: string, rollback: boolean): Promise<void> => {
    if (!rollback) {
      await prisma.$executeRawUnsafe(statement);
      return;
    }
    // Prove the statement really runs, then undo it: an interactive transaction
    // whose callback throws is rolled back by Prisma.
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(statement);
        throw new DryRunRollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof DryRunRollback)) throw err;
      });
  };

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
    // The dry-run EXECUTES the statement and rolls it back, so a syntax or
    // permission error fails the dry-run too (BI-EA61F512: the previous
    // dry-run skipped the write and could not fail the way the real run did).
    await runCommentStatement(commentOnTableStatement(entry.table, want), opts.dryRun === true);
    applied += 1;
  }

  // A dpf: comment on a table the schema no longer tags is stale metadata.
  for (const [table, comment] of current) {
    if (!comment || !comment.startsWith(MODEL_METADATA_COMMENT_PREFIX)) continue;
    if (declaredTables.has(table)) continue;
    if (parseCatalogComment(comment) === null && !comment.startsWith(MODEL_METADATA_COMMENT_PREFIX)) continue;
    await runCommentStatement(commentOnTableStatement(table, null), opts.dryRun === true);
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
