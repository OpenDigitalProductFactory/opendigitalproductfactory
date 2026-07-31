// Shared exact-key integrity repair authoring helper (BI-8EEEF8CB).
//
// THE PROBLEM
// Between 2026-07-20 and 2026-07-29, eleven near-identical "repair <table>
// index integrity" migrations landed, each a hand-written copy of the same
// sequence (force heap scan -> rank duplicates -> collision-checked quarantine
// rename -> assert no duplicate remains -> drop/recreate the unique index, with
// an optional natural-key FK detach/reattach around it). The founder's framing:
// duplicate data of this sort should be handled by a reliable PATTERN, not a
// bespoke migration per table.
//
// A partial SQL-level helper already existed — the pg_temp
// dpf_quarantine_duplicate_keys function inside
// 20260720193000_repair_remaining_unique_index_integrity — but it is redeclared
// inside every migration (pg_temp, never shared across files) and, critically,
// it renames ONLY the key column. It has no RETIREMENT step, which is why
// PR #3374 ("retire quarantined duplicate rows left active by the generic
// dedupe", BI-8CCF7F13) had to follow up: the renamed losers were still active
// and rendered as live ghost coworkers. The one hand-written migration that got
// it right — 20260720133000_repair_digital_product_index_integrity — inlined
// `lifecycleStatus = 'retired', coverageStatus = 'quarantined'` in the loser
// UPDATE, but that variation could not be expressed by the generic function.
//
// THIS HELPER
// A single, tested place that emits the COMPLETE ratified sequence from a
// declarative config, with retirement SET clauses as a first-class field so a
// future dedupe marks its losers non-live IN THE SAME statement and never needs
// a #3374-style follow-up. The emitted output is plain, reviewable SQL written
// to a Prisma migration file — DDL stays explicit in the migration for review,
// while the SEQUENCE stops being copy-pasted.
//
// Ratified sequence: docs/superpowers/specs/2026-05-31-master-data-management-
// alignment-design.md §5.5 (BI-7C2B91EF / DI-AED2CD86A2B0). Templates:
// 20260720180000_repair_scheduled_job_index_integrity (simple) and
// 20260720133000_repair_digital_product_index_integrity (natural-key FK detach).
//
// This is platform data-integrity capability ADJACENT to MDM, not a domain
// registration inside it — the MDM merge substrate is domain-bound by a ratified
// kernel decision and is the wrong home (see BI-8EEEF8CB investigation notes).

/** A column set on every quarantined loser in the same UPDATE that renames the
 *  key — the RETIREMENT step. `value` is raw SQL (e.g. `'retired'`, `now()`),
 *  emitted verbatim, so the caller controls quoting. This is the field whose
 *  absence forced the #3374 follow-up. */
export interface RetirementAssignment {
  /** Column name (unquoted; the emitter quotes it as an identifier). */
  column: string;
  /** Raw SQL value expression, emitted verbatim (e.g. "'retired'", "now()"). */
  value: string;
}

/** A natural-key-targeting foreign key that must be detached before loser keys
 *  move, so ON UPDATE CASCADE cannot drag a canonical child reference onto a
 *  quarantined row, then reattached after the index is rebuilt. */
export interface NaturalKeyForeignKey {
  /** Child table holding the FK. */
  childTable: string;
  /** Constraint name (exact, as in the schema). */
  constraint: string;
  /** Child column(s) participating in the FK. */
  childColumns: string[];
  /** Parent column(s) referenced — the natural key, not `id`. */
  parentColumns: string[];
  /** ON DELETE action to restore (e.g. "CASCADE", "SET NULL", "RESTRICT"). */
  onDelete: string;
  /** ON UPDATE action to restore (typically "CASCADE"). */
  onUpdate: string;
}

export interface ExactKeyRepairConfig {
  /** Table whose unique key holds duplicates. */
  table: string;
  /** The unique key column(s). The PARTITION BY of the survivor ranking. */
  keyColumns: string[];
  /**
   * Which single key column receives the reserved-namespace quarantine rename.
   * Must be a text column. Defaults to the last of `keyColumns` (matching the
   * multi-column precedent in the "remaining" migration, which renamed the
   * second member of a two-column key).
   */
  quarantineColumn?: string;
  /**
   * ORDER BY inside the partition. Row 1 is the SURVIVOR; every other row is a
   * quarantined loser. Raw SQL (e.g. `"createdAt", id` keeps the oldest;
   * `"updatedAt" DESC, id DESC` keeps the freshest).
   */
  survivorOrder: string;
  /** Exact name of the unique index to drop and recreate. */
  uniqueIndexName: string;
  /**
   * Columns the rebuilt unique index covers. Defaults to `keyColumns` — set it
   * only when the physical index column order differs from the key order.
   */
  indexColumns?: string[];
  /**
   * RETIREMENT: extra assignments applied to every loser in the rename UPDATE,
   * marking it non-live so it does not render as a ghost. OMITTING THIS IS A
   * DECISION, not a default — a table whose losers have a lifecycle/active
   * status MUST retire them here or repeat the #3374 follow-up.
   */
  retirement?: RetirementAssignment[];
  /** Natural-key FKs to detach before and reattach after the repair. */
  naturalKeyForeignKeys?: NaturalKeyForeignKey[];
  /** Header attestation line, e.g. "BI-XXXXXXXX — restore <Table> heap/index agreement." */
  reason: string;
}

/** Quote a Postgres identifier: wrap in double quotes, escape embedded quotes. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function assertValidIdentifier(name: string, role: string): void {
  // Identifiers are authored by a migration developer, not user input, but a
  // stray quote or newline would silently produce malformed SQL. Fail loud.
  if (!name || /["\n\r;]/.test(name)) {
    throw new Error(`exact-key-repair: invalid ${role} identifier ${JSON.stringify(name)}`);
  }
}

/**
 * Emit the complete ratified exact-key integrity repair as a single reviewable
 * SQL migration body. Deterministic and pure — no DB access.
 */
export function buildExactKeyRepairSql(config: ExactKeyRepairConfig): string {
  const {
    table,
    keyColumns,
    survivorOrder,
    uniqueIndexName,
    retirement = [],
    naturalKeyForeignKeys = [],
    reason,
  } = config;

  if (keyColumns.length === 0) {
    throw new Error("exact-key-repair: keyColumns must be non-empty");
  }
  if (!survivorOrder.trim()) {
    throw new Error("exact-key-repair: survivorOrder is required (row 1 is the survivor)");
  }
  assertValidIdentifier(table, "table");
  assertValidIdentifier(uniqueIndexName, "uniqueIndexName");
  keyColumns.forEach((c) => assertValidIdentifier(c, "key column"));

  const quarantineColumn = config.quarantineColumn ?? keyColumns[keyColumns.length - 1];
  assertValidIdentifier(quarantineColumn, "quarantineColumn");
  if (!keyColumns.includes(quarantineColumn)) {
    throw new Error(
      `exact-key-repair: quarantineColumn "${quarantineColumn}" must be one of keyColumns`,
    );
  }
  const indexColumns = config.indexColumns ?? keyColumns;
  indexColumns.forEach((c) => assertValidIdentifier(c, "index column"));
  retirement.forEach((r) => assertValidIdentifier(r.column, "retirement column"));

  const partitionBy = keyColumns.map(ident).join(", ");
  const groupBy = keyColumns.map(ident).join(", ");
  const retirementSets = retirement
    .map((r) => `,\n      ${ident(r.column)} = ${r.value}`)
    .join("");

  const detachFks = naturalKeyForeignKeys
    .map(
      (fk) =>
        `ALTER TABLE ${ident(fk.childTable)}\n  DROP CONSTRAINT IF EXISTS ${ident(fk.constraint)};`,
    )
    .join("\n");

  const reattachFks = naturalKeyForeignKeys
    .map((fk) => {
      const childCols = fk.childColumns.map(ident).join(", ");
      const parentCols = fk.parentColumns.map(ident).join(", ");
      return (
        `ALTER TABLE ${ident(fk.childTable)}\n` +
        `  ADD CONSTRAINT ${ident(fk.constraint)}\n` +
        `  FOREIGN KEY (${childCols}) REFERENCES ${ident(table)}(${parentCols})\n` +
        `  ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate};`
      );
    })
    .join("\n");

  const fleetSafetyFk = naturalKeyForeignKeys.length
    ? " The natural-key foreign keys are detached before loser keys move so ON" +
      " UPDATE CASCADE cannot steal references from the canonical survivor, then" +
      " restored to their exact prior definitions."
    : "";
  const fleetSafetyRetire = retirement.length
    ? " Losers are marked non-live in the same statement that quarantines them," +
      " so no follow-up migration is needed to hide them."
    : "";

  return `-- ${reason}
--
-- Generated by packages/db/src/migrations/exact-key-repair.ts
-- (buildExactKeyRepairSql). Do not hand-edit the sequence; change the config
-- and regenerate. Fleet safety: every conflicting row is RETAINED under a
-- collision-checked reserved key, never deleted.${fleetSafetyFk}${fleetSafetyRetire}
-- Clean installs change no data; the migration is idempotent and fails closed
-- if any duplicate remains.

BEGIN;

-- Force heap scans so ranking, collision checks, and the final assertion read
-- the true heap, never a btree that may itself be the corrupted structure.
SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;
${detachFks ? `\n${detachFks}\n` : ""}
DO $$
DECLARE
  duplicate_row RECORD;
  quarantine_key TEXT;
BEGIN
  FOR duplicate_row IN
    WITH ranked AS MATERIALIZED (
      SELECT
        id,
        ${ident(quarantineColumn)} AS original_key,
        row_number() OVER (
          PARTITION BY ${partitionBy}
          ORDER BY ${survivorOrder}
        ) AS duplicate_rank
      FROM ${ident(table)}
    )
    SELECT id, original_key
    FROM ranked
    WHERE duplicate_rank > 1
    ORDER BY original_key, id
  LOOP
    quarantine_key := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row.original_key;
    WHILE EXISTS (
      SELECT 1
      FROM ${ident(table)}
      WHERE ${ident(quarantineColumn)} = quarantine_key AND id <> duplicate_row.id
    ) LOOP
      quarantine_key := quarantine_key || '_';
    END LOOP;

    UPDATE ${ident(table)}
    SET ${ident(quarantineColumn)} = quarantine_key${retirementSets}
    WHERE id = duplicate_row.id;
  END LOOP;
END $$;

-- Heap-grounded assertion: every index scan class is disabled above.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ${ident(table)}
    GROUP BY ${groupBy}
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '${table} integrity repair left duplicate keys';
  END IF;
END $$;

DROP INDEX IF EXISTS ${ident(uniqueIndexName)};
CREATE UNIQUE INDEX ${ident(uniqueIndexName)} ON ${ident(table)} (${indexColumns.map(ident).join(", ")});
${reattachFks ? `\n${reattachFks}\n` : ""}
COMMIT;
`;
}
