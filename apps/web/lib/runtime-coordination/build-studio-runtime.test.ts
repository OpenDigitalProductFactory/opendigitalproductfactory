import { describe, expect, it } from "vitest";

import { buildBuildStudioSandboxTargetInput } from "./build-studio-runtime";

describe("buildBuildStudioSandboxTargetInput", () => {
  it("projects a Build Studio sandbox branch into a runtime target without FK drift", () => {
    const input = buildBuildStudioSandboxTargetInput({
      buildRowId: "feature-build-row-1",
      buildId: "FB-123",
      capsuleRowId: "capsule-row-1",
      containerName: "dpf-sandbox-1",
      hostPort: 3035,
      branchName: "build/FB-123",
    });

    expect(input).toMatchObject({
      targetId: "RT-BUILD-SANDBOX-FB-123",
      kind: "build-sandbox",
      status: "running",
      featureBuildId: "feature-build-row-1",
      workCapsuleId: "capsule-row-1",
      containerName: "dpf-sandbox-1",
      hostUrl: "http://localhost:3035",
      port: 3035,
      metadata: {
        buildId: "FB-123",
        buildBranch: "build/FB-123",
      },
    });
    expect(input).not.toHaveProperty("sandboxId");
  });
});
