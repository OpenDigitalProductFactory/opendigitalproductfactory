import { prisma } from "@dpf/db";
import type { EndpointCandidate, SensitivityLevel } from "./agent-router-types";

/** Load all active MCP endpoints from the workforce registry. */
export async function loadEndpoints(): Promise<EndpointCandidate[]> {
  const providers = await prisma.modelProvider.findMany({
    where: { status: { in: ["active", "unconfigured"] } },
    select: {
      providerId: true,
      endpointType: true,
      sensitivityClearance: true,
      capabilityTier: true,
      costBand: true,
      taskTags: true,
      status: true,
    },
  });

  return providers
    .filter((p) => p.status === "active")
    .map((p) => ({
      endpointId: p.providerId,
      endpointType: (p.endpointType ?? "llm") as "llm" | "service",
      sensitivityClearance: (p.sensitivityClearance ?? []) as SensitivityLevel[],
      capabilityTier: (p.capabilityTier ?? "basic") as EndpointCandidate["capabilityTier"],
      costBand: (p.costBand ?? "free") as EndpointCandidate["costBand"],
      taskTags: p.taskTags ?? [],
      status: p.status,
    }));
}

// ─── Performance Profiles ───────────────────────────────────────────────────

export type PerformanceProfile = {
  endpointId: string;
  taskType: string;
  evaluationCount: number;
  avgOrchestratorScore: number;
  avgHumanScore: number | null;
  successCount: number;
  recentScores: number[];
  instructionPhase: string;
  currentInstructions: string | null;
  pinned: boolean;
  blocked: boolean;
};

/** Load performance profiles for a specific task type */
export async function loadPerformanceProfiles(taskType: string): Promise<PerformanceProfile[]> {
  const profiles = await prisma.endpointTaskPerformance.findMany({
    where: { taskType },
    select: {
      endpointId: true,
      taskType: true,
      evaluationCount: true,
      avgOrchestratorScore: true,
      avgHumanScore: true,
      successCount: true,
      recentScores: true,
      instructionPhase: true,
      currentInstructions: true,
      pinned: true,
      blocked: true,
    },
  });
  return profiles;
}

/** Ensure a performance profile exists (lazy creation) */
export async function ensurePerformanceProfile(
  endpointId: string,
  taskType: string,
  defaultInstructions: string,
): Promise<void> {
  await prisma.endpointTaskPerformance.upsert({
    where: { endpointId_taskType: { endpointId, taskType } },
    update: {},
    create: {
      endpointId,
      taskType,
      instructionPhase: "learning",
      currentInstructions: defaultInstructions,
    },
  });
}
