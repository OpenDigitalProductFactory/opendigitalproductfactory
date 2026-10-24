export const CONTRIBUTOR_LANE_KINDS = [
  "root-portal",
  "dev-portal",
  "build-sandbox",
  "local-integration",
  "external-debug",
] as const;

export type ContributorLaneKind = (typeof CONTRIBUTOR_LANE_KINDS)[number];

export const CONTRIBUTOR_LANE_STATUSES = [
  "available",
  "claimed",
  "starting",
  "running",
  "verifying",
  "blocked",
  "ready-for-review",
  "released",
  "stale",
  "shipped",
] as const;

export type ContributorLaneStatus = (typeof CONTRIBUTOR_LANE_STATUSES)[number];

export const CONTRIBUTOR_LANE_SOURCES = [
  "work-capsule",
  "runtime-target",
  "nonprod-lease",
  "git-branch",
  "worktree",
] as const;

export type ContributorLaneSource = (typeof CONTRIBUTOR_LANE_SOURCES)[number];

export const CONTRIBUTOR_LANE_VERIFICATION_STATUSES = [
  "pending",
  "passed",
  "failed",
  "blocked",
] as const;

export type ContributorLaneVerificationStatus =
  (typeof CONTRIBUTOR_LANE_VERIFICATION_STATUSES)[number];

export type ContributorLaneVerification = {
  status: ContributorLaneVerificationStatus;
  checkedAt: Date | null;
  summary: string | null;
};

export type ContributorChangeLane = {
  id: string;
  laneKind: ContributorLaneKind;
  source: ContributorLaneSource;
  status: ContributorLaneStatus;
  owner: string | null;
  /**
   * BI-3A34D7A9: WHICH agent client this lane belongs to (`claude`, `codex`,
   * `build-studio`, …), paired with `owner` (the client THREAD id). Null when
   * no lease or capsule names one — an outside contributor's branch has no
   * local origin, and that absence is itself the correct signal.
   */
  ownerProvider: string | null;
  /**
   * The PR number, when this lane has one. The PR number is the primary id
   * a human works with, so it is projected as a first-class field rather than
   * left to be parsed out of `pullRequestUrl`.
   */
  pullRequestNumber: number | null;
  branch: string | null;
  worktreePath: string | null;
  commitSha: string | null;
  servedCommitSha: string | null;
  pullRequestUrl: string | null;
  runtimeTargetId: string | null;
  runtimeUrl: string | null;
  workCapsuleId: string | null;
  backlogItemId: string | null;
  decisionScope?: string | null;
  portfolioRole?: string | null;
  servedPersona?: string | null;
  activityKind?: string | null;
  outcomeAnchor?: unknown;
  expiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  latestVerification: ContributorLaneVerification;
  blockers: string[];
  nextAction: string;
};

export type WorkCapsuleSnapshot = {
  capsuleId: string;
  title: string;
  status: string;
  executorKind: string | null;
  executorRef: string | null;
  headBranch: string | null;
  headSha: string | null;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  backlogItemId: string | null;
  featureBuildId: string | null;
  decisionScope: string | null;
  portfolioRole: string | null;
  servedPersona: string | null;
  activityKind: string | null;
  outcomeAnchor: unknown;
  leaseHolderPrincipalId: string | null;
  leaseExpiresAt: Date | null;
  updatedAt: Date | null;
  purpose: string | null;
  nextAction: string | null;
};

export type RuntimeTargetSnapshot = {
  targetId: string;
  kind: string;
  status: string;
  hostUrl: string | null;
  serviceVersion: string | null;
  servedCommitSha: string | null;
  workCapsuleId: string | null;
  featureBuildId: string | null;
  branchName: string | null;
  acceptanceRole: string | null;
  lastHeartbeatAt: Date | null;
  expiresAt: Date | null;
};

export type RuntimeVerificationSnapshot = {
  verificationId: string;
  runtimeTargetId: string | null;
  workCapsuleId: string | null;
  kind: string;
  status: string;
  summary: string | null;
  completedAt: Date | null;
};

export type NonprodEnvironmentLeaseSnapshot = {
  leaseId: string;
  environmentKey: string;
  status: string;
  ownerProvider: string;
  ownerSessionId: string | null;
  purpose: string | null;
  url: string | null;
  worktreePath: string | null;
  branchName: string | null;
  expiresAt: Date | null;
};

export type GitWorktreeSnapshot = {
  path: string;
  branch: string | null;
  headSha: string | null;
  isRegistered: boolean;
};

export type GitBranchSnapshot = {
  name: string;
  headSha: string | null;
  remote: "origin" | "local";
  isMerged: boolean;
  lastCommitAt: Date | null;
};

export type PullRequestSnapshot = {
  repositoryFullName?: string;
  number: number;
  url: string;
  title: string;
  headBranch: string;
  headSha?: string;
  state: "open" | "merged" | "closed";
  isDraft: boolean;
  mergeStateStatus: string | null;
  mergeCommitSha?: string | null;
  mergedAt?: string | null;
  providerUpdatedAt?: string;
  observedAt?: string;
  providerApiVersion?: string;
  observationFingerprint?: string;
};

export type LaneProjectionInput = {
  workCapsules: WorkCapsuleSnapshot[];
  runtimeTargets: RuntimeTargetSnapshot[];
  runtimeVerifications: RuntimeVerificationSnapshot[];
  leases: NonprodEnvironmentLeaseSnapshot[];
  worktrees: GitWorktreeSnapshot[];
  branches: GitBranchSnapshot[];
  pullRequests: PullRequestSnapshot[];
  now: Date;
  staleHeartbeatThresholdMs?: number;
  staleVerifiedThresholdMs?: number;
};

export type LaneProjectionResult = {
  lanes: ContributorChangeLane[];
};

export const DEFAULT_STALE_HEARTBEAT_MS = 10 * 60 * 1000;
export const DEFAULT_STALE_VERIFIED_MS = 7 * 24 * 60 * 60 * 1000;
