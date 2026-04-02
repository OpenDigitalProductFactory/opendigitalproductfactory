// apps/web/lib/orchestrator-evaluator.ts
// Async evaluation engine — grades sub-agent responses and updates performance profiles.
// Called fire-and-forget from the observer pipeline after every sub-agent response.
// Resilient by design: any failure results in a silent return, never a thrown error.

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { routePrimary } from "./agent-router";
import { loadEndpoints } from "./agent-router-data";
import { getTaskType } from "@/lib/task-types";
import { updateEndpointDimensionScores } from "../routing/production-feedback";
import type { SensitivityLevel } from "./agent-router-types";
import type { ChatMessage } from "@/lib/ai-inference";

// ─── Constants ──────────────────────────────────────────────────────────────

const EVALUATION_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_EVALUATIONS = 3;
let activeEvaluations = 0;

const EMA_DECAY = 0.1;
const RECENT_WINDOW = 10;
const REGRESSION_THRESHOLD = 3.0;
const REGRESSION_WINDOW = 5;

// ─── Types ──────────────────────────────────────────────────────────────────

export type EvaluateInput = {
  threadId: string;
  endpointId: string;
  modelId?: string;
  taskType: string;
  userMessage: string;
  aiResponse: string;
  routeContext: string;
  sensitivity?: SensitivityLevel;
};

// ─── Core: evaluateAndUpdateProfile ─────────────────────────────────────────

/**
 * Async, fire-and-forget evaluation of a sub-agent response.
 * Called from the observer pipeline after every response.
 *
 * Steps:
 * 1. Concurrency gate (max 3 concurrent evaluations)
 * 2. Find the orchestrator endpoint (highest-tier via routePrimary)
 * 3. If sub-agent IS the orchestrator, skip LLM evaluation (create record for human feedback)
 * 4. Build evaluation prompt and call the orchestrator
 * 5. Parse score, persist TaskEvaluation, update performance profile
 * 6. On ANY failure, silently return
 */
export async function evaluateAndUpdateProfile(input: EvaluateInput): Promise<void> {
  try {
    // 1. Concurrency gate
    if (activeEvaluations >= MAX_CONCURRENT_EVALUATIONS) return;
    activeEvaluations++;

    try {
      await runEvaluation(input);
    } finally {
      activeEvaluations--;
    }
  } catch {
    // Graceful degradation: swallow all errors
  }
}

async function runEvaluation(input: EvaluateInput): Promise<void> {
  const { threadId, endpointId, taskType, userMessage, aiResponse, routeContext, sensitivity } = input;

  // 2. Load endpoints and find the orchestrator (highest-tier)
  const endpoints = await loadEndpoints();
  const orchestratorRoute = routePrimary(endpoints, sensitivity ?? "internal");
  if (!orchestratorRoute) return; // No orchestrator available

  const orchestratorId = orchestratorRoute.endpointId;

  // 3. If sub-agent IS the orchestrator, skip LLM evaluation — create record for human feedback
  if (endpointId === orchestratorId) {
    await prisma.taskEvaluation.create({
      data: {
        threadId,
        endpointId,
        taskType,
        qualityScore: null,
        evaluationNotes: "Self-evaluation skipped (orchestrator endpoint). Awaiting human feedback.",
        taskContext: userMessage.slice(0, 1000),
        routeContext,
        source: "conversation",
      },
    });
    return;
  }

  // 4. Build evaluation prompt
  const taskDef = getTaskType(taskType);
  const evaluationTokenLimit = taskDef?.evaluationTokenLimit ?? 500;

  const truncatedUser = userMessage.slice(0, 400);
  const truncatedResponse = aiResponse.slice(0, evaluationTokenLimit * 4);

  const evaluationPrompt = [
    "Score this AI response 1-5 on relevance, completeness, and accuracy.",
    "",
    `User asked: ${truncatedUser}`,
    "",
    `AI responded: ${truncatedResponse}`,
    "",
    'Return ONLY a JSON object: { "overall": N, "notes": "one sentence" }',
  ].join("\n");

  const messages: ChatMessage[] = [{ role: "user", content: evaluationPrompt }];

  // 5. Call the orchestrator to evaluate
  const result = await routeAndCall(messages, "You are a quality evaluator. Return only valid JSON.", sensitivity ?? "internal", {
    taskType: "conversation",
    preferredProviderId: orchestratorId,
  });

  // 6. Parse JSON response
  const jsonMatch = result.content.match(/\{[^}]+\}/);
  if (!jsonMatch) return;

  let parsed: { overall: number; notes?: string };
  try {
    parsed = JSON.parse(jsonMatch[0]) as { overall: number; notes?: string };
  } catch {
    return; // Malformed JSON — silent return
  }

  const score = parsed.overall;
  if (typeof score !== "number" || score < 1 || score > 5) return;

  // 7. Persist TaskEvaluation record
  await prisma.taskEvaluation.create({
    data: {
      threadId,
      endpointId,
      taskType,
      qualityScore: score,
      evaluationNotes: parsed.notes?.slice(0, 500) ?? null,
      taskContext: userMessage.slice(0, 1000),
      routeContext,
      source: "conversation",
    },
  });

  // 8. Update performance profile
  await updatePerformanceProfile(endpointId, taskType, score);

  // EP-INF-001-P6: Feed orchestrator score into routing dimension profiles
  await updateEndpointDimensionScores(input.endpointId, input.modelId ?? "", input.taskType, score).catch((err) =>
    console.error("[orchestrator-evaluator] dimension score update failed:", err),
  );
}

// ─── updateHumanScore ───────────────────────────────────────────────────────

/**
 * Updates avgHumanScore on EndpointTaskPerformance using exponential moving average.
 * Called when a human provides a quality rating for a prior evaluation.
 */
export async function updateHumanScore(
  endpointId: string,
  taskType: string,
  score: number,
): Promise<void> {
  try {
    const profile = await prisma.endpointTaskPerformance.findUnique({
      where: { endpointId_taskType: { endpointId, taskType } },
    });

    if (!profile) return;

    const currentAvg = profile.avgHumanScore ?? 0;
    const newAvg = currentAvg === 0
      ? score
      : currentAvg * (1 - EMA_DECAY) + score * EMA_DECAY;

    await prisma.endpointTaskPerformance.update({
      where: { endpointId_taskType: { endpointId, taskType } },
      data: {
        avgHumanScore: newAvg,
        lastEvaluatedAt: new Date(),
      },
    });
  } catch {
    // Graceful degradation: swallow all errors
  }
}

// ─── Synchronous evaluation for test harness ─────────────────────────────────

/**
 * Awaitable variant of evaluation for the test harness.
 * Unlike evaluateAndUpdateProfile (fire-and-forget), this returns the score.
 * Does NOT update performance profile — the test runner handles that separately.
 */
export async function evaluateResponseForTest(input: {
  endpointId: string;
  taskType: string;
  userMessage: string;
  aiResponse: string;
  sensitivity?: SensitivityLevel;
}): Promise<{ score: number; notes: string } | null> {
  try {
    const endpoints = await loadEndpoints();
    const orchestratorRoute = routePrimary(endpoints, input.sensitivity ?? "internal");
    if (!orchestratorRoute) return null;

    if (input.endpointId === orchestratorRoute.endpointId) return null;

    const taskDef = getTaskType(input.taskType);
    const tokenLimit = taskDef?.evaluationTokenLimit ?? 500;

    const evaluationPrompt = [
      "Score this AI response 1-5 on relevance, completeness, and accuracy.",
      "",
      `User asked: ${input.userMessage.slice(0, 400)}`,
      "",
      `AI responded: ${input.aiResponse.slice(0, tokenLimit * 4)}`,
      "",
      'Return ONLY a JSON object: { "overall": N, "notes": "one sentence" }',
    ].join("\n");

    const messages: ChatMessage[] = [{ role: "user", content: evaluationPrompt }];
    const result = await routeAndCall(messages, "You are a quality evaluator. Return only valid JSON.", input.sensitivity ?? "internal", {
      taskType: "conversation",
      preferredProviderId: orchestratorRoute.endpointId,
    });

    const jsonMatch = result.content.match(/\{[^}]+\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { overall: number; notes?: string };
    if (typeof parsed.overall !== "number" || parsed.overall < 1 || parsed.overall > 5) return null;

    return { score: parsed.overall, notes: parsed.notes ?? "" };
  } catch {
    return null;
  }
}

// ─── updatePerformanceProfile (internal) ────────────────────────────────────

/**
 * Updates the EndpointTaskPerformance record with a new orchestrator score.
 *
 * 1. Load the record
 * 2. Increment evaluationCount
 * 3. Update avgOrchestratorScore (EMA, decay 0.1)
 * 4. Increment successCount if score >= 3
 * 5. Update recentScores (sliding window, max 10)
 * 6. Check regression: if avg of last 5 recentScores < 3.0, revert to "learning"
 * 7. Check promotion: learning->practicing (count >= 10, avg >= 3.5),
 *    practicing->innate (count >= 50, avg >= 4.0, success rate >= 0.9)
 * 8. Persist
 */
export async function updatePerformanceProfile(
  endpointId: string,
  taskType: string,
  score: number,
): Promise<void> {
  // 1. Load the record
  const profile = await prisma.endpointTaskPerformance.findUnique({
    where: { endpointId_taskType: { endpointId, taskType } },
  });

  if (!profile) {
    // Lazy create if missing — get default instructions from task type
    const taskDef = getTaskType(taskType);
    const defaultInstructions = taskDef?.defaultInstructions ?? "";

    await prisma.endpointTaskPerformance.create({
      data: {
        endpointId,
        taskType,
        instructionPhase: "learning",
        currentInstructions: defaultInstructions,
        evaluationCount: 1,
        avgOrchestratorScore: score,
        successCount: score >= 3 ? 1 : 0,
        recentScores: [score],
        lastEvaluatedAt: new Date(),
      },
    });
    return;
  }

  // 2. Increment evaluationCount
  const evaluationCount = profile.evaluationCount + 1;

  // 3. Update avgOrchestratorScore (EMA)
  const avgOrchestratorScore =
    profile.avgOrchestratorScore * (1 - EMA_DECAY) + score * EMA_DECAY;

  // 4. Increment successCount if score >= 3
  const successCount = score >= 3 ? profile.successCount + 1 : profile.successCount;

  // 5. Update recentScores (sliding window, max RECENT_WINDOW)
  const recentScores = [...profile.recentScores, score].slice(-RECENT_WINDOW);

  // 6. Check regression
  let instructionPhase = profile.instructionPhase;
  let currentInstructions = profile.currentInstructions;
  let lastInstructionUpdateAt = profile.lastInstructionUpdateAt;

  if (recentScores.length >= REGRESSION_WINDOW) {
    const lastN = recentScores.slice(-REGRESSION_WINDOW);
    const avgLast = lastN.reduce((a, b) => a + b, 0) / lastN.length;
    if (avgLast < REGRESSION_THRESHOLD) {
      // Revert to learning with refreshed instructions
      instructionPhase = "learning";
      const taskDef = getTaskType(taskType);
      if (taskDef) {
        currentInstructions = taskDef.defaultInstructions;
      }
      lastInstructionUpdateAt = new Date();
    }
  }

  // 7. Check promotion (only if not regressed in step 6)
  if (instructionPhase !== "learning" || profile.instructionPhase === "learning") {
    const successRate = evaluationCount > 0 ? successCount / evaluationCount : 0;

    if (instructionPhase === "learning" && evaluationCount >= 10 && avgOrchestratorScore >= 3.5) {
      instructionPhase = "practicing";
      lastInstructionUpdateAt = new Date();
    } else if (
      instructionPhase === "practicing" &&
      evaluationCount >= 50 &&
      avgOrchestratorScore >= 4.0 &&
      successRate >= 0.9
    ) {
      instructionPhase = "innate";
      lastInstructionUpdateAt = new Date();
    }
  }

  // 8. Persist
  await prisma.endpointTaskPerformance.update({
    where: { endpointId_taskType: { endpointId, taskType } },
    data: {
      evaluationCount,
      avgOrchestratorScore,
      successCount,
      recentScores,
      instructionPhase,
      currentInstructions,
      lastEvaluatedAt: new Date(),
      lastInstructionUpdateAt,
    },
  });
}
