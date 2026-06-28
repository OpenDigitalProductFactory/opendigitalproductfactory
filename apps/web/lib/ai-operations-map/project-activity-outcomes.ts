import { parseActivityHarnessAudit } from "@/lib/routing/activity-harness-audit";
import type {
  RoutingDecisionSourceRow,
  RoutingRouteOutcomeSourceRow,
  RoutingTokenUsageSourceRow,
} from "./project-routing-topology";
import type {
  OperationsMapActivityOutcome,
  OperationsMapActivitySuccessSignal,
} from "./types";

const MATCH_WINDOW_MS = 5 * 60 * 1000;

type CandidateWithHarness = {
  endpointId?: string;
  providerId?: string;
  modelId?: string;
  activityHarness?: unknown;
};

export type ActivityOutcomeProjectionInput = {
  routeDecisions: RoutingDecisionSourceRow[];
  tokenUsage: RoutingTokenUsageSourceRow[];
  routeOutcomes: RoutingRouteOutcomeSourceRow[];
  evaluationSignals?: ActivityEvaluationSignalSourceRow[];
};

export type ActivityEvaluationSignalSourceRow = {
  routeDecisionId: string;
  activityClass: string;
  signal: OperationsMapActivitySuccessSignal;
  qualityScore: number | null;
  source: string;
  occurredAt: Date;
};

export function projectActivityOutcomes(
  input: ActivityOutcomeProjectionInput,
): OperationsMapActivityOutcome[] {
  return input.routeDecisions.flatMap((decision) => {
    const selectedCandidate = selectedCandidateWithHarness(decision);
    const harness = parseActivityHarnessAudit(selectedCandidate?.activityHarness);
    if (!selectedCandidate || !harness) return [];

    const providerId = selectedCandidate.providerId ?? providerFromEndpoint(decision.selectedEndpointId);
    const modelId = selectedCandidate.modelId ?? decision.selectedModelId;
    const tokenUsage = findMatchingTokenUsage(decision, providerId, input.tokenUsage);
    const routeOutcome = findMatchingRouteOutcome(decision, providerId, modelId, input.routeOutcomes);
    const evaluationSignal = findMatchingEvaluationSignal(
      decision,
      harness.activityClass,
      input.evaluationSignals ?? [],
    );
    const tokenTotal = tokenUsage ? tokenUsage.inputTokens + tokenUsage.outputTokens : null;

    return [{
      id: `activity-outcome:${decision.id}`,
      routeDecisionId: decision.id,
      activityClass: harness.activityClass as OperationsMapActivityOutcome["activityClass"],
      harnessRecipeKey: harness.recipeKey,
      confidence: harness.activityConfidence,
      providerId,
      modelId,
      taskType: decision.taskType,
      tokenTotal,
      costUsd: tokenUsage?.costUsd ?? null,
      successSignal: successSignalFromEvidence(routeOutcome, evaluationSignal),
      qualitySignal: evaluationSignal?.qualityScore ?? null,
      evaluatorSource: evaluationSignal?.source ?? null,
      evidenceStrength: tokenUsage || routeOutcome || evaluationSignal ? "linked" : "route-only",
      occurredAt: decision.createdAt.toISOString(),
    }];
  });
}

function selectedCandidateWithHarness(
  decision: RoutingDecisionSourceRow,
): CandidateWithHarness | null {
  const candidates = parseCandidates(decision.candidateTrace);
  return candidates.find((candidate) => candidate.endpointId === decision.selectedEndpointId) ?? null;
}

function parseCandidates(value: unknown): CandidateWithHarness[] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is CandidateWithHarness => Boolean(item) && typeof item === "object");
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}

function findMatchingTokenUsage(
  decision: RoutingDecisionSourceRow,
  providerId: string,
  usageRows: RoutingTokenUsageSourceRow[],
): RoutingTokenUsageSourceRow | null {
  return usageRows.find((usage) =>
    usage.providerId === providerId &&
    sameActorIfKnown(decision, usage.agentId) &&
    contextMatchesTask(decision, usage.contextKey) &&
    withinWindow(decision.createdAt, usage.createdAt)
  ) ?? null;
}

function findMatchingRouteOutcome(
  decision: RoutingDecisionSourceRow,
  providerId: string,
  modelId: string | null,
  outcomes: RoutingRouteOutcomeSourceRow[],
): RoutingRouteOutcomeSourceRow | null {
  return outcomes.find((outcome) =>
    outcome.providerId === providerId &&
    (!modelId || outcome.modelId === modelId) &&
    outcome.taskType === decision.taskType &&
    sameActorIfKnown(decision, outcome.agentId ?? null) &&
    withinWindow(decision.createdAt, outcome.createdAt)
  ) ?? null;
}

function sameActorIfKnown(
  decision: RoutingDecisionSourceRow,
  rowAgentId: string | null | undefined,
): boolean {
  const decisionAgentId = decision.agentId ?? decision.agentMessageId;
  if (!decisionAgentId || !rowAgentId) return true;
  return decisionAgentId === rowAgentId;
}

function contextMatchesTask(
  decision: RoutingDecisionSourceRow,
  contextKey: string,
): boolean {
  return contextKey === decision.taskType || contextKey.includes(decision.taskType);
}

function withinWindow(decisionAt: Date, rowAt: Date): boolean {
  const delta = rowAt.getTime() - decisionAt.getTime();
  return delta >= 0 && delta <= MATCH_WINDOW_MS;
}

function successSignalFromRouteOutcome(
  outcome: RoutingRouteOutcomeSourceRow | null,
): OperationsMapActivitySuccessSignal {
  if (!outcome) return "unknown";
  if (outcome.providerErrorCode) return "failed";
  if (outcome.fallbackOccurred) return "retried";
  return "valid";
}

function successSignalFromEvidence(
  outcome: RoutingRouteOutcomeSourceRow | null,
  evaluationSignal: ActivityEvaluationSignalSourceRow | null,
): OperationsMapActivitySuccessSignal {
  const routeSignal = successSignalFromRouteOutcome(outcome);
  if (routeSignal === "failed" || routeSignal === "retried") return routeSignal;
  return evaluationSignal?.signal ?? routeSignal;
}

function findMatchingEvaluationSignal(
  decision: RoutingDecisionSourceRow,
  activityClass: string,
  signals: ActivityEvaluationSignalSourceRow[],
): ActivityEvaluationSignalSourceRow | null {
  return signals.find((signal) =>
    signal.routeDecisionId === decision.id &&
    signal.activityClass === activityClass &&
    withinWindow(decision.createdAt, signal.occurredAt)
  ) ?? null;
}

function providerFromEndpoint(endpointId: string): string {
  return endpointId.split(":")[0] || "unrouted";
}
