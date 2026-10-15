import { Pool, types as pgTypes } from "pg";

import { positiveIntFromEnv } from "./durations";

let pool: Pool | null = null;

const TIMESTAMP_WITHOUT_TZ = 1114;

/**
 * Engine tables use Prisma's `timestamp(3)` (without time zone) holding UTC.
 * node-postgres would read those as local time, so this pool reads them as UTC.
 * Writes pass Dates through `utc()` in store.ts for the same reason. Scoped to
 * this pool only: global pg defaults are left alone.
 */
export const jobsPgTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === TIMESTAMP_WITHOUT_TZ && format !== "binary") {
      return (value: string) => new Date(`${value.replace(" ", "T")}Z`);
    }
    return pgTypes.getTypeParser(oid, format as never);
  },
} as const;

export function createJobsPool(connectionString: string, max = 6): Pool {
  // The session runs in UTC so now() and the timestamp columns agree whatever the server's TimeZone.
  return new Pool({ connectionString, max, application_name: "dpf-jobs", options: "-c TimeZone=UTC", types: jobsPgTypes as never });
}

/**
 * The job engine's connection pool on the platform database. Small and
 * separate from Prisma's: the worker holds one connection for LISTEN and a
 * few for claims and step writes. Created on first use only, so a process
 * that never routes a function here opens no sockets.
 */
export function jobsPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for the Postgres job engine.");
  pool = createJobsPool(connectionString, positiveIntFromEnv(process.env.DPF_JOBS_POOL_MAX, 6));
  return pool;
}
