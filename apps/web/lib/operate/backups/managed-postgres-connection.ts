const prismaOnly = new Set(["schema", "connection_limit", "pool_timeout", "pgbouncer"]);
const connectionOptions = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout", "application_name", "channel_binding"]);

/** Give the bundled PostgreSQL client one configured database over its
 * environment. Connection strings and credentials never appear as arguments. */
export function managedPostgresConnection(source = process.env.DATABASE_URL): {
  PGDATABASE: string; POSTGRES_USER: string; POSTGRES_DB: string;
} {
  const refuse = () => new Error("managed_postgres_connection_unproven");
  try {
    const url = new URL(source ?? "");
    const user = decodeURIComponent(url.username);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.hostname.includes(",")
      || !/^[A-Za-z0-9_.-]{1,128}$/.test(user) || !/^[A-Za-z0-9_.-]{1,128}$/.test(database) || url.hash) throw refuse();
    for (const key of [...url.searchParams.keys()]) {
      if (prismaOnly.has(key)) url.searchParams.delete(key);
      else if (!connectionOptions.has(key) || url.searchParams.getAll(key).length !== 1) throw refuse();
    }
    return { PGDATABASE: url.toString(), POSTGRES_USER: user, POSTGRES_DB: database };
  } catch { throw refuse(); }
}
