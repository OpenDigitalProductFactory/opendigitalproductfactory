// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { ContributorChangeLane } from "@/lib/contributor-change-lanes/types";

import { filterLanes } from "./ChangeLanesDashboard";

function lane(
  id: string,
  status: ContributorChangeLane["status"],
  source: ContributorChangeLane["source"],
): ContributorChangeLane {
  return {
    id,
    laneKind: "external-debug",
    source,
    status,
    owner: null,
    ownerProvider: null,
    pullRequestNumber: null,
    branch: null,
    worktreePath: null,
    commitSha: null,
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
    nextAction: "",
  };
}

describe("filterLanes — All work lens (EP-UNIFIED-TRACKING)", () => {
  const lanes = [
    lane("capsule", "claimed", "work-capsule"),
    lane("branch", "stale", "git-branch"),
    lane("runtime", "running", "runtime-target"),
  ];

  it("the 'all' lens returns every lane regardless of status or source", () => {
    expect(filterLanes(lanes, "all").map((l) => l.id)).toEqual(["capsule", "branch", "runtime"]);
  });

  it("includes a completed cross-surface capsule (the thing the focused lenses hid)", () => {
    // A completed external-agent capsule projects to a 'claimed' lane; it is not
    // surfaced by the worktrees/leases/cleanup lenses, so 'All work' is the lens
    // that makes finished cross-surface work visible.
    const completed = lane("WC-CLAUDE-SESSION", "claimed", "work-capsule");
    expect(filterLanes([completed], "all")).toHaveLength(1);
  });

  it("the 'active' lens still filters to active statuses only (unchanged behavior)", () => {
    const ids = filterLanes(lanes, "active").map((l) => l.id);
    expect(ids).toContain("capsule");
    expect(ids).toContain("runtime");
    expect(ids).not.toContain("branch"); // stale is not active
  });
});
