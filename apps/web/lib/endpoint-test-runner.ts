// apps/web/lib/endpoint-test-runner.ts
// Executes capability probes and task scenarios against individual AI models.
// Tests run per-model (providerId + modelId), not per-provider.

import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { callWithFailover } from "./ai-provider-priority";
import { assembleSystemPrompt, type PromptInput } from "./prompt-assembler";
import { evaluateResponseForTest, updatePerformanceProfile } from "./orchestrator-evaluator";
import {
  CAPABILITY_PROBES,
  TASK_SCENARIOS,
  TEST_PROMPT_DEFAULTS,
  checkScenarioAssertions,
  type CapabilityProbe,
  type TestScenario,
} from "./endpoint-test-registry";
import type { ChatMessage } from "./ai-inference";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProbeRunResult = {
  probeId: string;
  category: string;
  name: string;
  pass: boolean;
  reason: string;
};

export type ScenarioRunResult = {
  scenarioId: string;
  taskType: string;
  name: string;
  passed: boolean;
  assertionResults: Array<{ description: string; passed: boolean; detail: string }>;
  orchestratorScore: number | null;
  response: string;
};

export type ModelTestResult = {
  providerId: string;
  modelId: string;
  friendlyName: string;
  probes: ProbeRunResult[];
  scenarios: ScenarioRunResult[];
  instructionFollowing: string | null;
  codingCapability: string | null;
};

// Keep backward compat alias
export type EndpointTestResult = ModelTestResult & { endpointId: string };

// ─── Evidence Mapping (exported for testing) ─────────────────────────────────

export function mapProbeResultsToInstructionFollowing(
  probePassMap: Record<string, boolean>,
): "excellent" | "adequate" | "insufficient" {
  const instructionPass = probePassMap["instruction-compliance-advise-mode"] ?? false;
  const toolPass = probePassMap["tool-calling-basic"] ?? false;
  const narrationPass = probePassMap["no-narration"] ?? false;

  if (instructionPass && toolPass && narrationPass) return "excellent";
  if (instructionPass) return "adequate";
  return "insufficient";
}

export function mapScoresToCodingCapability(
  scores: number[],
): "excellent" | "adequate" | "insufficient" | null {
  if (scores.length === 0) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 4.0) return "excellent";
  if (avg >= 3.0) return "adequate";
  return "insufficient";
}

// ─── Probe Runner ────────────────────────────────────────────────────────────

async function runProbe(
  probe: CapabilityProbe,
  providerId: string,
): Promise<ProbeRunResult> {
  try {
    const promptInput: PromptInput = { ...TEST_PROMPT_DEFAULTS, ...probe.promptOverrides };
    const systemPrompt = assembleSystemPrompt(promptInput);

    const messages: ChatMessage[] = [{ role: "user", content: probe.userMessage }];

    const probeToolsFormatted = probe.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const result = await callWithFailover(messages, systemPrompt, promptInput.sensitivity, {
      ...(probeToolsFormatted ? { tools: probeToolsFormatted } : {}),
      modelRequirements: { preferredProviderId: providerId },
    });

    // Detect failover — if a different endpoint answered, mark as infrastructure failure
    if (result.downgraded) {
      return { probeId: probe.id, category: probe.category, name: probe.name, pass: false, reason: "Endpoint unavailable — response came from fallback provider." };
    }

    // Extract tool calls from response (provider-specific parsing)
    const toolCalls = (result as Record<string, unknown>).toolCalls as unknown[] | undefined;

    const assertionResult = probe.assert(result.content, toolCalls);
    return { probeId: probe.id, category: probe.category, name: probe.name, ...assertionResult };
  } catch (err) {
    return { probeId: probe.id, category: probe.category, name: probe.name, pass: false, reason: `Error: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

// ─── Scenario Runner ─────────────────────────────────────────────────────────

async function runScenario(
  scenario: TestScenario,
  providerId: string,
): Promise<ScenarioRunResult> {
  try {
    const promptInput: PromptInput = { ...TEST_PROMPT_DEFAULTS, ...scenario.promptOverrides };
    const systemPrompt = assembleSystemPrompt(promptInput);

    const messages: ChatMessage[] = [{ role: "user", content: scenario.userMessage }];

    const scenarioToolsFormatted = scenario.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const result = await callWithFailover(messages, systemPrompt, promptInput.sensitivity, {
      ...(scenarioToolsFormatted ? { tools: scenarioToolsFormatted } : {}),
      modelRequirements: { preferredProviderId: providerId },
    });

    if (result.downgraded) {
      return {
        scenarioId: scenario.id, taskType: scenario.taskType, name: scenario.name,
        passed: false, assertionResults: [{ description: "Endpoint available", passed: false, detail: "Failover detected" }],
        orchestratorScore: null, response: result.content,
      };
    }

    const toolCalls = (result as Record<string, unknown>).toolCalls as unknown[] | undefined;

    // Check programmatic assertions
    const assertionResults = checkScenarioAssertions(result.content, toolCalls, scenario.assertions);

    // Check orchestrator score if any assertion requires it
    let orchestratorScore: number | null = null;
    const scoreAssertions = scenario.assertions.filter((a) => a.type === "orchestrator_score_gte");
    if (scoreAssertions.length > 0) {
      const evalResult = await evaluateResponseForTest({
        endpointId: providerId,
        taskType: scenario.taskType,
        userMessage: scenario.userMessage,
        aiResponse: result.content,
      });
      if (evalResult) {
        orchestratorScore = evalResult.score;
        for (const sa of scoreAssertions) {
          assertionResults.push({
            assertion: sa,
            passed: evalResult.score >= Number(sa.value),
            detail: `Orchestrator score ${evalResult.score} >= ${sa.value}: ${evalResult.score >= Number(sa.value)}`,
          });
        }
      }
    }

    const allPassed = assertionResults.every((r) => r.passed);

    return {
      scenarioId: scenario.id, taskType: scenario.taskType, name: scenario.name,
      passed: allPassed,
      assertionResults: assertionResults.map((r) => ({ description: r.assertion.description, passed: r.passed, detail: r.detail })),
      orchestratorScore, response: result.content,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id, taskType: scenario.taskType, name: scenario.name,
      passed: false, assertionResults: [{ description: "Execution", passed: false, detail: `Error: ${err instanceof Error ? err.message : "unknown"}` }],
      orchestratorScore: null, response: "",
    };
  }
}

// ─── Main Test Runner (model-level) ──────────────────────────────────────────

export async function runEndpointTests(opts: {
  endpointId?: string;
  modelId?: string;
  taskType?: string;
  probesOnly?: boolean;
  triggeredBy: string;
}): Promise<EndpointTestResult[]> {
  // Resolve models to test — iterate over ModelProfile records (providerId + modelId pairs)
  const modelProfiles = await prisma.modelProfile.findMany({
    where: {
      ...(opts.endpointId ? { providerId: opts.endpointId } : {}),
      ...(opts.modelId ? { modelId: opts.modelId } : {}),
      // Only test models from active LLM providers
      provider: { status: "active", endpointType: "llm" },
    },
    select: { id: true, providerId: true, modelId: true, friendlyName: true },
    orderBy: [{ providerId: "asc" }, { modelId: "asc" }],
  });

  // If no model profiles found, fall back to provider-level (for providers without profiles)
  if (modelProfiles.length === 0 && opts.endpointId) {
    const provider = await prisma.modelProvider.findUnique({
      where: { providerId: opts.endpointId, status: "active", endpointType: "llm" },
      select: { providerId: true },
    });
    if (provider) {
      modelProfiles.push({ id: "", providerId: provider.providerId, modelId: "default", friendlyName: provider.providerId });
    }
  }

  const results: EndpointTestResult[] = [];

  for (const model of modelProfiles) {
    const { providerId, modelId, friendlyName } = model;

    // Create test run record (now includes modelId)
    const runId = `TR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const testRun = await prisma.endpointTestRun.create({
      data: {
        runId,
        endpointId: providerId,
        modelId,
        taskType: opts.taskType ?? null,
        probesOnly: opts.probesOnly ?? false,
        triggeredBy: opts.triggeredBy,
      },
    });

    // Run probes against this model's provider
    // Note: callWithFailover targets the provider; within a provider, it uses the
    // model resolved from the priority list. For single-model providers (most cases),
    // this is deterministic. For multi-model providers (Ollama), the top-ranked model
    // is used. Future: pass modelId directly to force a specific model.
    const probeResults: ProbeRunResult[] = [];
    for (const probe of CAPABILITY_PROBES) {
      const result = await runProbe(probe, providerId);
      probeResults.push(result);
    }

    const probePassMap: Record<string, boolean> = {};
    for (const pr of probeResults) {
      probePassMap[pr.probeId] = pr.pass;
    }

    // Run scenarios (unless probesOnly)
    const scenarioResults: ScenarioRunResult[] = [];
    if (!opts.probesOnly) {
      const eligibleScenarios = (opts.taskType
        ? TASK_SCENARIOS.filter((s) => s.taskType === opts.taskType)
        : TASK_SCENARIOS
      ).filter((s) => s.requiredProbes.every((rp) => probePassMap[rp]));

      for (const scenario of eligibleScenarios) {
        const result = await runScenario(scenario, providerId);
        scenarioResults.push(result);

        // Record TaskEvaluation for scenarios with orchestrator scores
        if (result.orchestratorScore !== null) {
          await prisma.taskEvaluation.create({
            data: {
              threadId: `test-${testRun.runId}`,
              endpointId: providerId,
              taskType: scenario.taskType,
              qualityScore: result.orchestratorScore,
              evaluationNotes: result.assertionResults.map((r) => `${r.passed ? "PASS" : "FAIL"}: ${r.description}`).join("; "),
              taskContext: `TEST: ${scenario.name} [${friendlyName}]`,
              routeContext: scenario.routeContext,
              source: "test_harness",
            },
          });

          // Update performance profile
          await updatePerformanceProfile(providerId, scenario.taskType, result.orchestratorScore);
        }
      }
    }

    // Update this specific ModelProfile with evidence
    const instructionFollowing = mapProbeResultsToInstructionFollowing(probePassMap);
    const codeScores = scenarioResults.filter((s) => s.taskType === "code-gen" && s.orchestratorScore !== null).map((s) => s.orchestratorScore!);
    const codingCapability = mapScoresToCodingCapability(codeScores);

    if (model.id) {
      try {
        await prisma.modelProfile.update({
          where: { id: model.id },
          data: {
            instructionFollowing,
            ...(codingCapability ? { codingCapability } : {}),
          },
        });
      } catch { /* best-effort */ }
    }

    // Update test run record
    await prisma.endpointTestRun.update({
      where: { id: testRun.id },
      data: {
        probesPassed: probeResults.filter((p) => p.pass).length,
        probesFailed: probeResults.filter((p) => !p.pass).length,
        scenariosPassed: scenarioResults.filter((s) => s.passed).length,
        scenariosFailed: scenarioResults.filter((s) => !s.passed).length,
        avgScore: scenarioResults.filter((s) => s.orchestratorScore !== null).length > 0
          ? scenarioResults.filter((s) => s.orchestratorScore !== null).reduce((sum, s) => sum + s.orchestratorScore!, 0) / scenarioResults.filter((s) => s.orchestratorScore !== null).length
          : null,
        completedAt: new Date(),
        status: "completed",
        results: {
          modelId,
          friendlyName,
          probes: probeResults.map((p) => ({ id: p.probeId, category: p.category, name: p.name, pass: p.pass, reason: p.reason })),
          scenarios: scenarioResults.map((s) => ({
            id: s.scenarioId, taskType: s.taskType, name: s.name, passed: s.passed,
            assertions: s.assertionResults, orchestratorScore: s.orchestratorScore,
          })),
        } as unknown as import("@dpf/db").Prisma.InputJsonValue,
      },
    });

    results.push({
      endpointId: providerId,
      providerId,
      modelId,
      friendlyName,
      probes: probeResults,
      scenarios: scenarioResults,
      instructionFollowing,
      codingCapability,
    });
  }

  return results;
}

// ─── Convenience: verify models after profiling ──────────────────────────────

/**
 * Run probes against all profiled models for a provider.
 * Designed to be called after profileModels() in the provider setup flow.
 * Returns a summary suitable for the wizard UI.
 */
export async function verifyModels(
  providerId: string,
  triggeredBy: string,
): Promise<{ verified: number; passed: number; failed: number }> {
  const results = await runEndpointTests({
    endpointId: providerId,
    probesOnly: true,
    triggeredBy,
  });

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const allPass = r.probes.every((p) => p.pass);
    if (allPass) passed++;
    else failed++;
  }

  return { verified: results.length, passed, failed };
}
