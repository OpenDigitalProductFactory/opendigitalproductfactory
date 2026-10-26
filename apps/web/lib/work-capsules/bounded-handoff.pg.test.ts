/** Real receipt + protocol + lease writers; isolated schema in canonical CI/disposable jobs DB.
 * Canonical admission is separately tested; this fixture supplies a fixed already-admitted roster.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseClient } from "@dpf/db";
import { createHandoffDependencyPostgresFixture } from "../../../../packages/db/src/handoff-dependency-postgres-fixture";
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn(), revalidatePortalContextForCapsule: vi.fn() }));
const fixture = vi.hoisted(() => ({ prisma: null as any, nestedTransactions: 0, telemetry: new Set<Promise<void>>(), afterEnvironmentLocks: undefined as (() => Promise<void>) | undefined, onReceiptTransaction: undefined as ((tx: ReceiptDb) => Promise<void>) | undefined, onExemptionTransaction: undefined as ((tx: RawTx) => Promise<void>) | undefined, beforeTransfer: undefined as ((tx: RawTx) => Promise<void>) | undefined, beforeEvidenceRead: undefined as (() => Promise<void>) | undefined, beforeEvidenceInsert: undefined as ((tx: RawTx) => Promise<void>) | undefined }));
vi.mock("@dpf/db", async (original) => ({ ...await original<typeof import("@dpf/db")>(), get prisma() { return fixture.prisma; } }));
vi.mock("@/lib/queue/queue-telemetry", async (original) => {
  const actual = await original<typeof import("@/lib/queue/queue-telemetry")>();
  return { ...actual, recordQueueTransition: (...args: Parameters<typeof actual.recordQueueTransition>) => {
    const pending = actual.recordQueueTransition(...args);
    fixture.telemetry.add(pending);
    void pending.finally(() => fixture.telemetry.delete(pending));
    return pending;
  } };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/install/environment-class", () => ({ loadEnvironmentClassResolution: async () => ({ environmentClass: "development" }) }));
vi.mock("@/lib/installation-journey/operating-intent", () => ({ loadInstallationOperatingIntent: async () => ({ status: "valid", intent: { primaryPurpose: "evolve-dpf" } }) }));
vi.mock("@/lib/coworker/human-approved-execution", () => ({ humanApprovalForExecution: async () => ({ envelopeId: "approved-fixture", userId: "owner", approverUserId: "owner", onBehalfOf: null }) }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ APPROVED_EXTERNAL_ROLES: ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"] }));
vi.mock("@/lib/work-management/workroom-agent-access.server", async (original) => ({
  ...await original<typeof import("@/lib/work-management/workroom-agent-access.server")>(),
  resolveAgentWorkroomAccess: async ({ agentId }: { agentId: string }, db: CapsuleDb) => {
    const id = agentId === "AGT-EXT-CLAUDE" ? "claude" : "codex";
    return { decision: { level: "action" }, authorityContext: { humanPrincipal: { id: "human", principalId: "PRN-human" }, agentPrincipal: { id, principalId: "PRN-" + id }, sensitivityCeiling: "internal",
      room: { ...await db.workroom.findUnique({ where: { capsuleId: "WC-1" } }), participants: [{ principalId: "human", roles: ["coordinator"], lifecycle: "active", principal: { kind: "human" } }, ...["claude", "codex"].map((principalId) => ({ principalId, roles: ["contributor"], lifecycle: "active" }))], workItem: null } } };
  },
}));
import type { ReceiptDb } from "./command-receipts";
import { commandDb, hasBoundCommandTransaction, receiptedWorkroomTool } from "./receipted-tool";
import { prepareBoundedHandoff } from "./bounded-handoff-tool";
import { recordSemanticReviewExemption } from "../change-review/semantic-review-policy-exemption";
import { lockAllNonprodEnvironments, NONPROD_ENVIRONMENT_KEYS, type NonprodEnvironmentKey } from "../nonprod/environment-lease-lock";
import { claimNonprodEnvironmentLease, releaseNonprodEnvironmentLease, renewNonprodEnvironmentLease } from "../nonprod/environment-lease";
import { reassignCapsuleExecutor } from "./reassign-executor-handler";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
import type { ToolResult } from "@/lib/mcp-tool-types";
const configured = process.env.DATABASE_URL?.trim() ?? "";
const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || (() => { try { return /^\/dpf_local_ci_[01]$/.test(new URL(configured).pathname) ? configured : ""; } catch { return ""; } })();
const SCHEMA = "dpf_handoff_dependency_" + randomUUID().replaceAll("-", "");
type RawTx = Pick<ReturnType<typeof createDatabaseClient>, "$queryRaw" | "$executeRaw" | "$transaction">;
const source: WorkCapsuleActor = { userId: "owner", principalId: "human", agentId: "AGT-EXT-CLAUDE", agentPrincipalId: "claude" };
const receiver: WorkCapsuleActor = { ...source, agentId: "AGT-EXT-CODEX", agentPrincipalId: "codex" };
const request = { phase: "request", commandId: "request-1", capsuleId: "WC-1", expectedLeaseHolderPrincipalId: "human", expectedExecutorKind: "claude-desktop", expectedExecutorRef: "source-chat", targetAgentId: "AGT-EXT-CODEX", toExecutorKind: "codex-desktop", toExecutorRef: "receiver-chat", handoffManifest: { nextAction: "Continue" } };
const ack = (requestId: string, commandId: string) => ({ phase: "acknowledge", capsuleId: "WC-1", commandId, requestId });
const HEAD = "a".repeat(40), TREE = "b".repeat(40), DIFF = "c".repeat(64);
const waiver = () => ({ capsuleId: "WC-1", sourceHeadSha: HEAD, baseTreeHash: "d".repeat(40), headTreeHash: TREE, diffDigest: DIFF, reason: "Approved test fixture for a bounded publication exception.", expiresAt: new Date(Date.now() + 600_000).toISOString(), verificationEvidenceId: "ci", clientAssessmentActivityId: "review", reviewBasis: "operator-accepted-client-assessment" });
const operator = { userContext: { userId: "owner", platformRole: "HR-000", isSuperuser: false }, agentId: "AGT-EXT-CLAUDE", approvedAuthorityEnvelopeId: "approved-fixture" };
type FixtureLeaseRow = { leaseId: string; ownerSessionId: string; status: string; environmentKey: string };
type FixtureLeaseQuery = { where: { ownerSessionId: { in: string[] }; status: { notIn: string[] } } };
function port(tx: RawTx): ReceiptDb & CapsuleDb & { workroomActivity: CapsuleDb["workroomActivity"] & { findUnique(args?: unknown): Promise<unknown> }; externalEvidenceRecord: any; nonProductionEnvironmentLease: any; platformConfig: any } {
  return {
    $queryRaw: tx.$queryRaw.bind(tx), $executeRaw: tx.$executeRaw.bind(tx),
    // Preserve Prisma's actual nested transaction shape and savepoint semantics.
    $transaction: <T>(work: (nested: ReceiptDb & CapsuleDb) => Promise<T>) => tx.$transaction(async (nested) => {
      fixture.nestedTransactions += 1;
      return work(port(nested));
    }),
    workroom: { async findUnique(args: any) { const rows = await tx.$queryRaw<any[]>`SELECT * FROM "WorkCapsule" WHERE "capsuleId" = ${args.where.capsuleId ?? null} OR id = ${args.where.id ?? null}`; return rows[0] ?? null; },
      async update({ where, data }: any) { await fixture.beforeTransfer?.(tx); const rows = await tx.$queryRaw<any[]>`UPDATE "WorkCapsule" SET "executorKind" = ${data.executorKind}, "executorRef" = ${data.executorRef}, "leaseHolderPrincipalId" = ${data.leaseHolderPrincipalId}, "leaseExpiresAt" = ${data.leaseExpiresAt}, transfers = transfers + 1 WHERE "capsuleId" = ${where.capsuleId} RETURNING *`; return rows[0]; },
      create: async () => { throw new Error("Unused fixture port"); }, findMany: async () => [], findFirst: async () => null,
    },
    platformConfig: { findUnique: async () => null },
    nonProductionEnvironmentLease: {
      async findFirst(args: unknown): Promise<FixtureLeaseRow | null> {
        const { where } = args as FixtureLeaseQuery;
        const rows = await tx.$queryRaw<FixtureLeaseRow[]>`SELECT * FROM "NonProductionEnvironmentLease" WHERE "ownerSessionId" = ANY(${where.ownerSessionId.in}::text[]) AND status <> ALL(${where.status.notIn}::text[]) LIMIT 1`;
        return rows[0] ?? null;
      },
      async findMany(args: unknown): Promise<FixtureLeaseRow[]> {
        const { where } = args as FixtureLeaseQuery;
        return tx.$queryRaw<FixtureLeaseRow[]>`SELECT * FROM "NonProductionEnvironmentLease" WHERE "ownerSessionId" = ANY(${where.ownerSessionId.in}::text[]) AND status <> ALL(${where.status.notIn}::text[]) ORDER BY "leaseId"`;
      },
    },
    externalEvidenceRecord: {
      findFirst: async () => null,
      async findUnique() { await fixture.beforeEvidenceRead?.(); return { id: "ci", workCapsuleId: "row-1", operationType: "local_integration_ci", details: { status: "passed", gateKey: "gate-fixture", leaseId: "lease-fixture", evidenceValidity: { expiresAt: waiver().expiresAt }, evidence: { sha: HEAD, headTreeHash: TREE, diffDigest: DIFF, gatePassed: true, commands: ["test-fixture"], output: "Fixture checks passed", completedAt: new Date().toISOString() } } }; },
      async findMany({ where, take }: any) { return tx.$queryRaw<any[]>`SELECT * FROM "ExternalEvidenceRecord" WHERE "workCapsuleId" = ${where.workCapsuleId} AND "operationType" = ${where.operationType} AND details->>'sourceHeadSha' = ${where.details.path ? where.details.equals : HEAD} ORDER BY id LIMIT ${take}`; },
      async create({ data }: any) { await fixture.beforeEvidenceInsert?.(tx); const id = randomUUID(); await tx.$executeRaw`INSERT INTO "ExternalEvidenceRecord" (id, "workCapsuleId", "operationType", details) VALUES (${id}, ${data.workCapsuleId}, ${data.operationType}, ${JSON.stringify(data.details)}::jsonb)`; return { id, ...data }; },
    }, workroomActivity: {
      async findUnique() { return { id: "review", workCapsuleId: "row-1", kind: "evidence-recorded", recordedById: "owner", recordedByAgentId: "reviewer-fixture", payload: { result: { capsuleId: "WC-1", sourceHeadSha: HEAD, headTreeHash: TREE, diffDigest: DIFF, decision: "pass", rationale: "Independent fixture review covered the source and failure paths." } } }; },
      async findFirst({ where }: any) {
        if (where.commandScopeKey) { const rows = await tx.$queryRaw<any[]>`SELECT * FROM "WorkCapsuleActivity" WHERE "commandScopeKey" = ${where.commandScopeKey} AND "commandKey" = ${where.commandKey}`; return rows[0] ?? null; }
        if (where.id) { const rows = await tx.$queryRaw<any[]>`SELECT * FROM "WorkCapsuleActivity" WHERE id = ${where.id} AND "workCapsuleId" = ${where.workCapsuleId} AND kind = ${where.kind}`; return rows[0] ?? null; }
        const original = where.AND.find((part: any) => part.payload.path.at(-1) === "approvalId");
        if (original) {
          const executionId = where.AND.find((part: any) => part.payload.path.at(-1) === "executionId").payload.equals;
          const rows = await tx.$queryRaw<any[]>`SELECT * FROM "WorkCapsuleActivity" WHERE "workCapsuleId" = ${where.workCapsuleId} AND kind = 'action' AND payload->>'kind' = 'bounded-handoff' AND payload->>'state' = 'pending-acknowledgement' AND payload #>> '{request,command,handoffManifest,priorFailure,approvalId}' = ${original.payload.equals} AND payload #>> '{request,command,handoffManifest,priorFailure,executionId}' = ${executionId} ORDER BY "recordedAt" DESC,id DESC LIMIT 1`;
          return rows[0] ?? null;
        }
        const requestId = where.AND.find((part: any) => part.payload.path[0] === "requestId").payload.equals;
        const rows = await tx.$queryRaw<any[]>`SELECT * FROM "WorkCapsuleActivity" WHERE "workCapsuleId" = ${where.workCapsuleId} AND kind = 'action' AND payload->>'kind' = 'bounded-handoff' AND payload->>'state' = 'completed' AND payload->>'requestId' = ${requestId}`; return rows[0] ?? null;
      },
      async create({ data }: any) {
        const id = data.id ?? randomUUID();
        await tx.$executeRaw`INSERT INTO "WorkCapsuleActivity" (id, "workCapsuleId", kind, summary, payload, "recordedById", "recordedByAgentId", "commandScopeKey", "commandKey") VALUES (${id}, ${data.workCapsuleId}, ${data.kind}, ${data.summary}, ${JSON.stringify(data.payload)}::jsonb, ${data.recordedById ?? null}, ${data.recordedByAgentId ?? null}, ${data.commandScopeKey ?? null}, ${data.commandKey ?? null})`;
        return { ...data, id };
      },
    },
  };
}
describe.skipIf(!DATABASE_URL)("bounded handoff transaction protocol (PostgreSQL)", () => {
  let pool: Pool; let prisma: ReturnType<typeof createHandoffDependencyPostgresFixture>["prisma"];
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: "-c search_path=" + SCHEMA });
    await pool.query('CREATE SCHEMA "' + SCHEMA + '"');
    prisma = createHandoffDependencyPostgresFixture(DATABASE_URL, SCHEMA).prisma;
    // Empty structures from the already-migrated disposable database, never its rows.
    for (const table of ["NonProductionEnvironmentLease", "QueueTelemetryEvent", "PlatformConfig", "TaskRun"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await pool.query(`CREATE TABLE "WorkCapsule" (id TEXT PRIMARY KEY, "capsuleId" TEXT UNIQUE, "executorKind" TEXT, "executorRef" TEXT, "leaseHolderPrincipalId" TEXT, "leaseExpiresAt" TIMESTAMP(3), "featureBuildId" TEXT, "createdByPrincipalId" TEXT, "requestedByPrincipalId" TEXT, transfers INT DEFAULT 0, "headSha" TEXT, "repositoryFullName" TEXT, "headBranch" TEXT);
      CREATE TABLE "WorkCapsuleActivity" (id TEXT PRIMARY KEY, "workCapsuleId" TEXT REFERENCES "WorkCapsule"(id), kind TEXT, summary TEXT, payload JSONB, "recordedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "recordedById" TEXT, "recordedByAgentId" TEXT, "commandScopeKey" TEXT, "commandKey" TEXT, UNIQUE("commandScopeKey", "commandKey"));
      CREATE TABLE "ExternalEvidenceRecord" (id TEXT PRIMARY KEY, "workCapsuleId" TEXT, "operationType" TEXT, details JSONB);
      CREATE TABLE "Agent" (id TEXT PRIMARY KEY, "agentId" TEXT); CREATE TABLE "BacklogItem" (id TEXT PRIMARY KEY, "itemId" TEXT);
      CREATE TABLE "Principal" (id TEXT PRIMARY KEY); CREATE TABLE "PrincipalAlias" (id TEXT PRIMARY KEY, "principalId" TEXT, issuer TEXT, "aliasType" TEXT, "aliasValue" TEXT);
      CREATE TABLE "User" (id TEXT PRIMARY KEY); CREATE TABLE "WorkItem" (id TEXT PRIMARY KEY); CREATE TABLE "WorkCapsuleParticipant" (id TEXT PRIMARY KEY, "workroomId" TEXT);`);
  });
  afterAll(async () => { while (fixture.telemetry.size) await Promise.all([...fixture.telemetry]); await prisma?.$disconnect(); if (pool) { try { await pool.query('DROP SCHEMA IF EXISTS "' + SCHEMA + '" CASCADE'); } finally { await pool.end(); } } });
  beforeEach(async () => { while (fixture.telemetry.size) await Promise.all([...fixture.telemetry]); fixture.nestedTransactions = 0; fixture.afterEnvironmentLocks = undefined; fixture.onReceiptTransaction = undefined; fixture.onExemptionTransaction = undefined; fixture.beforeTransfer = undefined; fixture.beforeEvidenceRead = undefined; fixture.beforeEvidenceInsert = undefined; fixture.prisma = { ...port(prisma), queueTelemetryEvent: prisma.queueTelemetryEvent, $transaction: (fn: any, options: any) => prisma.$transaction(async (tx) => { await fixture.onExemptionTransaction?.(tx); return fn(port(tx)); }, options) }; await pool.query(`TRUNCATE "WorkCapsuleActivity", "NonProductionEnvironmentLease", "ExternalEvidenceRecord", "QueueTelemetryEvent", "TaskRun", "PlatformConfig"; DELETE FROM "WorkCapsule"; INSERT INTO "WorkCapsule" (id, "capsuleId", "executorKind", "executorRef", "leaseHolderPrincipalId", "leaseExpiresAt", "createdByPrincipalId", "requestedByPrincipalId") VALUES ('row-1','WC-1','claude-desktop','source-chat','human',clock_timestamp()+interval '30 minutes','human','human'); UPDATE "WorkCapsule" SET "headSha"='${HEAD}', "repositoryFullName"='owner/repo', "headBranch"='fix/topic'`); });
  async function call(params: Record<string, unknown>, actor = source, candidate?: CapsuleDb): Promise<ToolResult> {
    const tool = receiptedWorkroomTool("reassign-executor", async (normalized) => {
      const active = commandDb();
      expect(hasBoundCommandTransaction(active)).toBe(true);
      expect(active.$transaction).toBeTypeOf("function");
      return reassignCapsuleExecutor({ params: normalized, db: candidate ?? active, resolveActor: async () => actor });
    }, { prepare: (raw) => {
      const prepared = prepareBoundedHandoff(raw);
      if (!prepared || "refusal" in prepared) return prepared;
      return { ...prepared, beforeRoomLock: async (tx) => {
        await fixture.onReceiptTransaction?.(tx);
        await prepared.beforeRoomLock?.(tx);
        await fixture.afterEnvironmentLocks?.();
      } };
    } });
    return tool(params, actor.userId, { agentId: actor.agentId ?? undefined });
  }
  async function pending(commandId = "request-1") { const result = await call({ ...request, commandId }); expect(result.success).toBe(true); return (result.data as any).handoff.requestId as string; }
  it("joins the real savepoint-capable Prisma client to the bound receipt wrapper", async () => {
    await prisma.$transaction(async (tx) => {
      expect(tx.$transaction).toBeTypeOf("function");
      expect(tx.$queryRaw).toBeTypeOf("function");
    });
    const before = (await pool.query('SELECT "executorRef","leaseHolderPrincipalId","leaseExpiresAt",transfers FROM "WorkCapsule"')).rows[0];
    const result = await call(request);
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ success: true, data: { handoff: { state: "pending-acknowledgement" } } });
    expect((await pool.query('SELECT "executorRef","leaseHolderPrincipalId","leaseExpiresAt",transfers FROM "WorkCapsule"')).rows[0]).toEqual(before);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='command-accepted'`)).rows[0].n).toBe(1);
    expect(fixture.nestedTransactions).toBe(0);
  });
  it("refuses direct handler execution before authority reads", async () => {
    const candidate = port(prisma); const read = vi.spyOn(candidate.workroom, "findUnique");
    expect(await reassignCapsuleExecutor({ params: request, db: candidate, resolveActor: async () => source }))
      .toMatchObject({ success: false, error: "handoff-transaction-required" });
    expect(read).not.toHaveBeenCalled();
    expect((await pool.query('SELECT count(*)::int AS n FROM "WorkCapsuleActivity"')).rows[0].n).toBe(0);
  });
  it.each(["root", "foreign"] as const)("refuses the %s client inside an otherwise valid receipt", async (kind) => {
    const candidate = kind === "root" ? fixture.prisma : port(prisma);
    const read = vi.spyOn(candidate.workroom, "findUnique");
    expect(await call(request, source, candidate)).toMatchObject({ success: false, error: "handoff-transaction-required" });
    expect(read).not.toHaveBeenCalled();
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='command-accepted'`)).rows[0].n).toBe(0);
  });
  it("preserves a controlled pre-effect refusal while a fresh ordinary command transfers once", async () => {
    const rejected = { ...request, commandId: "controlled-old-refusal" };
    const refuse = receiptedWorkroomTool("reassign-executor", async () => ({
      success: false, error: "handoff-transaction-required", message: "Controlled pre-effect fixture refusal",
    }), { prepare: prepareBoundedHandoff });
    expect(await refuse(rejected, source.userId, { agentId: source.agentId ?? undefined }))
      .toMatchObject({ success: false, error: "handoff-transaction-required" });
    const before = (await pool.query('SELECT "executorKind","executorRef","leaseHolderPrincipalId","leaseExpiresAt",transfers FROM "WorkCapsule"')).rows[0];
    expect(await call(rejected)).toMatchObject({ success: false, error: "handoff-transaction-required" });
    expect((await pool.query('SELECT "executorKind","executorRef","leaseHolderPrincipalId","leaseExpiresAt",transfers FROM "WorkCapsule"')).rows[0]).toEqual(before);
    const fresh = await call({ ...request, commandId: "fresh-ordinary-request" });
    expect(fresh).toMatchObject({ success: true, data: { handoff: { state: "pending-acknowledgement" } } });
    const id = (fresh.data as any).handoff.requestId as string;
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
    expect(await call(ack(id,"fresh-ordinary-ack"),receiver)).toMatchObject({ success: true });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='command-rejected' AND "commandKey"='controlled-old-refusal'`)).rows[0].n).toBe(1);
    expect(await call(rejected)).toMatchObject({ success: false, error: "handoff-transaction-required" });
  });
  it("keeps request pending and transfers once for concurrent receiver acknowledgements", async () => {
    const id = await pending(); expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
    const results = await Promise.all([call(ack(id,"ack-a"),receiver),call(ack(id,"ack-b"),receiver),call(ack(id,"ack-a"),receiver)]);
    expect(results.every((result) => result.success)).toBe(true);
    expect((await pool.query('SELECT transfers,"leaseHolderPrincipalId" FROM "WorkCapsule"')).rows[0]).toEqual({ transfers: 1, leaseHolderPrincipalId: "human" });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='executor-changed'`)).rows[0].n).toBe(1);
    expect(fixture.nestedTransactions).toBe(1);
  });
  it("serializes stale recovery previews into one actual pending request", async () => {
    const priorFailure = { approvalId: "original-refusal", executionId: "original-execution", reason: "handoff-transaction-required", preserve: true };
    const a = { ...request, commandId: "recovery-preview-a", handoffManifest: { ...request.handoffManifest, priorFailure } };
    const b = { ...a, commandId: "recovery-preview-b" };
    const results = await Promise.all([call(a), call(b)]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results.find(result => !result.success)).toMatchObject({ error: "handoff-recovery-already-requested" });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='action' AND payload->>'state'='pending-acknowledgement'`)).rows[0].n).toBe(1);
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
    const winner = results[0].success ? a : b;
    expect(await call(winner)).toEqual(results.find(result => result.success));
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='command-accepted'`)).rows[0].n).toBe(1);
  });
  it("serializes competing requests and refuses the losing snapshot", async () => {
    const [a,b] = await Promise.all([pending("request-a"),pending("request-b")]);
    const results = await Promise.all([call(ack(a,"ack-a"),receiver),call(ack(b,"ack-b"),receiver)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)[0]).toMatchObject({ error: "handoff-lease-snapshot-changed" });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(1);
  });
  it("a real lease renewal invalidates the pending snapshot without transfer", async () => {
    const id = await pending(); await prisma.$executeRaw`UPDATE "WorkCapsule" SET "leaseExpiresAt" = "leaseExpiresAt" + interval '1 minute' WHERE "capsuleId" = 'WC-1'`;
    expect(await call(ack(id,"ack-renewed"),receiver)).toMatchObject({ success: false, error: "handoff-lease-snapshot-changed" });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
  });


  function signal<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
  async function backendPid(tx: Pick<ReceiptDb, "$queryRaw">) {
    if (!tx.$queryRaw) throw new Error("PID diagnostics require the actual transaction");
    const rows = await tx.$queryRaw`SELECT pg_backend_pid() AS pid` as Array<{ pid: number }>;
    return rows[0].pid;
  }
  async function waitForBlockedBy(waiter: number, holder: number) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const observed = await pool.query<{ blocking: number[] }>("SELECT pg_blocking_pids($1) AS blocking", [waiter]);
      if (observed.rows[0]?.blocking.includes(holder)) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error("PostgreSQL did not observe process " + waiter + " waiting for " + holder);
  }
  type LeaseTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  type LeaseTransactionOptions = Parameters<typeof prisma.$transaction>[1];
  function leaseDb(hooks: {
    started?: (tx: LeaseTransaction) => Promise<void>;
    beforeCommit?: (tx: LeaseTransaction) => Promise<void>;
  } = {}): typeof prisma {
    // Observe the real allocator transaction; do not replace its lock or mutation.
    return new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === "$transaction") {
          return <T>(body: (tx: LeaseTransaction) => Promise<T>, options?: LeaseTransactionOptions) =>
            target.$transaction(async (tx) => {
              await hooks.started?.(tx);
              const result = await body(tx);
              await hooks.beforeCommit?.(tx);
              return result;
            }, options);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  function leaseInput(environmentKey: NonprodEnvironmentKey, ownerSessionId = "source-chat", claimKey = `pg-claim:${randomUUID()}`): Parameters<typeof claimNonprodEnvironmentLease>[0] {
    return { db: prisma, environmentKey, ownerProvider: "codex", ownerSessionId, claimKey,
      purpose: "Isolated PostgreSQL handoff race", url: "http://fixture.invalid", ports: [],
      expiresAt: new Date(Date.now() + 600_000),
      ...(environmentKey === "host-heavy-resource" ? { resourceClass: "typescript", expectedMemoryBytes: 6 * 1024 ** 3,
        ownerProcessId: 123, ownerProcessIdentity: "fixture-process", hostResource: {
          totalMemoryBytes: 128 * 1024 ** 3, availableMemoryBytes: 64 * 1024 ** 3, inferenceResident: false,
        } } : {}),
    };
  }
  it.each(NONPROD_ENVIRONMENT_KEYS)("observes actual %s allocation committed before the handoff fence", async (environmentKey) => {
    const locked = signal<number>(), waiting = signal<number>(), release = signal();
    fixture.onReceiptTransaction = async (tx) => { waiting.resolve(await backendPid(tx)); };
    const allocation = claimNonprodEnvironmentLease({ ...leaseInput(environmentKey), db: leaseDb({ beforeCommit: async (tx) => {
      locked.resolve(await backendPid(tx)); await release.promise;
    } }) });
    const holder = await locked.promise; const handoff = call(request);
    try { await waitForBlockedBy(await waiting.promise, holder); } finally { release.resolve(); }
    expect(await allocation).toMatchObject({ status: "admitted" });
    expect(await handoff).toMatchObject({ success: false, error: "handoff-lease-dependency" });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
  });
  it("refuses a handoff after actual exemption publication wins the room fence", async () => {
    const locked = signal<number>(), waiting = signal<number>(), release = signal();
    fixture.beforeEvidenceInsert = async (tx) => { locked.resolve(await backendPid(tx)); await release.promise; };
    fixture.onReceiptTransaction = async (tx) => { waiting.resolve(await backendPid(tx)); };
    const publication = recordSemanticReviewExemption(waiver(), "owner", operator); const holder = await locked.promise;
    const handoff = call(request);
    try { await waitForBlockedBy(await waiting.promise, holder); } finally { release.resolve(); }
    expect((await publication).success).toBe(true); expect(await handoff).toMatchObject({ success: false, error: "handoff-policy-exemption-dependency" });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
  });
  it("refuses stale actual exemption publication when receiver acknowledgement wins", async () => {
    const id = await pending(); const prepared = signal(), releasePreparation = signal(), held = signal<number>(), waiting = signal<number>(), releaseTransfer = signal();
    fixture.beforeEvidenceRead = async () => { prepared.resolve(); await releasePreparation.promise; };
    fixture.beforeTransfer = async (tx) => { held.resolve(await backendPid(tx)); await releaseTransfer.promise; };
    const publication = recordSemanticReviewExemption(waiver(), "owner", operator); await prepared.promise;
    const handoff = call(ack(id,"ack-before-exemption"),receiver); const holder = await held.promise;
    // The real receipt wrapper also uses the shared root transaction; observe only the later publication.
    fixture.onExemptionTransaction = async (tx) => { waiting.resolve(await backendPid(tx)); };
    releasePreparation.resolve();
    try { await waitForBlockedBy(await waiting.promise, holder); } finally { releaseTransfer.resolve(); }
    expect(await handoff).toMatchObject({ success: true }); expect(await publication).toMatchObject({ success: false, error: "review_exemption_refused" });
    expect((await pool.query('SELECT count(*)::int AS n FROM "ExternalEvidenceRecord"')).rows[0].n).toBe(0);
  });
  it.each(NONPROD_ENVIRONMENT_KEYS)("keeps later actual %s allocation separate from a completed handoff", async (environmentKey) => {
    const id = await pending(); const locked = signal<number>(), waiting = signal<number>(), release = signal();
    fixture.beforeTransfer = async (tx) => { locked.resolve(await backendPid(tx)); await release.promise; };
    const handoff = call(ack(id,"ack-first"),receiver); const holder = await locked.promise;
    const allocation = claimNonprodEnvironmentLease({ ...leaseInput(environmentKey), db: leaseDb({ started: async (tx) => { waiting.resolve(await backendPid(tx)); } }) });
    try { await waitForBlockedBy(await waiting.promise, holder); } finally { release.resolve(); }
    expect((await handoff).success).toBe(true);
    expect(await allocation).toMatchObject({ status: "admitted", lease: { ownerSessionId: "source-chat" } });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(1);
  });
  it.each(["lease-first", "handoff-first"] as const)("serializes actual terminal gate resumption (%s)", async (order) => {
    const input = leaseInput("local-integration-ci", "source-chat", `gate:${"e".repeat(64)}`);
    const initial = await claimNonprodEnvironmentLease(input);
    expect(initial.status).toBe("admitted");
    await releaseNonprodEnvironmentLease({ db: prisma, leaseId: initial.lease.leaseId, ownerSessionId: "source-chat" });
    const id = await pending();
    const held = signal<number>(), waiting = signal<number>(), release = signal();
    let resumed: ReturnType<typeof claimNonprodEnvironmentLease>;
    let handoff: ReturnType<typeof call>;
    if (order === "lease-first") {
      fixture.onReceiptTransaction = async (tx) => { waiting.resolve(await backendPid(tx)); };
      resumed = claimNonprodEnvironmentLease({ ...input, resumeLeaseId: initial.lease.leaseId,
        db: leaseDb({ beforeCommit: async (tx) => { held.resolve(await backendPid(tx)); await release.promise; } }) });
      const holder = await held.promise; handoff = call(ack(id,"ack-terminal"),receiver);
      try { await waitForBlockedBy(await waiting.promise, holder); } finally { release.resolve(); }
    } else {
      fixture.beforeTransfer = async (tx) => { held.resolve(await backendPid(tx)); await release.promise; };
      handoff = call(ack(id,"ack-terminal"),receiver); const holder = await held.promise;
      resumed = claimNonprodEnvironmentLease({ ...input, resumeLeaseId: initial.lease.leaseId,
        db: leaseDb({ started: async (tx) => { waiting.resolve(await backendPid(tx)); } }) });
      try { await waitForBlockedBy(await waiting.promise, holder); } finally { release.resolve(); }
    }
    expect(await resumed).toMatchObject({ status: "admitted", lease: { leaseId: initial.lease.leaseId, ownerSessionId: "source-chat" } });
    expect(await handoff).toMatchObject(order === "lease-first"
      ? { success: false, error: "handoff-lease-dependency" } : { success: true });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(order === "lease-first" ? 0 : 1);
  });
  it.each(["release-first", "handoff-first"] as const)("keeps a queued dependency protected through actual release and admission (%s)", async (order) => {
    const id = await pending();
    const occupant = await claimNonprodEnvironmentLease(leaseInput("active-candidate", "unrelated-session"));
    const queued = await claimNonprodEnvironmentLease(leaseInput("active-candidate"));
    expect(occupant.status).toBe("admitted"); expect(queued.status).toBe("queued");
    const held = signal<number>(), waiting = signal<number>(), release = signal();
    let released: ReturnType<typeof releaseNonprodEnvironmentLease>;
    let handoff: ReturnType<typeof call>;
    if (order === "release-first") {
      fixture.onReceiptTransaction = async (tx) => { waiting.resolve(await backendPid(tx)); };
      released = releaseNonprodEnvironmentLease({ leaseId: occupant.lease.leaseId,
        db: leaseDb({ beforeCommit: async (tx) => { held.resolve(await backendPid(tx)); await release.promise; } }) });
      const holder = await held.promise; handoff = call(ack(id,"ack-queued"),receiver);
      try { await waitForBlockedBy(await waiting.promise, holder); } finally { release.resolve(); }
    } else {
      let handoffPid = 0;
      fixture.onReceiptTransaction = async (tx) => { handoffPid = await backendPid(tx); };
      fixture.afterEnvironmentLocks = async () => { held.resolve(handoffPid); await release.promise; };
      handoff = call(ack(id,"ack-queued"),receiver); const holder = await held.promise;
      released = releaseNonprodEnvironmentLease({ leaseId: occupant.lease.leaseId,
        db: leaseDb({ started: async (tx) => { waiting.resolve(await backendPid(tx)); } }) });
      try { await waitForBlockedBy(await waiting.promise, holder); } finally { release.resolve(); }
    }
    expect(await released).toMatchObject({ status: "released" });
    expect(await handoff).toMatchObject({ success: false, error: "handoff-lease-dependency" });
    expect(await prisma.nonProductionEnvironmentLease.findUnique({ where: { leaseId: queued.lease.leaseId } }))
      .toMatchObject({ status: "active", ownerSessionId: "source-chat" });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
  });
  it.each(["renew-first", "concurrent"] as const)("refuses an existing dependency across actual renewal (%s)", async (order) => {
    const id = await pending();
    const lease = await claimNonprodEnvironmentLease(leaseInput("active-candidate"));
    expect(lease.status).toBe("admitted");
    const renew = () => renewNonprodEnvironmentLease({ db: prisma, leaseId: lease.lease.leaseId,
      ownerSessionId: "source-chat", ttlMs: 600_000 });
    const [renewal, handoff] = order === "renew-first"
      ? [await renew(), await call(ack(id,"ack-renew-resource"),receiver)]
      : await Promise.all([renew(), call(ack(id,"ack-renew-resource"),receiver)]);
    expect(renewal).toMatchObject({ status: "renewed" });
    expect(handoff).toMatchObject({ success: false, error: "handoff-lease-dependency" });
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(0);
  });
  it("rolls back the transfer when durable completion publication fails", async () => {
    const id = await pending();
    const before = (await pool.query('SELECT "executorKind","executorRef","leaseHolderPrincipalId","leaseExpiresAt",transfers FROM "WorkCapsule"')).rows[0];
    await pool.query(`ALTER TABLE "WorkCapsuleActivity" ADD CONSTRAINT reject_completion CHECK (payload->>'state' IS DISTINCT FROM 'completed')`);
    try {
      expect((await call(ack(id,"ack-failed-write"),receiver)).success).toBe(false);
      expect(fixture.nestedTransactions).toBe(1); // The lease savepoint committed before outer publication failed.
      expect((await pool.query('SELECT "executorKind","executorRef","leaseHolderPrincipalId","leaseExpiresAt",transfers FROM "WorkCapsule"')).rows[0]).toEqual(before);
      expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='command-accepted' AND "commandKey"='ack-failed-write'`)).rows[0].n).toBe(0);
      expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='executor-changed'`)).rows[0].n).toBe(0);
      expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind='command-rejected'`)).rows[0].n).toBe(1);
    } finally { await pool.query('ALTER TABLE "WorkCapsuleActivity" DROP CONSTRAINT reject_completion'); }
    expect((await call(ack(id,"ack-new-after-repair"),receiver)).success).toBe(true);
    expect((await pool.query('SELECT transfers FROM "WorkCapsule"')).rows[0].transfers).toBe(1);
  });
});
