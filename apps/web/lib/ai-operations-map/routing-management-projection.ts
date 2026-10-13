import { isRecord } from "@/lib/shared/coerce";
import { parseActivityHarnessAudit } from "@/lib/routing/activity-harness-audit";
import { projectSafeInferenceScreenReceipt } from "./routing-evidence-loader-projection";
import type { RoutingEvidenceAdapterRunRow, RoutingEvidenceOutcomeRow, RoutingEvidenceTokenUsageRow } from "./routing-evidence-conformance";
import type { RoutingDecisionSourceRow } from "./project-routing-topology";
import type { RoutingManagementData, RoutingReceipt, RoutingHold } from "./routing-management-types";

/** Presentation grouping only. The recorded exclusion remains the routing authority. */
export function routingHold(value: string): RoutingHold {
  if (/operator|paused-by|manual.pause/i.test(value)) return "operator";
  if (/payment|billing|credit|insufficient.fund|402/i.test(value)) return "payment";
  if (/context|token.limit|token.budget|context.length/i.test(value)) return "tokens";
  if (/clearance|sensitivity|policy|local.only|data.boundary/i.test(value)) return "policy";
  if (/quota|rate.limit|cooldown|exhaust|429/i.test(value)) return "quota";
  if (/disable|unconfigured/i.test(value)) return "disabled";
  if (/auth|sign.in|credential|401/i.test(value)) return "authentication";
  if (/capacity|unavailable/i.test(value)) return "capacity";
  return "other";
}

function records(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
const text = (value: unknown) => typeof value === "string" ? value : null;
const finite = (value: unknown): number | null => value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const sumKnown = (values: Array<number | null>) => values.length > 0 && values.every(v => v !== null) ? values.reduce<number>((sum, v) => sum + v!, 0) : null;

/** Allowlist only: never spread decisions, adapter rows, JSON traces or vendor payloads. */
export function projectRoutingManagement(input: {
  decisions: Array<RoutingDecisionSourceRow & { traceId: string | null; inferenceDataScreenReceipt?: unknown }>;
  attempts: Array<Omit<RoutingEvidenceAdapterRunRow, "estimatedCostUsd"> & { estimatedCostUsd: unknown; quotaPoolConsumed?: string | null; userAccepted?: boolean | null; errorClass?: string | null; httpStatus?: number | null }>;
  outcomes: RoutingEvidenceOutcomeRow[];
  usage: RoutingEvidenceTokenUsageRow[];
  models: RoutingManagementData["models"];
  controls?: RoutingManagementData["controls"];
}): RoutingManagementData {
  const traceCounts = new Map<string, number>();
  for (const d of input.decisions) if (d.traceId?.trim()) traceCounts.set(d.traceId, (traceCounts.get(d.traceId) ?? 0) + 1);
  const endpoint = new Map(input.models.map(m => [m.endpointId, m]));
  const receipts = input.decisions.map((d): RoutingReceipt => {
    const correlation = !d.traceId?.trim() ? "missing" : traceCounts.get(d.traceId) === 1 ? "exact" : "ambiguous";
    const candidates = records(d.candidateTrace);
    const selected = candidates.find(c => c.endpointId === d.selectedEndpointId);
    const model = endpoint.get(d.selectedEndpointId);
    const knownProviderIds = new Set([...input.models.map(m => m.providerId), ...(input.controls ?? []).map(c => c.providerId)]);
    const prefix = d.selectedEndpointId.split(":")[0];
    const providerId = model?.providerId ?? text(selected?.providerId) ?? (knownProviderIds.has(prefix) ? prefix : null);
    const harness = parseActivityHarnessAudit(selected?.activityHarness);
    const rawAttempts = correlation === "exact" ? input.attempts.filter(a => a.traceId === d.traceId).sort((a,b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id)) : [];
    const outcomes = correlation === "exact" ? input.outcomes.filter(o => o.traceId === d.traceId).sort((a,b) => a.createdAt.getTime() - b.createdAt.getTime()) : [];
    const usage = correlation === "exact" ? input.usage.filter(u => u.traceId === d.traceId) : [];
    const attempts = rawAttempts.map(a => ({
      id: a.id, providerId: a.providerId, modelId: a.modelId, channel: a.quotaPoolConsumed ?? a.adapterKind,
      status: ["success", "refusal", "error", "timeout", "cancelled", "policy-block"].includes(a.status) ? a.status : "unknown",
      startedAt: a.startedAt.toISOString(), durationMs: finite(a.durationMs), estimatedCostUsd: finite(a.estimatedCostUsd),
      inputTokens: finite(a.inputTokens), outputTokens: finite(a.outputTokens), feedback: typeof a.userAccepted === "boolean" ? a.userAccepted : null,
      hold: a.status === "policy-block" ? "policy" as const : a.status === "success" ? null : routingHold(`${a.errorClass ?? ""} ${a.httpStatus ?? ""}`),
    }));
    const exclusions = [...records(d.excludedTrace), ...candidates.filter(c => c.excluded === true)].map(c => ({
      providerId: text(c.providerId) ?? endpoint.get(text(c.endpointId) ?? "")?.providerId ?? null,
      modelId: text(c.modelId), hold: routingHold(text(c.excludedReason) ?? text(c.reason) ?? "unknown"),
    }));
    const uniqueExclusions = exclusions.filter((e,i) => exclusions.findIndex(o => o.providerId === e.providerId && o.modelId === e.modelId && o.hold === e.hold) === i);
    const screen = projectSafeInferenceScreenReceipt(d.inferenceDataScreenReceipt);
    const execution = attempts.at(-1)?.status === "success" ? "success"
      : outcomes.length > 0 ? outcomes.at(-1)!.providerErrorCode ? "error" : "success"
      : screen?.routeEffect === "block" ? "blocked"
      : attempts.some(a => a.status === "policy-block") ? "blocked"
      : attempts.some(a => ["error", "timeout", "refusal", "cancelled"].includes(a.status)) ? "error" : "unknown";
    const selectedAttempts = attempts.filter(a => a.providerId === providerId && a.modelId === (model?.modelId ?? d.selectedModelId));
    const selectedOutcome = outcomes.filter(o => o.providerId === providerId && o.modelId === (model?.modelId ?? d.selectedModelId)).at(-1);
    const selectedExecution = selectedAttempts.at(-1)?.status === "success" ? "success"
      : selectedOutcome ? selectedOutcome.providerErrorCode ? "error" : "success"
      : selectedAttempts.some(a => a.status === "policy-block") ? "blocked"
      : selectedAttempts.some(a => ["error", "timeout", "refusal", "cancelled"].includes(a.status)) ? "error" : "unknown";
    const pricedRows = usage.length > 0 ? usage : outcomes;
    return {
      id: d.id, occurredAt: d.createdAt.toISOString(), actorId: d.agentId, task: d.taskType, sensitivity: d.sensitivity,
      providerId, modelId: model?.modelId ?? d.selectedModelId, endpointId: d.selectedEndpointId, correlation, screen,
      exclusions: uniqueExclusions, attempts, execution, selectedExecution, shadowMode: d.shadowMode,
      costUsd: sumKnown(pricedRows.map(r => finite(r.costUsd))), tokens: sumKnown(pricedRows.map(r => finite(r.inputTokens) !== null && finite(r.outputTokens) !== null ? r.inputTokens + r.outputTokens : null)),
      costSource: usage.length ? "token-usage" : outcomes.length ? "route-outcome" : null,
      sourceIds: [...rawAttempts.map(a => a.id), ...outcomes.map(o => o.id), ...usage.map(u => u.id)],
      recipeKey: harness?.recipeKey ?? null, evaluator: harness?.evaluator ?? null, quality: null,
    };
  }).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
  return { observedAt: new Date().toISOString(), receipts, models: input.models.map(m => ({ endpointId: m.endpointId, providerId: m.providerId, modelId: m.modelId, label: m.label, status: m.status })), controls: input.controls ?? [] };
}
