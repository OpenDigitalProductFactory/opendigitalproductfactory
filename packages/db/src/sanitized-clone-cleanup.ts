/**
 * A clone cannot share one transaction with pg_dump/psql child processes.
 * Clear the disposable destination before publication and again on failure.
 */
export async function runWithDestinationCleanup<T>(
  resetDestination: () => Promise<void>,
  clone: () => Promise<T>,
): Promise<T> {
  await resetDestination();
  try {
    return await clone();
  } catch (cloneError) {
    try {
      await resetDestination();
    } catch (cleanupError) {
      throw new AggregateError(
        [cloneError, cleanupError],
        "Sanitized clone failed and destination cleanup also failed",
      );
    }
    throw cloneError;
  }
}

export async function runSourceCheckedClone<T>(
  resetDestination: () => Promise<void>,
  checkSource: () => Promise<void>,
  clone: () => Promise<T>,
): Promise<T> {
  return runWithDestinationCleanup(resetDestination, async () => {
    await checkSource();
    return clone();
  });
}

// ── S5 rehearsal requester destination fence (BI-9F7192F9, AC-E3) ───────────
// docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md,
// "Restrict, delete, clone and portability contract". The clone holds this key
// as a session lock on a pinned destination connection; enrollment and
// retirement take it as a transaction-scoped shared try-lock.

export const REQUESTER_DESTINATION_FENCE_KEY = "dpf:s5-rehearsal-requester:destination-fence";
const REQUESTER_TABLE = '"S5RehearsalRequesterEnrollment"';
const WRITER_EXIT_DEADLINE_MS = 10_000;

type SqlClient = { query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
type FenceConnection = SqlClient & { on(event: "error" | "end", listener: () => void): unknown };

export type CloneFenceCode = "fence_lost" | "requester_active" | "requester_retired_evidence" | "source_has_requester";

export class CloneFenceError extends Error {
  constructor(readonly code: CloneFenceCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "CloneFenceError";
  }
}

/** Tag every destination connection of one clone run so a lost fence stops exactly that run's writers. */
export function withApplicationName(connectionString: string, applicationName: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

/**
 * Enrollment and retirement: the first statement of their request-scoped
 * transaction. false means a clone holds the fence (`clone_in_progress`).
 */
export async function tryEnterRequesterFenceShared(transaction: SqlClient): Promise<boolean> {
  const { rows } = await transaction.query(
    "SELECT pg_try_advisory_xact_lock_shared(hashtextextended($1, 0)) AS entered",
    [REQUESTER_DESTINATION_FENCE_KEY],
  );
  return rows[0]?.entered === true;
}

async function requesterTableExists(client: SqlClient): Promise<boolean> {
  const { rows } = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [REQUESTER_TABLE]);
  return rows[0]?.present === true;
}

/** Destination preflight, under the fence and before any reset. */
export async function preflightRequesterDestination(
  client: SqlClient,
  { discardRetiredEvidence }: { discardRetiredEvidence: boolean },
): Promise<{ active: number; retired: number }> {
  if (!(await requesterTableExists(client))) return { active: 0, retired: 0 };
  const { rows } = await client.query(
    `SELECT count(*) FILTER (WHERE lifecycle::text = 'active')::int AS active,
            count(*) FILTER (WHERE lifecycle::text <> 'active')::int AS retired
       FROM ${REQUESTER_TABLE}`,
  );
  const active = Number(rows[0]?.active ?? 0);
  const retired = Number(rows[0]?.retired ?? 0);
  if (active > 0) {
    throw new CloneFenceError("requester_active",
      `destination holds ${active} active S5 rehearsal requester(s); the owner retires them before a clone`);
  }
  if (retired > 0 && !discardRetiredEvidence) {
    throw new CloneFenceError("requester_retired_evidence",
      `destination holds ${retired} retired S5 rehearsal requester record(s); pass --discard-retired-rehearsal-evidence to discard this database's evidence`);
  }
  return { active, retired };
}

/**
 * Source count inside the caller's existing REPEATABLE READ snapshot. A source
 * from before the migration has no table and counts zero.
 */
export async function assertSourceHasNoRequester(source: SqlClient): Promise<number> {
  if (!(await requesterTableExists(source))) return 0;
  const { rows } = await source.query(`SELECT count(*)::int AS n FROM ${REQUESTER_TABLE}`);
  const count = Number(rows[0]?.n ?? 0);
  if (count > 0) {
    throw new CloneFenceError("source_has_requester", `source holds ${count} S5 rehearsal requester record(s); it is not cloned`);
  }
  return 0;
}

export type RequesterFenceOptions = {
  /** Pinned destination connection that holds the session lock. */
  fenceClient: FenceConnection;
  /** Separate destination connection, opened at start, used only to stop this run's writers. */
  supervisorClient: SqlClient;
  /** application_name carried by every destination writer of this run (Prisma pool and COPY psql). */
  writerApplicationName: string;
  discardRetiredEvidence: boolean;
  log?: (message: string) => void;
};

/**
 * Hold the destination fence from before the preflight through reset, copy and
 * failure cleanup. If the fence connection is lost, stop with `fence_lost`:
 * run no cleanup, terminate only this run's writer backends, confirm they are
 * gone, and fail.
 */
export async function withRequesterDestinationFence<T>(
  options: RequesterFenceOptions,
  run: (fence: { assertHeld(): void }) => Promise<T>,
): Promise<T> {
  const log = options.log ?? ((message: string) => console.log(`[sanitized-clone] ${message}`));
  let lost = false;
  let signalLost: () => void = () => {};
  const lostSignal = new Promise<void>((resolve) => { signalLost = resolve; });
  const markLost = () => { if (!lost) { lost = true; signalLost(); } };
  options.fenceClient.on("error", markLost);
  options.fenceClient.on("end", markLost);
  const fence = {
    assertHeld() {
      if (lost) throw new CloneFenceError("fence_lost", "the destination fence connection was lost; no cleanup runs");
    },
  };

  await options.fenceClient.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [REQUESTER_DESTINATION_FENCE_KEY]);
  try {
    const preflight = await preflightRequesterDestination(options.fenceClient, options);
    if (preflight.retired > 0) log(`discarding ${preflight.retired} retired S5 rehearsal requester record(s) by explicit disposition`);
    const work = run(fence);
    work.catch(() => {}); // awaited below, or superseded by fence_lost
    const outcome = await Promise.race([work.then((value) => ({ value })), lostSignal.then(() => null)]);
    if (outcome && !lost) return outcome.value;
    await stopRunWriters(options);
    await Promise.race([work.catch(() => {}), new Promise((resolve) => setTimeout(resolve, WRITER_EXIT_DEADLINE_MS))]);
    throw new CloneFenceError("fence_lost",
      "the destination fence connection was lost during the clone; this run's writers were stopped and no cleanup ran");
  } finally {
    if (!lost) {
      await options.fenceClient.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [REQUESTER_DESTINATION_FENCE_KEY]);
    }
  }
}

async function stopRunWriters({ supervisorClient, writerApplicationName }: RequesterFenceOptions): Promise<void> {
  const { rows } = await supervisorClient.query(
    `SELECT pid, pg_terminate_backend(pid) AS terminated
       FROM pg_stat_activity
      WHERE application_name = $1 AND pid <> pg_backend_pid()`,
    [writerApplicationName],
  );
  const pids = rows.map((row) => Number(row.pid));
  const deadline = Date.now() + WRITER_EXIT_DEADLINE_MS;
  for (;;) {
    const { rows: alive } = await supervisorClient.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ANY($1::int[])", [pids]);
    if (Number(alive[0]?.n ?? 0) === 0) return;
    if (Date.now() > deadline) throw new CloneFenceError("fence_lost", `writer backends ${pids.join(",")} did not exit`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
