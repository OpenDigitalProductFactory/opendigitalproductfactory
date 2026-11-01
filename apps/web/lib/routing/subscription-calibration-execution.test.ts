import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: {} as any, job: {} as any, authority: true, call: vi.fn(), validate: vi.fn(), profile: {} as any, saved: [] as any[] }));
vi.mock("@dpf/db", () => ({ prisma: new Proxy({}, { get: (_, key) => m.db[key] }), Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } } }));
vi.mock("@/lib/ai-inference", async () => ({ ...(await import("./inference-error")), callProvider: m.call }));
vi.mock("./subscription-calibration-admission", async original => ({ ...(await original<any>()), validateCalibrationCommission: m.validate }));
import { calibrationCorpus, calibrationCorpusHash, calibrationJobId, type CalibrationCommission } from "./subscription-calibration-admission";
import { assertGovernedInferenceAuthority } from "./governed-inference-deadline";
import { InferenceError } from "./inference-error";
import { runSubscriptionCalibration } from "./subscription-calibration-execution";

const input = { runId: "DE-fixture", endpointId: "chatgpt", modelId: "selected", userId: "operator" };
beforeEach(() => {
  vi.resetAllMocks(); m.authority = true; m.saved = [];
  const corpus = calibrationCorpus();
  const c: CalibrationCommission = { version: 1, runId: input.runId, providerId: "chatgpt", modelId: "selected", userId: "operator", principalId: "principal",
    accountId: "account", credentialId: "credential", jobId: calibrationJobId("chatgpt", "selected"), admittedAt: Date.now(), deadlineAt: Date.now() + 600_000,
    corpusHash: calibrationCorpusHash(), maxCalls: corpus.length * 2, maxOutputTokens: corpus.reduce((n,t) => n + (t.maxTokens ?? 512), 0) * 2,
    proof: { version: 1, providerId: "chatgpt", connectionId: "provider-default-chatgpt", modelId: "selected", adapter: "responses",
      accountVersion: "a".repeat(64), credentialRevision: "b".repeat(64), modelRevision: "c".repeat(64), endpointRevision: "d".repeat(64), quotaRevision: "e".repeat(64),
      observedAt: Date.now(), expiresAt: Date.now() + 3600_000 } };
  m.job = { enabled: true, runCursor: c.runId, metadata: { commission: c, state: "queued", attempts: [] } };
  m.profile = { id: "profile", evalCount: 7, profileConfidence: "high", conversational: 77, capabilityOverrides: {}, capabilities: { streaming: true },
    reasoning: 70, codegen: 70, toolFidelity: 70, instructionFollowingScore: 70, structuredOutputScore: 70, contextRetention: 70 };
  m.db = { $transaction: (fn: any) => fn(m.db), $queryRaw: vi.fn().mockResolvedValue([]),
    scheduledJob: { findUnique: vi.fn(async () => structuredClone(m.job)), update: vi.fn(async ({ data }) => { Object.assign(m.job, structuredClone(data)); return m.job; }) },
    modelProfile: { findUniqueOrThrow: vi.fn(async () => structuredClone(m.profile)), update: vi.fn(async ({ data }) => { m.saved.push(data); return data; }) },
    endpointTestRun: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ endpointId: "chatgpt", modelId: "selected", triggeredBy: "operator", status: "running", taskType: "dimension-eval" }) } };
  m.validate.mockImplementation(async () => m.authority);
  m.call.mockImplementation(async (...args) => {
    await assertGovernedInferenceAuthority();
    // Observe the committed reservation at the provider boundary, before output exists.
    const last = m.job.metadata.attempts.at(-1);
    expect(last).toMatchObject({ disposition: "unknown", cap: args[5].maxTokens });
    expect(args[5]).toMatchObject({ providerConnectionId: c.proof.connectionId, providerConnectionVersion: c.proof.accountVersion,
      executionAdapter: "responses", responsePolicy: { requireOutputBound: true } });
    const support = last.testId === "output-bound-support";
    return { content: "A response", outputTokens: support ? 32 : 10, inputTokens: 10, inferenceMs: 1,
      finishReason: support ? "max_output_tokens" : "completed", truncated: support, responseId: `response-${m.call.mock.calls.length}` };
  });
});
describe("durable owned calibration", () => {
  it("uses actual capped support then measures only the declared six dimensions without whole-model promotion", async () => {
    await runSubscriptionCalibration(input);
    expect(m.call).toHaveBeenCalledTimes(1 + calibrationCorpus().filter(t => t.scoring !== "orchestrator").length);
    expect(m.saved).toHaveLength(1);
    expect(m.saved[0]).toMatchObject({ profileSource: "evaluated" });
    for (const key of ["conversational", "profileConfidence", "evalCount", "qualityTier", "capabilityOverrides"]) expect(m.saved[0]).not.toHaveProperty(key);
    const run = m.db.endpointTestRun.update.mock.calls[0][0].data;
    expect(run).toMatchObject({ status: "incomplete", avgScore: null, results: { qualityWritesApplied: true,
      measurementScope: { fullCohortVerified: false, unverifiedDimensions: ["conversational"] } } });
    expect(run.results.measurementScope.measuredDimensions).toHaveLength(6);
    expect(run.results.attempts.every((a: any) => a.responseId && a.traceId && a.outputTokens <= a.cap)).toBe(true);
    expect(m.job.runCursor).toBeNull(); expect(m.job.metadata.state).toBe("settled");
  });
  it.each(["completed", "failed", "content_filter"])("does not grade a support observation ending %s", async reason => {
    m.call.mockResolvedValue({ content: "short", finishReason: reason, truncated: false, outputTokens: 4 });
    await runSubscriptionCalibration(input);
    expect(m.call).toHaveBeenCalledOnce(); expect(m.saved).toHaveLength(0);
    expect(m.db.endpointTestRun.update.mock.calls[0][0].data.results.qualityWritesApplied).toBe(false);
  });
  it.each([{ outputTokens: 0 }, { outputTokens: 33 }, { finishReason: undefined }])("holds unverified support metadata %j and never replays after the old cutoff", async change => {
    m.call.mockResolvedValue({ content: "partial", finishReason: "max_output_tokens", truncated: true, outputTokens: 32, ...change });
    await runSubscriptionCalibration(input);
    expect(m.saved).toHaveLength(0); expect(m.job.runCursor).toBe(input.runId);
    expect(m.job.metadata.attempts[0].disposition).toBe("unknown");
    m.job.lastRunAt = new Date(0); m.job.metadata.commission.deadlineAt = 1;
    await expect(runSubscriptionCalibration(input)).resolves.toMatchObject({ skipped: true });
    expect(m.call).toHaveBeenCalledOnce();
  });
  it("retains an uncertain dispatch after a network interruption", async () => {
    m.call.mockRejectedValue(new Error("connection lost after dispatch"));
    await runSubscriptionCalibration(input);
    await runSubscriptionCalibration(input);
    expect(m.call).toHaveBeenCalledOnce(); expect(m.saved).toHaveLength(0);
    expect(m.job.lastRunSummary).toMatch(/unknown.*reconciliation/);
  });
  it("records a known required-cap refusal without stripping the field or issuing a golden call", async () => {
    m.call.mockRejectedValue(new InferenceError("Unsupported max_output_tokens", "provider_error", "chatgpt", 400));
    await runSubscriptionCalibration(input);
    expect(m.call).toHaveBeenCalledOnce(); expect(m.saved).toHaveLength(0);
    expect(m.job.metadata.attempts[0].disposition).toBe("refused"); expect(m.job.metadata.state).toBe("settled");
  });
  it("holds all earlier measurements after a later incomplete golden result", async () => {
    const original = m.call.getMockImplementation()!;
    m.call.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (m.call.mock.calls.length === 15) return { ...result, finishReason: "max_output_tokens", truncated: true };
      return result;
    });
    await runSubscriptionCalibration(input);
    expect(m.call).toHaveBeenCalledTimes(15); expect(m.saved).toHaveLength(0);
    expect(m.db.endpointTestRun.update.mock.calls[0][0].data.results.measurementScope.measuredDimensions).toEqual([]);
  });
  it("preserves both directions of a current tool-use admin pin", async () => {
    m.profile.capabilityOverrides = { toolUse: false };
    await runSubscriptionCalibration(input);
    expect(m.saved).toHaveLength(1); expect(m.saved[0]).not.toHaveProperty("supportsToolUse");
    expect(m.saved[0]).not.toHaveProperty("capabilities");
  });
  it("rechecks authority in the final transaction and rejects a revoke after the last response", async () => {
    const original = m.call.getMockImplementation()!;
    const count = 1 + calibrationCorpus().filter(t => t.scoring !== "orchestrator").length;
    m.call.mockImplementation(async (...args) => { const result = await original(...args); if (m.call.mock.calls.length === count) m.authority = false; return result; });
    await runSubscriptionCalibration(input);
    expect(m.call).toHaveBeenCalledTimes(count); expect(m.saved).toHaveLength(0);
    expect(m.job.lastRunSummary).toMatch(/authority changed/);
  });
  it("reserves aggregate output allowance before the first provider attempt", async () => {
    const cap = m.job.metadata.commission.maxOutputTokens;
    m.job.metadata.attempts = [{ id: "prior", cap, disposition: "terminal" }];
    await runSubscriptionCalibration(input);
    expect(m.call).not.toHaveBeenCalled(); expect(m.saved).toHaveLength(0);
  });
  it("does not adopt a stale event into a replacement commission", async () => {
    await expect(runSubscriptionCalibration({ ...input, runId: "DE-stale" })).rejects.toThrow("matching");
    expect(m.call).not.toHaveBeenCalled(); expect(m.saved).toHaveLength(0);
  });
});
