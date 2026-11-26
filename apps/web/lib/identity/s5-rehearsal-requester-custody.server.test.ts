import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  deriveRequesterSetupDigest,
  encodeRequesterSetupContext,
  evaluateRequesterState,
  handleRequesterCommand,
  readRequesterState,
  runFencedRequest,
  type RequesterBoundaryPorts,
} from "./s5-rehearsal-enrollment.server";
import {
  executeRetirement,
  readS5RehearsalEnrollment,
  requesterProvisionerDisposition,
  type EnrollmentSeamDb,
  type RetirementDeps,
} from "./s5-rehearsal-requester-custody.server";
import { revokeAccountAgentAccessInTransaction } from "@/lib/auth/account-agent-access";

const refs = { rulingRef: "ruling:1", reservationRef: "reservation:1" };
const digest = deriveRequesterSetupDigest(refs);

describe("read-only verification seam (BI-9F7192F9 phase 10, AC-E8)", () => {
  const record = {
    id: "enr-1", setupDigest: digest, ...refs, attemptRef: "attempt:1", fixtureRef: "fixture:1", installationRef: "install-1",
    leaseRef: "lease-1", dbIdentityRef: "db-1", userId: "req-user", principalId: "req-principal", enrolledByPrincipalId: "p-owner",
    enrolledAt: new Date("2026-11-26T00:00:00Z"), lifecycle: "active", lifecycleAt: null, retirementReason: null, retiredByPrincipalId: null,
  };
  function seamDb(overrides: { audit?: unknown[]; record?: unknown } = {}) {
    const reads = {
      s5RehearsalRequesterEnrollment: { findUnique: vi.fn(async () => ("record" in overrides ? overrides.record : record)) },
      authorizationDecisionLog: { findMany: vi.fn(async () => overrides.audit ?? [{ decisionId: `s5rr:enroll:${digest}` }]) },
      user: { findUnique: vi.fn(async () => ({
        id: "req-user", email: "rehearsal-0123456789abcdef@s5-rehearsal.invalid", isActive: false, isSuperuser: false,
        workHandedOverAt: null, automationVerificationId: null, automationProfile: null, automationSlot: null, automationExpiresAt: null,
      })) },
      principal: { findUnique: vi.fn(async () => ({ id: "req-principal", principalId: "PRN-9", kind: "human", status: "inactive",
        aliases: [{ aliasType: "user", aliasValue: "req-user", issuer: "" }] })) },
      authorityBinding: { findMany: vi.fn(async () => []) },
      mcpApiToken: { count: vi.fn(async () => 0) },
      oAuthRefreshToken: { count: vi.fn(async () => 0) },
      oAuthClient: { count: vi.fn(async () => 0) },
    };
    // Any property outside the read set (a mutator, $transaction, a raw query) throws.
    return new Proxy(reads, { get: (target, key) => {
      if (!(key in target)) throw new Error(`seam reached ${String(key)}`);
      return new Proxy((target as Record<string, object>)[key as string]!, { get: (model, op) => {
        if (!(op in model)) throw new Error(`seam called ${String(key)}.${String(op)}`);
        return (model as Record<string, unknown>)[op as string];
      } });
    } }) as unknown as EnrollmentSeamDb & typeof reads;
  }

  it("returns explicit projections with no bearer material and selects no secret column", async () => {
    const db = seamDb();
    const projection = await readS5RehearsalEnrollment(refs, db);
    expect(projection).toMatchObject({
      record: { setupDigest: digest, lifecycle: "active" },
      user: { isActive: false, automation: false, handedOver: false },
      principal: { status: "inactive" }, bindings: [], unrevokedTokens: 0, ownedClients: 0,
    });
    const selects = JSON.stringify([db.user.findUnique, db.principal.findUnique, db.authorizationDecisionLog.findMany,
      db.authorityBinding.findMany].map((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls));
    expect(selects).not.toMatch(/passwordHash|tokenHash|secret|session/iu);
    expect(JSON.stringify(projection)).not.toMatch(/passwordHash|tokenHash|\$2[aby]\$/u);
  });

  it("reports audit-expired when the audit rows were purged, and null when there is no record", async () => {
    expect(await readS5RehearsalEnrollment(refs, seamDb({ audit: [] }))).toMatchObject({ audit: "audit-expired" });
    await expect(readS5RehearsalEnrollment(refs, seamDb({ record: null }))).resolves.toBeNull();
  });

  it("the provisioner holds on every projection in this item", async () => {
    const projection = await readS5RehearsalEnrollment(refs, seamDb());
    expect(requesterProvisionerDisposition(projection)).toEqual({ disposition: "hold", reason: "requester_inactive" });
    expect(requesterProvisionerDisposition(null)).toEqual({ disposition: "hold", reason: "requester_missing" });
    expect(requesterProvisionerDisposition({ ...projection!, record: { ...projection!.record, lifecycle: "retired" } }))
      .toEqual({ disposition: "hold", reason: "requester_retired" });
  });
});

describe("transaction-scoped revocation helper (phase 9)", () => {
  it("runs the same three revocations on the caller's transaction client", async () => {
    const updateMany = (count: number) => vi.fn(async () => ({ count }));
    const tx = { mcpApiToken: { updateMany: updateMany(2) }, oAuthRefreshToken: { updateMany: updateMany(1) }, oAuthClient: { updateMany: updateMany(1) } };
    const revokedAt = new Date("2026-11-26T00:00:00Z");
    await expect(revokeAccountAgentAccessInTransaction(tx as never, { userId: "req-user", revokedAt, revokedReason: "r" }))
      .resolves.toEqual({ revokedAccessTokens: 2, revokedRefreshTokens: 1, revokedCredentialsClients: 1 });
    expect(tx.mcpApiToken.updateMany).toHaveBeenCalledWith({ where: { userId: "req-user", revokedAt: null }, data: { revokedAt, revokedReason: "r" } });
    expect(tx.oAuthClient.updateMany).toHaveBeenCalledWith({
      where: { ownerUserId: "req-user", registrationKind: "credentials", revokedAt: null }, data: { revokedAt, revokedReason: "r" },
    });
  });
});

describe.skipIf(!process.env.DPF_S5_REQUESTER_TEST_DATABASE_URL)("retirement against PostgreSQL (phase 9, AC-E6)", async () => {
  const { Pool } = await import("pg");
  const schema = `s5_retire_${Math.random().toString(16).slice(2, 10)}`;
  const pool = new Pool({ connectionString: process.env.DPF_S5_REQUESTER_TEST_DATABASE_URL, options: `-c search_path="${schema}"`, max: 8 });
  const poolSql = { query: async (q: string, v?: unknown[]) => (await pool.query(q, v)).rows };
  const ORIGIN = "https://dpf.test";
  const one = async (q: string, v?: unknown[]) => (await pool.query(q, v)).rows[0];
  let seq = 0;

  /** An enrolled, inactive requester with live credentials to revoke; returns its digest. */
  async function enrolled(): Promise<{ digest: string; userId: string; principalId: string }> {
    const n = ++seq;
    const d = deriveRequesterSetupDigest({ rulingRef: "ruling:1", reservationRef: `reservation:${n}` });
    const userId = `req-${n}`; const principalId = `p-req-${n}`;
    await pool.query(`INSERT INTO "User"(id, "isActive") VALUES ($1, false)`, [userId]);
    await pool.query(`INSERT INTO "Principal"(id, status) VALUES ($1, 'inactive')`, [principalId]);
    await pool.query(`INSERT INTO "PrincipalAlias" VALUES ($1, 'user', $2, '')`, [principalId, userId]);
    await pool.query(`INSERT INTO "S5RehearsalRequesterEnrollment"("setupDigest","rulingRef","reservationRef","attemptRef","fixtureRef",
      "installationRef","leaseRef","dbIdentityRef","userId","principalId") VALUES ($1,'ruling:1',$2,'attempt:1','fixture:1','install-1','lease-1','db-1',$3,$4)`,
      [d, `reservation:${n}`, userId, principalId]);
    await pool.query(`INSERT INTO "AuthorityBinding"("oauthUserId", status) VALUES ($1, 'active')`, [userId]);
    await pool.query(`INSERT INTO "McpApiToken"("userId") VALUES ($1)`, [userId]);
    await pool.query(`INSERT INTO "OAuthRefreshToken"("userId") VALUES ($1)`, [userId]);
    await pool.query(`INSERT INTO "OAuthClient"("ownerUserId", "registrationKind") VALUES ($1, 'credentials')`, [userId]);
    return { digest: d, userId, principalId };
  }

  function wire(opts: { owner?: RetirementDeps["ownerBinding"]; beforeReadback?: () => Promise<void>; loseAck?: boolean;
    dbIdentity?: string; installation?: string } = {}) {
    const deps: RetirementDeps = {
      ownerBinding: opts.owner ?? (async () => ({ ok: true, ownerPrincipalId: "p-owner" })),
      dbIdentity: async () => opts.dbIdentity ?? "db-1",
      installationAttestation: async () => opts.installation ?? "install-1",
      revokeTokensAndClients: async (scope, input) => {
        for (const table of ["McpApiToken", "OAuthRefreshToken"]) {
          await scope.sql.query(`UPDATE "${table}" SET "revokedAt" = $2 WHERE "userId" = $1 AND "revokedAt" IS NULL RETURNING 1 AS r`, [input.userId, input.revokedAt]);
        }
        await scope.sql.query(`UPDATE "OAuthClient" SET "revokedAt" = $2 WHERE "ownerUserId" = $1 AND "registrationKind" = 'credentials' AND "revokedAt" IS NULL RETURNING 1 AS r`, [input.userId, input.revokedAt]);
      },
      writeAudit: async (scope, input) => { await scope.sql.query(`INSERT INTO "Audit" VALUES ($1, $2) RETURNING 1 AS r`, [input.setupDigest, input.command]); },
      readback: async (d) => {
        await opts.beforeReadback?.();
        const client = await pool.connect();
        try {
          await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const row = await readRequesterState({ query: async (q, v) => (await client.query(q, v)).rows }, d);
          await client.query("COMMIT");
          return row;
        } finally { client.release(); }
      },
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
    const ports: RequesterBoundaryPorts = {
      environmentClass: async () => "development",
      canonicalOrigin: () => ORIGIN,
      sessionUserId: async () => "u-owner",
      currentReservation: async () => "unavailable",
      retainedRecord: async (d) => (await pool.query(`SELECT lifecycle FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1`, [d])).rows[0] ?? null,
      readiness: async () => ({ ready: true }),
      requestTransaction: (run) => runFencedRequest(transaction, run, () => undefined),
      preBodyOwnerAndDb: async () => ({ ok: true }),
      verifyRequesterState: async () => ({ verified: false }),
      readBody: async (request) => request.text(),
      execute: (input, scope) => executeRetirement(input as Parameters<typeof executeRetirement>[0], scope, deps),
    };
    return ports;
  }
  const retire = (d: string, ports: RequesterBoundaryPorts) => {
    const url = new URL(`${ORIGIN}/api/admin/rehearsal-requester/retire`);
    url.searchParams.set("setupContext", encodeRequesterSetupContext({ v: 1, command: "retire", setupDigest: d }));
    return handleRequesterCommand(new Request(url, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: "retirementReason=rehearsal_complete" }), "retire", ports);
  };
  const audits = async (d: string) => Number((await one(`SELECT count(*)::int AS n FROM "Audit" WHERE "setupDigest" = $1`, [d])).n);

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const ddl of [
      `CREATE TYPE "S5RehearsalRequesterRetirementReason" AS ENUM ('rehearsal_complete', 'quarantine_after_failure', 'setup_superseded', 'operator_cleanup')`,
      `CREATE TABLE "User"(id text PRIMARY KEY, "isActive" boolean NOT NULL)`,
      `CREATE TABLE "Principal"(id text PRIMARY KEY, status text NOT NULL, "updatedAt" timestamptz)`,
      `CREATE TABLE "PrincipalAlias"("principalId" text NOT NULL, "aliasType" text NOT NULL, "aliasValue" text NOT NULL, issuer text NOT NULL DEFAULT '', UNIQUE ("aliasType","aliasValue",issuer))`,
      `CREATE TABLE "S5RehearsalRequesterEnrollment"(id serial PRIMARY KEY, "setupDigest" text UNIQUE NOT NULL, "rulingRef" text NOT NULL, "reservationRef" text NOT NULL,
        "attemptRef" text NOT NULL, "fixtureRef" text NOT NULL, "installationRef" text NOT NULL, "leaseRef" text NOT NULL, "dbIdentityRef" text NOT NULL,
        "userId" text UNIQUE NOT NULL, "principalId" text UNIQUE NOT NULL, lifecycle text NOT NULL DEFAULT 'active', "lifecycleAt" timestamptz,
        "retirementReason" "S5RehearsalRequesterRetirementReason", "retiredByPrincipalId" text,
        CHECK ((lifecycle = 'active' AND "lifecycleAt" IS NULL AND "retirementReason" IS NULL AND "retiredByPrincipalId" IS NULL)
            OR (lifecycle = 'retired' AND "lifecycleAt" IS NOT NULL AND "retirementReason" IS NOT NULL AND "retiredByPrincipalId" IS NOT NULL)))`,
      `CREATE TABLE "AuthorityBinding"("oauthUserId" text, status text NOT NULL, "updatedAt" timestamptz)`,
      `CREATE TABLE "McpApiToken"("userId" text NOT NULL, "revokedAt" timestamptz)`,
      `CREATE TABLE "OAuthRefreshToken"("userId" text NOT NULL, "revokedAt" timestamptz)`,
      `CREATE TABLE "OAuthClient"("ownerUserId" text, "registrationKind" text NOT NULL, "revokedAt" timestamptz)`,
      `CREATE TABLE "Audit"("setupDigest" text NOT NULL, command text NOT NULL)`,
    ]) await pool.query(ddl);
  }, 30_000);

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it("revokes every live credential, writes the terminal tuple once and returns retired only after the fresh readback", async () => {
    const r = await enrolled();
    await expect(retire(r.digest, wire())).resolves.toEqual({ status: 200, body: { outcome: "retired", setupDigest: r.digest } });
    expect(await one(`SELECT status FROM "AuthorityBinding" WHERE "oauthUserId" = $1`, [r.userId])).toEqual({ status: "revoked" });
    expect(await one(`SELECT count(*)::int AS n FROM "McpApiToken" WHERE "userId" = $1 AND "revokedAt" IS NULL`, [r.userId])).toEqual({ n: 0 });
    expect(await one(`SELECT count(*)::int AS n FROM "OAuthClient" WHERE "ownerUserId" = $1 AND "revokedAt" IS NULL`, [r.userId])).toEqual({ n: 0 });
    expect(await one(`SELECT lifecycle, "retirementReason"::text AS reason, "retiredByPrincipalId" AS by FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1`, [r.digest]))
      .toEqual({ lifecycle: "retired", reason: "rehearsal_complete", by: "p-owner" });
    expect(await audits(r.digest)).toBe(1);
  });

  it("serializes concurrent retirements and re-observes a repeat without rewriting, even with no reservation, no lease and purged audit", async () => {
    const r = await enrolled();
    const [a, b] = await Promise.all([retire(r.digest, wire()), retire(r.digest, wire())]);
    expect([a, b]).toEqual([{ status: 200, body: { outcome: "retired", setupDigest: r.digest } }, { status: 200, body: { outcome: "retired", setupDigest: r.digest } }]);
    expect(await audits(r.digest)).toBe(1);
    await pool.query(`DELETE FROM "Audit"`);
    await expect(retire(r.digest, wire())).resolves.toMatchObject({ status: 200, body: { outcome: "retired" } });
    expect(await audits(r.digest)).toBe(0);
  });

  it("holds before any branch on alias drift, DB identity or installation mismatch, and refuses a lost authority", async () => {
    const r = await enrolled();
    await expect(retire(r.digest, wire({ dbIdentity: "db-2" }))).resolves.toMatchObject({ status: 409, body: { code: "db_identity_mismatch" } });
    await expect(retire(r.digest, wire({ installation: "install-2" }))).resolves.toMatchObject({ status: 409, body: { code: "installation_mismatch" } });
    await expect(retire(r.digest, wire({ owner: async () => ({ ok: false, code: "not_owner" }) }))).resolves.toMatchObject({ status: 403, body: { outcome: "refused" } });
    await pool.query(`INSERT INTO "PrincipalAlias" VALUES ($1, 'email', $2, '')`, [r.principalId, `drift-${r.userId}@example.invalid`]);
    await expect(retire(r.digest, wire())).resolves.toMatchObject({ status: 409, body: { code: "requester_alias_drift" } });
    expect(await one(`SELECT lifecycle FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1`, [r.digest])).toEqual({ lifecycle: "active" });
    expect(await one(`SELECT status FROM "AuthorityBinding" WHERE "oauthUserId" = $1`, [r.userId])).toEqual({ status: "active" });
  });

  it("returns committed_unverified when alias drift lands between the commit and the readback; a retry then refuses or holds, never retired", async () => {
    const r = await enrolled();
    const drift = () => pool.query(`INSERT INTO "PrincipalAlias" VALUES ($1, 'email', $2, '')`, [r.principalId, `late-${r.userId}@example.invalid`]).then(() => undefined);
    await expect(retire(r.digest, wire({ beforeReadback: drift }))).resolves.toEqual({
      status: 202, body: { outcome: "committed_unverified", reason: "requester_state_unverified", setupDigest: r.digest },
    });
    await expect(retire(r.digest, wire({ owner: async () => ({ ok: false, code: "owner_capability_missing" }) })))
      .resolves.toMatchObject({ status: 403, body: { outcome: "refused" } });
    await expect(retire(r.digest, wire())).resolves.toMatchObject({ status: 409, body: { code: "requester_alias_drift" } });
    expect(await audits(r.digest)).toBe(1);
  });

  it("reports a lost commit acknowledgement as committed_unverified, and the retry re-observes it as retired", async () => {
    const r = await enrolled();
    await expect(retire(r.digest, wire({ loseAck: true }))).resolves.toMatchObject({ status: 202, body: { outcome: "committed_unverified" } });
    await expect(retire(r.digest, wire())).resolves.toMatchObject({ status: 200, body: { outcome: "retired" } });
    expect(await audits(r.digest)).toBe(1);
    expect(evaluateRequesterState(await readRequesterState(poolSql, r.digest), { setupDigest: r.digest })).toMatchObject({ verified: true, lifecycle: "retired" });
  });
});
