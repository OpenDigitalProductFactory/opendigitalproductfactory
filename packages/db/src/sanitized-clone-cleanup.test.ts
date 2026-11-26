/**
 * BI-9F7192F9 phase 2 (AC-E3): the S5 rehearsal requester destination fence
 * around the sanitized clone.
 *
 * Unit cases always run. Real-PostgreSQL cases run only when
 * DPF_S5_REQUESTER_TEST_DATABASE_URL names a DISPOSABLE database (a throwaway
 * container, never the live install); each builds its own schema with a
 * minimal "S5RehearsalRequesterEnrollment" table and drops it at the end.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CloneFenceError,
  REQUESTER_DESTINATION_FENCE_KEY,
  assertSourceHasNoRequester,
  preflightRequesterDestination,
  runWithDestinationCleanup,
  tryEnterRequesterFenceShared,
  withApplicationName,
  withRequesterDestinationFence,
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

  it("keeps the generic cleanup wrapper unchanged: a failed clone resets again", async () => {
    const reset = vi.fn(async () => {});
    await expect(runWithDestinationCleanup(reset, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(reset).toHaveBeenCalledTimes(2);
  });
});

describe.skipIf(!DATABASE_URL)("requester destination fence (real database)", () => {
  const schema = `s5_fence_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const opts = `-c search_path="${schema}"`;
  let admin: Client;
  const clients: Client[] = [];

  const connect = async (applicationName: string) => {
    const client = new Client({ connectionString: withApplicationName(DATABASE_URL, applicationName), options: opts });
    client.on("error", () => {}); // terminated sessions are expected in these tests
    await client.connect();
    clients.push(client);
    return client;
  };

  const resetRequesters = async (rows: Array<"active" | "retired">) => {
    await admin.query(`DELETE FROM "${schema}"."S5RehearsalRequesterEnrollment"`);
    for (const [i, lifecycle] of rows.entries()) {
      await admin.query(`INSERT INTO "${schema}"."S5RehearsalRequesterEnrollment" (id, lifecycle) VALUES ($1, $2)`, [`r${i}`, lifecycle]);
    }
  };
  const requesterCount = async () =>
    Number((await admin.query(`SELECT count(*)::int AS n FROM "${schema}"."S5RehearsalRequesterEnrollment"`)).rows[0].n);

  /** Opens the fence and supervisor connections the real clone opens, tagged with the run's writer name. */
  const fenceOptions = async (tag: string, discardRetiredEvidence = false) => ({
    fenceClient: await connect(`${tag}:fence`),
    supervisorClient: await connect(`${tag}:supervisor`),
    writerApplicationName: tag,
    discardRetiredEvidence,
    log: () => {},
  });

  beforeAll(async () => {
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`CREATE TABLE "${schema}"."S5RehearsalRequesterEnrollment" (id text PRIMARY KEY, lifecycle text NOT NULL)`);
    await admin.query(`CREATE TABLE "${schema}"."Destination" (id text PRIMARY KEY)`);
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
    const reset = vi.fn(async () => {});
    const error = await withRequesterDestinationFence(await fenceOptions(`dpf-test:${randomUUID()}`),
      () => runWithDestinationCleanup(reset, async () => "cloned")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloneFenceError);
    expect((error as CloneFenceError).code).toBe("requester_active");
    expect(reset).not.toHaveBeenCalled();
    expect(await requesterCount()).toBe(2);
  });

  it("refuses retired-only evidence without the explicit discard disposition, and proceeds with it", async () => {
    await resetRequesters(["retired"]);
    const refused = await withRequesterDestinationFence(await fenceOptions(`dpf-test:${randomUUID()}`),
      async () => "cloned").catch((e: unknown) => e);
    expect((refused as CloneFenceError).code).toBe("requester_retired_evidence");
    expect(await requesterCount()).toBe(1);
    await expect(withRequesterDestinationFence(await fenceOptions(`dpf-test:${randomUUID()}`, true),
      async () => "cloned")).resolves.toBe("cloned");
  });

  it("R-ONE-FENCE: while a clone holds the fence, the enrollment shared try-lock fails (clone_in_progress) with no write", async () => {
    await resetRequesters([]);
    const enrollment = await connect(`dpf-test:${randomUUID()}:enroll`);
    let insideClone: boolean | undefined;
    await withRequesterDestinationFence(await fenceOptions(`dpf-test:${randomUUID()}`), async () => {
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
    const clone = withRequesterDestinationFence(await fenceOptions(`dpf-test:${randomUUID()}`), async () => "cloned")
      .catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 300));
    await enrollment.query(`INSERT INTO "S5RehearsalRequesterEnrollment" VALUES ('enrolled', 'active')`);
    await enrollment.query("COMMIT");
    const result = await clone;
    expect((result as CloneFenceError).code).toBe("requester_active");
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
    // A separate source schema stands in for the separate source database.
    const sourceSchema = `${schema}_src`;
    await admin.query(`CREATE SCHEMA "${sourceSchema}"`);
    await admin.query(`CREATE TABLE "${sourceSchema}"."S5RehearsalRequesterEnrollment" (id text PRIMARY KEY, lifecycle text NOT NULL)`);
    await admin.query(`INSERT INTO "${sourceSchema}"."S5RehearsalRequesterEnrollment" VALUES ('source-requester', 'active')`);
    const source = new Client({ connectionString: DATABASE_URL, options: `-c search_path="${sourceSchema}"` });
    await source.connect();
    clients.push(source);
    try {
      await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const reset = vi.fn(async () => { await admin.query(`TRUNCATE "${schema}"."S5RehearsalRequesterEnrollment"`); });
      const error = await withRequesterDestinationFence(await fenceOptions(`dpf-test:${randomUUID()}`, true),
        () => runWithDestinationCleanup(reset, async () => {
          await assertSourceHasNoRequester(source);
          await admin.query(`INSERT INTO "${schema}"."S5RehearsalRequesterEnrollment" VALUES ('copied', 'active')`);
        })).catch((e: unknown) => e);
      await source.query("ROLLBACK");
      expect((error as CloneFenceError).code).toBe("source_has_requester");
      expect(reset).toHaveBeenCalledTimes(2);
      expect(await requesterCount()).toBe(0);
    } finally {
      await admin.query(`DROP SCHEMA "${sourceSchema}" CASCADE`);
    }
  });

  it("R-FENCE-LOSS: a lost fence during a real destination write terminates only this run's writers, runs no cleanup, fails, and a fresh run recovers", async () => {
    await resetRequesters([]);
    const tag = `dpf-test:${randomUUID()}`;
    const options = await fenceOptions(tag);
    const writerA = await connect(tag);
    const writerB = await connect(tag);
    const bystander = await connect(`dpf-test:${randomUUID()}:bystander`);
    const bystanderPid = (await bystander.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writerPids = [
      (await writerA.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      (await writerB.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    ];
    const fencePid = (await options.fenceClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const reset = vi.fn(async () => {});
    let writeError: unknown;
    const error = await withRequesterDestinationFence(options, (fence) =>
      runWithDestinationCleanup(async () => { fence.assertHeld(); await reset(); }, async () => {
        await writerA.query("BEGIN");
        await writerA.query(`INSERT INTO "Destination" VALUES ('in-flight')`);
        // A real write in progress: the second writer blocks on the first writer's row.
        const blocked = writerB.query(`INSERT INTO "Destination" VALUES ('in-flight')`).catch((e: unknown) => { writeError = e; });
        await admin.query("SELECT pg_terminate_backend($1)", [fencePid]);
        await blocked;
        await writerA.query("COMMIT");
      })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloneFenceError);
    expect((error as CloneFenceError).code).toBe("fence_lost");
    expect(writeError).toBeTruthy();
    expect(reset).toHaveBeenCalledTimes(1); // the initial reset only; no failure cleanup
    const alive = await admin.query("SELECT pid FROM pg_stat_activity WHERE pid = ANY($1::int[])", [writerPids]);
    expect(alive.rowCount).toBe(0);
    expect((await bystander.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    expect((await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1", [bystanderPid])).rowCount).toBe(1);
    expect((await admin.query(`SELECT count(*)::int AS n FROM "${schema}"."Destination"`)).rows[0].n).toBe(0);
    // Recovery is a fresh fenced run, which begins with the normal reset.
    const freshReset = vi.fn(async () => {});
    await expect(withRequesterDestinationFence(await fenceOptions(`dpf-test:${randomUUID()}`),
      () => runWithDestinationCleanup(freshReset, async () => "recovered"))).resolves.toBe("recovered");
    expect(freshReset).toHaveBeenCalledTimes(1);
  }, 30_000);
});
