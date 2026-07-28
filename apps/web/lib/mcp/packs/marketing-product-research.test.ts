import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  propose: vi.fn(),
}));

vi.mock("@/lib/marketing", () => ({
  getMarketingWorkspaceSnapshot: mocks.snapshot,
}));
vi.mock("@/lib/wiki/research-proposal", () => ({
  proposeResearch: mocks.propose,
}));

import { marketingPack } from "./marketing-pack";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot.mockResolvedValue({ organization: { id: "org-1" } });
  mocks.propose.mockResolvedValue({
    proposalId: "proposal-1",
    created: true,
  });
});

describe("propose_product_research", () => {
  it("declares the approval-gated product research contract", () => {
    expect(
      marketingPack.definitions.find(
        (definition) => definition.name === "propose_product_research",
      ),
    ).toMatchObject({
      requiredCapability: "operate_marketing",
      sideEffect: true,
      coworkerArtifact: true,
      inputSchema: {
        required: ["topic", "query"],
      },
    });
  });

  it("uses the workspace organization and preserves one explicit business scope", async () => {
    const result = await marketingPack.handlers.propose_product_research(
      {
        topic: "customer-choice",
        query: "What changed in customer choice?",
        businessProductId: "product-1",
      },
      "user-1",
      { agentId: "marketing-specialist" },
    );

    expect(result).toMatchObject({
      success: true,
      entityId: "proposal-1",
    });
    expect(mocks.propose).toHaveBeenCalledWith({
      organizationId: "org-1",
      digitalProductId: null,
      productLineId: null,
      businessProductId: "product-1",
      topic: "customer-choice",
      query: "What changed in customer choice?",
      proposedBy: "user",
    });
  });

  it("does not fabricate an organization when no workspace exists", async () => {
    mocks.snapshot.mockResolvedValue(null);

    const result = await marketingPack.handlers.propose_product_research(
      { topic: "market", query: "What changed?" },
      "user-1",
    );

    expect(result).toMatchObject({ success: false, error: "no-workspace" });
    expect(mocks.propose).not.toHaveBeenCalled();
  });
});
