// apps/web/lib/endpoint-test-runner.ts
// Executes capability probes and task scenarios against AI endpoints.

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

export type EndpointTestResult = {
  endpointId: string;
  probes: ProbeRunResult[];
  scenarios: ScenarioRunResult[];
  instructionFollowing: string | null;
  codingCapability: string | null;
};

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
  endpointId: string,
): Promise<ProbeRunResult> {
  try {
    const promptInput: PromptInput = { ...TEST_PROMPT_DEFAULTS, ...probe.promptOverrides };
    const systemPrompt = assembleSystemPrompt(promptInput);

    const messages: ChatMessage[] = [{ role: "user", content: probe.userMessage }];

    const probeToolsFormatted = probe.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const result = await callWithFailover(messages, systemPrompt, promptInput.sensitivity, {
      ...(probeToolsFormatted ? { tools: probeToolsFormatted } : {}),
      modelRequirements: { preferredProviderId: endpointId },
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
  endpointId: string,
): Promise<ScenarioRunResult> {
  try {
    const promptInput: PromptInput = { ...TEST_PROMPT_DEFAULTS, ...scenario.promptOverrides };
    const systemPrompt = assembleSystemPrompt(promptInput);

    const messages: ChatMessage[] = [{ role: "user", content: scenario.userMessage }];

    const scenarioToolsFormatted = scenario.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const result = await callWithFailover(messages, systemPrompt, promptInput.sensitivity, {
      ...(scenarioToolsFormatted ? { tools: scenarioToolsFormatted } : {}),
      modelRequirements: { preferredProviderId: endpointId },
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
        endpointId,
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

// ─── Main Test Runner ────────────────────────────────────────────────────────

export async function runEndpointTests(opts: {
  endpointId?: string;
  taskType?: string;
  probesOnly?: boolean;
  triggeredBy: string;
}): Promise<EndpointTestResult[]> {
  // Resolve endpoints
  const providers = await prisma.modelProvider.findMany({
    where: {
      status: "active",
      endpointType: "llm",
      ...(opts.endpointId ? { providerId: opts.endpointId } : {}),
    },
    select: { providerId: true },
  });

  const results: EndpointTestResult[] = [];

  for (const provider of providers) {
    const eid = provider.providerId;

    // Create test run record
    const runId = `TR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const testRun = await prisma.endpointTestRun.create({
      data: { runId, endpointId: eid, taskType: opts.taskType ?? null, probesOnly: opts.probesOnly ?? false, triggeredBy: opts.triggeredBy },
    });

    // Run probes
    const probeResults: ProbeRunResult[] = [];
    for (const probe of CAPABILITY_PROBES) {
      const result = await runProbe(probe, eid);
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
        const result = await runScenario(scenario, eid);
        scenarioResults.push(result);

        // Record TaskEvaluation for scenarios with orchestrator scores
        if (result.orchestratorScore !== null) {
          await prisma.taskEvaluation.create({
            data: {
              threadId: `test-${testRun.runId}`,
              endpointId: eid,
              taskType: scenario.taskType,
              qualityScore: result.orchestratorScore,
              evaluationNotes: result.assertionResults.map((r) => `${r.passed ? "PASS" : "FAIL"}: ${r.description}`).join("; "),
              taskContext: `TEST: ${scenario.name}`,
              routeContext: scenario.routeContext,
              source: "test_harness",
            },
          });

          // Update performance profile
          await updatePerformanceProfile(eid, scenario.taskType, result.orchestratorScore);
        }
      }
    }

    // Update ModelProfile with evidence
    const instructionFollowing = mapProbeResultsToInstructionFollowing(probePassMap);
    const codeScores = scenarioResults.filter((s) => s.taskType === "code-gen" && s.orchestratorScore !== null).map((s) => s.orchestratorScore!);
    const codingCapability = mapScoresToCodingCapability(codeScores);

    try {
      const profile = await prisma.modelProfile.findFirst({ where: { providerId: eid } });
      if (profile) {
        await prisma.modelProfile.update({
          where: { id: profile.id },
          data: {
            instructionFollowing,
            ...(codingCapability ? { codingCapability } : {}),
          },
        });
      }
    } catch { /* best-effort */ }

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
          probes: probeResults.map((p) => ({ id: p.probeId, category: p.category, name: p.name, pass: p.pass, reason: p.reason })),
          scenarios: scenarioResults.map((s) => ({
            id: s.scenarioId, taskType: s.taskType, name: s.name, passed: s.passed,
            assertions: s.assertionResults, orchestratorScore: s.orchestratorScore,
          })),
        } as unknown as import("@dpf/db").Prisma.InputJsonValue,
      },
    });

    results.push({ endpointId: eid, probes: probeResults, scenarios: scenarioResults, instructionFollowing, codingCapability });
  }

  return results;
}
