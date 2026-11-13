import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../packages/db/generated/client/client";

/** Clone public table definitions into a unique, isolated review-test schema. */
export async function createReviewPostgresFixture(input: {
  url: string;
  schema: string;
  tables: readonly string[];
}): Promise<{ pool: Pool; db: PrismaClient; close: () => Promise<void> }> {
  const { url, schema, tables } = input;
  if (!url.trim()) throw new Error("Review PostgreSQL fixtures require an explicit governed test URL.");
  if (schema.length > 63 || !/^review_[a-z][a-z0-9_]*_[a-f0-9]{32}$/.test(schema)) {
    throw new Error("Review PostgreSQL fixtures require a review-prefixed schema with a UUID suffix.");
  }
  if (!tables.length || new Set(tables).size !== tables.length
    || tables.some(table => !/^[A-Z][A-Za-z0-9]{0,62}$/.test(table))) {
    throw new Error("Review PostgreSQL fixtures require distinct canonical table identifiers.");
  }

  const admin = new Pool({ connectionString: url });
  // No public fallback: a missing fixture table fails instead of reading live rows.
  const pool = new Pool({ connectionString: url, application_name: schema,
    options: `-c search_path=${schema} -c statement_timeout=7000`, max: 5 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  let schemaCreated = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    try {
      try { await db.$disconnect(); }
      finally { await pool.end(); }
    } finally {
      try {
        if (schemaCreated) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally { await admin.end(); }
    }
  })();

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    // Prisma qualifies enum casts with its adapter schema. Clone actual enum
    // labels and retarget LIKE's columns so comparisons use that SAME type,
    // including array columns and defaults; no public table fallback is needed.
    const enumColumns = await pool.query<{
      table_sql: string; column_sql: string; target_sql: string;
      source_sql: string; default_sql: string | null; create_sql: string;
    }>(`
      SELECT format('%I', c.relname) AS table_sql, format('%I', a.attname) AS column_sql,
        format('%I.%I%s', $1::text, e.typname, CASE WHEN t.typtype = 'e' THEN '' ELSE '[]' END) AS target_sql,
        format('%I.%I', en.nspname, e.typname) AS source_sql,
        pg_get_expr(d.adbin, d.adrelid) AS default_sql,
        format('CREATE TYPE %I.%I AS ENUM (%s)', $1::text, e.typname,
          (SELECT string_agg(quote_literal(v.enumlabel), ', ' ORDER BY v.enumsortorder)
           FROM pg_enum v WHERE v.enumtypid = e.oid)) AS create_sql
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      JOIN pg_type e ON e.oid = CASE WHEN t.typtype = 'e' THEN t.oid ELSE t.typelem END
      JOIN pg_namespace en ON en.oid = e.typnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relname = ANY($2::text[])
        AND a.attnum > 0 AND NOT a.attisdropped AND e.typtype = 'e'
    `, [schema, tables]);
    for (const ddl of new Set(enumColumns.rows.map(row => row.create_sql))) await pool.query(ddl);
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    // LIKE also copies CHECK expressions with casts to the original enum.
    // Preserve every expression, rebinding only its enum type qualifications.
    const checks = await pool.query<{ table_sql: string; name_sql: string; definition: string }>(`
      SELECT format('%I', c.relname) AS table_sql, format('%I', k.conname) AS name_sql,
        pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND k.contype = 'c'
    `, [schema]);
    for (const { table_sql, name_sql } of checks.rows)
      await pool.query(`ALTER TABLE ${table_sql} DROP CONSTRAINT ${name_sql}`);
    for (const { table_sql, column_sql, target_sql, default_sql } of enumColumns.rows) {
      await pool.query(`ALTER TABLE ${table_sql}
        ALTER COLUMN ${column_sql} DROP DEFAULT,
        ALTER COLUMN ${column_sql} TYPE ${target_sql} USING (${column_sql}::text::${target_sql})`);
      if (default_sql !== null) await pool.query(`ALTER TABLE ${table_sql}
        ALTER COLUMN ${column_sql} SET DEFAULT (${default_sql})::text::${target_sql}`);
    }
    const enumTypes = new Map(enumColumns.rows.map(row => [row.source_sql, row.target_sql.replace(/\[\]$/, "")]));
    for (const { table_sql, name_sql, definition } of checks.rows) {
      let rebound = definition;
      for (const [source, target] of enumTypes) rebound = rebound.replaceAll(source, target);
      await pool.query(`ALTER TABLE ${table_sql} ADD CONSTRAINT ${name_sql} ${rebound}`);
    }
    return { pool, db, close };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Review PostgreSQL fixture setup and cleanup failed.");
    }
    throw error;
  }
}
