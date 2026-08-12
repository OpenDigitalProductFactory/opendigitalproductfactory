export async function inspectUnresolvedMigrations(client) {
  try {
    const result = await client.query(
      `SELECT
         id,
         migration_name AS "migrationName",
         checksum,
         applied_steps_count AS "appliedStepsCount",
         logs
       FROM "_prisma_migrations"
       WHERE finished_at IS NULL
         AND rolled_back_at IS NULL
       ORDER BY started_at, id`,
    );
    return result.rows;
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

export async function verifyExactMigrationRolledBack(client, migrationId, migrationName) {
  const result = await client.query(
    `SELECT
       count(*) FILTER (
         WHERE id = $1
           AND migration_name = $2
           AND rolled_back_at IS NOT NULL
           AND finished_at IS NULL
       )::int AS "verifiedRows",
       count(*) FILTER (
         WHERE finished_at IS NULL
           AND rolled_back_at IS NULL
       )::int AS "unresolvedRows"
     FROM "_prisma_migrations"`,
    [migrationId, migrationName],
  );
  return (
    Number(result.rows[0]?.verifiedRows ?? 0) === 1
    && Number(result.rows[0]?.unresolvedRows ?? 0) === 0
  );
}
