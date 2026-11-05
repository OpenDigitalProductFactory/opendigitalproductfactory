import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@dpf/db";
import { createInitiallyAssignedWorkroom } from "./initial-workroom-assignment";
import { resolveBodyBaselineAuthorRoom } from "@/lib/backlog/initiative-readiness/body-baseline-author-room";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";

const policy = vi.hoisted(() => ({ allowed: true, publish: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: async () => policy.allowed ? { platformRole: "HR-000", isSuperuser: true } : null }));
vi.mock("./activity-events", () => ({ publishRecordedWorkCapsuleActivity: (...args: unknown[]) => policy.publish(...args) }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: () => policy.revalidate() }));
vi.mock("@/lib/work-management/workroom-agent-access.server", async original => ({
  ...await original<typeof import("@/lib/work-management/workroom-agent-access.server")>(),
  resolveAgentWorkroomAccess: async (input: { workroomId: string }, db: any) => {
    const room = await db.workroom.findUnique({ where: { id: input.workroomId } });
    return { decision: { level: policy.allowed ? "action" : "none" }, authorityContext: {
      humanPrincipal: { id: "human", principalId: "PRN-human", kind: "human", status: "active", sensitivityClearance: [] },
      agentPrincipal: { id: "assistant", principalId: "PRN-assistant", kind: "agent", status: "active", sensitivityClearance: [] },
      room: { ...room, participants: await db.workroomParticipant.findMany({}), workItem: null }, sensitivityCeiling: "internal",
    } };
  },
}));
const assignmentGrants = ["work_capsule_write", "build_evidence", "workroom_evidence_write", "initiative_evidence_write"];
const actor = { userId: "user", agentId: "AGT-EXT-CODEX", principalId: "human", agentPrincipalId: "assistant", taskAuthorityTokenId: "token" };
const context = { agentId: actor.agentId, authSource: "oauth", apiTokenId: "token", tokenGrantScopes: assignmentGrants };
const input = { title: "Acceptance", objective: "Verify delivered work", source: "manual" as const,
  executorKind: "codex-desktop" as const, idempotencyKey: "qa:initial", scope: { workShape: "acceptance-verification@1.1.0" } };

/** Explicitly qualified identity ports; these tests prove the new adapter's
 * calls, effect boundary and rollback, not the canonical identity resolver. */
function fixture() {
  let state: any = { room: null, participants: [], activities: [], workItem: null };
  let inTransaction = false;
  const clients: object[] = [], calls: string[] = [];
  const controls = { lease: false, tokenRevoked: false, grantRevoked: false, anchorFailure: false, targetExists: true, targetSensitivity: "internal",
    beforeGrantRead: undefined as (() => void) | undefined, winner: null as any, closedRead: false };
  const makeTx = () => {
    let closed = false;
    const check = () => { if (closed) { controls.closedRead = true; throw new Error("aborted transaction read"); } };
    const tx: any = {
      $queryRaw: async (strings: TemplateStringsArray) => { check(); const sql = strings.join(""); calls.push(sql);
        return sql.includes("clock_timestamp()") ? [{ now: new Date() }] : sql.includes('FROM "BacklogItem"') && controls.targetExists ? [{ id: "target" }] : []; },
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { check(); calls.push(strings.join("") + values.join()); return 1; },
      mcpApiToken: { findUnique: async () => ({ kind: "oauth_access", revokedAt: controls.tokenRevoked ? new Date() : null,
        expiresAt: new Date(Date.now() + 3600000), userId: "user", agentId: actor.agentId, authorityBindingId: null,
        oauthClientId: "client", resource: "https://fixture.invalid/api/mcp/v1", publicScopes: [], oauthFamilyKey: null,
        oauthClient: { revokedAt: null, registrationKind: "credentials" } }) },
      agent: { findFirst: async () => { controls.beforeGrantRead?.(); return { toolGrants: assignmentGrants.map(grantKey => ({ grantKey })),
        toolGrantRevocations: controls.grantRevoked ? [{ grantKey: "work_capsule_write" }] : [] }; } },
      backlogItem: { findFirst: async () => controls.targetExists ? { itemId: "BI-TARGET" } : null,
        findUnique: async () => controls.targetExists ? { sensitivity: controls.targetSensitivity, scopeKind: "organization", digitalProduct: null } : null },
      workroom: {
        findUnique: async () => { check(); return state.room; },
        findUniqueOrThrow: async () => { check(); if (!state.room) throw new Error("missing room"); return state.room; },
        create: async ({ data }: any) => { check(); if (controls.winner) { closed = true; throw Object.assign(new Error("unique"), { code: "P2002" }); }
          state.room = { id: "room", headSha: null, headBranch: null, worktreePath: null, archivedAt: null, taskRunId: null, ...data }; return state.room; },
        updateMany: async ({ data }: any) => { check(); Object.assign(state.room, data); return { count: 1 }; },
        update: async ({ data }: any) => { check(); Object.assign(state.room, data); return state.room; },
      },
      workroomActivity: {
        create: async ({ data }: any) => { check(); const row = { id: `activity-${state.activities.length}`, ...data }; state.activities.push(row); return row; },
        findMany: async () => state.activities.filter((row: any) => row.payload.kind === "initial-executor-assignment"),
      },
      workItem: { findFirst: async () => state.workItem, create: async () => {
        if (controls.anchorFailure) throw new Error("anchor failure"); state.workItem = { id: "case" }; return state.workItem;
      } },
      workQueue: { upsert: async () => ({ id: "queue" }) },
      workroomParticipant: { findMany: async () => state.participants,
        create: async ({ data }: any) => { const row = { id: `participant-${state.participants.length}`, lifecycle: "active", ...data }; state.participants.push(row); return row; },
        update: async () => { throw new Error("Unexpected existing participant rewrite"); } },
      principalAlias: { findFirst: async () => ({ aliasValue: "user" }) }, user: { findFirst: async () => null },
      nonProductionEnvironmentLease: { findFirst: async () => controls.lease ? { leaseId: "foreign-lease", ownerSessionId: "endorsed", status: "active" } : null },
    };
    clients.push(tx);
    return tx;
  };
  const db = { $transaction: vi.fn(async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = structuredClone(state); inTransaction = true;
    try { return await work(makeTx()); }
    catch (error) { state = before; if (controls.winner) { state = controls.winner; controls.winner = null; } throw error; }
    finally { inTransaction = false; }
  }) } as unknown as PrismaClient;
  policy.publish.mockImplementation(() => { expect(inTransaction).toBe(false); });
  const run = (change: Partial<Parameters<typeof createInitiallyAssignedWorkroom>[0]> = {}) => createInitiallyAssignedWorkroom({
    db, actor, context, input, params: { ...input, sessionRef: "endorsed", workShape: input.scope.workShape }, ...change,
  });
  return { run, controls, db, calls, clients, state: () => state, replace: (value: any) => { state = value; } };
}

beforeEach(() => { vi.clearAllMocks(); policy.allowed = true; });
describe("transactional initial external acceptance assignment", () => {
  it("commits creation, anchor, ownership and endorsed locator together; publishes after commit", async () => {
    const f = fixture(), result = await f.run();
    expect(result).toMatchObject({ success: true, data: { capsule: { executorRef: "endorsed", workItemId: "case" }, executorAssignment: { reused: false } } });
    expect(f.state().participants).toHaveLength(2);
    expect(f.state().room.scopeClaims).toContainEqual(expect.objectContaining({ workShapeRoleBindings: { "acceptance-verifier": "agent:AGT-EXT-CODEX" } }));
    expect(f.state().activities.filter((row: any) => row.payload.kind === "initial-executor-assignment")).toHaveLength(1);
    expect(f.clients).toHaveLength(1);
    expect(policy.publish).toHaveBeenCalledTimes(1);
    expect(f.calls.slice(0, 3).every(sql => sql.includes("dpf:nonprod-environment:"))).toBe(true);
  });
  it.each(["", "x".repeat(501), 42])("refuses malformed locator before a transaction", async sessionRef => {
    const f = fixture(); expect(await f.run({ params: { sessionRef } })).toMatchObject({ success: false, data: { reason: "invalid-executor-reference" } });
    expect(f.clients).toHaveLength(0); expect(f.state().room).toBeNull();
  });
  it("refuses another external surface and an unauthenticated actor before creation", async () => {
    const f = fixture();
    expect((await f.run({ input: { ...input, executorKind: "claude-desktop" } })).success).toBe(false);
    expect((await f.run({ context: { agentId: actor.agentId } })).success).toBe(false);
    expect(f.state().room).toBeNull();
  });
  it("does not create an assignment when its declared verification writes are outside the token scope", async () => {
    const f = fixture();
    expect((await f.run({ context: { ...context, tokenGrantScopes: ["work_capsule_write"] } })).success).toBe(false);
    expect(f.state().room).toBeNull();
  });
  it("retains the verification target without competing with its source author", async () => {
    const f = fixture(), outcomeAnchor = { kind: "backlog-item" as const, id: "BI-TARGET", label: "Delivered routing" };
    expect((await f.run({ input: { ...input, scope: { ...input.scope, outcomeAnchor } }, params: { sessionRef: "endorsed", outcomeAnchor } })).success).toBe(true);
    expect(f.state().room.backlogItemId).toBeNull(); expect(f.state().room.outcomeAnchor).toEqual(outcomeAnchor);
    const source = { id: "source", capsuleId: "WC-SOURCE", backlogItemId: "BI-TARGET" };
    const current = await resolveBodyBaselineAuthorRoom({ workroom: { findMany: async () =>
      [source, f.state().room].filter(row => row.backlogItemId === "BI-TARGET") } } as never,
    { id: "item-row", itemId: "BI-TARGET" });
    expect(current?.capsuleId).toBe("WC-SOURCE");
  });
  it("preserves the exact archived delivered author when a verification room is created", async () => {
    const f = fixture(), outcomeAnchor = { kind: "backlog-item" as const, id: "BI-TARGET" };
    expect((await f.run({ input: { ...input, scope: { ...input.scope, outcomeAnchor } }, params: { sessionRef: "endorsed", outcomeAnchor } })).success).toBe(true);
    const source = { id: "source", capsuleId: "WC-SOURCE", backlogItemId: "BI-TARGET", status: "archived", archivedAt: null,
      repositoryFullName: "fixture/repo", baseSha: "a".repeat(40), headSha: "b".repeat(40), headBranch: "fix/source", createdByPrincipalId: "source-author", createdAt: new Date(), pullRequestNumber: 1 };
    const payload = createPullRequestObservation({ repositoryFullName: source.repositoryFullName, number: 1, url: "https://github.com/fixture/repo/pull/1",
      title: "Delivered fixture", headBranch: source.headBranch, headSha: source.headSha, state: "merged", isDraft: false, mergeStateStatus: null,
      mergeCommitSha: "c".repeat(40), mergedAt: "2026-11-01T01:00:00Z", providerUpdatedAt: "2026-11-01T01:00:00Z", observedAt: "2026-11-01T01:01:00Z" });
    const current = await resolveBodyBaselineAuthorRoom({ workroom: { findMany: async ({ where }: any) =>
      [source, f.state().room].filter(row => row.backlogItemId === "BI-TARGET" && (where.archivedAt !== null || row.status !== "archived")) },
    contributorInventorySnapshot: { findMany: async () => [{ payload }] } } as never, { id: "item-row", itemId: "BI-TARGET" });
    expect(current?.id).toBe(source.id); expect(source.status).toBe("archived");
  });
  it.each(["confidential", "restricted"])("holds a %s target at its existing controlled boundary", async sensitivity => {
    const f = fixture(); f.controls.targetSensitivity = sensitivity;
    const outcomeAnchor = { kind: "backlog-item" as const, id: "BI-TARGET" };
    expect(await f.run({ input: { ...input, scope: { ...input.scope, outcomeAnchor } }, params: { sessionRef: "endorsed", outcomeAnchor } }))
      .toMatchObject({ success: false, data: { reason: "sensitive-verification-target-requires-controlled-assignment" } });
    expect(f.state().room).toBeNull();
  });
  it("refuses an authored backlog subject on a source-free acceptance assignment", async () => {
    const f = fixture();
    expect(await f.run({ params: { sessionRef: "endorsed", backlogItemId: "BI-TARGET" } })).toMatchObject({ success: false,
      data: { reason: "verification-target-must-use-outcome-anchor" } });
    expect(f.state().room).toBeNull();
  });
  it("holds an unavailable verification target before creating any effects", async () => {
    const f = fixture(); f.controls.targetExists = false;
    const outcomeAnchor = { kind: "backlog-item" as const, id: "BI-TARGET" };
    expect(await f.run({ input: { ...input, scope: { ...input.scope, outcomeAnchor } }, params: { sessionRef: "endorsed", outcomeAnchor } }))
      .toMatchObject({ success: false, data: { reason: "verification-target-unavailable" } });
    expect(f.state().room).toBeNull();
  });
  it("does not accept delivery or unknown shapes as source-free assignments", async () => {
    const f = fixture();
    for (const workShape of ["delivery-medium@1.0.0", "acceptance-verification@99.0.0"])
      expect((await f.run({ input: { ...input, scope: { workShape } } })).success).toBe(false);
    expect(f.state().room).toBeNull();
  });
  it.each(["lease", "tokenRevoked", "grantRevoked", "anchorFailure"] as const)("rolls back all effects when %s refuses", async flag => {
    const f = fixture(); f.controls[flag] = true;
    expect((await f.run()).success).toBe(false);
    expect(f.state()).toEqual({ room: null, participants: [], activities: [], workItem: null });
    expect(policy.publish).not.toHaveBeenCalled();
  });
  it("rechecks changed authority after creation and rolls back ownership and locator", async () => {
    const f = fixture(); let reads = 0;
    f.controls.beforeGrantRead = () => { if (++reads === 2) f.controls.grantRevoked = true; };
    expect((await f.run()).success).toBe(false); expect(f.state().room).toBeNull(); expect(policy.publish).not.toHaveBeenCalled();
  });
  it("reuses one matching accepted assignment without rewriting its history", async () => {
    const f = fixture(); expect((await f.run()).success).toBe(true); const before = structuredClone(f.state());
    expect(await f.run()).toMatchObject({ success: true, data: { executorAssignment: { reused: true } } });
    expect(f.state()).toEqual(before); expect(policy.publish).toHaveBeenCalledTimes(1);
  });
  it("does not late-bind an old null or replace a different non-null executor", async () => {
    const f = fixture(); await f.run();
    for (const executorRef of [null, "foreign-session"]) {
      f.state().room.executorRef = executorRef; const before = structuredClone(f.state());
      expect((await f.run()).success).toBe(false); expect(f.state()).toEqual(before);
    }
  });
  it("holds a matching locator when its verifier role was removed", async () => {
    const f = fixture(); await f.run();
    f.state().room.scopeClaims = f.state().room.scopeClaims.filter((row: any) => !row.workShapeRoleBindings);
    const before = structuredClone(f.state());
    expect((await f.run()).success).toBe(false); expect(f.state()).toEqual(before);
  });
  it("holds ambiguous initial assignment evidence without rewriting it", async () => {
    const f = fixture(); await f.run();
    const marker = f.state().activities.find((row: any) => row.payload.kind === "initial-executor-assignment");
    f.state().activities.push({ ...marker, id: "duplicate-marker" });
    const before = structuredClone(f.state());
    expect((await f.run()).success).toBe(false); expect(f.state()).toEqual(before);
  });
  it("reads a concurrent winner only after the aborted transaction has rolled back", async () => {
    const f = fixture(); await f.run(); const winner = structuredClone(f.state());
    f.replace({ room: null, participants: [], activities: [], workItem: null }); f.controls.winner = winner;
    expect(await f.run()).toMatchObject({ success: true, data: { executorAssignment: { reused: true } } });
    expect(f.controls.closedRead).toBe(false); expect(f.clients).toHaveLength(3);
  });
  it("holds native task/fence contexts rather than inventing an external assignment", async () => {
    const f = fixture(); expect((await f.run({ context: { ...context, taskRunId: "actual-native-task" } })).success).toBe(false);
    expect(f.state().room).toBeNull();
  });
});
