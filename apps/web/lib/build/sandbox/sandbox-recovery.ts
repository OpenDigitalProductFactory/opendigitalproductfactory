import { prisma } from "@dpf/db";

import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";

import { diagnoseSandboxReadiness } from "./sandbox-admin";
import {
  buildSandboxBranchSwitchPrepCommand,
  buildSandboxCommitInFlightWorkCommand,
  buildSandboxGitCleanCommand,
  wrapSandboxGitCommand,
} from "./build-branch";
import type {
  SandboxReadinessSnapshot,
  SandboxRecoveryAction,
} from "./sandbox-admin-types";

export type SandboxRecoveryConfirmation = {
  discardSandboxChanges?: boolean;
  acknowledgeReset?: boolean;
  reason?: string;
} | null;

export type SandboxRecoveryDb = {
  buildActivity?: {
    create(args: unknown): Promise<unknown>;
    findFirst?(args: unknown): Promise<{ createdAt: Date | string } | null>;
  };
  buildPhaseRun?: {
    updateMany(args: unknown): Promise<unknown>;
  };
  runtimeTarget?: {
    updateMany(args: unknown): Promise<unknown>;
  };
  sandboxSlot?: {
    updateMany(args: unknown): Promise<unknown>;
  };
  featureBuild?: {
    findUnique?(args: unknown): Promise<{ buildBranch?: string | null } | null>;
    update(args: unknown): Promise<unknown>;
  };
};

export type SandboxRecoveryResult = {
  success: boolean;
  message: string;
  error?: string;
  snapshot?: SandboxReadinessSnapshot;
};

export type RecoverSandboxArgs = {
  buildId: string;
  action: SandboxRecoveryAction;
  confirmation?: SandboxRecoveryConfirmation;
  diagnose?: (buildId: string) => Promise<SandboxReadinessSnapshot>;
  runCommand?: (command: string, args: string[]) => Promise<string>;
  recordActivity?: (buildId: string, summary: string) => Promise<void>;
  db?: SandboxRecoveryDb;
  now?: Date;
};

const STALE_SLOT_IDLE_FLOOR_MS = 7 * 24 * 60 * 60 * 1000;

export async function recoverSandbox(args: RecoverSandboxArgs): Promise<SandboxRecoveryResult> {
  const db = args.db ?? (prisma as unknown as SandboxRecoveryDb);
  const diagnose = args.diagnose ?? ((buildId: string) => diagnoseSandboxReadiness({ buildId }));
  const runCommand = args.runCommand ?? runCommandDefault;
  const now = args.now ?? new Date();
  const before = await diagnose(args.buildId);

  switch (args.action) {
    case "start":
      return runContainerAction({
        buildId: args.buildId,
        before,
        diagnose,
        runCommand,
        commandArgs: ["start", requireContainerId(before)],
        message: "Sandbox start completed.",
        record: (summary) => recordRecoveryActivity(args, db, summary),
      });

    case "restart":
      return runContainerAction({
        buildId: args.buildId,
        before,
        diagnose,
        runCommand,
        commandArgs: ["restart", requireContainerId(before)],
        message: "Sandbox restart completed.",
        record: (summary) => recordRecoveryActivity(args, db, summary),
      });

    case "quarantine_runtime_target":
      await quarantineRuntimeTarget(db, before, now);
      await recordRecoveryActivity(args, db, "sandbox_recovery: quarantine_runtime_target");
      return successWithSnapshot(args.buildId, "Runtime target quarantined.", diagnose);

    case "release_stale_slot":
      return releaseStaleSlot({
        ...args,
        db,
        diagnose,
        now,
        before,
      });

    case "reset_build_phase":
      return resetBuildPhase({
        ...args,
        db,
        diagnose,
        now,
        before,
      });

    case "reset_from_main":
      await recordRecoveryActivity(args, db, "sandbox_recovery: reset_from_main blocked pending destructive reset workflow");
      if (!args.confirmation?.discardSandboxChanges || !hasReason(args.confirmation)) {
        return {
          success: false,
          error: "confirmation required",
          message: "reset_from_main requires confirmation with discardSandboxChanges=true and a reason.",
          snapshot: before,
        };
      }
      return {
        success: false,
        error: "reset_from_main not implemented",
        message: "reset_from_main is blocked until the destructive reset workflow records a full incident.",
        snapshot: before,
      };

    case "checkout_registered_branch":
      return checkoutRegisteredBranch({
        ...args,
        db,
        diagnose,
        runCommand,
        before,
      });

    case "rebind_runtime_target":
      return {
        success: false,
        error: "recovery action not implemented",
        message: `${args.action} is not implemented in the V1 recovery service.`,
        snapshot: before,
      };
  }
}

async function checkoutRegisteredBranch(args: RecoverSandboxArgs & {
  db: SandboxRecoveryDb;
  diagnose: (buildId: string) => Promise<SandboxReadinessSnapshot>;
  runCommand: (command: string, args: string[]) => Promise<string>;
  before: SandboxReadinessSnapshot;
}): Promise<SandboxRecoveryResult> {
  const containerId = requireContainerId(args.before);
  if (!containerId) {
    return {
      success: false,
      error: "container id missing",
      message: "Sandbox recovery cannot run because the diagnosis did not return a container id.",
      snapshot: args.before,
    };
  }

  const branchName = await resolveRegisteredBuildBranch(args.db, args.buildId);
  if (!branchName) {
    return {
      success: false,
      error: "build branch missing",
      message: "Sandbox recovery cannot checkout the registered branch because this build has no buildBranch on record.",
      snapshot: args.before,
    };
  }

  const command = wrapSandboxGitCommand([
    buildSandboxCommitInFlightWorkCommand(),
    buildSandboxBranchSwitchPrepCommand(),
    buildSandboxGitCleanCommand(),
    `git -C /workspace checkout ${shellQuote(branchName)}`,
    // Next dev rewrites this tracked generated shim on boot; hide it from
    // readiness checks without changing source.
    `git -C /workspace update-index --skip-worktree apps/web/next-env.d.ts 2>/dev/null || true`,
  ].join(" && "));

  await args.runCommand("docker", ["exec", containerId, "sh", "-lc", command]);
  await recordRecoveryActivity(
    args,
    args.db,
    `sandbox_recovery: checkout_registered_branch ${branchName}`,
  );
  return successWithSnapshot(args.buildId, "Registered build branch checked out.", args.diagnose);
}

async function runContainerAction(args: {
  buildId: string;
  before: SandboxReadinessSnapshot;
  diagnose: (buildId: string) => Promise<SandboxReadinessSnapshot>;
  runCommand: (command: string, args: string[]) => Promise<string>;
  commandArgs: string[];
  message: string;
  record: (summary: string) => Promise<void>;
}): Promise<SandboxRecoveryResult> {
  const containerId = args.commandArgs[1];
  if (!containerId) {
    return {
      success: false,
      error: "container id missing",
      message: "Sandbox recovery cannot run because the diagnosis did not return a container id.",
      snapshot: args.before,
    };
  }

  await args.runCommand("docker", args.commandArgs);
  await args.record(`sandbox_recovery: docker ${args.commandArgs[0]} ${containerId}`);
  return successWithSnapshot(args.buildId, args.message, args.diagnose);
}

async function releaseStaleSlot(args: RecoverSandboxArgs & {
  db: SandboxRecoveryDb;
  diagnose: (buildId: string) => Promise<SandboxReadinessSnapshot>;
  now: Date;
  before: SandboxReadinessSnapshot;
}): Promise<SandboxRecoveryResult> {
  if (!args.confirmation?.discardSandboxChanges || !hasReason(args.confirmation)) {
    return {
      success: false,
      error: "confirmation required",
      message: "release_stale_slot requires confirmation with discardSandboxChanges=true and a reason.",
      snapshot: args.before,
    };
  }

  const latestActivity = await args.db.buildActivity?.findFirst?.({
    where: { buildId: args.buildId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latestActivity && args.now.getTime() - new Date(latestActivity.createdAt).getTime() < STALE_SLOT_IDLE_FLOOR_MS) {
    return {
      success: false,
      error: "slot is held by paused-but-not-abandoned build",
      message: "Sandbox slot release is blocked because this build has activity within the last 7 days.",
      snapshot: args.before,
    };
  }

  await releaseSlotForBuild(args.db, args.buildId, args.now);
  await args.db.featureBuild?.update({
    where: { buildId: args.buildId },
    data: { sandboxId: null, sandboxPort: null },
  });
  await recordRecoveryActivity(args, args.db, `sandbox_recovery: release_stale_slot - ${args.confirmation.reason}`);
  return successWithSnapshot(args.buildId, "Stale sandbox slot released.", args.diagnose);
}

async function resetBuildPhase(args: RecoverSandboxArgs & {
  db: SandboxRecoveryDb;
  diagnose: (buildId: string) => Promise<SandboxReadinessSnapshot>;
  now: Date;
  before: SandboxReadinessSnapshot;
}): Promise<SandboxRecoveryResult> {
  if (!args.confirmation?.acknowledgeReset || !hasReason(args.confirmation)) {
    return {
      success: false,
      error: "confirmation required",
      message: "reset_build_phase requires acknowledgement and a reason.",
      snapshot: args.before,
    };
  }

  await args.db.buildPhaseRun?.updateMany({
    where: { buildId: args.buildId, completedAt: null },
    data: { completedAt: args.now },
  });
  await releaseSlotForBuild(args.db, args.buildId, args.now);
  await quarantineRuntimeTarget(args.db, args.before, args.now);
  await recordRecoveryActivity(
    args,
    args.db,
    `sandbox_recovery:reset_build_phase operator_reset_after_stall - ${args.confirmation.reason}`,
  );

  return successWithSnapshot(args.buildId, "Build phase reset recorded; no phase was auto-dispatched.", args.diagnose);
}

async function releaseSlotForBuild(db: SandboxRecoveryDb, buildId: string, now: Date): Promise<void> {
  await db.sandboxSlot?.updateMany({
    where: { buildId },
    data: {
      status: "available",
      buildId: null,
      userId: null,
      releasedAt: now,
    },
  });
}

async function quarantineRuntimeTarget(
  db: SandboxRecoveryDb,
  snapshot: SandboxReadinessSnapshot,
  now: Date,
): Promise<void> {
  if (!snapshot.runtimeTargetId) return;
  await db.runtimeTarget?.updateMany({
    where: { id: snapshot.runtimeTargetId },
    data: {
      status: "quarantined",
      debugReason: `sandbox_readiness:${snapshot.state}`,
      lastHeartbeatAt: now,
    },
  });
}

async function successWithSnapshot(
  buildId: string,
  message: string,
  diagnose: (buildId: string) => Promise<SandboxReadinessSnapshot>,
): Promise<SandboxRecoveryResult> {
  const snapshot = await diagnose(buildId);
  return {
    success: true,
    message,
    snapshot,
  };
}

async function recordRecoveryActivity(
  args: RecoverSandboxArgs,
  db: SandboxRecoveryDb,
  summary: string,
): Promise<void> {
  if (args.recordActivity) {
    await args.recordActivity(args.buildId, summary);
    return;
  }

  await db.buildActivity?.create({
    data: {
      buildId: args.buildId,
      tool: `sandbox_recovery:${args.action}`,
      summary,
    },
  });
}

function requireContainerId(snapshot: SandboxReadinessSnapshot): string {
  return snapshot.containerId ?? "";
}

async function resolveRegisteredBuildBranch(db: SandboxRecoveryDb, buildId: string): Promise<string | null> {
  const build = await db.featureBuild?.findUnique?.({
    where: { buildId },
    select: { buildBranch: true },
  });
  const branchName = build?.buildBranch?.trim();
  return branchName || null;
}

function hasReason(confirmation: NonNullable<SandboxRecoveryConfirmation>): boolean {
  return typeof confirmation.reason === "string" && confirmation.reason.trim().length > 0;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function runCommandDefault(command: string, args: string[]): Promise<string> {
  const { execFile } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const execFileAsync = promisify(execFile);
  const result = await execFileAsync(command, args, {
    encoding: "utf-8",
    timeout: 30_000,
  }) as { stdout: string };
  return result.stdout;
}
