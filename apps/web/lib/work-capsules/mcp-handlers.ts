import { prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tools";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  WORK_CAPSULE_ACTIVITY_KINDS,
  WORK_CAPSULE_BRANCH_TAXONOMIES,
  WORK_CAPSULE_DECISION_SCOPES,
  WORK_CAPSULE_EVIDENCE_KINDS,
  AGENT_ACTIVITY_KINDS,
  isAgentActivityKind,
  type AgentActivityKind,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_OUTCOME_ANCHOR_KINDS,
  WORK_CAPSULE_PORTFOLIO_ROLES,
  WORK_CAPSULE_SCOPE_ACTIVITY_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
  isWorkCapsuleBranchTaxonomy,
  isWorkCapsuleDecisionScope,
  isWorkCapsuleEvidenceKind,
  isWorkCapsuleExecutorKind,
  isWorkCapsulePortfolioRole,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
  normalizeWorkCapsuleScopeInput,
  type ScopeClaim,
  type WorkCapsuleEvidenceKind,
  type WorkCapsuleScopeInput,
} from "@/lib/work-capsules";

import {
  adoptWorktreeCapsule,
  claimBacklogItemWorkspace,
  claimWorkCapsuleScope,
  createWorkCapsule,
  heartbeatWorkCapsule,
  reassignWorkCapsuleExecutor,
  planCapsuleWorkspace,
  releaseWorkCapsuleScope,
  recordWorkCapsuleEvidence,
  recordAgentActivity,
  updateWorkCapsuleStatus,
  ScopeOverlapError,
  type CapsuleDb,
  type WorkCapsuleActor,
} from "./work-capsule-store";
import { listLocalBranches } from "./git-scanner";
import { providerToExecutorKind, ensureExternalSessionCapsule } from "./external-session-capture";

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
    decisionScopes: [...WORK_CAPSULE_DECISION_SCOPES],
    portfolioRoles: [...WORK_CAPSULE_PORTFOLIO_ROLES],
    scopeActivityKinds: [...WORK_CAPSULE_SCOPE_ACTIVITY_KINDS],
    outcomeAnchorKinds: [...WORK_CAPSULE_OUTCOME_ANCHOR_KINDS],
    agentActivityKinds: [...AGENT_ACTIVITY_KINDS],
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

function parseScopeInput(params: Record<string, unknown>): WorkCapsuleScopeInput {
  return {
    decisionScope: params.decisionScope,
    portfolioRole: params.portfolioRole,
    servedPersona: params.servedPersona,
    activityKind: params.activityKind,
    outcomeAnchor: params.outcomeAnchor,
    servesPortfolioRoles: params.servesPortfolioRoles,
    dependsOnPortfolioRoles: params.dependsOnPortfolioRoles,
  };
}

function invalidScopeResult(error: unknown): ToolResult {
  return {
    success: false,
    error: "invalid_scope",
    message: error instanceof Error ? error.message : "Invalid Work Capsule scope metadata.",
  };
}

function workCapsuleDb(): CapsuleDb {
  return prisma as unknown as CapsuleDb;
}

async function renewLeaseAfterCapsuleWrite(capsuleId: string, currentActor: WorkCapsuleActor) {
  return heartbeatWorkCapsule({
    db: workCapsuleDb(),
    capsuleId,
    actor: currentActor,
  });
}

async function runAutoRenewedCapsuleWrite(args: {
  capsuleId: string;
  userId: string;
  context: ToolContext;
  write: (currentActor: WorkCapsuleActor) => Promise<unknown>;
}) {
  const currentActor = await actor(args.userId, args.context);
  await args.write(currentActor);
  return renewLeaseAfterCapsuleWrite(args.capsuleId, currentActor);
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
  const decisionScope = stringParam(params, "decisionScope");
  const portfolioRole = stringParam(params, "portfolioRole");
  if (status && !isWorkCapsuleStatus(status)) {
    return {
      success: false,
      error: "invalid_status",
      message: `status must be one of: ${WORK_CAPSULE_STATUSES.join(", ")}.`,
    };
  }
  if (decisionScope && !isWorkCapsuleDecisionScope(decisionScope)) {
    return {
      success: false,
      error: "invalid_decisionScope",
      message: `decisionScope must be one of: ${WORK_CAPSULE_DECISION_SCOPES.join(", ")}.`,
    };
  }
  if (portfolioRole && !isWorkCapsulePortfolioRole(portfolioRole)) {
    return {
      success: false,
      error: "invalid_portfolioRole",
      message: `portfolioRole must be one of: ${WORK_CAPSULE_PORTFOLIO_ROLES.join(", ")}.`,
    };
  }

  const limit = numberParam(params, "limit");
  // WS9 (BI-CBAAEA94): `staleOnly` returns only capsules that are NOT truly live
  // — the reap-candidate lens a sprawl triage needs. Defaults to false so the
  // tool stays a full inventory.
  const staleOnly = params["staleOnly"] === true;
  const where = {
    ...(status ? { status } : {}),
    ...(decisionScope ? { decisionScope } : {}),
    ...(portfolioRole ? { portfolioRole } : {}),
  };
  const rows = await prisma.workCapsule.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit === null ? 50 : Math.min(Math.max(Math.trunc(limit), 1), 100),
    select: {
      capsuleId: true,
      title: true,
      status: true,
      source: true,
      executorKind: true,
      decisionScope: true,
      portfolioRole: true,
      servedPersona: true,
      activityKind: true,
      outcomeAnchor: true,
      servesPortfolioRoles: true,
      dependsOnPortfolioRoles: true,
      headBranch: true,
      worktreePath: true,
      pullRequestUrl: true,
      pullRequestNumber: true,
      leaseExpiresAt: true,
      lastSyncedAt: true,
      updatedAt: true,
      featureBuildId: true,
    },
  });

  // Join the linked Build Studio build so a null-lease capsule's liveness reads
  // from real build progress (phase + updatedAt), not its frozen-at-14:00
  // updatedAt. FeatureBuild.updatedAt advances only on genuine phase progress.
  const { classifyWorkCapsuleLiveness } = await import("@/lib/work-capsules/liveness");
  const buildIds = rows
    .map((r) => r.featureBuildId)
    .filter((id): id is string => Boolean(id));
  const buildsById = new Map<string, { phase: string | null; lastActivityAt: Date | null }>();
  if (buildIds.length > 0) {
    const builds = await prisma.featureBuild.findMany({
      where: { id: { in: [...new Set(buildIds)] } },
      select: { id: true, phase: true, updatedAt: true },
    });
    for (const b of builds) {
      buildsById.set(b.id, { phase: b.phase ?? null, lastActivityAt: b.updatedAt ?? null });
    }
  }

  const now = new Date();
  const capsulesAll = rows.map((row) => {
    const featureBuild = row.featureBuildId ? buildsById.get(row.featureBuildId) ?? null : null;
    const verdict = classifyWorkCapsuleLiveness({ ...row, featureBuild }, now);
    const { featureBuildId: _omit, ...rest } = row;
    return {
      ...rest,
      liveness: verdict.liveness,
      isLive: verdict.isLive,
      isReapable: verdict.isReapable,
      livenessReason: verdict.reason,
      // The timestamp that PROVES liveness (lease / build activity / sync) — not
      // updatedAt, which is a daily-heartbeat artifact for Build Studio capsules.
      trueLivenessAt: verdict.trueLivenessAt ? verdict.trueLivenessAt.toISOString() : null,
    };
  });
  const capsules = staleOnly ? capsulesAll.filter((c) => !c.isLive) : capsulesAll;

  const liveCount = capsulesAll.filter((c) => c.isLive).length;
  const reapableCount = capsulesAll.filter((c) => c.isReapable).length;
  const byLiveness: Record<string, number> = {};
  for (const c of capsulesAll) byLiveness[c.liveness] = (byLiveness[c.liveness] ?? 0) + 1;

  return {
    success: true,
    message:
      `Listed ${capsules.length} work capsule(s). True liveness (updatedAt is NOT a liveness signal): ` +
      `${liveCount} live, ${reapableCount} reap-candidate of ${capsulesAll.length} scanned.`,
    data: {
      capsules,
      livenessSummary: { scanned: capsulesAll.length, live: liveCount, reapable: reapableCount, byLiveness },
    },
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
  try {
    normalizeWorkCapsuleScopeInput(parseScopeInput(params));
  } catch (error) {
    return invalidScopeResult(error);
  }

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
      scope: parseScopeInput(params),
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

export async function claimBacklogItemForWorkTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const itemId = stringParam(params, "itemId");
  const worktreePath = stringParam(params, "worktreePath");
  const branchName = stringParam(params, "branchName");
  const provider = stringParam(params, "provider");
  const sessionRef = stringParam(params, "sessionRef");

  if (!itemId || !worktreePath || !branchName || !provider || !sessionRef) {
    return {
      success: false,
      error: "invalid_input",
      message: "itemId, worktreePath, branchName, provider, and sessionRef are required.",
    };
  }

  const repositoryFullName =
    stringParam(params, "repositoryFullName") ??
    process.env.DPF_REPO_FULL_NAME?.trim() ??
    "OpenDigitalProductFactory/opendigitalproductfactory";
  const baseBranch = stringParam(params, "baseBranch") ?? "main";
  const executorKind = providerToExecutorKind(provider);

  try {
    const result = await claimBacklogItemWorkspace({
      db: workCapsuleDb(),
      input: {
        backlogItemId: itemId,
        repositoryFullName,
        headBranch: branchName,
        worktreePath,
        baseBranch,
        executorKind,
        executorRef: sessionRef,
      },
      actor: await actor(userId, context),
    });

    const base = `Bound ${result.backlogItemId} to ${result.headBranch} (${result.capsuleId}).`;
    let message: string;
    if (result.conflict) {
      const parts: string[] = [];
      if (result.conflict.backlogClaim) {
        const age = result.conflict.backlogClaim.claimAgeMinutes;
        parts.push(
          `${result.backlogItemId} already has an ACTIVE claim by another session` +
            (age != null ? ` (${age}m ago)` : "") +
            " — this call did NOT steal it",
        );
      }
      for (const loc of result.conflict.otherLocations) {
        parts.push(`also in flight on ${loc.headBranch ?? "?"} (${loc.capsuleId})`);
      }
      message =
        `${base} ADVISORY: ${result.backlogItemId} already has active work elsewhere — ${parts.join("; ")}. ` +
        "Claim-at-start is a soft signal, not a lock: coordinate with the other session before pushing.";
    } else {
      message = `${base} Claim-at-start recorded for this session.`;
    }

    return {
      success: true,
      entityId: result.capsuleId,
      message,
      data: result,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown failure";
    if (/not found/i.test(detail)) {
      return { success: false, error: "not_found", message: detail };
    }
    throw error;
  }
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

  const force = params["force"] === true;
  const db = workCapsuleDb();
  let renewedCapsule;
  try {
    renewedCapsule = await runAutoRenewedCapsuleWrite({
      capsuleId,
      userId,
      context,
      write: (currentActor) => claimWorkCapsuleScope({
        db,
        capsuleId,
        claims,
        actor: currentActor,
        force,
      }),
    });
  } catch (error) {
    if (error instanceof ScopeOverlapError) {
      return {
        success: false,
        error: "scope_conflict",
        message:
          `Scope overlaps ${error.conflicts.length} active claim(s) on another Work Capsule. ` +
          "Coordinate with the holder, claim different scope, or pass force=true to deliberately co-claim.",
        data: { conflicts: error.conflicts },
      };
    }
    throw error;
  }

  return {
    success: true,
    entityId: renewedCapsule.capsuleId,
    message: force
      ? `Force-claimed ${claims.length} scope item(s) for ${renewedCapsule.capsuleId} despite active conflicts.`
      : `Claimed ${claims.length} scope item(s) for ${renewedCapsule.capsuleId}.`,
    data: { capsule: renewedCapsule },
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

  const db = workCapsuleDb();
  const renewedCapsule = await runAutoRenewedCapsuleWrite({
    capsuleId,
    userId,
    context,
    write: (currentActor) => updateWorkCapsuleStatus({
      db,
      capsuleId,
      status,
      reason,
      actor: currentActor,
    }),
  });

  return {
    success: true,
    entityId: renewedCapsule.capsuleId,
    message: `Updated ${renewedCapsule.capsuleId} status to ${status}.`,
    data: { capsule: renewedCapsule },
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

  const db = workCapsuleDb();
  const renewedCapsule = await runAutoRenewedCapsuleWrite({
    capsuleId,
    userId,
    context,
    write: (currentActor) => releaseWorkCapsuleScope({
      db,
      capsuleId,
      claims,
      actor: currentActor,
    }),
  });

  return {
    success: true,
    entityId: renewedCapsule.capsuleId,
    message: `Released ${claims.length} scope item(s) for ${renewedCapsule.capsuleId}.`,
    data: { capsule: renewedCapsule },
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
  try {
    normalizeWorkCapsuleScopeInput(parseScopeInput(params));
  } catch (error) {
    return invalidScopeResult(error);
  }

  const capsule = await createWorkCapsule({
    db: workCapsuleDb(),
    input: {
      title,
      objective,
      source,
      idempotencyKey,
      executorKind: validatedExecutorKind,
      scope: parseScopeInput(params),
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

export async function reassignCapsuleExecutorTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const toExecutorKind = stringParam(params, "toExecutorKind");
  if (!capsuleId || !toExecutorKind) {
    return { success: false, error: "invalid_input", message: "capsuleId and toExecutorKind are required." };
  }
  if (!isWorkCapsuleExecutorKind(toExecutorKind)) {
    return {
      success: false,
      error: "invalid_executor_kind",
      message: `toExecutorKind must be one of: ${WORK_CAPSULE_EXECUTOR_KINDS.join(", ")}.`,
    };
  }
  const manifest =
    params["handoffManifest"] && typeof params["handoffManifest"] === "object" && !Array.isArray(params["handoffManifest"])
      ? (params["handoffManifest"] as Record<string, unknown>)
      : undefined;

  try {
    const capsule = await reassignWorkCapsuleExecutor({
      db: workCapsuleDb(),
      capsuleId,
      toExecutorKind,
      toExecutorRef: stringParam(params, "toExecutorRef") ?? undefined,
      reason: stringParam(params, "reason") ?? undefined,
      handoffManifest: manifest,
      actor: await actor(userId, context),
    });
    return {
      success: true,
      entityId: capsule.capsuleId,
      message: `Reassigned ${capsule.capsuleId} to ${toExecutorKind}; lease transferred.`,
      data: { capsule },
    };
  } catch (error) {
    return {
      success: false,
      error: "reassign_failed",
      message: getErrorMessage(error),
    };
  }
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
    targetId?: string;
    runtimeTargetId?: string;
    verificationId?: string;
    result?: unknown;
  } = {
    kind: rawKind,
    summary,
  };
  const command = stringParam(params, "command");
  const url = stringParam(params, "url");
  const targetId = stringParam(params, "targetId");
  const runtimeTargetId = stringParam(params, "runtimeTargetId");
  const verificationId = stringParam(params, "verificationId");
  if (command) evidence.command = command;
  if (url) evidence.url = url;
  if (targetId) evidence.targetId = targetId;
  if (runtimeTargetId) evidence.runtimeTargetId = runtimeTargetId;
  if (verificationId) evidence.verificationId = verificationId;
  if (Object.prototype.hasOwnProperty.call(params, "result")) evidence.result = params.result;

  const db = workCapsuleDb();
  const renewedCapsule = await runAutoRenewedCapsuleWrite({
    capsuleId,
    userId,
    context,
    write: (currentActor) => recordWorkCapsuleEvidence({
      db,
      capsuleId,
      evidence,
      actor: currentActor,
    }),
  });

  return {
    success: true,
    entityId: renewedCapsule.capsuleId,
    message: `Recorded evidence for ${renewedCapsule.capsuleId}.`,
    data: { capsule: renewedCapsule },
  };
}

export async function startExternalWorkTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const provider = stringParam(params, "provider");
  const externalSessionId = stringParam(params, "externalSessionId");
  if (!provider || !externalSessionId) {
    return { success: false, error: "invalid_input", message: "provider and externalSessionId are required." };
  }

  const capsuleId = await ensureExternalSessionCapsule({
    db: workCapsuleDb(),
    externalSessionId,
    provider,
    actor: await actor(userId, context),
    summary: stringParam(params, "summary"),
    backlogItemId: stringParam(params, "backlogItemId"),
    worktreePath: stringParam(params, "worktreePath"),
    branchName: stringParam(params, "branchName"),
    repositoryFullName: stringParam(params, "repositoryFullName"),
    baseBranch: stringParam(params, "baseBranch"),
  });

  return {
    success: true,
    entityId: capsuleId,
    message: `Started tracked work session ${capsuleId} for ${provider}.`,
    data: { capsuleId },
  };
}

export async function recordAgentActivityTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const type = stringParam(params, "type");
  const body = stringParam(params, "body");
  if (!capsuleId || !type || !body) {
    return { success: false, error: "invalid_input", message: "capsuleId, type, and body are required." };
  }
  if (!isAgentActivityKind(type)) {
    return {
      success: false,
      error: "invalid_type",
      message: `type must be one of: ${AGENT_ACTIVITY_KINDS.join(", ")}.`,
    };
  }
  const payload =
    params["payload"] && typeof params["payload"] === "object" && !Array.isArray(params["payload"])
      ? (params["payload"] as Record<string, unknown>)
      : undefined;

  const db = workCapsuleDb();
  const renewedCapsule = await runAutoRenewedCapsuleWrite({
    capsuleId,
    userId,
    context,
    write: (currentActor) => recordAgentActivity({
      db,
      capsuleId,
      activity: { type: type as AgentActivityKind, body, payload },
      actor: currentActor,
    }),
  });

  return {
    success: true,
    entityId: renewedCapsule.capsuleId,
    message: `Recorded ${type} on ${renewedCapsule.capsuleId}.`,
    data: { capsule: renewedCapsule },
  };
}
