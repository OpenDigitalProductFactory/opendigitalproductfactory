const MUSL_LIBC_COLLATION_CEILING = 8;

/**
 * Postgres cannot warn about the drift that matters here when
 * datcollversion is NULL. Reconstruct that signal from the collation census.
 */
export async function checkCollationStability(client) {
  const { rows: db } = await client.query(`
    SELECT datcollate, datctype, datcollversion,
           pg_database_collation_actual_version(oid) AS actual_version
    FROM pg_database
    WHERE datname = current_database()
  `);
  const { rows: census } = await client.query(`
    SELECT collprovider, count(*)::int AS count
    FROM pg_collation
    GROUP BY collprovider
  `);

  const libcCount = census.find((row) => row.collprovider === "c")?.count ?? 0;
  const { datcollate, datcollversion, actual_version: actualVersion } = db[0];
  const findings = [];

  const labelClaimsLocale = !/^(C|POSIX)(\.|$)/.test(datcollate ?? "");
  if (labelClaimsLocale && libcCount <= MUSL_LIBC_COLLATION_CEILING) {
    findings.push({
      kind: "collation-provider-mismatch",
      severity: "warn",
      detail:
        `database collation is labelled "${datcollate}" but only ${libcCount} libc ` +
        `collation(s) exist (a glibc initdb registers several hundred). This cluster ` +
        `was initialised without libc locale data — text sorted as C — and any text ` +
        `btree built then is mis-ordered under a glibc image.`,
    });
  }

  if (datcollversion === null) {
    findings.push({
      kind: "collation-version-unrecorded",
      severity: "warn",
      detail:
        `pg_database.datcollversion is NULL (actual: ${actualVersion ?? "unknown"}), ` +
        `so Postgres cannot raise its own collation-version-mismatch warning for ` +
        `this database. Collation drift here is silent by construction.`,
    });
  } else if (actualVersion && datcollversion !== actualVersion) {
    findings.push({
      kind: "collation-version-drift",
      severity: "error",
      detail:
        `collation version recorded as ${datcollversion} but the running library ` +
        `reports ${actualVersion}. Indexes built before the change are mis-ordered; ` +
        `REINDEX them, then ALTER DATABASE ... REFRESH COLLATION VERSION.`,
    });
  }

  return { datcollate, datcollversion, actualVersion, libcCount, findings };
}

async function requireAmcheck(client, mode) {
  if (mode === "provision") {
    await client.query("CREATE EXTENSION IF NOT EXISTS amcheck WITH SCHEMA public");
  }

  const { rows } = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension extension
      JOIN pg_namespace namespace
        ON namespace.oid = extension.extnamespace
      WHERE extension.extname = 'amcheck'
        AND namespace.nspname = 'public'
    ) AS installed
  `);
  if (rows[0]?.installed !== true) {
    throw new Error(
      mode === "require"
        ? "amcheck must already be installed before checking a production source"
        : "the amcheck extension is unavailable in schema public",
    );
  }
}

async function listIndexes(client, { schema, table, uniqueOnly }) {
  const { rows } = await client.query(
    `
    SELECT t.relname AS table_name, c.relname AS index_name, i.indisunique AS is_unique
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.relam = (SELECT oid FROM pg_am WHERE amname = 'btree')
      AND ($1::boolean IS NOT TRUE OR i.indisunique)
      AND ($2::text IS NULL OR t.relname = $2)
      AND n.nspname = $3
    ORDER BY t.relname, c.relname
  `,
    [uniqueOnly, table ?? null, schema],
  );
  return rows;
}

function quoteRegclassPart(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function checkIndex(client, schema, indexName) {
  try {
    await client.query(
      "SELECT public.bt_index_parent_check($1::regclass, true, true)",
      [`${quoteRegclassPart(schema)}.${quoteRegclassPart(indexName)}`],
    );
    return null;
  } catch (error) {
    return String(error.message ?? error).replace(/\s+/g, " ").trim();
  }
}

/**
 * Verify btree-to-heap agreement. `require` mode issues SELECT statements only,
 * so it is safe for the production source used by contributor preview.
 */
export async function checkIndexIntegrity(client, options = {}) {
  const schema = options.schema ?? "public";
  const table = options.table ?? null;
  const uniqueOnly = options.uniqueOnly ?? false;
  const amcheckMode = options.amcheckMode ?? "require";
  if (!["provision", "require"].includes(amcheckMode)) {
    throw new Error(`Unsupported amcheck mode: ${amcheckMode}`);
  }

  await requireAmcheck(client, amcheckMode);
  const indexes = await listIndexes(client, { schema, table, uniqueOnly });
  const corrupted = [];
  for (const {
    table_name: indexTable,
    index_name: index,
    is_unique: isUnique,
  } of indexes) {
    const error = await checkIndex(client, schema, index);
    if (error) corrupted.push({ table: indexTable, index, isUnique, error });
  }

  return {
    indexesChecked: indexes.length,
    corrupted,
    failed: corrupted.length > 0,
  };
}
