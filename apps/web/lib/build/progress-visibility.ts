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
  };
  /** Phase-level cost rollup; empty array when BuildPhaseRun rows don't exist yet */
  phaseRuns: PhaseRunSummary[];
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
  phaseRuns?: PhaseRunSummary[];
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
  const minutesQuiet = getMinutesQuiet(lastObservableSignalAt, now);

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
    },
    phaseRuns: args.phaseRuns ?? [],
  };
}

export async function getBuildProgressVisibility(buildId: string): Promise<BuildProgressVisibility | null> {
  const { prisma } = await import("@dpf/db");
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
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

  return buildProgressProjectionFromParts({
    buildId,
    dbTasks: normalizeTaskResults(build.taskResults),
    chatSnapshots: extractChatProgressSnapshots(chatMessages),
    sandbox: await getSandboxStateForBuild(buildId),
    dispatchHistory: await getDispatchHistoryForBuild(buildId),
    verification: await getScopedVerificationForBuild(buildId),
    lastActivityAt: build.activities[0]?.createdAt.toISOString() ?? build.updatedAt.toISOString(),
    phaseRuns,
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
