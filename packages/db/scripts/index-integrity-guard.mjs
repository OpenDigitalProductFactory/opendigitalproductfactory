#!/usr/bin/env node
//
// index-integrity-guard.mjs — detect btree indexes that silently disagree with
// the heap they index, and the collation drift that causes it.
//
// Why this exists (BI-COLLATION-DRIFT, 2026-07-20): between 2026-07-20 and the
// same afternoon, six separate "repair <table> index integrity" migrations
// merged (geographic, digital product, EA artifact, EA element, PlatformConfig,
// PortfolioQualityIssue). Each correctly deduped one table and rebuilt one
// index. None of them asked WHY a unique index was holding duplicates, so the
// seventh, eighth and ninth were already latent when the sixth merged. A live
// install carried 21 corrupted unique indexes at the time this guard was
// written; the roster surfaced 17 duplicate AI coworkers as a result.
//
// The cause is a collation comparator flip, not disk corruption:
//
//   1. The cluster was initdb'd under Alpine/musl. musl ships no locale data, so
//      every text column sorted with C semantics regardless of the en_US.utf8
//      label recorded in pg_database.datcollate. The fingerprint survives: such
//      a cluster has only 3 libc collations (default/C/POSIX) where a glibc
//      initdb creates several hundred, and datcollversion is NULL.
//   2. docker/postgres/Dockerfile later moved the image to pgvector/pgvector:pg16
//      (Debian/glibc) so pgvector could never drift out (BI-A35347E4 /
//      BI-4796D52B). Correct fix, but glibc *does* implement en_US.utf8 — so the
//      comparator for every text column changed underneath an existing volume.
//   3. Every text btree built before the flip is now ordered by the old
//      comparator and searched by the new one. Lookups descend into the wrong
//      subtree and miss rows that are present in the heap.
//
// The damage is silent and it compounds. `pg_index` still reports the index
// valid, so nothing complains. An upsert (`where: { agentId }`) misses the
// existing row, falls through to CREATE, and the unique index fails to reject
// the insert for exactly the same reason — so a UNIQUE constraint quietly
// accumulates duplicates. That is how one seed run produced 17 duplicate
// coworkers over rows first created six weeks earlier.
//
// What this guard checks:
//   1. Collation stability — the musl-initdb fingerprint, and any recorded-vs-
//      actual collation version mismatch (the warning Postgres cannot emit here,
//      because datcollversion is NULL).
//   2. Index/heap agreement — bt_index_parent_check(..., heapallindexed => true)
//      over every btree index, which is what actually catches a comparator flip.
//
// Detection is the point. Repair is per-table and needs human judgement about
// which duplicate wins and what merges; this guard never mutates anything.
//
// Usage:
//   node packages/db/scripts/index-integrity-guard.mjs [--unique-only] [--json]
//                                                      [--quiet] [--table <name>]
// Env:
//   DATABASE_URL  required
//
// Exit: 0 clean · 1 corruption or collation drift found · 2 invocation error
//
// Wired into:
//   - .github/workflows/migration-safety-guard.yml (CI, against the CI cluster)
//   - packages/db/scripts/index-integrity-guard.test.ts (vitest)

import pg from "pg";
import {
  checkCollationStability,
  checkIndexIntegrity,
} from "./index-integrity-core.mjs";

export { checkCollationStability } from "./index-integrity-core.mjs";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const UNIQUE_ONLY = has("--unique-only");
const AS_JSON = has("--json");
const QUIET = has("--quiet");
const ONLY_TABLE = valueOf("--table");

function fail(message) {
  process.stderr.write(`index-integrity-guard: ${message}\n`);
  process.exit(2);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail("DATABASE_URL is not set");

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    fail(`could not connect: ${error.message}`);
  }

  try {
    const collation = await checkCollationStability(client);

    const integrity = await checkIndexIntegrity(client, {
      amcheckMode: "provision",
      schema: "public",
      table: ONLY_TABLE ?? null,
      uniqueOnly: UNIQUE_ONLY,
      requiredIndexes:
        ONLY_TABLE === "InventoryEntity"
          ? [{ name: "InventoryEntity_entityKey_key", unique: true }]
          : [],
    });
    const corrupted = integrity.corrupted;

    // Advisory findings describe how the cluster was built, not a regression, so
    // they never fail the run on their own — otherwise this guard goes red
    // permanently the moment it is wired into CI, and a permanently-red guard is
    // one nobody reads. Corruption and genuine version drift do fail.
    const blockingFindings = collation.findings.filter((f) => f.severity === "error");

    const report = {
      database: { collation: collation.datcollate, libcCollations: collation.libcCount },
      collationFindings: collation.findings,
      indexesChecked: integrity.indexesChecked,
      corrupted,
      failed: corrupted.length > 0 || blockingFindings.length > 0,
    };

    if (AS_JSON) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (!QUIET || corrupted.length || collation.findings.length) {
      for (const finding of collation.findings) {
        const label = finding.severity === "error" ? "COLLATION " : "ADVISORY  ";
        process.stdout.write(`${label} ${finding.kind}\n           ${finding.detail}\n`);
      }
      for (const row of corrupted) {
        process.stdout.write(
          `CORRUPT    ${row.table}.${row.index}${row.isUnique ? " (UNIQUE)" : ""}\n           ${row.error}\n`,
        );
      }
      process.stdout.write(
        `\nchecked ${integrity.indexesChecked} btree index(es): ` +
          `${corrupted.length} corrupted, ${blockingFindings.length} blocking + ` +
          `${collation.findings.length - blockingFindings.length} advisory collation finding(s)\n`,
      );
      if (corrupted.some((row) => row.isUnique)) {
        process.stdout.write(
          "\nA corrupted UNIQUE index cannot reject duplicates. Expect duplicate rows\n" +
            "behind that constraint, and read them with enable_indexscan=off — an index\n" +
            "scan will not see them.\n",
        );
      }
    }

    process.exit(report.failed ? 1 : 0);
  } finally {
    await client.end().catch(() => {});
  }
}

// Only run when invoked as a script, so the unit test can import the pure
// collation-classification logic without opening a connection or calling exit().
const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => fail(error.message ?? String(error)));
}
