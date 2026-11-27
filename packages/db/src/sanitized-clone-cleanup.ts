import { randomUUID } from "node:crypto";

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
const DRAIN_DEADLINE_MS = 10_000;
const DRAIN_POLL_MS = 250;
const COPY_ADMISSION_DEADLINE_MS = 5_000;

type SqlClient = { query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
type FenceConnection = SqlClient & { on(event: "error" | "end", listener: () => void): unknown };

export type CloneFenceCode = "fence_lost" | "requester_active" | "requester_retired_evidence" | "source_has_requester";

export class CloneFenceError extends Error {
  constructor(readonly code: CloneFenceCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "CloneFenceError";
  }
}

/** Correlate one clone run's destination sessions; never used as termination authority. */
/** PostgreSQL keeps at most NAMEDATALEN - 1 bytes of application_name; a longer name is silently truncated. */
export const MAX_APPLICATION_NAME_BYTES = 63;

function assertApplicationNameFits(applicationName: string): void {
  if (Buffer.byteLength(applicationName, "utf8") > MAX_APPLICATION_NAME_BYTES) {
    throw new Error(`application_name "${applicationName}" exceeds ${MAX_APPLICATION_NAME_BYTES} bytes and would be truncated`);
  }
}

/** A short per-run correlation tag: 22 bytes, so every derived writer name stays far under the limit. */
export function newCloneWriterTag(): string {
  return `dpfsc:${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** The exact application name of one of this run's sessions; refuses a name PostgreSQL would truncate. */
export function cloneWriterName(tag: string, role: string): string {
  const name = role ? `${tag}:${role}` : tag;
  assertApplicationNameFits(name);
  return name;
}

export function withApplicationName(connectionString: string, applicationName: string): string {
  assertApplicationNameFits(applicationName);
  const url = new URL(connectionString);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

/** True only when the explicit operator flag is present; the fixed product entry points pass none. */
export function discardRetiredEvidenceFromArgv(argv: readonly string[]): boolean {
  return argv.includes("--discard-retired-rehearsal-evidence");
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

/** A destination writer backend, registered by its own session when it opens. */
export type RegisteredWriter = { pid: number; backendStart: string; applicationName: string };

const SELF_IDENTITY_SQL = `SELECT pid, backend_start::text AS "backendStart", application_name AS "applicationName"
  FROM pg_stat_activity WHERE pid = pg_backend_pid()`;

// A session-level advisory lock on a bigint key appears in pg_locks as
// classid = high 32 bits, objid = low 32 bits, objsubid = 1.
const OWNS_FENCE_PREDICATE = `EXISTS (SELECT 1 FROM pg_locks
  WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted AND mode = 'ExclusiveLock' AND objsubid = 1
    AND ((classid::bigint << 32) | objid::bigint) = hashtextextended('${REQUESTER_DESTINATION_FENCE_KEY}', 0))`;

/**
 * Terminate only backends whose pid, backend_start and application name all
 * still match a registration. A recycled pid or an unregistered session that
 * shares the run tag is never touched. Returns the pids terminated.
 */
export async function terminateRegisteredWriters(
  supervisor: SqlClient,
  writers: readonly RegisteredWriter[],
): Promise<number[]> {
  if (writers.length === 0) return [];
  // One statement signals every matching writer together, so stopping one
  // writer cannot release a lock that lets another commit before its signal.
  const { rows } = await supervisor.query(
    `SELECT a.pid, pg_terminate_backend(a.pid) AS done
       FROM pg_stat_activity a
       JOIN unnest($1::int[], $2::timestamptz[], $3::text[]) AS w(pid, backend_start, application_name)
         ON a.pid = w.pid AND a.backend_start = w.backend_start AND a.application_name = w.application_name
      WHERE a.pid <> pg_backend_pid()`,
    [writers.map((w) => w.pid), writers.map((w) => w.backendStart), writers.map((w) => w.applicationName)],
  );
  return rows.map((row) => Number(row.pid));
}

async function liveRegisteredWriters(supervisor: SqlClient, writers: readonly RegisteredWriter[]): Promise<RegisteredWriter[]> {
  const live: RegisteredWriter[] = [];
  for (const writer of writers) {
    const { rows } = await supervisor.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND backend_start = $2::timestamptz AND application_name = $3",
      [writer.pid, writer.backendStart, writer.applicationName],
    );
    if (rows.length > 0) live.push(writer);
  }
  return live;
}

export type RequesterFenceOptions = {
  /** Pinned, non-reconnecting destination session that holds the session lock and runs every destructive reset. */
  fenceClient: FenceConnection;
  /** Separate destination session, opened at start, used only to find and stop this run's registered writers. */
  supervisorClient: SqlClient;
  discardRetiredEvidence: boolean;
  log?: (message: string) => void;
};

export type RequesterFence = {
  /** Active proof that the fence session still owns the lock; throws fence_lost otherwise. */
  ensureHeld(): Promise<void>;
  /** Run a destructive reset on the fence session itself, atomically with the ownership proof. */
  resetDestination(resetSql: string | null): Promise<void>;
  /** Admit a writer session: proof, register its own backend identity, proof again, before any write. */
  registerWriter(writer: SqlClient): Promise<void>;
  /** Admit a COPY writer by its unique application name once connected, before any data flows. */
  admitCopy(applicationName: string): Promise<void>;
  /**
   * Run the clone's final writes and their COMMIT in one transaction on the
   * pinned fence session itself, so the commit and lock ownership cannot
   * separate. A loss, or a COMMIT whose outcome is unproven, fails as fence_lost.
   */
  finalizeOnFenceSession(run: (tx: FenceSessionTransaction) => Promise<void>): Promise<void>;
};

/** The minimal raw-SQL surface the final writes need, bound to the fence session's open transaction. */
export type FenceSessionTransaction = {
  $queryRawUnsafe(sql: string, ...values: unknown[]): Promise<Array<{ id: string }>>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
};

function isFenceLost(error: unknown): boolean {
  if (error instanceof CloneFenceError) return error.code === "fence_lost";
  if (error instanceof AggregateError) return error.errors.some(isFenceLost);
  return false;
}

/**
 * Hold the destination fence from before the preflight through reset, copy and
 * failure cleanup. A classified loss always wins over a concurrent writer
 * failure: no reset runs without proof on the fence session, later writers are
 * refused before their first write, and every registered writer is drained
 * before the run fails with fence_lost.
 */
export async function withRequesterDestinationFence<T>(
  options: RequesterFenceOptions,
  run: (fence: RequesterFence) => Promise<T>,
): Promise<T> {
  const { fenceClient, supervisorClient } = options;
  const log = options.log ?? ((message: string) => console.log(`[sanitized-clone] ${message}`));
  const writers: RegisteredWriter[] = [];
  let lost = false;
  let signalLost: () => void = () => {};
  const lostSignal = new Promise<void>((resolve) => { signalLost = resolve; });
  const markLost = () => { if (!lost) { lost = true; signalLost(); } };
  fenceClient.on("error", markLost);
  fenceClient.on("end", markLost);
  const lostError = (detail: string) => new CloneFenceError("fence_lost", detail);

  const ensureHeld = async () => {
    if (lost) throw lostError("the destination fence was already lost; nothing more is admitted");
    let held = false;
    try {
      held = (await fenceClient.query(`SELECT ${OWNS_FENCE_PREDICATE} AS held`)).rows[0]?.held === true;
    } catch { held = false; }
    if (!held) { markLost(); throw lostError("the fence session no longer owns the destination fence"); }
  };
  const probeHeld = async () => { try { await ensureHeld(); return true; } catch { return false; } };

  const fence: RequesterFence = {
    ensureHeld,
    async resetDestination(resetSql) {
      if (lost) throw lostError("the destination fence was lost; no reset runs");
      if (!resetSql) return ensureHeld();
      try {
        await fenceClient.query(
          "DO $fence$ BEGIN IF NOT " + OWNS_FENCE_PREDICATE +
          " THEN RAISE EXCEPTION 'fence_lost: destination fence not held by this session'; END IF; EXECUTE $reset$" +
          resetSql + "$reset$; END $fence$",
        );
      } catch (error) {
        if (await probeHeld()) throw error;
        throw lostError("the destination fence was lost before the reset; nothing was truncated");
      }
    },
    async registerWriter(writer) {
      await ensureHeld();
      const identity = (await writer.query(SELF_IDENTITY_SQL)).rows[0];
      if (!identity) throw new Error("writer session identity could not be read");
      writers.push({ pid: Number(identity.pid), backendStart: String(identity.backendStart), applicationName: String(identity.applicationName) });
      await ensureHeld();
    },
    async admitCopy(applicationName) {
      await ensureHeld();
      const deadline = Date.now() + COPY_ADMISSION_DEADLINE_MS;
      for (;;) {
        const { rows } = await supervisorClient.query(
          `SELECT pid, backend_start::text AS "backendStart" FROM pg_stat_activity WHERE application_name = $1`,
          [applicationName],
        );
        if (rows.length === 1) {
          writers.push({ pid: Number(rows[0]!.pid), backendStart: String(rows[0]!.backendStart), applicationName });
          break;
        }
        if (rows.length > 1) throw new Error(`COPY writer name ${applicationName} is not unique`);
        if (Date.now() > deadline) throw new Error(`COPY writer ${applicationName} did not connect`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await ensureHeld();
    },
    async finalizeOnFenceSession(run) {
      if (lost) throw lostError("the destination fence was lost; no final write runs");
      const query = async (sql: string, values: unknown[]) =>
        (await fenceClient.query(sql, values)) as { rows: Array<Record<string, unknown>>; rowCount?: number | null };
      let open = false;
      try {
        await fenceClient.query("BEGIN");
        open = true;
        // The session that holds the session-level lock proves it inside the same transaction that commits.
        if ((await fenceClient.query(`SELECT ${OWNS_FENCE_PREDICATE} AS held`)).rows[0]?.held !== true) {
          markLost();
          throw lostError("the fence session no longer owns the destination fence; no final write runs");
        }
        await run({
          $queryRawUnsafe: async (sql, ...values) => (await query(sql, values)).rows as Array<{ id: string }>,
          $executeRawUnsafe: async (sql, ...values) => (await query(sql, values)).rowCount ?? 0,
        });
        open = false; // once COMMIT is sent, its outcome is either proven below or treated as lost
        await fenceClient.query("COMMIT");
      } catch (error) {
        if (open) await fenceClient.query("ROLLBACK").catch(() => {});
        if (error instanceof CloneFenceError) throw error;
        if (await probeHeld()) throw error;
        throw lostError("the destination fence was lost during the final writes; their commit is unproven and the clone fails");
      }
    },
  };

  const drain = async (settled: Promise<unknown>) => {
    let done = false;
    void settled.then(() => { done = true; });
    const deadline = Date.now() + DRAIN_DEADLINE_MS;
    const terminated = new Set<number>();
    for (;;) {
      const live = await liveRegisteredWriters(supervisorClient, writers);
      for (const pid of await terminateRegisteredWriters(supervisorClient, live)) terminated.add(pid);
      if (done && live.length === 0) return [...terminated];
      if (Date.now() > deadline) {
        throw lostError(`registered writers ${live.map((w) => w.pid).join(",") || "(none)"} did not exit within ${DRAIN_DEADLINE_MS} ms`);
      }
      await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS))]);
    }
  };

  await fenceClient.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [REQUESTER_DESTINATION_FENCE_KEY]);
  try {
    const preflight = await preflightRequesterDestination(fenceClient, options);
    if (preflight.retired > 0) log(`discarding ${preflight.retired} retired S5 rehearsal requester record(s) by explicit operator disposition`);
    const settled = run(fence).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    const first = await Promise.race([settled, lostSignal.then(() => null)]);
    // Classified loss wins: a result or a failure counts only while the fence is provably held.
    if (first && !(first.ok === false && isFenceLost(first.error)) && (await probeHeld())) {
      if (first.ok) return first.value;
      throw first.error;
    }
    markLost();
    const terminated = await drain(settled);
    log(`destination fence lost; stopped registered writer backend(s) ${terminated.join(",") || "(none)"}; no cleanup ran`);
    throw lostError("the destination fence was lost during the clone; registered writers were stopped and no cleanup ran");
  } finally {
    if (!lost && (await probeHeld())) {
      await fenceClient.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [REQUESTER_DESTINATION_FENCE_KEY]);
    }
  }
}
