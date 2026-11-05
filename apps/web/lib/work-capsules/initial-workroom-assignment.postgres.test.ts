/** Real initializer + lease allocator transactions in an isolated disposable
 * schema. Identity policy is an explicitly qualified fixture, not live proof. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@dpf/db";
import { createHandoffDependencyPostgresFixture } from "../../../../packages/db/src/handoff-dependency-postgres-fixture";
const fixture = vi.hoisted(() => ({ prisma: null as any, denyAfterOwnership: false }));
vi.mock("@dpf/db", async original => ({ ...await original<typeof import("@dpf/db")>(), get prisma() { return fixture.prisma; } }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: async () => ({ platformRole: "HR-000", isSuperuser: true }) }));
vi.mock("./activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: async () => {} }));
vi.mock("@/lib/work-management/workroom-agent-access.server", async original => ({
  ...await original<typeof import("@/lib/work-management/workroom-agent-access.server")>(),
  resolveAgentWorkroomAccess: async (input: { workroomId: string }, db: Prisma.TransactionClient) => {
    const room = await db.workroom.findUniqueOrThrow({ where: { id: input.workroomId } });
    const participants = await db.workroomParticipant.findMany({ where: { workroomId: room.id } });
    return { decision: { level: fixture.denyAfterOwnership ? "none" : "action" }, authorityContext: {
      humanPrincipal: { id: "human", principalId: "PRN-human", kind: "human", status: "active", sensitivityClearance: [] },
      agentPrincipal: { id: "assistant", principalId: "PRN-assistant", kind: "agent", status: "active", sensitivityClearance: [] },
      room: { ...room, participants, workItem: null }, sensitivityCeiling: "internal",
    } };
  },
}));
import { createInitiallyAssignedWorkroom } from "./initial-workroom-assignment";
import { resolveBodyBaselineAuthorRoom } from "@/lib/backlog/initiative-readiness/body-baseline-author-room";
import { createWorkCapsule } from "./work-capsule-store";
import { claimNonprodEnvironmentLease } from "@/lib/nonprod/environment-lease";

const configured = process.env.DATABASE_URL?.trim() ?? "";
const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || (() => {
  try { return /^\/dpf_local_ci_[01]$/.test(new URL(configured).pathname) ? configured : ""; } catch { return ""; }
})();
const SCHEMA = "dpf_handoff_dependency_" + randomUUID().replaceAll("-", "");
const assignmentGrants = ["work_capsule_write", "build_evidence", "workroom_evidence_write", "initiative_evidence_write"];
const actor = { userId: "user", agentId: "AGT-EXT-CODEX", principalId: "human", agentPrincipalId: "assistant", taskAuthorityTokenId: "token" };
const context = { agentId: actor.agentId, authSource: "oauth", apiTokenId: "token", tokenGrantScopes: assignmentGrants };
const input = { title: "Acceptance", objective: "Verify delivered work", source: "manual" as const,
  executorKind: "codex-desktop" as const, idempotencyKey: "qa:initial", scope: { workShape: "acceptance-verification@1.1.0" } };
function signal<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function barrier<T>(reached: Promise<T>, operation: Promise<unknown>): Promise<T> {
  return Promise.race([reached, operation.then(() => { throw new Error("Operation completed before its expected transaction barrier"); })]);
}
type RawTx = Prisma.TransactionClient;
type Hooks = { started?: (tx: RawTx) => Promise<void>; beforeCommit?: (tx: RawTx) => Promise<void>; beforeCreate?: () => Promise<void> };

/** Preserve actual delegates for all effects and dependencies. Only already
 * qualified identity inputs and runtime admission are ports in this fixture. */
function ports(tx: RawTx, hooks: Hooks = {}) {
  const token = { kind: "oauth_access", revokedAt: null, expiresAt: new Date(Date.now() + 3600000),
    userId: "user", agentId: actor.agentId, authorityBindingId: null, oauthClientId: "client", resource: "https://fixture.invalid/api/mcp/v1",
    publicScopes: [], oauthFamilyKey: null, oauthClient: { revokedAt: null, registrationKind: "credentials" } };
  return {
    $queryRaw: tx.$queryRaw.bind(tx), $executeRaw: tx.$executeRaw.bind(tx),
    workroom: new Proxy(tx.workroom, { get(target, key, receiver) {
      if (key === "create") return async (args: Parameters<typeof target.create>[0]) => { await hooks.beforeCreate?.(); return target.create(args); };
      const value = Reflect.get(target, key, receiver); return typeof value === "function" ? value.bind(target) : value;
    } }),
    workroomActivity: tx.workroomActivity, workroomParticipant: tx.workroomParticipant,
    workItem: tx.workItem, workQueue: tx.workQueue, backlogItem: tx.backlogItem,
    principalAlias: { findFirst: async () => ({ aliasValue: "user" }) }, user: { findFirst: async () => null },
    mcpApiToken: { findUnique: async () => token },
    agent: { findFirst: async () => ({ toolGrants: assignmentGrants.map(grantKey => ({ grantKey })), toolGrantRevocations: [] }) },
    nonProductionEnvironmentLease: tx.nonProductionEnvironmentLease, externalEvidenceRecord: tx.externalEvidenceRecord,
    platformConfig: tx.platformConfig,
  } as unknown as RawTx;
}

describe.skipIf(!DATABASE_URL)("initial assignment atomicity and competing production lease writer (PostgreSQL)", () => {
  let pool: Pool, prisma: ReturnType<typeof createHandoffDependencyPostgresFixture>["prisma"];
  const tables = ["NonProductionEnvironmentLease", "QueueTelemetryEvent", "PlatformConfig", "TaskRun", "WorkCapsule", "WorkCapsuleActivity",
    "WorkCapsuleParticipant", "WorkItem", "WorkQueue", "Agent", "AgentToolGrant", "Principal", "PrincipalAlias", "User", "BacklogItem",
    "McpApiToken", "OAuthClient", "AuthorityBinding", "ExternalEvidenceRecord"];
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: "-c search_path=" + SCHEMA });
    await pool.query(`CREATE SCHEMA "${SCHEMA}"`);
    prisma = createHandoffDependencyPostgresFixture(DATABASE_URL, SCHEMA).prisma;
    fixture.prisma = prisma;
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  });
  beforeEach(async () => { fixture.denyAfterOwnership = false;
    await pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(", ")} CASCADE`);
  });
  afterAll(async () => { await prisma?.$disconnect(); if (pool) {
    try { if (!/^dpf_handoff_dependency_[a-f0-9]{32}$/.test(SCHEMA)) throw new Error("Invalid isolated schema");
      await pool.query(`DROP SCHEMA "${SCHEMA}" CASCADE`); } finally { await pool.end(); }
  } });
  function db(hooks: Hooks = {}) {
    return { $transaction: async <T>(body: (tx: RawTx) => Promise<T>, options: any) => prisma.$transaction(async tx => {
      await hooks.started?.(tx); const result = await body(ports(tx, hooks)); await hooks.beforeCommit?.(tx); return result;
    }, options) } as unknown as PrismaClient;
  }
  const run = (hooks: Hooks = {}) => createInitiallyAssignedWorkroom({ db: db(hooks), actor, context, input,
    params: { ...input, workShape: input.scope.workShape, sessionRef: "endorsed" } });
  const pid = async (tx: RawTx) => (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
  async function blocked(waiter: number, holder: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await pool.query("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [holder, waiter])).rows[0].blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Expected PostgreSQL lock dependency was not observed");
  }
  function lease(hooks: Hooks = {}) {
    const wrapped = new Proxy(prisma, { get(target, key, receiver) {
      if (key === "$transaction") return async (body: (tx: RawTx) => Promise<unknown>, options: any) => target.$transaction(async tx => {
        await hooks.started?.(tx); const result = await body(tx); await hooks.beforeCommit?.(tx); return result;
      }, options);
      const value = Reflect.get(target, key, receiver); return typeof value === "function" ? value.bind(target) : value;
    } });
    return claimNonprodEnvironmentLease({ db: wrapped, environmentKey: "active-candidate", ownerProvider: "codex", ownerSessionId: "endorsed",
      claimKey: "initial-assignment-race", purpose: "Isolated initializer race", url: "http://fixture.invalid", ports: [], expiresAt: new Date(Date.now() + 600000) });
  }
  async function counts() {
    return { rooms: await prisma.workroom.count(), participants: await prisma.workroomParticipant.count(),
      activities: await prisma.workroomActivity.count(), cases: await prisma.workItem.count() };
  }
  it("commits one complete assignment for concurrent duplicate requests", async () => {
    const results = await Promise.all([run(), run()]);
    expect(results.every(result => result.success)).toBe(true);
    expect(results.map(result => (result.data?.executorAssignment as any).reused).sort()).toEqual([false, true]);
    expect((await counts()).rooms).toBe(1); expect((await counts()).participants).toBe(2);
    expect(await prisma.workroomActivity.count({ where: { payload: { path: ["kind"], equals: "initial-executor-assignment" } } })).toBe(1);
  });
  it("keeps the delivered target separate from the actual source-author relation", async () => {
    const target = await prisma.backlogItem.create({ data: { itemId: "BI-TARGET", title: "Delivered target", status: "awaiting-acceptance", type: "feature" } });
    const source = await prisma.workroom.create({ data: { capsuleId: "WC-SOURCE", title: "Source author", objective: "Fixture delivery", source: "manual",
      backlogItemId: target.itemId, repositoryFullName: "fixture/repo", baseSha: "a".repeat(40), headSha: "b".repeat(40), headBranch: "fix/target" } });
    const outcomeAnchor = { kind: "backlog-item" as const, id: target.itemId, label: "Delivered target" };
    expect((await resolveBodyBaselineAuthorRoom(prisma as never, target))?.id).toBe(source.id);
    const result = await createInitiallyAssignedWorkroom({ db: db(), actor, context,
      input: { ...input, scope: { ...input.scope, outcomeAnchor } }, params: { sessionRef: "endorsed", outcomeAnchor } });
    expect(result.success).toBe(true);
    const created = await prisma.workroom.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
    expect(created.backlogItemId).toBeNull(); expect(created.outcomeAnchor).toEqual(outcomeAnchor);
    expect((await resolveBodyBaselineAuthorRoom(prisma as never, target))?.id).toBe(source.id);
  });
  it("rechecks the stored target on replay when the caller omits optional target fields", async () => {
    const target = await prisma.backlogItem.create({ data: { itemId: "BI-TARGET", title: "Delivered target", status: "awaiting-acceptance", type: "feature" } });
    const outcomeAnchor = { kind: "backlog-item" as const, id: target.itemId };
    expect((await createInitiallyAssignedWorkroom({ db: db(), actor, context,
      input: { ...input, scope: { ...input.scope, outcomeAnchor } }, params: { sessionRef: "endorsed", outcomeAnchor } })).success).toBe(true);
    const before = await counts();
    await prisma.backlogItem.update({ where: { id: target.id }, data: { sensitivity: "restricted" } });
    expect(await run()).toMatchObject({ success: false, data: { reason: "sensitive-verification-target-requires-controlled-assignment" } });
    expect(await counts()).toEqual(before);
    await prisma.backlogItem.update({ where: { id: target.id }, data: { sensitivity: "internal" } });
    expect(await run()).toMatchObject({ success: true, data: { executorAssignment: { reused: true } } });
    await prisma.backlogItem.delete({ where: { id: target.id } });
    expect(await run()).toMatchObject({ success: false, data: { reason: "verification-target-unavailable" } });
    expect(await counts()).toEqual(before);
  });
  it("rolls back room, ownership, anchor and assignment when final admission refuses", async () => {
    fixture.denyAfterOwnership = true; expect((await run()).success).toBe(false);
    expect(await counts()).toEqual({ rooms: 0, participants: 0, activities: 0, cases: 0 });
  });
  it("observes a competing real lease allocation before committing the new assignment", async () => {
    const held = signal<number>(), started = signal<number>(), release = signal();
    const allocation = lease({ beforeCommit: async tx => { held.resolve(await pid(tx)); await release.promise; } });
    let assignment: ReturnType<typeof run> | undefined;
    try {
      const holder = await barrier(held.promise, allocation);
      assignment = run({ started: async tx => { started.resolve(await pid(tx)); } });
      await blocked(await barrier(started.promise, assignment), holder); release.resolve();
      expect((await allocation).status).toBe("active");
      expect(await assignment).toMatchObject({ success: false, data: { reason: "handoff-lease-dependency" } });
      expect(await counts()).toEqual({ rooms: 0, participants: 0, activities: 0, cases: 0 });
    } finally { release.resolve(); await Promise.allSettled([allocation, ...(assignment ? [assignment] : [])]); }
  }, 45000);
  it("holds the lease writer until the complete initial assignment commits", async () => {
    const held = signal<number>(), started = signal<number>(), release = signal();
    const assignment = run({ beforeCommit: async tx => { held.resolve(await pid(tx)); await release.promise; } });
    let allocation: ReturnType<typeof lease> | undefined;
    try {
      const holder = await barrier(held.promise, assignment);
      expect(await counts()).toEqual({ rooms: 0, participants: 0, activities: 0, cases: 0 });
      allocation = lease({ started: async tx => { started.resolve(await pid(tx)); } });
      await blocked(await barrier(started.promise, allocation), holder); release.resolve();
      expect((await assignment).success).toBe(true); expect((await allocation).status).toBe("active");
      expect((await counts()).rooms).toBe(1); expect((await counts()).participants).toBe(2);
    } finally { release.resolve(); await Promise.allSettled([assignment, ...(allocation ? [allocation] : [])]); }
  }, 45000);
  it("does not read the legacy unique winner on an aborted transaction or late-bind its null executor", async () => {
    const held = signal(), release = signal(); let transactions = 0;
    const assignment = run({ started: async () => { transactions++; }, beforeCreate: async () => { held.resolve(); await release.promise; } });
    try {
      await barrier(held.promise, assignment);
      const legacy = await prisma.$transaction(tx => createWorkCapsule({ db: ports(tx) as never, actor,
        input: { ...input, executorRef: null }, deferPublication: true }));
      release.resolve();
      expect(await assignment).toMatchObject({ success: false, data: { reason: "existing-assignment-does-not-match" } });
      expect(transactions).toBe(2);
      expect((await prisma.workroom.findUniqueOrThrow({ where: { id: legacy.id } })).executorRef).toBeNull();
      expect((await counts()).rooms).toBe(1); expect((await counts()).participants).toBe(0);
      expect(await prisma.workroomActivity.count({ where: { payload: { path: ["kind"], equals: "initial-executor-assignment" } } })).toBe(0);
    } finally { release.resolve(); await Promise.allSettled([assignment]); }
  }, 45000);
});
