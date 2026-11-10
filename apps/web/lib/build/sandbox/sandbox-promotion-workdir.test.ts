// BI-5C4933EB: executePromotion must extract a build's diff from ITS worktree
// when per-build isolation is on, not from the shared /workspace root.
// Kept apart from sandbox-promotion.test.ts, which is pure-function only.
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractDiff: vi.fn(),
  changePromotionFindUnique: vi.fn(),
  featureBuildUpdate: vi.fn(),
}));

vi.mock("@/lib/sandbox", () => ({
  extractDiff: (...a: unknown[]) => mocks.extractDiff(...a),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    changePromotion: { findUnique: (...a: unknown[]) => mocks.changePromotionFindUnique(...a) },
    featureBuild: { update: (...a: unknown[]) => mocks.featureBuildUpdate(...a) },
  },
}));

import { executePromotion } from "./sandbox-promotion";

const promotion = {
  promotionId: "CP-1",
  status: "approved",
  windowOverrideReason: null,
  productVersion: { featureBuild: { buildId: "FB-1", sandboxId: "sb-1", diffPatch: null } },
  changeItem: { changeRequest: { rfcId: "RFC-1", type: "emergency", riskLevel: "low" } },
};

describe("executePromotion diff extraction", () => {
  const originalIsolation = process.env.DPF_BUILD_WORKTREE_ISOLATION;
  afterEach(() => {
    vi.clearAllMocks();
    if (originalIsolation === undefined) delete process.env.DPF_BUILD_WORKTREE_ISOLATION;
    else process.env.DPF_BUILD_WORKTREE_ISOLATION = originalIsolation;
  });

  it("reads the build's own worktree when isolation is on", async () => {
    delete process.env.DPF_BUILD_WORKTREE_ISOLATION;
    mocks.changePromotionFindUnique.mockResolvedValue(promotion);
    mocks.extractDiff.mockResolvedValue("");

    const result = await executePromotion("CP-1");

    expect(mocks.extractDiff).toHaveBeenCalledWith("sb-1", { workspace: "/workspace/.builds/FB-1" });
    expect(result.step).toBe("extract_diff");
  });

  it("reads /workspace when isolation is off", async () => {
    process.env.DPF_BUILD_WORKTREE_ISOLATION = "0";
    mocks.changePromotionFindUnique.mockResolvedValue(promotion);
    mocks.extractDiff.mockResolvedValue("");

    await executePromotion("CP-1");

    expect(mocks.extractDiff).toHaveBeenCalledWith("sb-1", { workspace: "/workspace" });
  });
});
