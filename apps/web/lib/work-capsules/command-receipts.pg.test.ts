/**
 * BI-763D6E01: real Prisma/Postgres transport, transaction locks and replay.
 * Runs on an explicitly supplied disposable jobs DB or the canonical CI slot DB.
 * Every table lives in a uniquely named test schema; application tables are untouched.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { CommandIdConflictError, ReplayedCommandRejection, commandPayloadBinding, runReceiptedCommand, type ReceiptDb } from "./command-receipts";
import { createS5QuietProposalBroker, type S5ProposalCall } from "@/lib/workroom-runtime/s5-coordination-proposal.server";
import { createS5CredentialLifecycle } from "@/lib/workroom-runtime/s5-credential-lifecycle.server";
import { resolveS5ControlCredential } from "@/lib/auth/s5-room-credential.server";
import type { S5AdmissionCeiling } from "@/lib/workroom-runtime/s5-admission.server";

import { lockAllNonprodEnvironments, lockNonprodEnvironment } from "../nonprod/environment-lease-lock";

const slotUrl = process.env.DATABASE_URL?.trim() ?? "";
function canonicalSlotUrl() {
  try { return /^\/dpf_local_ci_[01]$/.test(new URL(slotUrl).pathname) ? slotUrl : ""; }
  catch { return ""; }
}
const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || canonicalSlotUrl();
const SCHEMA = `dpf_receipt_test_${randomUUID().replaceAll("-", "")}`;
const MIGRATION = join(__dirname, "../../../../packages/db/prisma/migrations/20261013090000_workroom_command_receipts/migration.sql");
const ROOM_MESSAGE_MIGRATION = join(__dirname, "../../../../packages/db/prisma/migrations/20261112000000_mcp_room_resource_subscriptions/migration.sql");
const S5_CREDENTIAL_MIGRATION = join(__dirname, "../../../../packages/db/prisma/migrations/20261125143000_s5_room_credential_scope/migration.sql");
type RawTx = Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "mcpApiToken">;
type TokenTx = Pick<RawTx, "mcpApiToken">;

/** Real Prisma raw methods; the fixture's small activity model uses the same transaction. */
function receiptDb(tx: RawTx): ReceiptDb & TokenTx {
  return {
    mcpApiToken: tx.mcpApiToken,
    $queryRaw: tx.$queryRaw.bind(tx),
    $executeRaw: tx.$executeRaw.bind(tx),
    workroomActivity: {
      async findFirst(args: unknown) {
        const { commandScopeKey, commandKey } = (args as { where: { commandScopeKey: string; commandKey: string } }).where;
        const rows = await tx.$queryRaw<Array<{ kind: string; payload: unknown }>>`
          SELECT kind, payload FROM "WorkCapsuleActivity" WHERE "commandScopeKey" = ${commandScopeKey} AND "commandKey" = ${commandKey}`;
        return rows[0] ?? null;
      },
      async create(args: unknown) {
        const d = (args as { data: Record<string, unknown> }).data;
        const id = randomUUID();
        await tx.$executeRaw`
          INSERT INTO "WorkCapsuleActivity" (id, "workCapsuleId", kind, summary, payload, "commandScopeKey", "commandKey")
          VALUES (${id}, ${d.workCapsuleId}, ${d.kind}, ${d.summary}, ${JSON.stringify(d.payload)}::jsonb, ${d.commandScopeKey ?? null}, ${d.commandKey ?? null})`;
        return { id };
      },
    },
  };
}

describe.skipIf(!DATABASE_URL)("command receipts (real Prisma database)", () => {
  let pool: Pool;
  let prisma: PrismaClient;

  function db(): ReceiptDb {
    return {
      ...receiptDb(prisma),
      $transaction: (fn, options) => prisma.$transaction((tx) => fn(receiptDb(tx)), options),
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 6, options: `-c search_path=${SCHEMA}` });
    // SCHEMA is generated locally from a UUID, never supplied by a caller.
    await pool.query(`CREATE SCHEMA "${SCHEMA}"`);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, options: `-c search_path=${SCHEMA}` }, { schema: SCHEMA }) });
    await pool.query(`CREATE TABLE "WorkCapsule" (id TEXT PRIMARY KEY, "capsuleId" TEXT UNIQUE NOT NULL, counter INT NOT NULL DEFAULT 0)`);
    await pool.query(`CREATE TABLE "WorkCapsuleActivity" (id TEXT PRIMARY KEY, "workCapsuleId" TEXT NOT NULL REFERENCES "WorkCapsule"(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, summary TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}', "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const sql = readFileSync(MIGRATION, "utf8");
    await pool.query(sql);
    await pool.query(sql);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (pool) {
      try { await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); }
      finally { await pool.end(); }
    }
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE "WorkCapsuleActivity"; DELETE FROM "WorkCapsule";
      INSERT INTO "WorkCapsule" (id, "capsuleId") VALUES ('row-1', 'WC-1'), ('row-2', 'WC-2')`);
  });

  /** Deliberately racy read/write: without the room lock concurrent increments are lost. */
  function bump(commandId: string, room = "WC-1", scope = "user:u|agent:a") {
    return runReceiptedCommand({
      db: db(), authorityScopeKey: scope, commandId, commandType: "bump", target: { kind: "workroom", id: room },
      run: async (tx) => {
        const [row] = (await tx.$queryRaw!`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = ${room}`) as Array<{ counter: number }>;
        await new Promise((r) => setTimeout(r, 40));
        await tx.$executeRaw!`UPDATE "WorkCapsule" SET counter = ${row!.counter + 1} WHERE "capsuleId" = ${room}`;
        return row!.counter + 1;
      },
    });
  }

  it("reproduces Prisma's void query rejection while execution acquires the lock", async () => {
    await expect(prisma.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"transport-probe"}, 0))`).rejects.toThrow(/void/i);
    await prisma.$transaction(async (tx) => {
      await expect(tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"transport-probe"}, 0))`).resolves.toBeTypeOf("number");
    });
  });

  it("serialises concurrent commands on one room (AC-DDL-LEASE-SERIAL)", async () => {
    const results = await Promise.all([bump("a"), bump("b"), bump("c"), bump("d")]);
    expect(results.sort()).toEqual([1, 2, 3, 4]);
    expect((await pool.query(`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = 'WC-1'`)).rows[0].counter).toBe(4);
  });

  it("runs one effect for concurrent retries (AC-DDL-RECEIPT-ONCE)", async () => {
    const results = await Promise.all([bump("same"), bump("same"), bump("same")]);
    expect(results).toEqual([1, 1, 1]);
    expect((await pool.query(`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = 'WC-1'`)).rows[0].counter).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind = 'command-accepted'`)).rows[0].n).toBe(1);
  });

  it("records an S5 pilot proposal without client hooks, message inserts or PostgreSQL room notifications", async () => {
    const itemId = `synthetic-item-${randomUUID()}`;
    const sentinelId = `sentinel-message-${randomUUID()}`;
    await pool.query(`CREATE TABLE "WorkItem" (id TEXT PRIMARY KEY);
      CREATE TABLE "WorkItemMessage" ("messageId" TEXT PRIMARY KEY, "workItemId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(readFileSync(ROOM_MESSAGE_MIGRATION, "utf8"));
    await pool.query(`INSERT INTO "WorkItem" (id) VALUES ($1)`, [itemId]);

    const listener = await pool.connect();
    const observed: string[] = [];
    const { promise: sentinelSeen, resolve: signalSentinel } = signal();
    listener.on("notification", (event) => {
      if (event.channel !== "dpf_room_message" || !event.payload) return;
      try {
        const message = JSON.parse(event.payload) as { workItemId: string; messageId: string };
        if (message?.workItemId !== itemId) return;
        observed.push(message.messageId);
        if (message.messageId === sentinelId) signalSentinel();
      } catch { /* A different test schema can share the database channel. */ }
    });
    try {
      await listener.query("LISTEN dpf_room_message");
      const receiver = { issuer: "fixture-install", audience: "fixture-control", hostRef: "fixture-host" };
      const actor = { receiver, roomRowId: "row-1", userId: "fixture-user", agentId: "AGT-FIXTURE" };
      const call: S5ProposalCall = { ...receiver, workroomId: "WC-1", sessionRef: "session-a", stageKey: "coordinate", stageAttemptRef: "attempt-1",
        caseKey: "synthetic:BI-FIXTURE", operationId: `room-operation:${randomUUID()}`, body: "A synthetic route proposal.",
        recipient: { authorityRef: "authority:fixture", destinationRef: "destination:fixture", reservationRef: "reservation:fixture" } };
      const broker = createS5QuietProposalBroker({ db: db(), operationBindingKey: new Uint8Array(32).fill(1),
        checkResultAccess: async () => true,
        readCurrentProposalAuthority: async () => ({ ...call, agentId: actor.agentId, mode: "read-only-coordination", operationKeys: ["post_room_message"] }),
      });
      const result = await broker.submit(actor, call);
      expect(result.kind).toBe("proposal-recorded");
      expect(await broker.readback(actor, call)).toEqual(result);
      expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkItemMessage"`)).rows[0].n).toBe(0);
      expect((await pool.query(`SELECT kind FROM "WorkCapsuleActivity" ORDER BY kind`)).rows.map((row) => row.kind))
        .toEqual(["command-accepted", "s5-route-proposal"]);

      // Positive barrier on the real channel: the actual trigger still emits
      // after an ordinary insert, and any earlier notice would precede this.
      await pool.query(`INSERT INTO "WorkItemMessage" ("messageId", "workItemId") VALUES ($1, $2)`, [sentinelId, itemId]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([sentinelSeen, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Ordinary insert did not notify the fixture listener.")), 3_000);
        })]);
      } finally { clearTimeout(timer); }
      expect(observed).toEqual([sentinelId]);
    } finally {
      await listener.query("UNLISTEN dpf_room_message");
      listener.removeAllListeners("notification");
      listener.release();
    }
  });

  it("atomically pins or fences the scoped credential, keeps siblings and rejects closure-before-mint", async () => {
    await pool.query(`CREATE TABLE "McpApiToken" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "agentId" TEXT,
      kind TEXT NOT NULL, "workroomRef" TEXT, "runRef" TEXT, name TEXT NOT NULL, "tokenHash" TEXT UNIQUE NOT NULL, prefix TEXT NOT NULL,
      "tokenSuffix" TEXT, "secretEnc" TEXT, scopes TEXT[] NOT NULL DEFAULT '{}', "publicScopes" TEXT[] NOT NULL DEFAULT '{}',
      capability TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT, "authorityBindingId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "revokedReason" TEXT);
      CREATE TABLE "FixtureAttempt" ("stageAttemptRef" TEXT PRIMARY KEY, "tokenId" TEXT, status TEXT NOT NULL DEFAULT 'active');
      INSERT INTO "FixtureAttempt" ("stageAttemptRef") VALUES ('first'), ('sibling'), ('released-before-mint');
      INSERT INTO "McpApiToken" (id,"userId",kind,name,"tokenHash",prefix,capability,scope,"createdAt")
        VALUES ('legacy','fixture-user','workroom_session','legacy','fixture-legacy-hash','fixture','write','write',now());`);
    const migration = readFileSync(S5_CREDENTIAL_MIGRATION, "utf8");
    await pool.query(migration);
    await pool.query(migration);
    expect((await pool.query(`SELECT "workroomAuthorization" FROM "McpApiToken" WHERE id = 'legacy'`)).rows[0]).toEqual({ workroomAuthorization: null });

    const now = new Date();
    const receiver = { issuer: "fixture-install", audience: "fixture-control", hostRef: "fixture-host", resource: "https://fixture.invalid/s5" };
    const first = { workroomId: "WC-1", sessionRef: "session-a", stageAttemptRef: "first", roomRowId: "row-1" };
    const sibling = { ...first, sessionRef: "session-b", stageAttemptRef: "sibling" };
    const early = { ...first, sessionRef: "session-c", stageAttemptRef: "released-before-mint" };
    const mintLocked = signal<number>();
    const finishMint = signal();
    const releaseWaiting = signal<number>();
    const lifecycle = createS5CredentialLifecycle({
      db: db(), getTokenStore: (tx) => (tx as ReceiptDb & TokenTx).mcpApiToken,
      now: () => now,
      lockOwners: async (tx, command) => {
        if (command.kind === "release" && command.input.stageAttemptRef === first.stageAttemptRef) {
          const [row] = await tx.$queryRaw!`SELECT pg_backend_pid() AS pid` as Array<{ pid: number }>;
          releaseWaiting.resolve(row!.pid);
        }
        return true;
      },
      checkAccess: async () => true,
      readAttempt: async (tx, locator) => {
        const rows = await tx.$queryRaw!`SELECT status, "tokenId" FROM "FixtureAttempt" WHERE "stageAttemptRef" = ${locator.stageAttemptRef}`;
        const [state] = rows as Array<{ status: "active" | "released"; tokenId: string | null }>;
        return state ? { ...locator, ...state, roomRowId: first.roomRowId, userId: "fixture-user", permitExpiresAt: new Date(now.getTime() + 60_000) } : null;
      },
      composeAdmission: async (tx, locator): Promise<S5AdmissionCeiling> => {
        if (locator.stageAttemptRef === first.stageAttemptRef) {
          const [row] = await tx.$queryRaw!`SELECT pg_backend_pid() AS pid` as Array<{ pid: number }>;
          mintLocked.resolve(row!.pid);
          await finishMint.promise;
        }
        return { kind: "composed", locator, issuer: receiver.issuer, agentId: "fixture-agent", stageKey: "working", caseKey: "fixture-case", activityKey: "coding",
          job: { id: "fixture-job", version: "1" }, subject: { principalId: "PRN-FIXTURE", gaid: "gaid:priv:fixture:agent" },
          authorityBindingId: "fixture-binding-row", bindingRef: "binding-ref", permitRef: "permit-ref", grantKeys: ["file_read"],
          host: { receiverRef: receiver.audience, hostRef: receiver.hostRef, worktreeRef: "fixture-tree", mode: "bounded-coding" },
          jsi: { kind: "not-applicable" }, operationKeys: ["read_project_file"] };
      },
      pinToken: async (tx, selected, tokenId) => await tx.$executeRaw!`UPDATE "FixtureAttempt" SET "tokenId" = ${tokenId}
        WHERE "stageAttemptRef" = ${selected.stageAttemptRef} AND status = 'active' AND "tokenId" IS NULL` === 1,
      closeAttempt: async (tx, selected) => await tx.$executeRaw!`UPDATE "FixtureAttempt" SET status = 'released'
        WHERE "stageAttemptRef" = ${selected.stageAttemptRef} AND status = 'active'` === 1,
    });
    const mint = (id: string, target: typeof first) => lifecycle.issue({ ...target, commandId: id, receiver });
    const release = (id: string, target: typeof first) => lifecycle.release({ ...target, commandId: id, reason: "attempt-released" });

    const other = await mint("mint-sibling", sibling);
    expect(other.kind).toBe("issued");
    const issued = mint("mint-first", first);
    const holder = await Promise.race([mintLocked.promise, issued.then(() => { throw new Error("Mint did not reach the room fence."); })]);
    const closing = release("release-first", first);
    try {
      const waiter = await Promise.race([releaseWaiting.promise, closing.then(() => { throw new Error("Release did not reach the room fence."); })]);
      await waitForBlockedBy(waiter, holder);
    }
    finally { finishMint.resolve(); }
    const [credential, closed] = await Promise.all([issued, closing]);
    expect(closed).toEqual({ kind: "released" });
    if (credential.kind !== "issued" || other.kind !== "issued") throw new Error("Synthetic issuance failed.");
    expect(await resolveS5ControlCredential(prisma, credential.plaintext, receiver, now)).toBeNull();
    expect(await resolveS5ControlCredential(prisma, other.plaintext, receiver, now)).toMatchObject({ tokenId: other.tokenId });
    expect(await mint("mint-first", first)).toEqual({ kind: "held" });
    expect(await release("release-without-token", early)).toEqual({ kind: "released" });
    expect(await mint("mint-too-late", early)).toEqual({ kind: "held" });
    const records = (await pool.query(`SELECT "tokenHash", "secretEnc", "revokedAt" FROM "McpApiToken" WHERE "workroomRef" = 'WC-1'`)).rows;
    expect(records).toHaveLength(2);
    expect(records.filter(row => row.revokedAt !== null)).toHaveLength(1);
    expect(records.every(row => row.secretEnc === null)).toBe(true);
    expect(JSON.stringify(records)).not.toContain(credential.plaintext);
    expect(JSON.stringify((await pool.query(`SELECT payload FROM "WorkCapsuleActivity"`)).rows)).not.toContain(credential.plaintext);
  });

  it("serialises a shared command id across different rooms and refuses the losing target", async () => {
    const results = await Promise.allSettled([bump("same", "WC-1"), bump("same", "WC-2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refusal = results.find((r) => r.status === "rejected");
    expect(refusal?.status === "rejected" && refusal.reason).toBeInstanceOf(CommandIdConflictError);
    expect((await pool.query(`SELECT sum(counter)::int AS n FROM "WorkCapsule"`)).rows[0].n).toBe(1);
  });

  it("keeps different principals' same command ids independent", async () => {
    expect((await Promise.all([bump("same", "WC-1", "user:u|agent:a"), bump("same", "WC-1", "user:v|agent:a")])).sort()).toEqual([1, 2]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity"`)).rows[0].n).toBe(2);
  });

  it("rolls back the refused effect and replays its stored refusal (AC-DDL-RECEIPT-REJECT)", async () => {
    let calls = 0;
    const refusal = new Error("lease_held_by_other");
    const call = () => runReceiptedCommand({
      db: db(), authorityScopeKey: "user:u|agent:a", commandId: "refused", commandType: "bump", target: { kind: "workroom", id: "WC-1" },
      run: async (tx) => {
        calls += 1;
        await tx.$executeRaw!`UPDATE "WorkCapsule" SET counter = 99 WHERE "capsuleId" = ${"WC-1"}`;
        throw refusal;
      },
      rejectionOf: (error) => error === refusal ? { code: "lease_held_by_other", message: refusal.message } : null,
    });
    await expect(call()).rejects.toBe(refusal);
    await expect(call()).rejects.toBeInstanceOf(ReplayedCommandRejection);
    expect(calls).toBe(1);
    expect((await pool.query(`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = 'WC-1'`)).rows[0].counter).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind = 'command-rejected'`)).rows[0].n).toBe(1);
  });

  function signal<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }
  async function waitForBlockedBy(waiter: number, holder: number) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const observed = await pool.query<{ blocking: number[] }>("SELECT pg_blocking_pids($1) AS blocking", [waiter]);
      if (observed.rows[0]?.blocking.includes(holder)) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error(`PostgreSQL did not observe process ${waiter} waiting for ${holder}`);
  }
  const boundTarget = { kind: "workroom", id: "WC-1" };
  const boundScope = "user:bound|agent:handoff";
  const payloadBinding = commandPayloadBinding({ phase: "request", capsuleId: "WC-1", receiver: "receiver-a" });
  async function transferOnce(tx: ReceiptDb) {
    await tx.$executeRaw!`UPDATE "WorkCapsule" SET counter = counter + 1 WHERE "capsuleId" = ${"WC-1"}`;
    return { accepted: true };
  }
  const boundInput = () => ({ db: db(), authorityScopeKey: boundScope, commandId: "handoff", commandType: "reassign",
    target: boundTarget, payloadBinding, beforeRoomLock: lockAllNonprodEnvironments });

  it.each(["equal", "different"])("returns the %s-payload winner committed between rollback and rejection publication", async (payload) => {
    const rolledBack = signal();
    const publish = signal();
    const original = new Error("original refusal");
    let attempt = 0;
    const firstDb: ReceiptDb = { ...db(), $transaction: async (body, options) => {
      const current = ++attempt;
      try { return await prisma.$transaction((tx) => body(receiptDb(tx)), options); }
      catch (error) {
        if (current === 1 && error === original) { rolledBack.resolve(); await publish.promise; }
        throw error;
      }
    } };
    const first = runReceiptedCommand({ ...boundInput(), db: firstDb,
      run: async (tx) => { await transferOnce(tx); throw original; },
      rejectionOf: (error) => error === original ? { code: "held", message: original.message } : null });
    // Attach a rejection observer immediately; the assertion below still examines the original promise.
    void first.catch(() => undefined);
    await rolledBack.promise;
    let winner: unknown;
    try {
      winner = await runReceiptedCommand({ ...boundInput(),
        payloadBinding: payload === "equal" ? payloadBinding : commandPayloadBinding({ receiver: "receiver-b" }),
        run: transferOnce });
    } finally { publish.resolve(); }
    if (payload === "equal") await expect(first).resolves.toEqual(winner);
    else await expect(first).rejects.toBeInstanceOf(CommandIdConflictError);
    const rows = await pool.query(`SELECT kind, payload FROM "WorkCapsuleActivity"`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].kind).toBe("command-accepted");
    expect((await pool.query(`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = 'WC-1'`)).rows[0].counter).toBe(1);
  });

  it("serializes rejection publication against a different payload and preserves one refusal", async () => {
    const publicationLocked = signal<number>();
    const releasePublication = signal();
    const secondStarted = signal<number>();
    const original = new Error("held by source");
    let callbacks = 0;
    const first = runReceiptedCommand({ ...boundInput(), beforeRoomLock: async (tx) => {
      await lockAllNonprodEnvironments(tx);
      if (++callbacks === 2) {
        const [row] = await tx.$queryRaw!`SELECT pg_backend_pid() AS pid` as Array<{ pid: number }>;
        publicationLocked.resolve(row!.pid);
        await releasePublication.promise;
      }
    }, run: async () => { throw original; }, rejectionOf: (error) => error === original ? { code: "held", message: original.message } : null });
    void first.catch(() => undefined);
    const publisherPid = await publicationLocked.promise;
    const secondDb: ReceiptDb = { ...db(), $transaction: (body, options) => prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      secondStarted.resolve(row!.pid);
      return body(receiptDb(tx));
    }, options) };
    const second = runReceiptedCommand({ ...boundInput(), db: secondDb,
      payloadBinding: commandPayloadBinding({ receiver: "different" }), run: transferOnce });
    void second.catch(() => undefined);
    try { await waitForBlockedBy(await secondStarted.promise, publisherPid); }
    finally { releasePublication.resolve(); }
    await expect(first).rejects.toBe(original);
    await expect(second).rejects.toBeInstanceOf(CommandIdConflictError);
    const rows = await pool.query(`SELECT kind, payload FROM "WorkCapsuleActivity"`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ kind: "command-rejected", payload: { payloadBinding, rejection: { code: "held" } } });
    expect((await pool.query(`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = 'WC-1'`)).rows[0].counter).toBe(0);
  });

  it("uses the same advisory fence as ordinary lease allocation", async () => {
    const handoffLocked = signal<number>();
    const releaseHandoff = signal();
    const leaseStarted = signal<number>();
    const handoff = runReceiptedCommand({ ...boundInput(), beforeRoomLock: async (tx) => {
      await lockAllNonprodEnvironments(tx);
      const [row] = await tx.$queryRaw!`SELECT pg_backend_pid() AS pid` as Array<{ pid: number }>;
      handoffLocked.resolve(row!.pid);
      await releaseHandoff.promise;
    }, run: transferOnce });
    const holder = await handoffLocked.promise;
    const leaseWriter = prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      leaseStarted.resolve(row!.pid);
      await lockNonprodEnvironment(receiptDb(tx), "local-integration-ci");
      const [committed] = await tx.$queryRaw<Array<{ counter: number }>>`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = ${"WC-1"}`;
      return committed!.counter;
    }, { isolationLevel: "ReadCommitted" });
    try { await waitForBlockedBy(await leaseStarted.promise, holder); }
    finally { releaseHandoff.resolve(); }
    await expect(handoff).resolves.toEqual({ accepted: true });
    await expect(leaseWriter).resolves.toBe(1);
  });

});
