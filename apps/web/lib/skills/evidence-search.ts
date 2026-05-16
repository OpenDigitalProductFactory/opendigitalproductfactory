import { prisma } from "@dpf/db";

export type SkillEvidenceKind =
  | "skill_usage_event"
  | "tool_execution"
  | "task_run"
  | "task_message"
  | "task_artifact"
  | "agent_message"
  | "platform_issue"
  | "improvement_proposal"
  | "skill_revision"
  | "backlog_activity"
  | "external_evidence";

export type SkillEvidenceSearchInput = {
  skillId?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  routeContext?: string | null;
  query?: string | null;
  limit?: number | null;
};

export type SkillEvidenceRefs = {
  skillId?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  taskRunRowId?: string | null;
  toolExecutionId?: string | null;
  proposalId?: string | null;
  reportId?: string | null;
  artifactId?: string | null;
  messageId?: string | null;
  backlogItemId?: string | null;
  routeContext?: string | null;
  agentId?: string | null;
  userId?: string | null;
};

export type SkillEvidenceResult = {
  kind: SkillEvidenceKind;
  id: string;
  label: string;
  summary: string;
  createdAt: string;
  refs: SkillEvidenceRefs;
};

type NormalizedScope = {
  skillId?: string;
  threadId?: string;
  taskRunId?: string;
  routeContext?: string;
  query?: string;
  limit: number;
};

type TaskRunEvidenceRow = {
  id: string;
  taskRunId: string;
  title: string;
  objective: string;
  status: string;
  source: string;
  threadId: string | null;
  routeContext: string | null;
  initiatingAgentId: string | null;
  currentAgentId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function searchSkillEvidence(
  input: SkillEvidenceSearchInput,
): Promise<SkillEvidenceResult[]> {
  const scope = normalizeScope(input);
  const taskRuns = await loadScopedTaskRuns(scope);
  const taskRunContext = buildTaskRunContext(scope, taskRuns);
  const contextualWhere = buildContextualWhere(scope, taskRunContext.businessTaskRunIds);

  const [
    usageRows,
    toolRows,
    proposalRows,
    revisionRows,
    agentMessageRows,
    issueRows,
    externalEvidenceRows,
  ] = await Promise.all([
    loadSkillUsageEvents(scope, contextualWhere),
    loadToolExecutions(scope, contextualWhere),
    loadImprovementProposals(scope, contextualWhere),
    loadSkillRevisions(scope),
    loadAgentMessages(scope, taskRunContext.allTaskRunRefs),
    loadPlatformIssues(scope, contextualWhere),
    loadExternalEvidence(scope),
  ]);

  const toolExecutionIds = toolRows.map((row) => row.id).filter(Boolean);
  const [taskMessageRows, taskArtifactRows, backlogActivityRows] = await Promise.all([
    loadTaskMessages(taskRunContext.rowIds, scope.limit),
    loadTaskArtifacts(taskRunContext.rowIds, scope.limit),
    loadBacklogActivities(toolExecutionIds, scope.limit),
  ]);

  const taskRunByRowId = new Map(taskRuns.map((row) => [row.id, row]));

  const results: SkillEvidenceResult[] = [
    ...taskRuns.map(mapTaskRun),
    ...usageRows.map(mapSkillUsageEvent),
    ...toolRows.map(mapToolExecution),
    ...proposalRows.map(mapImprovementProposal),
    ...revisionRows.map(mapSkillRevision),
    ...agentMessageRows.map(mapAgentMessage),
    ...issueRows.map(mapPlatformIssue),
    ...externalEvidenceRows.map(mapExternalEvidence),
    ...taskMessageRows.map((row) => mapTaskMessage(row, taskRunByRowId, scope)),
    ...taskArtifactRows.map((row) => mapTaskArtifact(row, taskRunByRowId, scope)),
    ...backlogActivityRows.map(mapBacklogActivity),
  ];

  return applyQuery(results, scope.query)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, scope.limit);
}

export function summarizeSkillEvidenceForPrompt(
  results: SkillEvidenceResult[],
  maxChars = 2400,
): string {
  const boundedMax = Math.max(80, Math.min(12000, Math.floor(maxChars)));
  const body =
    results.length === 0
      ? "No scoped evidence records found."
      : results
          .map((result) => {
            const refs = formatRefs(result.refs);
            return `- [${result.kind}] ${result.createdAt} ${result.label}${refs ? ` (${refs})` : ""}: ${result.summary}`;
          })
          .join("\n");

  if (body.length <= boundedMax) return body;
  return `${body.slice(0, Math.max(0, boundedMax - 3)).trimEnd()}...`;
}

function normalizeScope(input: SkillEvidenceSearchInput): NormalizedScope {
  const scope: NormalizedScope = {
    skillId: clean(input.skillId),
    threadId: clean(input.threadId),
    taskRunId: clean(input.taskRunId),
    routeContext: clean(input.routeContext),
    query: clean(input.query),
    limit: normalizeLimit(input.limit),
  };

  if (!scope.skillId && !scope.threadId && !scope.taskRunId && !scope.routeContext) {
    throw new Error(
      "[skill-evidence] scoped search requires skillId, threadId, taskRunId, or routeContext",
    );
  }

  return scope;
}

function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeLimit(limit: number | null | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

async function loadScopedTaskRuns(scope: NormalizedScope): Promise<TaskRunEvidenceRow[]> {
  const ors: Array<Record<string, unknown>> = [];
  if (scope.taskRunId) {
    ors.push({ taskRunId: scope.taskRunId }, { id: scope.taskRunId });
  }
  if (scope.threadId) ors.push({ threadId: scope.threadId });
  if (scope.routeContext) ors.push({ routeContext: scope.routeContext });
  if (ors.length === 0) return [];

  return prisma.taskRun.findMany({
    where: { OR: ors },
    orderBy: { createdAt: "desc" },
    take: scope.limit,
    select: {
      id: true,
      taskRunId: true,
      title: true,
      objective: true,
      status: true,
      source: true,
      threadId: true,
      routeContext: true,
      initiatingAgentId: true,
      currentAgentId: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
}

function buildTaskRunContext(scope: NormalizedScope, taskRuns: TaskRunEvidenceRow[]) {
  const rowIds = unique(taskRuns.map((row) => row.id));
  const businessTaskRunIds = unique([
    ...(scope.taskRunId ? [scope.taskRunId] : []),
    ...taskRuns.map((row) => row.taskRunId),
  ]);
  const allTaskRunRefs = unique([...businessTaskRunIds, ...rowIds]);
  return { rowIds, businessTaskRunIds, allTaskRunRefs };
}

function buildContextualWhere(
  scope: NormalizedScope,
  businessTaskRunIds: string[],
): Array<Record<string, unknown>> {
  const ors: Array<Record<string, unknown>> = [];
  if (scope.threadId) ors.push({ threadId: scope.threadId });
  if (businessTaskRunIds.length > 0) ors.push({ taskRunId: { in: businessTaskRunIds } });
  if (scope.routeContext) ors.push({ routeContext: scope.routeContext });
  return ors;
}

function scopedWhere(
  base: Record<string, unknown>,
  contextualWhere: Array<Record<string, unknown>>,
) {
  if (contextualWhere.length === 0) return base;
  if (Object.keys(base).length === 0) return { OR: contextualWhere };
  return { AND: [base, { OR: contextualWhere }] };
}

async function loadSkillUsageEvents(
  scope: NormalizedScope,
  contextualWhere: Array<Record<string, unknown>>,
) {
  return prisma.skillUsageEvent.findMany({
    where: scopedWhere(scope.skillId ? { skillId: scope.skillId } : {}, contextualWhere),
    orderBy: { createdAt: "desc" },
    take: scope.limit,
    select: {
      id: true,
      eventId: true,
      skillId: true,
      agentId: true,
      userId: true,
      threadId: true,
      taskRunId: true,
      toolExecutionId: true,
      routeContext: true,
      phase: true,
      source: true,
      metadata: true,
      createdAt: true,
    },
  });
}

async function loadToolExecutions(
  scope: NormalizedScope,
  contextualWhere: Array<Record<string, unknown>>,
) {
  return prisma.toolExecution.findMany({
    where: scopedWhere(scope.skillId ? { skillId: scope.skillId } : {}, contextualWhere),
    orderBy: { createdAt: "desc" },
    take: scope.limit,
    select: {
      id: true,
      threadId: true,
      agentId: true,
      userId: true,
      toolName: true,
      success: true,
      parameters: true,
      result: true,
      executionMode: true,
      routeContext: true,
      durationMs: true,
      createdAt: true,
      taskRunId: true,
      skillId: true,
      summary: true,
    },
  });
}

async function loadImprovementProposals(
  scope: NormalizedScope,
  contextualWhere: Array<Record<string, unknown>>,
) {
  const proposalContext = contextualWhere.filter(
    (where) => "threadId" in where || "routeContext" in where,
  );
  if (!scope.skillId && proposalContext.length === 0) return [];
  return prisma.improvementProposal.findMany({
    where: scopedWhere(
      {
        category: "skill",
        ...(scope.skillId ? { targetSkillId: scope.skillId } : {}),
      },
      proposalContext,
    ),
    orderBy: { createdAt: "desc" },
    take: scope.limit,
    select: {
      id: true,
      proposalId: true,
      title: true,
      description: true,
      category: true,
      severity: true,
      submittedById: true,
      agentId: true,
      routeContext: true,
      threadId: true,
      conversationExcerpt: true,
      observedFriction: true,
      status: true,
      targetSkillId: true,
      createdAt: true,
    },
  });
}

async function loadSkillRevisions(scope: NormalizedScope) {
  if (!scope.skillId) return [];
  return prisma.skillRevision.findMany({
    where: { skillId: scope.skillId },
    orderBy: { createdAt: "desc" },
    take: scope.limit,
    select: {
      id: true,
      revisionId: true,
      skillId: true,
      version: true,
      changeReason: true,
      changedBy: true,
      proposalId: true,
      createdAt: true,
    },
  });
}

async function loadAgentMessages(
  scope: NormalizedScope,
  allTaskRunRefs: string[],
) {
  const ors: Array<Record<string, unknown>> = [];
  if (scope.threadId) ors.push({ threadId: scope.threadId });
  if (allTaskRunRefs.length > 0) ors.push({ taskRunId: { in: allTaskRunRefs } });
  if (scope.routeContext) ors.push({ routeContext: scope.routeContext });
  if (ors.length === 0) return [];
  return prisma.agentMessage.findMany({
    where: { OR: ors },
    orderBy: { createdAt: "desc" },
    take: scope.limit,
    select: {
      id: true,
      threadId: true,
      taskRunId: true,
      role: true,
      content: true,
      createdAt: true,
      agentId: true,
      routeContext: true,
    },
  });
}

async function loadPlatformIssues(
  scope: NormalizedScope,
  contextualWhere: Array<Record<string, unknown>>,
) {
  if (contextualWhere.length === 0) return [];
  return prisma.platformIssueReport.findMany({
    where: { OR: contextualWhere },
    orderBy: { createdAt: "desc" },
    take: scope.limit,
    select: {
      id: true,
      reportId: true,
      type: true,
      severity: true,
      status: true,
      title: true,
      description: true,
      routeContext: true,
      errorStack: true,
      agentId: true,
      source: true,
      threadId: true,
      taskRunId: true,
      createdAt: true,
    },
  });
}

async function loadExternalEvidence(scope: NormalizedScope) {
  if (!scope.routeContext) return [];
  return prisma.externalEvidenceRecord.findMany({
    where: { routeContext: scope.routeContext },
    orderBy: { createdAt: "desc" },
    take: scope.limit,
    select: {
      id: true,
      actorUserId: true,
      routeContext: true,
      operationType: true,
      target: true,
      provider: true,
      resultSummary: true,
      details: true,
      createdAt: true,
    },
  });
}

async function loadTaskMessages(taskRunRowIds: string[], limit: number) {
  if (taskRunRowIds.length === 0) return [];
  return prisma.taskMessage.findMany({
    where: { taskRunId: { in: taskRunRowIds } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      messageId: true,
      taskRunId: true,
      role: true,
      parts: true,
      metadata: true,
      createdAt: true,
    },
  });
}

async function loadTaskArtifacts(taskRunRowIds: string[], limit: number) {
  if (taskRunRowIds.length === 0) return [];
  return prisma.taskArtifact.findMany({
    where: { taskRunId: { in: taskRunRowIds } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      artifactId: true,
      taskRunId: true,
      name: true,
      description: true,
      parts: true,
      metadata: true,
      createdAt: true,
    },
  });
}

async function loadBacklogActivities(toolExecutionIds: string[], limit: number) {
  if (toolExecutionIds.length === 0) return [];
  return prisma.backlogItemActivity.findMany({
    where: {
      kind: "evidence",
      toolExecutionId: { in: toolExecutionIds },
    },
    orderBy: { recordedAt: "desc" },
    take: limit,
    select: {
      id: true,
      backlogItemId: true,
      kind: true,
      summary: true,
      payload: true,
      recordedAt: true,
      recordedById: true,
      recordedByAgentId: true,
      toolExecutionId: true,
    },
  });
}

function mapTaskRun(row: TaskRunEvidenceRow): SkillEvidenceResult {
  return {
    kind: "task_run",
    id: row.taskRunId,
    label: `Task run ${row.taskRunId}`,
    summary: compact(`${row.status} ${row.source}: ${row.title}. ${row.objective}`),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      threadId: row.threadId,
      taskRunId: row.taskRunId,
      taskRunRowId: row.id,
      routeContext: row.routeContext,
      agentId: row.currentAgentId ?? row.initiatingAgentId,
    }),
  };
}

function mapSkillUsageEvent(row: Record<string, unknown>): SkillEvidenceResult {
  return {
    kind: "skill_usage_event",
    id: asString(row.eventId) ?? asString(row.id) ?? "skill-usage-event",
    label: `Skill ${asString(row.skillId) ?? "unknown"} ${asString(row.phase) ?? "event"}`,
    summary: compact(
      [
        `phase ${asString(row.phase) ?? "unknown"} from ${asString(row.source) ?? "unknown"}`,
        preview(row.metadata) ? `metadata: ${preview(row.metadata)}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    ),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      skillId: asString(row.skillId),
      threadId: asString(row.threadId),
      taskRunId: asString(row.taskRunId),
      toolExecutionId: asString(row.toolExecutionId),
      routeContext: asString(row.routeContext),
      agentId: asString(row.agentId),
      userId: asString(row.userId),
    }),
  };
}

function mapToolExecution(row: Record<string, unknown>): SkillEvidenceResult {
  const success = row.success === true;
  const fallbackSummary = success ? preview(row.result) : preview(row.result) || preview(row.parameters);
  return {
    kind: "tool_execution",
    id: asString(row.id) ?? "tool-execution",
    label: `${asString(row.toolName) ?? "tool"} ${success ? "succeeded" : "failed"}`,
    summary: compact(asString(row.summary) ?? fallbackSummary ?? "No tool summary recorded."),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      skillId: asString(row.skillId),
      threadId: asString(row.threadId),
      taskRunId: asString(row.taskRunId),
      toolExecutionId: asString(row.id),
      routeContext: asString(row.routeContext),
      agentId: asString(row.agentId),
      userId: asString(row.userId),
    }),
  };
}

function mapImprovementProposal(row: Record<string, unknown>): SkillEvidenceResult {
  return {
    kind: "improvement_proposal",
    id: asString(row.proposalId) ?? asString(row.id) ?? "improvement-proposal",
    label: `Proposal ${asString(row.proposalId) ?? ""}: ${asString(row.title) ?? "Untitled"}`.trim(),
    summary: compact(
      [
        asString(row.description),
        asString(row.observedFriction) ? `friction: ${asString(row.observedFriction)}` : null,
        asString(row.status) ? `status: ${asString(row.status)}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    ),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      skillId: asString(row.targetSkillId),
      threadId: asString(row.threadId),
      proposalId: asString(row.proposalId),
      routeContext: asString(row.routeContext),
      agentId: asString(row.agentId),
      userId: asString(row.submittedById),
    }),
  };
}

function mapSkillRevision(row: Record<string, unknown>): SkillEvidenceResult {
  const version = typeof row.version === "number" ? row.version : Number(row.version);
  return {
    kind: "skill_revision",
    id: asString(row.revisionId) ?? asString(row.id) ?? "skill-revision",
    label: `Skill revision v${Number.isFinite(version) ? version : "?"}`,
    summary: compact(asString(row.changeReason) ?? "Skill revision recorded."),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      skillId: asString(row.skillId),
      proposalId: asString(row.proposalId),
      agentId: asString(row.changedBy),
    }),
  };
}

function mapAgentMessage(row: Record<string, unknown>): SkillEvidenceResult {
  return {
    kind: "agent_message",
    id: asString(row.id) ?? "agent-message",
    label: `Agent message (${asString(row.role) ?? "unknown"})`,
    summary: compact(asString(row.content) ?? "No message content recorded."),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      threadId: asString(row.threadId),
      taskRunId: asString(row.taskRunId),
      routeContext: asString(row.routeContext),
      agentId: asString(row.agentId),
      messageId: asString(row.id),
    }),
  };
}

function mapPlatformIssue(row: Record<string, unknown>): SkillEvidenceResult {
  return {
    kind: "platform_issue",
    id: asString(row.reportId) ?? asString(row.id) ?? "platform-issue",
    label: `${asString(row.severity) ?? "medium"} issue: ${asString(row.title) ?? "Untitled"}`,
    summary: compact(
      [
        asString(row.description),
        asString(row.errorStack) ? `stack: ${asString(row.errorStack)}` : null,
        asString(row.status) ? `status: ${asString(row.status)}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    ),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      threadId: asString(row.threadId),
      taskRunId: asString(row.taskRunId),
      routeContext: asString(row.routeContext),
      agentId: asString(row.agentId),
      reportId: asString(row.reportId),
    }),
  };
}

function mapExternalEvidence(row: Record<string, unknown>): SkillEvidenceResult {
  return {
    kind: "external_evidence",
    id: asString(row.id) ?? "external-evidence",
    label: `${asString(row.provider) ?? "provider"} ${asString(row.operationType) ?? "operation"}`,
    summary: compact(
      [
        asString(row.resultSummary),
        asString(row.target) ? `target: ${asString(row.target)}` : null,
        preview(row.details) ? `details: ${preview(row.details)}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    ),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      routeContext: asString(row.routeContext),
      userId: asString(row.actorUserId),
    }),
  };
}

function mapTaskMessage(
  row: Record<string, unknown>,
  taskRunByRowId: Map<string, TaskRunEvidenceRow>,
  scope: NormalizedScope,
): SkillEvidenceResult {
  const taskRunRowId = asString(row.taskRunId);
  const taskRun = taskRunRowId ? taskRunByRowId.get(taskRunRowId) : undefined;
  return {
    kind: "task_message",
    id: asString(row.messageId) ?? asString(row.id) ?? "task-message",
    label: `Task message ${asString(row.role) ?? "unknown"}`,
    summary: compact(partsPreview(row.parts) || preview(row.metadata) || "No task message content recorded."),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      threadId: taskRun?.threadId ?? scope.threadId,
      taskRunId: taskRun?.taskRunId ?? scope.taskRunId,
      taskRunRowId,
      messageId: asString(row.messageId) ?? asString(row.id),
      routeContext: taskRun?.routeContext ?? scope.routeContext,
    }),
  };
}

function mapTaskArtifact(
  row: Record<string, unknown>,
  taskRunByRowId: Map<string, TaskRunEvidenceRow>,
  scope: NormalizedScope,
): SkillEvidenceResult {
  const taskRunRowId = asString(row.taskRunId);
  const taskRun = taskRunRowId ? taskRunByRowId.get(taskRunRowId) : undefined;
  return {
    kind: "task_artifact",
    id: asString(row.artifactId) ?? asString(row.id) ?? "task-artifact",
    label: `Task artifact ${asString(row.name) ?? "unnamed"}`,
    summary: compact(
      asString(row.description) ?? partsPreview(row.parts) ?? preview(row.metadata) ?? "No artifact summary recorded.",
    ),
    createdAt: iso(row.createdAt),
    refs: cleanRefs({
      threadId: taskRun?.threadId ?? scope.threadId,
      taskRunId: taskRun?.taskRunId ?? scope.taskRunId,
      taskRunRowId,
      artifactId: asString(row.artifactId) ?? asString(row.id),
      routeContext: taskRun?.routeContext ?? scope.routeContext,
    }),
  };
}

function mapBacklogActivity(row: Record<string, unknown>): SkillEvidenceResult {
  return {
    kind: "backlog_activity",
    id: asString(row.id) ?? "backlog-activity",
    label: `Backlog evidence: ${asString(row.summary) ?? "recorded"}`,
    summary: compact(preview(row.payload) || asString(row.summary) || "Backlog evidence recorded."),
    createdAt: iso(row.recordedAt),
    refs: cleanRefs({
      backlogItemId: asString(row.backlogItemId),
      toolExecutionId: asString(row.toolExecutionId),
      agentId: asString(row.recordedByAgentId),
      userId: asString(row.recordedById),
    }),
  };
}

function applyQuery(
  results: SkillEvidenceResult[],
  query: string | undefined,
): SkillEvidenceResult[] {
  if (!query) return results;
  const needle = query.toLowerCase();
  return results.filter((result) =>
    [
      result.kind,
      result.id,
      result.label,
      result.summary,
      JSON.stringify(result.refs),
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

function formatRefs(refs: SkillEvidenceRefs): string {
  return Object.entries(refs)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function cleanRefs(refs: SkillEvidenceRefs): SkillEvidenceRefs {
  return Object.fromEntries(
    Object.entries(refs).filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    ),
  ) as SkillEvidenceRefs;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function preview(value: unknown, max = 220): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const compacted = compact(raw);
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function partsPreview(value: unknown): string | null {
  if (typeof value === "string") return preview(value);
  if (Array.isArray(value)) {
    const text = value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : null;
        }
        return null;
      })
      .filter(Boolean)
      .join(" ");
    return text ? preview(text) : preview(value);
  }
  return preview(value);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}
