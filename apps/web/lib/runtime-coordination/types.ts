export const RUNTIME_TARGET_KINDS = [
  "root-portal",
  "dev-portal",
  "build-sandbox",
  "git-promotion-sandbox",
  "external-preview",
  "ad-hoc-debug",
] as const;

export type RuntimeTargetKind = (typeof RUNTIME_TARGET_KINDS)[number];

export const RUNTIME_TARGET_STATUSES = [
  "planned",
  "assigned",
  "starting",
  "running",
  "verifying",
  "verified",
  "failed",
  "released",
  "expired",
  "blocked",
  "misconfigured",
] as const;

export type RuntimeTargetStatus = (typeof RUNTIME_TARGET_STATUSES)[number];

export const RUNTIME_ACCEPTANCE_ROLES = [
  "none",
  "non-prod-verification",
  "final-acceptance",
  "debug-only",
] as const;

export type RuntimeAcceptanceRole = (typeof RUNTIME_ACCEPTANCE_ROLES)[number];

export const RUNTIME_ACCEPTANCE_ROLE_OVERRIDES = [
  "debug-only",
] as const;

export type RuntimeAcceptanceRoleOverride = (typeof RUNTIME_ACCEPTANCE_ROLE_OVERRIDES)[number];

export const RUNTIME_VERIFICATION_KINDS = [
  "health",
  "typecheck",
  "production-build",
  "unit-test",
  "ux",
  "migration",
  "manual-review",
  "ci",
  "final-acceptance",
] as const;

export type RuntimeVerificationKind = (typeof RUNTIME_VERIFICATION_KINDS)[number];

export const RUNTIME_VERIFICATION_STATUSES = [
  "pending",
  "running",
  "passed",
  "failed",
  "skipped",
  "superseded",
  "waived",
] as const;

export type RuntimeVerificationStatus = (typeof RUNTIME_VERIFICATION_STATUSES)[number];

export type RuntimeTargetInput = {
  targetId: string;
  kind: RuntimeTargetKind;
  status: RuntimeTargetStatus;
  workCapsuleId?: string | null;
  featureBuildId?: string | null;
  sandboxId?: string | null;
  slotId?: string | null;
  composeProjectName?: string | null;
  serviceName?: string | null;
  containerName?: string | null;
  hostUrl?: string | null;
  internalUrl?: string | null;
  port?: number | null;
  serviceVersion?: string | null;
  acceptanceRoleOverride?: RuntimeAcceptanceRoleOverride | null;
  debugReason?: string | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};

export type RuntimeVerificationInput = {
  verificationId: string;
  kind: RuntimeVerificationKind;
  status: RuntimeVerificationStatus;
  runtimeTargetId?: string | null;
  workCapsuleId?: string | null;
  featureBuildId?: string | null;
  gitPromotionCandidateId?: string | null;
  command?: string | null;
  url?: string | null;
  evidenceUrl?: string | null;
  screenshotUrl?: string | null;
  toolExecutionId?: string | null;
  buildActivityId?: string | null;
  backlogActivityId?: string | null;
  capsuleActivityId?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  result?: Record<string, unknown> | null;
};
