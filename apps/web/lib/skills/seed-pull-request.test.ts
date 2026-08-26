import { beforeEach, describe, expect, it, vi } from "vitest";

const { createBranchAndPRMock, resolveHiveTokenMock } = vi.hoisted(() => ({
  createBranchAndPRMock: vi.fn(),
  resolveHiveTokenMock: vi.fn(),
}));

vi.mock("@/lib/build/github-api-commit", () => ({
  createBranchAndPR: createBranchAndPRMock,
}));
vi.mock("@/lib/build/identity-privacy", () => ({
  resolveHiveToken: resolveHiveTokenMock,
}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { buildSeedDiff, emitSeedPullRequest } from "./seed-pull-request";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSeedDiff (BI-5798BBA3 phase 2b)", () => {
  it("emits a unified diff a git tree can apply", () => {
    const diff = buildSeedDiff("skills/build/x.skill.md", "old line\n", "new line\n");
    expect(diff).toContain("diff --git a/skills/build/x.skill.md b/skills/build/x.skill.md");
    expect(diff).toContain("--- a/skills/build/x.skill.md");
    expect(diff).toContain("+++ b/skills/build/x.skill.md");
    expect(diff).toContain("-old line");
    expect(diff).toContain("+new line");
  });

  it("returns an empty diff when nothing changed, so no PR is opened for a no-op", () => {
    expect(buildSeedDiff("a/b.md", "same\n", "same\n")).toBe("");
  });
});

describe("emitSeedPullRequest", () => {
  const base = {
    skillId: "dpf-verify-substrate-first",
    seedPath: "packages/dpf-skill-pack/skills/dpf-verify-substrate-first/SKILL.md",
    before: "old\n",
    after: "new\n",
    proposalId: "IP-SKL-7A9CA2C7",
    reviewerName: "Mark Bodman",
    reviewerEmail: "markdbodman@gmail.com",
  };

  it("opens a PR carrying the approved seed change", async () => {
    resolveHiveTokenMock.mockResolvedValueOnce("tok");
    createBranchAndPRMock.mockResolvedValueOnce({
      branchName: "chore/skill-seed-IP-SKL-7A9CA2C7",
      commitSha: "abc123",
      prUrl: "https://github.com/o/r/pull/9",
      prNumber: 9,
    });

    const result = await emitSeedPullRequest({ ...base, repoOwner: "o", repoRepo: "r" });

    expect(result.status).toBe("pr-opened");
    expect(result.prUrl).toBe("https://github.com/o/r/pull/9");
    // The commit must carry DCO — publishBranchCommit rejects it otherwise.
    const call = createBranchAndPRMock.mock.calls[0]![0];
    expect(call.commitMessage).toContain("Signed-off-by: Mark Bodman <markdbodman@gmail.com>");
    expect(call.diff).toContain(base.seedPath);
  });

  it("reports no-token rather than throwing when no GitHub token is configured", async () => {
    resolveHiveTokenMock.mockResolvedValueOnce(null);
    const result = await emitSeedPullRequest({ ...base, repoOwner: "o", repoRepo: "r" });
    expect(result.status).toBe("no-token");
    expect(createBranchAndPRMock).not.toHaveBeenCalled();
  });

  it("reports pr-failed rather than throwing when GitHub refuses", async () => {
    resolveHiveTokenMock.mockResolvedValueOnce("tok");
    createBranchAndPRMock.mockRejectedValueOnce(new Error("422 Unprocessable"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await emitSeedPullRequest({ ...base, repoOwner: "o", repoRepo: "r" });
    expect(result.status).toBe("pr-failed");
    expect(result.reason).toContain("422");
  });

  it("skips cleanly when the seed body is unchanged", async () => {
    resolveHiveTokenMock.mockResolvedValueOnce("tok");
    const result = await emitSeedPullRequest({
      ...base, after: base.before, repoOwner: "o", repoRepo: "r",
    });
    expect(result.status).toBe("no-change");
    expect(createBranchAndPRMock).not.toHaveBeenCalled();
  });
});
