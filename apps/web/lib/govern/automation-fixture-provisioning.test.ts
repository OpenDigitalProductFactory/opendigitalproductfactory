import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: {} as Record<string, any>, environment: vi.fn(), access: vi.fn(), grants: vi.fn(), authority: vi.fn(), sync: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/install/environment-class", () => ({ loadEnvironmentClassResolution: mocks.environment }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
vi.mock("@/lib/agent-grants", () => ({ getAgentToolGrantsAsync: mocks.grants, grantsSatisfyRequirement: (_r: string[], held: string[]) => held.includes("sandbox_execute") }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.authority }));
vi.mock("@/lib/identity/principal-linking", () => ({ syncUserPrincipal: mocks.sync }));
vi.mock("./password", () => ({ hashPassword: async () => "unit-hash" }));
import { prepareFixture, retireExpiredFixtures, retireFixtureRun, validateFixtureExchange } from "./automation-fixture";

const actor = { userId: "owner", agentId: "agent", authSource: "oauth", apiTokenId: "token" };
const request = { capsuleId: "room", leaseId: "lease", profile: "developer" as const, slot: 0 };
let run: any;
let user: any;
let lease: any;
beforeEach(() => {
  vi.clearAllMocks(); run = null; user = null;
  lease = { status: "active", ownerSessionId: "session", branchName: "branch", url: "http://portal:3000", expiresAt: new Date(Date.now() + 600_000) };
  mocks.environment.mockResolvedValue({ environmentClass: "development" });
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  mocks.grants.mockResolvedValue(["sandbox_execute"]); mocks.authority.mockResolvedValue(true);
  Object.assign(mocks.db, {
    $transaction: async (body: (db: any) => unknown) => body(mocks.db), $executeRaw: vi.fn(),
    platformConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    workroom: { findUnique: vi.fn(async () => ({ id: "room-row", executorRef: "session", headBranch: "branch", leaseExpiresAt: new Date(Date.now() + 600_000) })), findMany: vi.fn(async () => []) },
    nonProductionEnvironmentLease: { findUnique: vi.fn(async () => lease) },
    mcpApiToken: { findUnique: vi.fn(async () => ({ userId: "owner", agentId: "agent" })), updateMany: vi.fn() },
    oAuthRefreshToken: { updateMany: vi.fn() }, authorityBinding: { updateMany: vi.fn() }, principal: { updateMany: vi.fn() },
    principalAlias: { findMany: vi.fn(async () => [{ principalId: "fixture-principal" }]) },
    runtimeVerification: { findFirst: vi.fn(async () => run), findUnique: vi.fn(async () => run), create: vi.fn(async ({ data }) => run = { id: "run-row", updatedAt: new Date(), ...data }),
      update: vi.fn(async ({ data }) => run = { ...run, ...data }) },
    platformRole: { findMany: vi.fn(async () => [{ id: "developer-role", roleId: "HR-200" }]) },
    user: { findUnique: vi.fn(async ({ where }) => where.id === "owner"
      ? { isActive: true, isSuperuser: false, groups: [{ platformRole: { roleId: "HR-000" } }] }
      : user ? { ...user, automationVerification: run } : null),
      create: vi.fn(async ({ data }) => user = { id: "fixture", ...data }),
      findMany: vi.fn(async () => user ? [{ id: user.id }] : []), updateMany: vi.fn() },
    taskRun: { findMany: vi.fn(async () => []) }, adminActivity: { create: vi.fn() },
  });
  mocks.db.workroom.findUniqueOrThrow = mocks.db.workroom.findUnique;
});

describe("isolated verification provisioning", () => {
  it("preserves a changed UX result even when the verifier shares the same timestamp", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    mocks.db.authorityBinding.updateMany.mockImplementationOnce(async () => {
      run = { ...run, status: "passed", result: { ...run.result, uxOutcome: { passed: 7 } } };
    });
    mocks.db.runtimeVerification.update.mockImplementation(async ({ where, data }: {
      where: { updatedAt?: Date; status?: string; result?: { equals: unknown } }; data: Record<string, unknown>;
    }) => {
      if ((where.updatedAt && where.updatedAt.getTime() !== run.updatedAt.getTime())
        || (where.status && where.status !== run.status)
        || (where.result && JSON.stringify(where.result.equals) !== JSON.stringify(run.result))) throw new Error("verification changed");
      run = { ...run, ...data };
      return run;
    });
    await expect(retireFixtureRun(first.runId, actor)).rejects.toThrow("verification changed");
    expect(run.status).toBe("passed");
    expect(run.result.uxOutcome).toEqual({ passed: 7 });
    expect(run.result.fixtureCleanup).toBeUndefined();
  });
  it("does not overwrite a UX verdict recorded while cleanup is in progress", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    mocks.db.authorityBinding.updateMany.mockImplementationOnce(async () => {
      run = { ...run, status: "passed", updatedAt: new Date(run.updatedAt.getTime() + 1000), result: { ...run.result, uxOutcome: { passed: 7 } } };
    });
    mocks.db.runtimeVerification.update.mockImplementation(async ({ where, data }: { where: { updatedAt?: Date }; data: Record<string, unknown> }) => {
      if (where.updatedAt && where.updatedAt.getTime() !== run.updatedAt.getTime()) throw new Error("verification changed");
      run = { ...run, ...data };
      return run;
    });
    await expect(retireFixtureRun(first.runId, actor)).rejects.toThrow("verification changed");
    expect(run.status).toBe("passed");
    expect(run.result.uxOutcome).toEqual({ passed: 7 });
    expect(run.result.fixtureCleanup).toBeUndefined();
  });
  it("does not turn fixture issuance and retirement into a passing UX verification", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    await retireFixtureRun(first.runId, actor);
    expect(run.status).not.toBe("passed");
    expect(run.result.fixtureCleanup).toMatchObject({ status: "retired" });
    expect(run.result.fixture.userId).toBe(actor.userId);
  });
  it("retires fixture authority after a genuinely passed UX verification without replacing its outcome", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    const completedAt = new Date("2026-09-28T01:00:00Z");
    run = { ...run, status: "passed", completedAt, result: { ...run.result, uxOutcome: { passed: 7 } } };
    await retireFixtureRun(first.runId, actor);
    expect(mocks.db.user.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.mcpApiToken.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.oAuthRefreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("passed");
    expect(run.completedAt).toBe(completedAt);
    expect(run.result.uxOutcome).toEqual({ passed: 7 });
    expect(run.result.fixtureCleanup).toMatchObject({ status: "retired" });
  });
  it("does not provision after retirement wins the run lock", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    mocks.db.$executeRaw.mockImplementationOnce(async () => { run = { ...run, result: { ...run.result, fixtureCleanup: { status: "retired" } } }; });
    await expect(prepareFixture({ runId: first.runId, profile: "developer", slot: 1 }, actor, "http://portal:3000")).rejects.toThrow("closed");
    expect(mocks.db.user.create).toHaveBeenCalledTimes(1);
  });
  it("serializes retirement before reading the run state", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    mocks.db.$executeRaw.mockClear();
    mocks.db.runtimeVerification.findUnique.mockClear();
    await retireFixtureRun(first.runId, actor);
    expect(mocks.db.$executeRaw).toHaveBeenCalled();
    expect(mocks.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.db.runtimeVerification.findUnique.mock.invocationCallOrder[0]);
  });
  it("creates an ordinary user then renews without restoring roles or expiry", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    expect(user.isSuperuser).toBe(false);
    expect(user.groups.create).toEqual([{ platformRoleId: "developer-role" }]);
    user.groups = [];
    lease.expiresAt = new Date(Date.now() + 7200_000);
    const second = await prepareFixture({ runId: first.runId, profile: "developer", slot: 0 }, actor, "http://portal:3000");
    expect(second.userId).toBe(first.userId);
    expect(second.expiresAt.getTime()).toBeLessThanOrEqual(first.expiresAt.getTime());
    expect(user.groups).toEqual([]);
    expect(mocks.db.user.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.user.updateMany).not.toHaveBeenCalled();
  });
  it("bounds active run creation by the owning lease", async () => {
    await prepareFixture(request, actor, "http://portal:3000");
    await expect(prepareFixture(request, actor, "http://portal:3000")).rejects.toThrow("already has a verification run");
    expect(mocks.db.runtimeVerification.create).toHaveBeenCalledTimes(1);
  });
  it.each(["production", "unknown"])("refuses %s despite any shared automation grant", async environmentClass => {
    mocks.environment.mockResolvedValue({ environmentClass });
    await expect(prepareFixture(request, actor, "http://portal:3000")).rejects.toThrow("development or test");
    expect(mocks.db.user.create).not.toHaveBeenCalled();
  });
  it("refuses another human or task borrowing a run", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    run.result.fixture.userId = "other";
    await expect(prepareFixture({ runId: first.runId, profile: "developer", slot: 0 }, actor, "http://portal:3000")).rejects.toThrow("another user");
  });
  it("refuses a second task under the same human and assistant", async () => {
    const first = await prepareFixture(request, { ...actor, taskRunId: "first-task" }, "http://portal:3000");
    await expect(prepareFixture({ runId: first.runId, profile: "developer", slot: 0 },
      { ...actor, taskRunId: "second-task" }, "http://portal:3000")).rejects.toThrow("another user, assistant or task");
  });
  it("refuses an exchange claiming another run", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    await expect(validateFixtureExchange(first.userId, { runId: "another-run", profile: "developer", slot: 0, requestedBy: "owner" },
      "http://portal:3000")).rejects.toThrow("ended");
  });
  it("keeps open rooms visible until canonical closure", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    mocks.db.workroom.findMany.mockResolvedValue([{ capsuleId: "open-room" }]);
    expect(await retireFixtureRun(first.runId, actor)).toMatchObject({ retired: false, pendingRoomIds: ["open-room"] });
    expect(mocks.db.user.updateMany).not.toHaveBeenCalled();
  });
  it("explains an owned active lease origin mismatch without changing the MCP connection", async () => {
    lease.url = "http://127.0.0.1:3000";
    await expect(prepareFixture(request, actor, "http://localhost:3000")).rejects.toThrow(
      "Verification uses http://localhost:3000. Claim a matching lease and retry; keep your MCP connection unchanged.",
    );
    expect(mocks.db.runtimeVerification.create).not.toHaveBeenCalled();
    expect(mocks.db.user.create).not.toHaveBeenCalled();
  });
  it("keeps the ordinary authority refusal for a foreign lease with a different origin", async () => {
    lease.ownerSessionId = "another-session";
    lease.url = "http://peer:3000";
    await expect(prepareFixture(request, actor, "http://localhost:3000")).rejects.toThrow(
      "Use an active verification lease owned by this workroom on this installation.",
    );
    expect(mocks.db.runtimeVerification.create).not.toHaveBeenCalled();
    expect(mocks.db.user.create).not.toHaveBeenCalled();
  });
  it.each(["room", "grant", "consent", "peer", "lease", "role"])("refuses loss of %s before creating a user", async boundary => {
    if (boundary === "room") mocks.access.mockResolvedValue({ decision: { level: "none" } });
    if (boundary === "grant") mocks.grants.mockResolvedValue([]);
    if (boundary === "consent") mocks.authority.mockResolvedValue(false);
    if (boundary === "peer") lease.url = "http://peer:3000";
    if (boundary === "lease") lease.ownerSessionId = "another-session";
    if (boundary === "role") mocks.db.platformRole.findMany.mockResolvedValue([]);
    await expect(prepareFixture(request, actor, "http://portal:3000")).rejects.toThrow();
    expect(mocks.db.user.create).not.toHaveBeenCalled();
  });
  it("will not renew a disabled fixture", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000"); user.isActive = false;
    await expect(prepareFixture({ runId: first.runId, profile: "developer", slot: 0 }, actor, "http://portal:3000")).rejects.toThrow("disabled or expired");
  });
  it("checks current consent again at exchange", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    mocks.authority.mockResolvedValue(false);
    await expect(validateFixtureExchange(first.userId, { runId: first.runId, profile: "developer", slot: 0, requestedBy: "owner" }, "http://portal:3000")).rejects.toThrow("no longer authorized");
  });
  it("keeps incomplete cancellation visible and does not disable or revoke unrelated users", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    mocks.db.taskRun.findMany.mockResolvedValue([{ taskRunId: "pending" }]);
    expect(await retireFixtureRun(first.runId, actor)).toMatchObject({ retired: false, pendingTaskIds: ["pending"] });
    expect(mocks.db.user.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.authorityBinding.updateMany).not.toHaveBeenCalled();
  });
  it("retires only run-owned identities and is idempotent", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    expect(await retireFixtureRun(first.runId, actor)).toMatchObject({ retired: true });
    expect(mocks.db.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["fixture"] }, automationVerificationId: "run-row" }, data: { isActive: false } });
    expect(await retireFixtureRun(first.runId, actor)).toMatchObject({ retired: true, alreadyRetired: true });
    expect(mocks.db.user.updateMany).toHaveBeenCalledTimes(1);
  });
  it("does not issue when audit persistence fails", async () => {
    mocks.db.adminActivity.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(prepareFixture(request, actor, "http://portal:3000")).rejects.toThrow("audit unavailable");
  });
  it("advances a bounded cleanup cursor even when a run has pending work", async () => {
    const first = await prepareFixture(request, actor, "http://portal:3000");
    const expiry = new Date(Date.now() - 60_000);
    run.result.fixture.expiresAt = expiry.toISOString();
    const batch = Array.from({ length: 100 }, (_, i) => ({ id: `fixture-${i}`, automationExpiresAt: expiry,
      automationVerification: { verificationId: first.runId } }));
    mocks.db.user.findMany.mockResolvedValueOnce(batch);
    mocks.db.taskRun.findMany.mockResolvedValue([{ taskRunId: "pending" }]);
    const outcome = await retireExpiredFixtures();
    expect(outcome.scanned).toBe(100);
    expect(outcome.outcomes).toHaveLength(1);
    expect(outcome.outcomes[0]).toMatchObject({ retired: false, pendingTaskIds: ["pending"] });
    expect(mocks.db.platformConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { value: { id: "fixture-99", expiry: expiry.toISOString() } },
    }));
    expect(mocks.db.user.findMany.mock.calls[0][0]).toMatchObject({ take: 100,
      orderBy: [{ automationExpiresAt: "asc" }, { id: "asc" }] });
  });
  it("resets the cleanup cursor after the last page so pending runs are revisited", async () => {
    mocks.db.platformConfig.findUnique.mockResolvedValue({ value: { id: "prior", expiry: new Date().toISOString() } });
    expect(await retireExpiredFixtures()).toEqual({ scanned: 0, outcomes: [] });
    expect(mocks.db.platformConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: {} } }));
  });
});
