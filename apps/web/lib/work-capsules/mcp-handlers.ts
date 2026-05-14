import { prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tools";
import {
  WORK_CAPSULE_ACTIVITY_KINDS,
  WORK_CAPSULE_EVIDENCE_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
  isWorkCapsuleEvidenceKind,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
  type WorkCapsuleEvidenceKind,
} from "@/lib/work-capsules";

import {
  createWorkCapsule,
  heartbeatWorkCapsule,
  recordWorkCapsuleEvidence,
  type CapsuleDb,
} from "./work-capsule-store";

type ToolContext = {
  routeContext?: string;
  agentId?: string;
  threadId?: string;
  taskRunId?: string;
} | undefined;

export function workCapsuleToolEnums() {
  return {
    statuses: [...WORK_CAPSULE_STATUSES],
    sources: [...WORK_CAPSULE_SOURCES],
    executors: [...WORK_CAPSULE_EXECUTOR_KINDS],
    activityKinds: [...WORK_CAPSULE_ACTIVITY_KINDS],
    evidenceKinds: [...WORK_CAPSULE_EVIDENCE_KINDS],
  };
}

async function actor(userId: string, context: ToolContext) {
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

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberParam(params: Record<string, unknown>, key: string): number | null {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function workCapsuleDb(): CapsuleDb {
  return prisma as unknown as CapsuleDb;
}

export async function listWorkCapsulesTool(params: Record<string, unknown>): Promise<ToolResult> {
  const status = stringParam(params, "status");
  if (status && !isWorkCapsuleStatus(status)) {
    return {
      success: false,
      error: "invalid_status",
      message: `status must be one of: ${WORK_CAPSULE_STATUSES.join(", ")}.`,
    };
  }

  const limit = numberParam(params, "limit");
  const capsules = await prisma.workCapsule.findMany({
    where: status ? { status } : {},
    orderBy: { updatedAt: "desc" },
    take: limit === null ? 50 : Math.min(Math.max(Math.trunc(limit), 1), 100),
    select: {
      capsuleId: true,
      title: true,
      status: true,
      source: true,
      executorKind: true,
      headBranch: true,
      worktreePath: true,
      pullRequestUrl: true,
      leaseExpiresAt: true,
      lastSyncedAt: true,
      updatedAt: true,
    },
  });

  return {
    success: true,
    message: `Listed ${capsules.length} work capsule(s).`,
    data: { capsules },
  };
}

export async function getWorkCapsuleTool(params: Record<string, unknown>): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  if (!capsuleId) {
    return { success: false, error: "missing_capsuleId", message: "capsuleId is required." };
  }

  const capsule = await prisma.workCapsule.findUnique({
    where: { capsuleId },
    include: {
      activities: {
        orderBy: { recordedAt: "desc" },
        take: 25,
      },
    },
  });

  if (!capsule) {
    return {
      success: false,
      error: "not_found",
      message: `Work Capsule ${capsuleId} not found.`,
    };
  }

  return {
    success: true,
    entityId: capsule.capsuleId,
    message: `Loaded ${capsule.capsuleId}.`,
    data: { capsule },
  };
}

export async function createWorkCapsuleTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const idempotencyKey = stringParam(params, "idempotencyKey");
  const title = stringParam(params, "title");
  const objective = stringParam(params, "objective");
  const source = stringParam(params, "source");
  const executorKind = stringParam(params, "executorKind");

  if (!idempotencyKey) {
    return {
      success: false,
      error: "missing_idempotencyKey",
      message: "idempotencyKey is required.",
    };
  }
  if (!title || !objective || !source || !isWorkCapsuleSource(source)) {
    return {
      success: false,
      error: "invalid_input",
      message: `title, objective, and valid source are required. source must be one of: ${WORK_CAPSULE_SOURCES.join(", ")}.`,
    };
  }
  if (executorKind && !isWorkCapsuleExecutorKind(executorKind)) {
    return {
      success: false,
      error: "invalid_executorKind",
      message: `executorKind must be one of: ${WORK_CAPSULE_EXECUTOR_KINDS.join(", ")}.`,
    };
  }
  const validatedExecutorKind = executorKind && isWorkCapsuleExecutorKind(executorKind)
    ? executorKind
    : null;

  const capsule = await createWorkCapsule({
    db: workCapsuleDb(),
    input: {
      title,
      objective,
      source,
      idempotencyKey,
      executorKind: validatedExecutorKind,
    },
    actor: await actor(userId, context),
  });

  return {
    success: true,
    entityId: capsule.capsuleId,
    message: `Created Work Capsule ${capsule.capsuleId}.`,
    data: { capsule },
  };
}

export async function heartbeatCapsuleTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  if (!capsuleId) {
    return { success: false, error: "missing_capsuleId", message: "capsuleId is required." };
  }

  const capsule = await heartbeatWorkCapsule({
    db: workCapsuleDb(),
    capsuleId,
    actor: await actor(userId, context),
  });

  return {
    success: true,
    entityId: capsule.capsuleId,
    message: `Renewed lease for ${capsule.capsuleId}.`,
    data: { capsule },
  };
}

export async function recordCapsuleEvidenceTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const summary = stringParam(params, "summary");
  const rawKind = stringParam(params, "kind") ?? "note";

  if (!capsuleId || !summary) {
    return {
      success: false,
      error: "invalid_input",
      message: "capsuleId and summary are required.",
    };
  }
  if (!isWorkCapsuleEvidenceKind(rawKind)) {
    return {
      success: false,
      error: "invalid_kind",
      message: `kind must be one of: ${WORK_CAPSULE_EVIDENCE_KINDS.join(", ")}.`,
    };
  }

  const evidence: {
    kind: WorkCapsuleEvidenceKind;
    summary: string;
    command?: string;
    url?: string;
    result?: unknown;
  } = {
    kind: rawKind,
    summary,
  };
  const command = stringParam(params, "command");
  const url = stringParam(params, "url");
  if (command) evidence.command = command;
  if (url) evidence.url = url;
  if (Object.prototype.hasOwnProperty.call(params, "result")) evidence.result = params.result;

  await recordWorkCapsuleEvidence({
    db: workCapsuleDb(),
    capsuleId,
    evidence,
    actor: await actor(userId, context),
  });

  return {
    success: true,
    entityId: capsuleId,
    message: `Recorded evidence for ${capsuleId}.`,
  };
}
