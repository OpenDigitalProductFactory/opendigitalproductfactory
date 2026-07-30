import { describe, expect, it, vi } from "vitest";

import * as mergePointModule from "./merge-point";
import {
  buildSubjectCommand,
  mergePointFromSubject,
  mergePointsMatch,
  resolveMergePoint,
  resolveUpgradeMergePoints,
} from "./merge-point";

const SHA_A = "59f8826e448bdb85580633cdc2ad21fb05bfafd1";
const SHA_B = "3c46e27d97781d4663d80ea097a1e9f3dd7f1cdf";

describe("buildSubjectCommand", () => {
  it("reads exactly one subject line from the host clone", () => {
    expect(buildSubjectCommand({ hostSourcePath: "/workspace", sha: SHA_A })).toEqual([
      "git",
      "-C",
      "/workspace",
      "log",
      "-1",
      "--format=%s",
      SHA_A,
    ]);
  });
});

describe("mergePointFromSubject", () => {
  it("labels a squash-merge subject by its merged PR number", () => {
    const mp = mergePointFromSubject(
      SHA_A,
      "fix(build): materialize hermetic replay dependencies (#3747)",
    );
    expect(mp.prNumber).toBe(3747);
    expect(mp.label).toBe("PR #3747");
    expect(mp.description).toBe("materialize hermetic replay dependencies");
  });

  it("strips the PR reference out of the description", () => {
    const mp = mergePointFromSubject(SHA_B, "fix(db): make amcheck success Prisma-safe (#3746)");
    expect(mp.description).not.toContain("#3746");
  });

  it("degrades to a short SHA when the subject carries no PR reference", () => {
    const mp = mergePointFromSubject(SHA_A, "hotfix applied directly on main");
    expect(mp.prNumber).toBeNull();
    expect(mp.label).toBe("59f8826e448b…");
  });

  it("degrades to a short SHA on an empty subject rather than rendering blank", () => {
    const mp = mergePointFromSubject(SHA_A, "   ");
    expect(mp.label).toBe("59f8826e448b…");
    expect(mp.description).toBeNull();
  });

  it("keeps a non-conventional subject intact as the description", () => {
    const mp = mergePointFromSubject(SHA_A, "Revert everything (#3700)");
    expect(mp.prNumber).toBe(3700);
    expect(mp.description).toBe("Revert everything (#3700)");
  });
});

describe("resolveMergePoint", () => {
  it("resolves a SHA to its merged PR via the host clone", async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: "feat(ops): label upgrades by merged PR (#3750)\n",
    });
    const mp = await resolveMergePoint(
      { sha: SHA_A, config: { hostSourcePath: "/host/dpf" } },
      { execFile },
    );
    expect(mp?.prNumber).toBe(3750);
    expect(execFile).toHaveBeenCalledWith("git", [
      "-C",
      "/host/dpf",
      "log",
      "-1",
      "--format=%s",
      SHA_A,
    ]);
  });

  it("returns null without executing git for a missing SHA", async () => {
    const execFile = vi.fn();
    expect(await resolveMergePoint({ sha: null }, { execFile })).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns null without executing git for a non-git-SHA value", async () => {
    const execFile = vi.fn();
    // The image stamp can be a content hash rather than a commit id.
    expect(await resolveMergePoint({ sha: "sha256-abc123" }, { execFile })).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the git read fails", async () => {
    const execFile = vi.fn().mockRejectedValue(new Error("fatal: bad object"));
    expect(await resolveMergePoint({ sha: SHA_A }, { execFile })).toBeNull();
  });
});

describe("resolveUpgradeMergePoints", () => {
  it("labels both ends of the comparison", async () => {
    const execFile = vi.fn(async (_cmd: string, args: string[]) => ({
      stdout: args.at(-1) === SHA_B ? "fix(db): amcheck (#3746)" : "fix(build): replay (#3747)",
    }));
    const { running, available } = await resolveUpgradeMergePoints({
      runningSha: SHA_B,
      targetSha: SHA_A,
    }, { execFile });
    expect(running?.label).toBe("PR #3746");
    expect(available?.label).toBe("PR #3747");
  });

  it("labels the end that resolves when the other cannot", async () => {
    const execFile = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.at(-1) === SHA_B) throw new Error("fatal: bad object");
      return { stdout: "fix(build): replay (#3747)" };
    });
    const { running, available } = await resolveUpgradeMergePoints({
      runningSha: SHA_B,
      targetSha: SHA_A,
    }, { execFile });
    expect(running).toBeNull();
    expect(available?.prNumber).toBe(3747);
  });
});

describe("mergePointsMatch", () => {
  it("is true for the same merged PR across differing SHAs", () => {
    // The whole point: the deployed id is a local merge commit, so SHA equality
    // is false even when the running build already contains the target.
    const running = mergePointFromSubject(SHA_A, "fix(build): replay (#3747)");
    const available = mergePointFromSubject(SHA_B, "fix(build): replay (#3747)");
    expect(running.sha).not.toBe(available.sha);
    expect(mergePointsMatch(running, available)).toBe(true);
  });

  it("is false for different merged PRs", () => {
    expect(
      mergePointsMatch(
        mergePointFromSubject(SHA_A, "fix(build): replay (#3747)"),
        mergePointFromSubject(SHA_B, "fix(db): amcheck (#3746)"),
      ),
    ).toBe(false);
  });

  it("is false when either end is unresolved or unnumbered", () => {
    const numbered = mergePointFromSubject(SHA_A, "fix(build): replay (#3747)");
    const unnumbered = mergePointFromSubject(SHA_B, "direct push");
    expect(mergePointsMatch(numbered, null)).toBe(false);
    expect(mergePointsMatch(null, numbered)).toBe(false);
    expect(mergePointsMatch(numbered, unnumbered)).toBe(false);
  });

  it("exposes equality only — no ordering comparator to misuse", () => {
    // Merge order is a race: a higher PR number is not necessarily newer, so
    // this module must never offer a PR-number comparison. "How far behind"
    // belongs to the commit walk in release-batch.ts.
    const exported = Object.keys(mergePointModule);
    expect(exported).not.toContain("compareMergePoints");
    expect(exported).not.toContain("isNewerMergePoint");
    expect(exported).toContain("mergePointsMatch");
  });
});
