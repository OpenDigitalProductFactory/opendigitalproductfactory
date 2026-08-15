import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  featureBuildFindUnique: vi.fn(),
  loadStatuses: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findUnique: mocks.featureBuildFindUnique },
    workroom: { findMany: vi.fn() },
    buildActivity: { groupBy: vi.fn() },
  },
}));
vi.mock("@/lib/build/customer-status-loader", () => ({
  loadBuildStudioCustomerStatuses: mocks.loadStatuses,
}));

import { getFeatureBuildCustomerStatus } from "@/lib/actions/build-read";

describe("getFeatureBuildCustomerStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("reloads the capsule-backed owner status for one build", async () => {
    const build = {
      id: "build-row-1",
      buildId: "FB-9B19098C",
      title: "Fix Build Studio status",
      phase: "build",
      updatedAt: new Date("2026-08-12T13:00:00.000Z"),
    };
    const status = {
      whatIsBeingBuilt: build.title,
      lifecyclePosition: "Building the change",
      worker: "Build Studio",
      evidence: "Implementation is active.",
      nextAction: "No action needed.",
      owner: "Build Studio",
      needsYou: false,
    };
    mocks.featureBuildFindUnique.mockResolvedValue(build);
    mocks.loadStatuses.mockResolvedValue({ [build.id]: status });

    await expect(getFeatureBuildCustomerStatus(build.buildId)).resolves.toEqual(status);
    expect(mocks.featureBuildFindUnique).toHaveBeenCalledWith({
      where: { buildId: build.buildId },
      select: { id: true, buildId: true, title: true, phase: true, updatedAt: true },
    });
    expect(mocks.loadStatuses).toHaveBeenCalledWith(expect.anything(), [build]);
  });

  it("does not query build state without an authenticated user", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(getFeatureBuildCustomerStatus("FB-9B19098C")).resolves.toBeNull();
    expect(mocks.featureBuildFindUnique).not.toHaveBeenCalled();
  });
});
