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
