const prismaOnly = new Set(["schema", "connection_limit", "pool_timeout", "pgbouncer"]);
const connectionOptions: ReadonlyMap<string, string> = new Map([
  ["sslmode", "PGSSLMODE"], ["sslrootcert", "PGSSLROOTCERT"], ["sslcert", "PGSSLCERT"], ["sslkey", "PGSSLKEY"],
  ["connect_timeout", "PGCONNECT_TIMEOUT"], ["application_name", "PGAPPNAME"], ["channel_binding", "PGCHANNELBINDING"],
]);

/** Give the bundled PostgreSQL client one configured database over its
 * environment. Connection strings and credentials never appear as arguments. */
export function managedPostgresConnection(source = process.env.DATABASE_URL): NodeJS.ProcessEnv {
  const refuse = () => new Error("managed_postgres_connection_unproven");
  try {
    const url = new URL(source ?? "");
    const user = decodeURIComponent(url.username);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.hostname.includes(",")
      || !/^[A-Za-z0-9_.-]{1,128}$/.test(user) || !/^[A-Za-z0-9_.-]{1,128}$/.test(database) || url.hash) throw refuse();
    const options: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (prismaOnly.has(key)) continue;
      const field = connectionOptions.get(key);
      if (!field || Object.hasOwn(options, field)) throw refuse();
      options[field] = value;
    }
    return {
      ...options, PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432",
      PGUSER: user, PGDATABASE: database, ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
      POSTGRES_USER: user, POSTGRES_DB: database,
      NODE_ENV: "production", PATH: "/usr/local/bin:/usr/bin:/bin", DPF_MANAGED_POSTGRES_DIRECT: "1",
    };
  } catch { throw refuse(); }
}
