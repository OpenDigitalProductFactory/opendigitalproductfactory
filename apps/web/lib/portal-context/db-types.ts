export type PortalUserRow = {
  id: string;
  isSuperuser?: boolean;
  groups?: Array<{ platformRole?: { roleId?: string | null } | null }>;
};

export type PrincipalAliasRow = {
  principal?: { principalId?: string | null } | null;
};

export type OrganizationRow = {
  orgId?: string | null;
  name?: string | null;
  storefrontConfig?: { archetypeId?: string | null } | null;
};

export type FeatureBuildRow = {
  id: string;
  buildId: string;
  title?: string | null;
  phase?: string | null;
  status?: string | null;
  threadId?: string | null;
  acceptanceMet?: unknown;
  verificationOut?: unknown;
  abandonedAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type WorkCapsuleRow = {
  id: string;
  capsuleId: string;
  title: string;
  status: string;
  executorKind?: string | null;
  executorRef?: string | null;
  leaseHolderPrincipalId?: string | null;
  leaseExpiresAt?: Date | string | null;
  updatedAt?: Date | string | null;
  scopeClaims?: unknown;
  headBranch?: string | null;
  headSha?: string | null;
  worktreePath?: string | null;
  backlogItemId?: string | null;
  epicId?: string | null;
  featureBuildId?: string | null;
  taskRunId?: string | null;
};

export type BacklogItemRow = {
  id: string;
  itemId: string;
  title: string;
  status: string;
  epicId?: string | null;
};

export type EpicRow = {
  id: string;
  epicId: string;
  title: string;
  status: string;
};

export type TaskRunRow = {
  id: string;
  taskRunId: string;
  contextId?: string | null;
  status: string;
  authorityScope?: unknown;
  parentTaskRunId?: string | null;
};

export type AgentThreadRow = {
  id: string;
  contextKey: string;
};

export type AgentRegistryRow = {
  agentId: string;
  name: string;
  description?: string | null;
  valueStream?: string | null;
  role?: string | null;
  skills?: Array<{
    label: string;
    description: string;
    capability?: string | null;
    taskType?: string | null;
  }>;
  toolGrants?: Array<{
    grantKey: string;
  }>;
};

export type AuthorityBindingRow = {
  subjects?: Array<{
    subjectType: string;
    subjectRef: string;
    relation: string;
  }>;
  grants?: Array<{
    grantKey: string;
    mode: string;
  }>;
};

export type ActivityRow = {
  id: string;
  kind: string;
  summary: string;
  recordedAt: Date | string;
};

export type PortalContextDb = {
  user: {
    findUnique(args: unknown): Promise<PortalUserRow | null>;
  };
  principalAlias: {
    findFirst(args: unknown): Promise<PrincipalAliasRow | null>;
  };
  organization: {
    findFirst(args: unknown): Promise<OrganizationRow | null>;
  };
  featureBuild: {
    findUnique(args: unknown): Promise<FeatureBuildRow | null>;
  };
  workroom: {
    findUnique(args: unknown): Promise<WorkCapsuleRow | null>;
    findFirst(args: unknown): Promise<WorkCapsuleRow | null>;
  };
  backlogItem: {
    findUnique(args: unknown): Promise<BacklogItemRow | null>;
  };
  epic: {
    findUnique(args: unknown): Promise<EpicRow | null>;
  };
  taskRun: {
    findUnique(args: unknown): Promise<TaskRunRow | null>;
    findFirst(args: unknown): Promise<TaskRunRow | null>;
  };
  agentThread: {
    findUnique(args: unknown): Promise<AgentThreadRow | null>;
  };
  agent: {
    findMany(args: unknown): Promise<AgentRegistryRow[]>;
  };
  authorityBinding?: {
    findMany(args: unknown): Promise<AuthorityBindingRow[]>;
  };
  workroomActivity: {
    findMany(args: unknown): Promise<ActivityRow[]>;
  };
  backlogItemActivity: {
    findMany(args: unknown): Promise<ActivityRow[]>;
  };
  toolExecutionReceipt: {
    findMany(args: unknown): Promise<ActivityRow[]>;
  };
  taskArtifact: {
    findMany(args: unknown): Promise<ActivityRow[]>;
  };
  externalEvidenceRecord: {
    findMany(args: unknown): Promise<ActivityRow[]>;
  };
};
