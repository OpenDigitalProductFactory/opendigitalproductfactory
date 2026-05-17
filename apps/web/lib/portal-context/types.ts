export type PortalContextInput = {
  pathname: string;
  routeContext: string;
  buildId?: string | null;
  capsuleId?: string | null;
  threadId?: string | null;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
};

export type PortalObjectAnchor = {
  kind: "backlogItem" | "epic" | "capsule" | "build" | "taskRun" | "agentThread" | "branch";
  id: string;
  label: string;
  href?: string | null;
};

export type WorkBacklogAnchor = {
  backlogItemId: string;
  title: string;
  status: string;
  epicId: string | null;
  href: string;
};

export type WorkEpicAnchor = {
  epicId: string;
  title: string;
  status: string;
  href: string;
};

export type WorkCapsuleAnchor = {
  capsuleId: string;
  title: string;
  status: string;
  executorKind: string;
  leaseExpiresAt: string | null;
  isLeaseExpired: boolean;
  isStale: boolean;
  scopeClaims: string[];
  branchName: string | null;
  href: string;
};

export type FeatureBuildAnchor = {
  buildId: string;
  title: string;
  phase: string;
  status: string;
  evidenceComplete: boolean;
  href: string;
};

export type TaskRunAnchor = {
  taskRunId: string;
  contextId: string;
  status: string;
  authorityScope: string;
  parentTaskRunId: string | null;
};

export type AgentThreadAnchor = {
  threadId: string;
  routeContext: string;
  buildId: string | null;
};

export type GitBranchAnchor = {
  branchName: string;
  worktreePath: string | null;
  commitSha: string | null;
};

export type EvidenceSummary = {
  kind: string;
  source:
    | "capsule_activity"
    | "backlog_activity"
    | "tool_execution"
    | "task_artifact"
    | "external_evidence"
    | "build_evidence";
  recordId: string;
  label: string;
  recordedAt: string;
  isGap: boolean;
};

export type AuthoritySummary = {
  canActOnCapsule: boolean;
  canActOnBuild: boolean;
  canReviewPromotion: boolean;
  grantedToolKeys: string[];
  proposalModeActive: boolean;
};

export type AttentionSignal = {
  kind:
    | "missing_evidence"
    | "lease_expired"
    | "scope_overlap"
    | "build_stalled"
    | "capsule_not_linked"
    | "missing_grants"
    | "context_conflict"
    | "source_unavailable"
    | "envelope_timeout"
    | "unknown_route"
    | "no_active_build";
  severity: "info" | "warning" | "error";
  message: string;
  actionLabel?: string | null;
  actionHref?: string | null;
};

export type HiveMindCandidate = {
  agentId: string;
  label: string;
  role: "builder" | "reviewer" | "architect" | "tester" | "operator" | "specialist";
  reason: string;
  activation: "passive-suggestion" | "ask-now" | "required-before-promotion";
  requiredGrantKeys: string[];
  taskType: "conversation" | "analysis" | "code_generation" | "verification";
};

export type PortalContextEnvelope = {
  envelopeId: string;
  resolvedAt: string;
  route: {
    pathname: string;
    routeContext: string;
    domain: string;
    sensitivity: string;
    docsPath?: string | null;
  };
  organization: {
    organizationId: string | null;
    name: string | null;
    archetypeId?: string | null;
  };
  user: {
    userId: string;
    principalId: string | null;
    platformRole: string;
  };
  anchors: PortalObjectAnchor[];
  work: {
    backlogItem?: WorkBacklogAnchor | null;
    epic?: WorkEpicAnchor | null;
    capsule?: WorkCapsuleAnchor | null;
    featureBuild?: FeatureBuildAnchor | null;
    taskRun?: TaskRunAnchor | null;
    agentThread?: AgentThreadAnchor | null;
    branch?: GitBranchAnchor | null;
  };
  evidence: EvidenceSummary[];
  authority: AuthoritySummary;
  coworkers: HiveMindCandidate[];
  attention: AttentionSignal[];
  promptDigest: string;
};
