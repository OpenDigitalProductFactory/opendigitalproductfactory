import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findBuild: vi.fn(), authority: vi.fn(), wait: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { featureBuild: { findUnique: mocks.findBuild } } }));
vi.mock("@/lib/govern/operation-authority", () => ({ currentOperationAuthority: mocks.authority }));
vi.mock("./sandbox/build-branch", () => ({ isSandboxAvailable: async () => true, startBuildBranch: vi.fn() }));
vi.mock("./sandbox/sandbox-pool", () => ({ waitForSandboxSlot: mocks.wait }));
import { executeStep } from "./build-pipeline";
const state = { step: "pending" as const, retryCount: 0, startedAt: "2026-09-22T00:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findBuild.mockResolvedValue({ createdById: "human" });
  mocks.wait.mockRejectedValue(new Error("test stops at sandbox admission"));
});
describe("build pipeline initiating authority", () => {
  it("uses the build's human owner at sandbox admission", async () => {
    mocks.authority.mockResolvedValue({ userId: "human", platformRole: "HR-300", isSuperuser: false });
    await expect(executeStep("pending", "FB-OWNED", state, vi.fn())).rejects.toThrow("sandbox admission");
    expect(mocks.wait).toHaveBeenCalledWith("FB-OWNED", "human", expect.any(Object));
  });
  it("stops before sandbox work when current permission is absent", async () => {
    mocks.authority.mockResolvedValue(null);
    await expect(executeStep("pending", "FB-OWNED", state, vi.fn())).rejects.toThrow("permission");
    expect(mocks.wait).not.toHaveBeenCalled();
  });
});
