import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSmallAcceptanceBinding, SMALL_ACCEPTANCE_KEY } from "./small-acceptance-binding";

const ports = vi.hoisted(() => ({ shape: vi.fn(), paths: vi.fn(), deployment: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/backlog/initiative-readiness/bound-work-shape", () => ({ readBoundWorkShapeRef: ports.shape, readBoundEditPaths: ports.paths }));
vi.mock("@/lib/backlog/initiative-readiness/deployment-closure", () => ({ resolveBacklogDeploymentClosure: ports.deployment }));
import { loadSmallAcceptanceContext, readRetainedSmallCheck, type SmallAcceptanceDb } from "./small-acceptance-binding.server";

const sha = "a".repeat(40), head = "b".repeat(40), merge = "c".repeat(40);
const deployment = { kind: "deployed", runId: "SUR-1", repositoryFullName: "owner/repo", pullRequestNumber: 1,
  headSha: head, mergeCommitSha: merge, servedSha: sha, targetSha: sha, completedAt: "2026-10-26T10:00:00.000Z" };
const item = { id: "item-1", itemId: "BI-ONE", status: "done", workType: "bug", scopeKind: "platform",
  type: "portfolio", source: "user-request", organizationId: null, digitalProductId: null,
  archetypeIds: [], archetypeCategories: [], activeBuild: null, body: "" };
const room = { id: "room-1", backlogItemId: "BI-ONE", repositoryFullName: "owner/repo", headSha: head, pullRequestNumber: 1 };
const closure = { id: "closure-1", recordedAt: new Date("2026-10-26T10:01:00Z"),
  payload: { to: "done", closureBasis: "canonical-deployment", deployment } };
function fixture() {
  const db = {
    platformConfig: { findUnique: vi.fn().mockResolvedValue({ value: { level: "normal" } }) },
    backlogItem: { findFirst: vi.fn().mockResolvedValue(item), findUnique: vi.fn().mockResolvedValue(item) },
    workroom: { findUnique: vi.fn().mockResolvedValue(room), findFirst: vi.fn().mockResolvedValue(room) },
    backlogItemActivity: { findFirst: vi.fn().mockImplementation(async (args) => args.where.kind === "evidence" ? null : closure) },
    runtimeVerification: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  };
  return { db, port: db as unknown as SmallAcceptanceDb };
}
const input = { command: "Drive recovery", result: { observed: "routing blocked" },
  startedAt: new Date("2026-10-26T10:02:00Z"), completedAt: new Date("2026-10-26T10:03:00Z") };
const actor = { principalId: "principal-1", userId: "human-1", agentId: "agent-1" };
beforeEach(() => {
  vi.clearAllMocks(); ports.shape.mockResolvedValue("delivery-small@1.0.0"); ports.paths.mockResolvedValue([]);
  ports.deployment.mockResolvedValue(deployment);
});

describe("Small acceptance canonical context", () => {
  it("locks quiescence before item and room, and derives identity from current facts", async () => {
    const { db, port } = fixture();
    expect(await loadSmallAcceptanceContext({ db: port, workCapsuleId: room.id, closureId: closure.id, lock: true }))
      .toMatchObject({ itemId: item.itemId, closureId: closure.id, servedSha: sha, effectiveShape: "small" });
    expect(db.$queryRawUnsafe.mock.calls.map(c => c[0])).toEqual([
      expect.stringContaining("PlatformConfig"), expect.stringContaining("BacklogItem"),
      expect.stringContaining("WorkCapsule"), expect.stringContaining("SelfUpgradeRun"),
    ]);
  });
  it.each(["delivery-medium@1.0.0", "delivery-large@1.0.0", null])("refuses %s and never lowers the shape", async shape => {
    ports.shape.mockResolvedValue(shape);
    const { port } = fixture();
    await expect(loadSmallAcceptanceContext({ db: port, workCapsuleId: room.id, closureId: closure.id })).rejects.toThrow(/Small/);
  });
  it("refuses raised Small work, a replaced closure and uncertain deployment", async () => {
    const { port } = fixture();
    ports.paths.mockResolvedValue(["apps/web/lib/auth/permissions.ts"]);
    await expect(loadSmallAcceptanceContext({ db: port, workCapsuleId: room.id, closureId: closure.id })).rejects.toThrow(/Small/);
    ports.paths.mockResolvedValue([]);
    await expect(loadSmallAcceptanceContext({ db: port, workCapsuleId: room.id, closureId: "foreign" })).rejects.toThrow(/closure/);
    ports.deployment.mockResolvedValue({ kind: "unavailable" });
    await expect(loadSmallAcceptanceContext({ db: port, workCapsuleId: room.id, closureId: closure.id })).rejects.toThrow(/deployment/);
  });
  it("fails closed on drain, changed item, room head or closure source", async () => {
    for (const change of ["drain", "item", "head", "source"]) {
      const { db, port } = fixture();
      if (change === "drain") db.platformConfig.findUnique.mockResolvedValue({ value: { level: "swapping" } });
      if (change === "item") db.backlogItem.findUnique.mockResolvedValue({ ...item, status: "in-progress" });
      if (change === "head") db.workroom.findUnique.mockResolvedValue({ ...room, headSha: "d".repeat(40) });
      if (change === "source") db.backlogItemActivity.findFirst.mockResolvedValue({ ...closure, payload: { ...closure.payload, deployment: { ...deployment, headSha: "d".repeat(40) } } });
      await expect(loadSmallAcceptanceContext({ db: port, workCapsuleId: room.id, closureId: closure.id })).rejects.toThrow();
    }
  });
});

describe("retained Small binding consumption", () => {
  async function boundFixture() {
    const f = fixture();
    const context = await loadSmallAcceptanceContext({ db: f.port, workCapsuleId: room.id, closureId: closure.id });
    const bound = createSmallAcceptanceBinding({ context, input, actor, now: new Date("2026-10-26T10:04:00Z") });
    const row = { id: "rv-1", workCapsuleId: room.id, backlogActivityId: closure.id, ...input, kind: "final-acceptance", status: "passed",
      createdAt: new Date(bound.recordedAt), result: { ...input.result, [SMALL_ACCEPTANCE_KEY]: bound } };
    f.db.runtimeVerification.findMany.mockResolvedValue([row]);
    return { ...f, row, bound };
  }
  it("accepts exact native binding, with no independent reviewer manufactured", async () => {
    const f = await boundFixture();
    expect(await readRetainedSmallCheck(f.port, item.itemId)).toEqual({ state: "pass", evidenceRefs: ["rv-1"] });
  });
  it("does not reuse a prior generation or unbound historical observation", async () => {
    const f = await boundFixture();
    ports.deployment.mockResolvedValue({ ...deployment, runId: "SUR-2" });
    expect((await readRetainedSmallCheck(f.port, item.itemId)).state).toBe("missing");
    ports.deployment.mockResolvedValue(deployment);
    f.db.runtimeVerification.findMany.mockResolvedValue([{ ...f.row, result: input.result }]);
    expect((await readRetainedSmallCheck(f.port, item.itemId)).state).toBe("missing");
  });
  it("keeps a later failed check and bounded overflow from becoming PASS", async () => {
    const f = await boundFixture();
    f.db.runtimeVerification.findMany.mockResolvedValue([{ ...f.row, id: "failure", status: "failed", result: {}, createdAt: new Date("2026-10-26T10:05:00Z") }, f.row]);
    expect(await readRetainedSmallCheck(f.port, item.itemId)).toEqual({ state: "fail", evidenceRefs: ["failure"] });
    f.db.runtimeVerification.findMany.mockResolvedValue(Array(101).fill(f.row));
    expect((await readRetainedSmallCheck(f.port, item.itemId)).state).toBe("missing");
  });
  it("cannot hide a newer canonical manual/UX failure behind a runtime pass", async () => {
    const f = await boundFixture();
    f.db.backlogItemActivity.findFirst.mockImplementation(async args => args.where.kind === "evidence" ? { id: "new-failure" } : closure);
    expect(await readRetainedSmallCheck(f.port, item.itemId)).toEqual({ state: "fail", evidenceRefs: ["new-failure"] });
  });
  it("rechecks closure after lineage lookup, without trusting a stale page", async () => {
    const f = await boundFixture();
    f.db.backlogItemActivity.findFirst.mockResolvedValueOnce(closure).mockResolvedValueOnce(closure).mockResolvedValueOnce({ ...closure, id: "closure-2" });
    expect((await readRetainedSmallCheck(f.port, item.itemId)).state).toBe("missing");
  });
});
