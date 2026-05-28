import { describe, expect, it } from "vitest";
import { getBuildStudioCapabilityPack, listBuildStudioCapabilityPacks } from "./capability-packs";

describe("Build Studio capability packs", () => {
  it("loads the six core packs and keeps skill ids stable", () => {
    const packs = listBuildStudioCapabilityPacks();
    expect(packs.map((pack) => pack.id)).toEqual([
      "architecture",
      "design",
      "implementation",
      "verification",
      "review-ship",
      "recovery",
    ]);
    expect(getBuildStudioCapabilityPack("review-ship").skillIds).toContain("dpf-local-merge-ci-before-push");
    expect(getBuildStudioCapabilityPack("implementation").skillIds).toContain("dpf-use-shared-nonprod-environment");
  });

  it("offers the advisory chief-architect review in the planning and review packs", () => {
    expect(getBuildStudioCapabilityPack("architecture").skillIds).toContain("dpf-architecture-review");
    expect(getBuildStudioCapabilityPack("review-ship").skillIds).toContain("dpf-architecture-review");
  });
});
