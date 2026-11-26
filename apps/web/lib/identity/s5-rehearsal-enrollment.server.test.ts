import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  GovernedRequesterReadError,
  isGovernedRequester,
  type GovernedRequesterReader,
} from "./s5-rehearsal-enrollment.server";

function reader(findUnique: (args: unknown) => Promise<unknown>): GovernedRequesterReader {
  return { s5RehearsalRequesterEnrollment: { findUnique } } as unknown as GovernedRequesterReader;
}

describe("isGovernedRequester (BI-9F7192F9 phase 1, single durable marker)", () => {
  it("is one unique-index read keyed by userId, selecting only the id", async () => {
    const findUnique = vi.fn(async () => ({ id: "enr-1" }));
    await expect(isGovernedRequester("user-1", reader(findUnique))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" }, select: { id: true } });
  });

  it("is true for a retired requester too: the marker outlives retirement", async () => {
    const findUnique = vi.fn(async () => ({ id: "enr-retired" }));
    await expect(isGovernedRequester("user-retired", reader(findUnique))).resolves.toBe(true);
  });

  it("is false only when the read succeeds and finds no row", async () => {
    await expect(isGovernedRequester("user-2", reader(async () => null))).resolves.toBe(false);
  });

  it("reports a read error as an error, never as 'not governed' (fails closed)", async () => {
    const cause = new Error("connection reset");
    const failing = reader(async () => {
      throw cause;
    });
    const error = await isGovernedRequester("user-3", failing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GovernedRequesterReadError);
    expect((error as GovernedRequesterReadError).cause).toBe(cause);
  });

  it("refuses an empty or non-string userId without reading", async () => {
    const findUnique = vi.fn(async () => null);
    for (const bad of ["", "   ", undefined as unknown as string]) {
      await expect(isGovernedRequester(bad, reader(findUnique))).rejects.toBeInstanceOf(GovernedRequesterReadError);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("requester audit rows (BI-9F7192F9 phase 3, AC-E8)", async () => {
  const { buildRequesterAuditRow, writeRequesterAudit, S5_REQUESTER_AUDIT_ACTION_KEYS } = await import("./s5-rehearsal-enrollment.server");
  const { readS5RehearsalDecision } = await import("@/lib/workroom-runtime/s5-rehearsal-approver.server");
  const { S5_REHEARSAL_APPROVAL_ACTION } = await import("@/lib/workroom-runtime/s5-rehearsal-approval-action");
  const digest = "a".repeat(64);
  const refs = {
    rulingRef: "ruling:1", reservationRef: "reservation:1", attemptRef: "attempt:1", fixtureRef: "fixture:1",
    installationRef: "installation:1", leaseRef: "lease:1", dbIdentityRef: "db:1",
  };
  const enroll = {
    command: "enroll" as const, setupDigest: digest, ownerUserId: "owner-user", ownerPrincipalId: "owner-principal",
    requesterUserId: "requester-user", refs,
  };

  it("builds one typed row per command with the fixed keys from the design", () => {
    expect(S5_REQUESTER_AUDIT_ACTION_KEYS).toEqual({ enroll: "s5.rehearsal-requester.enroll", retire: "s5.rehearsal-requester.retire" });
    const row = buildRequesterAuditRow(enroll);
    expect(row).toMatchObject({
      decisionId: `s5rr:enroll:${digest}`, actionKey: "s5.rehearsal-requester.enroll", decision: "allow",
      actorType: "human", actorRef: "owner-user", objectRef: "requester-user",
    });
    const retire = buildRequesterAuditRow({ ...enroll, command: "retire", retirementReason: "rehearsal_complete" });
    expect(retire).toMatchObject({ decisionId: `s5rr:retire:${digest}`, actionKey: "s5.rehearsal-requester.retire" });
    expect((retire.rationale as Record<string, unknown>).retirementReason).toBe("rehearsal_complete");
  });

  it("carries references only: no password, hash, token or session material", () => {
    const serialized = JSON.stringify(buildRequesterAuditRow(enroll)).toLowerCase();
    for (const secret of ["password", "hash", "token", "session", "secret"]) expect(serialized).not.toContain(secret);
  });

  it("refuses a malformed digest, a missing ref, an unknown command or a retire without its reason", () => {
    expect(() => buildRequesterAuditRow({ ...enroll, setupDigest: "abc" })).toThrow();
    expect(() => buildRequesterAuditRow({ ...enroll, refs: { ...refs, leaseRef: "" } })).toThrow();
    expect(() => buildRequesterAuditRow({ ...enroll, command: "activate" as never })).toThrow();
    expect(() => buildRequesterAuditRow({ ...enroll, command: "retire" })).toThrow();
  });

  it("writes exactly one row through the caller's transaction", async () => {
    const create = vi.fn(async () => ({}));
    await writeRequesterAudit({ authorizationDecisionLog: { create } }, enroll);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: buildRequesterAuditRow(enroll) });
  });

  it("is rejected by the S5 approval reader, so an audit row can never stand in for an approval", async () => {
    const row = buildRequesterAuditRow(enroll);
    const findUnique = vi.fn(async () => ({ ...row, agentContextRef: "AGT-1", authorityBindingId: "binding-1" }));
    const decision = await readS5RehearsalDecision({ authorizationDecisionLog: { findUnique } } as never, {
      id: "env-1", manifestActionId: S5_REHEARSAL_APPROVAL_ACTION, argsJson: {}, authorityDecisionId: row.decisionId,
      inputFingerprint: "f", approvalBindingFingerprint: "b", delegatingUserId: "owner-user", coworkerAgentId: "AGT-1",
    }, "owner-user");
    expect(decision).toBeNull();
  });
});

describe("owner binding (BI-9F7192F9 phase 5, AC-E2)", async () => {
  const { evaluateOwnerSnapshot, decideOwnerBinding, OWNER_SNAPSHOT_SQL } = await import("./s5-rehearsal-enrollment.server");
  type Snapshot = Parameters<typeof evaluateOwnerSnapshot>[0];
  const owner = "PRN-owner";
  const snapshot = (overrides: Partial<Snapshot> = {}, actor: Partial<Snapshot["actor"]> = {}): Snapshot => ({
    orgCount: 1, topPrincipalId: owner,
    top: { kind: "human", status: "active", userAliasCount: 1, localUserActive: true },
    fallback: [],
    ...overrides,
    actor: {
      userExists: true, isActive: true, isSuperuser: false, automation: false, handedOver: false,
      roleKeys: ["HR-000"], principalId: owner, governedRequester: false, ...actor,
    },
  });

  it("accepts the mapped owner acting through its exact alias with live manage_users and manage_platform", () => {
    expect(evaluateOwnerSnapshot(snapshot())).toEqual({ ok: true, ownerPrincipalId: owner });
  });

  it.each([
    ["no organization", snapshot({ orgCount: 0 }), "org_missing"],
    ["an ambiguous organization", snapshot({ orgCount: 2 }), "org_ambiguous"],
    ["a mapping to an inactive Principal", snapshot({ top: { kind: "human", status: "inactive", userAliasCount: 1, localUserActive: true } }), "owner_mapping_invalid"],
    ["a mapping to a non-human Principal", snapshot({ top: { kind: "agent", status: "active", userAliasCount: 1, localUserActive: true } }), "owner_mapping_invalid"],
    ["a mapping with no local user", snapshot({ top: { kind: "human", status: "active", userAliasCount: 0, localUserActive: null } }), "owner_mapping_invalid"],
    ["a mapping to a missing Principal", snapshot({ top: null }), "owner_mapping_invalid"],
  ])("holds on %s", (_label, input, code) => {
    expect(evaluateOwnerSnapshot(input)).toEqual({ ok: false, code });
  });

  it("R-OWNER-COHERENT: the unset-owner fallback decides 0, 1 and 2 candidates from the one row set", () => {
    const unset = { topPrincipalId: null, top: null };
    expect(evaluateOwnerSnapshot(snapshot({ ...unset, fallback: [] }))).toEqual({ ok: false, code: "owner_candidate_ambiguous" });
    expect(evaluateOwnerSnapshot(snapshot({ ...unset, fallback: [owner] }))).toEqual({ ok: true, ownerPrincipalId: owner });
    expect(evaluateOwnerSnapshot(snapshot({ ...unset, fallback: [owner, "PRN-other"] }))).toEqual({ ok: false, code: "owner_candidate_ambiguous" });
  });

  it.each([
    ["a non-owner administrator", { principalId: "PRN-admin" }, "not_owner"],
    ["an automation actor", { automation: true }, "automation_actor"],
    ["a handed-over actor", { handedOver: true }, "handed_over_actor"],
    ["the governed requester itself", { governedRequester: true }, "requester_actor"],
    ["a superuser holding no qualifying role", { isSuperuser: true, roleKeys: [] }, "owner_capability_missing"],
    ["an owner lacking manage_platform", { roleKeys: ["HR-500"] }, "owner_capability_missing"],
    ["an inactive actor", { isActive: false }, "actor_inactive"],
  ])("refuses %s", (_label, actor, code) => {
    expect(evaluateOwnerSnapshot(snapshot({}, actor))).toEqual({ ok: false, code });
  });

  it("reads every fact in exactly one SQL statement, then binds the owner-confirmed receipt", async () => {
    const queryRawUnsafe = vi.fn(async (_sql: string, ..._values: unknown[]) => [{ snapshot: snapshot() }]);
    const receipt = vi.fn(async () => ({ ownerPrincipalId: owner, installationRef: "install-1" }));
    await expect(decideOwnerBinding({ $queryRawUnsafe: queryRawUnsafe }, "owner-user", { readOwnerReceipt: receipt, installationRef: "install-1" }))
      .resolves.toEqual({ ok: true, ownerPrincipalId: owner });
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(queryRawUnsafe.mock.calls[0]?.[0]).toBe(OWNER_SNAPSHOT_SQL);
  });

  it.each([
    ["missing", null, "owner_receipt_missing"],
    ["naming the wrong Principal", { ownerPrincipalId: "PRN-other", installationRef: "install-1" }, "owner_receipt_mismatch"],
    ["for the wrong install", { ownerPrincipalId: owner, installationRef: "install-2" }, "owner_receipt_mismatch"],
  ])("holds on an owner receipt %s", async (_label, receiptValue, code) => {
    const result = await decideOwnerBinding({ $queryRawUnsafe: vi.fn(async () => [{ snapshot: snapshot() }]) }, "owner-user",
      { readOwnerReceipt: vi.fn(async () => receiptValue), installationRef: "install-1" });
    expect(result).toEqual({ ok: false, code });
  });
});

describe.skipIf(!process.env.DPF_S5_REQUESTER_TEST_DATABASE_URL)("owner snapshot SQL against PostgreSQL (phase 5)", async () => {
  const { Client } = await import("pg");
  const { OWNER_SNAPSHOT_SQL, MANAGE_PLATFORM_ROLE_KEYS, evaluateOwnerSnapshot } = await import("./s5-rehearsal-enrollment.server");
  const schema = `s5_owner_${Math.random().toString(16).slice(2, 10)}`;
  const db = new Client({ connectionString: process.env.DPF_S5_REQUESTER_TEST_DATABASE_URL, options: `-c search_path="${schema}"` });
  const run = async (userId: string) =>
    ((await db.query(OWNER_SNAPSHOT_SQL, [userId, MANAGE_PLATFORM_ROLE_KEYS])).rows[0] as { snapshot: Parameters<typeof evaluateOwnerSnapshot>[0] }).snapshot;
  const human = async (n: string, roleId: string | null, superuser = false) => {
    await db.query(`INSERT INTO "User"(id,"isActive","isSuperuser") VALUES ($1,true,$2)`, [`u-${n}`, superuser]);
    await db.query(`INSERT INTO "Principal"(id,kind,status) VALUES ($1,'human','active')`, [`p-${n}`]);
    await db.query(`INSERT INTO "PrincipalAlias"("principalId","aliasType","aliasValue",issuer) VALUES ($1,'user',$2,'')`, [`p-${n}`, `u-${n}`]);
    if (roleId) await db.query(`INSERT INTO "UserGroup"("userId","platformRoleId") VALUES ($1,$2)`, [`u-${n}`, roleId]);
  };

  beforeAll(async () => {
    await db.connect();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`CREATE TABLE "User"(id text PRIMARY KEY, "isActive" boolean NOT NULL, "isSuperuser" boolean NOT NULL DEFAULT false,
      "automationVerificationId" text, "automationProfile" text, "automationSlot" int, "automationExpiresAt" timestamptz, "workHandedOverAt" timestamptz)`);
    await db.query(`CREATE TABLE "Principal"(id text PRIMARY KEY, kind text NOT NULL, status text NOT NULL)`);
    await db.query(`CREATE TABLE "PrincipalAlias"("principalId" text NOT NULL, "aliasType" text NOT NULL, "aliasValue" text NOT NULL, issuer text NOT NULL DEFAULT '', UNIQUE ("aliasType","aliasValue",issuer))`);
    await db.query(`CREATE TABLE "PlatformRole"(id text PRIMARY KEY, "roleId" text UNIQUE NOT NULL)`);
    await db.query(`CREATE TABLE "UserGroup"("userId" text NOT NULL, "platformRoleId" text NOT NULL)`);
    await db.query(`CREATE TABLE "Organization"(id text PRIMARY KEY, "topAccountablePrincipalId" text, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await db.query(`CREATE TABLE "S5RehearsalRequesterEnrollment"("userId" text UNIQUE NOT NULL)`);
    await db.query(`INSERT INTO "PlatformRole" VALUES ('role-admin','HR-000'), ('role-staff','HR-600')`);
    await db.query(`INSERT INTO "Organization"(id) VALUES ('org-1')`);
    await human("a", "role-admin");
    await human("b", "role-staff");
    await human("root", null, true);
  }, 30_000);

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.end();
  });

  it("decides the unset-owner fallback with one, then two candidates, and ignores a role-less superuser", async () => {
    expect(evaluateOwnerSnapshot(await run("u-a"))).toEqual({ ok: true, ownerPrincipalId: "p-a" });
    expect(evaluateOwnerSnapshot(await run("u-root"))).toEqual({ ok: false, code: "not_owner" });
    await human("c", "role-admin");
    expect(evaluateOwnerSnapshot(await run("u-a"))).toEqual({ ok: false, code: "owner_candidate_ambiguous" });
  });

  it("uses the mapping when set, refuses a non-owner administrator, and holds a mapping to an inactive Principal", async () => {
    await db.query(`UPDATE "Organization" SET "topAccountablePrincipalId" = 'p-a'`);
    expect(evaluateOwnerSnapshot(await run("u-a"))).toEqual({ ok: true, ownerPrincipalId: "p-a" });
    expect(evaluateOwnerSnapshot(await run("u-c"))).toEqual({ ok: false, code: "not_owner" });
    await db.query(`UPDATE "Principal" SET status = 'inactive' WHERE id = 'p-a'`);
    expect(evaluateOwnerSnapshot(await run("u-a"))).toEqual({ ok: false, code: "owner_mapping_invalid" });
  });

  it("refuses the governed requester and an ambiguous organization", async () => {
    await db.query(`UPDATE "Principal" SET status = 'active' WHERE id = 'p-a'`);
    await db.query(`INSERT INTO "S5RehearsalRequesterEnrollment" VALUES ('u-a')`);
    expect(evaluateOwnerSnapshot(await run("u-a"))).toEqual({ ok: false, code: "requester_actor" });
    await db.query(`INSERT INTO "Organization"(id) VALUES ('org-2')`);
    expect(evaluateOwnerSnapshot(await run("u-a"))).toEqual({ ok: false, code: "org_ambiguous" });
  });
});

describe("fenced request transaction (BI-9F7192F9 phase 6, AC-E4)", async () => {
  const { runFencedRequest, REQUESTER_FENCE_KEY } = await import("./s5-rehearsal-enrollment.server");
  const runner = (entered: boolean, afterCommit?: () => void) => async <T,>(run: (tx: { sql: { query: (q: string, v?: unknown[]) => Promise<Array<Record<string, unknown>>> }; client: unknown }) => Promise<T>) => {
    const out = await run({ sql: { query: async () => [{ entered }] }, client: null });
    afterCommit?.();
    return out;
  };
  const created = { status: 201, body: { outcome: "created" }, commit: { ifCommitLost: { status: 202, body: { outcome: "create_unverified" } } } };

  it("pins the fence key to the clone fence's key", async () => {
    const { REQUESTER_DESTINATION_FENCE_KEY } = await import("../../../../packages/db/src/sanitized-clone-cleanup");
    expect(REQUESTER_FENCE_KEY).toBe(REQUESTER_DESTINATION_FENCE_KEY);
  });

  it("returns clone_in_progress and runs nothing when a clone holds the fence", async () => {
    const run = vi.fn(async () => created);
    await expect(runFencedRequest(runner(false), run, vi.fn())).resolves.toEqual({ status: 409, body: { outcome: "held", code: "clone_in_progress" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("commits only a result that asks to, and reports a lost commit acknowledgement as create_unverified", async () => {
    const log = vi.fn();
    await expect(runFencedRequest(runner(true), async () => created, log)).resolves.toEqual({ status: 201, body: { outcome: "created" } });
    const lost = runner(true, () => { throw new Error("Connection terminated unexpectedly"); });
    await expect(runFencedRequest(lost, async () => created, log)).resolves.toEqual({ status: 202, body: { outcome: "create_unverified" } });
    expect(log.mock.calls).toEqual([["commit_unverified"]]);
  });

  it("maps a failure before the hash to a generic hold and after it to create_failed, logging codes only", async () => {
    const log = vi.fn();
    await expect(runFencedRequest(runner(true), async () => { throw new Error("password=Secret-123!"); }, log))
      .resolves.toEqual({ status: 503, body: { outcome: "held", code: "request_failed" } });
    await expect(runFencedRequest(runner(true), async (scope) => { scope.stage = "hashed"; throw new Error("$2a$12$hash"); }, log))
      .resolves.toEqual({ status: 500, body: { outcome: "create_failed" } });
    expect(log.mock.calls).toEqual([["request_failed"], ["create_failed"]]);
  });
});

describe.skipIf(!process.env.DPF_S5_REQUESTER_TEST_DATABASE_URL)("enrollment against PostgreSQL (phase 6, AC-E4)", async () => {
  const { Pool } = await import("pg");
  const server = await import("./s5-rehearsal-enrollment.server");
  const { encodeRequesterSetupContext, deriveRequesterSetupDigest, handleRequesterCommand, runFencedRequest, executeEnrollment,
    evaluateRequesterState, readRequesterState, readRequesterStatus, requesterEmail, REQUESTER_FENCE_KEY } = server;
  type Ports = import("./s5-rehearsal-enrollment.server").RequesterBoundaryPorts;
  type Deps = import("./s5-rehearsal-enrollment.server").EnrollmentDeps;
  type Ctx = import("./s5-rehearsal-enrollment.server").EnrollSetupContext;
  const schema = `s5_enroll_${Math.random().toString(16).slice(2, 10)}`;
  const pool = new Pool({ connectionString: process.env.DPF_S5_REQUESTER_TEST_DATABASE_URL, options: `-c search_path="${schema}"`, max: 12 });
  const poolSql = { query: async (q: string, v?: unknown[]) => (await pool.query(q, v)).rows };
  const ORIGIN = "https://dpf.test";
  const PASSWORD = "Correct-Horse-9!";
  const refs = { installationRef: "install-1", leaseRef: "lease-1", dbIdentityRef: "db-1" };
  const count = async (table: string) => Number((await pool.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
  const waiting = async () => Number((await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n);
  const until = async (check: () => Promise<boolean>) => { for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 25)); };
  let seq = 0;
  async function setup(): Promise<Ctx> {
    const n = ++seq;
    const ctx: Ctx = { v: 1, command: "enroll", rulingRef: "ruling:1", reservationRef: `reservation:${n}`, reservationRevision: "rev-1", attemptRef: "attempt:1", fixtureRef: "fixture:1" };
    await pool.query(`INSERT INTO "Reservation" VALUES ($1, $2, $3, $4)`, [ctx.reservationRef, ctx.reservationRevision, ctx.attemptRef, ctx.fixtureRef]);
    return ctx;
  }
  const post = (ctx: Ctx) => {
    const url = new URL(`${ORIGIN}/api/admin/rehearsal-requester/enroll`);
    url.searchParams.set("setupContext", encodeRequesterSetupContext(ctx));
    return new Request(url, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: `password=${encodeURIComponent(PASSWORD)}` });
  };
  const reservation = async (sql: { query: typeof poolSql.query }, ctx: Ctx) => {
    const row = (await sql.query(`SELECT revision, "attemptRef", "fixtureRef" FROM "Reservation" WHERE ref = $1`, [ctx.reservationRef]))[0];
    if (!row) return "released" as const;
    return row.revision === ctx.reservationRevision && row.attemptRef === ctx.attemptRef && row.fixtureRef === ctx.fixtureRef ? "matches" as const : "replaced" as const;
  };
  const sqlCreate: Deps["createRequester"] = async (scope, input) => {
    const userId = `req-${input.setupDigest.slice(0, 12)}`;
    await scope.sql.query(`INSERT INTO "User"(id, email, "passwordHash", "isActive", "isSuperuser") VALUES ($1, $2, $3, false, false)`, [userId, input.email, input.passwordHash]);
    await scope.sql.query(`INSERT INTO "Principal"(id, kind, status) VALUES ($1, 'human', 'inactive')`, [`p-${userId}`]);
    await scope.sql.query(`INSERT INTO "PrincipalAlias" VALUES ($1, 'user', $2, '')`, [`p-${userId}`, userId]);
    const c = input.context;
    await scope.sql.query(`INSERT INTO "S5RehearsalRequesterEnrollment"("setupDigest","rulingRef","reservationRef","attemptRef","fixtureRef","userId","principalId")
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [input.setupDigest, c.rulingRef, c.reservationRef, c.attemptRef, c.fixtureRef, userId, `p-${userId}`]);
    await scope.sql.query(`INSERT INTO "Audit" VALUES ($1)`, [input.setupDigest]);
  };

  function wire(opts: { hashGate?: () => Promise<void>; preBodyGate?: () => Promise<void>; loseAck?: boolean;
    create?: Deps["createRequester"]; beforeFence?: (ctx: Ctx) => Promise<void> } = {}) {
    const hasher = vi.fn(async (password: string) => { await opts.hashGate?.(); return `$2a$12$${password.length}`; });
    const logs: string[] = [];
    const deps: Deps = {
      ownerBinding: async () => ({ ok: true, ownerPrincipalId: "p-owner" }),
      currentReservation: (ctx, scope) => reservation(scope.sql, ctx),
      commitFences: async (ctx, scope) => {
        await opts.beforeFence?.(ctx);
        const held = await scope.sql.query(`SELECT 1 AS present FROM "Reservation" WHERE ref = $1 AND revision = $2 FOR SHARE`, [ctx.reservationRef, ctx.reservationRevision]);
        return held.length ? { ok: true, refs } : { ok: false, code: "reservation_fence_lost" };
      },
      verify: async (digest, ctx, scope) => evaluateRequesterState(await readRequesterState(scope.sql, digest), { setupDigest: digest, facts: ctx }),
      hashPassword: hasher,
      createRequester: opts.create ?? sqlCreate,
    };
    const transaction = async <T,>(run: (tx: { sql: typeof poolSql; client: unknown }) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        let out: T;
        try { out = await run({ sql: { query: async (q, v) => (await client.query(q, v)).rows }, client }); } catch (error) { await client.query("ROLLBACK"); throw error; }
        await client.query("COMMIT");
        if (opts.loseAck) throw new Error("Connection terminated unexpectedly");
        return out;
      } finally { client.release(); }
    };
    const ports: Ports = {
      environmentClass: async () => "development",
      canonicalOrigin: () => ORIGIN,
      sessionUserId: async () => "u-owner",
      currentReservation: (ctx) => reservation(poolSql, ctx),
      retainedRecord: async (digest) => (await pool.query(`SELECT lifecycle FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1`, [digest])).rows[0] ?? null,
      readiness: async () => ({ ready: true }),
      requestTransaction: (run) => runFencedRequest(transaction, run, (code) => logs.push(code)),
      preBodyOwnerAndDb: async () => { await opts.preBodyGate?.(); return { ok: true }; },
      verifyRequesterState: async (digest, ctx) => evaluateRequesterState(await readRequesterState(poolSql, digest), { setupDigest: digest, facts: ctx }),
      readBody: vi.fn(async (request: Request) => request.text()),
      execute: (input, scope) => executeEnrollment(input as Parameters<typeof executeEnrollment>[0], scope, deps),
    };
    return { ports, hasher, logs };
  }

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const ddl of [
      `CREATE TABLE "User"(id text PRIMARY KEY, email text UNIQUE NOT NULL, "passwordHash" text NOT NULL, "isActive" boolean NOT NULL, "isSuperuser" boolean NOT NULL)`,
      `CREATE TABLE "Principal"(id text PRIMARY KEY, kind text NOT NULL, status text NOT NULL)`,
      `CREATE TABLE "PrincipalAlias"("principalId" text NOT NULL, "aliasType" text NOT NULL, "aliasValue" text NOT NULL, issuer text NOT NULL DEFAULT '', UNIQUE ("aliasType","aliasValue",issuer))`,
      `CREATE TABLE "S5RehearsalRequesterEnrollment"(id serial PRIMARY KEY, "setupDigest" text UNIQUE NOT NULL, "rulingRef" text NOT NULL, "reservationRef" text NOT NULL,
        "attemptRef" text NOT NULL, "fixtureRef" text NOT NULL, "userId" text UNIQUE NOT NULL, "principalId" text UNIQUE NOT NULL, lifecycle text NOT NULL DEFAULT 'active',
        "lifecycleAt" timestamptz, "retirementReason" text, "retiredByPrincipalId" text)`,
      `CREATE TABLE "AuthorityBinding"("oauthUserId" text, status text NOT NULL)`,
      `CREATE TABLE "McpApiToken"("userId" text NOT NULL, "revokedAt" timestamptz)`,
      `CREATE TABLE "OAuthRefreshToken"("userId" text NOT NULL, "revokedAt" timestamptz)`,
      `CREATE TABLE "OAuthClient"("ownerUserId" text, "registrationKind" text NOT NULL, "revokedAt" timestamptz)`,
      `CREATE TABLE "Reservation"(ref text PRIMARY KEY, revision text NOT NULL, "attemptRef" text NOT NULL, "fixtureRef" text NOT NULL)`,
      `CREATE TABLE "Audit"("setupDigest" text NOT NULL)`,
    ]) await pool.query(ddl);
  }, 30_000);

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it("serializes a waiting request B behind A: one hash, one create, B replays even when it gets the lock near 5 s", async () => {
    const ctx = await setup();
    let releaseA!: () => void;
    const a = wire({ hashGate: () => new Promise<void>((resolve) => { releaseA = resolve; }) });
    const b = wire();
    const first = handleRequesterCommand(post(ctx), "enroll", a.ports);
    await until(async () => a.hasher.mock.calls.length === 1);
    const second = handleRequesterCommand(post(ctx), "enroll", b.ports);
    await until(async () => (await waiting()) === 1);
    expect(await waiting()).toBe(1);
    await new Promise((r) => setTimeout(r, 4_000));
    releaseA();
    await expect(first).resolves.toMatchObject({ status: 201, body: { outcome: "created" } });
    await expect(second).resolves.toMatchObject({ status: 200, body: { outcome: "replay" } });
    expect(a.hasher).toHaveBeenCalledTimes(1);
    expect(b.hasher).not.toHaveBeenCalled();
    expect(await count("S5RehearsalRequesterEnrollment")).toBe(1);
  }, 20_000);

  it("returns enroll_busy with no hash when the per-setup lock wait times out", async () => {
    const ctx = await setup();
    const holder = await pool.connect();
    await holder.query("SELECT true AS locked FROM pg_advisory_lock(hashtextextended($1, 0))", [`s5rr-enroll:${deriveRequesterSetupDigest(ctx)}`]);
    try {
      const w = wire();
      await expect(handleRequesterCommand(post(ctx), "enroll", w.ports)).resolves.toMatchObject({ status: 409, body: { code: "enroll_busy" } });
      expect(w.hasher).not.toHaveBeenCalled();
    } finally {
      await holder.query("SELECT pg_advisory_unlock_all() IS NULL AS done");
      holder.release();
    }
  }, 15_000);

  it("does not commit when the reservation is released after the last comparison", async () => {
    const ctx = await setup();
    const before = await count("S5RehearsalRequesterEnrollment");
    const w = wire({ beforeFence: async (c) => { await pool.query(`DELETE FROM "Reservation" WHERE ref = $1`, [c.reservationRef]); } });
    await expect(handleRequesterCommand(post(ctx), "enroll", w.ports)).resolves.toMatchObject({ status: 409, body: { code: "reservation_fence_lost" } });
    expect(w.hasher).not.toHaveBeenCalled();
    expect(await count("S5RehearsalRequesterEnrollment")).toBe(before);
  });

  it("rolls back a post-hash failure as create_failed, leaking no secret", async () => {
    const ctx = await setup();
    const users = await count("User");
    const w = wire({ create: async (scope, input) => {
      await scope.sql.query(`INSERT INTO "User"(id, email, "passwordHash", "isActive", "isSuperuser") VALUES ('doomed', $1, $2, false, false)`, [input.email, input.passwordHash]);
      throw new Error(`insert failed for ${PASSWORD} ${input.passwordHash}`);
    } });
    const result = await handleRequesterCommand(post(ctx), "enroll", w.ports);
    expect(result).toEqual({ status: 500, body: { outcome: "create_failed" } });
    expect(w.hasher).toHaveBeenCalledTimes(1);
    expect(await count("User")).toBe(users);
    expect(JSON.stringify([result, w.logs])).not.toMatch(/Correct-Horse|\$2a\$/u);
    expect(w.logs).toEqual(["create_failed"]);
  });

  it("recovers a lost commit acknowledgement by digest after the reservation is released, and a new POST never creates", async () => {
    const ctx = await setup();
    const digest = deriveRequesterSetupDigest(ctx);
    const lost = wire({ loseAck: true });
    await expect(handleRequesterCommand(post(ctx), "enroll", lost.ports)).resolves.toEqual({ status: 202, body: { outcome: "create_unverified", setupDigest: digest } });
    await pool.query(`DELETE FROM "Reservation" WHERE ref = $1`, [ctx.reservationRef]);
    const conn = await pool.connect();
    try {
      const status = await readRequesterStatus({ query: async (q, v) => (await conn.query(q, v)).rows }, digest);
      expect(status).toEqual({ status: 200, body: { outcome: "committed", setupDigest: digest, verification: { verified: true, lifecycle: "active", factsMatch: true } } });
    } finally { conn.release(); }
    const again = wire();
    await expect(handleRequesterCommand(post(ctx), "enroll", again.ports)).resolves.toMatchObject({ status: 409, body: { code: "reservation_released" } });
    expect(again.hasher).not.toHaveBeenCalled();
  });

  it("R-ONE-FENCE: a clone arriving after the pre-body checks is held off; a request during a clone reads no body", async () => {
    const clone = await pool.connect();
    try {
      const ctx = await setup();
      let cloneGotFence: boolean | null = null;
      const w = wire({ preBodyGate: async () => {
        cloneGotFence = (await clone.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS got", [REQUESTER_FENCE_KEY])).rows[0].got;
      } });
      await expect(handleRequesterCommand(post(ctx), "enroll", w.ports)).resolves.toMatchObject({ status: 201 });
      expect(cloneGotFence).toBe(false);
      await clone.query("SELECT true AS locked FROM pg_advisory_lock(hashtextextended($1, 0))", [REQUESTER_FENCE_KEY]);
      const during = wire();
      await expect(handleRequesterCommand(post(await setup()), "enroll", during.ports)).resolves.toMatchObject({ status: 409, body: { code: "clone_in_progress" } });
      expect(during.ports.readBody).not.toHaveBeenCalled();
    } finally {
      await clone.query("SELECT pg_advisory_unlock_all() IS NULL AS done");
      clone.release();
    }
  });

  it("R-STATUS-WAIT: status waits on the per-setup lock before the enroll commit, then reports committed", async () => {
    const ctx = await setup();
    const digest = deriveRequesterSetupDigest(ctx);
    let releaseA!: () => void;
    const a = wire({ hashGate: () => new Promise<void>((resolve) => { releaseA = resolve; }) });
    const first = handleRequesterCommand(post(ctx), "enroll", a.ports);
    await until(async () => a.hasher.mock.calls.length === 1);
    const conn = await pool.connect();
    try {
      const pid = (await conn.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const status = readRequesterStatus({ query: async (q, v) => (await conn.query(q, v)).rows }, digest);
      const statusWaiting = async () => (await pool.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`, [pid])).rowCount === 1;
      await until(statusWaiting);
      expect(await statusWaiting()).toBe(true);
      releaseA();
      await expect(first).resolves.toMatchObject({ status: 201 });
      await expect(status).resolves.toMatchObject({ body: { outcome: "committed", verification: { verified: true } } });
    } finally { conn.release(); }
  });

  it("holds on fact mismatch, alias drift and an orphan or colliding label, with no hash", async () => {
    const ctx = await setup();
    const digest = deriveRequesterSetupDigest(ctx);
    await handleRequesterCommand(post(ctx), "enroll", wire().ports);
    const mismatch = { ...ctx, attemptRef: "attempt:2" };
    await pool.query(`UPDATE "Reservation" SET "attemptRef" = 'attempt:2' WHERE ref = $1`, [ctx.reservationRef]);
    const m = wire();
    await expect(handleRequesterCommand(post(mismatch), "enroll", m.ports)).resolves.toMatchObject({ status: 409, body: { code: "requester_state_unverified" } });
    await pool.query(`UPDATE "Reservation" SET "attemptRef" = 'attempt:1' WHERE ref = $1`, [ctx.reservationRef]);
    await pool.query(`INSERT INTO "PrincipalAlias" VALUES ($1, 'email', 'drift@example.invalid', '')`, [`p-req-${digest.slice(0, 12)}`]);
    const d = wire();
    await expect(handleRequesterCommand(post(ctx), "enroll", d.ports)).resolves.toMatchObject({ status: 409, body: { code: "requester_state_unverified" } });
    const orphanCtx = await setup();
    await pool.query(`INSERT INTO "User"(id, email, "passwordHash", "isActive", "isSuperuser") VALUES ('orphan', $1, 'x', false, false)`, [requesterEmail(deriveRequesterSetupDigest(orphanCtx))]);
    const o = wire();
    await expect(handleRequesterCommand(post(orphanCtx), "enroll", o.ports)).resolves.toMatchObject({ status: 409, body: { code: "requester_email_orphan" } });
    expect([m, d, o].every((w) => w.hasher.mock.calls.length === 0)).toBe(true);
  });

  it("still replays after the audit rows are purged", async () => {
    const ctx = await setup();
    await handleRequesterCommand(post(ctx), "enroll", wire().ports);
    await pool.query(`DELETE FROM "Audit"`);
    const r = wire();
    await expect(handleRequesterCommand(post(ctx), "enroll", r.ports)).resolves.toMatchObject({ status: 200, body: { outcome: "replay" } });
    expect(r.hasher).not.toHaveBeenCalled();
  });
});
