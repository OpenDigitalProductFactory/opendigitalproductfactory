// BI-76BD65E6 (follow-up, live 2026-10-13 → 2026-10-28): FB-2F2D46D5's ship
// refresh failed while fast-forwarding the shared client branch, and the
// refresh had already recorded the CLIENT branch's snapshot ("behind", 0
// ahead) onto the build. The build then looked merely behind, the refresh
// (which acted only on "diverged") never retried, and its PR was refused
// hourly for 15 days. The failure itself was unreadable: only the first 300
// characters of the docker exec message were kept — the command line.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  featureBuildUpdate: vi.fn(),
  activityCreate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: {
      findUnique: vi.fn(async () => ({ clientId: "abc", gitAgentEmail: "agent-abc12345@dpf.local", upstreamRemoteUrl: null })),
    },
    featureBuild: { findUnique: vi.fn(async () => ({ buildExecState: {} })), update: mocks.featureBuildUpdate },
    buildActivity: { create: mocks.activityCreate },
  },
}));
vi.mock("./sandbox", () => ({ execInSandbox: mocks.exec, isSandboxRunning: vi.fn(async () => true) }));

import { refreshBuildBranchOntoUpstream } from "./build-branch";
import { errorTail } from "../error-tail";

const behindProbe = [
  "branch=client/abc",
  `headSha=${"d".repeat(40)}`,
  `headTreeSha=${"e".repeat(40)}`,
  `targetSha=${"0".repeat(40)}`,
  `targetTreeSha=${"f".repeat(40)}`,
  `mergeBaseSha=${"d".repeat(40)}`,
  "aheadBehind=0\t133",
  "dirty=false",
  "localSourceChangeCount=0",
].join("\n");

const gitReason = "fatal: Unable to create '/workspace/.git/index.lock': File exists.";

beforeEach(() => {
  mocks.exec.mockReset();
  mocks.featureBuildUpdate.mockReset();
  mocks.activityCreate.mockReset().mockResolvedValue({});
  mocks.exec.mockImplementation(async (_container: string, command: string) => {
    if (command.includes("reset --hard")) {
      throw new Error(`Command failed: docker exec 'dpf-sandbox-1' sh -c '${"git config --global --get-all safe.directory … ".repeat(20)}'\n${gitReason}`);
    }
    if (command.includes("aheadBehind=")) return behindProbe;
    if (command.includes("fetch origin main")) return "";
    if (command.includes("rev-parse --abbrev-ref HEAD")) return "client/abc\n";
    return "";
  });
});

describe("refreshBuildBranchOntoUpstream — a failed client fast-forward", () => {
  it("records nothing onto the build and keeps git's reason", async () => {
    const outcome = await refreshBuildBranchOntoUpstream("FB-2F2D46D5");

    expect(outcome.status).toBe("client-not-refreshable");
    expect((outcome as { reason: string }).reason).toContain(gitReason);
    // The build's own snapshot is untouched: neither its exec state nor an activity row was written.
    expect(mocks.featureBuildUpdate).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });
});

describe("errorTail", () => {
  it("keeps a short message whole and the end of a long one", () => {
    expect(errorTail(new Error("short"))).toBe("short");
    const tail = errorTail(new Error(`${"x".repeat(1000)}${gitReason}`));
    expect(tail.startsWith("…")).toBe(true);
    expect(tail.endsWith(gitReason)).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(401);
  });
});
