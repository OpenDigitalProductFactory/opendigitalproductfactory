/**
 * EP-INF-001: Route Decision Log data access.
 * Reads RouteDecisionLog rows for the ops UI audit trail.
 */
import { prisma } from "@dpf/db";
import type { CandidateTrace } from "@/lib/routing/types";
import type { InferenceDataScreenReceipt } from "@/lib/inference/data-screening/types";
import type { ProviderSuitabilityRouteReceipt } from "@/lib/routing/provider-suitability/evidence";
import {
  rollUpProviderRoutingTelemetry,
  type ProviderRoutingTelemetryRollup,
} from "@/lib/inference/provider-routing-rollup";

export interface RouteDecisionLogRow {
  id: string;
  agentMessageId: string | null;
  selectedEndpointId: string;
  selectedModelId: string | null;
  taskType: string;
  sensitivity: string;
  reason: string;
  fitnessScore: number | null;
  candidateTrace: CandidateTrace[];
  excludedTrace: CandidateTrace[];
  policyRulesApplied: string[];
  fallbackChain: string[];
  shadowMode: boolean;
  suitabilityReceipt: ProviderSuitabilityRouteReceipt | null;
  inferenceDataScreenReceipt: InferenceDataScreenReceipt | null;
  createdAt: Date;
}

export interface RouteDecisionStats {
  total: number;
  uniqueTaskTypes: number;
  uniqueModels: number;
  avgFitnessScore: number;
}

export async function getRouteDecisionLogs(limit = 100): Promise<RouteDecisionLogRow[]> {
  const rows = await prisma.routeDecisionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((r) => ({
    id: r.id,
    agentMessageId: r.agentMessageId,
    selectedEndpointId: r.selectedEndpointId,
    selectedModelId: r.selectedModelId,
    taskType: r.taskType,
    sensitivity: r.sensitivity,
    reason: r.reason,
    fitnessScore: r.fitnessScore,
    candidateTrace: (r.candidateTrace as unknown as CandidateTrace[]) ?? [],
    excludedTrace: (r.excludedTrace as unknown as CandidateTrace[]) ?? [],
    policyRulesApplied: r.policyRulesApplied,
    fallbackChain: r.fallbackChain,
    shadowMode: r.shadowMode,
    suitabilityReceipt: r.suitabilityReceipt as ProviderSuitabilityRouteReceipt | null,
    inferenceDataScreenReceipt: r.inferenceDataScreenReceipt as InferenceDataScreenReceipt | null,
    createdAt: r.createdAt,
  }));
}

export async function getRouteDecisionStats(): Promise<RouteDecisionStats> {
  const [total, rows] = await Promise.all([
    prisma.routeDecisionLog.count(),
    prisma.routeDecisionLog.findMany({
      select: { taskType: true, selectedModelId: true, fitnessScore: true },
    }),
  ]);

  const uniqueTaskTypes = new Set(rows.map((r) => r.taskType)).size;
  const uniqueModels = new Set(rows.map((r) => r.selectedModelId).filter(Boolean)).size;
  const scoredRows = rows.filter((r) => r.fitnessScore !== null);
  const avgFitnessScore =
    scoredRows.length > 0
      ? scoredRows.reduce((sum, r) => sum + (r.fitnessScore as number), 0) / scoredRows.length
      : 0;

  return { total, uniqueTaskTypes, uniqueModels, avgFitnessScore };
}

export async function getProviderSuitabilityTelemetryRollup(
  minimumCohortSize = 5,
): Promise<ProviderRoutingTelemetryRollup> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.routeDecisionLog.findMany({
    where: { createdAt: { gte: since }, suitabilityReceipt: { not: { equals: null } } },
    select: {
      selectedEndpointId: true,
      selectedModelId: true,
      suitabilityReceipt: true,
    },
    take: 5_000,
  });
  return rollUpProviderRoutingTelemetry(rows.flatMap((row) => {
    const receipt = row.suitabilityReceipt as ProviderSuitabilityRouteReceipt | null;
    if (!receipt || receipt.schemaVersion !== "provider-suitability-route-receipt/v1") return [];
    return [{
      providerId: receipt.selectedProviderId,
      modelId: row.selectedModelId ?? "unrecorded-model",
      activityClass: receipt.activityClass ?? "unclassified-activity",
      workloadClasses: receipt.workloadClasses,
      outcome: row.selectedEndpointId === "none" ? "excluded" as const : "selected" as const,
    }];
  }), { minimumCohortSize });
}
