export type DeliveryTaskGroup = "ready" | "working" | "waiting" | "needs-attention" | "complete";
export type DeliveryTaskFreshness = "fresh" | "stale" | "partial";

export type DeliveryTaskProgress = {
  summary?: string;
  message?: string;
  current?: number;
  completed?: number;
  total?: number;
  percent?: number;
  waitReason?: string;
  error?: string;
  nextAction?: string;
};

export type DeliveryTaskHubSource = {
  id: string;
  capsuleId: string;
  title: string;
  objective: string;
  status: string;
  source: string;
  executorKind: string | null;
  executorRef: string | null;
  backlogItemId: string | null;
  repositoryFullName: string | null;
  headBranch: string | null;
  pullRequestUrl: string | null;
  leaseExpiresAt: Date | null;
  updatedAt: Date;
  lastSyncedAt: Date | null;
  taskRun: {
    taskRunId: string;
    title: string;
    status: string;
    routeContext: string | null;
    progressPayload: unknown;
    startedAt: Date;
    completedAt: Date | null;
    updatedAt: Date;
    actionEnvelopes: Array<{
      id: string;
      status: string;
      createdAt: Date;
      expiresAt: Date | null;
    }>;
  } | null;
  activities: Array<{
    id: string;
    kind: string;
    summary: string;
    recordedAt: Date;
  }>;
  runtimeVerifications: Array<{
    verificationId: string;
    kind: string;
    status: string;
    result: unknown;
    completedAt: Date | null;
    updatedAt: Date;
  }>;
};

export type DeliveryTaskHubRow = {
  capsuleId: string;
  title: string;
  objective: string;
  group: DeliveryTaskGroup;
  status: string;
  statusIntent: "neutral" | "info" | "success" | "warning" | "danger";
  ownerLabel: string;
  stageLabel: string;
  source: string;
  backlogItemId: string | null;
  branch: string | null;
  taskRunId: string | null;
  observedAt: string;
  freshness: DeliveryTaskFreshness;
  freshnessReason: string | null;
  latestTransition: { id: string; kind: string; summary: string; recordedAt: string } | null;
  progress: DeliveryTaskProgress | null;
  nextAction: string | null;
  verifiedResult: string | null;
  inspectHref: string;
  resumeHref: string | null;
  pullRequestHref: string | null;
  primaryAction: { label: string; href: string };
  secondaryActions: Array<{ label: string; href: string }>;
  asyncOperation: { coreHandleAvailable: false };
};

const ACTIVE_WORKROOM = new Set(["working", "verifying"]);
const WAITING_WORKROOM = new Set(["ready-for-review", "ready-for-promotion"]);
const FAILURE_TASK = new Set(["failed", "rejected", "canceled", "stalled", "auth-required"]);
const WORKING_TASK = new Set(["working", "quiescing"]);
const WAITING_TASK = new Set(["submitted", "queued", "pending"]);
const COMPLETE_TASK = new Set(["completed", "archived"]);
const MEANINGLESS_ACTIVITY = /heartbeat|progress|lease-heartbeat/i;
const ACTIVE_STALE_MS = 30 * 60 * 1_000;
const MAX_PROGRESS_TEXT = 240;
const PROGRESS_TEXT_KEYS = ["summary", "message", "waitReason", "error", "nextAction"] as const;
const PROGRESS_NUMBER_KEYS = ["current", "completed", "total", "percent"] as const;
const PROGRESS_KEYS = new Set<string>([...PROGRESS_TEXT_KEYS, ...PROGRESS_NUMBER_KEYS]);
const AFFIRMATIVE_VERIFICATION = new Set(["pass", "passed", "success", "succeeded", "verified"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= MAX_PROGRESS_TEXT
    ? trimmed
    : `${trimmed.slice(0, MAX_PROGRESS_TEXT - 3)}…`;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function sanitizeDeliveryProgress(value: unknown): DeliveryTaskProgress | null {
  const input = record(value);
  if (!input) return null;
  const progress: DeliveryTaskProgress = {};
  for (const key of PROGRESS_TEXT_KEYS) {
    const text = boundedText(input[key]);
    if (text) progress[key] = text;
  }
  const current = finiteNonNegative(input.current);
  const completed = finiteNonNegative(input.completed);
  const total = finiteNonNegative(input.total);
  const percent = finiteNonNegative(input.percent);
  if (current !== undefined) progress.current = current;
  if (completed !== undefined && total !== undefined && total > 0 && completed <= total) {
    progress.completed = completed;
    progress.total = total;
  }
  if (percent !== undefined) progress.percent = Math.min(100, percent);
  return Object.keys(progress).length > 0 ? progress : null;
}

function progressPayloadIsPartial(value: unknown): boolean {
  if (value == null) return false;
  const input = record(value);
  if (!input || Object.keys(input).some((key) => !PROGRESS_KEYS.has(key))) return true;
  if (PROGRESS_TEXT_KEYS.some((key) => input[key] != null && typeof input[key] !== "string")) return true;
  if (PROGRESS_NUMBER_KEYS.some((key) => input[key] != null && finiteNonNegative(input[key]) === undefined)) return true;
  const completed = finiteNonNegative(input.completed);
  const total = finiteNonNegative(input.total);
  if ((completed === undefined) !== (total === undefined)) return true;
  if (completed !== undefined && total !== undefined && (total <= 0 || completed > total)) return true;
  const percent = finiteNonNegative(input.percent);
  return percent !== undefined && percent > 100;
}

function safeInternalRoute(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const parsed = new URL(value, "https://dpf.invalid");
    if (parsed.origin !== "https://dpf.invalid") return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function safePullRequestUrl(value: string | null, repositoryFullName: string | null): string | null {
  if (!value || !repositoryFullName) return null;
  try {
    const parsed = new URL(value);
    const expectedPrefix = `/${repositoryFullName.toLowerCase()}/pull/`;
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return null;
    if (!parsed.pathname.toLowerCase().startsWith(expectedPrefix)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function newestSourceTime(source: DeliveryTaskHubSource): Date {
  const times = [source.updatedAt, source.taskRun?.updatedAt, source.activities[0]?.recordedAt,
    source.runtimeVerifications[0]?.updatedAt].filter((value): value is Date => value instanceof Date);
  return new Date(Math.max(...times.map((value) => value.getTime())));
}

function hasLiveApproval(source: DeliveryTaskHubSource, now: Date): boolean {
  return Boolean(source.taskRun?.actionEnvelopes.some((envelope) =>
    ["proposed", "approved"].includes(envelope.status)
      && (!envelope.expiresAt || envelope.expiresAt.getTime() > now.getTime())));
}

function hasExpiredApproval(source: DeliveryTaskHubSource, now: Date): boolean {
  return Boolean(source.taskRun?.actionEnvelopes.some((envelope) =>
    ["proposed", "approved"].includes(envelope.status)
      && envelope.expiresAt != null
      && envelope.expiresAt.getTime() <= now.getTime()));
}

function isSourceConflict(source: DeliveryTaskHubSource): boolean {
  const taskStatus = source.taskRun?.status;
  return Boolean(taskStatus && COMPLETE_TASK.has(taskStatus) && source.status !== "complete" && source.status !== "archived");
}

function resolveGroup(source: DeliveryTaskHubSource, now: Date): DeliveryTaskGroup {
  const taskStatus = source.taskRun?.status ?? null;
  const leaseExpired = ACTIVE_WORKROOM.has(source.status)
    && source.leaseExpiresAt != null
    && source.leaseExpiresAt.getTime() <= now.getTime();
  if (source.status === "blocked" || FAILURE_TASK.has(taskStatus ?? "") || hasLiveApproval(source, now)
    || hasExpiredApproval(source, now) || leaseExpired || isSourceConflict(source)) return "needs-attention";
  if (taskStatus === "input-required" || WAITING_TASK.has(taskStatus ?? "") || WAITING_WORKROOM.has(source.status)) return "waiting";
  if (WORKING_TASK.has(taskStatus ?? "") || ACTIVE_WORKROOM.has(source.status)) return "working";
  if (["complete", "archived"].includes(source.status) && (!taskStatus || COMPLETE_TASK.has(taskStatus))) return "complete";
  return "ready";
}

function statusIntent(group: DeliveryTaskGroup): DeliveryTaskHubRow["statusIntent"] {
  if (group === "complete") return "success";
  if (group === "needs-attention") return "danger";
  if (group === "waiting") return "warning";
  if (group === "working") return "info";
  return "neutral";
}

function label(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function verifiedResult(source: DeliveryTaskHubSource): string | null {
  const verification = source.runtimeVerifications[0];
  if (verification && AFFIRMATIVE_VERIFICATION.has(verification.status.trim().toLowerCase())) {
    return `${label(verification.kind)} verified`;
  }
  return source.taskRun?.status === "completed" ? "Task completed" : null;
}

function primaryActionFor(source: DeliveryTaskHubSource, group: DeliveryTaskGroup, now: Date): { label: string; href: string } {
  const inspectHref = `/build/work/${encodeURIComponent(source.capsuleId)}`;
  if (hasLiveApproval(source, now)) return { label: "Review request", href: "/workspace/inbox" };
  if (ACTIVE_WORKROOM.has(source.status) && source.leaseExpiresAt && source.leaseExpiresAt <= now) {
    return { label: "Take over", href: `${inspectHref}#handoff` };
  }
  if (group === "complete") return { label: "View result", href: `${inspectHref}#result` };
  const resume = safeInternalRoute(source.taskRun?.routeContext ?? null);
  if (resume && (group === "working" || group === "waiting")) return { label: "Resume", href: resume };
  return { label: "Inspect", href: inspectHref };
}

export function projectDeliveryTaskHubRow(source: DeliveryTaskHubSource, now: Date = new Date()): DeliveryTaskHubRow {
  const group = resolveGroup(source, now);
  const observedAt = newestSourceTime(source);
  const conflict = isSourceConflict(source);
  const progressPartial = progressPayloadIsPartial(source.taskRun?.progressPayload);
  const stale = group !== "complete" && now.getTime() - observedAt.getTime() > ACTIVE_STALE_MS;
  const progress = sanitizeDeliveryProgress(source.taskRun?.progressPayload);
  const latest = [...source.activities]
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
    .find((activity) => !MEANINGLESS_ACTIVITY.test(activity.kind));
  const inspectHref = `/build/work/${encodeURIComponent(source.capsuleId)}`;
  const resumeHref = safeInternalRoute(source.taskRun?.routeContext ?? null);
  const pullRequestHref = safePullRequestUrl(source.pullRequestUrl, source.repositoryFullName);
  const primaryAction = primaryActionFor(source, group, now);
  const secondaryActions = [
    primaryAction.href !== inspectHref ? { label: "Inspect", href: inspectHref } : null,
    pullRequestHref ? { label: "Open pull request", href: pullRequestHref } : null,
    { label: "Handoff", href: `${inspectHref}#handoff` },
  ].filter((action): action is { label: string; href: string } => action != null);

  return {
    capsuleId: source.capsuleId,
    title: source.title,
    objective: source.objective,
    group,
    status: source.taskRun?.status ?? source.status,
    statusIntent: statusIntent(group),
    ownerLabel: source.executorRef?.trim() || source.executorKind?.trim() || "Unassigned",
    stageLabel: label(source.taskRun?.status ?? source.status),
    source: source.source,
    backlogItemId: source.backlogItemId,
    branch: source.headBranch,
    taskRunId: source.taskRun?.taskRunId ?? null,
    observedAt: observedAt.toISOString(),
    freshness: conflict || progressPartial ? "partial" : stale ? "stale" : "fresh",
    freshnessReason: conflict
      ? "TaskRun completed before the Workroom reached a terminal state."
      : progressPartial ? "Task progress could not be safely projected from the durable payload."
      : stale ? "This active Workroom has no recent durable transition." : null,
    latestTransition: latest ? {
      id: latest.id,
      kind: latest.kind,
      summary: boundedText(latest.summary) ?? "Workroom updated",
      recordedAt: latest.recordedAt.toISOString(),
    } : null,
    progress,
    nextAction: progress?.nextAction ?? (group === "needs-attention" ? primaryAction.label : null),
    verifiedResult: verifiedResult(source),
    inspectHref,
    resumeHref,
    pullRequestHref,
    primaryAction,
    secondaryActions,
    asyncOperation: { coreHandleAvailable: false },
  };
}
