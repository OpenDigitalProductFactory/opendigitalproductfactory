import { describe, expect, it } from "vitest";
import { buildGitPromotionVerificationScript } from "./git-promotion-sandbox-verification";

describe("buildGitPromotionVerificationScript", () => {
  it("clones the repository, checks out the exact SHA, and runs the build gates", () => {
    const script = buildGitPromotionVerificationScript({
      repositoryCloneUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
      afterSha: "abc123",
      candidateId: "GPC-123",
    });

    expect(script).toContain("git clone --depth 1");
    expect(script).toContain("git fetch --depth 1 origin 'abc123'");
    expect(script).toContain("git checkout --detach 'abc123'");
    expect(script).toContain("pnpm install --frozen-lockfile");
    expect(script).toContain("NODE_OPTIONS=--max-old-space-size=24576 pnpm --filter web typecheck");
    expect(script).toContain("NODE_OPTIONS=--max-old-space-size=24576 pnpm --filter web build");
    expect(script).not.toContain("executePromotion");
  });
});
