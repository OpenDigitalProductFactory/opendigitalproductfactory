import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma, mockCallProvider, mockGrade, mockPerformanceUpdate } = vi.hoisted(() => ({
  mockPrisma: {
    modelProvider: { findMany: vi.fn() },
    modelProfile: { findMany: vi.fn(), update: vi.fn() },
    endpointTestRun: { create: vi.fn(), update: vi.fn() },
    taskEvaluation: { create: vi.fn() },
  },
  mockCallProvider: vi.fn(),
  mockGrade: vi.fn(),
  mockPerformanceUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/ai-inference", () => ({ callProvider: mockCallProvider }));
vi.mock("@/lib/prompt-assembler", () => ({
  assembleSystemPrompt: vi.fn().mockResolvedValue("system"),
  // Enumerated so this mock does not break the day this path assembles with
  // provenance — a factory mock fails on the first unlisted export.
  assembleSystemPromptWithProvenance: vi.fn().mockResolvedValue({
    text: "system",
    instructionSpans: [],
  }),
}));
vi.mock("@/lib/orchestrator-evaluator", () => ({
  evaluateResponseForTest: mockGrade,
  updatePerformanceProfile: mockPerformanceUpdate,
}));

import { CAPABILITY_PROBES, checkScenarioAssertions } from "./endpoint-test-registry";
import { InferenceError } from "@/lib/routing/inference-error";
import { currentInferenceSignal, withInferenceCancellation } from "@/lib/routing/governed-inference-deadline";
import { acquireInferenceSlot, __resetInferenceAdmissionForTest } from "@/lib/inference/inference-admission";
import {
  isCapacityDeferral,
  mapProbeResultsToInstructionFollowing,
  mapScoresToCodingCapability,
  runEndpointTests,
} from "./endpoint-test-runner";

describe("selected local concurrency diagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInferenceAdmissionForTest();
    vi.stubEnv("DPF_INFERENCE_MAX_CONCURRENCY_LOCAL", "1");
    mockPrisma.modelProvider.findMany.mockResolvedValue([{ providerId: "local" }]);
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      { id: "mp1", providerId: "local", modelId: "selected", friendlyName: "Selected model" },
    ]);
    mockPrisma.endpointTestRun.create.mockResolvedValue({ id: "etr1" });
    mockPrisma.endpointTestRun.update.mockResolvedValue({});
  });
  afterEach(() => { __resetInferenceAdmissionForTest(); vi.unstubAllEnvs(); });

  it("runs exactly two ordinary calls and persists their answers and actual queued handoff without quality writes", async () => {
    mockCallProvider.mockImplementation(async () => {
      const release = await acquireInferenceSlot("local", "interactive");
      try {
        await new Promise(resolve => setTimeout(resolve, 5));
        return { content: "READY", inputTokens: 2, outputTokens: 1, inferenceMs: 1,
          truncated: false, raw: { choices: [{ finish_reason: "stop" }] } };
      } finally { release(); }
    });
    const results = await runEndpointTests({ endpointId: "local", modelId: "selected",
      concurrencyOnly: true, triggeredBy: "test" });
    expect(mockCallProvider).toHaveBeenCalledTimes(2);
    expect(results[0]?.concurrency?.outcome).toBe("passed");
    expect(results[0]?.probes).toEqual([]);
    const data = mockPrisma.endpointTestRun.update.mock.calls[0]![0].data;
    expect(data.status).toBe("completed");
    expect(data.results.concurrency.callers.map((c: { content: string }) => c.content)).toEqual(["READY", "READY"]);
    expect(data.results.concurrency.contentionObserved).toBe(true);
    expect(data.results.concurrency.events.some((e: { phase: string }) => e.phase === "queued")).toBe(true);
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
    expect(mockPrisma.taskEvaluation.create).not.toHaveBeenCalled();
    expect(mockPerformanceUpdate).not.toHaveBeenCalled();
  });

  it("persists incomplete output as unverified while preserving content and finish reason", async () => {
    mockCallProvider.mockResolvedValue({ content: "partial", inputTokens: 2, outputTokens: 512,
      inferenceMs: 1, truncated: true, raw: { choices: [{ finish_reason: "length" }] } });
    const results = await runEndpointTests({ endpointId: "local", modelId: "selected",
      concurrencyOnly: true, triggeredBy: "test" });
    expect(mockCallProvider).toHaveBeenCalledTimes(2);
    expect(results[0]?.concurrency?.outcome).toBe("deferred");
    const data = mockPrisma.endpointTestRun.update.mock.calls[0]![0].data;
    expect(data.status).toBe("incomplete");
    expect(data.results.concurrency.callers[0]).toMatchObject({ content: "partial", finishReason: "length", outputTokens: 512 });
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
  });

  it.each([
    { endpointId: "local" }, { modelId: "selected" },
    { endpointId: "openai", modelId: "selected" },
    { endpointId: "local", modelId: "default" },
    { endpointId: "local", modelId: "selected", taskType: "code-gen" },
    { endpointId: "local", modelId: "selected", probesOnly: true },
  ])("rejects an incompatible selection before writes or inference: %j", async selection => {
    await expect(runEndpointTests({ ...selection, concurrencyOnly: true, triggeredBy: "test" })).rejects.toThrow(/Concurrency diagnostics/);
    expect(mockPrisma.endpointTestRun.create).not.toHaveBeenCalled();
    expect(mockCallProvider).not.toHaveBeenCalled();
  });
});

describe("checkScenarioAssertions", () => {
  it("passes contains assertion", () => {
    const results = checkScenarioAssertions("Hello world", undefined, [
      { type: "contains", value: "world", description: "test" },
    ]);
    expect(results[0]?.passed).toBe(true);
  });
  it("fails not_contains assertion", () => {
    const results = checkScenarioAssertions("I will now do something", undefined, [
      { type: "not_contains", value: "I will now", description: "test" },
    ]);
    expect(results[0]?.passed).toBe(false);
  });
  it("passes max_length assertion", () => {
    const results = checkScenarioAssertions("Short", undefined, [
      { type: "max_length", value: 100, description: "test" },
    ]);
    expect(results[0]?.passed).toBe(true);
  });
});

describe("mapProbeResultsToInstructionFollowing", () => {
  it("returns excellent when all key probes pass", () => {
    const probes = {
      "tool-calling-basic": true,
      "instruction-compliance-advise-mode": true,
      "no-narration": true,
    };
    expect(mapProbeResultsToInstructionFollowing(probes)).toBe("excellent");
  });
  it("returns adequate when instruction compliance passes but tool calling fails", () => {
    const probes = {
      "tool-calling-basic": false,
      "instruction-compliance-advise-mode": true,
    };
    expect(mapProbeResultsToInstructionFollowing(probes)).toBe("adequate");
  });
  it("returns insufficient when instruction compliance fails", () => {
    const probes = {
      "instruction-compliance-advise-mode": false,
    };
    expect(mapProbeResultsToInstructionFollowing(probes)).toBe("insufficient");
  });
});

describe("isCapacityDeferral", () => {
  it("recognizes the local capacity deferral error text", () => {
    expect(isCapacityDeferral(new Error(
      "Local provider dispatch deferred: local-ci-active-capacity-reservation",
    ))).toBe(true);
    expect(isCapacityDeferral(new Error(
      "Local provider dispatch deferred: local-ci-queued-capacity-reservation",
    ))).toBe(true);
  });

  it("does not classify model failures as deferrals", () => {
    expect(isCapacityDeferral(new Error("model_not_found from provider"))).toBe(false);
    expect(isCapacityDeferral(new Error("The operation was aborted due to timeout"))).toBe(false);
  });
});

// BI-91F0E312 — a capacity-deferred probe is not a failed probe, and a run
// containing one is incomplete: no avgScore, no ModelProfile writes.
describe("runEndpointTests — capacity deferral (BI-91F0E312)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.modelProvider.findMany.mockResolvedValue([{ providerId: "local" }]);
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      { id: "mp1", providerId: "local", modelId: "qwen3.8-27b", friendlyName: "Qwen 3.8 27B" },
    ]);
    mockPrisma.endpointTestRun.create.mockResolvedValue({ id: "etr1", runId: "TR-TEST0001" });
    mockPrisma.endpointTestRun.update.mockResolvedValue({});
    mockPrisma.modelProfile.update.mockResolvedValue({});
  });

  it("records deferred probes as deferred (passed: null), marks the run incomplete, and writes no model evidence", async () => {
    mockCallProvider.mockRejectedValue(
      new Error("Local provider dispatch deferred: local-ci-active-capacity-reservation"),
    );

    const results = await runEndpointTests({
      endpointId: "local",
      modelId: "qwen3.8-27b",
      probesOnly: true,
      triggeredBy: "test",
    });

    const probes = results[0]!.probes;
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      expect(probe.outcome).toBe("deferred");
      expect(probe.passed).toBeNull();
      expect(probe.reason).toContain("Deferred");
    }
    // No capability verdict from a run that never reached the model.
    expect(results[0]!.instructionFollowing).toBeNull();
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();

    const runUpdate = mockPrisma.endpointTestRun.update.mock.calls[0]![0].data;
    expect(runUpdate.status).toBe("incomplete");
    expect(runUpdate.avgScore).toBeNull();
    expect(runUpdate.probesFailed).toBe(0);
    expect(runUpdate.probesPassed).toBe(0);
    expect(runUpdate.results.probesDeferred).toBe(probes.length);
    const recordedProbe = runUpdate.results.probes[0];
    expect(recordedProbe.passed).toBeNull();
    expect(recordedProbe.outcome).toBe("deferred");
  });

  it("still records genuine failures as failed with passed=false and completes the run", async () => {
    mockCallProvider.mockRejectedValue(new Error("model_not_found from provider"));

    const results = await runEndpointTests({
      endpointId: "local",
      modelId: "qwen3.8-27b",
      probesOnly: true,
      triggeredBy: "test",
    });

    for (const probe of results[0]!.probes) {
      expect(probe.outcome).toBe("failed");
      expect(probe.passed).toBe(false);
    }
    // A genuinely failing model DOES get a verdict.
    expect(results[0]!.instructionFollowing).toBe("insufficient");
    expect(mockPrisma.modelProfile.update).toHaveBeenCalled();

    const runUpdate = mockPrisma.endpointTestRun.update.mock.calls[0]![0].data;
    expect(runUpdate.status).toBe("completed");
    expect(runUpdate.probesFailed).toBeGreaterThan(0);
    expect(runUpdate.results.probes[0].passed).toBe(false);
  });

  it("populates passed=true on passing probes", async () => {
    // A response that satisfies at least one probe's assertion; others may fail,
    // but every probe must carry a non-null boolean verdict.
    mockCallProvider.mockResolvedValue({ content: "OK", toolCalls: undefined });

    const results = await runEndpointTests({
      endpointId: "local",
      modelId: "qwen3.8-27b",
      probesOnly: true,
      triggeredBy: "test",
    });

    for (const probe of results[0]!.probes) {
      expect(typeof probe.passed).toBe("boolean");
      expect(probe.outcome).toBe(probe.passed ? "passed" : "failed");
    }
    const runUpdate = mockPrisma.endpointTestRun.update.mock.calls[0]![0].data;
    expect(runUpdate.status).toBe("completed");
  });
});

describe("mapScoresToCodingCapability", () => {
  it("returns excellent for avg >= 4", () => {
    expect(mapScoresToCodingCapability([4, 5, 4])).toBe("excellent");
  });
  it("returns adequate for avg >= 3", () => {
    expect(mapScoresToCodingCapability([3, 3, 4])).toBe("adequate");
  });
  it("returns insufficient for avg < 3", () => {
    expect(mapScoresToCodingCapability([1, 2, 2])).toBe("insufficient");
  });
  it("returns null for empty scores", () => {
    expect(mapScoresToCodingCapability([])).toBeNull();
  });
});

describe("selected endpoint diagnostics (BI-0C5858D1)", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.modelProvider.findMany.mockImplementation(async ({ where }) => {
      const provider = { providerId: "chatgpt", status: "active", endpointType: "responses" };
      if (where.endpointType && where.endpointType !== "responses") return [];
      return [provider];
    });
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      { id: "subscription-model", providerId: "chatgpt", modelId: "gpt-6-luna", friendlyName: "GPT" },
    ]);
    mockPrisma.endpointTestRun.create.mockResolvedValue({ id: "diagnostic-run", runId: "TR-SELECTED" });
    mockPrisma.endpointTestRun.update.mockResolvedValue({});
    mockCallProvider.mockResolvedValue({ content: "OK", toolCalls: undefined });
    mockGrade.mockResolvedValue(null);
  });

  it("executes the selected Responses model without redirecting to another endpoint", async () => {
    const results = await runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", probesOnly: true, triggeredBy: "test" });
    expect(results).toHaveLength(1);
    expect(mockCallProvider).toHaveBeenCalled();
    for (const [provider, model] of mockCallProvider.mock.calls) {
      expect([provider, model]).toEqual(["chatgpt", "gpt-6-luna"]);
    }
  });

  it("does not replace a missing explicit model with the provider default", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([]);
    await expect(runEndpointTests({ endpointId: "chatgpt", modelId: "missing", probesOnly: true, triggeredBy: "test" })).rejects.toThrow(/model.*missing.*not available/i);
    expect(mockCallProvider).not.toHaveBeenCalled();
    expect(mockPrisma.endpointTestRun.create).not.toHaveBeenCalled();
  });

  it("reports an unavailable explicit provider instead of an empty successful test", async () => {
    mockPrisma.modelProvider.findMany.mockResolvedValue([]);
    await expect(runEndpointTests({ endpointId: "paused", modelId: "gpt-6-luna", probesOnly: true, triggeredBy: "test" })).rejects.toThrow(/provider.*paused.*not available/i);
    expect(mockCallProvider).not.toHaveBeenCalled();
  });

  it("caps synthetic output and links the dispatch to its durable test run", async () => {
    const results = await runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", probesOnly: true, triggeredBy: "test" });
    const persistedRunId = mockPrisma.endpointTestRun.create.mock.calls[0]![0].data.runId;
    expect(results[0]?.testRunId).toBe(persistedRunId);
    for (const args of mockCallProvider.mock.calls) {
      expect(args[5]).toMatchObject({ providerId: "chatgpt", modelId: "gpt-6-luna", maxTokens: 512 });
      expect(args[8]).toMatchObject({ traceId: expect.stringMatching(/^[a-f0-9]{32}$/) });
      expect(args[8]).not.toHaveProperty("threadId");
    }
    const recorded = mockPrisma.endpointTestRun.update.mock.calls[0]![0].data.results.probes;
    expect(recorded.map((p: { traceId: string }) => p.traceId)).toEqual(mockCallProvider.mock.calls.map(args => args[8].traceId));
  });

  it.each(["embedding", "image", "transcription", "service"])("does not chat-probe a %s endpoint", async endpointType => {
    mockPrisma.modelProvider.findMany.mockResolvedValue([{ providerId: "non-chat", endpointType }]);
    await expect(runEndpointTests({ endpointId: "non-chat", modelId: "selected", probesOnly: true, triggeredBy: "test" })).rejects.toThrow(/not available/);
    expect(mockCallProvider).not.toHaveBeenCalled();
  });

  it.each([
    { modelClass: "embedding", outputModalities: ["embeddings"], modelStatus: "active" },
    { modelClass: "chat", outputModalities: ["text"], modelStatus: "retired" },
    { modelClass: "chat", outputModalities: ["text"], modelStatus: "disabled" },
  ])("does not probe an incompatible or unavailable model %j", async metadata => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([{ id: "profile", providerId: "chatgpt", modelId: "selected", friendlyName: "Selected", ...metadata }]);
    await expect(runEndpointTests({ endpointId: "chatgpt", modelId: "selected", probesOnly: true, triggeredBy: "test" })).rejects.toThrow(/not available/);
    expect(mockCallProvider).not.toHaveBeenCalled();
  });

  it("stops on authentication failure without writing a model-quality verdict", async () => {
    mockCallProvider.mockRejectedValue(new InferenceError("expired credential", "auth", "chatgpt", 401));
    const results = await runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", triggeredBy: "test" });
    expect(mockCallProvider).toHaveBeenCalledTimes(1);
    expect(results[0]?.instructionFollowing).toBeNull();
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
    expect(mockPrisma.endpointTestRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "incomplete", probesFailed: 0 }) }));
  });

  it("leaves truncated probe output unverified", async () => {
    mockCallProvider.mockResolvedValue({ content: "OK", truncated: true });
    const results = await runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", probesOnly: true, triggeredBy: "test" });
    expect(results[0]?.instructionFollowing).toBeNull();
    expect(results[0]?.probes[0]).toMatchObject({ outcome: "deferred", passed: null });
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
  });

  it("cancels a hung diagnostic and preserves an incomplete run", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    mockCallProvider.mockImplementation(() => { signal = currentInferenceSignal(); return new Promise(() => {}); });
    try {
      const pending = runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", probesOnly: true, triggeredBy: "test" });
      await vi.advanceTimersByTimeAsync(30_001);
      const results = await pending;
      expect(signal?.aborted).toBe(true);
      expect(results[0]?.probes[0]).toMatchObject({ outcome: "deferred", passed: null });
      expect(mockCallProvider).toHaveBeenCalledTimes(1);
      expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("honors inherited caller cancellation without scoring the model", async () => {
    const parent = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    mockCallProvider.mockImplementation(() => { markStarted(); return new Promise(() => {}); });
    const pending = withInferenceCancellation(parent.signal, () => runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", probesOnly: true, triggeredBy: "test" }));
    await started;
    parent.abort(new Error("owning request ended"));
    const results = await pending;
    expect(results[0]?.probes[0]).toMatchObject({ outcome: "deferred", passed: null });
    expect(mockCallProvider).toHaveBeenCalledTimes(1);
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
  });

  it("keeps scenario grading inside the original observation deadline", async () => {
    for (const probe of CAPABILITY_PROBES) vi.spyOn(probe, "assert").mockReturnValue({ pass: true, reason: "observed" });
    vi.useFakeTimers();
    let gradingSignal: AbortSignal | undefined;
    let generations = 0;
    mockCallProvider.mockImplementation(() => ++generations <= CAPABILITY_PROBES.length
      ? Promise.resolve({ content: "OK" })
      : new Promise(resolve => { setTimeout(() => resolve({ content: "OK" }), 20_000); }));
    mockGrade.mockImplementation(() => { gradingSignal = currentInferenceSignal(); return new Promise(() => {}); });
    try {
      const pending = runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", taskType: "reasoning", triggeredBy: "test" });
      await vi.advanceTimersByTimeAsync(30_001);
      const results = await pending;
      expect(mockGrade).toHaveBeenCalledTimes(1);
      expect(gradingSignal?.aborted).toBe(true);
      expect(results[0]?.scenarios[0]).toMatchObject({ outcome: "deferred", orchestratorScore: null });
      expect(mockPrisma.taskEvaluation.create).not.toHaveBeenCalled();
      expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("does not retain earlier scenario quality updates when a later scenario is unobserved", async () => {
    for (const probe of CAPABILITY_PROBES) vi.spyOn(probe, "assert").mockReturnValue({ pass: true, reason: "observed" });
    mockGrade.mockResolvedValue({ score: 5, notes: "observed" });
    let calls = 0;
    mockCallProvider.mockImplementation(async () => {
      if (++calls > CAPABILITY_PROBES.length + 3) throw new InferenceError("expired credential", "auth", "chatgpt", 401);
      return { content: "OK" };
    });
    const results = await runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", triggeredBy: "test" });
    expect(results[0]?.scenarios.some(s => s.orchestratorScore === 5)).toBe(true);
    expect(results[0]?.scenarios.some(s => s.outcome === "deferred")).toBe(true);
    expect(mockPrisma.taskEvaluation.create).not.toHaveBeenCalled();
    expect(mockPerformanceUpdate).not.toHaveBeenCalled();
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
  });

  it("records observed quality once a complete selected scenario finishes", async () => {
    for (const probe of CAPABILITY_PROBES) vi.spyOn(probe, "assert").mockReturnValue({ pass: true, reason: "observed" });
    mockGrade.mockResolvedValue({ score: 5, notes: "observed" });
    const results = await runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", taskType: "reasoning", triggeredBy: "test" });
    expect(results[0]?.scenarios[0]?.orchestratorScore).toBe(5);
    expect(mockPrisma.taskEvaluation.create).toHaveBeenCalledTimes(1);
    expect(mockPerformanceUpdate).toHaveBeenCalledWith("chatgpt", "reasoning", 5);
    expect(mockPrisma.modelProfile.update).toHaveBeenCalledTimes(1);
  });

  it("does not complete a scenario when its required grader produces no score", async () => {
    for (const probe of CAPABILITY_PROBES) vi.spyOn(probe, "assert").mockReturnValue({ pass: true, reason: "observed" });
    mockGrade.mockResolvedValue(null);
    const results = await runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", taskType: "reasoning", triggeredBy: "test" });
    expect(results[0]?.scenarios[0]).toMatchObject({ outcome: "deferred", orchestratorScore: null });
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
    expect(mockPrisma.taskEvaluation.create).not.toHaveBeenCalled();
  });

  it("keeps parent cancellation authoritative even when grading swallows it", async () => {
    for (const probe of CAPABILITY_PROBES) vi.spyOn(probe, "assert").mockReturnValue({ pass: true, reason: "observed" });
    const parent = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    mockGrade.mockImplementation(() => new Promise(resolve => {
      currentInferenceSignal()?.addEventListener("abort", () => resolve(null), { once: true });
      markStarted();
    }));
    const pending = withInferenceCancellation(parent.signal, () => runEndpointTests({ endpointId: "chatgpt", modelId: "gpt-6-luna", taskType: "reasoning", triggeredBy: "test" }));
    await started;
    parent.abort(new Error("owning request ended"));
    const results = await pending;
    expect(results[0]?.scenarios[0]).toMatchObject({ outcome: "deferred", orchestratorScore: null });
    expect(mockPrisma.taskEvaluation.create).not.toHaveBeenCalled();
    expect(mockPerformanceUpdate).not.toHaveBeenCalled();
    expect(mockPrisma.modelProfile.update).not.toHaveBeenCalled();
  });
});
