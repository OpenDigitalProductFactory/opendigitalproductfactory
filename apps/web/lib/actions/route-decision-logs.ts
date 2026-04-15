/**
 * EP-INF-001: Route Decision Log data access.
 * Reads RouteDecisionLog rows for the ops UI audit trail.
 */
import { prisma } from "@dpf/db";
import type { CandidateTrace } from "@/lib/routing/types";

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
