// BI-B6894001: a build parked on an owner answer is skipped by the boot sweeps
// that would resume, age out or complete it. Split from instrumentation.test.ts,
// which is at its size baseline.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { featureBuildFindManyMock } = vi.hoisted(() => ({ featureBuildFindManyMock: vi.fn() }));

vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceLevel: async () => "normal" }));
vi.mock("@/lib/build/merged-ship-room-settlement", () => ({ settleMergedShipBuildRoomsNow: async () => undefined }));
vi.mock("@/lib/build-flow-state", () => ({
  reconcileBuildCompletion: async () => false,
  completeLocalDeliveryBuild: async () => false,
}));
vi.mock("@/lib/self-upgrade/completion", () => ({ isFeatureBuildDeployed: async () => false }));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findMany: (...a: unknown[]) => featureBuildFindManyMock(...a) },
    buildActivity: { create: async () => ({}), findMany: async () => [], findFirst: async () => null },
  },
  Prisma: { DbNull: { __dbnull: true }, JsonNull: { __jsonnull: true } },
}));

import { reconcileDeployedShipBuilds, resumeStrandedBuildsOnBoot } from "./instrumentation";

const quiet = { log: vi.fn(), error: vi.fn() };
const whereOf = () => (featureBuildFindManyMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

beforeEach(() => {
  featureBuildFindManyMock.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  delete process.env.DPF_AUTO_COMPLETE_VERIFIED_BUILDS;
});

describe("boot sweeps skip a build parked on an owner answer (BI-B6894001)", () => {
  it("the stranded-build resumer neither resumes nor ages out a parked build", async () => {
    const resumePreBuild = vi.fn();
    const abandonStale = vi.fn();
    await resumeStrandedBuildsOnBoot({ dispatch: vi.fn(), resumePreBuild, abandonStale }, quiet);
    expect(whereOf().waitingOnOwnerSince).toBeNull();
    expect(resumePreBuild).not.toHaveBeenCalled();
    expect(abandonStale).not.toHaveBeenCalled();
  });

  it("the ship reconciler leaves a parked ship build alone", async () => {
    process.env.DPF_AUTO_COMPLETE_VERIFIED_BUILDS = "1";
    await reconcileDeployedShipBuilds(quiet);
    expect(whereOf()).toEqual({ phase: "ship", waitingOnOwnerSince: null });
  });
});
