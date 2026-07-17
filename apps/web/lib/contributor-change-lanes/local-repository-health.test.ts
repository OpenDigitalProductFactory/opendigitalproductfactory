import { describe, expect, it } from "vitest";

import type { LaneReadModelFreshness } from "./read-model";
import { summarizeLocalRepositoryHealth } from "./local-repository-health";
import type { ContributorChangeLane } from "./types";

const NOW = new Date("2026-07-17T04:00:00.000Z");

function freshness(
  source: LaneReadModelFreshness["source"],
  state: LaneReadModelFreshness["state"],
  count: number,
  message: string | null = null,
): LaneReadModelFreshness {
  return { source, state, count, message, fetchedAt: NOW };
}

function lane(overrides: Partial<ContributorChangeLane> = {}): ContributorChangeLane {
  return {
    id: "lane-1",
    laneKind: "external-debug",
    source: "git-branch",
    status: "claimed",
    owner: null,
    branch: "codex/example",
    worktreePath: null,
    commitSha: "abc1234abc1234abc1234abc1234abc1234abc1234",
    servedCommitSha: null,
    pullRequestUrl: null,
    runtimeTargetId: null,
    runtimeUrl: null,
    workCapsuleId: null,
    backlogItemId: null,
    expiresAt: null,
    lastHeartbeatAt: null,
    latestVerification: { status: "pending", checkedAt: null, summary: null },
    blockers: [],
    nextAction: "Open a PR or file a WIP handoff with TTL",
    ...overrides,
  };
}

describe("summarizeLocalRepositoryHealth", () => {
  it("reports healthy when Git snapshots are fresh and there are no local blockers", () => {
    const summary = summarizeLocalRepositoryHealth({
      lanes: [
        lane({
          id: "RT-ROOT-PORTAL",
          laneKind: "root-portal",
          source: "runtime-target",
          branch: "main",
          servedCommitSha: "22081554f7908d49e0fd1e187bd68faf667aec46",
        }),
      ],
      freshness: [
        freshness("git-worktree", "ok", 2),
        freshness("git-branch", "ok", 4),
        freshness("github-pr", "not-configured", 0),
      ],
    });

    expect(summary.state).toBe("healthy");
    expect(summary.badgeLabel).toBe("Healthy");
    expect(summary.headline).toContain("local source repository looks protected");
    expect(summary.servedCommitShort).toBe("2208155");
    expect(summary.nextActions).toEqual(["No action needed right now."]);
  });

  it("treats GitHub PR not-configured as optional when local Git inventory is healthy", () => {
    const summary = summarizeLocalRepositoryHealth({
      lanes: [],
      freshness: [
        freshness("git-worktree", "ok", 1),
        freshness("git-branch", "ok", 1),
        freshness("github-pr", "not-configured", 0),
      ],
    });

    expect(summary.state).toBe("healthy");
    expect(summary.details).toContain("GitHub PRs are not connected, but local Git checks are still available.");
  });

  it("reports syncing while local Git snapshots are warming up", () => {
    const summary = summarizeLocalRepositoryHealth({
      lanes: [],
      freshness: [
        freshness("git-worktree", "warming-up", 0),
        freshness("git-branch", "warming-up", 0),
      ],
    });

    expect(summary.state).toBe("syncing");
    expect(summary.badgeLabel).toBe("Syncing");
    expect(summary.nextActions[0]).toContain("Wait for the local Git inventory sync");
  });

  it("reports attention when Git inventory is stale or errored", () => {
    const summary = summarizeLocalRepositoryHealth({
      lanes: [],
      freshness: [
        freshness("git-worktree", "ok", 2),
        freshness("git-branch", "stale", 4, "Last successful sync 42 min ago"),
      ],
    });

    expect(summary.state).toBe("attention");
    expect(summary.badgeLabel).toBe("Needs attention");
    expect(summary.details).toContain("Last successful sync 42 min ago");
    expect(summary.nextActions[0]).toContain("Refresh contributor inventory");
  });

  it("reports attention for orphan local branches and worktrees", () => {
    const summary = summarizeLocalRepositoryHealth({
      lanes: [
        lane({
          id: "branch:codex/orphan",
          source: "git-branch",
          branch: "codex/orphan",
          blockers: ["No open PR and no active WIP record"],
        }),
        lane({
          id: "worktree:/tmp/orphan",
          source: "worktree",
          worktreePath: "/tmp/orphan",
          branch: null,
          blockers: ["Worktree has no active Work Capsule"],
        }),
      ],
      freshness: [
        freshness("git-worktree", "ok", 2),
        freshness("git-branch", "ok", 4),
      ],
    });

    expect(summary.state).toBe("attention");
    expect(summary.pendingLocalBranches).toBe(1);
    expect(summary.orphanWorktrees).toBe(1);
    expect(summary.nextActions).toContain("Review the 2 local Git blocker(s) in the table below.");
  });
});
