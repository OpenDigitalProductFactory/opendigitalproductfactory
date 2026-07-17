import type { LaneReadModelFreshness } from "./read-model";
import type { ContributorChangeLane } from "./types";

type LocalRepositoryHealthState = "healthy" | "attention" | "syncing" | "unknown";
type LocalRepositoryHealthIntent = "success" | "warning" | "danger" | "neutral";

const LOCAL_GIT_SOURCES: LaneReadModelFreshness["source"][] = [
  "git-worktree",
  "git-branch",
];

export type LocalRepositoryHealthSummary = {
  state: LocalRepositoryHealthState;
  intent: LocalRepositoryHealthIntent;
  badgeLabel: string;
  headline: string;
  details: string[];
  nextActions: string[];
  servedCommitShort: string | null;
  gitWorktreeCount: number;
  gitBranchCount: number;
  pendingLocalBranches: number;
  orphanWorktrees: number;
  localBlockerCount: number;
};

export function summarizeLocalRepositoryHealth({
  lanes,
  freshness,
}: {
  lanes: ContributorChangeLane[];
  freshness: LaneReadModelFreshness[];
}): LocalRepositoryHealthSummary {
  const bySource = new Map(freshness.map((row) => [row.source, row]));
  const localRows = LOCAL_GIT_SOURCES.map((source) => bySource.get(source)).filter(
    (row): row is LaneReadModelFreshness => Boolean(row),
  );
  const githubRow = bySource.get("github-pr");
  const gitWorktreeCount = bySource.get("git-worktree")?.count ?? 0;
  const gitBranchCount = bySource.get("git-branch")?.count ?? 0;
  const localGitLanes = lanes.filter(
    (lane) => lane.source === "git-branch" || lane.source === "worktree",
  );
  const localBlockerCount = localGitLanes.reduce(
    (sum, lane) => sum + lane.blockers.length,
    0,
  );
  const pendingLocalBranches = localGitLanes.filter(
    (lane) => lane.source === "git-branch" && !lane.pullRequestUrl,
  ).length;
  const orphanWorktrees = localGitLanes.filter((lane) => lane.source === "worktree").length;
  const servedCommitShort = shortenSha(resolveRootServedCommit(lanes));

  const details: string[] = [
    `${gitBranchCount} branch${plural(gitBranchCount)} tracked.`,
    `${gitWorktreeCount} worktree${plural(gitWorktreeCount)} tracked.`,
  ];
  const nextActions: string[] = [];

  if (servedCommitShort) {
    details.push(`Live portal is serving commit ${servedCommitShort}.`);
  }

  if (githubRow?.state === "not-configured") {
    details.push("GitHub PRs are not connected, but local Git checks are still available.");
  }

  if (localRows.length === 0 || localRows.every((row) => row.state === "warming-up")) {
    return {
      state: "syncing",
      intent: "neutral",
      badgeLabel: "Syncing",
      headline: "DPF is still checking the local source repository.",
      details,
      nextActions: ["Wait for the local Git inventory sync, then refresh this page."],
      servedCommitShort,
      gitWorktreeCount,
      gitBranchCount,
      pendingLocalBranches,
      orphanWorktrees,
      localBlockerCount,
    };
  }

  const freshnessProblems = localRows.filter(
    (row) => row.state === "stale" || row.state === "error",
  );
  for (const row of freshnessProblems) {
    details.push(row.message ?? `${row.source} inventory is ${row.state}.`);
  }

  if (freshnessProblems.length > 0) {
    nextActions.push("Refresh contributor inventory and check whether Git data returns to green.");
  }

  if (localBlockerCount > 0) {
    nextActions.push(`Review the ${localBlockerCount} local Git blocker(s) in the table below.`);
  }

  if (freshnessProblems.length > 0 || localBlockerCount > 0) {
    return {
      state: "attention",
      intent: freshnessProblems.some((row) => row.state === "error") ? "danger" : "warning",
      badgeLabel: "Needs attention",
      headline: "The local source repository needs attention before you rely on it.",
      details,
      nextActions,
      servedCommitShort,
      gitWorktreeCount,
      gitBranchCount,
      pendingLocalBranches,
      orphanWorktrees,
      localBlockerCount,
    };
  }

  if (localRows.some((row) => row.state === "warming-up")) {
    return {
      state: "syncing",
      intent: "neutral",
      badgeLabel: "Syncing",
      headline: "DPF has partial local Git data and is still finishing the check.",
      details,
      nextActions: ["Wait for the local Git inventory sync, then refresh this page."],
      servedCommitShort,
      gitWorktreeCount,
      gitBranchCount,
      pendingLocalBranches,
      orphanWorktrees,
      localBlockerCount,
    };
  }

  if (localRows.every((row) => row.state === "ok")) {
    return {
      state: "healthy",
      intent: "success",
      badgeLabel: "Healthy",
      headline: "The local source repository looks protected.",
      details,
      nextActions: ["No action needed right now."],
      servedCommitShort,
      gitWorktreeCount,
      gitBranchCount,
      pendingLocalBranches,
      orphanWorktrees,
      localBlockerCount,
    };
  }

  return {
    state: "unknown",
    intent: "neutral",
    badgeLabel: "Unknown",
    headline: "DPF does not have enough local Git evidence yet.",
    details,
    nextActions: ["Refresh contributor inventory, then check this card again."],
    servedCommitShort,
    gitWorktreeCount,
    gitBranchCount,
    pendingLocalBranches,
    orphanWorktrees,
    localBlockerCount,
  };
}

function resolveRootServedCommit(lanes: ContributorChangeLane[]): string | null {
  const root =
    lanes.find((lane) => lane.laneKind === "root-portal") ??
    lanes.find((lane) => lane.id === "RT-ROOT-PORTAL");
  return root?.servedCommitSha ?? null;
}

function shortenSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
