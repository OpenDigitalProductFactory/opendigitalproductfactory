import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  completion: vi.fn().mockResolvedValue(undefined),
  activity: vi.fn(),
  initialize: vi.fn().mockResolvedValue({ captured: 1, state: { status: "checking" }, action: null, actuated: false }),
}));
vi.mock("@dpf/db", () => ({ prisma: { improvementProposal: { updateMany: mocks.updateMany } } }));
vi.mock("@/lib/build/build-pr-delivery-reconciler", () => ({ initializeAndReconcileBuildPrDelivery: mocks.initialize }));
vi.mock("@/lib/build-flow-state", () => ({ reconcileBuildCompletion: mocks.completion }));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({ logBuildActivity: mocks.activity }));

import { finalizeHiveContribution, reconcileHiveContributionDelivery } from "./contribution-hive-delivery";

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

it("binds the exact published source when initializing Hive PR delivery", async () => {
  const publishedHeadSha = "a".repeat(40);
  await reconcileHiveContributionDelivery({
    buildId: "FB-1", prUrl: "https://github.com/example/repo/pull/42",
    token: "synthetic-test-token", publishedHeadSha, eligible: true,
  });
  expect(mocks.initialize).toHaveBeenCalledWith(expect.objectContaining({
    owner: "example", repo: "repo", prNumber: 42, publishedHeadSha, eligible: true,
  }));
});
