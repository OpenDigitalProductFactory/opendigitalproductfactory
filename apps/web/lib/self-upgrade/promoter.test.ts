import { describe, expect, it } from "vitest";

import { buildPromoterDockerArgs, shellQuote } from "./promoter";

const config = {
  enabled: true,
  hostInstallPath: "D:/DPF",
  hostSourceMountPath: "/host-source",
  composeProject: "dpf",
  portalContainerName: "dpf-portal-1",
  dbContainerName: "dpf-postgres-1",
  repositoryRemote: "origin",
  repositoryBranch: "main",
  healthUrl: "http://localhost:3000/api/health",
};

describe("shellQuote", () => {
  it("single-quotes values safely for POSIX shells", () => {
    expect(shellQuote("a'b")).toBe("'a'\"'\"'b'");
  });
});

describe("buildPromoterDockerArgs", () => {
  it("runs the promoter in self-upgrade mode with a writable host source mount", () => {
    const args = buildPromoterDockerArgs(config, "SUR-123");

    expect(args).toContain("run");
    expect(args).toContain("--name");
    expect(args).toContain("dpf-promoter-self-upgrade-SUR-123");
    expect(args).toContain("-v");
    expect(args).toContain("D:/DPF:/host-source");
    expect(args).toContain("-e");
    expect(args).toContain("SELF_UPGRADE=1");
    expect(args).toContain("dpf-promoter");
    expect(args).toContain("--self-upgrade");
  });
});
