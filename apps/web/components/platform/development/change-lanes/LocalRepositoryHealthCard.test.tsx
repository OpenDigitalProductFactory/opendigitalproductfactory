import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LaneReadModelFreshness } from "@/lib/contributor-change-lanes/read-model";
import type { ContributorChangeLane } from "@/lib/contributor-change-lanes/types";

import { LocalRepositoryHealthCard } from "./LocalRepositoryHealthCard";

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
    status: "stale",
    owner: null,
    ownerProvider: null,
    pullRequestNumber: null,
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
    blockers: ["No open PR and no active WIP record"],
    nextAction: "Open a PR or file a WIP handoff with TTL",
    ...overrides,
  };
}

describe("LocalRepositoryHealthCard", () => {
  it("renders a plain-language repository health answer before the technical table", () => {
    const html = renderToStaticMarkup(
      <LocalRepositoryHealthCard
        lanes={[
          lane(),
          lane({
            id: "RT-ROOT-PORTAL",
            laneKind: "root-portal",
            source: "runtime-target",
            blockers: [],
            branch: "main",
            servedCommitSha: "22081554f7908d49e0fd1e187bd68faf667aec46",
          }),
        ]}
        freshness={[
          freshness("git-worktree", "ok", 2),
          freshness("git-branch", "ok", 4),
          freshness("github-pr", "not-configured", 0),
        ]}
      />,
    );

    expect(html).toContain("Local source repository");
    expect(html).toContain("Needs attention");
    expect(html).toContain("The local source repository needs attention before you rely on it.");
    expect(html).toContain("GitHub PRs are not connected, but local Git checks are still available.");
    expect(html).toContain("Review the 1 local Git blocker(s) in the table below.");
    expect(html).toContain("2208155");
    expect(html).not.toContain("git fsck");
  });
});
