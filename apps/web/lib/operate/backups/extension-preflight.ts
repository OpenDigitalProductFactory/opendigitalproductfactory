/**
 * Postgres extension-availability preflight (BI-A35347E4).
 *
 * The pre-upgrade recovery point (and the daily backup) run `pg_dump` of the
 * live Postgres database. If the running postgres *container image* does not
 * provide an extension the database's catalog depends on — the canonical case
 * is pgvector's `vector.so` after the container was recreated onto a plain
 * `postgres:16-alpine` image while the BET-5 schema carries `vector` objects —
 * `pg_dump` dies with `could not access file "$libdir/vector"` and the backup
 * fails with an opaque `pg_dump exit=1`. The self-upgrade then aborts at the
 * recovery point with no cause and no remedy surfaced to the operator.
 *
 * This preflight catches that state BEFORE pg_dump and converts it into an
 * actionable failure: it names the missing extension(s) and the one-command
 * remedy. It never recreates the container itself — the self-upgrade deploy
 * deliberately uses `--no-deps` and never touches postgres (fleet-safety
 * invariant); recreating the DB mid-upgrade is a destructive action that
 * requires an explicit operator go. (Kernel decision, principle_decide:
 * fail-fast-with-remedy over auto-heal, high confidence.)
 *
 * Detection is general, not vector-specific: an extension recorded in
 * `pg_extension` (the DB catalog, which lives in the data volume) but absent
 * from `pg_available_extensions` (the control files the *image* ships) is
 * installed-but-unprovided — exactly the image-swap failure class.
 *
 * The preflight is FAIL-OPEN on any inconclusive signal (cannot reach the DB,
 * query error, unexpected output): it must never become a NEW failure source.
 * pg_dump remains the source of truth. It fails CLOSED only on a definitive
 * "installed but unavailable" result.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Extensions present in the catalog (`pg_extension`) but not provided by the
 * running image (absent from `pg_available_extensions`). string_agg keeps the
 * result to a single row/line the caller can parse without ceremony.
 */
export const DB_EXTENSION_AVAILABILITY_SQL =
  "SELECT string_agg(e.extname, ',' ORDER BY e.extname) " +
  "FROM pg_extension e " +
  "LEFT JOIN pg_available_extensions a ON a.name = e.extname " +
  "WHERE a.name IS NULL";

/** Runs one SQL string against the DB and returns its stdout + exit code. */
export type ContainerPsql = (
  sql: string,
) => Promise<{ stdout: string; exitCode: number }>;

export type BackupPreflightResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Operator-facing remedy message. Names the missing extension(s) and the exact
 * one-command fix. The remedy recreates ONLY postgres (`--no-deps`) from the
 * compose image; the data is preserved in the pgdata volume.
 */
export function buildMissingExtensionMessage(unmet: string[]): string {
  const names = unmet.join(", ");
  const isPlural = unmet.length > 1;
  return (
    `The Postgres container is running an image that does not provide ` +
    `${isPlural ? "extensions" : "the extension"} the database requires: ` +
    `${names}. This happens when the postgres container was recreated onto a ` +
    `plain image (e.g. postgres:16-alpine) instead of the pgvector-enabled ` +
    `image the schema depends on, which makes pg_dump and vector queries fail. ` +
    `Recreate the postgres container from the compose image — the data is ` +
    `preserved in the pgdata volume — with: ` +
    `docker compose up -d --no-deps postgres`
  );
}

/**
 * Parse the availability-query stdout. Empty output (or an all-whitespace
 * string_agg NULL) means every installed extension is provided by the image.
 */
function parseUnmetExtensions(stdout: string): string[] {
  return stdout
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Detect extensions installed in the catalog but not provided by the running
 * image. FAIL-OPEN on any error or non-zero exit — an inconclusive preflight
 * must not block a backup that pg_dump might complete fine.
 */
export async function detectMissingExtensions(
  psql: ContainerPsql,
): Promise<BackupPreflightResult> {
  let stdout: string;
  try {
    const res = await psql(DB_EXTENSION_AVAILABILITY_SQL);
    if (res.exitCode !== 0) return { ok: true };
    stdout = res.stdout;
  } catch {
    // Cannot reach the DB / docker missing / query blew up — inconclusive.
    return { ok: true };
  }
  const unmet = parseUnmetExtensions(stdout);
  if (unmet.length === 0) return { ok: true };
  return { ok: false, error: buildMissingExtensionMessage(unmet) };
}

/**
 * Production ContainerPsql: exec `psql` inside the postgres container over the
 * mounted docker socket (same access path the backup shell script uses).
 */
export function dockerContainerPsql(args: {
  container: string;
  user: string;
  db: string;
}): ContainerPsql {
  return async (sql: string) => {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        [
          "exec",
          args.container,
          "psql",
          "-U",
          args.user,
          "-d",
          args.db,
          "-tAc",
          sql,
        ],
        { timeout: 15_000, maxBuffer: 1024 * 1024 },
      );
      return { stdout, exitCode: 0 };
    } catch (err) {
      const e = err as { code?: number | string };
      const exitCode = typeof e.code === "number" ? e.code : -1;
      return { stdout: "", exitCode };
    }
  };
}

/**
 * Spec-level preflight hook for the Postgres backup engine. Resolves the
 * container/user/db exactly as POSTGRES_BACKUP_SPEC.buildEnv does, then runs
 * the missing-extension detection. `psql` is injectable for tests.
 */
export async function postgresExtensionPreflight(
  ctx: { composeProject: string },
  psql?: ContainerPsql,
): Promise<BackupPreflightResult> {
  const container =
    process.env.DPF_PRODUCTION_DB_CONTAINER ??
    `${ctx.composeProject}-postgres-1`;
  const user = process.env.POSTGRES_USER ?? "dpf";
  const db = process.env.POSTGRES_DB ?? "dpf";
  const exec = psql ?? dockerContainerPsql({ container, user, db });
  return detectMissingExtensions(exec);
}
