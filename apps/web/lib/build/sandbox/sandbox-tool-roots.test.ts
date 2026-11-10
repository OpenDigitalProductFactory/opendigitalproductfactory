import { afterEach, describe, expect, it, vi } from "vitest";

import { sandboxToolRoots } from "./sandbox-tool-roots";

describe("sandboxToolRoots", () => {
  afterEach(() => vi.unstubAllEnvs());

  // BI-972A386D: with worktree isolation on, the build branch, its commit and its
  // verification live in /workspace/.builds/<id>, but the agentic file and command
  // tools were hard-wired to the shared /workspace root. FB-8255C0E5's specialist
  // edited BuildStudio.tsx and page.tsx in the shared root; its build branch
  // reached review with no commit at all.
  it("roots the tools at the build's own worktree when isolation is on", () => {
    vi.stubEnv("DPF_BUILD_WORKTREE_ISOLATION", "1");
    expect(sandboxToolRoots("FB-8255C0E5")).toEqual({
      workdir: "/workspace/.builds/FB-8255C0E5",
      mount: "/sandbox-workspace/.builds/FB-8255C0E5",
    });
  });

  it("keeps the shared tree when isolation is rolled back", () => {
    vi.stubEnv("DPF_BUILD_WORKTREE_ISOLATION", "0");
    expect(sandboxToolRoots("FB-8255C0E5")).toEqual({
      workdir: "/workspace",
      mount: "/sandbox-workspace",
    });
  });
});
