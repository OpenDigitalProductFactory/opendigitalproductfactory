// apps/web/lib/endpoint-test-runner.ts
// Executes capability probes and task scenarios against individual AI models.
// Tests run per-model (providerId + modelId), not per-provider.

import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { assembleSystemPrompt, type PromptInput } from "@/lib/prompt-assembler";
import { evaluateResponseForTest, updatePerformanceProfile } from "@/lib/orchestrator-evaluator";
import {
  CAPABILITY_PROBES,
  TASK_SCENARIOS,
  TEST_PROMPT_DEFAULTS,
  checkScenarioAssertions,
  type CapabilityProbe,
  type TestScenario,
} from "./endpoint-test-registry";
import { callProvider, type ChatMessage } from "@/lib/ai-inference";
import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";

/** A capacity deferral is the host declining to schedule, not the model failing. */
export function isCapacityDeferral(err: unknown): boolean {
  if (err instanceof LocalProviderCapacityDeferredError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /dispatch deferred|capacity reservation/i.test(message);
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Probe outcomes distinguish a model that FAILED a capability check from a
 * probe that never reached the model (BI-91F0E312). Capacity deferral — the
 * local-integration-ci lease holding the GPU, including a lease claimed
 * mid-run — is a scheduling fact about the host, not evidence about the model.
 */
export type ProbeOutcome = "passed" | "failed" | "deferred";

export type ProbeRunResult = {
  probeId: string;
  category: string;
  name: string;
  /** Back-compat alias of outcome === "passed"; deferred reads as false here. */
  pass: boolean;
  /** True/false verdicts only; null when the probe never reached the model. */
  passed: boolean | null;
  outcome: ProbeOutcome;
  reason: string;
};

export type ScenarioRunResult = {
  scenarioId: string;
  taskType: string;
  name: string;
  /** Back-compat alias of outcome === "passed"; deferred reads as false here. */
  passed: boolean;
  outcome: ProbeOutcome;
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
  modelId: string,
): Promise<ProbeRunResult> {
  try {
    const promptInput: PromptInput = { ...TEST_PROMPT_DEFAULTS, ...probe.promptOverrides };
    const systemPrompt = await assembleSystemPrompt(promptInput);

    const messages: ChatMessage[] = [{ role: "user", content: probe.userMessage }];

    const probeToolsFormatted = probe.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

    // Resolves BI-INST-007: probes used routeAndCall, which requires
    // active endpoint manifests in EndpointTaskPerformance. Probes are
    // SUPPOSED to be the thing that creates those manifests — a
    // chicken-and-egg that broke every fresh-install probe with
    // "No eligible endpoints for task 'conversation'" before any model
    // had ever been profiled. Since the probe runner already knows both
    // providerId AND modelId (it's testing a SPECIFIC model), there's no
    // routing decision to make — call the model directly.
    const result = await callProvider(
      providerId,
      modelId,
      messages,
      systemPrompt,
      probeToolsFormatted,
    );

    // Extract tool calls from response
    const toolCalls = result.toolCalls as unknown[] | undefined;

    const assertionResult = probe.assert(result.content, toolCalls);
    return {
      probeId: probe.id, category: probe.category, name: probe.name,
      ...assertionResult,
      passed: assertionResult.pass,
      outcome: assertionResult.pass ? "passed" as const : "failed" as const,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (isCapacityDeferral(err)) {
      return {
        probeId: probe.id, category: probe.category, name: probe.name,
        pass: false, passed: null, outcome: "deferred",
        reason: `Deferred: ${message}`,
      };
    }
    return {
      probeId: probe.id, category: probe.category, name: probe.name,
      pass: false, passed: false, outcome: "failed",
      reason: `Error: ${message}`,
    };
  }
}

// ─── Scenario Runner ─────────────────────────────────────────────────────────

async function runScenario(
  scenario: TestScenario,
  providerId: string,
  modelId: string,
): Promise<ScenarioRunResult> {
  try {
    const promptInput: PromptInput = { ...TEST_PROMPT_DEFAULTS, ...scenario.promptOverrides };
    const systemPrompt = await assembleSystemPrompt(promptInput);

    const messages: ChatMessage[] = [{ role: "user", content: scenario.userMessage }];

    const scenarioToolsFormatted = scenario.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

    // BI-INST-007: same direct-call rationale as runProbe — scenario runner
    // already targets a specific providerId+modelId, no routing needed.
    const result = await callProvider(
      providerId,
      modelId,
      messages,
      systemPrompt,
      scenarioToolsFormatted,
    );

    const toolCalls = (result as unknown as Record<string, unknown>).toolCalls as unknown[] | undefined;

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
      outcome: allPassed ? "passed" : "failed",
      assertionResults: assertionResults.map((r) => ({ description: r.assertion.description, passed: r.passed, detail: r.detail })),
      orchestratorScore, response: result.content,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (isCapacityDeferral(err)) {
      return {
        scenarioId: scenario.id, taskType: scenario.taskType, name: scenario.name,
        passed: false, outcome: "deferred",
        assertionResults: [{ description: "Execution", passed: false, detail: `Deferred: ${message}` }],
        orchestratorScore: null, response: "",
      };
    }
    return {
      scenarioId: scenario.id, taskType: scenario.taskType, name: scenario.name,
      passed: false, outcome: "failed",
      assertionResults: [{ description: "Execution", passed: false, detail: `Error: ${message}` }],
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
  // Get active LLM provider IDs first (ModelProfile has no FK to ModelProvider)
  const activeProviders = await prisma.modelProvider.findMany({
    where: {
      status: "active",
      endpointType: "llm",
      ...(opts.endpointId ? { providerId: opts.endpointId } : {}),
    },
    select: { providerId: true },
  });
  const activeProviderIds = activeProviders.map((p) => p.providerId);

  // Resolve models to test — iterate over ModelProfile records (providerId + modelId pairs)
  const modelProfiles: Array<{ id: string; providerId: string; modelId: string; friendlyName: string }> = [];
  if (activeProviderIds.length > 0) {
    const profiles = await prisma.modelProfile.findMany({
      where: {
        providerId: { in: activeProviderIds },
        ...(opts.modelId ? { modelId: opts.modelId } : {}),
      },
      select: { id: true, providerId: true, modelId: true, friendlyName: true },
      orderBy: [{ providerId: "asc" }, { modelId: "asc" }],
    });
    modelProfiles.push(...profiles);
  }

  // If no model profiles found, fall back to provider-level (for providers without profiles)
  if (modelProfiles.length === 0 && opts.endpointId && activeProviderIds.includes(opts.endpointId)) {
    modelProfiles.push({ id: "", providerId: opts.endpointId, modelId: "default", friendlyName: opts.endpointId });
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

    // Run probes against this model's provider via V2 routing with preferred provider bias.
    const probeResults: ProbeRunResult[] = [];
    for (const probe of CAPABILITY_PROBES) {
      const result = await runProbe(probe, providerId, modelId);
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
        const result = await runScenario(scenario, providerId, modelId);
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

    // BI-91F0E312: a run with any deferred probe/scenario is INCOMPLETE — it
    // never observed the model on that surface. An incomplete run must not
    // write model evidence: no avgScore, no ModelProfile capability fields.
    // Recording it as completed-with-failures is how an idle GPU lease turned
    // into "toolFidelity: insufficient" on a model that tool-calls correctly.
    const probesDeferred = probeResults.filter((p) => p.outcome === "deferred").length;
    const scenariosDeferred = scenarioResults.filter((s) => s.outcome === "deferred").length;
    const runIncomplete = probesDeferred > 0 || scenariosDeferred > 0;

    const instructionFollowing = runIncomplete ? null : mapProbeResultsToInstructionFollowing(probePassMap);
    const codeScores = scenarioResults.filter((s) => s.taskType === "code-gen" && s.orchestratorScore !== null).map((s) => s.orchestratorScore!);
    const codingCapability = runIncomplete ? null : mapScoresToCodingCapability(codeScores);

    if (model.id && !runIncomplete && instructionFollowing) {
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

    // Update test run record. Deferred probes/scenarios count as neither
    // passed nor failed; their counts live in the results payload.
    const scoredScenarios = scenarioResults.filter((s) => s.orchestratorScore !== null);
    await prisma.endpointTestRun.update({
      where: { id: testRun.id },
      data: {
        probesPassed: probeResults.filter((p) => p.outcome === "passed").length,
        probesFailed: probeResults.filter((p) => p.outcome === "failed").length,
        scenariosPassed: scenarioResults.filter((s) => s.outcome === "passed").length,
        scenariosFailed: scenarioResults.filter((s) => s.outcome === "failed").length,
        avgScore: !runIncomplete && scoredScenarios.length > 0
          ? scoredScenarios.reduce((sum, s) => sum + s.orchestratorScore!, 0) / scoredScenarios.length
          : null,
        completedAt: new Date(),
        status: runIncomplete ? "incomplete" : "completed",
        results: {
          modelId,
          friendlyName,
          probesDeferred,
          scenariosDeferred,
          probes: probeResults.map((p) => ({ id: p.probeId, category: p.category, name: p.name, pass: p.pass, passed: p.passed, outcome: p.outcome, reason: p.reason })),
          scenarios: scenarioResults.map((s) => ({
            id: s.scenarioId, taskType: s.taskType, name: s.name, passed: s.passed, outcome: s.outcome,
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
): Promise<{ verified: number; passed: number; failed: number; deferred: number }> {
  const results = await runEndpointTests({
    endpointId: providerId,
    probesOnly: true,
    triggeredBy,
  });

  let passed = 0;
  let failed = 0;
  let deferred = 0;
  for (const r of results) {
    // A model whose probes were capacity-deferred is unverified, not failed —
    // reporting it as failed is the BI-91F0E312 conflation.
    if (r.probes.some((p) => p.outcome === "deferred")) deferred++;
    else if (r.probes.every((p) => p.outcome === "passed")) passed++;
    else failed++;
  }

  return { verified: results.length, passed, failed, deferred };
}
