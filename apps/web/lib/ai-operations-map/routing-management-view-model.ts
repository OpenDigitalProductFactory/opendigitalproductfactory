import type { RoutingReceipt } from "./routing-management-types";
import type { RoutingScope } from "./routing-management-scope";

/** Replay can pad the window into the future; traffic remains anchored to the server snapshot. */
export function routingEvidenceAnchor(windowEnd: string, observedAt: string): number {
  return Math.min(Date.parse(windowEnd), Date.parse(observedAt));
}

export function filterRoutingReceipts(rows: RoutingReceipt[], scope: RoutingScope, now: number, query = "") {
  const start = now - scope.minutes * 60_000;
  return rows.filter(r => Date.parse(r.occurredAt) >= start && Date.parse(r.occurredAt) <= now
    && (scope.provider === "all" || r.providerId === scope.provider || r.attempts.some(a => a.providerId === scope.provider))
    && (scope.task === "all" || r.task === scope.task)
    && (scope.data === "all" || r.sensitivity === scope.data)
    && [r.id, r.task, r.providerId, r.modelId, r.actorId].join(" ").toLowerCase().includes(query.toLowerCase()));
}

/** Recipe and evaluator stay in the cohort key: unlike runs must not imply a fair comparison. */
export function routingCohorts(rows: RoutingReceipt[]) {
  const groups = new Map<string, RoutingReceipt[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.task, row.providerId, row.modelId, row.recipeKey, row.evaluator]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, cohort]) => {
    const attempts = [...new Map(cohort.flatMap(r => r.attempts.filter(a => a.providerId === r.providerId && a.modelId === r.modelId)).map(a => [a.id, a])).values()];
    const feedback = attempts.filter(a => a.feedback !== null);
    return ({
    key, sample: cohort[0], count: cohort.length,
    knownExecution: cohort.filter(r => ["success", "error", "blocked"].includes(r.selectedExecution)).length,
    successes: cohort.filter(r => r.selectedExecution === "success").length,
    evaluated: cohort.filter(r => r.quality !== null).length,
    feedback,
    humanFeedback: feedback.filter(a => a.feedbackSource === "human"),
    agentFeedback: feedback.filter(a => a.feedbackSource === "agent"),
    unattributedFeedback: feedback.filter(a => !a.feedbackSource),
    feedbackAttemptCount: attempts.length,
    costCovered: cohort.filter(r => r.costUsd !== null).length,
    recordedCost: cohort.reduce((sum,r) => sum + (r.costUsd ?? 0), 0),
  }); });
}
