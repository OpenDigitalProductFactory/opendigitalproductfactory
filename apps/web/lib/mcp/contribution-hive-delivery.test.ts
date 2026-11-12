import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  completion: vi.fn().mockResolvedValue(undefined),
  activity: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: { improvementProposal: { updateMany: mocks.updateMany } } }));
vi.mock("@/lib/build/build-pr-delivery-reconciler", () => ({ initializeAndReconcileBuildPrDelivery: vi.fn() }));
vi.mock("@/lib/build-flow-state", () => ({ reconcileBuildCompletion: mocks.completion }));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({ logBuildActivity: mocks.activity }));

import { finalizeHiveContribution } from "./contribution-hive-delivery";

const input = { buildId: "FB-1", packId: "FP-1", prUrl: null, prError: "transport unavailable", totalFiles: 2, dcoAttestation: "attestation" };
beforeEach(() => vi.clearAllMocks());
describe("Hive contribution receipt", () => {
  it("keeps findings local after failed delivery and still reconciles the build", async () => {
    await finalizeHiveContribution(input);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.completion).toHaveBeenCalledWith("FB-1");
  });
  it("marks transport contribution after a PR receipt even if subsequent review failed", async () => {
    await finalizeHiveContribution({ ...input, prUrl: "https://github.com/example/repo/pull/42", prError: "review pending" });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { buildId: "FB-1", contributionStatus: "local" }, data: { contributionStatus: "contributed" } });
  });
});
