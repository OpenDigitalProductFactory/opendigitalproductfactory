import { prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tools";
import {
  WORK_CAPSULE_ACTIVITY_KINDS,
  WORK_CAPSULE_BRANCH_TAXONOMIES,
  WORK_CAPSULE_EVIDENCE_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
  isWorkCapsuleBranchTaxonomy,
  isWorkCapsuleEvidenceKind,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
  type ScopeClaim,
  type WorkCapsuleEvidenceKind,
} from "@/lib/work-capsules";

import {
  adoptWorktreeCapsule,
  claimWorkCapsuleScope,
  createWorkCapsule,
  heartbeatWorkCapsule,
  planCapsuleWorkspace,
  releaseWorkCapsuleScope,
  recordWorkCapsuleEvidence,
  updateWorkCapsuleStatus,
  type CapsuleDb,
} from "./work-capsule-store";
import { listLocalBranches } from "./git-scanner";

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
    taxonomies: [...WORK_CAPSULE_BRANCH_TAXONOMIES],
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

const SCOPE_KINDS = new Set<ScopeClaim["kind"]>(["path", "module", "package", "route", "skill", "prompt"]);
const SCOPE_INTENTS = new Set<ScopeClaim["intent"]>(["edit", "read"]);

function parseClaimInputs(params: Record<string, unknown>): Array<Pick<ScopeClaim, "kind" | "value" | "intent">> | null {
  const claims = params.claims;
  if (!Array.isArray(claims)) return null;

  const parsed: Array<Pick<ScopeClaim, "kind" | "value" | "intent">> = [];
  for (const claim of claims) {
    if (!claim || typeof claim !== "object") return null;
    const candidate = claim as Record<string, unknown>;
    const kind = typeof candidate.kind === "string" ? candidate.kind : "";
    const value = typeof candidate.value === "string" ? candidate.value.trim() : "";
    const intent = typeof candidate.intent === "string" ? candidate.intent : "";
    if (!SCOPE_KINDS.has(kind as ScopeClaim["kind"]) || !SCOPE_INTENTS.has(intent as ScopeClaim["intent"]) || !value) {
      return null;
    }
    parsed.push({ kind: kind as ScopeClaim["kind"], value, intent: intent as ScopeClaim["intent"] });
  }

  return parsed.length > 0 ? parsed : null;
}

function parseReleaseInputs(params: Record<string, unknown>): Array<Pick<ScopeClaim, "kind" | "value">> | null {
  const claims = params.claims;
  if (!Array.isArray(claims)) return null;

  const parsed: Array<Pick<ScopeClaim, "kind" | "value">> = [];
  for (const claim of claims) {
    if (!claim || typeof claim !== "object") return null;
    const candidate = claim as Record<string, unknown>;
    const kind = typeof candidate.kind === "string" ? candidate.kind : "";
    const value = typeof candidate.value === "string" ? candidate.value.trim() : "";
    if (!SCOPE_KINDS.has(kind as ScopeClaim["kind"]) || !value) return null;
    parsed.push({ kind: kind as ScopeClaim["kind"], value });
  }

  return parsed.length > 0 ? parsed : null;
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

export async function adoptWorktreeTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const title = stringParam(params, "title");
  const objective = stringParam(params, "objective");
  const repositoryFullName = stringParam(params, "repositoryFullName");
  const headBranch = stringParam(params, "headBranch");
  const worktreePath = stringParam(params, "worktreePath");
  const executorKind = stringParam(params, "executorKind");

  if (!title || !objective || !repositoryFullName || !headBranch || !worktreePath) {
    return {
      success: false,
      error: "invalid_input",
      message: "title, objective, repositoryFullName, headBranch, and worktreePath are required.",
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

  const capsule = await adoptWorktreeCapsule({
    db: workCapsuleDb(),
    input: {
      title,
      objective,
      repositoryFullName,
      headBranch,
      worktreePath,
      baseBranch: stringParam(params, "baseBranch") ?? null,
      baseSha: stringParam(params, "baseSha") ?? null,
      headSha: stringParam(params, "headSha") ?? null,
      executorKind: validatedExecutorKind,
    },
    actor: await actor(userId, context),
  });

  return {
    success: true,
    entityId: capsule.capsuleId,
    message: `Adopted ${headBranch} as Work Capsule ${capsule.capsuleId}.`,
    data: { capsule },
  };
}

export async function claimCapsuleScopeTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const claims = parseClaimInputs(params);
  if (!capsuleId || !claims) {
    return {
      success: false,
      error: "invalid_input",
      message: "capsuleId and at least one valid scope claim are required.",
    };
  }

  const capsule = await claimWorkCapsuleScope({
    db: workCapsuleDb(),
    capsuleId,
    claims,
    actor: await actor(userId, context),
  });

  return {
    success: true,
    entityId: capsule.capsuleId,
    message: `Claimed ${claims.length} scope item(s) for ${capsule.capsuleId}.`,
    data: { capsule },
  };
}

export async function updateWorkCapsuleStatusTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const status = stringParam(params, "status");
  const reason = stringParam(params, "reason");
  if (!capsuleId || !status || !isWorkCapsuleStatus(status) || !reason) {
    return {
      success: false,
      error: "invalid_input",
      message: `capsuleId, reason, and valid status are required. status must be one of: ${WORK_CAPSULE_STATUSES.join(", ")}.`,
    };
  }

  const capsule = await updateWorkCapsuleStatus({
    db: workCapsuleDb(),
    capsuleId,
    status,
    reason,
    actor: await actor(userId, context),
  });

  return {
    success: true,
    entityId: capsule.capsuleId,
    message: `Updated ${capsule.capsuleId} status to ${status}.`,
    data: { capsule },
  };
}

export async function releaseCapsuleScopeTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const claims = parseReleaseInputs(params);
  if (!capsuleId || !claims) {
    return {
      success: false,
      error: "invalid_input",
      message: "capsuleId and at least one valid scope claim release are required.",
    };
  }

  const capsule = await releaseWorkCapsuleScope({
    db: workCapsuleDb(),
    capsuleId,
    claims,
    actor: await actor(userId, context),
  });

  return {
    success: true,
    entityId: capsule.capsuleId,
    message: `Released ${claims.length} scope item(s) for ${capsule.capsuleId}.`,
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

export async function planCapsuleWorktreeTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const taxonomy = stringParam(params, "taxonomy");
  if (!capsuleId) {
    return { success: false, error: "missing_capsuleId", message: "capsuleId is required." };
  }
  if (!taxonomy || !isWorkCapsuleBranchTaxonomy(taxonomy)) {
    return {
      success: false,
      error: "invalid_taxonomy",
      message: `taxonomy must be one of: ${WORK_CAPSULE_BRANCH_TAXONOMIES.join(", ")}.`,
    };
  }

  let existingBranches = new Set<string>();
  try {
    const repoRoot = process.env.DPF_REPO_ROOT?.trim() || process.cwd();
    existingBranches = await listLocalBranches(repoRoot);
  } catch {
    // Best-effort collision signal only. DB collision checks still run below.
  }

  try {
    const capsule = await planCapsuleWorkspace({
      db: workCapsuleDb(),
      capsuleId,
      taxonomy,
      os: process.platform,
      home: process.env.HOME ?? process.env.USERPROFILE,
      existingBranches,
      releaseOverride: process.env.DPF_RELEASE_WORKTREE_PATH,
      actor: await actor(userId, context),
    });
    return {
      success: true,
      entityId: capsule.capsuleId,
      message: `Planned ${capsule.headBranch} at ${capsule.worktreePath}.`,
      data: { capsule },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    if (/root clone/i.test(message)) {
      return { success: false, error: "root_clone_refused", message };
    }
    if (/branch name/i.test(message)) {
      return { success: false, error: "branch_allocation_failed", message };
    }
    throw error;
  }
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
