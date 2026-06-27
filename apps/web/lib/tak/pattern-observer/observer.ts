import { prisma } from "@dpf/db";

import { submitCoworkerSelfAssessment as defaultSubmitCoworkerSelfAssessment } from "@/lib/coworker-self-assessment/assessment-service";
import type {
  CoworkerAssessmentConfidence,
  CoworkerAssessmentVerdict,
  CoworkerCapabilityNeedInput,
  SubmitCoworkerSelfAssessmentInput,
} from "@/lib/coworker-self-assessment/types";
import {
  assessToolSurface as defaultAssessToolSurface,
  computeToolSelectionAccuracy as defaultComputeToolSelectionAccuracy,
  type ToolCallSample,
  type ToolSelectionAccuracy,
  type ToolSurfaceAssessment,
} from "@/lib/tak/context-economy-metrics";

import {
  classifyGrantDenial,
  classifyRepeatedSuccess,
  classifyToolSurfaceOverload,
} from "./classifiers";
import { capabilityNeedKey, evidenceFingerprint } from "./fingerprint";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TAKE = 200;

export type PatternObserverToolExecutionRow = {
  id?: string | null;
  agentId?: string | null;
  routeContext?: string | null;
  toolName: string;
  success: boolean;
  summary?: string | null;
  result?: unknown;
  parameters?: unknown;
  taskRunId?: string | null;
  createdAt?: Date | null;
};

export type PatternObserverTaskRunRow = {
  taskRunId: string;
  currentAgentId?: string | null;
  initiatingAgentId?: string | null;
  routeContext?: string | null;
  title?: string | null;
  status?: string | null;
  repeatedPatternKey?: string | null;
  a2aMetadata?: unknown;
  createdAt?: Date | null;
  completedAt?: Date | null;
};

type ToolExecutionFindManyArgs = {
  where: Record<string, unknown>;
  orderBy: { createdAt: "desc" };
  take: number;
  select: Record<keyof PatternObserverToolExecutionRow, true>;
};

type TaskRunFindManyArgs = {
  where: Record<string, unknown>;
  orderBy: { createdAt: "desc" };
  take: number;
  select: Record<keyof PatternObserverTaskRunRow, true>;
};

export type PatternObserverDb = {
  toolExecution: {
    findMany(args: ToolExecutionFindManyArgs): Promise<PatternObserverToolExecutionRow[]>;
  };
  taskRun: {
    findMany(args: TaskRunFindManyArgs): Promise<PatternObserverTaskRunRow[]>;
  };
};

export type ObserveCoworkerPatternsInput = {
  agentId: string;
  routeContext?: string | null;
  since?: Date;
  until?: Date;
  windowMs?: number;
  take?: number;
  contextWindowTokens?: number | null;
  toolSurface?: readonly unknown[] | null;
};

export type ObserveCoworkerPatternsResult = {
  processed: number;
  submitted: boolean;
  skippedReason?: "no-signals";
};

export type ObserveCoworkerPatternsDeps = {
  db: PatternObserverDb;
  assessToolSurface: typeof defaultAssessToolSurface;
  computeToolSelectionAccuracy: typeof defaultComputeToolSelectionAccuracy;
  submitCoworkerSelfAssessment: (
    input: SubmitCoworkerSelfAssessmentInput,
  ) => ReturnType<typeof defaultSubmitCoworkerSelfAssessment>;
  now: () => Date;
};

type ObservationWindow = {
  since: Date;
  until: Date;
  windowMs: number;
};

type CandidateNeed = {
  classifier: "grant-denial" | "tool-surface-overload" | "repeated-success";
  need: CoworkerCapabilityNeedInput;
};

type ClassifierSummary = {
  grantDenialCandidates: number;
  toolSurfaceCandidates: number;
  repeatedSuccessCandidates: number;
  duplicateNeedsSuppressed: number;
  submittedNeeds: number;
};

type ManualWorkflowSignal = {
  key: string;
  name: string;
  ceremonyScore: number;
};

function defaultDb(): PatternObserverDb {
  return prisma as unknown as PatternObserverDb;
}

function resolveDeps(deps?: Partial<ObserveCoworkerPatternsDeps>): ObserveCoworkerPatternsDeps {
  return {
    db: deps?.db ?? defaultDb(),
    assessToolSurface: deps?.assessToolSurface ?? defaultAssessToolSurface,
    computeToolSelectionAccuracy:
      deps?.computeToolSelectionAccuracy ?? defaultComputeToolSelectionAccuracy,
    submitCoworkerSelfAssessment:
      deps?.submitCoworkerSelfAssessment ?? defaultSubmitCoworkerSelfAssessment,
    now: deps?.now ?? (() => new Date()),
  };
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveWindow(input: ObserveCoworkerPatternsInput, now: Date): ObservationWindow {
  const until = input.until ?? now;
  const windowMs = finitePositive(input.windowMs, DEFAULT_WINDOW_MS);
  const since = input.since ?? new Date(until.getTime() - windowMs);
  return { since, until, windowMs: Math.max(0, until.getTime() - since.getTime()) };
}

function routeFilter(routeContext: string | null | undefined): Record<string, unknown> {
  return routeContext ? { routeContext } : {};
}

function createdAtFilter(window: ObservationWindow): { gte: Date; lte: Date } {
  return { gte: window.since, lte: window.until };
}

async function loadToolExecutions(
  input: ObserveCoworkerPatternsInput,
  window: ObservationWindow,
  deps: ObserveCoworkerPatternsDeps,
): Promise<PatternObserverToolExecutionRow[]> {
  return deps.db.toolExecution.findMany({
    where: {
      agentId: input.agentId,
      ...routeFilter(input.routeContext),
      createdAt: createdAtFilter(window),
    },
    orderBy: { createdAt: "desc" },
    take: finitePositive(input.take, DEFAULT_TAKE),
    select: {
      id: true,
      agentId: true,
      routeContext: true,
      toolName: true,
      success: true,
      summary: true,
      result: true,
      parameters: true,
      taskRunId: true,
      createdAt: true,
    },
  });
}

async function loadTaskRuns(
  input: ObserveCoworkerPatternsInput,
  window: ObservationWindow,
  deps: ObserveCoworkerPatternsDeps,
): Promise<PatternObserverTaskRunRow[]> {
  return deps.db.taskRun.findMany({
    where: {
      OR: [{ currentAgentId: input.agentId }, { initiatingAgentId: input.agentId }],
      ...routeFilter(input.routeContext),
      createdAt: createdAtFilter(window),
    },
    orderBy: { createdAt: "desc" },
    take: finitePositive(input.take, DEFAULT_TAKE),
    select: {
      taskRunId: true,
      currentAgentId: true,
      initiatingAgentId: true,
      routeContext: true,
      title: true,
      status: true,
      repeatedPatternKey: true,
      a2aMetadata: true,
      createdAt: true,
      completedAt: true,
    },
  });
}

function stringifyEvidence(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function executionText(execution: PatternObserverToolExecutionRow): string {
  return [execution.summary ?? "", stringifyEvidence(execution.result)].join(" ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(source: unknown, field: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberField(source: unknown, field: string): number | null {
  if (!isRecord(source)) return null;
  const value = source[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function capabilityFromText(text: string): string | null {
  const patterns = [
    /\bforbidden[_\s-]?grant[:\s]+([a-z0-9_.:-]+)/i,
    /\bmissing\s+capability\s+([a-z0-9_.:-]+)/i,
    /\brequiredGrant["'\s:]+([a-z0-9_.:-]+)/i,
    /\brequiredCapability["'\s:]+([a-z0-9_.:-]+)/i,
    /\brequiredScope["'\s:]+([a-z0-9_.:-]+)/i,
  ] as const;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

function missingCapabilityFromExecution(execution: PatternObserverToolExecutionRow): string | null {
  const result = isRecord(execution.result) ? execution.result : null;
  return (
    stringField(result, "requiredGrant") ??
    stringField(result, "requiredCapability") ??
    stringField(result, "missingCapability") ??
    stringField(result, "capability") ??
    capabilityFromText(executionText(execution))
  );
}

function groupBy<T>(items: readonly T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }
  return grouped;
}

function toolCallSamples(
  executions: readonly PatternObserverToolExecutionRow[],
): ToolCallSample[] {
  return executions.map((execution) => ({
    toolName: execution.toolName,
    success: execution.success,
  }));
}

function classifyGrantDenials(
  executions: readonly PatternObserverToolExecutionRow[],
): CandidateNeed[] {
  const failuresByTool = groupBy(
    executions.filter((execution) => execution.success === false),
    (execution) => execution.toolName,
  );
  const candidates: CandidateNeed[] = [];

  for (const [toolName, failures] of failuresByTool) {
    const denialMessages = failures.map(executionText).filter(Boolean);
    const missingCapability =
      failures.map(missingCapabilityFromExecution).find((value): value is string => Boolean(value)) ??
      null;
    const need = classifyGrantDenial({
      deniedTool: toolName,
      missingCapability,
      denialMessages,
    });
    if (need) {
      candidates.push({ classifier: "grant-denial", need });
    }
  }

  return candidates;
}

function toolSurfaceFromExecutions(
  executions: readonly PatternObserverToolExecutionRow[],
): readonly unknown[] {
  const names = [...new Set(executions.map((execution) => execution.toolName).filter(Boolean))];
  return names.map((name) => ({ type: "function", function: { name } }));
}

function workflowSignalFromRun(run: PatternObserverTaskRunRow): ManualWorkflowSignal | null {
  if (run.status !== "completed") return null;
  const meta = isRecord(run.a2aMetadata) ? run.a2aMetadata : {};
  const manual = isRecord(meta.manualWorkflow) ? meta.manualWorkflow : {};
  const key =
    stringField(manual, "key") ??
    stringField(meta, "manualWorkflowKey") ??
    stringField(meta, "workflowKey") ??
    run.repeatedPatternKey ??
    null;
  const name =
    stringField(manual, "name") ??
    stringField(meta, "manualWorkflowName") ??
    stringField(meta, "workflowName") ??
    key;
  const ceremonyScore =
    numberField(manual, "ceremonyScore") ??
    numberField(meta, "manualWorkflowCeremonyScore") ??
    numberField(meta, "ceremonyScore");

  if (!key || !name || ceremonyScore === null) return null;
  return { key, name, ceremonyScore };
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function classifyRepeatedManualSuccesses(
  taskRuns: readonly PatternObserverTaskRunRow[],
  executions: readonly PatternObserverToolExecutionRow[],
  computeToolSelectionAccuracy: typeof defaultComputeToolSelectionAccuracy,
): CandidateNeed[] {
  const runsWithWorkflow = taskRuns
    .map((run) => ({ run, workflow: workflowSignalFromRun(run) }))
    .filter((entry): entry is { run: PatternObserverTaskRunRow; workflow: ManualWorkflowSignal } =>
      Boolean(entry.workflow),
    );
  const byWorkflowKey = groupBy(runsWithWorkflow, (entry) => entry.workflow.key);
  const candidates: CandidateNeed[] = [];

  for (const [, entries] of byWorkflowKey) {
    const taskRunIds = new Set(entries.map((entry) => entry.run.taskRunId));
    const relatedExecutions = executions.filter(
      (execution) => execution.taskRunId && taskRunIds.has(execution.taskRunId),
    );
    const accuracy: ToolSelectionAccuracy = computeToolSelectionAccuracy(
      toolCallSamples(relatedExecutions),
    );
    const need = classifyRepeatedSuccess({
      workflowName: entries[0]?.workflow.name ?? "manual",
      repetitionCount: entries.length,
      ceremonyScore: average(entries.map((entry) => entry.workflow.ceremonyScore)),
      accuracy,
    });
    if (need) {
      candidates.push({ classifier: "repeated-success", need });
    }
  }

  return candidates;
}

function enrichNeed(
  input: ObserveCoworkerPatternsInput,
  candidate: CandidateNeed,
): CoworkerCapabilityNeedInput {
  const evidence = {
    classifier: candidate.classifier,
    ...(candidate.need.evidenceJson ?? {}),
  };
  const needKey = capabilityNeedKey(input.agentId, candidate.need.kind, candidate.need.need);
  const fingerprint = evidenceFingerprint({
    agentId: input.agentId,
    routeContext: input.routeContext ?? null,
    kind: candidate.need.kind,
    need: candidate.need.need,
    evidence,
  });

  return {
    ...candidate.need,
    evidenceJson: {
      ...evidence,
      capabilityNeedKey: needKey,
      evidenceFingerprint: fingerprint,
    },
  };
}

function dedupeCandidates(
  input: ObserveCoworkerPatternsInput,
  candidates: readonly CandidateNeed[],
): { needs: CoworkerCapabilityNeedInput[]; duplicateNeedsSuppressed: number } {
  const needKeys = new Set<string>();
  const fingerprints = new Set<string>();
  const needs: CoworkerCapabilityNeedInput[] = [];
  let duplicateNeedsSuppressed = 0;

  for (const candidate of candidates) {
    const need = enrichNeed(input, candidate);
    const needKey = String(need.evidenceJson?.capabilityNeedKey ?? "");
    const fingerprint = String(need.evidenceJson?.evidenceFingerprint ?? "");
    if (needKeys.has(needKey) || fingerprints.has(fingerprint)) {
      duplicateNeedsSuppressed += 1;
      continue;
    }
    needKeys.add(needKey);
    fingerprints.add(fingerprint);
    needs.push(need);
  }

  return { needs, duplicateNeedsSuppressed };
}

function taskRunOutcomes(taskRuns: readonly PatternObserverTaskRunRow[]): Record<string, number> {
  const outcomes: Record<string, number> = {};
  for (const run of taskRuns) {
    const status = run.status ?? "unknown";
    outcomes[status] = (outcomes[status] ?? 0) + 1;
  }
  return outcomes;
}

function confidenceForNeeds(
  needs: readonly CoworkerCapabilityNeedInput[],
): CoworkerAssessmentConfidence {
  return needs.some((need) => need.severity === "blocker" || need.severity === "important")
    ? "high"
    : "medium";
}

function verdictForNeeds(needs: readonly CoworkerCapabilityNeedInput[]): CoworkerAssessmentVerdict {
  return needs.some((need) => need.severity === "blocker") ? "blocked" : "gaps";
}

function rawPayload(input: {
  routeContext?: string | null;
  window: ObservationWindow;
  toolExecutions: readonly PatternObserverToolExecutionRow[];
  taskRuns: readonly PatternObserverTaskRunRow[];
  toolSurfaceAssessment: ToolSurfaceAssessment;
  toolSelectionAccuracy: ToolSelectionAccuracy;
  classifierSummary: ClassifierSummary;
  needs: readonly CoworkerCapabilityNeedInput[];
}): Record<string, unknown> {
  return {
    observer: "systemic-coworker-pattern-observer",
    window: {
      since: input.window.since.toISOString(),
      until: input.window.until.toISOString(),
      windowMs: input.window.windowMs,
      routeContext: input.routeContext ?? null,
    },
    evidenceDigest: {
      toolExecutionCount: input.toolExecutions.length,
      failedToolExecutionCount: input.toolExecutions.filter((execution) => !execution.success)
        .length,
      taskRunCount: input.taskRuns.length,
      taskRunOutcomes: taskRunOutcomes(input.taskRuns),
      contextEconomy: {
        toolSurfaceAssessment: input.toolSurfaceAssessment,
        toolSelectionAccuracy: input.toolSelectionAccuracy,
      },
    },
    classifierSummary: input.classifierSummary,
    capabilityNeedKeys: input.needs.map((need) => need.evidenceJson?.capabilityNeedKey),
    evidenceFingerprints: input.needs.map((need) => need.evidenceJson?.evidenceFingerprint),
  };
}

export async function observeCoworkerPatterns(
  input: ObserveCoworkerPatternsInput,
  deps?: Partial<ObserveCoworkerPatternsDeps>,
): Promise<ObserveCoworkerPatternsResult> {
  const resolved = resolveDeps(deps);
  const window = resolveWindow(input, resolved.now());
  const [toolExecutions, taskRuns] = await Promise.all([
    loadToolExecutions(input, window, resolved),
    loadTaskRuns(input, window, resolved),
  ]);

  const toolSurface = input.toolSurface ?? toolSurfaceFromExecutions(toolExecutions);
  const toolSurfaceAssessment = resolved.assessToolSurface({
    tools: toolSurface,
    windowTokens: input.contextWindowTokens ?? null,
  });
  const toolSelectionAccuracy = resolved.computeToolSelectionAccuracy(
    toolCallSamples(toolExecutions),
  );

  const grantCandidates = classifyGrantDenials(toolExecutions);
  const toolSurfaceNeed = classifyToolSurfaceOverload(toolSurfaceAssessment);
  const toolSurfaceCandidates: CandidateNeed[] = toolSurfaceNeed
    ? [{ classifier: "tool-surface-overload", need: toolSurfaceNeed }]
    : [];
  const repeatedSuccessCandidates = classifyRepeatedManualSuccesses(
    taskRuns,
    toolExecutions,
    resolved.computeToolSelectionAccuracy,
  );

  const allCandidates = [
    ...grantCandidates,
    ...toolSurfaceCandidates,
    ...repeatedSuccessCandidates,
  ];
  const { needs, duplicateNeedsSuppressed } = dedupeCandidates(input, allCandidates);
  const classifierSummary: ClassifierSummary = {
    grantDenialCandidates: grantCandidates.length,
    toolSurfaceCandidates: toolSurfaceCandidates.length,
    repeatedSuccessCandidates: repeatedSuccessCandidates.length,
    duplicateNeedsSuppressed,
    submittedNeeds: needs.length,
  };

  if (needs.length === 0) {
    return { processed: 0, submitted: false, skippedReason: "no-signals" };
  }

  await resolved.submitCoworkerSelfAssessment({
    agentId: input.agentId,
    trigger: "pattern-observer",
    routeContext: input.routeContext ?? null,
    verdict: verdictForNeeds(needs),
    confidence: confidenceForNeeds(needs),
    missionSummary: `Observed ${needs.length} systemic coworker pattern need(s).`,
    capabilitySummary: needs.map((need) => need.need).join("; "),
    rawPayload: rawPayload({
      routeContext: input.routeContext,
      window,
      toolExecutions,
      taskRuns,
      toolSurfaceAssessment,
      toolSelectionAccuracy,
      classifierSummary,
      needs,
    }),
    needs: [...needs],
  });

  return { processed: needs.length, submitted: true };
}
