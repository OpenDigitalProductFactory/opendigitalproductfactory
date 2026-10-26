import {
  RUNTIME_ACCEPTANCE_ROLE_OVERRIDES,
  RUNTIME_TARGET_KINDS,
  RUNTIME_TARGET_STATUSES,
  RUNTIME_VERIFICATION_KINDS,
  RUNTIME_VERIFICATION_STATUSES,
  type RuntimeAcceptanceRole,
  type RuntimeAcceptanceRoleOverride,
  type RuntimeTargetInput,
  type RuntimeTargetKind,
  type RuntimeTargetStatus,
  type RuntimeVerificationInput,
  type RuntimeVerificationKind,
  type RuntimeVerificationStatus,
  type RuntimeCoordinationActor,
} from "./types";
import { SMALL_ACCEPTANCE_KEY, createSmallAcceptanceBinding, readSmallAcceptanceBinding, sameSmallAcceptanceContext, type SmallAcceptanceContext } from "./small-acceptance-binding";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export type { RuntimeCoordinationActor } from "./types";

export type RuntimeCoordinationDb = {
  runtimeTarget: {
    create(args: unknown): Promise<any>;
    findUnique(args: unknown): Promise<any>;
    findMany?(args: unknown): Promise<any[]>;
    update(args: unknown): Promise<any>;
  };
  runtimeVerification: {
    create(args: unknown): Promise<any>;
    findUnique?(args: unknown): Promise<Record<string, unknown> | null>;
  };
  buildActivity?: {
    create(args: unknown): Promise<any>;
  };
  workroomActivity?: {
    create(args: unknown): Promise<any>;
  };
  $transaction?<T>(fn: (tx: RuntimeCoordinationDb) => Promise<T>, options?: { isolationLevel: "Serializable"; timeout: number }): Promise<T>;
};

const TARGET_KIND_SET = new Set<string>(RUNTIME_TARGET_KINDS);
const TARGET_STATUS_SET = new Set<string>(RUNTIME_TARGET_STATUSES);
const VERIFICATION_KIND_SET = new Set<string>(RUNTIME_VERIFICATION_KINDS);
const VERIFICATION_STATUS_SET = new Set<string>(RUNTIME_VERIFICATION_STATUSES);
const ACCEPTANCE_OVERRIDE_SET = new Set<string>(RUNTIME_ACCEPTANCE_ROLE_OVERRIDES);

export function isRuntimeTargetKind(value: unknown): value is RuntimeTargetKind {
  return typeof value === "string" && TARGET_KIND_SET.has(value);
}

export function isRuntimeTargetStatus(value: unknown): value is RuntimeTargetStatus {
  return typeof value === "string" && TARGET_STATUS_SET.has(value);
}

export function isRuntimeVerificationKind(value: unknown): value is RuntimeVerificationKind {
  return typeof value === "string" && VERIFICATION_KIND_SET.has(value);
}

export function isRuntimeVerificationStatus(value: unknown): value is RuntimeVerificationStatus {
  return typeof value === "string" && VERIFICATION_STATUS_SET.has(value);
}

export function deriveAcceptanceRole(kind: RuntimeTargetKind): RuntimeAcceptanceRole {
  switch (kind) {
    case "root-portal":
      return "final-acceptance";
    case "dev-portal":
    case "build-sandbox":
    case "git-promotion-sandbox":
    case "external-preview":
      return "non-prod-verification";
    case "ad-hoc-debug":
      return "debug-only";
  }
}

export function resolveAcceptanceRole(
  kind: RuntimeTargetKind,
  override?: RuntimeAcceptanceRoleOverride | null,
): RuntimeAcceptanceRole {
  return override === "debug-only" ? "debug-only" : deriveAcceptanceRole(kind);
}

export function canSatisfyFinalAcceptance(
  kind: RuntimeTargetKind,
  override?: RuntimeAcceptanceRoleOverride | null,
): boolean {
  return resolveAcceptanceRole(kind, override) === "final-acceptance";
}

async function inTransaction<T>(
  db: RuntimeCoordinationDb,
  fn: (tx: RuntimeCoordinationDb) => Promise<T>,
): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db);
}

function compactTargetData(input: RuntimeTargetInput, now: Date) {
  return {
    targetId: input.targetId,
    kind: input.kind,
    status: input.status,
    workCapsuleId: input.workCapsuleId ?? null,
    featureBuildId: input.featureBuildId ?? null,
    sandboxId: input.sandboxId ?? null,
    slotId: input.slotId ?? null,
    composeProjectName: input.composeProjectName ?? null,
    serviceName: input.serviceName ?? null,
    containerName: input.containerName ?? null,
    hostUrl: input.hostUrl ?? null,
    internalUrl: input.internalUrl ?? null,
    port: input.port ?? null,
    serviceVersion: input.serviceVersion ?? null,
    acceptanceRoleOverride: input.acceptanceRoleOverride ?? null,
    debugReason: input.debugReason ?? null,
    expiresAt: input.expiresAt ?? null,
    lastHeartbeatAt: now,
    metadata: input.metadata ?? {},
  };
}

function validateTargetInput(input: RuntimeTargetInput) {
  if (!input.targetId?.trim()) throw new Error("targetId is required");
  if (!isRuntimeTargetKind(input.kind)) throw new Error("Invalid runtime target kind");
  if (!isRuntimeTargetStatus(input.status)) throw new Error("Invalid runtime target status");
  if (
    input.acceptanceRoleOverride &&
    !ACCEPTANCE_OVERRIDE_SET.has(input.acceptanceRoleOverride)
  ) {
    throw new Error("Invalid acceptanceRoleOverride");
  }
  if (input.kind === "ad-hoc-debug" && !input.debugReason?.trim()) {
    throw new Error("debugReason is required for ad-hoc-debug runtime targets");
  }
  if (input.port != null && (!Number.isInteger(input.port) || input.port <= 0)) {
    throw new Error("port must be a positive integer");
  }
}

function verificationActivityKind(status: RuntimeVerificationStatus) {
  if (status === "failed") return "runtime-verification-failed";
  if (status === "passed") return "runtime-verification-passed";
  return null;
}

function verificationSummary(verificationId: string, status: RuntimeVerificationStatus) {
  return `Runtime verification ${verificationId} ${status}.`;
}

async function recordCapsuleActivity(args: {
  db: RuntimeCoordinationDb;
  workCapsuleId?: string | null;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  actor?: RuntimeCoordinationActor;
}) {
  if (!args.workCapsuleId || !args.db.workroomActivity) return null;
  return args.db.workroomActivity.create({
    data: {
      workCapsuleId: args.workCapsuleId,
      kind: args.kind,
      summary: args.summary,
      payload: args.payload,
      recordedById: args.actor?.userId ?? null,
      recordedByAgentId: args.actor?.agentId ?? null,
    },
  });
}

export async function registerRuntimeTarget(args: {
  db: RuntimeCoordinationDb;
  input: RuntimeTargetInput;
  actor?: RuntimeCoordinationActor;
  now?: Date;
}) {
  validateTargetInput(args.input);
  const now = args.now ?? new Date();
  const data = compactTargetData(args.input, now);

  return inTransaction(args.db, async (tx) => {
    const existing = await tx.runtimeTarget.findUnique({
      where: { targetId: args.input.targetId },
    });
    const target = existing
      ? await tx.runtimeTarget.update({
        where: { targetId: args.input.targetId },
        data,
      })
      : await tx.runtimeTarget.create({ data });
    const acceptanceRole = resolveAcceptanceRole(args.input.kind, args.input.acceptanceRoleOverride);

    await recordCapsuleActivity({
      db: tx,
      workCapsuleId: args.input.workCapsuleId ?? existing?.workCapsuleId ?? null,
      kind: "runtime-target-registered",
      summary: `Registered runtime target ${args.input.targetId}.`,
      payload: {
        targetId: args.input.targetId,
        kind: args.input.kind,
        status: args.input.status,
        acceptanceRole,
        canSatisfyFinalAcceptance: acceptanceRole === "final-acceptance",
      },
      actor: args.actor,
    });

    return target;
  });
}

export async function heartbeatRuntimeTarget(args: {
  db: RuntimeCoordinationDb;
  targetId: string;
  now?: Date;
}) {
  if (!args.targetId?.trim()) throw new Error("targetId is required");
  const now = args.now ?? new Date();
  return args.db.runtimeTarget.update({
    where: { targetId: args.targetId },
    data: { lastHeartbeatAt: now },
  });
}

export async function releaseRuntimeTarget(args: {
  db: RuntimeCoordinationDb;
  targetId: string;
  actor?: RuntimeCoordinationActor;
  now?: Date;
}) {
  if (!args.targetId?.trim()) throw new Error("targetId is required");
  const now = args.now ?? new Date();
  return inTransaction(args.db, async (tx) => {
    const target = await tx.runtimeTarget.update({
      where: { targetId: args.targetId },
      data: { status: "released", lastHeartbeatAt: now },
    });

    await recordCapsuleActivity({
      db: tx,
      workCapsuleId: target?.workCapsuleId ?? null,
      kind: "runtime-target-released",
      summary: `Released runtime target ${args.targetId}.`,
      payload: {
        targetId: args.targetId,
        status: "released",
      },
      actor: args.actor,
    });

    return target;
  });
}

export async function getRuntimeCoordinationMap(args: {
  db: RuntimeCoordinationDb;
  kind?: RuntimeTargetKind | null;
  status?: RuntimeTargetStatus | null;
  limit?: number | null;
}) {
  if (!args.db.runtimeTarget.findMany) throw new Error("runtimeTarget.findMany is required");
  if (args.kind && !isRuntimeTargetKind(args.kind)) throw new Error("Invalid runtime target kind");
  if (args.status && !isRuntimeTargetStatus(args.status)) throw new Error("Invalid runtime target status");

  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 100);
  const targets = await args.db.runtimeTarget.findMany({
    where: {
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      verifications: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      workCapsule: {
        select: {
          leaseHolderPrincipalId: true,
          createdByPrincipalId: true,
          headBranch: true,
          headSha: true,
          pullRequestUrl: true,
          pullRequestNumber: true,
        },
      },
      featureBuild: {
        select: {
          buildId: true,
          buildBranch: true,
          gitCommitHashes: true,
          createdById: true,
          claimedByAgentId: true,
        },
      },
    },
  });

  return {
    targets: targets.map((target) => {
      const override = ACCEPTANCE_OVERRIDE_SET.has(target.acceptanceRoleOverride)
        ? target.acceptanceRoleOverride as RuntimeAcceptanceRoleOverride
        : null;
      const acceptanceRole = isRuntimeTargetKind(target.kind)
        ? resolveAcceptanceRole(target.kind, override)
        : "none";

      return {
        ...target,
        ownership: resolveRuntimeTargetOwnership(target),
        acceptanceRole,
        canSatisfyFinalAcceptance: acceptanceRole === "final-acceptance",
      };
    }),
  };
}

export function resolveRuntimeTargetOwnership(target: {
  workCapsule?: {
    leaseHolderPrincipalId?: string | null;
    createdByPrincipalId?: string | null;
    headBranch?: string | null;
    headSha?: string | null;
    pullRequestUrl?: string | null;
    pullRequestNumber?: number | null;
  } | null;
  featureBuild?: {
    buildId?: string | null;
    buildBranch?: string | null;
    gitCommitHashes?: unknown;
    createdById?: string | null;
    claimedByAgentId?: string | null;
  } | null;
}) {
  const capsule = target.workCapsule ?? null;
  const build = target.featureBuild ?? null;
  const buildShas = Array.isArray(build?.gitCommitHashes)
    ? build.gitCommitHashes.filter((value): value is string => typeof value === "string")
    : [];

  return {
    ownerPrincipalId: capsule?.leaseHolderPrincipalId ?? capsule?.createdByPrincipalId ?? null,
    branch: capsule?.headBranch ?? build?.buildBranch ?? null,
    sha: capsule?.headSha ?? buildShas[0] ?? null,
    pullRequestUrl: capsule?.pullRequestUrl ?? null,
    pullRequestNumber: capsule?.pullRequestNumber ?? null,
    buildId: build?.buildId ?? null,
    ownerUserId: build?.createdById ?? null,
    ownerAgentId: build?.claimedByAgentId ?? null,
  };
}

function primaryAttachPointCount(input: RuntimeVerificationInput): number {
  const directCount = [
    input.runtimeTargetId,
    input.featureBuildId,
    input.gitPromotionCandidateId,
  ].filter((value) => typeof value === "string" && value.trim().length > 0).length;

  if (directCount > 0) return directCount;
  return input.workCapsuleId?.trim() ? 1 : 0;
}

function validateVerificationInput(input: RuntimeVerificationInput) {
  if (input.result && Object.hasOwn(input.result, SMALL_ACCEPTANCE_KEY)) throw new Error("Small acceptance result namespace is reserved to the server.");
  if (!input.verificationId?.trim()) throw new Error("verificationId is required");
  if (!isRuntimeVerificationKind(input.kind)) throw new Error("Invalid runtime verification kind");
  if (!isRuntimeVerificationStatus(input.status)) throw new Error("Invalid runtime verification status");
  if (primaryAttachPointCount(input) !== 1) {
    throw new Error("Runtime verification requires exactly one primary attach point");
  }
}

export async function recordRuntimeVerification(args: {
  db: RuntimeCoordinationDb;
  input: RuntimeVerificationInput;
  actor?: RuntimeCoordinationActor;
  smallAcceptance?: {
    load(args: { db: RuntimeCoordinationDb; workCapsuleId: string; closureId: string; lock?: boolean }): Promise<SmallAcceptanceContext>;
    refresh(db: RuntimeCoordinationDb, itemId: string): Promise<void>;
  };
}) {
  validateVerificationInput(args.input);
  const smallCheck = args.input.kind === "final-acceptance" && !!args.input.backlogActivityId;
  if (smallCheck && [args.input.runtimeTargetId, args.input.featureBuildId, args.input.gitPromotionCandidateId, args.input.buildId].some(Boolean)) {
    throw new Error("Bound Small acceptance requires a Workroom-only attach point.");
  }
  if (smallCheck && (!args.db.$transaction || !args.input.workCapsuleId
    || !["passed", "failed"].includes(args.input.status))) throw new Error("Bound Small acceptance requires a transaction, Workroom and terminal check.");
  if (smallCheck && !args.smallAcceptance) throw new Error("Authoritative Small acceptance service is unavailable.");
  let boundItemId: string | null = null;
  const record = async (tx: RuntimeCoordinationDb) => {
    let result = args.input.result ?? {};
    let bound: ReturnType<typeof createSmallAcceptanceBinding> | null = null;
    const bindingService = args.smallAcceptance;
    if (smallCheck) {
      const context = await bindingService!.load({ db: tx,
        workCapsuleId: args.input.workCapsuleId!, closureId: args.input.backlogActivityId!, lock: true });
      if (!tx.runtimeVerification.findUnique) throw new Error("Acceptance identity lookup is unavailable.");
      const existing = await tx.runtimeVerification.findUnique({ where: { verificationId: args.input.verificationId } });
      const oldResult = existing?.result && typeof existing.result === "object" ? existing.result as Record<string, unknown> : {};
      const oldBinding = readSmallAcceptanceBinding(oldResult[SMALL_ACCEPTANCE_KEY]);
      if (existing && !oldBinding) throw new Error("Verification identity already records a different immutable check.");
      // Exact recovery compares the original recording time. Only a new check
      // owes freshness now; this never renews its deployment or closure binding.
      bound = createSmallAcceptanceBinding({ context, input: args.input, actor: args.actor ?? {},
        now: oldBinding ? new Date(oldBinding.recordedAt) : new Date() });
      boundItemId = context.itemId;
      result = { ...result, [SMALL_ACCEPTANCE_KEY]: bound };
      if (existing) {
        const dateValue = (value: unknown) => value instanceof Date ? value.toISOString() : value ?? null;
        if (existing.kind !== args.input.kind || existing.status !== args.input.status
          || existing.workCapsuleId !== args.input.workCapsuleId || existing.backlogActivityId !== args.input.backlogActivityId
          || ["command", "url", "evidenceUrl", "screenshotUrl", "toolExecutionId", "runtimeTargetId", "featureBuildId",
            "gitPromotionCandidateId", "buildActivityId", "capsuleActivityId"].some(key =>
            existing[key] !== (args.input[key as keyof RuntimeVerificationInput] ?? null))
          || dateValue(existing.startedAt) !== dateValue(args.input.startedAt)
          || dateValue(existing.completedAt) !== dateValue(args.input.completedAt)
          || canonicalJson(oldResult) !== canonicalJson(result)) {
          throw new Error("Verification identity already records a different immutable check.");
        }
        return existing;
      }
    }
    let buildActivityId = args.input.buildActivityId ?? null;
    if (!buildActivityId && args.input.buildId && tx.buildActivity) {
      const activity = await tx.buildActivity.create({
        data: {
          buildId: args.input.buildId,
          tool: `runtime_verification:${args.input.kind}`,
          summary: verificationSummary(args.input.verificationId, args.input.status),
        },
      });
      buildActivityId = activity?.id ?? null;
    }

    const verification = await tx.runtimeVerification.create({
      data: {
        verificationId: args.input.verificationId,
        kind: args.input.kind,
        status: args.input.status,
        runtimeTargetId: args.input.runtimeTargetId ?? null,
        workCapsuleId: args.input.workCapsuleId ?? null,
        featureBuildId: args.input.featureBuildId ?? null,
        gitPromotionCandidateId: args.input.gitPromotionCandidateId ?? null,
        command: args.input.command ?? null,
        url: args.input.url ?? null,
        evidenceUrl: args.input.evidenceUrl ?? null,
        screenshotUrl: args.input.screenshotUrl ?? null,
        toolExecutionId: args.input.toolExecutionId ?? null,
        buildActivityId,
        backlogActivityId: args.input.backlogActivityId ?? null,
        capsuleActivityId: args.input.capsuleActivityId ?? null,
        startedAt: args.input.startedAt ?? null,
        completedAt: args.input.completedAt ?? null,
        result,
        ...(bound ? { createdAt: new Date(bound.recordedAt) } : {}),
      },
    });

    const activityKind = verificationActivityKind(args.input.status);
    if (activityKind) {
      await recordCapsuleActivity({
        db: tx,
        workCapsuleId: args.input.workCapsuleId,
        kind: activityKind,
        summary: verificationSummary(args.input.verificationId, args.input.status),
        payload: {
          verificationId: args.input.verificationId,
          kind: args.input.kind,
          status: args.input.status,
          runtimeTargetId: args.input.runtimeTargetId ?? null,
          buildActivityId,
          evidenceUrl: args.input.evidenceUrl ?? null,
          screenshotUrl: args.input.screenshotUrl ?? null,
        },
        actor: args.actor,
      });
    }

    if (bound && bindingService) {
      const current = await bindingService.load({ db: tx,
        workCapsuleId: args.input.workCapsuleId!, closureId: args.input.backlogActivityId! });
      if (!sameSmallAcceptanceContext(bound, current)) throw new Error("Deployment changed during runtime acceptance.");
    }
    return verification;
  };
  const verification = await (smallCheck ? args.db.$transaction!(record, { isolationLevel: "Serializable", timeout: 30_000 }) : inTransaction(args.db, record));
  if (boundItemId) {
    // An interrupted projection leaves the immutable verification intact; same-id retry refreshes it.
    await args.smallAcceptance!.refresh(args.db, boundItemId);
  }
  return verification;
}

export { RUNTIME_TARGET_KINDS, RUNTIME_TARGET_STATUSES, RUNTIME_VERIFICATION_KINDS, RUNTIME_VERIFICATION_STATUSES };
