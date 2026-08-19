export const SANDBOX_READINESS_STATES = [
  "healthy",
  "stopped",
  "not_found",
  "detached",
  "mixed_compose_project",
  "branch_mismatch",
  "stale_source",
  "dirty_or_leaking",
  "verification_red",
  "stuck_mid_phase",
  "unrecoverable",
] as const;

export type SandboxReadinessState = (typeof SANDBOX_READINESS_STATES)[number];

const READINESS_STATE_SET = new Set<string>(SANDBOX_READINESS_STATES);

export function isSandboxReadinessState(value: unknown): value is SandboxReadinessState {
  return typeof value === "string" && READINESS_STATE_SET.has(value);
}

export type SandboxCheckStatus = "pass" | "warn" | "fail" | "unknown";

export type SandboxCheckResult = {
  id: string;
  label: string;
  status: SandboxCheckStatus;
  expected?: string | number | boolean | null;
  actual?: string | number | boolean | null;
  detail?: string;
};

export type SandboxRecoveryAction =
  | "start"
  | "restart"
  | "rebind_runtime_target"
  | "release_stale_slot"
  | "checkout_registered_branch"
  | "reset_from_main"
  | "quarantine_runtime_target"
  | "reset_build_phase";

export const SANDBOX_RECOVERY_ACTIONS = [
  "start",
  "restart",
  "rebind_runtime_target",
  "release_stale_slot",
  "checkout_registered_branch",
  "reset_from_main",
  "quarantine_runtime_target",
  "reset_build_phase",
] as const satisfies readonly SandboxRecoveryAction[];

const RECOVERY_ACTION_SET = new Set<string>(SANDBOX_RECOVERY_ACTIONS);

export function isSandboxRecoveryAction(value: unknown): value is SandboxRecoveryAction {
  return typeof value === "string" && RECOVERY_ACTION_SET.has(value);
}

export type RecommendedSandboxAction = {
  action: SandboxRecoveryAction;
  label: string;
  requiresApproval: boolean;
  disabledReason?: string | null;
};

export type SandboxReadinessSnapshot = {
  buildId: string;
  state: SandboxReadinessState;
  canDeploy: boolean;
  canContribute: boolean;
  summary: string;
  checks: SandboxCheckResult[];
  recommendedActions: RecommendedSandboxAction[];
  inspectedAt: string;
  runtimeTargetId?: string | null;
  containerId?: string | null;
  branchName?: string | null;
};
