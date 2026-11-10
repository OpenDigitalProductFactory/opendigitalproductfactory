import { beforeEach, describe, expect, it, vi } from "vitest";
import { screenInferencePayload, type ScreenInferencePayloadInput } from "@/lib/inference/data-screening/screen-inference-payload";
import type { ChatMessage } from "./chat-message-types";
import type { RouteDecision } from "./types";
import { assertGovernedInferenceAuthority, currentGovernedInferenceDeadline,
  GovernedInferenceDeadlineError, withInferenceAuthorityCheck } from "./governed-inference-deadline";
import { captureLocalNativeContinuation, createLocalContinuationBinding,
  invalidateLocalNativeContinuations, withLocalNativeContinuation } from "./local-native-continuation";

const mocks = vi.hoisted(() => ({
  callProvider: vi.fn(), findProvider: vi.fn(), updateProvider: vi.fn(),
  updateModels: vi.fn(), recordRouteOutcome: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  modelProvider: { findUnique: mocks.findProvider, update: mocks.updateProvider },
  modelProfile: { updateMany: mocks.updateModels },
} }));
vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    constructor(message: string, public readonly code: string, public readonly providerId: string) {
      super(message); this.name = "InferenceError";
    }
  }
  return { callProvider: mocks.callProvider, InferenceError };
});
vi.mock("./rate-tracker", () => ({
  recordRequest: vi.fn(), learnFromRateLimitResponse: vi.fn(), extractRetryAfterMs: vi.fn(),
  markEndpointUnavailable: vi.fn(), clearEndpointUnavailable: vi.fn(),
}));
vi.mock("./rate-recovery", () => ({ scheduleRecovery: vi.fn() }));
vi.mock("./loader", () => ({ invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("@/lib/ai-provider-internals", () => ({
  autoDiscoverAndProfile: vi.fn(), requestProviderCatalogRefresh: vi.fn(),
}));
vi.mock("@/lib/provider-oauth", () => ({ refreshOAuthToken: vi.fn() }));
vi.mock("./route-outcome", () => ({ recordRouteOutcome: mocks.recordRouteOutcome }));

import { callWithFallbackChain } from "./fallback";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(release => { resolve = release; });
  return { promise, resolve };
}

const completed = () => ({ content: "Verified result", toolCalls: [], inputTokens: 4, outputTokens: 2, inferenceMs: 1 });

function fixture() {
  let authorityVersion = "authority-1";
  const assistant: ChatMessage = { role: "assistant", content: "63" };
  const input: ScreenInferencePayloadInput = {
    messages: [{ role: "user", content: "Add the synthetic integers." }, assistant,
      { role: "user", content: "Verify the answer." }],
    systemPrompt: "Stable synthetic instruction", taskType: "test",
    routeContext: { sensitivity: "internal" },
    policyVersionSource: () => ({ assetVersion: "asset-1", classificationVersion: "classification-1",
      authorityVersion, policyBundleVersion: "bundle-1" }),
  };
  const identity = createLocalContinuationBinding({
    providerId: "local", apiEndpoint: "http://synthetic-dmr/engines/v1/chat/completions", modelId: "synthetic-model", systemPrompt: input.systemPrompt,
    runtime: { dialect: "llama.cpp-b9879", modelDigest: `sha256:${"a".repeat(64)}`,
      engineIdentity: "Running: llama.cpp b9879-metal synthetic-runtime",
      templateDigest: "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041",
      configDigest: "b".repeat(64), observedAt: Date.now() },
  });
  captureLocalNativeContinuation(assistant, "Private synthetic arithmetic trace", identity);
  const receipt = screenInferencePayload(input).receipt;
  const candidates = [
    { endpointId: "local-endpoint", providerId: "local", modelId: "synthetic-model" },
    { endpointId: "cloud-endpoint", providerId: "openai", modelId: "cloud-model" },
  ].map(candidate => ({ ...candidate, endpointName: candidate.modelId, fitnessScore: 1,
    dimensionScores: {}, costPerOutputMToken: null, excluded: false }));
  const decision: RouteDecision = {
    selectedEndpoint: "local-endpoint", selectedModelId: "synthetic-model",
    reason: "test", fitnessScore: 1, fallbackChain: ["cloud-endpoint"], candidates,
    excludedCount: 0, excludedReasons: [], policyRulesApplied: ["inference-dispatch"],
    taskType: "test", sensitivity: "internal", timestamp: new Date(),
    inferenceDataScreenReceipt: receipt,
  };
  return { input, decision, assistant, changePolicy: () => { authorityVersion = "authority-2"; } };
}

function callScreened({ decision, input }: ReturnType<typeof fixture>) {
  return callWithFallbackChain(decision, input.messages, input.systemPrompt, input.tools,
    undefined, undefined, undefined, undefined, input);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callProvider.mockReset();
  mocks.findProvider.mockImplementation(async ({ where }: { where: { providerId: string } }) => ({
    providerId: where.providerId, name: where.providerId, authMethod: "none",
  }));
  mocks.updateProvider.mockResolvedValue({});
  mocks.updateModels.mockResolvedValue({ count: 1 });
  mocks.recordRouteOutcome.mockResolvedValue(undefined);
});

describe("local continuation screening after provider admission", () => {
  it.each(["native state", "policy version"] as const)("stops before accepted dispatch and does not fall back when %s changes during admission", async change => {
    await withLocalNativeContinuation(async () => {
      const scoped = fixture();
      const ordinaryHistory = JSON.stringify(scoped.input.messages);
      const entered = deferred();
      const admitted = deferred();
      const acceptedDispatch = vi.fn();
      mocks.callProvider.mockImplementation(async () => {
        entered.resolve();
        await admitted.promise;
        // Real common choke-point authority after credentials/admission waits.
        await assertGovernedInferenceAuthority();
        acceptedDispatch();
        return completed();
      });
      const outcome = callScreened(scoped).then(value => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }));
      await entered.promise;
      if (change === "native state") invalidateLocalNativeContinuations([scoped.assistant]);
      else scoped.changePolicy();
      expect(JSON.stringify(scoped.input.messages)).toBe(ordinaryHistory);
      admitted.resolve();
      const settled = await outcome;
      expect(settled.error).toBeInstanceOf(GovernedInferenceDeadlineError);
      expect(settled.value).toBeUndefined();
      expect(acceptedDispatch).not.toHaveBeenCalled();
      expect(mocks.callProvider).toHaveBeenCalledTimes(1);
      expect(mocks.findProvider.mock.calls.map(([query]) => query.where.providerId)).toEqual(["local"]);
      expect(mocks.recordRouteOutcome).not.toHaveBeenCalled();
    });
  });

  it("accepts an unchanged matched request after admission without inventing parent authority", async () => {
    await withLocalNativeContinuation(async () => {
      const scoped = fixture();
      const entered = deferred();
      const admitted = deferred();
      const acceptedDispatch = vi.fn();
      mocks.callProvider.mockImplementation(async () => {
        entered.resolve();
        await admitted.promise;
        expect(currentGovernedInferenceDeadline()).toBeUndefined();
        await assertGovernedInferenceAuthority();
        acceptedDispatch();
        return completed();
      });
      const pending = callScreened(scoped);
      await entered.promise;
      admitted.resolve();
      await expect(pending).resolves.toMatchObject({ providerId: "local", content: "Verified result" });
      expect(acceptedDispatch).toHaveBeenCalledTimes(1);
      expect(mocks.callProvider).toHaveBeenCalledTimes(1);
      expect(mocks.recordRouteOutcome).toHaveBeenCalledTimes(1);
    });
  });

  it("preserves an inherited authority refusal instead of trying a sibling provider", async () => {
    await withLocalNativeContinuation(async () => {
      const scoped = fixture();
      const acceptedDispatch = vi.fn();
      mocks.callProvider.mockImplementation(async () => {
        await assertGovernedInferenceAuthority();
        acceptedDispatch();
        return completed();
      });
      const outcome = await withInferenceAuthorityCheck(async () => false,
        () => callScreened(scoped)).catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(GovernedInferenceDeadlineError);
      expect(acceptedDispatch).not.toHaveBeenCalled();
      expect(mocks.callProvider).toHaveBeenCalledTimes(1);
      expect(mocks.findProvider.mock.calls.map(([query]) => query.where.providerId)).toEqual(["local"]);
      expect(mocks.recordRouteOutcome).not.toHaveBeenCalled();
    });
  });
});
