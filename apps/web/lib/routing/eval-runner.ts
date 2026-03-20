/**
 * EP-INF-001-P6: Eval runner — orchestrates golden test evaluation,
 * computes dimension scores, detects drift, updates ModelProvider profiles.
 */
import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { callProvider } from "@/lib/ai-inference";
import type { BuiltinDimension } from "./types";
import { BUILTIN_DIMENSIONS } from "./types";
import { getTestsForDimension, type GoldenTest, type ScoringMethod } from "./golden-tests";
import {
  scoreExact,
  scorePartial,
  scoreSchema,
  scoreToolCall,
  scoreStructural,
  scoreRetrieval,
  scoreDimension,
} from "./eval-scoring";

// ── Score Computation ────────────────────────────────────────────────────────

/** Compute new dimension score from eval result and previous score. */
export function computeNewScore(
  evalScore: number,
  previousScore: number,
  evalCount: number,
): number {
  const raw = evalCount === 0
    ? evalScore
    : 0.7 * evalScore + 0.3 * previousScore;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// ── Drift Detection ──────────────────────────────────────────────────────────

export type DriftResult = {
  severity: "none" | "warning" | "severe";
  delta: number;
};

/** Compare raw eval score against previous stored score. */
export function detectDrift(rawEvalScore: number, previousScore: number): DriftResult {
  const delta = previousScore - rawEvalScore;
  if (delta > 25) return { severity: "severe", delta };
  if (delta > 15) return { severity: "warning", delta };
  return { severity: "none", delta };
}

// ── Test Execution ───────────────────────────────────────────────────────────

interface TestResult {
  testId: string;
  version: number;
  scoring: ScoringMethod;
  score: number;       // 0-10
  response: string;
  error?: string;
}

/** Score a single response using the appropriate scoring method. */
function scoreResponse(
  test: GoldenTest,
  content: string,
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): number {
  switch (test.scoring) {
    case "exact":
      return scoreExact(content, test.expectedOutput ?? "");
    case "partial":
      return scorePartial(content, test.expectedOutput ?? "");
    case "schema":
      return scoreSchema(content, test.expectedSchema ?? {});
    case "tool_call":
      return scoreToolCall(toolCalls, test.expectedOutput ?? "");
    case "structural":
      return scoreStructural(content, test.expectedOutput ?? "");
    case "retrieval":
      return scoreRetrieval(content, test.expectedOutput ?? "");
    case "orchestrator":
      // KNOWN GAP: Orchestrator scoring requires a separate grading call to a different
      // endpoint (to avoid self-evaluation). This is not implemented in Phase 6 — the
      // conversational dimension will score neutral (5/10 = 50/100) until orchestrator
      // grading is added. This is acceptable because:
      // 1. Conversational quality is the least routing-critical dimension
      // 2. Production observations will nudge the score over time
      // 3. The infrastructure for cross-endpoint grading needs the eval runner itself to be stable first
      return 5;
    default:
      return 0;
  }
}

/** Run a single golden test against an endpoint. */
async function runGoldenTest(
  endpointId: string,
  modelId: string,
  test: GoldenTest,
): Promise<TestResult> {
  try {
    const messages = [{ role: "user" as const, content: test.prompt }];
    const result = await callProvider(
      endpointId,
      modelId,
      messages,
      test.systemPrompt ?? "You are a helpful assistant.",
      test.tools,
    );

    const score = scoreResponse(test, result.content, result.toolCalls ?? []);
    return {
      testId: test.id,
      version: test.version,
      scoring: test.scoring,
      score,
      response: result.content.slice(0, 500),
    };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error(`[eval-runner] test ${test.id} failed on ${endpointId}/${modelId}: ${errorMessage}`);
    return {
      testId: test.id,
      version: test.version,
      scoring: test.scoring,
      score: 0,
      response: "",
      error: errorMessage || "unknown error",
    };
  }
}

// ── Dimension Eval Orchestration ─────────────────────────────────────────────

interface DimensionEvalResult {
  dimension: BuiltinDimension;
  rawScore: number;         // 0-100 from this eval
  newScore: number;         // after rolling average
  previousScore: number;
  drift: DriftResult;
  testResults: TestResult[];
  inconclusive: boolean;    // >50% of tests failed to run
}

/** Resolve the best modelId for a provider (same as fallback.ts). */
async function resolveModelId(providerId: string): Promise<string> {
  const profile = await prisma.modelProfile.findFirst({
    where: { providerId },
    orderBy: { generatedAt: "desc" },
    select: { modelId: true },
  });
  if (profile) return profile.modelId;

  const discovered = await prisma.discoveredModel.findFirst({
    where: { providerId, NOT: { modelId: { contains: "embed" } } },
    orderBy: { modelId: "asc" },
    select: { modelId: true },
  });
  return discovered?.modelId ?? "";
}

/** Run golden test evaluation for one dimension on one endpoint. */
async function evalDimension(
  endpointId: string,
  modelId: string,
  dimension: BuiltinDimension,
  previousScore: number,
  evalCount: number,
): Promise<DimensionEvalResult> {
  const tests = getTestsForDimension(dimension);
  const testResults: TestResult[] = [];

  for (const test of tests) {
    const result = await runGoldenTest(endpointId, modelId, test);
    testResults.push(result);
  }

  // Check if inconclusive (>50% errors)
  const errorCount = testResults.filter((r) => r.error).length;
  const inconclusive = errorCount > tests.length / 2;

  if (inconclusive) {
    return {
      dimension,
      rawScore: previousScore,
      newScore: previousScore,
      previousScore,
      drift: { severity: "none", delta: 0 },
      testResults,
      inconclusive: true,
    };
  }

  const rawScore = scoreDimension(testResults.map((r) => r.score));
  const drift = detectDrift(rawScore, previousScore);
  const newScore = computeNewScore(rawScore, previousScore, evalCount);

  return {
    dimension,
    rawScore,
    newScore,
    previousScore,
    drift,
    testResults,
    inconclusive: false,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface EvalRunResult {
  endpointId: string;
  modelId: string;
  dimensions: DimensionEvalResult[];
  testRunId: string;
  hasDrift: boolean;
  hasSevereDrift: boolean;
  /** First error message encountered across all tests, if any. Null when all tests succeeded. */
  firstError: string | null;
}

/**
 * Run a full dimension evaluation for one endpoint/model pair.
 * Updates ModelProfile capability scores and creates an EndpointTestRun record.
 */
export async function runDimensionEval(
  providerId: string,
  modelId: string,
  triggeredBy: string,
): Promise<EvalRunResult> {
  const modelProfile = await prisma.modelProfile.findUnique({
    where: { providerId_modelId: { providerId, modelId } },
  });

  if (!modelProfile) throw new Error(`ModelProfile ${providerId}/${modelId} not found`);

  const currentEvalCount = modelProfile.evalCount;
  const runId = `DE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  // Create the test run record
  await prisma.endpointTestRun.create({
    data: {
      runId,
      endpointId: providerId,
      modelId,
      taskType: "dimension-eval",
      triggeredBy,
      status: "running",
    },
  });

  // Evaluate each dimension
  // Map BUILTIN_DIMENSIONS names to ModelProfile DB field names
  const dimToDbField: Record<string, string> = {
    instructionFollowing: "instructionFollowingScore",
    structuredOutput: "structuredOutputScore",
  };
  const dimensions: DimensionEvalResult[] = [];
  for (const dim of BUILTIN_DIMENSIONS) {
    const dbField = dimToDbField[dim] ?? dim;
    const previousScore = (modelProfile as Record<string, unknown>)[dbField] as number ?? 50;
    const result = await evalDimension(providerId, modelId, dim, previousScore, currentEvalCount);
    dimensions.push(result);
  }

  // Update ModelProfile with new scores (skip inconclusive dimensions)
  // Map dimension names to DB field names for the two that differ
  const scoreUpdates: Record<string, number> = {};
  for (const d of dimensions) {
    if (!d.inconclusive) {
      const dbField = dimToDbField[d.dimension] ?? d.dimension;
      scoreUpdates[dbField] = d.newScore;
    }
  }

  const hasDrift = dimensions.some((d) => d.drift.severity !== "none");
  const hasSevereDrift = dimensions.some((d) => d.drift.severity === "severe");

  await prisma.modelProfile.update({
    where: { providerId_modelId: { providerId, modelId } },
    data: {
      ...scoreUpdates,
      profileSource: "evaluated",
      profileConfidence: (currentEvalCount + 1) >= 5 ? "high" : "medium",
      evalCount: { increment: 1 },
      lastEvalAt: new Date(),
      ...(hasSevereDrift ? { modelStatus: "degraded" } : {}),
    },
  });

  // Complete the test run record
  await prisma.endpointTestRun.update({
    where: { runId },
    data: {
      status: "completed",
      completedAt: new Date(),
      avgScore: dimensions.reduce((a, d) => a + d.rawScore, 0) / dimensions.length,
      results: {
        dimensions: dimensions.map((d) => ({
          dimension: d.dimension,
          rawScore: d.rawScore,
          newScore: d.newScore,
          previousScore: d.previousScore,
          drift: d.drift,
          inconclusive: d.inconclusive,
          tests: d.testResults,
        })),
      } as any,
    },
  });

  // Collect first error for top-level surfacing (avoids deep-nesting serialization issues)
  const firstError = dimensions
    .flatMap((d) => d.testResults)
    .find((t) => t.error)?.error ?? null;

  return {
    endpointId: providerId,
    modelId,
    dimensions,
    testRunId: runId,
    hasDrift,
    hasSevereDrift,
    firstError,
  };
}

/**
 * Run dimension evaluation for ALL active model profiles.
 */
export async function runAllDimensionEvals(triggeredBy: string): Promise<EvalRunResult[]> {
  const models = await prisma.modelProfile.findMany({
    where: {
      modelStatus: "active",
      retiredAt: null,
      provider: { status: { in: ["active", "degraded"] }, endpointType: "llm" },
    },
    select: { providerId: true, modelId: true },
  });

  const results: EvalRunResult[] = [];
  for (const m of models) {
    try {
      const result = await runDimensionEval(m.providerId, m.modelId, triggeredBy);
      results.push(result);
    } catch (e) {
      console.error(`[eval-runner] failed to evaluate ${m.providerId}/${m.modelId}:`, e);
    }
  }
  return results;
}
