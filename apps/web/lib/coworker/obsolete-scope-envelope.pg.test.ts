/** Actual PostgreSQL serialization in a disposable governed test schema.
 * Synthetic identities/issuer facts do not certify a live image or live policy. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";
import { fingerprintCoworkerApprovalBinding, fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { commandAuthorityScopeKey, commandPayloadBinding, runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { releaseWorkCapsuleScope } from "@/lib/work-capsules/scope-release-store";
import type { CapsuleDb } from "@/lib/work-capsules/work-capsule-store-types";
import { settleObsoleteScopeReleaseEnvelopes, type ObsoleteScopeDb } from "./obsolete-scope-envelope";

const configured = process.env.DATABASE_URL;
const leased = (() => { try { return process.env.DPF_NONPROD_LEASE_ID && configured
  && /^\/dpf_local_ci_\d+$/.test(new URL(configured).pathname) ? configured : undefined; } catch { return undefined; } })();
const url = process.env.DPF_JOBS_TEST_DATABASE_URL ?? process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL ?? leased;
const schema = `review_scoperetire_${randomUUID().replaceAll("-", "")}`;
const tables = ["CoworkerActionEnvelope", "ToolExecution", "WorkCapsule", "WorkCapsuleActivity", "User", "UserGroup",
  "PlatformRole", "Agent", "AgentGovernanceProfile", "Principal", "PrincipalAlias", "AuthorizationDecisionLog"];
const target = { kind: "path" as const, value: "package.json", intent: "edit" as const,
  recordedByPrincipalId: "human-row", releaseEpoch: "00000000-0000-4000-8000-000000000001" };
const actor = { userId: "person", agentId: "assistant", principalId: "human-row" };
const original = { capsuleId: "WC-SCOPE-PG", expectedRoomId: "original-room", claims: [target] };
function barrier() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; }
async function reach(signal: Promise<void>, work: Promise<unknown>) {
  await Promise.race([signal, work.then(() => { throw Error("Operation ended before its race barrier"); })]);
}

describe.skipIf(!url)("unused scope withdrawal on isolated leased PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>, now: Date;
  beforeAll(async () => { fixture = await createReviewPostgresFixture({ url: url!, schema, tables }); });
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => {
    now = new Date();
    await fixture.pool.query(`TRUNCATE ${tables.map(name => `"${name}"`).join(", ")}`);
    await fixture.db.user.create({ data: { id: "person", email: "scope-retirement@example.invalid", passwordHash: "invalid-test-hash",
      isActive: true, isSuperuser: true } });
    await fixture.db.agent.create({ data: { id: "agent-record", agentId: "assistant", name: "Synthetic assistant",
      displayName: "Synthetic assistant", kind: "engineer", tier: 3, type: "synthetic", status: "active", sensitivity: "internal" } });
    await fixture.db.agentGovernanceProfile.create({ data: { agentId: "agent-record", capabilityClassId: "synthetic-capability",
      directivePolicyClassId: "synthetic-policy", autonomyLevel: "synthetic", hitlPolicy: "proposal_for_external_writes" } });
    for (const [id, kind, aliasType, aliasValue] of [["human-row", "human", "user", "person"], ["agent-row", "agent", "agent", "assistant"]]) {
      await fixture.db.principal.create({ data: { id, principalId: `PRN-${id}`, kind, displayName: id,
        status: "active", sensitivityClearance: ["public", "internal", "confidential"] } });
      await fixture.db.principalAlias.create({ data: { principalId: id, aliasType, aliasValue, issuer: "" } });
    }
    await fixture.db.workroom.create({ data: { id: "original-room", capsuleId: "WC-SCOPE-PG", title: "Synthetic original room",
      objective: "Verify isolated lifecycle serialization", source: "synthetic-test", status: "working", scopeClaims: [] } });
    await fixture.db.workroomActivity.create({ data: { id: "original-issuance", workCapsuleId: "original-room", kind: "scope-claimed",
      summary: "Synthetic authentic-added fixture", recordedById: "person", recordedByAgentId: "assistant",
      payload: { added: [{ ...target, recordedAt: now.toISOString() }], refreshed: [] } } });
    await seedProposal();
  });

  async function seedProposal(commandId?: string) {
    const params = { ...original, ...(commandId ? { commandId } : {}) };
    const binding = { actingHumanUserId: "person", actingAgentId: "assistant", chainId: null, taskRunId: null,
      toolName: "release_workroom_scope", subject: { kind: "platform" as const, id: "dpf" }, routeContext: null,
      sensitivity: "internal" as const, inputFingerprint: fingerprintCoworkerInput(params), decisionVersionFingerprint: "synthetic-policy" };
    await fixture.db.authorizationDecisionLog.upsert({ where: { decisionId: "AUTH-scope-pg" }, update: {},
      create: { decisionId: "AUTH-scope-pg", actorType: "ai-coworker", actorRef: "assistant", humanContextRef: "person",
        agentContextRef: "assistant", actionKey: "release_workroom_scope", objectRef: "platform:dpf", decision: "require-approval",
        rationale: { chainId: null, taskRunId: null, subjectKind: "platform", authorityOrganizationScope: null } } });
    await fixture.db.coworkerActionEnvelope.upsert({ where: { id: "proposal" },
      update: { argsJson: { approvalBinding: binding }, inputFingerprint: binding.inputFingerprint,
        approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding) },
      create: { id: "proposal", manifestActionId: "release_workroom_scope", coworkerAgentId: "assistant", delegatingUserId: "person",
        threadId: "synthetic-thread", rationale: "Synthetic unused scope proposal", authorityDecisionId: "AUTH-scope-pg",
        argsJson: { approvalBinding: binding }, inputFingerprint: binding.inputFingerprint,
        approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding), expiresAt: new Date(now.getTime() + 60_000) } });
    await fixture.db.toolExecution.upsert({ where: { id: "parked-call" }, update: { parameters: params }, create: { id: "parked-call",
      envelopeId: "proposal", toolName: "release_workroom_scope", userId: "person", agentId: "assistant", taskRunId: null,
      threadId: "synthetic-thread", executionMode: "external-jsonrpc", success: false, parameters: params,
      result: { success: false, error: "approval_required", data: { envelopeId: "proposal" } } } });
  }
  const proposal = () => fixture.db.coworkerActionEnvelope.findUniqueOrThrow({ where: { id: "proposal" } });
  const audits = () => fixture.db.workroomActivity.findMany({ where: { kind: "action" } });
  const port = (transform?: (tx: any) => any): ObsoleteScopeDb => ({
    coworkerActionEnvelope: fixture.db.coworkerActionEnvelope, toolExecution: fixture.db.toolExecution,
    $transaction: (run: any) => fixture.db.$transaction(tx => run(transform ? transform(tx) : tx), { timeout: 20_000 }),
  } as unknown as ObsoleteScopeDb);
  const watchEnvelopeLock = (opened: () => void) => (tx: any) => new Proxy(tx, { get(client, key) {
    if (key === "$queryRaw") return (strings: TemplateStringsArray, ...args: unknown[]) => {
      if (strings.join("").includes('FROM "CoworkerActionEnvelope"')) opened();
      return client.$queryRaw(strings, ...args);
    };
    return Reflect.get(client, key);
  } });
  async function waitForLockWaiter() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await fixture.pool.query<{ waiting: boolean }>(`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1
          AND pid <> pg_backend_pid() AND wait_event_type = 'Lock') AS waiting`, [schema]);
      if (result.rows[0]?.waiting) return;
      await fixture.pool.query("SELECT pg_sleep(0.01)");
    }
    throw Error("Competing PostgreSQL request never waited on the protected row");
  }

  it("cancels with the original audit atomically and leaves the parked ledger unchanged", async () => {
    const before = await fixture.db.toolExecution.findMany();
    expect(await settleObsoleteScopeReleaseEnvelopes(port(), now)).toMatchObject({ cancelled: 1, inconclusive: 0 });
    expect(await proposal()).toMatchObject({ status: "cancelled", resolvedAt: now });
    expect(await fixture.db.toolExecution.findMany()).toEqual(before);
    expect(await audits()).toMatchObject([{ workCapsuleId: "original-room", recordedById: null, recordedByAgentId: null,
      payload: { envelopeId: "proposal", source: "concierge-sweep" } }]);
  });

  for (const reserved of [false, true]) {
    it(`loses when a human ${reserved ? "approval and reservation" : "approval"} owns the envelope row first`, async () => {
      const held = barrier(), release = barrier(), attempted = barrier();
      const decision = fixture.db.$transaction(async tx => {
        await tx.coworkerActionEnvelope.updateMany({ where: { id: "proposal", status: "proposed", resolvedAt: null },
          data: { status: "approved" } });
        if (reserved) expect((await tx.coworkerActionEnvelope.updateMany({
          where: { id: "proposal", status: "approved", resolvedAt: null }, data: { resolvedAt: now },
        })).count).toBe(1);
        held.open(); await release.promise;
      }, { timeout: 20_000 });
      await reach(held.promise, decision);
      const withdrawal = settleObsoleteScopeReleaseEnvelopes(port(watchEnvelopeLock(attempted.open)), now);
      try {
        await reach(attempted.promise, withdrawal); release.open(); await decision;
        expect(await withdrawal).toMatchObject({ cancelled: 0 });
        expect(await proposal()).toMatchObject({ status: "approved", resolvedAt: reserved ? now : null });
        expect(await audits()).toEqual([]);
      } finally { release.open(); await Promise.allSettled([decision, withdrawal]); }
    });
  }

  it("commits cancellation before competing human approval and reservation predicates can win", async () => {
    const cancelled = barrier(), release = barrier();
    const withdrawal = settleObsoleteScopeReleaseEnvelopes(port(tx => new Proxy(tx, { get(client, key) {
      if (key === "coworkerActionEnvelope") return new Proxy(client.coworkerActionEnvelope, { get(model, method) {
        if (method === "updateMany") return async (args: any) => {
          const result = await model.updateMany(args); cancelled.open(); await release.promise; return result;
        };
        return Reflect.get(model, method);
      } });
      return Reflect.get(client, key);
    } })), now);
    await reach(cancelled.promise, withdrawal);
    // Consume Prisma's lazy promises NOW, while cancellation owns the row.
    const approval = fixture.db.coworkerActionEnvelope.updateMany({ where: { id: "proposal", status: "proposed", resolvedAt: null }, data: { status: "approved" } }).then(result => result);
    const reservation = fixture.db.coworkerActionEnvelope.updateMany({ where: { id: "proposal", status: "approved", resolvedAt: null }, data: { resolvedAt: now } }).then(result => result);
    try {
      expect((await reservation).count).toBe(0); // Still proposed in the competing snapshot.
      await waitForLockWaiter(); // The actual human approval is in flight before unlock.
      release.open(); expect(await withdrawal).toMatchObject({ cancelled: 1 });
      expect((await approval).count).toBe(0); expect((await reservation).count).toBe(0);
      expect(await audits()).toHaveLength(1);
    } finally { release.open(); await Promise.allSettled([withdrawal, approval, reservation]); }
  });

  it("rechecks the room after a newer claim commits and never releases the newer ownership", async () => {
    const held = barrier(), release = barrier(), attempted = barrier();
    // Discriminating snapshot: without the room lock this is CURRENT, not obsolete.
    await fixture.db.workroom.update({ where: { id: "original-room" }, data: { scopeClaims: [{ ...target, recordedAt: now.toISOString() }] } });
    const newer = { ...target, releaseEpoch: "00000000-0000-4000-8000-000000000002", recordedAt: now.toISOString() };
    const writer = fixture.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = 'original-room' FOR UPDATE`;
      await tx.workroom.update({ where: { id: "original-room" }, data: { scopeClaims: [newer] } }); held.open(); await release.promise;
    }, { timeout: 20_000 });
    await reach(held.promise, writer);
    const withdrawal = settleObsoleteScopeReleaseEnvelopes(port(tx => new Proxy(tx, { get(client, key) {
      if (key === "$queryRaw") return (strings: TemplateStringsArray, ...args: unknown[]) => {
        if (strings.join("").includes('FROM "WorkCapsule"') && strings.join("").includes("FOR UPDATE")) attempted.open();
        return client.$queryRaw(strings, ...args);
      };
      return Reflect.get(client, key);
    } })), now);
    try {
      await reach(attempted.promise, withdrawal); await waitForLockWaiter(); release.open(); await writer;
      expect(await withdrawal).toMatchObject({ cancelled: 1 });
      expect((await fixture.db.workroom.findUniqueOrThrow({ where: { id: "original-room" } })).scopeClaims).toEqual([newer]);
    } finally { release.open(); await Promise.allSettled([writer, withdrawal]); }
  });

  it("rolls back cancellation and audit together after the actual insert", async () => {
    const withdrawal = await settleObsoleteScopeReleaseEnvelopes(port(tx => new Proxy(tx, { get(client, key) {
      if (key === "workroomActivity") return new Proxy(client.workroomActivity, { get(model, method) {
        if (method === "create") return async (args: any) => {
          await model.create(args); throw Error("synthetic failure after audit insert");
        };
        return Reflect.get(model, method);
      } });
      return Reflect.get(client, key);
    } })), now);
    expect(withdrawal).toMatchObject({ cancelled: 0, inconclusive: 1 });
    expect(await proposal()).toMatchObject({ status: "proposed", resolvedAt: null }); expect(await audits()).toEqual([]);
  });

  it("calibrates the room-race assertion by omitting only the actual room-lock query", async () => {
    await fixture.db.workroom.update({ where: { id: "original-room" }, data: { scopeClaims: [{ ...target, recordedAt: now.toISOString() }] } });
    const held = barrier(), release = barrier();
    const writer = fixture.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = 'original-room' FOR UPDATE`;
      await tx.workroom.update({ where: { id: "original-room" }, data: { scopeClaims: [{ ...target,
        releaseEpoch: "00000000-0000-4000-8000-000000000002", recordedAt: now.toISOString() }] } });
      held.open(); await release.promise;
    }, { timeout: 20_000 });
    await reach(held.promise, writer);
    try {
      const unprotected = await settleObsoleteScopeReleaseEnvelopes(port(tx => new Proxy(tx, { get(client, key) {
        if (key === "$queryRaw") return (strings: TemplateStringsArray, ...args: unknown[]) => {
          const sql = strings.join("");
          if (sql.includes('FROM "WorkCapsule"') && sql.includes("FOR UPDATE")) return Promise.resolve([]);
          return client.$queryRaw(strings, ...args);
        };
        return Reflect.get(client, key);
      } })), now);
      // The intact race above MUST see the committed newer epoch and cancel.
      // With exactly its room lock removed, it reads the old CURRENT snapshot.
      expect(unprotected).toMatchObject({ cancelled: 0, skipped: 1 });
      expect((await proposal()).status).toBe("proposed"); expect(await audits()).toEqual([]);
    } finally { release.open(); await writer; }
  });

  it("leaves the proposal untouched when the persistent room is replaced during the wait", async () => {
    const held = barrier(), release = barrier(), attempted = barrier();
    const replacement = fixture.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = 'original-room' FOR UPDATE`;
      await tx.workroom.delete({ where: { id: "original-room" } });
      await tx.workroom.create({ data: { id: "replacement-room", capsuleId: "WC-SCOPE-PG", title: "Synthetic replacement",
        objective: "Different persistent identity", source: "synthetic-test", status: "working", scopeClaims: [] } });
      held.open(); await release.promise;
    }, { timeout: 20_000 });
    await reach(held.promise, replacement);
    const withdrawal = settleObsoleteScopeReleaseEnvelopes(port(tx => new Proxy(tx, { get(client, key) {
      if (key === "$queryRaw") return (strings: TemplateStringsArray, ...args: unknown[]) => {
        if (strings.join("").includes('FROM "WorkCapsule"') && strings.join("").includes("FOR UPDATE")) attempted.open();
        return client.$queryRaw(strings, ...args);
      };
      return Reflect.get(client, key);
    } })), now);
    try {
      await reach(attempted.promise, withdrawal); await waitForLockWaiter(); release.open(); await replacement;
      expect(await withdrawal).toMatchObject({ cancelled: 0, inconclusive: 1 });
      expect((await proposal()).status).toBe("proposed"); expect(await audits()).toEqual([]);
    } finally { release.open(); await Promise.allSettled([replacement, withdrawal]); }
  });

  it("observes a real serialized original command refusal instead of withdrawing the proposal", async () => {
    await seedProposal("original-command");
    const entered = barrier(), release = barrier(), attempted = barrier();
    let transactionNumber = 0;
    const commandDb = { $transaction: (run: any) => {
      const current = ++transactionNumber;
      return fixture.db.$transaction(tx => run(new Proxy(tx, { get(client, key) {
        if (key === "$executeRaw") return async (strings: TemplateStringsArray, ...args: unknown[]) => {
          const result = await client.$executeRaw(strings, ...args);
          if (current === 2 && strings.join("").includes("pg_advisory_xact_lock")) {
            entered.open(); await release.promise;
          }
          return result;
        };
        return Reflect.get(client, key);
      } })), { timeout: 20_000 });
    } };
    const command = runReceiptedCommand({ db: commandDb as unknown as ReceiptDb,
      authorityScopeKey: commandAuthorityScopeKey(actor), commandId: "original-command", commandType: "release-scope",
      target: { kind: "workroom", id: original.capsuleId }, expectedRoomRowId: original.expectedRoomId,
      payloadBinding: commandPayloadBinding(original), actor,
      run: tx => releaseWorkCapsuleScope({ db: tx as unknown as CapsuleDb, ...original, actor, now }),
      rejectionOf: error => error instanceof Error && error.message.includes("Original scope-release target")
        ? { code: "scope-target-stale", message: error.message } : null });
    // Attach the expected refusal before another transport waits on its locks.
    const refused = expect(command).rejects.toThrow("Original scope-release target");
    await reach(entered.promise, command.catch(() => undefined));
    const withdrawal = settleObsoleteScopeReleaseEnvelopes(port(tx => new Proxy(tx, { get(client, key) {
      if (key === "$executeRaw") return (strings: TemplateStringsArray, ...args: unknown[]) => {
        if (strings.join("").includes("pg_advisory_xact_lock")) attempted.open();
        return client.$executeRaw(strings, ...args);
      };
      return Reflect.get(client, key);
    } })), now);
    try {
      await reach(attempted.promise, withdrawal); release.open(); await refused;
      expect(await withdrawal).toMatchObject({ cancelled: 0 }); expect((await proposal()).status).toBe("proposed");
      expect(await audits()).toEqual([]);
      expect(await fixture.db.workroomActivity.count({ where: { kind: "command-rejected" } })).toBe(1);
    } finally { release.open(); await Promise.allSettled([command, withdrawal, refused]); }
  });
});
