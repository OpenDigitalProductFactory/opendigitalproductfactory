/**
 * BI-9F7192F9 phase 2 (AC-E3): the S5 rehearsal requester destination fence
 * around the sanitized clone.
 *
 * Unit cases always run. Real-PostgreSQL cases run only when
 * DPF_S5_REQUESTER_TEST_DATABASE_URL names a DISPOSABLE database (a throwaway
 * container, never the live install or any shared database); each builds its
 * own schema with minimal tables and drops it at the end.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CloneFenceError,
  MAX_APPLICATION_NAME_BYTES,
  REQUESTER_DESTINATION_FENCE_KEY,
  assertSourceHasNoRequester,
  cloneWriterName,
  discardRetiredEvidenceFromArgv,
  newCloneWriterTag,
  preflightRequesterDestination,
  runRegisteredFinalizers,
  runWithDestinationCleanup,
  terminateRegisteredWriters,
  tryEnterRequesterFenceShared,
  withApplicationName,
  withRequesterDestinationFence,
  type RequesterFence,
} from "./sanitized-clone-cleanup";

const DATABASE_URL = process.env.DPF_S5_REQUESTER_TEST_DATABASE_URL?.trim() ?? "";

describe("requester destination fence (unit)", () => {
  it("uses the fixed, documented fence key", () => {
    expect(REQUESTER_DESTINATION_FENCE_KEY).toBe("dpf:s5-rehearsal-requester:destination-fence");
  });

  it("tags a connection string with an application name without losing its other parameters", () => {
    const tagged = new URL(withApplicationName("postgresql://u:p@h:5432/db?sslmode=disable", "dpf-clone:run-1"));
    expect(tagged.searchParams.get("application_name")).toBe("dpf-clone:run-1");
    expect(tagged.searchParams.get("sslmode")).toBe("disable");
  });

  it("keeps every writer name PostgreSQL would see whole: fence, supervisor and COPY up to a million", () => {
    const tag = newCloneWriterTag();
    expect(Buffer.byteLength(tag)).toBe(22);
    for (const role of ["", "fence", "supervisor", "copy:1", "copy:10", "copy:1000000"]) {
      expect(Buffer.byteLength(cloneWriterName(tag, role))).toBeLessThanOrEqual(MAX_APPLICATION_NAME_BYTES);
    }
    // The old tag shape put copy:10 at 64 bytes, which PostgreSQL truncates; it is refused, never silently cut.
    const oldShape = `dpf-sanitized-clone:${randomUUID()}`;
    expect(() => cloneWriterName(oldShape, "copy:10")).toThrow(/exceeds 63 bytes/);
    expect(() => withApplicationName("postgresql://u:p@h:5432/db", `${oldShape}:copy:10`)).toThrow(/exceeds 63 bytes/);
  });

  it("keeps the generic cleanup wrapper unchanged: a failed clone resets again", async () => {
    const reset = vi.fn(async () => {});
    await expect(runWithDestinationCleanup(reset, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("takes the discard disposition only from the explicit operator flag; the fixed entry points pass none", () => {
    expect(discardRetiredEvidenceFromArgv(["node", "sanitized-clone.ts"])).toBe(false);
    expect(discardRetiredEvidenceFromArgv(["node", "sanitized-clone.ts", "--discard-retired-rehearsal-evidence"])).toBe(true);
    expect(discardRetiredEvidenceFromArgv(["node", "sanitized-clone.ts", "--discard-retired-rehearsal-evidence=false"])).toBe(false);
  });
});

describe.skipIf(!DATABASE_URL)("requester destination fence (real database)", () => {
  const schema = `s5_fence_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const opts = `-c search_path="${schema}"`;
  const destination = `"${schema}"."Destination"`;
  let admin: Client;
  const clients: Client[] = [];

  const connect = async (applicationName: string) => {
    const client = new Client({ connectionString: withApplicationName(DATABASE_URL, applicationName), options: opts });
    client.on("error", () => {}); // terminated sessions are expected in these tests
    await client.connect();
    clients.push(client);
    return client;
  };
  const pidOf = async (client: Client) => Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  const alive = async (pid: number) => (await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1", [pid])).rowCount === 1;
  const destinationCount = async () => Number((await admin.query(`SELECT count(*)::int AS n FROM ${destination}`)).rows[0].n);

  const resetRequesters = async (rows: Array<"active" | "retired">) => {
    await admin.query(`DELETE FROM "${schema}"."S5RehearsalRequesterEnrollment"`);
    for (const [i, lifecycle] of rows.entries()) {
      await admin.query(`INSERT INTO "${schema}"."S5RehearsalRequesterEnrollment" (id, lifecycle) VALUES ($1, $2)`, [`r${i}`, lifecycle]);
    }
  };
  const requesterCount = async () =>
    Number((await admin.query(`SELECT count(*)::int AS n FROM "${schema}"."S5RehearsalRequesterEnrollment"`)).rows[0].n);

  /** The fence and supervisor connections the real clone opens. */
  const fenceOptions = async (discardRetiredEvidence = false) => {
    const tag = `dpf-test:${randomUUID()}`;
    return {
      tag,
      fenceClient: await connect(`${tag}:fence`),
      supervisorClient: await connect(`${tag}:supervisor`),
      discardRetiredEvidence,
      log: () => {},
    };
  };
  const truncateDestination = (fence: RequesterFence) => fence.resetDestination(`TRUNCATE TABLE ${destination}`);

  beforeAll(async () => {
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`CREATE TABLE "${schema}"."S5RehearsalRequesterEnrollment" (id text PRIMARY KEY, lifecycle text NOT NULL)`);
    await admin.query(`CREATE TABLE ${destination} (id text PRIMARY KEY)`);
  }, 30_000);

  afterAll(async () => {
    for (const client of clients) await client.end().catch(() => {});
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("proceeds when the destination has no requester table (fresh or pre-migration destination)", async () => {
    const bare = await connect(`dpf-test:${randomUUID()}:bare`);
    await bare.query(`SET search_path TO pg_catalog`);
    await expect(preflightRequesterDestination(bare, { discardRetiredEvidence: false })).resolves.toEqual({ active: 0, retired: 0 });
  });

  it("refuses an active requester before reset and leaves every destination row intact", async () => {
    await resetRequesters(["active", "retired"]);
    const run = vi.fn(async () => "cloned");
    const error = await withRequesterDestinationFence(await fenceOptions(), run).catch((e: unknown) => e);
    expect((error as CloneFenceError).code).toBe("requester_active");
    expect(run).not.toHaveBeenCalled();
    expect(await requesterCount()).toBe(2);
  });

  it("refuses retired-only evidence without the explicit discard disposition, and proceeds with it", async () => {
    await resetRequesters(["retired"]);
    const refused = await withRequesterDestinationFence(await fenceOptions(), async () => "cloned").catch((e: unknown) => e);
    expect((refused as CloneFenceError).code).toBe("requester_retired_evidence");
    expect(await requesterCount()).toBe(1);
    await expect(withRequesterDestinationFence(await fenceOptions(true), async () => "cloned")).resolves.toBe("cloned");
  });

  it("(e) the destructive reset runs on the pinned fence session only with proof of lock ownership", async () => {
    await resetRequesters([]);
    await admin.query(`INSERT INTO ${destination} VALUES ('row-1')`);
    const options = await fenceOptions();
    const error = await withRequesterDestinationFence(options, async (fence) => {
      await truncateDestination(fence); // lock held: truncates (and proves the key's pg_locks mapping)
      expect(await destinationCount()).toBe(0);
      await admin.query(`INSERT INTO ${destination} VALUES ('row-2')`);
      await options.fenceClient.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [REQUESTER_DESTINATION_FENCE_KEY]);
      await truncateDestination(fence); // same session, lock no longer held: refuses
    }).catch((e: unknown) => e);
    expect((error as CloneFenceError).code).toBe("fence_lost");
    expect(await destinationCount()).toBe(1);
    await admin.query(`TRUNCATE ${destination}`);
  });

  it("R-ONE-FENCE: while a clone holds the fence, the enrollment shared try-lock fails (clone_in_progress) with no write", async () => {
    await resetRequesters([]);
    const enrollment = await connect(`dpf-test:${randomUUID()}:enroll`);
    let insideClone: boolean | undefined;
    await withRequesterDestinationFence(await fenceOptions(), async () => {
      await enrollment.query("BEGIN");
      insideClone = await tryEnterRequesterFenceShared(enrollment);
      if (insideClone) await enrollment.query(`INSERT INTO "S5RehearsalRequesterEnrollment" VALUES ('raced', 'active')`);
      await enrollment.query("ROLLBACK");
    });
    expect(insideClone).toBe(false);
    expect(await requesterCount()).toBe(0);
    await enrollment.query("BEGIN");
    expect(await tryEnterRequesterFenceShared(enrollment)).toBe(true);
    await enrollment.query("ROLLBACK");
  });

  it("R-ONE-FENCE: a clone that arrives during an enrollment waits, then its preflight sees the committed requester and refuses", async () => {
    await resetRequesters([]);
    const enrollment = await connect(`dpf-test:${randomUUID()}:enroll`);
    await enrollment.query("BEGIN");
    expect(await tryEnterRequesterFenceShared(enrollment)).toBe(true);
    const clone = withRequesterDestinationFence(await fenceOptions(), async () => "cloned").catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 300));
    await enrollment.query(`INSERT INTO "S5RehearsalRequesterEnrollment" VALUES ('enrolled', 'active')`);
    await enrollment.query("COMMIT");
    expect(((await clone) as CloneFenceError).code).toBe("requester_active");
    expect(await requesterCount()).toBe(1);
  });

  it("counts source requesters inside the caller's snapshot, as zero when the table is absent", async () => {
    await resetRequesters([]);
    const source = await connect(`dpf-test:${randomUUID()}:source`);
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await expect(assertSourceHasNoRequester(source)).resolves.toBe(0);
    await source.query("COMMIT");
    const bare = await connect(`dpf-test:${randomUUID()}:bare-source`);
    await bare.query(`SET search_path TO pg_catalog`);
    await expect(assertSourceHasNoRequester(bare)).resolves.toBe(0);
  });

  it("a requester-bearing source aborts through the existing cleanup and leaves no requester in the destination", async () => {
    await resetRequesters(["retired"]);
    const sourceSchema = `${schema}_src`; // stands in for the separate source database
    await admin.query(`CREATE SCHEMA "${sourceSchema}"`);
    await admin.query(`CREATE TABLE "${sourceSchema}"."S5RehearsalRequesterEnrollment" (id text PRIMARY KEY, lifecycle text NOT NULL)`);
    await admin.query(`INSERT INTO "${sourceSchema}"."S5RehearsalRequesterEnrollment" VALUES ('source-requester', 'active')`);
    const source = new Client({ connectionString: DATABASE_URL, options: `-c search_path="${sourceSchema}"` });
    await source.connect();
    clients.push(source);
    try {
      await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      let resets = 0;
      const error = await withRequesterDestinationFence(await fenceOptions(true), (fence) =>
        runWithDestinationCleanup(async () => {
          resets++;
          await fence.resetDestination(`TRUNCATE TABLE "${schema}"."S5RehearsalRequesterEnrollment"`);
        }, async () => {
          await assertSourceHasNoRequester(source);
          await admin.query(`INSERT INTO "${schema}"."S5RehearsalRequesterEnrollment" VALUES ('copied', 'active')`);
        })).catch((e: unknown) => e);
      await source.query("ROLLBACK");
      expect((error as CloneFenceError).code).toBe("source_has_requester");
      expect(resets).toBe(2);
      expect(await requesterCount()).toBe(0);
    } finally {
      await admin.query(`DROP SCHEMA "${sourceSchema}" CASCADE`);
    }
  });

  it("(a) late writer admission after an observed loss halts before the writer's first write", async () => {
    await resetRequesters([]);
    const options = await fenceOptions();
    const fencePid = await pidOf(options.fenceClient);
    const late = await connect(`${options.tag}:late`);
    const latePid = await pidOf(late);
    let wrote = false;
    const error = await withRequesterDestinationFence(options, async (fence) => {
      await admin.query("SELECT pg_terminate_backend($1)", [fencePid]);
      await fence.registerWriter(late); // must throw fence_lost
      await late.query(`INSERT INTO ${destination} VALUES ('late')`);
      wrote = true;
    }).catch((e: unknown) => e);
    expect((error as CloneFenceError).code).toBe("fence_lost");
    expect(wrote).toBe(false);
    expect(await destinationCount()).toBe(0);
    expect(await alive(latePid)).toBe(true); // never admitted, so never registered or terminated
  }, 30_000);

  it("(b) a loss terminates every registered writer, including one idle at the first drain pass, and nothing unregistered", async () => {
    await resetRequesters([]);
    const options = await fenceOptions();
    const fencePid = await pidOf(options.fenceClient);
    const writerA = await connect(`${options.tag}:prisma`);
    const writerB = await connect(`${options.tag}:copy:1`);
    const sameTagBystander = await connect(`${options.tag}:copy:1`); // same correlation tag, never registered
    const otherBystander = await connect(`dpf-test:${randomUUID()}:bystander`);
    const [pidA, pidB, pidSame, pidOther] = await Promise.all([writerA, writerB, sameTagBystander, otherBystander].map(pidOf));
    let writeError: unknown;
    const error = await withRequesterDestinationFence(options, async (fence) => {
      await fence.registerWriter(writerA);
      await fence.registerWriter(writerB);
      await writerA.query("BEGIN");
      await writerA.query(`INSERT INTO ${destination} VALUES ('in-flight')`);
      const blocked = writerB.query(`INSERT INTO ${destination} VALUES ('in-flight')`).catch((e: unknown) => { writeError = e; });
      await admin.query("SELECT pg_terminate_backend($1)", [fencePid]);
      await blocked;
      await writerA.query("COMMIT");
    }).catch((e: unknown) => e);
    expect((error as CloneFenceError).code).toBe("fence_lost");
    expect(writeError).toBeTruthy();
    expect(await alive(pidA)).toBe(false);
    expect(await alive(pidB)).toBe(false);
    expect(await alive(pidSame)).toBe(true);
    expect(await alive(pidOther)).toBe(true);
    expect(await destinationCount()).toBe(0);
    // Recovery is a fresh fenced run, which begins with the normal reset.
    await expect(withRequesterDestinationFence(await fenceOptions(), async (fence) => {
      await truncateDestination(fence);
      return "recovered";
    })).resolves.toBe("recovered");
  }, 30_000);

  it("(b) termination matches pid, backend_start and application name together, so a stale or recycled identity is never terminated", async () => {
    const bystander = await connect(`dpf-test:${randomUUID()}:bystander`);
    const pid = await pidOf(bystander);
    const supervisor = await connect(`dpf-test:${randomUUID()}:supervisor`);
    const { rows } = await admin.query("SELECT application_name FROM pg_stat_activity WHERE pid = $1", [pid]);
    const terminated = await terminateRegisteredWriters(supervisor, [
      { pid, backendStart: "2000-01-01 00:00:00+00", applicationName: rows[0].application_name },
    ]);
    expect(terminated).toEqual([]);
    expect(await alive(pid)).toBe(true);
  });

  it("(c) a writer rejection that races ahead of the loss signal is classified as fence_lost: no truncate, no unlock on the dead session", async () => {
    await resetRequesters([]);
    const options = await fenceOptions();
    const fencePid = await pidOf(options.fenceClient);
    const statements: string[] = [];
    const originalQuery = options.fenceClient.query.bind(options.fenceClient);
    (options.fenceClient as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      statements.push(String(args[0]));
      return (originalQuery as (...a: unknown[]) => unknown)(...args);
    };
    const error = await withRequesterDestinationFence(options, (fence) =>
      runWithDestinationCleanup(() => truncateDestination(fence), async () => {
        await admin.query(`INSERT INTO ${destination} VALUES ('kept')`);
        await admin.query("SELECT pg_terminate_backend($1)", [fencePid]);
        throw new Error("writer connection reset"); // rejects before pg reports the fence session's loss
      })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloneFenceError);
    expect((error as CloneFenceError).code).toBe("fence_lost");
    expect(await destinationCount()).toBe(1); // the failure-cleanup reset could not truncate without proof
    expect(statements.filter((sql) => sql.includes("pg_advisory_unlock"))).toEqual([]);
    await admin.query(`TRUNCATE ${destination}`);
  }, 30_000);

  it("(d) settlement waits until the original registered writer is gone, within the drain bound", async () => {
    await resetRequesters([]);
    const options = await fenceOptions();
    const fencePid = await pidOf(options.fenceClient);
    const writer = await connect(`${options.tag}:prisma`);
    const writerPid = await pidOf(writer);
    const started = Date.now();
    let writerAliveAtSettlement: boolean | undefined;
    const error = await withRequesterDestinationFence(options, async (fence) => {
      await fence.registerWriter(writer);
      const sleeping = writer.query("SELECT pg_sleep(30)").catch(() => {});
      await admin.query("SELECT pg_terminate_backend($1)", [fencePid]);
      await sleeping;
    }).catch(async (e: unknown) => { writerAliveAtSettlement = await alive(writerPid); return e; });
    expect((error as CloneFenceError).code).toBe("fence_lost");
    expect(writerAliveAtSettlement).toBe(false);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  const psql = process.env.DPF_S5_TEST_PSQL ?? "psql";
  const psqlUrl = process.env.DPF_S5_TEST_PSQL_URL ?? DATABASE_URL;
  const psqlAvailable = spawnSync(psql, ["--version"]).status === 0;

  // Skipped, and reported as skipped, where no psql binary is available.
  it.skipIf(!psqlAvailable)("admits twelve real psql COPY writers by their full application names (the tenth and beyond included)", async () => {
    await resetRequesters([]);
    await admin.query(`CREATE TABLE IF NOT EXISTS "${schema}"."CopyTarget" (id text PRIMARY KEY)`);
    const options = await fenceOptions();
    const tag = newCloneWriterTag();
    await withRequesterDestinationFence(options, async (fence) => {
      for (let n = 1; n <= 12; n++) {
        const name = cloneWriterName(tag, `copy:${n}`);
        const child = spawn(psql, [psqlUrl, "-v", "ON_ERROR_STOP=1", "-c", `COPY "${schema}"."CopyTarget" (id) FROM STDIN`], {
          stdio: ["pipe", "ignore", "pipe"], env: { ...process.env, PGAPPNAME: name },
        });
        const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
        await fence.admitCopy(name); // matches pg_stat_activity.application_name exactly
        child.stdin!.end(`row-${n}\n`);
        expect(await exited).toBe(0);
      }
    });
    expect(Number((await admin.query(`SELECT count(*)::int AS n FROM "${schema}"."CopyTarget"`)).rows[0].n)).toBe(12);
  }, 120_000);

  it("runs the final writes on one registered session: a loss during finalization commits nothing", async () => {
    await resetRequesters([]);
    await admin.query(`CREATE TABLE IF NOT EXISTS "${schema}"."Final" (id text PRIMARY KEY)`);
    await admin.query(`DELETE FROM "${schema}"."Final"`);
    await admin.query(`INSERT INTO "${schema}"."Final" VALUES ('production-identity')`);
    const finalRows = async () => (await admin.query(`SELECT id FROM "${schema}"."Final" ORDER BY id`)).rows.map((r) => r.id);
    const sessionTransaction = (session: Client) => async (run: (tx: { $queryRawUnsafe(sql: string, ...v: unknown[]): Promise<unknown>; $executeRawUnsafe(sql: string, ...v: unknown[]): Promise<number> }) => Promise<void>) => {
      await session.query("BEGIN");
      try {
        await run({
          $queryRawUnsafe: async (sql, ...v) => (await session.query(sql, v)).rows,
          $executeRawUnsafe: async (sql, ...v) => (await session.query(sql, v)).rowCount ?? 0,
        });
        await session.query("COMMIT");
      } catch (error) {
        await session.query("ROLLBACK").catch(() => {});
        throw error;
      }
    };

    // Without a loss the final writes commit, on a session the fence registered first.
    const ok = await fenceOptions();
    const okSession = await connect(`${ok.tag}:final`);
    await withRequesterDestinationFence(ok, (fence) => runRegisteredFinalizers(fence, sessionTransaction(okSession), async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM "${schema}"."Final"`);
      await tx.$executeRawUnsafe(`INSERT INTO "${schema}"."Final" VALUES ('preview-admin')`);
    }));
    expect(await finalRows()).toEqual(["preview-admin"]);

    // A loss mid-finalization (for example while a password hashes) leaves the destination as it was.
    const lossy = await fenceOptions();
    const fencePid = await pidOf(lossy.fenceClient);
    const lossySession = await connect(`${lossy.tag}:final`);
    const lossyPid = await pidOf(lossySession);
    const error = await withRequesterDestinationFence(lossy, (fence) => runRegisteredFinalizers(fence, sessionTransaction(lossySession), async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM "${schema}"."Final"`);
      await admin.query("SELECT pg_terminate_backend($1)", [fencePid]);
      await tx.$executeRawUnsafe(`INSERT INTO "${schema}"."Final" VALUES ('after-loss')`).catch(() => 0);
    })).catch((e: unknown) => e);
    expect((error as CloneFenceError).code).toBe("fence_lost");
    expect(await finalRows()).toEqual(["preview-admin"]);
    expect(await alive(lossyPid)).toBe(false);
  }, 30_000);
});
