import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findBuild: vi.fn(), update: vi.fn(), move: vi.fn(), log: vi.fn(),
  reconcile: vi.fn(), readiness: vi.fn(), send: vi.fn(), escalate: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  featureBuild: { findUnique: mocks.findBuild, update: mocks.update, updateMany: mocks.move },
  buildActivity: { create: mocks.log },
} }));
vi.mock("./heal-build-workroom-shape", () => ({ reconcileReviewBuildWorkroomShape: mocks.reconcile }));
vi.mock("./build-entry-gate", () => ({ enforceBuildInitiativeReadiness: mocks.readiness }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: mocks.send } }));
vi.mock("./escalate-build-to-human", () => ({ escalateBuildToHuman: mocks.escalate }));

import { routeGauntletFailureToRepair } from "./gauntlet-repair";

const failure = { treeSha: "retained-tree", recordId: "existing-guard-evidence", failedGuards: ["Docs Impact"] };
const nativeRoom = { id: "room-row", capsuleId: "WC-FIXTURE" };
const build = {
  id: "build-row", buildId: "FB-FIXTURE", phase: "review", title: "Labelled recovery fixture",
  originatingBacklogItemId: "item-row", verificationOut: { retainedEvidence: "must survive" },
  buildExecState: { step: "complete", retained: "keep", error: "old failure" },
};

describe("review repair metadata recovery (BI-1173F1CC)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findBuild.mockResolvedValue(structuredClone(build));
    mocks.move.mockResolvedValue({ count: 1 });
    mocks.log.mockResolvedValue({});
    mocks.reconcile.mockResolvedValue({ kind: "ready", healed: false, room: nativeRoom, detail: "already shaped" });
    mocks.readiness.mockResolvedValue({ allowed: true });
  });

  it("restores absent metadata before readiness and retains the consumed repair count", async () => {
    let bound = false;
    mocks.findBuild.mockResolvedValue({ ...build, verificationOut: { ...build.verificationOut, gauntletRepair: { ...failure, attempts: 1 } } });
    mocks.reconcile.mockImplementation(async () => {
      bound = true;
      return { kind: "ready", healed: true, room: nativeRoom, detail: "bound from owning item" };
    });
    mocks.readiness.mockImplementation(async () => ({ allowed: bound, message: "PLAN_REQUIRED" }));
    expect(await routeGauntletFailureToRepair(build.buildId, failure)).toBe("repair-queued");
    expect(mocks.reconcile).toHaveBeenCalledWith({ buildId: build.buildId });
    expect(mocks.move.mock.calls[0]![0].data.verificationOut).toMatchObject({
      retainedEvidence: "must survive", gauntletRepair: { ...failure, attempts: 2 },
    });
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("holds ambiguous metadata without readiness, mutation or dispatch", async () => {
    mocks.reconcile.mockResolvedValue({ kind: "held", detail: "native room ownership is ambiguous" });
    expect(await routeGauntletFailureToRepair(build.buildId, failure)).toBe("not-ready");
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("keeps a real plan denial after metadata repair with no phase or budget mutation", async () => {
    mocks.reconcile.mockResolvedValue({ kind: "ready", healed: true, room: nativeRoom, detail: "shape bound" });
    mocks.readiness.mockResolvedValue({ allowed: false, message: "PLAN_REQUIRED: current access-sensitive plan still owes independent review" });
    expect(await routeGauntletFailureToRepair(build.buildId, failure)).toBe("not-ready");
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.readiness).toHaveBeenCalledWith({ buildId: build.buildId, target: "implementation", targetPhase: "build", expectedPhase: "review", expectedWorkroom: nativeRoom });
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not replenish exhausted attempts by healing or re-dispatching", async () => {
    mocks.findBuild.mockResolvedValue({ ...build, verificationOut: { gauntletRepair: { ...failure, attempts: 2 } } });
    expect(await routeGauntletFailureToRepair(build.buildId, failure)).toBe("escalated");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.escalate).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0]![0].data.verificationOut.gauntletRepair).toMatchObject({ attempts: 2, escalated: true });
  });
});
