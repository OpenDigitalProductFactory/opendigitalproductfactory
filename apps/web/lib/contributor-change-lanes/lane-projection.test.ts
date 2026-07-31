import { describe, expect, it } from "vitest";

import { projectContributorChangeLanes } from "./lane-projection";
import type {
  GitBranchSnapshot,
  GitWorktreeSnapshot,
  LaneProjectionInput,
  NonprodEnvironmentLeaseSnapshot,
  PullRequestSnapshot,
  RuntimeTargetSnapshot,
  RuntimeVerificationSnapshot,
  WorkCapsuleSnapshot,
} from "./types";

const NOW = new Date("2026-05-26T22:00:00.000Z");
const FRESH = new Date("2026-05-26T21:58:00.000Z");
const STALE = new Date("2026-05-26T20:00:00.000Z");

function emptyInput(overrides: Partial<LaneProjectionInput> = {}): LaneProjectionInput {
  return {
    workCapsules: [],
    runtimeTargets: [],
    runtimeVerifications: [],
    leases: [],
    worktrees: [],
    branches: [],
    pullRequests: [],
    now: NOW,
    ...overrides,
  };
}

function capsule(overrides: Partial<WorkCapsuleSnapshot> = {}): WorkCapsuleSnapshot {
  return {
    capsuleId: "WC-TEST",
    title: "Test capsule",
    status: "working",
    executorKind: "claude-desktop",
    executorRef: "session-abc",
    headBranch: "feat/test",
    headSha: "aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1",
    worktreePath: "D:/DPF/.claude/worktrees/test",
    pullRequestUrl: null,
    backlogItemId: "BI-TEST",
    featureBuildId: null,
    leaseHolderPrincipalId: "principal-1",
    leaseExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    updatedAt: FRESH,
    purpose: "Test purpose",
    nextAction: null,
    decisionScope: null,
    portfolioRole: null,
    servedPersona: null,
    activityKind: null,
    outcomeAnchor: null,
    ...overrides,
  };
}

function target(overrides: Partial<RuntimeTargetSnapshot> = {}): RuntimeTargetSnapshot {
  return {
    targetId: "RT-TEST",
    kind: "dev-portal",
    status: "running",
    hostUrl: "http://localhost:3001",
    serviceVersion: null,
    servedCommitSha: "aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1",
    workCapsuleId: null,
    featureBuildId: null,
    branchName: null,
    acceptanceRole: "non-prod-verification",
    lastHeartbeatAt: FRESH,
    expiresAt: null,
    ...overrides,
  };
}

function lease(overrides: Partial<NonprodEnvironmentLeaseSnapshot> = {}): NonprodEnvironmentLeaseSnapshot {
  return {
    leaseId: "NPEL-TEST",
    environmentKey: "active-candidate",
    status: "active",
    ownerProvider: "claude",
    ownerSessionId: "session-abc",
    purpose: "verify branch",
    url: "http://localhost:3001",
    worktreePath: null,
    branchName: null,
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    ...overrides,
  };
}

function pr(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    number: 1234,
    url: "https://example.com/pr/1234",
    title: "feat: test",
    headBranch: "feat/test",
    state: "open",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    ...overrides,
  };
}

function branch(overrides: Partial<GitBranchSnapshot> = {}): GitBranchSnapshot {
  return {
    name: "feat/test",
    headSha: "aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1",
    remote: "origin",
    isMerged: false,
    lastCommitAt: FRESH,
    ...overrides,
  };
}

function worktree(overrides: Partial<GitWorktreeSnapshot> = {}): GitWorktreeSnapshot {
  return {
    path: "D:/DPF/.claude/worktrees/test",
    branch: "feat/test",
    headSha: "aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1",
    isRegistered: true,
    ...overrides,
  };
}

describe("projectContributorChangeLanes", () => {
  it("joins a work capsule, runtime target, and open PR into one lane row with ready-for-review status when SHAs match and verification passed", () => {
    const wc = capsule();
    const rt = target({
      workCapsuleId: wc.capsuleId,
      branchName: wc.headBranch,
      servedCommitSha: wc.headSha,
    });
    const verification: RuntimeVerificationSnapshot = {
      verificationId: "RV-1",
      runtimeTargetId: rt.targetId,
      workCapsuleId: wc.capsuleId,
      kind: "ux",
      status: "passed",
      summary: "Dashboard loads",
      completedAt: FRESH,
    };

    const result = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [wc],
        runtimeTargets: [rt],
        runtimeVerifications: [verification],
        pullRequests: [pr({ headBranch: wc.headBranch! })],
      }),
    );

    expect(result.lanes).toHaveLength(1);
    const lane = result.lanes[0]!;
    expect(lane.id).toBe(rt.targetId);
    expect(lane.source).toBe("runtime-target");
    expect(lane.status).toBe("ready-for-review");
    expect(lane.branch).toBe(wc.headBranch);
    expect(lane.servedCommitSha).toBe(wc.headSha);
    expect(lane.pullRequestUrl).toBe("https://example.com/pr/1234");
    expect(lane.workCapsuleId).toBe(wc.capsuleId);
    expect(lane.decisionScope).toBeNull();
    expect(lane.portfolioRole).toBeNull();
    expect(lane.blockers).toEqual([]);
    expect(lane.latestVerification.status).toBe("passed");
  });

  it("carries Work Capsule scope context into capsule-backed lanes without changing status", () => {
    const wc = capsule({
      decisionScope: "wwwd",
      portfolioRole: "productsAndServicesSold",
      servedPersona: "customer",
      activityKind: "delivery",
      outcomeAnchor: { kind: "work-case", id: "CASE-123", label: "Onboard Contoso" },
    });

    const result = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [wc],
        pullRequests: [pr({ headBranch: wc.headBranch! })],
      }),
    );

    expect(result.lanes).toHaveLength(1);
    expect(result.lanes[0]).toEqual(expect.objectContaining({
      source: "work-capsule",
      status: "ready-for-review",
      decisionScope: "wwwd",
      portfolioRole: "productsAndServicesSold",
      servedPersona: "customer",
      activityKind: "delivery",
      outcomeAnchor: { kind: "work-case", id: "CASE-123", label: "Onboard Contoso" },
    }));
  });

  it("flags a branch with an open PR but no work capsule with a missing-capsule blocker", () => {
    const result = projectContributorChangeLanes(
      emptyInput({
        branches: [branch({ name: "feat/orphan-pr" })],
        pullRequests: [pr({ headBranch: "feat/orphan-pr", number: 7777 })],
      }),
    );

    expect(result.lanes).toHaveLength(1);
    const lane = result.lanes[0]!;
    expect(lane.source).toBe("git-branch");
    expect(lane.branch).toBe("feat/orphan-pr");
    expect(lane.pullRequestUrl).toBe("https://example.com/pr/1234");
    expect(lane.blockers).toContain("PR exists but no Work Capsule attached");
    expect(lane.status).toBe("claimed");
  });

  it("flags a branch with no PR and no active WIP TTL as orphaned", () => {
    const result = projectContributorChangeLanes(
      emptyInput({
        branches: [branch({ name: "feat/orphan-branch" })],
      }),
    );

    expect(result.lanes).toHaveLength(1);
    const lane = result.lanes[0]!;
    expect(lane.source).toBe("git-branch");
    expect(lane.branch).toBe("feat/orphan-branch");
    expect(lane.pullRequestUrl).toBeNull();
    expect(lane.blockers).toContain("No open PR and no active WIP record");
    expect(lane.status).toBe("stale");
  });

  it("flags a worktree with no branch or capsule linkage as orphaned", () => {
    const result = projectContributorChangeLanes(
      emptyInput({
        worktrees: [
          worktree({
            path: "D:/DPF/.claude/worktrees/orphan",
            branch: null,
            headSha: null,
          }),
        ],
      }),
    );

    expect(result.lanes).toHaveLength(1);
    const lane = result.lanes[0]!;
    expect(lane.source).toBe("worktree");
    expect(lane.worktreePath).toBe("D:/DPF/.claude/worktrees/orphan");
    expect(lane.blockers).toContain("Worktree has no active Work Capsule");
    expect(lane.status).toBe("stale");
  });

  it("treats a stopped registered dev-portal without lease as available", () => {
    const rt = target({
      targetId: "RT-DEV-PORTAL",
      status: "planned",
      hostUrl: "http://localhost:3001",
      servedCommitSha: null,
      lastHeartbeatAt: null,
      branchName: null,
      workCapsuleId: null,
    });

    const result = projectContributorChangeLanes(
      emptyInput({
        runtimeTargets: [rt],
      }),
    );

    const lane = result.lanes.find((l) => l.runtimeTargetId === "RT-DEV-PORTAL");
    expect(lane).toBeDefined();
    expect(lane!.status).toBe("available");
    expect(lane!.blockers).toEqual([]);
    expect(lane!.nextAction).toMatch(/claim/i);
  });

  it("treats a claimed stopped dev-portal with active lease as starting", () => {
    const wc = capsule({
      capsuleId: "WC-DEV-CLAIM",
      worktreePath: "D:/DPF/.claude/worktrees/dev-claim",
      headBranch: "feat/dev-claim",
    });
    const rt = target({
      targetId: "RT-DEV-PORTAL",
      status: "planned",
      hostUrl: "http://localhost:3001",
      servedCommitSha: null,
      lastHeartbeatAt: null,
      workCapsuleId: wc.capsuleId,
      branchName: wc.headBranch,
    });
    const lse = lease({
      leaseId: "NPEL-DEV-1",
      worktreePath: wc.worktreePath,
      branchName: wc.headBranch,
    });

    const result = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [wc],
        runtimeTargets: [rt],
        leases: [lse],
      }),
    );

    const lane = result.lanes.find((l) => l.runtimeTargetId === "RT-DEV-PORTAL");
    expect(lane).toBeDefined();
    expect(lane!.status).toBe("starting");
    expect(lane!.expiresAt).toEqual(lse.expiresAt);
  });

  it("marks the lane blocked when the latest verification failed", () => {
    const wc = capsule();
    const rt = target({ workCapsuleId: wc.capsuleId, branchName: wc.headBranch });
    const verification: RuntimeVerificationSnapshot = {
      verificationId: "RV-FAIL",
      runtimeTargetId: rt.targetId,
      workCapsuleId: wc.capsuleId,
      kind: "health",
      status: "failed",
      summary: "Health endpoint timed out",
      completedAt: FRESH,
    };

    const result = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [wc],
        runtimeTargets: [rt],
        runtimeVerifications: [verification],
      }),
    );

    const lane = result.lanes.find((l) => l.runtimeTargetId === rt.targetId);
    expect(lane).toBeDefined();
    expect(lane!.status).toBe("blocked");
    expect(lane!.latestVerification.status).toBe("failed");
  });

  it("adds a served-SHA-mismatch blocker without changing status to ready-for-review", () => {
    const wc = capsule({ headSha: "aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1" });
    const rt = target({
      workCapsuleId: wc.capsuleId,
      branchName: wc.headBranch,
      servedCommitSha: "bbbbbbb2bbbbbbb2bbbbbbb2bbbbbbb2bbbbbbb2",
    });

    const result = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [wc],
        runtimeTargets: [rt],
      }),
    );

    const lane = result.lanes.find((l) => l.runtimeTargetId === rt.targetId);
    expect(lane).toBeDefined();
    expect(lane!.status).not.toBe("ready-for-review");
    expect(lane!.blockers.some((b) => b.includes("but branch head is"))).toBe(true);
  });

  it("does not duplicate a branch row when a work capsule already covers it", () => {
    const wc = capsule({ headBranch: "feat/dedupe" });
    const result = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [wc],
        branches: [branch({ name: "feat/dedupe" })],
      }),
    );
    expect(result.lanes.filter((l) => l.branch === "feat/dedupe")).toHaveLength(1);
    expect(result.lanes[0]!.source).toBe("work-capsule");
  });

  it("does not duplicate a worktree row when a runtime target already covers its capsule", () => {
    const wc = capsule({
      capsuleId: "WC-DEDUPE",
      worktreePath: "D:/DPF/.claude/worktrees/dedupe-wt",
      headBranch: "feat/dedupe-wt",
    });
    const rt = target({
      targetId: "RT-DEDUPE",
      workCapsuleId: wc.capsuleId,
      branchName: wc.headBranch,
    });
    const result = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [wc],
        runtimeTargets: [rt],
        worktrees: [worktree({ path: wc.worktreePath!, branch: wc.headBranch })],
      }),
    );
    const worktreeRows = result.lanes.filter((l) => l.source === "worktree");
    expect(worktreeRows).toHaveLength(0);
  });

  it("sorts blocked lanes before running and orphans last", () => {
    const blockedTarget = target({
      targetId: "RT-BLOCKED",
      status: "blocked",
      branchName: null,
      workCapsuleId: null,
    });
    const runningCapsule = capsule({
      capsuleId: "WC-RUN",
      worktreePath: "D:/DPF/.claude/worktrees/run",
      headBranch: "feat/run",
    });
    const runningTarget = target({
      targetId: "RT-RUN",
      workCapsuleId: runningCapsule.capsuleId,
      branchName: runningCapsule.headBranch,
      servedCommitSha: runningCapsule.headSha,
    });

    const result = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [runningCapsule],
        runtimeTargets: [blockedTarget, runningTarget],
        branches: [branch({ name: "feat/orphan" })],
      }),
    );

    expect(result.lanes[0]!.id).toBe("RT-BLOCKED");
    expect(result.lanes.at(-1)!.source).toBe("git-branch");
  });
});

describe("shipped lane status — completed cross-surface work (EP-UNIFIED-TRACKING)", () => {
  it("projects a complete capsule to a 'shipped' lane with no in-flight blockers", () => {
    const { lanes } = projectContributorChangeLanes(
      emptyInput({ workCapsules: [capsule({ capsuleId: "WC-DONE", status: "complete" })] }),
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({
      workCapsuleId: "WC-DONE",
      source: "work-capsule",
      status: "shipped",
      nextAction: "Shipped — work complete",
    });
    expect(lanes[0]!.blockers).toEqual([]);
  });

  it("treats ready-for-promotion as shipped and raises no 'no branch' blocker", () => {
    const { lanes } = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [
          capsule({ capsuleId: "WC-RFP", status: "ready-for-promotion", headBranch: null }),
        ],
      }),
    );
    expect(lanes[0]!.status).toBe("shipped");
    expect(lanes[0]!.blockers).toEqual([]);
  });

  it("leaves an in-flight capsule with no PR/TTL claimed + blocked (unchanged)", () => {
    const { lanes } = projectContributorChangeLanes(
      emptyInput({
        workCapsules: [capsule({ capsuleId: "WC-WIP", status: "working", leaseExpiresAt: null })],
      }),
    );
    expect(lanes[0]!.status).toBe("claimed");
    expect(lanes[0]!.blockers).toContain("No open PR and no active WIP TTL");
  });

  describe("origin attribution (BI-3A34D7A9)", () => {
    it("projects the lease's client and thread onto a lease lane", () => {
      const { lanes } = projectContributorChangeLanes(
        emptyInput({
          leases: [
            lease({
              environmentKey: "local-integration-ci",
              ownerProvider: "claude",
              ownerSessionId: "79495644-27dd-4631-bed1-06e294056a4f",
              branchName: "feat/test",
            }),
          ],
        }),
      );
      const laneRow = lanes.find((l) => l.source === "nonprod-lease");
      expect(laneRow?.ownerProvider).toBe("claude");
      expect(laneRow?.owner).toBe("79495644-27dd-4631-bed1-06e294056a4f");
    });

    it("projects the PR number as a first-class field, not only a URL", () => {
      const { lanes } = projectContributorChangeLanes(
        emptyInput({
          leases: [lease({ environmentKey: "local-integration-ci", branchName: "feat/test" })],
          pullRequests: [pr({ number: 3748, headBranch: "feat/test" })],
        }),
      );
      const laneRow = lanes.find((l) => l.source === "nonprod-lease");
      expect(laneRow?.pullRequestNumber).toBe(3748);
    });

    it("reports no provider for a branch with no local lease or capsule", () => {
      // An outside contributor's branch legitimately has no local origin, and
      // that absence must read as "unknown", never as a defaulted client.
      const { lanes } = projectContributorChangeLanes(
        emptyInput({
          branches: [branch({ name: "feat/outside" })],
          pullRequests: [pr({ number: 4001, headBranch: "feat/outside" })],
        }),
      );
      const laneRow = lanes.find((l) => l.source === "git-branch");
      expect(laneRow?.ownerProvider).toBeNull();
      expect(laneRow?.pullRequestNumber).toBe(4001);
    });

    it("falls back to the capsule's executor kind when no lease is held", () => {
      const { lanes } = projectContributorChangeLanes(
        emptyInput({
          workCapsules: [
            capsule({ capsuleId: "WC-EXT", status: "working", executorKind: "codex" }),
          ],
        }),
      );
      const laneRow = lanes.find((l) => l.source === "work-capsule");
      expect(laneRow?.ownerProvider).toBe("codex");
    });
  });
});
