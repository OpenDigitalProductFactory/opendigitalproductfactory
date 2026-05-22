import { prisma } from "@dpf/db";

import { lazyExec } from "@/lib/shared/lazy-node";

import {
  buildSandboxSourceCurrencyProbeCommand,
  formatSandboxSourceCurrencySummary,
  parseSandboxSourceCurrencyProbeOutput,
  type SandboxSourceCurrencyStatus,
} from "./sandbox-source-currency";
import { execInSandbox } from "./sandbox";
import {
  parseDockerInspectJson,
  type DockerComposeContainerInfo,
} from "./docker-compose-inspector";
import type {
  RecommendedSandboxAction,
  SandboxCheckResult,
  SandboxReadinessSnapshot,
  SandboxReadinessState,
} from "./sandbox-admin-types";

type JsonRecord = Record<string, unknown>;

type FeatureBuildRow = {
  id: string;
  buildId: string;
  phase?: string | null;
  sandboxId?: string | null;
  sandboxPort?: number | null;
  buildBranch?: string | null;
  diffPatch?: string | null;
  taskResults?: unknown;
  verificationOut?: unknown;
  uxVerificationStatus?: string | null;
  buildExecState?: unknown;
};

type RuntimeTargetRow = {
  id: string;
  targetId?: string | null;
  status?: string | null;
  composeProjectName?: string | null;
  serviceName?: string | null;
  containerName?: string | null;
  port?: number | null;
  lastHeartbeatAt?: Date | string | null;
};

type BuildPhaseRunRow = {
  phase: string;
  startedAt: Date | string;
  completedAt?: Date | string | null;
};

export type SandboxAdminDb = {
  featureBuild: {
    findUnique(args: unknown): Promise<FeatureBuildRow | null>;
  };
  runtimeTarget: {
    findFirst(args: unknown): Promise<RuntimeTargetRow | null>;
  };
  buildPhaseRun?: {
    findFirst(args: unknown): Promise<BuildPhaseRunRow | null>;
  };
};

export type SandboxGitProbe = {
  branchName: string | null;
  dirty: boolean;
  sourceCurrencyStatus: SandboxSourceCurrencyStatus | "unverified";
  sourceCurrencySummary?: string | null;
};

export type DiagnoseSandboxReadinessArgs = {
  buildId: string;
  db?: SandboxAdminDb;
  expectedWorkspaceRoot?: string | null;
  inspectContainer?: (containerId: string) => Promise<DockerComposeContainerInfo | null>;
  inspectGit?: (containerId: string, build: FeatureBuildRow) => Promise<SandboxGitProbe>;
  now?: Date;
};

const PHASE_STUCK_AFTER_MS = 45 * 60 * 1000;

const exec = lazyExec();

export async function diagnoseSandboxReadiness(
  args: DiagnoseSandboxReadinessArgs,
): Promise<SandboxReadinessSnapshot> {
  const db = args.db ?? (prisma as unknown as SandboxAdminDb);
  const now = args.now ?? new Date();
  const inspectedAt = now.toISOString();
  const checks: SandboxCheckResult[] = [];
  const build = await findBuild(db, args.buildId);

  if (!build) {
    checks.push(check("build_row", "Build record", "fail", {
      expected: args.buildId,
      actual: null,
      detail: "Build Studio has no FeatureBuild row for this build id.",
    }));
    return snapshot({
      buildId: args.buildId,
      inspectedAt,
      state: "not_found",
      summary: "Build Studio cannot find the submitted build record.",
      checks,
      recommendedActions: [action("reset_build_phase")],
    });
  }

  checks.push(check("build_row", "Build record", "pass", {
    expected: args.buildId,
    actual: build.buildId,
  }));

  const runtimeTarget = await findRuntimeTarget(db, build);
  const phaseRun = await findCurrentPhaseRun(db, build);
  const containerId = build.sandboxId?.trim() || null;

  if (!containerId) {
    checks.push(check("sandbox_metadata", "Sandbox metadata", "fail", {
      expected: "container id",
      actual: null,
      detail: "FeatureBuild.sandboxId is empty, so Build Studio has no sandbox to inspect.",
    }));
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      branchName: build.buildBranch ?? null,
      state: "not_found",
      summary: "Build Studio has no registered sandbox container for this build.",
      checks,
      recommendedActions: [action("restart")],
    });
  }

  checks.push(check("sandbox_metadata", "Sandbox metadata", "pass", {
    expected: "container id",
    actual: containerId,
  }));
  checks.push(check(
    "runtime_target",
    "Runtime target",
    runtimeTarget ? "pass" : "warn",
    {
      expected: "runtime target row",
      actual: runtimeTarget?.targetId ?? runtimeTarget?.id ?? null,
      detail: runtimeTarget
        ? "Runtime target is registered for this build."
        : "No RuntimeTarget row is linked to this build; admin actions may need to rebind it.",
    },
  ));

  const inspectContainer = args.inspectContainer ?? inspectDockerContainer;
  const container = await inspectContainer(containerId);

  if (!container) {
    checks.push(check("docker_container", "Docker container", "fail", {
      expected: containerId,
      actual: null,
      detail: "Docker inspect did not return a container for the build sandbox id.",
    }));
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      containerId,
      branchName: build.buildBranch ?? null,
      state: "not_found",
      summary: "The registered sandbox container no longer exists.",
      checks,
      recommendedActions: [action("restart"), action("quarantine_runtime_target")],
    });
  }

  checks.push(check("docker_container", "Docker container", container.running ? "pass" : "fail", {
    expected: "running",
    actual: container.status,
    detail: container.running
      ? "Docker reports the registered sandbox container is running."
      : "Docker reports the registered sandbox container is not running.",
  }));

  if (!container.running) {
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      containerId: container.containerId || containerId,
      branchName: build.buildBranch ?? null,
      state: "stopped",
      summary: "The registered sandbox container exists but is stopped.",
      checks,
      recommendedActions: [action("start"), action("restart")],
    });
  }

  const composeState = checkComposeOwnership({
    expectedWorkspaceRoot: args.expectedWorkspaceRoot,
    runtimeTarget,
    container,
  });
  checks.push(composeState.check);
  if (composeState.state) {
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      containerId: container.containerId || containerId,
      branchName: build.buildBranch ?? null,
      state: composeState.state,
      summary: "The registered sandbox container belongs to a different Compose project or worktree.",
      checks,
      recommendedActions: [action("rebind_runtime_target"), action("restart")],
    });
  }

  const inspectGit = args.inspectGit ?? inspectSandboxGit;
  const git = await inspectGit(containerId, build);
  checks.push(check("sandbox_branch", "Sandbox branch", git.branchName === build.buildBranch ? "pass" : "fail", {
    expected: build.buildBranch ?? null,
    actual: git.branchName,
    detail: git.branchName === build.buildBranch
      ? "Sandbox git branch matches the FeatureBuild branch."
      : "Sandbox git branch does not match the FeatureBuild branch.",
  }));
  checks.push(check("workspace_dirty", "Workspace dirty state", git.dirty ? "fail" : "pass", {
    expected: false,
    actual: git.dirty,
    detail: git.dirty
      ? "Sandbox has uncommitted source changes that must be reconciled before deployment."
      : "Sandbox working tree is clean.",
  }));
  checks.push(check("source_currency", "Source currency", git.sourceCurrencyStatus === "current" ? "pass" : "warn", {
    expected: "current",
    actual: git.sourceCurrencyStatus,
    detail: git.sourceCurrencySummary ?? undefined,
  }));

  if (git.branchName !== build.buildBranch) {
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      containerId: container.containerId || containerId,
      branchName: git.branchName,
      state: "branch_mismatch",
      summary: "The sandbox is checked out to a different branch than the submitted build.",
      checks,
      recommendedActions: [action("checkout_registered_branch"), action("restart")],
    });
  }

  if (git.dirty) {
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      containerId: container.containerId || containerId,
      branchName: git.branchName,
      state: "dirty_or_leaking",
      summary: "The sandbox working tree is dirty and cannot be deployed safely.",
      checks,
      recommendedActions: [action("quarantine_runtime_target"), action("restart")],
    });
  }

  if (git.sourceCurrencyStatus !== "current" && git.sourceCurrencyStatus !== "ahead") {
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      containerId: container.containerId || containerId,
      branchName: git.branchName,
      state: "stale_source",
      summary: "The sandbox source is not current with the registered target ref.",
      checks,
      recommendedActions: [action("reset_from_main"), action("restart")],
    });
  }

  const stuckReason = classifyStuckMidPhase(build, phaseRun, now);
  if (stuckReason) {
    checks.push(check("phase_progress", "Build phase progress", "fail", {
      expected: "active phase with releasable diff",
      actual: stuckReason,
    }));
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      containerId: container.containerId || containerId,
      branchName: git.branchName,
      state: "stuck_mid_phase",
      summary: stuckReason,
      checks,
      recommendedActions: [action("reset_build_phase"), action("restart")],
    });
  }

  const verificationCheck = classifyVerification(build);
  checks.push(verificationCheck);
  if (verificationCheck.status === "fail") {
    return snapshot({
      buildId: build.buildId,
      inspectedAt,
      runtimeTargetId: runtimeTarget?.id ?? null,
      containerId: container.containerId || containerId,
      branchName: git.branchName,
      state: "verification_red",
      summary: "The sandbox is reachable, but the recorded verification gate is red.",
      checks,
      recommendedActions: [action("reset_build_phase")],
    });
  }

  return snapshot({
    buildId: build.buildId,
    inspectedAt,
    runtimeTargetId: runtimeTarget?.id ?? null,
    containerId: container.containerId || containerId,
    branchName: git.branchName,
    state: "healthy",
    summary: "Sandbox is running, bound to the expected worktree, current, clean, and verified.",
    checks,
    recommendedActions: [],
    canDeploy: true,
    canContribute: true,
  });
}

export async function inspectDockerContainer(containerId: string): Promise<DockerComposeContainerInfo | null> {
  try {
    const { stdout } = await exec(`docker inspect ${shellQuote(containerId)}`);
    return parseDockerInspectJson(stdout);
  } catch {
    return null;
  }
}

export async function inspectSandboxGit(
  containerId: string,
  build: FeatureBuildRow,
): Promise<SandboxGitProbe> {
  try {
    const targetRef = "origin/main";
    const workspace = "/workspace";
    const output = await execInSandbox(
      containerId,
      buildSandboxSourceCurrencyProbeCommand({ workspace, targetRef }),
    );
    const sourceSnapshot = parseSandboxSourceCurrencyProbeOutput(output, {
      targetRef,
      workspace,
    });
    return {
      branchName: sourceSnapshot.branch,
      dirty: sourceSnapshot.dirty,
      sourceCurrencyStatus: sourceSnapshot.status,
      sourceCurrencySummary: formatSandboxSourceCurrencySummary(sourceSnapshot),
    };
  } catch {
    return {
      branchName: build.buildBranch ?? null,
      dirty: false,
      sourceCurrencyStatus: "unverified",
      sourceCurrencySummary: "Sandbox git source could not be inspected.",
    };
  }
}

async function findBuild(db: SandboxAdminDb, buildId: string) {
  return db.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      buildId: true,
      phase: true,
      sandboxId: true,
      sandboxPort: true,
      buildBranch: true,
      diffPatch: true,
      taskResults: true,
      verificationOut: true,
      uxVerificationStatus: true,
      buildExecState: true,
    },
  });
}

async function findRuntimeTarget(db: SandboxAdminDb, build: FeatureBuildRow) {
  return db.runtimeTarget.findFirst({
    where: {
      OR: [
        { featureBuildId: build.id },
        { containerName: build.sandboxId },
        { sandboxId: build.sandboxId },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function findCurrentPhaseRun(db: SandboxAdminDb, build: FeatureBuildRow) {
  if (!db.buildPhaseRun || !build.phase) return null;
  return db.buildPhaseRun.findFirst({
    where: { buildId: build.buildId, phase: build.phase },
    orderBy: { startedAt: "desc" },
  });
}

function checkComposeOwnership(args: {
  expectedWorkspaceRoot?: string | null;
  runtimeTarget: RuntimeTargetRow | null;
  container: DockerComposeContainerInfo;
}): { state: SandboxReadinessState | null; check: SandboxCheckResult } {
  const expectedProject = args.runtimeTarget?.composeProjectName ?? null;
  const actualProject = args.container.composeProjectName;
  const projectMismatch = expectedProject && actualProject && expectedProject !== actualProject;
  const expectedRoot = normalizeSandboxPathForComparison(args.expectedWorkspaceRoot);
  const actualRoot = normalizeSandboxPathForComparison(args.container.composeWorkingDir);
  const rootMismatch = expectedRoot && actualRoot && expectedRoot !== actualRoot;

  if (projectMismatch || rootMismatch) {
    return {
      state: "mixed_compose_project",
      check: check("compose_working_dir", "Compose working directory", "fail", {
        expected: args.expectedWorkspaceRoot ?? expectedProject,
        actual: args.container.composeWorkingDir ?? actualProject,
        detail: "Docker labels point at a different Compose owner than the registered build context.",
      }),
    };
  }

  return {
    state: null,
    check: check("compose_working_dir", "Compose working directory", "pass", {
      expected: args.expectedWorkspaceRoot ?? expectedProject,
      actual: args.container.composeWorkingDir ?? actualProject,
    }),
  };
}

function classifyStuckMidPhase(
  build: FeatureBuildRow,
  phaseRun: BuildPhaseRunRow | null,
  now: Date,
): string | null {
  const execState = asRecord(build.buildExecState);
  const taskResults = asRecord(build.taskResults);
  const step = stringField(execState, "step") ?? stringField(execState, "status");
  const filesChanged = numberField(taskResults, "filesChanged");
  const hasDiff = Boolean(build.diffPatch?.trim());

  if (step === "complete" && filesChanged === 0 && !hasDiff) {
    return "Build phase finished without a releasable diff.";
  }

  if (!phaseRun || phaseRun.completedAt) {
    return null;
  }

  const startedAt = new Date(phaseRun.startedAt).getTime();
  if (Number.isFinite(startedAt) && now.getTime() - startedAt > PHASE_STUCK_AFTER_MS) {
    return `Build phase ${phaseRun.phase} has been running without completion for more than 45 minutes.`;
  }

  return null;
}

function classifyVerification(build: FeatureBuildRow): SandboxCheckResult {
  const verification = asRecord(build.verificationOut);
  const typecheckPassed = booleanField(verification, "typecheckPassed");
  const buildPassed = booleanField(verification, "buildPassed");
  const testsFailed = numberField(verification, "testsFailed");
  const testsPassed = booleanField(verification, "testsPassed");
  const uxFailed = build.uxVerificationStatus === "failed";
  const failed = typecheckPassed === false ||
    buildPassed === false ||
    uxFailed ||
    (testsFailed != null && testsFailed > 0) ||
    testsPassed === false;

  if (failed) {
    return check("verification", "Verification gate", "fail", {
      expected: "passing",
      actual: "red",
      detail: "Recorded Build Studio verification has at least one failing check.",
    });
  }

  if (typecheckPassed === true || buildPassed === true || testsPassed === true || testsFailed === 0) {
    return check("verification", "Verification gate", "pass", {
      expected: "passing",
      actual: "passing",
    });
  }

  return check("verification", "Verification gate", "warn", {
    expected: "verification evidence",
    actual: "missing",
    detail: "Build Studio has not recorded verification evidence yet.",
  });
}

function snapshot(args: {
  buildId: string;
  inspectedAt: string;
  state: SandboxReadinessState;
  summary: string;
  checks: SandboxCheckResult[];
  recommendedActions: RecommendedSandboxAction[];
  runtimeTargetId?: string | null;
  containerId?: string | null;
  branchName?: string | null;
  canDeploy?: boolean;
  canContribute?: boolean;
}): SandboxReadinessSnapshot {
  const canDeploy = args.canDeploy ?? false;
  return {
    buildId: args.buildId,
    state: args.state,
    canDeploy,
    canContribute: args.canContribute ?? canDeploy,
    summary: args.summary,
    checks: args.checks,
    recommendedActions: args.recommendedActions,
    inspectedAt: args.inspectedAt,
    runtimeTargetId: args.runtimeTargetId ?? null,
    containerId: args.containerId ?? null,
    branchName: args.branchName ?? null,
  };
}

function check(
  id: string,
  label: string,
  status: SandboxCheckResult["status"],
  data: Omit<SandboxCheckResult, "id" | "label" | "status"> = {},
): SandboxCheckResult {
  return { id, label, status, ...data };
}

function action(actionName: RecommendedSandboxAction["action"]): RecommendedSandboxAction {
  const labels: Record<RecommendedSandboxAction["action"], string> = {
    start: "Start sandbox",
    restart: "Restart sandbox",
    rebind_runtime_target: "Rebind runtime target",
    release_stale_slot: "Release stale slot",
    checkout_registered_branch: "Checkout registered branch",
    reset_from_main: "Reset sandbox from main",
    quarantine_runtime_target: "Quarantine runtime target",
    reset_build_phase: "Reset build phase",
  };

  return {
    action: actionName,
    label: labels[actionName],
    requiresApproval: actionName !== "start" && actionName !== "checkout_registered_branch",
  };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanField(record: JsonRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

export function normalizeSandboxPathForComparison(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  let end = trimmed.length;

  while (end > 0) {
    const code = trimmed.charCodeAt(end - 1);
    if (code !== 47 && code !== 92) break;
    end -= 1;
  }

  return trimmed.slice(0, end).split("\\").join("/").toLowerCase();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
