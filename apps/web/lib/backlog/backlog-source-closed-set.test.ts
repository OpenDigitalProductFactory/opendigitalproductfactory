import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CORRECTIVE_FAILURE_SOURCES } from "./capture-corrective-bi";

// BI-4C6934CF — the writer's vocabulary and the database's closed set must agree.
//
// WHY THIS TEST EXISTS
// `data-growth` was added to the writer union and never to the
// BacklogItem_source_closed_set CHECK constraint. Nothing caught it:
//
//   - TypeScript was satisfied, because the union is the only declaration.
//   - Unit tests passed, because they mock Prisma, and a mock has no CHECK
//     constraint. A mocked client cannot fail a database rule.
//   - Production did not complain, because captureCorrectiveFailureBI is
//     deliberately best-effort: it catches, logs, and returns "skipped".
//
// The result was a detector that ran every night for eleven nights, found four
// persistent findings, and filed nothing. The only trace was four identical
// lines in a container log that nobody reads on a schedule.
//
// This test reads the CHECK constraint out of the migration history — the same
// source of truth Postgres was built from — so a new writer source fails here,
// at the cheapest possible moment, instead of silently at 03:00.

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "packages", "db", "prisma", "migrations");
const CONSTRAINT = "BacklogItem_source_closed_set";

/**
 * The values the LAST migration to define the constraint permits. Migrations
 * are timestamp-named, so lexical order is chronological; the final definition
 * wins, exactly as it does when Postgres replays them in order.
 */
function permittedSourcesFromMigrations(): string[] {
  const defining: { dir: string; sql: string }[] = [];
  for (const dir of readdirSync(MIGRATIONS_DIR).sort()) {
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    } catch {
      continue; // migration_lock.toml and anything else without a migration.sql
    }
    if (sql.includes(`ADD CONSTRAINT "${CONSTRAINT}"`)) defining.push({ dir, sql });
  }

  expect(defining.length, `no migration defines ${CONSTRAINT}`).toBeGreaterThan(0);

  const last = defining[defining.length - 1];
  // Take the ADD CONSTRAINT statement, then the IN (...) list inside it.
  const statement = last.sql.slice(last.sql.lastIndexOf(`ADD CONSTRAINT "${CONSTRAINT}"`));
  const list = /IN\s*\(([\s\S]*?)\)/.exec(statement);
  expect(list, `could not read the IN (...) list from ${last.dir}`).not.toBeNull();

  return [...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("BacklogItem source closed set vs the corrective-capture writer", () => {
  it("permits every source captureCorrectiveFailureBI can write", () => {
    const permitted = permittedSourcesFromMigrations();
    const rejected = CORRECTIVE_FAILURE_SOURCES.filter((s) => !permitted.includes(s));
    expect(
      rejected,
      "these writer sources would be rejected by the database CHECK constraint at insert time, "
        + "and captureCorrectiveFailureBI swallows that error — add them to a new migration",
    ).toEqual([]);
  });

  it("reads a non-empty set, so a parsing failure cannot pass as success", () => {
    const permitted = permittedSourcesFromMigrations();
    expect(permitted.length).toBeGreaterThan(0);
    // Anchor on a value that predates this fix: if the regex silently matched
    // the wrong statement, this is the assertion that notices.
    expect(permitted).toContain("user-request");
  });

  it("carries data-growth, the value whose absence made the steward inert", () => {
    expect(permittedSourcesFromMigrations()).toContain("data-growth");
  });
});
