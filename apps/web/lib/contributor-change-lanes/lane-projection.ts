import {
  CONTRIBUTOR_LANE_KINDS,
  DEFAULT_STALE_HEARTBEAT_MS,
  DEFAULT_STALE_VERIFIED_MS,
  type ContributorChangeLane,
  type ContributorLaneKind,
  type ContributorLaneStatus,
  type ContributorLaneVerification,
  type GitBranchSnapshot,
  type GitWorktreeSnapshot,
  type LaneProjectionInput,
  type LaneProjectionResult,
  type NonprodEnvironmentLeaseSnapshot,
  type PullRequestSnapshot,
  type RuntimeTargetSnapshot,
  type RuntimeVerificationSnapshot,
  type WorkCapsuleSnapshot,
} from "./types";

const LANE_KIND_SET: ReadonlySet<string> = new Set(CONTRIBUTOR_LANE_KINDS);

const BASE_BRANCHES: ReadonlySet<string> = new Set(["main", "master"]);

const LANE_STATUS_PRIORITY: Record<ContributorLaneStatus, number> = {
  blocked: 0,
  starting: 1,
  verifying: 2,
  running: 3,
  "ready-for-review": 4,
  claimed: 5,
  available: 6,
  released: 7,
  stale: 8,
  shipped: 9,
};

function scopeFromCapsule(capsule: WorkCapsuleSnapshot | null) {
  return {
    decisionScope: capsule?.decisionScope ?? null,
    portfolioRole: capsule?.portfolioRole ?? null,
    servedPersona: capsule?.servedPersona ?? null,
    activityKind: capsule?.activityKind ?? null,
    outcomeAnchor: capsule?.outcomeAnchor ?? null,
  };
}

export function projectContributorChangeLanes(
  input: LaneProjectionInput,
): LaneProjectionResult {
  const staleHeartbeatMs = input.staleHeartbeatThresholdMs ?? DEFAULT_STALE_HEARTBEAT_MS;
  const staleVerifiedMs = input.staleVerifiedThresholdMs ?? DEFAULT_STALE_VERIFIED_MS;
  const now = input.now;

  const verificationsByTarget = indexVerificationsByTarget(input.runtimeVerifications);
  const leasesByWorktree = indexLeasesByWorktree(input.leases);
  const leasesByBranch = indexLeasesByBranch(input.leases);
  const prByBranch = indexPullRequestsByBranch(input.pullRequests);
  const capsuleByBranch = indexCapsulesByBranch(input.workCapsules);
  const capsuleByWorktree = indexCapsulesByWorktree(input.workCapsules);

  const lanes: ContributorChangeLane[] = [];
  const consumedBranches = new Set<string>();
  const consumedWorktrees = new Set<string>();
  const consumedCapsules = new Set<string>();

  for (const target of input.runtimeTargets) {
    const laneKind = resolveLaneKind(target.kind);
    if (!laneKind) continue;

    const capsule = target.workCapsuleId
      ? input.workCapsules.find((c) => c.capsuleId === target.workCapsuleId) ?? null
      : null;
    const branchName = target.branchName ?? capsule?.headBranch ?? null;
    const pr = branchName ? prByBranch.get(branchName) ?? null : null;
    const lease =
      (target.workCapsuleId && leasesByWorktree.get(capsule?.worktreePath ?? "")) ||
      (branchName && leasesByBranch.get(branchName)) ||
      null;
    const latestVerification = verificationsByTarget.get(target.targetId) ?? null;

    const blockers: string[] = [];
    if (
      target.servedCommitSha &&
      capsule?.headSha &&
      target.servedCommitSha !== capsule.headSha
    ) {
      blockers.push(
        `Runtime serving ${shortenSha(target.servedCommitSha)} but branch head is ${shortenSha(capsule.headSha)}`,
      );
    }
    if (isStaleHeartbeat(target.lastHeartbeatAt, now, staleHeartbeatMs)) {
      blockers.push(
        `Runtime heartbeat stale since ${target.lastHeartbeatAt?.toISOString() ?? "unknown"}`,
      );
    }
    if (!capsule && target.kind !== "root-portal" && target.kind !== "dev-portal") {
      blockers.push("No active Work Capsule attached");
    }

    const status = resolveLaneStatusForTarget({
      target,
      lease,
      capsule,
      latestVerification,
      now,
      staleVerifiedMs,
    });

    lanes.push({
      id: target.targetId,
      laneKind,
      source: "runtime-target",
      status,
      owner: capsule?.leaseHolderPrincipalId ?? capsule?.executorRef ?? lease?.ownerSessionId ?? null,
      ownerProvider: lease?.ownerProvider ?? capsule?.executorKind ?? null,
      pullRequestNumber: pr?.number ?? null,
      branch: branchName,
      worktreePath: capsule?.worktreePath ?? lease?.worktreePath ?? null,
      commitSha: capsule?.headSha ?? null,
      servedCommitSha: target.servedCommitSha,
      pullRequestUrl: pr?.url ?? capsule?.pullRequestUrl ?? null,
      runtimeTargetId: target.targetId,
      runtimeUrl: target.hostUrl,
      workCapsuleId: capsule?.capsuleId ?? null,
      backlogItemId: capsule?.backlogItemId ?? null,
      ...scopeFromCapsule(capsule),
      expiresAt: lease?.expiresAt ?? target.expiresAt ?? null,
      lastHeartbeatAt: target.lastHeartbeatAt,
      latestVerification: presentVerification(latestVerification),
      blockers,
      nextAction: deriveNextActionForRuntime(status, blockers, target, capsule, pr),
    });

    if (capsule) consumedCapsules.add(capsule.capsuleId);
    if (capsule?.worktreePath) consumedWorktrees.add(capsule.worktreePath);
    if (lease?.worktreePath) consumedWorktrees.add(lease.worktreePath);
    if (branchName) consumedBranches.add(branchName);
  }

  for (const capsule of input.workCapsules) {
    if (consumedCapsules.has(capsule.capsuleId)) continue;
    if (capsule.status === "released" || capsule.status === "archived") continue;

    const isShipped =
      capsule.status === "complete" || capsule.status === "ready-for-promotion";
    const pr = capsule.headBranch ? prByBranch.get(capsule.headBranch) ?? null : null;
    const blockers: string[] = [];
    const hasTtl = Boolean(capsule.leaseExpiresAt);
    const isExpired = hasTtl && capsule.leaseExpiresAt! <= now;
    // Completed work needs no PR/TTL — those "blockers" only apply to in-flight capsules.
    if (!isShipped && !pr && !hasTtl) {
      blockers.push("No open PR and no active WIP TTL");
    }
    if (!isShipped && isExpired) {
      blockers.push(
        `WIP lease expired at ${capsule.leaseExpiresAt?.toISOString() ?? "unknown"}`,
      );
    }
    if (!isShipped && !capsule.headBranch) {
      blockers.push("Capsule has no branch");
    }

    const status: ContributorLaneStatus = isShipped
      ? "shipped"
      : isExpired
        ? "stale"
        : pr?.state === "open"
          ? "ready-for-review"
          : "claimed";

    lanes.push({
      id: capsule.capsuleId,
      laneKind: "external-debug",
      source: "work-capsule",
      status,
      owner: capsule.leaseHolderPrincipalId ?? capsule.executorRef,
      ownerProvider: capsule.executorKind,
      pullRequestNumber: pr?.number ?? null,
      branch: capsule.headBranch,
      worktreePath: capsule.worktreePath,
      commitSha: capsule.headSha,
      servedCommitSha: null,
      pullRequestUrl: pr?.url ?? capsule.pullRequestUrl,
      runtimeTargetId: null,
      runtimeUrl: null,
      workCapsuleId: capsule.capsuleId,
      backlogItemId: capsule.backlogItemId,
      ...scopeFromCapsule(capsule),
      expiresAt: capsule.leaseExpiresAt,
      lastHeartbeatAt: capsule.updatedAt,
      latestVerification: presentVerification(null),
      blockers,
      nextAction: deriveNextActionForCapsule(capsule, pr, blockers),
    });

    if (capsule.headBranch) consumedBranches.add(capsule.headBranch);
    if (capsule.worktreePath) consumedWorktrees.add(capsule.worktreePath);
  }

  for (const lease of input.leases) {
    if (lease.status !== "active") continue;
    if (lease.worktreePath && consumedWorktrees.has(lease.worktreePath)) continue;
    if (lease.branchName && consumedBranches.has(lease.branchName)) continue;

    const pr = lease.branchName ? prByBranch.get(lease.branchName) ?? null : null;
    const laneKind: ContributorLaneKind =
      lease.environmentKey === "local-integration-ci" ? "local-integration" : "dev-portal";
    const expired = lease.expiresAt ? lease.expiresAt <= now : false;
    const status: ContributorLaneStatus = expired ? "stale" : "claimed";
    const blockers: string[] = [];
    if (expired) blockers.push("Lease expired");
    if (!pr && !lease.expiresAt) blockers.push("No PR and no TTL");

    lanes.push({
      id: lease.leaseId,
      laneKind,
      source: "nonprod-lease",
      status,
      owner: lease.ownerSessionId,
      ownerProvider: lease.ownerProvider,
      pullRequestNumber: pr?.number ?? null,
      branch: lease.branchName,
      worktreePath: lease.worktreePath,
      commitSha: null,
      servedCommitSha: null,
      pullRequestUrl: pr?.url ?? null,
      runtimeTargetId: null,
      runtimeUrl: lease.url,
      workCapsuleId: null,
      backlogItemId: null,
      expiresAt: lease.expiresAt,
      lastHeartbeatAt: null,
      latestVerification: presentVerification(null),
      blockers,
      nextAction: expired ? "Release expired lease" : "Drive verification on the leased runtime",
    });

    if (lease.worktreePath) consumedWorktrees.add(lease.worktreePath);
    if (lease.branchName) consumedBranches.add(lease.branchName);
  }

  for (const branch of input.branches) {
    if (consumedBranches.has(branch.name)) continue;
    if (BASE_BRANCHES.has(branch.name)) continue;
    const pr = prByBranch.get(branch.name) ?? null;
    if (branch.isMerged && !pr) continue;
    const hasCapsule = capsuleByBranch.has(branch.name);
    if (hasCapsule) continue;

    const blockers: string[] = [];
    if (!pr) blockers.push("No open PR and no active WIP record");
    else blockers.push("PR exists but no Work Capsule attached");

    lanes.push({
      id: `branch:${branch.name}`,
      laneKind: "external-debug",
      source: "git-branch",
      status: pr?.state === "open" ? "claimed" : "stale",
      owner: null,
      ownerProvider: null,
      pullRequestNumber: pr?.number ?? null,
      branch: branch.name,
      worktreePath: null,
      commitSha: branch.headSha,
      servedCommitSha: null,
      pullRequestUrl: pr?.url ?? null,
      runtimeTargetId: null,
      runtimeUrl: null,
      workCapsuleId: null,
      backlogItemId: null,
      expiresAt: null,
      lastHeartbeatAt: branch.lastCommitAt,
      latestVerification: presentVerification(null),
      blockers,
      nextAction: pr
        ? "Attach a Work Capsule or close the PR"
        : "Open a PR or file a WIP handoff with TTL",
    });
  }

  for (const worktree of input.worktrees) {
    if (consumedWorktrees.has(worktree.path)) continue;
    if (worktree.branch && capsuleByBranch.has(worktree.branch)) continue;
    if (capsuleByWorktree.has(worktree.path)) continue;
    if (worktree.branch && BASE_BRANCHES.has(worktree.branch) && worktree.isRegistered) continue;

    const blockers = [
      worktree.isRegistered
        ? "Worktree has no active Work Capsule"
        : "Filesystem-only worktree (not registered with git)",
    ];

    lanes.push({
      id: `worktree:${worktree.path}`,
      laneKind: "external-debug",
      source: "worktree",
      status: "stale",
      owner: null,
      ownerProvider: null,
      pullRequestNumber: null,
      branch: worktree.branch,
      worktreePath: worktree.path,
      commitSha: worktree.headSha,
      servedCommitSha: null,
      pullRequestUrl: null,
      runtimeTargetId: null,
      runtimeUrl: null,
      workCapsuleId: null,
      backlogItemId: null,
      expiresAt: null,
      lastHeartbeatAt: null,
      latestVerification: presentVerification(null),
      blockers,
      nextAction: worktree.isRegistered
        ? "Attach a Work Capsule or remove the worktree"
        : "Register the worktree with git or remove the directory",
    });
  }

  lanes.sort(compareLanes);
  return { lanes };
}

function resolveLaneKind(kind: string): ContributorLaneKind | null {
  if (LANE_KIND_SET.has(kind)) return kind as ContributorLaneKind;
  return null;
}

function resolveLaneStatusForTarget(args: {
  target: RuntimeTargetSnapshot;
  lease: NonprodEnvironmentLeaseSnapshot | null;
  capsule: WorkCapsuleSnapshot | null;
  latestVerification: RuntimeVerificationSnapshot | null;
  now: Date;
  staleVerifiedMs: number;
}): ContributorLaneStatus {
  const { target, lease, capsule, latestVerification, now, staleVerifiedMs } = args;

  if (latestVerification?.status === "failed") return "blocked";
  if (target.status === "failed" || target.status === "blocked" || target.status === "misconfigured") {
    return "blocked";
  }
  if (target.status === "starting") return "starting";
  if (target.status === "verifying") return "verifying";
  if (target.status === "running") {
    if (latestVerification?.status === "passed" && capsule?.headSha && target.servedCommitSha === capsule.headSha) {
      return "ready-for-review";
    }
    return "running";
  }
  if (target.status === "verified") {
    if (
      target.lastHeartbeatAt &&
      now.getTime() - target.lastHeartbeatAt.getTime() > staleVerifiedMs
    ) {
      return "stale";
    }
    return "ready-for-review";
  }
  if (target.status === "released") return "released";
  if (target.status === "expired") return "stale";
  if (target.status === "assigned") return "claimed";
  if (target.status === "planned") {
    if (lease) return "starting";
    return "available";
  }
  return "available";
}

function deriveNextActionForRuntime(
  status: ContributorLaneStatus,
  blockers: string[],
  target: RuntimeTargetSnapshot,
  capsule: WorkCapsuleSnapshot | null,
  pr: PullRequestSnapshot | null,
): string {
  if (status === "blocked") return blockers[0] ?? "Investigate runtime failure";
  if (status === "starting") return "Wait for health check, then drive verification";
  if (status === "available") return "Claim the lane to begin verification";
  if (status === "ready-for-review") {
    if (pr) return "Review the open PR";
    return "Open a PR — runtime evidence is in place";
  }
  if (status === "running" && capsule?.headSha && target.servedCommitSha !== capsule.headSha) {
    return "Redeploy the branch head to this runtime";
  }
  if (status === "released") return "Lane released — claim a new one when ready";
  if (status === "stale") return "Lane is stale — release or refresh heartbeat";
  return "Drive verification on this lane";
}

function deriveNextActionForCapsule(
  capsule: WorkCapsuleSnapshot,
  pr: PullRequestSnapshot | null,
  blockers: string[],
): string {
  if (capsule.status === "complete" || capsule.status === "ready-for-promotion") {
    return "Shipped — work complete";
  }
  if (capsule.nextAction) return capsule.nextAction;
  if (blockers.length > 0) return blockers[0];
  if (pr?.state === "open") return "Drive ready-for-review verification";
  return "Open a PR or extend the WIP TTL";
}

function presentVerification(
  v: RuntimeVerificationSnapshot | null,
): ContributorLaneVerification {
  if (!v) return { status: "pending", checkedAt: null, summary: null };
  return {
    status: mapVerificationStatus(v.status),
    checkedAt: v.completedAt,
    summary: v.summary,
  };
}

function mapVerificationStatus(s: string): ContributorLaneVerification["status"] {
  switch (s) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "superseded":
    case "waived":
    case "skipped":
      return "blocked";
    case "running":
    case "pending":
      return "pending";
    default:
      return "pending";
  }
}

function isStaleHeartbeat(at: Date | null, now: Date, thresholdMs: number): boolean {
  if (!at) return false;
  return now.getTime() - at.getTime() > thresholdMs;
}

function shortenSha(sha: string): string {
  return sha.slice(0, 7);
}

function indexVerificationsByTarget(
  list: RuntimeVerificationSnapshot[],
): Map<string, RuntimeVerificationSnapshot> {
  const out = new Map<string, RuntimeVerificationSnapshot>();
  for (const v of list) {
    if (!v.runtimeTargetId) continue;
    const prev = out.get(v.runtimeTargetId);
    if (!prev) {
      out.set(v.runtimeTargetId, v);
      continue;
    }
    if ((v.completedAt?.getTime() ?? 0) > (prev.completedAt?.getTime() ?? 0)) {
      out.set(v.runtimeTargetId, v);
    }
  }
  return out;
}

function indexLeasesByWorktree(
  list: NonprodEnvironmentLeaseSnapshot[],
): Map<string, NonprodEnvironmentLeaseSnapshot> {
  const out = new Map<string, NonprodEnvironmentLeaseSnapshot>();
  for (const lease of list) {
    if (lease.status !== "active") continue;
    if (!lease.worktreePath) continue;
    out.set(lease.worktreePath, lease);
  }
  return out;
}

function indexLeasesByBranch(
  list: NonprodEnvironmentLeaseSnapshot[],
): Map<string, NonprodEnvironmentLeaseSnapshot> {
  const out = new Map<string, NonprodEnvironmentLeaseSnapshot>();
  for (const lease of list) {
    if (lease.status !== "active") continue;
    if (!lease.branchName) continue;
    out.set(lease.branchName, lease);
  }
  return out;
}

function indexPullRequestsByBranch(list: PullRequestSnapshot[]): Map<string, PullRequestSnapshot> {
  const out = new Map<string, PullRequestSnapshot>();
  for (const pr of list) {
    if (pr.state !== "open") continue;
    out.set(pr.headBranch, pr);
  }
  return out;
}

function indexCapsulesByBranch(list: WorkCapsuleSnapshot[]): Map<string, WorkCapsuleSnapshot> {
  const out = new Map<string, WorkCapsuleSnapshot>();
  for (const c of list) {
    if (!c.headBranch) continue;
    out.set(c.headBranch, c);
  }
  return out;
}

function indexCapsulesByWorktree(list: WorkCapsuleSnapshot[]): Map<string, WorkCapsuleSnapshot> {
  const out = new Map<string, WorkCapsuleSnapshot>();
  for (const c of list) {
    if (!c.worktreePath) continue;
    out.set(c.worktreePath, c);
  }
  return out;
}

function compareLanes(a: ContributorChangeLane, b: ContributorChangeLane): number {
  const aRank = LANE_STATUS_PRIORITY[a.status];
  const bRank = LANE_STATUS_PRIORITY[b.status];
  if (aRank !== bRank) return aRank - bRank;
  return a.id.localeCompare(b.id);
}
