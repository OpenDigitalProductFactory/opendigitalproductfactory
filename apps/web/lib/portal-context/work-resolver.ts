import { parseScopeClaims, STALE_CACHE_MS } from "@/lib/work-capsules";

import type {
  AgentThreadAnchor,
  AttentionSignal,
  FeatureBuildAnchor,
  GitBranchAnchor,
  PortalContextInput,
  PortalObjectAnchor,
  TaskRunAnchor,
  WorkBacklogAnchor,
  WorkCapsuleAnchor,
  WorkEpicAnchor,
} from "./types";
import type {
  AgentThreadRow,
  BacklogItemRow,
  EpicRow,
  FeatureBuildRow,
  PortalContextDb,
  TaskRunRow,
  WorkCapsuleRow,
} from "./db-types";

const BUILD_STALLED_TERMINAL_STATUSES = new Set([
  "complete",
  "completed",
  "done",
  "failed",
  "cancelled",
  "canceled",
  "rejected",
  "archived",
  "abandoned",
]);

export type WorkResolution = {
  work: {
    backlogItem: WorkBacklogAnchor | null;
    epic: WorkEpicAnchor | null;
    capsule: WorkCapsuleAnchor | null;
    featureBuild: FeatureBuildAnchor | null;
    taskRun: TaskRunAnchor | null;
    agentThread: AgentThreadAnchor | null;
    branch: GitBranchAnchor | null;
  };
  anchors: PortalObjectAnchor[];
  attention: AttentionSignal[];
};

export async function resolvePortalWork(input: PortalContextInput, db: PortalContextDb, now: Date): Promise<WorkResolution> {
  const attention: AttentionSignal[] = [];
  let build: FeatureBuildRow | null = null;
  let capsule: WorkCapsuleRow | null = null;

  if (input.capsuleId) {
    capsule = await db.workroom.findUnique({
      where: { capsuleId: input.capsuleId },
    });
    if (capsule?.featureBuildId) {
      build = await db.featureBuild.findUnique({ where: { id: capsule.featureBuildId } });
    }
  } else if (input.buildId) {
    build = await db.featureBuild.findUnique({ where: { buildId: input.buildId } });
    if (build) {
      capsule = await db.workroom.findFirst({
        where: { featureBuildId: build.id },
      });
      if (!capsule) {
        attention.push({
          kind: "capsule_not_linked",
          severity: "warning",
          message: "This Build Studio build is not linked to a Work Capsule.",
          actionLabel: "Open Work Control",
          actionHref: "/build/work",
        });
      }
    }
  } else if (input.threadId) {
    const thread = await db.agentThread.findUnique({ where: { id: input.threadId } });
    const taskRun = await db.taskRun.findFirst({
      where: { threadId: input.threadId },
      orderBy: { updatedAt: "desc" },
    });
    return finalizeWork({
      build: null,
      capsule: null,
      backlogItem: null,
      epic: null,
      taskRun,
      agentThread: thread,
      attention,
      now,
      routeContext: input.routeContext,
    });
  } else if (input.pathname === "/build" || input.pathname.startsWith("/build/")) {
    attention.push({
      kind: "no_active_build",
      severity: "info",
      message: "No Build Studio work object is anchored in the URL.",
      actionLabel: "Select build",
      actionHref: "/build",
    });
  }

  const [backlogItem, epic, taskRun, agentThread] = await Promise.all([
    capsule?.backlogItemId ? db.backlogItem.findUnique({ where: { id: capsule.backlogItemId } }) : Promise.resolve(null),
    capsule?.epicId ? db.epic.findUnique({ where: { id: capsule.epicId } }) : Promise.resolve(null),
    capsule?.taskRunId ? db.taskRun.findUnique({ where: { id: capsule.taskRunId } }) : Promise.resolve(null),
    build?.threadId ? db.agentThread.findUnique({ where: { id: build.threadId } }) : Promise.resolve(null),
  ]);

  return finalizeWork({
    build,
    capsule,
    backlogItem,
    epic,
    taskRun,
    agentThread,
    attention,
    now,
    routeContext: input.routeContext,
  });
}

function finalizeWork(args: {
  build: FeatureBuildRow | null;
  capsule: WorkCapsuleRow | null;
  backlogItem: BacklogItemRow | null;
  epic: EpicRow | null;
  taskRun: TaskRunRow | null;
  agentThread: AgentThreadRow | null;
  attention: AttentionSignal[];
  now: Date;
  routeContext: string;
}): WorkResolution {
  const featureBuild = args.build ? buildAnchor(args.build) : null;
  const capsule = args.capsule ? capsuleAnchor(args.capsule, args.now) : null;
  const backlogItem = args.backlogItem ? backlogAnchor(args.backlogItem, args.epic?.epicId ?? null) : null;
  const epic = args.epic ? epicAnchor(args.epic) : null;
  const taskRun = args.taskRun ? taskRunAnchor(args.taskRun) : null;
  const agentThread = args.agentThread ? agentThreadAnchor(args.agentThread, args.routeContext, args.build?.buildId ?? null) : null;
  const branch = args.capsule?.headBranch
    ? {
        branchName: args.capsule.headBranch,
        worktreePath: args.capsule.worktreePath ?? null,
        commitSha: args.capsule.headSha ?? null,
      }
    : null;

  const attention = [...args.attention];
  if (isBuildStalled(args.build, args.now)) {
    attention.push({
      kind: "build_stalled",
      severity: "warning",
      message: `Build ${args.build?.buildId} has had no observable activity inside the configured work window.`,
      actionLabel: "Open build",
      actionHref: featureBuild?.href ?? "/build",
    });
  }

  if (capsule?.isLeaseExpired) {
    attention.push({
      kind: "lease_expired",
      severity: "warning",
      message: `Work Capsule ${capsule.capsuleId} has an expired lease.`,
      actionLabel: "Open capsule",
      actionHref: capsule.href,
    });
  }

  const anchors: PortalObjectAnchor[] = [];
  if (featureBuild) anchors.push({ kind: "build", id: featureBuild.buildId, label: featureBuild.title, href: featureBuild.href });
  if (capsule) anchors.push({ kind: "capsule", id: capsule.capsuleId, label: capsule.title, href: capsule.href });
  if (backlogItem) anchors.push({ kind: "backlogItem", id: backlogItem.backlogItemId, label: backlogItem.title, href: backlogItem.href });
  if (epic) anchors.push({ kind: "epic", id: epic.epicId, label: epic.title, href: epic.href });
  if (taskRun) anchors.push({ kind: "taskRun", id: taskRun.taskRunId, label: taskRun.status });
  if (agentThread) anchors.push({ kind: "agentThread", id: agentThread.threadId, label: agentThread.routeContext });
  if (branch) anchors.push({ kind: "branch", id: branch.branchName, label: branch.branchName });

  return {
    work: {
      backlogItem,
      epic,
      capsule,
      featureBuild,
      taskRun,
      agentThread,
      branch,
    },
    anchors,
    attention,
  };
}

function buildAnchor(build: FeatureBuildRow): FeatureBuildAnchor {
  return {
    buildId: build.buildId,
    title: build.title ?? build.buildId,
    phase: build.phase ?? "ideate",
    status: build.status ?? (build.abandonedAt ? "abandoned" : "active"),
    evidenceComplete: Boolean(build.acceptanceMet || build.verificationOut),
    href: `/build?buildId=${encodeURIComponent(build.buildId)}`,
    // BI-DFC11F59: phase transitions bump updatedAt; exposed so the
    // missing_evidence grace-window gate can compute seconds-since-phase-entry
    // without a dedicated phaseEnteredAt column.
    updatedAt: build.updatedAt ? new Date(build.updatedAt).toISOString() : null,
  };
}

function capsuleAnchor(capsule: WorkCapsuleRow, now: Date): WorkCapsuleAnchor {
  const leaseExpiresAt = toIsoString(capsule.leaseExpiresAt);
  const leaseDate = capsule.leaseExpiresAt ? new Date(capsule.leaseExpiresAt) : null;
  const updatedAt = capsule.updatedAt ? new Date(capsule.updatedAt) : null;
  const staleAfterMs = 1000 * 60 * 60 * 24;
  const structuredScopeClaims = parseScopeClaims(capsule.scopeClaims);

  return {
    capsuleId: capsule.capsuleId,
    title: capsule.title,
    status: capsule.status,
    executorKind: capsule.executorKind ?? "unknown",
    executorRef: capsule.executorRef ?? null,
    leaseHolderPrincipalId: capsule.leaseHolderPrincipalId ?? null,
    leaseExpiresAt,
    isLeaseExpired: Boolean(leaseDate && leaseDate.getTime() < now.getTime()),
    isStale: Boolean(updatedAt && now.getTime() - updatedAt.getTime() > staleAfterMs),
    scopeClaims: displayScopeClaims(capsule.scopeClaims, structuredScopeClaims),
    scopeClaimPrincipalIds: Array.from(new Set(structuredScopeClaims.map((claim) => claim.recordedByPrincipalId))),
    branchName: capsule.headBranch ?? null,
    href: `/build/work/${encodeURIComponent(capsule.capsuleId)}`,
  };
}

function backlogAnchor(backlogItem: BacklogItemRow, epicId: string | null): WorkBacklogAnchor {
  return {
    backlogItemId: backlogItem.itemId,
    title: backlogItem.title,
    status: backlogItem.status,
    epicId,
    href: `/ops/backlog/${encodeURIComponent(backlogItem.itemId)}`,
  };
}

function epicAnchor(epic: EpicRow): WorkEpicAnchor {
  return {
    epicId: epic.epicId,
    title: epic.title,
    status: epic.status,
    href: `/ops/epics/${encodeURIComponent(epic.epicId)}`,
  };
}

function taskRunAnchor(taskRun: TaskRunRow): TaskRunAnchor {
  return {
    taskRunId: taskRun.taskRunId,
    contextId: taskRun.contextId ?? "",
    status: taskRun.status,
    authorityScope: summarizeAuthorityScope(taskRun.authorityScope),
    parentTaskRunId: taskRun.parentTaskRunId ?? null,
  };
}

function agentThreadAnchor(thread: AgentThreadRow, routeContext: string, buildId: string | null): AgentThreadAnchor {
  return {
    threadId: thread.id,
    routeContext: thread.contextKey || routeContext,
    buildId,
  };
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function isBuildStalled(build: FeatureBuildRow | null, now: Date): boolean {
  if (!build || (build.phase ?? "ideate") !== "build") return false;
  if (BUILD_STALLED_TERMINAL_STATUSES.has(build.status ?? "")) return false;
  if (!build.updatedAt) return false;

  const updatedAt = new Date(build.updatedAt);
  if (!Number.isFinite(updatedAt.getTime())) return false;
  return now.getTime() - updatedAt.getTime() > STALE_CACHE_MS;
}

function displayScopeClaims(value: unknown, structuredScopeClaims: ReturnType<typeof parseScopeClaims>): string[] {
  if (structuredScopeClaims.length > 0) {
    return structuredScopeClaims.map((claim) => `${claim.kind}:${claim.value}`);
  }

  return parseStringArray(value);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function summarizeAuthorityScope(value: unknown): string {
  if (value == null) return "none";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "mode" in value) {
    const mode = (value as { mode?: unknown }).mode;
    return typeof mode === "string" ? mode : "configured";
  }
  return "configured";
}
