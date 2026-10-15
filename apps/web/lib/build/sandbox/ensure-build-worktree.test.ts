import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A later phase (review verification, the guard gauntlet) must be able to
// materialize a build's worktree from its branch when the sandbox's worktree
// registry is gone — otherwise every read of `.builds/<id>` fails forever.

const state = vi.hoisted(() => ({ commands: [] as string[] }));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: {
      findUnique: vi.fn(async () => ({
        clientId: "5727856b-3296-4e17-97f0-c59401ace4f2",
        gitAgentEmail: "agent@hive.dpf",
        upstreamRemoteUrl: null,
      })),
    },
  },
}));

vi.mock("./sandbox", () => ({
  execInSandbox: vi.fn(async (_containerId: string, command: string) => {
    state.commands.push(command);
    return "";
  }),
  isSandboxRunning: vi.fn(async () => true),
}));

import { ensureBuildWorktree } from "./build-branch";

const ISOLATION = "DPF_BUILD_WORKTREE_ISOLATION";
const MODE = "DPF_BUILD_WORKSPACE_MODE";
let previous: string | undefined;
let previousMode: string | undefined;

beforeEach(() => {
  state.commands.length = 0;
  previous = process.env[ISOLATION];
  previousMode = process.env[MODE];
  delete process.env[ISOLATION];
  delete process.env[MODE];
});

afterEach(() => {
  if (previous === undefined) delete process.env[ISOLATION];
  else process.env[ISOLATION] = previous;
  if (previousMode === undefined) delete process.env[MODE];
  else process.env[MODE] = previousMode;
});

describe("ensureBuildWorktree", () => {
  // Workspace contract M1: a build gets its own repository by default.
  it("gives the build its own repository on its branch by default, through the sandbox git path", async () => {
    const result = await ensureBuildWorktree("FB-86B4CCA3");

    expect(result).toEqual({ materialized: true, workdir: "/workspace/.builds/FB-86B4CCA3" });
    const clone = state.commands.find((c) => c.includes("git clone"));
    expect(clone).toBeDefined();
    expect(clone).toContain("--reference '/workspace' --dissociate --origin shared");
    expect(clone).toContain("'/workspace/.builds/FB-86B4CCA3'");
    expect(clone).toContain("checkout --quiet -B 'build/FB-86B4CCA3' 'shared/build/FB-86B4CCA3'");
    expect(state.commands.some((c) => c.includes("git worktree add"))).toBe(false);
    const branch = state.commands.find((c) => c.includes('branch --list "build/FB-86B4CCA3"'));
    expect(branch).toContain('git -C /workspace branch "build/FB-86B4CCA3" "client/5727856b-3296-4e17-97f0-c59401ace4f2"');
    expect(clone).toContain("safe.directory");
  });

  it("recreates the build's worktree on its branch when the worktree mode is chosen (rollback)", async () => {
    process.env[MODE] = "worktree";
    const result = await ensureBuildWorktree("FB-86B4CCA3");

    expect(result).toEqual({ materialized: true, workdir: "/workspace/.builds/FB-86B4CCA3" });
    const add = state.commands.find((c) => c.includes("git worktree add"));
    expect(add).toBeDefined();
    expect(add).toContain('git worktree add --force --lock --reason "Build Studio FB-86B4CCA3" /workspace/.builds/FB-86B4CCA3 build/FB-86B4CCA3');
    // The branch is created from the client branch only when it does not exist yet.
    const branch = state.commands.find((c) => c.includes('branch --list "build/FB-86B4CCA3"'));
    expect(branch).toContain('git -C /workspace branch "build/FB-86B4CCA3" "client/5727856b-3296-4e17-97f0-c59401ace4f2"');
    // Every command runs under the sandbox git prelude (safe.directory, hooksPath).
    expect(add).toContain("safe.directory");
  });

  it("is a no-op when worktree isolation is off", async () => {
    process.env[ISOLATION] = "0";

    const result = await ensureBuildWorktree("FB-86B4CCA3");

    expect(result).toEqual({ materialized: false, workdir: "/workspace" });
    expect(state.commands).toEqual([]);
  });
});
