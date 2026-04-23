import { describe, expect, it } from "vitest";
import {
  BUILD_STUDIO_TEST_IDS,
  getBuildStudioGraphPanelClassName,
  getBuildStudioShellClassName,
  getBuildStudioSidebarClassName,
} from "@/components/build/build-studio-layout";
import { resolveBuildStudioBranchBadge } from "@/components/build/build-studio-branch-badge";

describe("build-studio-layout", () => {
  it("keeps the studio shell immersive without viewport-coupled sizing", () => {
    expect(getBuildStudioShellClassName()).toContain("flex");
    expect(getBuildStudioShellClassName()).toContain("min-h-full");
    expect(getBuildStudioShellClassName()).not.toContain("100vh");
  });

  it("keeps the graph panel container-driven instead of using old fullscreen math", () => {
    expect(getBuildStudioGraphPanelClassName()).toContain("min-h-[420px]");
    expect(getBuildStudioGraphPanelClassName()).toContain("flex-1");
    expect(getBuildStudioGraphPanelClassName()).not.toContain("100vh");
  });

  it("uses narrower desktop sidebar widths and stable shell test ids", () => {
    expect(getBuildStudioSidebarClassName(true)).toContain("xl:w-[320px]");
    expect(getBuildStudioSidebarClassName(true)).not.toContain("lg:w-[360px]");
    expect(getBuildStudioSidebarClassName(false)).toContain("w-0");
    expect(BUILD_STUDIO_TEST_IDS.shell).toBe("build-studio-shell");
    expect(BUILD_STUDIO_TEST_IDS.graphPanel).toBe("build-studio-graph-panel");
  });
});

describe("resolveBuildStudioBranchBadge", () => {
  it("prefers the PR submission branch over the workspace checkout branch", () => {
    expect(resolveBuildStudioBranchBadge({
      submissionBranch: "dpf/abc12345/code-graph-ship-test",
      workspaceBranch: "main",
    })).toEqual({
      kind: "submission",
      value: "dpf/abc12345/code-graph-ship-test",
      title: "Submission branch",
    });
  });

  it("falls back to the workspace branch when no submission branch is available", () => {
    expect(resolveBuildStudioBranchBadge({
      submissionBranch: null,
      workspaceBranch: "main",
    })).toEqual({
      kind: "workspace",
      value: "main",
      title: "Workspace branch",
    });
  });

  it("derives the submission branch from the install short id and build title", () => {
    expect(resolveBuildStudioBranchBadge({
      submissionBranchShortId: "abc12345",
      buildTitle: "Code Graph Ship Test",
      workspaceBranch: "main",
    })).toEqual({
      kind: "submission",
      value: "dpf/abc12345/code-graph-ship-test",
      title: "Submission branch",
    });
  });
});
