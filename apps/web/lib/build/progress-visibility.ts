import {
  BUILD_TRUTH_STALE_THRESHOLD_MS,
  type BuildFailureAxis,
  type TruthNumericSnapshot,
  hasStaleTruthConflict,
} from "./progress-visibility-types";
import type { BuildDispatchAttemptView } from "./dispatch-attempts";
import { getDispatchHistoryForBuild } from "./dispatch-attempts";
import { getSandboxStateForBuild, type BuildSandboxState } from "./sandbox-state";
import { getScopedVerificationForBuild, type ScopedVerificationView } from "./scoped-verification";
import { normalizeTaskResults, type NormalizedTaskResults } from "./task-results";
import { loadBuildEvidenceTimelineEvents } from "./evidence-timeline";
import type { UnifiedEvidenceTimelineEvent } from "./evidence-timeline-types";
import { classifyInferenceFailure, type InferenceFailureKind } from "./inference-failure";

export type ChatProgressSnapshot = {
  completed: number | null;
  total: number | null;
  observedAt: string | null;
  excerpt: string;
};

export type ChatProgressMessageInput = {
  role: string | null;
  content: string | null;
  createdAt: Date | string | null;
};

/** EP-COST Phase 3: per-phase cost rollup from BuildPhaseRun table */
export type PhaseRunSummary = {
  phase: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string | null; // Decimal serialized as string
  inferenceCount: number;
};

export type BuildProgressVisibility = {
  buildId: string;
  generatedAt: string;
  statusHeading: {
    operatorAction: string;
    failureAxis: BuildFailureAxis | null;
  };
  progress: {
    primary: TruthNumericSnapshot;
    conflicts: TruthNumericSnapshot[];
  };
  tasks: NormalizedTaskResults;
  staleChatSnapshots: ChatProgressSnapshot[];
  sandbox: BuildSandboxState | null;
  dispatchHistory: BuildDispatchAttemptView[];
  verification: ScopedVerificationView | null;
  quietAgent: {
    quiet: boolean;
    minutesQuiet: number;
    lastObservableSignalAt: string | null;
    /**
     * Newest signal that proves the build actually advanced. Generic
     * BuildActivity is intentionally excluded: a heartbeat or status note can
     * prove liveness, but it cannot clear a persisted provider failure.
     */
    lastMeaningfulSignalAt?: string | null;
  };
  /**
   * BI-F0005EB0 (EP-BS-UX-HARDENING) — whether the most recent assistant turn in
   * the build's coworker thread is an inference failure (the AI call errored)
   * rather than a real answer. Drives the danger "Retry the AI call" affordance
   * so a failed ideate/scout inference is not mis-surfaced as "Waiting on
   * evidence". `failed` is true only when the newest assistant message
   * classifies AND no fresher observable signal (task/dispatch/activity) has
   * landed since — so a successful turn after a retry self-clears it.
   *
   * Optional so projection literals (tests) need not supply it;
   * getBuildProgressVisibility always populates it. Consumers read it with
   * optional chaining (`progressVisibility?.inferenceFailure?.failed`).
   */
  inferenceFailure?: {
    failed: boolean;
    kind: InferenceFailureKind | null;
    observedAt: string | null;
  };
  /** Latest Build Studio engine decision, projected from BuildActivity. */
  engineSelection?: {
    summary: string;
    observedAt: string;
  } | null;
  /**
   * BI-CE1AB982 — the newest dispatch that was REFUSED before it started,
   * because no allowed healthy engine could run the phase.
   *
   * A skipped dispatch writes no BuildDispatchAttempt row, so it is invisible to
   * `dispatchHistory`, to `quietAgent` (which only counts elapsed silence) and
   * to `inferenceFailure` (which classifies an assistant turn that actually
   * ran). Without this signal the owner panel falls through to "working" and
   * reports progress on a build that never started, indefinitely.
   *
   * Self-clearing on the same rule as `inferenceFailure`: a fresher meaningful
   * signal (task result, verification, dispatch) proves the pipeline moved on.
   *
   * Optional so projection literals (tests) need not supply it;
   * getBuildProgressVisibility always populates it.
   */
  dispatchBlock?: {
    blocked: boolean;
    reason: string | null;
    observedAt: string | null;
  };
  /** Phase-level cost rollup; empty array when BuildPhaseRun rows don't exist yet */
  phaseRuns: PhaseRunSummary[];
  /**
   * EP-UNIFIED-TRACKING Phase 1: cross-surface evidence (external-agent, runtime,
   * capsule), newest first. Optional so callers constructing a projection literal
   * (e.g. tests) need not supply it; getBuildProgressVisibility always populates it.
   */
  evidenceTimeline?: UnifiedEvidenceTimelineEvent[];
};

export function buildProgressProjectionFromParts(args: {
  buildId: string;
  now?: Date;
  dbTasks: NormalizedTaskResults;
  chatSnapshots: ChatProgressSnapshot[];
  sandbox: BuildSandboxState | null;
  dispatchHistory: BuildDispatchAttemptView[];
  verification: ScopedVerificationView | null;
  lastActivityAt: string | null;
  /**
   * Newest assistant turn in the build's coworker thread, used to detect a
   * failed inference. Optional so projection literals (tests) need not supply it
   * — absent means "no inference failure".
   */
  lastAssistant?: { content: string | null; createdAt: Date | string | null } | null;
  phaseRuns?: PhaseRunSummary[];
  evidenceTimeline?: UnifiedEvidenceTimelineEvent[];
  engineSelection?: { summary: string; observedAt: Date | string } | null;
  /**
   * BI-CE1AB982 — newest refused-before-start dispatch, if any. Optional so
   * projection literals (tests) need not supply it — absent means "not blocked".
   */
  dispatchBlock?: { reason: string; observedAt: Date | string } | null;
}): BuildProgressVisibility {
  const now = args.now ?? new Date();
  const conflicts = getProgressConflicts(args.dbTasks.source, args.chatSnapshots);
  const failureAxis = deriveFailureAxis(args.dispatchHistory, args.verification);
  const blockedTasks = args.dbTasks.tasks.filter((task) =>
    task.outcome !== "DONE" && task.outcome !== "DONE_WITH_CONCERNS"
  );
  const lastObservableSignalAt = getLastObservableSignalAt({
    taskResultsAt: args.dbTasks.source.observedAt,
    verificationAt: args.verification?.observedAt ?? null,
    dispatchHistory: args.dispatchHistory,
    lastActivityAt: args.lastActivityAt,
  });
  const lastMeaningfulSignalAt = getLastMeaningfulSignalAt({
    taskResultsAt: args.dbTasks.totalTasks > 0 ? args.dbTasks.source.observedAt : null,
    verificationAt: args.verification?.observedAt ?? null,
    dispatchHistory: args.dispatchHistory,
  });
  const minutesQuiet = getMinutesQuiet(lastObservableSignalAt, now);
  const inferenceFailure = deriveInferenceFailure(args.lastAssistant, lastMeaningfulSignalAt);

  return {
    buildId: args.buildId,
    generatedAt: now.toISOString(),
    statusHeading: {
      operatorAction: describeOperatorAction(blockedTasks.length, failureAxis, args.dbTasks),
      failureAxis,
    },
    progress: {
      primary: args.dbTasks.source,
      conflicts,
    },
    tasks: args.dbTasks,
    staleChatSnapshots: args.chatSnapshots.filter((snapshot) =>
      snapshot.completed != null
      && snapshot.total != null
      && hasStaleTruthConflict({
        newer: args.dbTasks.source,
        older: {
          source: "chat-self-report",
          completed: snapshot.completed,
          total: snapshot.total,
          observedAt: snapshot.observedAt,
        },
      })
    ),
    sandbox: args.sandbox,
    dispatchHistory: args.dispatchHistory,
    verification: args.verification,
    quietAgent: {
      quiet: !hasInflightDispatch(args.dispatchHistory) && minutesQuiet >= 5,
      minutesQuiet,
      lastObservableSignalAt,
      lastMeaningfulSignalAt,
    },
    inferenceFailure,
    dispatchBlock: deriveDispatchBlock(args.dispatchBlock, lastMeaningfulSignalAt),
    engineSelection: args.engineSelection
      ? {
          summary: args.engineSelection.summary,
          observedAt: new Date(args.engineSelection.observedAt).toISOString(),
        }
      : null,
    phaseRuns: args.phaseRuns ?? [],
    evidenceTimeline: args.evidenceTimeline ?? [],
  };
}

/**
 * BI-CE1AB982 — resolve the refused-before-start dispatch signal.
 *
 * Mirrors deriveInferenceFailure's self-clearing rule: a refusal only stands
 * while it is at least as recent as the last meaningful non-chat signal, so a
 * later successful dispatch clears it without anyone having to reset state.
 */
function deriveDispatchBlock(
  input: { reason: string; observedAt: Date | string } | null | undefined,
  lastMeaningfulSignalAt: string | null,
): { blocked: boolean; reason: string | null; observedAt: string | null } {
  const empty = { blocked: false, reason: null, observedAt: null };
  if (!input) return empty;
  const observedAt = new Date(input.observedAt);
  const observedMs = observedAt.getTime();
  if (!Number.isFinite(observedMs)) return empty;
  if (lastMeaningfulSignalAt) {
    const signalMs = new Date(lastMeaningfulSignalAt).getTime();
    if (Number.isFinite(signalMs) && signalMs > observedMs) return empty;
  }
  return {
    blocked: true,
    reason: input.reason,
    observedAt: observedAt.toISOString(),
  };
}

/**
 * BI-F0005EB0 — classify the newest assistant turn. Only reports `failed` when
 * the failing turn is at least as recent as the last meaningful non-chat
 * signal. A newer task result, verification result, or dispatch proves the
 * pipeline moved on; a generic activity row does not.
 */
function deriveInferenceFailure(
  lastAssistant: { content: string | null; createdAt: Date | string | null } | null | undefined,
  lastMeaningfulSignalAt: string | null,
): BuildProgressVisibility["inferenceFailure"] {
  const none: BuildProgressVisibility["inferenceFailure"] = { failed: false, kind: null, observedAt: null };
  if (!lastAssistant) {
    return none;
  }
  const kind = classifyInferenceFailure(lastAssistant.content);
  if (!kind) {
    return none;
  }
  const observedAt = normalizeObservedAt(lastAssistant.createdAt);
  if (
    observedAt != null
    && lastMeaningfulSignalAt != null
    && new Date(lastMeaningfulSignalAt).getTime() > new Date(observedAt).getTime()
  ) {
    // A fresher observable signal superseded the failed turn — not stalled here.
    return { failed: false, kind, observedAt };
  }
  return { failed: true, kind, observedAt };
}

export async function getBuildProgressVisibility(buildId: string): Promise<BuildProgressVisibility | null> {
  const { prisma } = await import("@dpf/db");
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      buildId: true,
      threadId: true,
      taskResults: true,
      updatedAt: true,
      activities: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      },
    },
  });
  if (!build) {
    return null;
  }
  const chatMessages = build.threadId
    ? await prisma.agentMessage.findMany({
      where: {
        threadId: build.threadId,
        role: "assistant",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        role: true,
        content: true,
        createdAt: true,
      },
    })
    : [];

  // EP-COST Phase 3: fetch BuildPhaseRun rows for cost breakdown panel
  const phaseRunRows = await prisma.buildPhaseRun.findMany({
    where: { buildId },
    orderBy: { startedAt: "asc" },
    select: {
      phase: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
      inputTokens: true,
      outputTokens: true,
      costUsd: true,
      inferenceCount: true,
    },
  });
  const phaseRuns: PhaseRunSummary[] = phaseRunRows.map((r) => ({
    phase: r.phase,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd?.toString() ?? null,
    inferenceCount: r.inferenceCount,
  }));

  const evidenceTimeline = await loadBuildEvidenceTimelineEvents({
    db: prisma,
    build: { id: build.id, buildId: build.buildId },
  });

  // chatMessages is ordered createdAt desc, so [0] is the newest assistant turn.
  const newestAssistant = chatMessages[0] ?? null;
  const engineSelectionActivity = await prisma.buildActivity.findFirst({
    where: { buildId, tool: "engine_selection" },
    orderBy: { createdAt: "desc" },
    select: { summary: true, createdAt: true },
  });
  // BI-CE1AB982 — a refused-before-start dispatch leaves no BuildDispatchAttempt
  // row, so its only durable trace is this activity row.
  const dispatchBlockActivity = await prisma.buildActivity.findFirst({
    where: { buildId, tool: "dispatch_blocked" },
    orderBy: { createdAt: "desc" },
    select: { summary: true, createdAt: true },
  });

  return buildProgressProjectionFromParts({
    buildId,
    dbTasks: normalizeTaskResults(build.taskResults),
    chatSnapshots: extractChatProgressSnapshots(chatMessages),
    sandbox: await getSandboxStateForBuild(buildId),
    dispatchHistory: await getDispatchHistoryForBuild(buildId),
    verification: await getScopedVerificationForBuild(buildId),
    lastActivityAt: build.activities[0]?.createdAt.toISOString() ?? build.updatedAt.toISOString(),
    lastAssistant: newestAssistant
      ? { content: newestAssistant.content, createdAt: newestAssistant.createdAt }
      : null,
    phaseRuns,
    evidenceTimeline,
    engineSelection: engineSelectionActivity
      ? { summary: engineSelectionActivity.summary, observedAt: engineSelectionActivity.createdAt }
      : null,
    dispatchBlock: dispatchBlockActivity
      ? { reason: dispatchBlockActivity.summary, observedAt: dispatchBlockActivity.createdAt }
      : null,
  });
}

export function extractChatProgressSnapshots(messages: ChatProgressMessageInput[]): ChatProgressSnapshot[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant") {
      return [];
    }
    const content = message.content?.trim();
    if (!content) {
      return [];
    }
    const match = content.match(/(\d+)\s*(?:\/|of)\s*(\d+)\s+tasks?\b/i);
    if (!match) {
      return [];
    }
    const completed = Number.parseInt(match[1] ?? "", 10);
    const total = Number.parseInt(match[2] ?? "", 10);
    if (!Number.isFinite(completed) || !Number.isFinite(total)) {
      return [];
    }
    if (total <= 0 || completed < 0 || completed > total) {
      return [];
    }

    return [{
      completed,
      total,
      observedAt: normalizeObservedAt(message.createdAt),
      excerpt: content.slice(0, 240),
    }];
  });
}

function getProgressConflicts(
  dbSource: TruthNumericSnapshot,
  chatSnapshots: ChatProgressSnapshot[],
): TruthNumericSnapshot[] {
  return chatSnapshots.flatMap((snapshot) => {
    if (snapshot.completed == null || snapshot.total == null) {
      return [];
    }
    const chatSource: TruthNumericSnapshot = {
      source: "chat-self-report",
      completed: snapshot.completed,
      total: snapshot.total,
      observedAt: snapshot.observedAt,
    };
    return hasStaleTruthConflict({
      staleThresholdMs: BUILD_TRUTH_STALE_THRESHOLD_MS,
      newer: dbSource,
      older: chatSource,
    })
      ? [chatSource]
      : [];
  });
}

function deriveFailureAxis(
  dispatchHistory: BuildDispatchAttemptView[],
  verification: ScopedVerificationView | null,
): BuildFailureAxis | null {
  const failedDispatch = [...dispatchHistory].reverse().find((attempt) => !attempt.success);
  if (failedDispatch) {
    return failedDispatch.failureAxis;
  }
  return verification?.buildScoped.failureAxis ?? null;
}

function describeOperatorAction(
  blockedTaskCount: number,
  failureAxis: BuildFailureAxis | null,
  taskResults: NormalizedTaskResults,
): string {
  if (blockedTaskCount > 0) {
    return `Click Resume to re-execute ${blockedTaskCount} blocked ${blockedTaskCount === 1 ? "task" : "tasks"}`;
  }
  if (failureAxis === "out-of-scope-noise") {
    return "Review workspace noise before retrying this build";
  }
  if (taskResults.totalTasks > 0 && taskResults.completedTasks >= taskResults.totalTasks) {
    return "Run scoped verification for this build";
  }
  return "Monitor build progress";
}

function getLastObservableSignalAt(args: {
  taskResultsAt: string | null;
  verificationAt: string | null;
  dispatchHistory: BuildDispatchAttemptView[];
  lastActivityAt: string | null;
}): string | null {
  const candidates = [
    args.taskResultsAt,
    args.verificationAt,
    args.lastActivityAt,
    ...args.dispatchHistory.flatMap((attempt) => [attempt.completedAt, attempt.startedAt]),
  ];

  return candidates
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

function getLastMeaningfulSignalAt(args: {
  taskResultsAt: string | null;
  verificationAt: string | null;
  dispatchHistory: BuildDispatchAttemptView[];
}): string | null {
  const candidates = [
    args.taskResultsAt,
    args.verificationAt,
    ...args.dispatchHistory.flatMap((attempt) => [attempt.completedAt, attempt.startedAt]),
  ];

  return candidates
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

function normalizeObservedAt(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function hasInflightDispatch(dispatchHistory: BuildDispatchAttemptView[]): boolean {
  const latestStarted = [...dispatchHistory]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  return Boolean(latestStarted && latestStarted.completedAt == null);
}

function getMinutesQuiet(lastObservableSignalAt: string | null, now: Date): number {
  if (!lastObservableSignalAt) {
    return 0;
  }
  const observedMs = new Date(lastObservableSignalAt).getTime();
  if (!Number.isFinite(observedMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - observedMs) / 60_000));
}
