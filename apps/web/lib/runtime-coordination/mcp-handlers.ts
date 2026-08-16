import { prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tools";
import {
  RUNTIME_TARGET_KINDS,
  RUNTIME_TARGET_STATUSES,
  RUNTIME_VERIFICATION_KINDS,
  RUNTIME_VERIFICATION_STATUSES,
  resolveAcceptanceRole,
  isRuntimeTargetKind,
  isRuntimeTargetStatus,
  isRuntimeVerificationKind,
  isRuntimeVerificationStatus,
  getRuntimeCoordinationMap,
  heartbeatRuntimeTarget,
  releaseRuntimeTarget,
  recordRuntimeVerification,
  registerRuntimeTarget,
  type RuntimeCoordinationActor,
  type RuntimeCoordinationDb,
} from "./runtime-targets";
import type { RuntimeTargetInput, RuntimeTargetKind, RuntimeTargetStatus, RuntimeVerificationInput } from "./types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

type ToolContext = {
  routeContext?: string;
  agentId?: string;
  threadId?: string;
  taskRunId?: string;
} | undefined;

export function runtimeCoordinationToolEnums() {
  return {
    targetKinds: [...RUNTIME_TARGET_KINDS],
    targetStatuses: [...RUNTIME_TARGET_STATUSES],
    verificationKinds: [...RUNTIME_VERIFICATION_KINDS],
    verificationStatuses: [...RUNTIME_VERIFICATION_STATUSES],
  };
}

function runtimeDb(): RuntimeCoordinationDb {
  return prisma as unknown as RuntimeCoordinationDb;
}

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberParam(params: Record<string, unknown>, key: string): number | null {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateParam(params: Record<string, unknown>, key: string): Date | null {
  const value = stringParam(params, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function objectParam(params: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = params[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function resolveWorkCapsuleRowId(params: Record<string, unknown>): Promise<string | null> {
  const internalId = stringParam(params, "workCapsuleId");
  if (internalId) return internalId;

  const capsuleId = stringParam(params, "capsuleId");
  if (!capsuleId) return null;

  const capsule = await prisma.workroom.findUnique({
    where: { capsuleId },
    select: { id: true },
  });
  if (!capsule) throw new Error(`Work Capsule ${capsuleId} not found.`);
  return capsule.id;
}

async function resolveFeatureBuildRowId(params: Record<string, unknown>): Promise<string | null> {
  const internalId = stringParam(params, "featureBuildId");
  if (internalId) return internalId;

  const buildId = stringParam(params, "buildId");
  if (!buildId) return null;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { id: true },
  });
  if (!build) throw new Error(`FeatureBuild ${buildId} not found.`);
  return build.id;
}

async function resolveRuntimeTargetRowId(params: Record<string, unknown>): Promise<string | null> {
  const internalId = stringParam(params, "runtimeTargetId");
  if (internalId && !internalId.startsWith("RT-")) return internalId;

  const targetId = stringParam(params, "targetId") ?? internalId;
  if (!targetId) return null;

  const target = await prisma.runtimeTarget.findUnique({
    where: { targetId },
    select: { id: true },
  });
  if (!target) throw new Error(`RuntimeTarget ${targetId} not found.`);
  return target.id;
}

async function resolveGitPromotionCandidateRowId(params: Record<string, unknown>): Promise<string | null> {
  const internalId = stringParam(params, "gitPromotionCandidateId");
  if (internalId) return internalId;

  const candidateId = stringParam(params, "candidateId");
  if (!candidateId) return null;

  const candidate = await prisma.gitPromotionCandidate.findUnique({
    where: { candidateId },
    select: { id: true },
  });
  if (!candidate) throw new Error(`GitPromotionCandidate ${candidateId} not found.`);
  return candidate.id;
}

async function actor(userId: string, context: ToolContext): Promise<RuntimeCoordinationActor> {
  const { ensureAgentPrincipalIdentity, syncUserPrincipal } = await import("@/lib/identity/principal-linking");
  const agentId = context?.agentId ?? null;
  let principalId: string | null = null;

  try {
    if (agentId) {
      const synced = await ensureAgentPrincipalIdentity(agentId);
      principalId = synced?.id ?? null;
    } else {
      const synced = await syncUserPrincipal(userId);
      principalId = synced?.id ?? null;
    }
  } catch {
    principalId = null;
  }

  return { userId, agentId, principalId };
}

export async function registerRuntimeTargetTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const targetId = stringParam(params, "targetId");
  const kind = stringParam(params, "kind");
  const status = stringParam(params, "status") ?? "assigned";

  if (!targetId || !kind || !isRuntimeTargetKind(kind) || !isRuntimeTargetStatus(status)) {
    return {
      success: false,
      error: "invalid_input",
      message: `targetId, valid kind, and valid status are required. kind must be one of: ${RUNTIME_TARGET_KINDS.join(", ")}; status must be one of: ${RUNTIME_TARGET_STATUSES.join(", ")}.`,
    };
  }

  try {
    const input: RuntimeTargetInput = {
      targetId,
      kind,
      status,
      workCapsuleId: await resolveWorkCapsuleRowId(params),
      featureBuildId: await resolveFeatureBuildRowId(params),
      sandboxId: stringParam(params, "sandboxId"),
      slotId: stringParam(params, "slotId"),
      composeProjectName: stringParam(params, "composeProjectName"),
      serviceName: stringParam(params, "serviceName"),
      containerName: stringParam(params, "containerName"),
      hostUrl: stringParam(params, "hostUrl"),
      internalUrl: stringParam(params, "internalUrl"),
      port: numberParam(params, "port"),
      serviceVersion: stringParam(params, "serviceVersion"),
      acceptanceRoleOverride: stringParam(params, "acceptanceRoleOverride") as RuntimeTargetInput["acceptanceRoleOverride"],
      debugReason: stringParam(params, "debugReason"),
      expiresAt: dateParam(params, "expiresAt"),
      metadata: objectParam(params, "metadata"),
    };
    const target = await registerRuntimeTarget({
      db: runtimeDb(),
      input,
      actor: await actor(userId, context),
    });
    const acceptanceRole = resolveAcceptanceRole(kind, input.acceptanceRoleOverride);
    return {
      success: true,
      entityId: target.targetId,
      message: `Registered runtime target ${target.targetId}.`,
      data: {
        target,
        acceptanceRole,
        canSatisfyFinalAcceptance: acceptanceRole === "final-acceptance",
      },
    };
  } catch (error) {
    return {
      success: false,
      error: "invalid_input",
      message: getErrorMessage(error),
    };
  }
}

export async function heartbeatRuntimeTargetTool(params: Record<string, unknown>): Promise<ToolResult> {
  const targetId = stringParam(params, "targetId");
  if (!targetId) return { success: false, error: "missing_targetId", message: "targetId is required." };

  try {
    const target = await heartbeatRuntimeTarget({
      db: runtimeDb(),
      targetId,
    });

    return {
      success: true,
      entityId: target.targetId,
      message: `Heartbeat recorded for runtime target ${target.targetId}.`,
      data: { target },
    };
  } catch (error) {
    return {
      success: false,
      error: "invalid_input",
      message: getErrorMessage(error),
    };
  }
}

export async function releaseRuntimeTargetTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const targetId = stringParam(params, "targetId");
  if (!targetId) return { success: false, error: "missing_targetId", message: "targetId is required." };

  try {
    const target = await releaseRuntimeTarget({
      db: runtimeDb(),
      targetId,
      actor: await actor(userId, context),
    });

    return {
      success: true,
      entityId: target.targetId,
      message: `Released runtime target ${target.targetId}.`,
      data: { target },
    };
  } catch (error) {
    return {
      success: false,
      error: "invalid_input",
      message: getErrorMessage(error),
    };
  }
}

export async function recordRuntimeVerificationTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const verificationId = stringParam(params, "verificationId");
  const kind = stringParam(params, "kind");
  const status = stringParam(params, "status");

  if (!verificationId || !kind || !status || !isRuntimeVerificationKind(kind) || !isRuntimeVerificationStatus(status)) {
    return {
      success: false,
      error: "invalid_input",
      message: `verificationId, valid kind, and valid status are required. kind must be one of: ${RUNTIME_VERIFICATION_KINDS.join(", ")}; status must be one of: ${RUNTIME_VERIFICATION_STATUSES.join(", ")}.`,
    };
  }

  try {
    const runtimeTargetId = await resolveRuntimeTargetRowId(params);
    const buildId = stringParam(params, "buildId");
    const input: RuntimeVerificationInput = {
      verificationId,
      kind,
      status,
      runtimeTargetId,
      workCapsuleId: await resolveWorkCapsuleRowId(params),
      featureBuildId: runtimeTargetId && buildId && !stringParam(params, "featureBuildId")
        ? null
        : await resolveFeatureBuildRowId(params),
      buildId,
      gitPromotionCandidateId: await resolveGitPromotionCandidateRowId(params),
      command: stringParam(params, "command"),
      url: stringParam(params, "url"),
      evidenceUrl: stringParam(params, "evidenceUrl"),
      screenshotUrl: stringParam(params, "screenshotUrl"),
      toolExecutionId: stringParam(params, "toolExecutionId"),
      buildActivityId: stringParam(params, "buildActivityId"),
      backlogActivityId: stringParam(params, "backlogActivityId"),
      capsuleActivityId: stringParam(params, "capsuleActivityId"),
      startedAt: dateParam(params, "startedAt"),
      completedAt: dateParam(params, "completedAt"),
      result: objectParam(params, "result"),
    };
    const verification = await recordRuntimeVerification({
      db: runtimeDb(),
      input,
      actor: await actor(userId, context),
    });
    return {
      success: true,
      entityId: verification.verificationId,
      message: `Recorded runtime verification ${verification.verificationId}.`,
      data: { verification },
    };
  } catch (error) {
    return {
      success: false,
      error: "invalid_input",
      message: getErrorMessage(error),
    };
  }
}

export async function getRuntimeCoordinationMapTool(params: Record<string, unknown>): Promise<ToolResult> {
  const status = stringParam(params, "status");
  const kind = stringParam(params, "kind");
  const limit = Math.min(Math.max(Math.trunc(numberParam(params, "limit") ?? 50), 1), 100);

  if (status && !isRuntimeTargetStatus(status)) {
    return { success: false, error: "invalid_status", message: `status must be one of: ${RUNTIME_TARGET_STATUSES.join(", ")}.` };
  }
  if (kind && !isRuntimeTargetKind(kind)) {
    return { success: false, error: "invalid_kind", message: `kind must be one of: ${RUNTIME_TARGET_KINDS.join(", ")}.` };
  }

  const { targets } = await getRuntimeCoordinationMap({
    db: runtimeDb(),
    kind: kind as RuntimeTargetKind | null,
    status: status as RuntimeTargetStatus | null,
    limit,
  });

  return {
    success: true,
    message: `Listed ${targets.length} runtime target(s).`,
    data: { targets },
  };
}
