import { beforeEach, describe, expect, it, vi } from "vitest";

const featureBuild = vi.hoisted(() => ({ findUnique: vi.fn() }));
const workroom = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }));
const transaction = vi.hoisted(() => vi.fn());
const queryRaw = vi.hoisted(() => vi.fn());
const attach = vi.hoisted(() => vi.fn());
const bind = vi.hoisted(() => vi.fn());
const admitCoworkers = vi.hoisted(() => vi.fn());
vi.mock("@dpf/db", () => ({ prisma: { featureBuild, workroom, $transaction: transaction, $queryRaw: queryRaw } }));
vi.mock("@/lib/work-capsules/build-studio-attachment", () => ({
  attachBuildStudioWorkCapsule: attach,
  bindBuildStudioDeliveryShape: bind,
}));
vi.mock("@/lib/work-capsules/build-studio-room-coworkers", () => ({
  admitBuildStudioRoomCoworkers: admitCoworkers,
  describeBuildStudioRoomCoworkers: () => "",
}));

import { healBuildWorkroomShape, reconcileReviewBuildWorkroomShape } from "./heal-build-workroom-shape";

const BUILD = {
  id: "row-1", buildId: "FB-600E0A08", title: "Required evidence parts", description: null, phase: "plan", createdById: "user-1",
  originator: { id: "bi-row", itemId: "BI-68E14C0B", title: "Required evidence parts", body: "## Acceptance\n- x", epicId: null, taxonomyNodeId: null, effortSize: "small", workType: "feature" },
};

describe("healBuildWorkroomShape (BI-C60EB507)", () => {
  beforeEach(() => {
    featureBuild.findUnique.mockReset();
    workroom.findFirst.mockReset();
    attach.mockReset();
    bind.mockReset();
    admitCoworkers.mockReset().mockResolvedValue({ admitted: [] });
  });

  it("attaches a room (which binds the shape) when the build has none", async () => {
    featureBuild.findUnique.mockResolvedValue(BUILD);
    workroom.findFirst.mockResolvedValue(null);
    attach.mockResolvedValue({ capsuleId: "WC-NEW" });
    const r = await healBuildWorkroomShape({ buildId: "FB-600E0A08", userId: "fallback" });
    expect(r.healed).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    const args = attach.mock.calls[0]![0] as { backlogItem: { effortSize: string }; actor: { userId: string } };
    expect(args.backlogItem.effortSize).toBe("small");
    expect(args.actor.userId).toBe("user-1");
  });

  it("binds the shape on an existing room that carries no workShape claim", async () => {
    featureBuild.findUnique.mockResolvedValue(BUILD);
    workroom.findFirst.mockResolvedValue({ capsuleId: "WC-B7844866", scopeClaims: [] });
    bind.mockResolvedValue({ bound: "delivery-small@1.0.0", reason: "derived" });
    const r = await healBuildWorkroomShape({ buildId: "FB-600E0A08", userId: "u" });
    expect(r.healed).toBe(true);
    expect(attach).not.toHaveBeenCalled();
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-B7844866" }));
  });

  it("is idempotent once a shape is bound, and refuses to invent a subject", async () => {
    featureBuild.findUnique.mockResolvedValue(BUILD);
    workroom.findFirst.mockResolvedValue({
      capsuleId: "WC-1",
      scopeClaims: [{ workShape: "delivery-small@1.0.0", recordedAt: "2026-09-23T00:00:00.000Z" }],
    });
    const r = await healBuildWorkroomShape({ buildId: "FB-600E0A08", userId: "u" });
    expect(r.healed).toBe(false);
    expect(bind).not.toHaveBeenCalled();
    featureBuild.findUnique.mockResolvedValue({ ...BUILD, originator: null });
    expect((await healBuildWorkroomShape({ buildId: "FB-600E0A08", userId: "u" })).healed).toBe(false);
  });
});

describe("existing-room review reconciliation (BI-1173F1CC)", () => {
  const currentBuild = {
    ...BUILD, phase: "review", originatingBacklogItemId: BUILD.originator.id,
    originator: { ...BUILD.originator, updatedAt: new Date("2026-11-12T00:00:00Z") },
    updatedAt: new Date("2026-11-12T00:00:00Z"), buildBranch: "build/FB-600E0A08", sandboxId: "existing-sandbox",
  };
  const room = {
    id: "room-row", capsuleId: "WC-FIXTURE", executorKind: "build-studio", executorRef: BUILD.buildId,
    featureBuildId: BUILD.id, backlogItemId: BUILD.originator.id, status: "working", archivedAt: null,
    headSha: "a".repeat(40), updatedAt: new Date("2026-11-12T00:00:00Z"),
    scopeClaims: [{ kind: "path", value: "apps/web/lib/example.ts", intent: "edit", releaseEpoch: "retained-epoch" }],
  };
  beforeEach(() => {
    vi.resetAllMocks();
    featureBuild.findUnique.mockResolvedValue(structuredClone(currentBuild));
    workroom.findMany.mockResolvedValue([structuredClone(room)]);
    workroom.updateMany.mockResolvedValue({ count: 1 });
    queryRaw.mockResolvedValue([]);
    transaction.mockImplementation(async (run: (db: unknown) => Promise<unknown>) => run({ featureBuild, workroom, $queryRaw: queryRaw }));
  });

  it("appends only the canonical derived claim, preserving ownership metadata", async () => {
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "ready", healed: true });
    const write = workroom.updateMany.mock.calls[0]![0];
    expect(Object.keys(write.data)).toEqual(["scopeClaims"]);
    expect(write.data.scopeClaims[0]).toEqual(room.scopeClaims[0]);
    expect(write.data.scopeClaims[1]).toMatchObject({ workShape: "delivery-small@1.0.0", source: "derived" });
    expect(write.where).toMatchObject({ id: room.id, capsuleId: room.capsuleId, updatedAt: room.updatedAt, scopeClaims: { equals: room.scopeClaims } });
    expect(attach).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalled();
    expect(admitCoworkers).not.toHaveBeenCalled();
  });

  it("retains an existing valid pinned shape without writing or admitting anyone", async () => {
    workroom.findMany.mockResolvedValue([{ ...room, scopeClaims: [{ workShape: "delivery-medium@1.0.0" }] }]);
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "ready", healed: false });
    expect(workroom.updateMany).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(admitCoworkers).not.toHaveBeenCalled();
  });

  it.each([
    [{ workShape: "broken" }], [{ workShape: null }], [{ workShape: "unknown@1.0.0" }],
    [{ workShapeKey: "delivery-small" }],
    [{ workShape: "delivery-small@1.0.0" }, { workShape: "delivery-medium@1.0.0" }],
    [{ workShape: "delivery-small@1.0.0", workShapeKey: "delivery-medium", workShapeVersion: "1.0.0" }],
    [null],
  ])("holds malformed or conflicting declarations: %j", async (...entries) => {
    workroom.findMany.mockResolvedValue([{ ...room, scopeClaims: entries }]);
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(workroom.updateMany).not.toHaveBeenCalled();
  });

  it.each([null, { ...currentBuild, originator: null }, { ...currentBuild, createdById: "" }, { ...currentBuild, phase: "ship" }])("holds an absent or invalid governing build: %j", async (value) => {
    featureBuild.findUnique.mockResolvedValue(value);
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(workroom.updateMany).not.toHaveBeenCalled();
  });

  it.each([[], [room, room], [{ ...room, featureBuildId: "foreign" }], [{ ...room, backlogItemId: "foreign" }]].map(rooms => ({ rooms })))("holds missing, ambiguous or foreign rooms: %j", async ({ rooms }) => {
    workroom.findMany.mockResolvedValue(rooms);
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(workroom.updateMany).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("does not guess an unsized item's shape", async () => {
    featureBuild.findUnique.mockResolvedValue({ ...currentBuild, originator: { ...currentBuild.originator, effortSize: null } });
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(workroom.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a room whose source changes after observation", async () => {
    workroom.findMany.mockResolvedValueOnce([room]).mockResolvedValue([{ ...room, headSha: "b".repeat(40) }]);
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(workroom.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an actor change between observation and locked admission", async () => {
    featureBuild.findUnique.mockResolvedValueOnce(currentBuild).mockResolvedValueOnce(currentBuild)
      .mockResolvedValue({ ...currentBuild, createdById: "different-actor" });
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(workroom.updateMany).not.toHaveBeenCalled();
  });

  it("does not overwrite a concurrent declaration or retry a lost CAS", async () => {
    workroom.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(workroom.updateMany).toHaveBeenCalledOnce();
  });

  it("holds timestamp-only source changes instead of canonicalizing Dates as empty objects", async () => {
    featureBuild.findUnique.mockResolvedValueOnce(currentBuild).mockResolvedValueOnce(currentBuild)
      .mockResolvedValue({ ...currentBuild, originator: { ...currentBuild.originator, updatedAt: new Date("2026-11-12T00:01:00Z") } });
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(workroom.updateMany).not.toHaveBeenCalled();
  });

  it("holds transaction failure without consuming an automatic retry", async () => {
    transaction.mockRejectedValue(new Error("fixture serialization conflict"));
    expect(await reconcileReviewBuildWorkroomShape({ buildId: BUILD.buildId })).toMatchObject({ kind: "held" });
    expect(transaction).toHaveBeenCalledOnce();
    expect(workroom.updateMany).not.toHaveBeenCalled();
    expect(admitCoworkers).not.toHaveBeenCalled();
  });
});
