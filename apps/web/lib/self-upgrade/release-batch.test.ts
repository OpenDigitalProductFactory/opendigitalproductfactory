import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BATCH_MAX_WAIT_HOURS,
  DEFAULT_BATCH_MIN_PENDING_PRS,
  buildDeepenCommand,
  buildPendingLogCommand,
  countPendingUpstreamCommits,
  describeReleaseBatch,
  evaluateReleaseBatch,
  parsePendingLog,
} from "./release-batch";
import type { GitResult } from "./prepare-source";

const NOW = new Date("2026-07-06T12:00:00.000Z");

function tally(pendingCount: number | null, oldestPendingAt: Date | null = null) {
  return { pendingCount, oldestPendingAt };
}

describe("evaluateReleaseBatch", () => {
  it("is eligible once the pending count reaches the threshold", () => {
    const d = evaluateReleaseBatch({
      tally: tally(10),
      minPendingPrs: 10,
      maxWaitHours: DEFAULT_BATCH_MAX_WAIT_HOURS,
      now: NOW,
    });
    expect(d.eligible).toBe(true);
    expect(d.reason).toBe("threshold-met");
  });

  it("waits below the threshold when nothing has aged out", () => {
    const d = evaluateReleaseBatch({
      tally: tally(3, new Date(NOW.getTime() - 60 * 60 * 1000)), // 1h old
      minPendingPrs: 10,
      maxWaitHours: 168,
      now: NOW,
    });
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("below-threshold");
  });

  it("releases below the threshold once the oldest pending commit outwaits the valve", () => {
    const d = evaluateReleaseBatch({
      tally: tally(2, new Date(NOW.getTime() - 200 * 60 * 60 * 1000)), // 200h old
      minPendingPrs: 10,
      maxWaitHours: 168,
      now: NOW,
    });
    expect(d.eligible).toBe(true);
    expect(d.reason).toBe("max-wait-elapsed");
  });

  it("does not apply the valve when maxWaitHours is 0 (disabled)", () => {
    const d = evaluateReleaseBatch({
      tally: tally(2, new Date(NOW.getTime() - 10_000 * 60 * 60 * 1000)),
      minPendingPrs: 10,
      maxWaitHours: 0,
      now: NOW,
    });
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("below-threshold");
  });

  it("fails OPEN when the tally is uncomputable", () => {
    const d = evaluateReleaseBatch({
      tally: tally(null),
      minPendingPrs: 10,
      maxWaitHours: 168,
      now: NOW,
    });
    expect(d.eligible).toBe(true);
    expect(d.reason).toBe("tally-uncomputable");
  });

  it("treats a threshold of <=1 as batching-disabled (always eligible)", () => {
    for (const min of [0, 1]) {
      const d = evaluateReleaseBatch({
        tally: tally(0),
        minPendingPrs: min,
        maxWaitHours: 168,
        now: NOW,
      });
      expect(d.eligible).toBe(true);
      expect(d.reason).toBe("batching-disabled");
    }
  });

  it("waits at exactly one below the threshold, releases at the threshold", () => {
    const below = evaluateReleaseBatch({
      tally: tally(9),
      minPendingPrs: 10,
      maxWaitHours: 0,
      now: NOW,
    });
    expect(below.eligible).toBe(false);
    const at = evaluateReleaseBatch({
      tally: tally(10),
      minPendingPrs: 10,
      maxWaitHours: 0,
      now: NOW,
    });
    expect(at.eligible).toBe(true);
  });
});

describe("parsePendingLog", () => {
  it("counts committer-epoch lines and reads the oldest (first) as the age", () => {
    // git log --reverse => oldest first
    const t = parsePendingLog("1700000000\n1700000100\n1700000200\n");
    expect(t.pendingCount).toBe(3);
    expect(t.oldestPendingAt).toEqual(new Date(1700000000 * 1000));
  });

  it("returns count 0 / null age for empty output (up to date)", () => {
    const t = parsePendingLog("\n  \n");
    expect(t.pendingCount).toBe(0);
    expect(t.oldestPendingAt).toBeNull();
  });

  it("ignores non-numeric noise lines", () => {
    const t = parsePendingLog("warning: something\n1700000000\n");
    expect(t.pendingCount).toBe(1);
  });
});

describe("command builders", () => {
  it("builds the pending-log range command against remote/branch", () => {
    expect(
      buildPendingLogCommand({
        hostSourcePath: "/host-dpf",
        remote: "origin",
        branch: "main",
        sinceSha: "abc123",
      }),
    ).toEqual([
      "git",
      "-C",
      "/host-dpf",
      "log",
      "--reverse",
      "--format=%ct",
      "abc123..origin/main",
    ]);
  });

  it("builds a bounded deepen command", () => {
    expect(
      buildDeepenCommand({
        hostSourcePath: "/host-dpf",
        remote: "origin",
        branch: "main",
        deepenCommits: 50,
      }),
    ).toEqual(["git", "-C", "/host-dpf", "fetch", "--deepen=50", "origin", "main"]);
  });
});

describe("countPendingUpstreamCommits", () => {
  const input = {
    hostSourcePath: "/host-dpf",
    remote: "origin",
    branch: "main",
    sinceSha: "lineage-sha",
  };

  it("returns the parsed tally on a clean log", async () => {
    const gitRun = vi.fn(
      async (): Promise<GitResult> => ({
        stdout: "1700000000\n1700000100\n",
        stderr: "",
        code: 0,
      }),
    );
    const t = await countPendingUpstreamCommits(input, gitRun);
    expect(t.pendingCount).toBe(2);
    expect(gitRun).toHaveBeenCalledTimes(1);
  });

  it("deepens once and retries when the first log fails (shallow boundary)", async () => {
    const gitRun = vi
      .fn<(args: string[]) => Promise<GitResult>>()
      .mockResolvedValueOnce({ stdout: "", stderr: "bad revision", code: 128 }) // log fails
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 }) // deepen ok
      .mockResolvedValueOnce({ stdout: "1700000000\n", stderr: "", code: 0 }); // retry ok
    const t = await countPendingUpstreamCommits(input, gitRun);
    expect(t.pendingCount).toBe(1);
    expect(gitRun).toHaveBeenCalledTimes(3);
  });

  it("fails open (null) when even the deepen cannot resolve the lineage", async () => {
    const gitRun = vi
      .fn<(args: string[]) => Promise<GitResult>>()
      .mockResolvedValueOnce({ stdout: "", stderr: "bad revision", code: 128 })
      .mockResolvedValueOnce({ stdout: "", stderr: "shallow", code: 1 }); // deepen fails
    const t = await countPendingUpstreamCommits(input, gitRun);
    expect(t.pendingCount).toBeNull();
  });

  it("fails open (null) when the git runner throws", async () => {
    const gitRun = vi.fn(async (): Promise<GitResult> => {
      throw new Error("git missing");
    });
    const t = await countPendingUpstreamCommits(input, gitRun);
    expect(t.pendingCount).toBeNull();
  });
});

describe("describeReleaseBatch", () => {
  it("names the accumulation when waiting", () => {
    const d = evaluateReleaseBatch({
      tally: tally(3),
      minPendingPrs: 10,
      maxWaitHours: 0,
      now: NOW,
    });
    expect(describeReleaseBatch(d)).toContain("3 of 10");
  });

  it("uses defaults that match the documented policy", () => {
    expect(DEFAULT_BATCH_MIN_PENDING_PRS).toBe(10);
    expect(DEFAULT_BATCH_MAX_WAIT_HOURS).toBe(168);
  });
});
