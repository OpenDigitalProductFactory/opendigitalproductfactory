import { describe, expect, it } from "vitest";

import { presentLaunchInstructions } from "./launch-presenter";

describe("presentLaunchInstructions", () => {
  it("returns the Windows command sequence", () => {
    const steps = presentLaunchInstructions(
      {
        capsuleId: "WC-LAUNCH01",
        headBranch: "feat/work-control",
        worktreePath: "D:\\DPF-work-control",
        baseBranch: "main",
      },
      "win32",
    );

    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0].command).toContain("git worktree add");
    expect(steps[0].command).toContain("D:\\DPF-work-control");
    expect(steps[0].command).toContain("feat/work-control");
    expect(steps[0].command).toContain("origin/main");
    expect(steps[1].command).toContain("scripts\\seed-worktree-mcp.ps1");
    expect(steps[1].command).toContain("-Target");
  });

  it("returns the Unix command sequence for macOS/Linux", () => {
    const steps = presentLaunchInstructions(
      {
        capsuleId: "WC-LAUNCH02",
        headBranch: "feat/work-control",
        worktreePath: "/Users/mark/dpf-worktrees/work-control",
        baseBranch: "main",
      },
      "darwin",
    );

    expect(steps[0].command).toContain("git worktree add");
    expect(steps[1].command).toMatch(/scripts\/seed-worktree-mcp\.sh\s+"\/Users\/mark/);
  });

  it("returns an empty plan when fields are missing", () => {
    const steps = presentLaunchInstructions(
      { capsuleId: "WC-UNPLANNED", headBranch: null, worktreePath: null, baseBranch: null },
      "win32",
    );

    expect(steps).toEqual([]);
  });
});
