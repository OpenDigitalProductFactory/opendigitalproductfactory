import { beforeEach, describe, expect, it, vi } from "vitest";

// The assembled-change capture is the one primitive both build paths share:
// it must commit in-flight work, record the diff + commits, and (when asked)
// fold the post-commit source identity into buildExecState for sandbox-state.

const state = vi.hoisted(() => ({
  commands: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  execState: { containerId: "dpf-sandbox-1", step: "complete" } as Record<string, unknown> | null,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: vi.fn(async ({ select }: { select: Record<string, boolean> }) =>
        select.buildExecState
          ? { buildExecState: state.execState }
          : { title: "Add fulfillment fields", designDoc: null, buildPlan: null }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        return {};
      }),
    },
  },
}));

vi.mock("./sandbox/sandbox", () => ({
  execInSandbox: vi.fn(async (_c: string, command: string) => {
    state.commands.push(command);
    if (command.includes("headTreeSha")) {
      return ["branch=build/FB-1", "headSha=" + "b".repeat(40), "headTreeSha=" + "c".repeat(40), "targetSha=" + "d".repeat(40), "targetTreeSha=" + "e".repeat(40), "mergeBaseSha=" + "d".repeat(40), "aheadBehind=2\t0", "dirty=false", "localSourceChangeCount=3"].join("\n");
    }
    return "";
  }),
  extractDiff: vi.fn(async () => "diff --git a/x b/x\n+1\n"),
  listSandboxCommitsAheadOfBase: vi.fn(async () => ["abc123", "def456"]),
}));

vi.mock("./sandbox/build-branch", () => ({
  getClientIdentity: vi.fn(async () => ({ clientBranch: "client/5727856b" })),
  resolveBuildWorkdir: vi.fn((buildId: string) => `/workspace/.builds/${buildId}`),
  buildSandboxCommitInFlightWorkCommand: vi.fn((workdir: string) => `commit-in-flight ${workdir}`),
}));

vi.mock("./change-narrative", () => ({
  generateChangeNarrative: vi.fn(async () => null),
}));

import { captureAssembledChange } from "./capture-assembled-change";

beforeEach(() => {
  state.commands.length = 0;
  state.updates.length = 0;
  state.execState = { containerId: "dpf-sandbox-1", step: "complete" };
});

describe("captureAssembledChange", () => {
  it("commits in-flight work in the build's worktree, then records diff, commits and source identity", async () => {
    const result = await captureAssembledChange({ buildId: "FB-1", containerId: "dpf-sandbox-1" });

    expect(state.commands[0]).toBe("commit-in-flight /workspace/.builds/FB-1");
    expect(result.diffPatch).toContain("diff --git");
    expect(result.commitHashes).toEqual(["abc123", "def456"]);
    expect(result.sourceCurrency).toMatchObject({ headTreeSha: "c".repeat(40), targetTreeSha: "e".repeat(40), dirty: false });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ diffPatch: result.diffPatch, gitCommitHashes: ["abc123", "def456"] });
  });

  it("folds the source identity into buildExecState when asked, keeping the rest of the state", async () => {
    await captureAssembledChange({ buildId: "FB-1", containerId: "dpf-sandbox-1", persistSourceCurrency: true });

    const execWrite = state.updates.find((u) => "buildExecState" in u) as { buildExecState: Record<string, unknown> };
    expect(execWrite).toBeDefined();
    expect(execWrite.buildExecState.containerId).toBe("dpf-sandbox-1");
    expect(execWrite.buildExecState.sourceCurrency).toMatchObject({ headTreeSha: "c".repeat(40) });
  });

  it("starts an exec state from nothing for a build that never ran the legacy pipeline", async () => {
    state.execState = null;

    await captureAssembledChange({ buildId: "FB-1", containerId: "dpf-sandbox-1", persistSourceCurrency: true });

    const execWrite = state.updates.find((u) => "buildExecState" in u) as { buildExecState: Record<string, unknown> };
    expect(Object.keys(execWrite.buildExecState)).toEqual(["sourceCurrency"]);
  });
});
