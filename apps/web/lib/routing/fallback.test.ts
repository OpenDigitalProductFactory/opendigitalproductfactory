import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    modelProfile: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    name = "InferenceError";
    constructor(
      message: string,
      public readonly code: string,
      public readonly providerId: string,
      public readonly statusCode?: number,
      public readonly headers?: Record<string, string>,
    ) {
      super(message);
    }
  }
  return {
    callProvider: vi.fn(),
    InferenceError,
  };
});

vi.mock("./rate-tracker", () => ({
  recordRequest: vi.fn(),
  learnFromRateLimitResponse: vi.fn(),
  extractRetryAfterMs: vi.fn(),
  markEndpointUnavailable: vi.fn(),
  clearEndpointUnavailable: vi.fn(),
  getEndpointRuntimeState: vi.fn(() => ({ unavailable: false })),
}));

vi.mock("./rate-recovery", () => ({
  scheduleRecovery: vi.fn(),
}));

// The local-fallback gate derives its ceiling from the MEASURED tool-fidelity
// evidence, the same input the attachment budget uses (BI-A8BFEFCE). Default to
// unmeasured so existing expectations keep the fail-safe cliff of 15.
vi.mock("./local-tool-fidelity", () => ({
  resolveLocalToolFidelityCeiling: vi.fn(async () => null),
}));

vi.mock("./loader", () => ({
  invalidateRoutingLoaderCache: vi.fn(),
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  autoDiscoverAndProfile: vi.fn(),
}));

vi.mock("@/lib/provider-oauth", () => ({
  refreshOAuthToken: vi.fn(),
}));

vi.mock("./route-outcome", () => ({
  recordRouteOutcome: vi.fn(() => Promise.resolve()),
}));

import { buildFallbackPlan, callWithFallbackChain } from "./fallback";
import { ProviderReconciliationRequiredError } from "@/lib/inference/provider-reconciliation";
import { prisma } from "@dpf/db";
import { callProvider, InferenceError } from "@/lib/ai-inference";
import {
  recordRequest,
  learnFromRateLimitResponse,
  extractRetryAfterMs,
  markEndpointUnavailable,
  clearEndpointUnavailable,
} from "./rate-tracker";
import { scheduleRecovery } from "./rate-recovery";
import { invalidateRoutingLoaderCache } from "./loader";
import { autoDiscoverAndProfile } from "@/lib/ai-provider-internals";
import { recordRouteOutcome } from "./route-outcome";
import { refreshOAuthToken } from "@/lib/provider-oauth";
import type { RouteDecision } from "./types";
import type { SensitivityLevel } from "./types";

const makeDecision = (providerId: string, modelId: string): RouteDecision => ({
  selectedEndpoint: providerId,
  selectedModelId: modelId,
  reason: "test",
  fitnessScore: 1,
  fallbackChain: [],
  candidates: [],
  excludedCount: 0,
  excludedReasons: [],
  policyRulesApplied: [],
  taskType: "test",
  sensitivity: "internal" as SensitivityLevel,
  timestamp: new Date(),
});

const makeCandidate = (
  endpointId: string,
  providerId: string,
  modelId: string,
): RouteDecision["candidates"][number] => ({
  endpointId,
  providerId,
  modelId,
  endpointName: modelId,
  fitnessScore: 1,
  dimensionScores: {},
  costPerOutputMToken: null,
  excluded: false,
});

it("keeps restricted OpenRouter obligations load-bearing when OpenRouter is a fallback", () => {
  const plan = buildFallbackPlan(
    { providerId: "openrouter", modelId: "anthropic/claude" },
    makeDecision("openai", "gpt-4o"),
    undefined,
    {
      providerId: "openai",
      modelId: "gpt-4o",
      recipeId: null,
      contractFamily: "sync.test",
      executionAdapter: "chat",
      maxTokens: 1024,
      providerSettings: {},
      toolPolicy: { toolChoice: "required" },
      responsePolicy: { terminalWriterToolName: "record_initiative_evidence" },
      openRouterObligations: {
        requireProviderAllowlist: true,
        requireProviderBlocklist: true,
        requireZdr: true,
        denyDataCollection: true,
        requireBoundedFallbacks: true,
        requiredRegion: null,
        approvedEndpointSlugs: ["anthropic"],
        providerConnectionId: "conn-router",
        accountClass: "enterprise",
        evidenceStatus: "contract-uploaded",
        regionalProcessingEntitled: false,
        enabledRegions: [],
        requiredBaseUrl: null,
      },
    },
  );
  expect(plan.toolPolicy.toolChoice).toBe("required");
  expect(plan.responsePolicy.terminalWriterToolName).toBe("record_initiative_evidence");
  expect(plan.openRouterPolicy).toMatchObject({
    posture: "restricted",
    providerSettings: { only: ["anthropic"], allow_fallbacks: false, zdr: true },
    requireUnderlyingProviderEvidence: true,
  });
});
const mockPrisma = prisma as unknown as {
  modelProvider: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  modelProfile: {
    updateMany: ReturnType<typeof vi.fn>;
  };
};
const mockCallProvider = callProvider as ReturnType<typeof vi.fn>;
const mockRecordRequest = recordRequest as ReturnType<typeof vi.fn>;
const mockLearnFromRateLimitResponse = learnFromRateLimitResponse as ReturnType<typeof vi.fn>;
const mockExtractRetryAfterMs = extractRetryAfterMs as ReturnType<typeof vi.fn>;
const mockScheduleRecovery = scheduleRecovery as ReturnType<typeof vi.fn>;
const mockAutoDiscoverAndProfile = autoDiscoverAndProfile as ReturnType<typeof vi.fn>;
const mockRecordRouteOutcome = recordRouteOutcome as ReturnType<typeof vi.fn>;
const mockMarkEndpointUnavailable = markEndpointUnavailable as ReturnType<typeof vi.fn>;
const mockClearEndpointUnavailable = clearEndpointUnavailable as ReturnType<typeof vi.fn>;
const mockInvalidateRoutingLoaderCache = invalidateRoutingLoaderCache as ReturnType<typeof vi.fn>;
const mockRefreshOAuthToken = refreshOAuthToken as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  mockPrisma.modelProvider.findUnique.mockResolvedValue({
    providerId: "test-provider",
    name: "Test Provider",
  });

  mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.modelProvider.update.mockResolvedValue({});
  mockAutoDiscoverAndProfile.mockResolvedValue({
    discovered: 1,
    profiled: 1,
  });
  mockRecordRouteOutcome.mockResolvedValue(undefined);

  mockExtractRetryAfterMs.mockReturnValue(undefined);
  mockRefreshOAuthToken.mockResolvedValue({ token: "fresh-token" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("callWithFallbackChain — EP-INF-004 error handling", () => {
  describe("successful call", () => {
    it("records request with token count on success", async () => {
      mockCallProvider.mockResolvedValue({
        content: "hello",
        inputTokens: 100,
        outputTokens: 50,
        inferenceMs: 200,
      });

      await callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );

      expect(mockRecordRequest).toHaveBeenCalledWith("prov1", "model1", 150);
    });

    it("closes the runtime circuit (clearEndpointUnavailable) on success", async () => {
      mockCallProvider.mockResolvedValue({
        content: "hello",
        inputTokens: 100,
        outputTokens: 50,
        inferenceMs: 200,
      });

      await callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );

      expect(mockClearEndpointUnavailable).toHaveBeenCalledWith("prov1", "model1");
      expect(mockMarkEndpointUnavailable).not.toHaveBeenCalled();
      // BI-OPT-ROUTING-CACHE: a clean success must NOT bust the loader cache —
      // the per-turn memo has to survive an ordinary iteration.
      expect(mockInvalidateRoutingLoaderCache).not.toHaveBeenCalled();
    });

    it("records route outcomes with coworker attribution from the MCP session", async () => {
      mockCallProvider.mockResolvedValue({
        content: "hello",
        inputTokens: 100,
        outputTokens: 50,
        inferenceMs: 200,
      });

      await callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
        undefined,
        undefined,
        undefined,
        { userId: "user-1", agentId: "support-specialist", threadId: "thread-1", routeContext: "service-operations" },
      );

      expect(mockRecordRouteOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "support-specialist",
          providerId: "prov1",
          modelId: "model1",
          fallbackOccurred: false,
        }),
      );
    });

    it("uses provider-specific execution plans for fallback endpoints", async () => {
      mockCallProvider
        .mockRejectedValueOnce(new Error("primary unavailable"))
        .mockResolvedValueOnce({
          content: "fallback ok",
          inputTokens: 10,
          outputTokens: 5,
          inferenceMs: 100,
        });

      const tools = [
        {
          type: "function",
          function: {
            name: "read_project_file",
            description: "Read a project file",
            parameters: { type: "object", properties: {} },
          },
        },
      ];
      const decision: RouteDecision = {
        ...makeDecision("openai", "gpt-4.1"),
        selectedEndpoint: "openai-ep",
        selectedModelId: "gpt-4.1",
        fallbackChain: ["codex-ep"],
        candidates: [
          makeCandidate("openai-ep", "openai", "gpt-4.1"),
          makeCandidate("codex-ep", "codex", "gpt-5.4"),
        ],
      };

      const pending = callWithFallbackChain(
        decision,
        [{ role: "user", content: "hi" }],
        "system",
        tools,
      );
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toMatchObject({
        providerId: "codex",
        modelId: "gpt-5.4",
        content: "fallback ok",
        downgraded: true,
      });

      const fallbackPlan = mockCallProvider.mock.calls[1]?.[5];
      expect(fallbackPlan).toMatchObject({
        providerId: "codex",
        modelId: "gpt-5.4",
        executionAdapter: "codex-cli",
        toolPolicy: { toolChoice: "auto" },
      });
    });
  });

  // ── 429 rate_limit ───────────────────────────────────────────────────────

  describe("rate_limit (429)", () => {
    const rateLimitHeaders = { "retry-after": "30" };

    function throwRateLimit() {
      const err = new InferenceError(
        "Rate limited",
        "rate_limit",
        "prov1",
        429,
        rateLimitHeaders,
      );
      mockCallProvider.mockRejectedValue(err);
    }

    it("triggers model-level degradation, NOT provider-level", async () => {
      throwRateLimit();

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      // Model degraded at profile level
      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: { modelStatus: "degraded" },
      });

      // Provider NOT updated
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });

    // BI-OPT-ROUTING-CACHE: degrading a model changes what loadEndpointManifests
    // returns (manifest status derives from modelStatus), so the request-scoped
    // loader cache MUST be busted — otherwise the next routing iteration in the
    // turn would route against a stale "active" manifest.
    it("invalidates the routing-loader cache when a model is degraded", async () => {
      throwRateLimit();

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockInvalidateRoutingLoaderCache).toHaveBeenCalled();
    });

    it("opens the runtime circuit (markEndpointUnavailable) with reason rate_limit", async () => {
      throwRateLimit();
      mockExtractRetryAfterMs.mockReturnValue(30_000);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockMarkEndpointUnavailable).toHaveBeenCalledWith(
        "prov1",
        "model1",
        "rate_limit",
        expect.any(Number),
        expect.any(String),
      );
      // Circuit opens, but the durable provider lifecycle is untouched (spec D1).
      expect(mockClearEndpointUnavailable).not.toHaveBeenCalled();
    });

    it("triggers scheduleRecovery with providerId and modelId", async () => {
      throwRateLimit();
      mockExtractRetryAfterMs.mockReturnValue(30_000);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1");
    });

    it("defaults recovery delay to 60s when no retry-after header", async () => {
      throwRateLimit();
      mockExtractRetryAfterMs.mockReturnValue(undefined);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1");
    });

    it("calls recordRequest and learnFromRateLimitResponse", async () => {
      throwRateLimit();

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockRecordRequest).toHaveBeenCalledWith("prov1", "model1");
      expect(mockLearnFromRateLimitResponse).toHaveBeenCalledWith(
        "prov1",
        "model1",
        rateLimitHeaders,
      );
    });
  });

  describe("model_not_found", () => {
    function throwModelNotFound() {
      const err = new InferenceError(
        "Model not found",
        "model_not_found",
        "prov1",
        404,
      );
      mockCallProvider.mockRejectedValue(err);
    }

    it("retires the specific model with status, timestamp, and reason", async () => {
      throwModelNotFound();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: {
          modelStatus: "retired",
          retiredAt: expect.any(Date),
          retiredReason: "model_not_found from provider",
        },
      });
    });

    it("does NOT change provider status", async () => {
      throwModelNotFound();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });

    it("triggers provider reconciliation after retirement", async () => {
      throwModelNotFound();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("prov1");
    });

    it("awaits reconciliation before requesting one fresh route", async () => {
      let finishReconciliation!: () => void;
      mockAutoDiscoverAndProfile.mockReturnValue(
        new Promise((resolve) => {
          finishReconciliation = () => resolve({ discovered: 1, profiled: 1 });
        }),
      );
      throwModelNotFound();

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      let settled = false;
      void pending.then(
        () => { settled = true; },
        () => { settled = true; },
      );
      await vi.waitFor(() => expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("prov1"));
      expect(settled).toBe(false);

      finishReconciliation();
      await expect(pending).rejects.toBeInstanceOf(ProviderReconciliationRequiredError);
    });
  });

  // ── auth error ───────────────────────────────────────────────────────────

  describe("auth error", () => {
    function throwAuth() {
      const err = new InferenceError(
        "Invalid API key",
        "auth",
        "prov1",
        401,
      );
      mockCallProvider.mockRejectedValue(err);
    }

    it("disables the entire provider", async () => {
      throwAuth();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
        where: { providerId: "prov1" },
        data: { status: "disabled" },
      });
    });

    it("does NOT change model status", async () => {
      throwAuth();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
    });

    // ── OAuth self-heal: a lapsed subscription token must not permanently
    //    disable the provider on the first 401 (BI-EC4A5E7C). ────────────────
    it("refreshes the token and retries once for an OAuth provider — does NOT disable", async () => {
      mockPrisma.modelProvider.findUnique.mockResolvedValue({
        providerId: "prov1",
        name: "Claude Subscription",
        authMethod: "oauth2_authorization_code",
      });
      // First call auth-fails (stale token); the refresh-retry succeeds.
      mockCallProvider
        .mockRejectedValueOnce(new InferenceError("Invalid API key", "auth", "prov1", 401))
        .mockResolvedValueOnce({ content: "hello", inferenceMs: 100 });

      const result = await callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith("prov1");
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
      expect(result.content).toBe("hello");
    });

    it("disables the OAuth provider when the token refresh fails", async () => {
      mockPrisma.modelProvider.findUnique.mockResolvedValue({
        providerId: "prov1",
        name: "Claude Subscription",
        authMethod: "oauth2_authorization_code",
      });
      mockRefreshOAuthToken.mockResolvedValue({ error: "refresh token expired" });
      throwAuth();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith("prov1");
      expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
        where: { providerId: "prov1" },
        data: { status: "disabled" },
      });
    });

    it("disables the OAuth provider if the retry still auth-fails (refresh once, then give up)", async () => {
      mockPrisma.modelProvider.findUnique.mockResolvedValue({
        providerId: "prov1",
        name: "Claude Subscription",
        authMethod: "oauth2_authorization_code",
      });
      // Refresh succeeds but the retried call still auth-fails → disable.
      throwAuth();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockRefreshOAuthToken).toHaveBeenCalledTimes(1);
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
      expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
        where: { providerId: "prov1" },
        data: { status: "disabled" },
      });
    });

    // ── BI-F4D3B9E9(a): a LOCAL serving engine has no credentials, so an
    //    auth-classified response is an interface anomaly, never a bad key.
    //    Disabling the provider turned one context-overflow window into a
    //    35-minute workforce-wide outage on a local-first install. ──────────
    it("degrades the model instead of disabling a LOCAL provider on an auth-classified error", async () => {
      mockCallProvider.mockRejectedValue(
        new InferenceError("Unexpected 401 during model reload", "auth", "local", 401),
      );

      await expect(
        callWithFallbackChain(
          makeDecision("local", "docker.io/ai/qwen3-coder:latest"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "local", modelId: "docker.io/ai/qwen3-coder:latest" },
        data: { modelStatus: "degraded" },
      });
    });

    it("degrades the model instead of disabling a LOCAL provider on a billing-classified error", async () => {
      mockCallProvider.mockRejectedValue(
        new InferenceError("Unexpected 402 from local runtime", "billing", "local", 402),
      );

      await expect(
        callWithFallbackChain(
          makeDecision("local", "docker.io/ai/qwen3-coder:latest"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "local", modelId: "docker.io/ai/qwen3-coder:latest" },
        data: { modelStatus: "degraded" },
      });
    });

    it("still disables a CLOUD provider on billing errors (unchanged behavior)", async () => {
      mockCallProvider.mockRejectedValue(
        new InferenceError("Payment required", "billing", "prov1", 402),
      );

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
        where: { providerId: "prov1" },
        data: { status: "disabled" },
      });
    });
  });

  describe("provider interface drift", () => {
    it("degrades the model and triggers reconciliation after unsupported parameter errors", async () => {
      const err = new InferenceError(
        "HTTP 400 from prov1: Unsupported parameter: reasoning_effort",
        "provider_error",
        "prov1",
        400,
      );
      mockCallProvider.mockRejectedValue(err);

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: { modelStatus: "degraded" },
      });
      expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("prov1");
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });
  });

  // ── transient (5xx / 408) ──────────────────────────────────────────────────

  describe("transient errors (500/502/503/504/408)", () => {
    it("retries the pinned endpoint once after 10 s on transient error then succeeds", async () => {
      const transientErr = new InferenceError("Transient error (500) from prov1", "transient", "prov1", 500);
      mockCallProvider
        .mockRejectedValueOnce(transientErr)
        .mockResolvedValueOnce({ content: "ok", inputTokens: 10, outputTokens: 5, inferenceMs: 100 });

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result.content).toBe("ok");
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
      expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
    });

    it("degrades model and schedules recovery after transient retry also fails", async () => {
      const err = new InferenceError("Transient error (503) from prov1", "transient", "prov1", 503);
      mockCallProvider.mockRejectedValue(err);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: { modelStatus: "degraded" },
      });
      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1");
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });

    it("does not retry transient on a fallback endpoint", async () => {
      const decision: RouteDecision = {
        selectedEndpoint: "prov1",
        selectedModelId: "model1",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: ["fallback-prov"],
        candidates: [
          { endpointId: "prov1", providerId: "prov1", modelId: "model1",
            endpointName: "Prov1", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
          { endpointId: "fallback-prov", providerId: "fallback-prov", modelId: "fb-model",
            endpointName: "Fallback", fitnessScore: 0.5, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };

      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "fallback-prov", name: "Fallback" });

      const pinnedErr = new InferenceError("pinned rate limit", "rate_limit", "prov1", 429);
      const fallbackTransient = new InferenceError("Transient 502 from fallback", "transient", "fallback-prov", 502);
      // pinned: rate_limit → retry (30s wait) → rate_limit → degrade → fallback: transient (no retry)
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(fallbackTransient);

      const pending = callWithFallbackChain(
        decision,
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      // pinned×2 (rate limit + retry) + fallback×1 (no transient retry)
      expect(mockCallProvider).toHaveBeenCalledTimes(3);
    });
  });

  // ── billing (402) ──────────────────────────────────────────────────────────

  describe("billing error (402)", () => {
    function throwBilling() {
      const err = new InferenceError("Billing error on prov1", "billing", "prov1", 402);
      mockCallProvider.mockRejectedValue(err);
    }

    it("disables the entire provider", async () => {
      throwBilling();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
        where: { providerId: "prov1" },
        data: { status: "disabled" },
      });
    });

    it("does not degrade the model", async () => {
      throwBilling();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── request_too_large (413) ────────────────────────────────────────────────

  describe("request_too_large (413)", () => {
    it("throws immediately without trying fallback endpoints", async () => {
      const err = new InferenceError("Request too large for prov1", "request_too_large", "prov1", 413);
      mockCallProvider.mockRejectedValueOnce(err);

      const decision: RouteDecision = {
        selectedEndpoint: "prov1",
        selectedModelId: "model1",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: ["fallback-prov"],
        candidates: [
          { endpointId: "prov1", providerId: "prov1", modelId: "model1",
            endpointName: "Prov1", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
          { endpointId: "fallback-prov", providerId: "fallback-prov", modelId: "fb-model",
            endpointName: "Fallback", fitnessScore: 0.5, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };

      await expect(
        callWithFallbackChain(
          decision,
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow("REQUEST_TOO_LARGE");

      expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });
  });

  // ── provider overload (529) ────────────────────────────────────────────────

  describe("provider overload (529)", () => {
    it("degrades model and schedules recovery without disabling provider when retry also fails", async () => {
      const err = new InferenceError("Provider overloaded on prov1", "overloaded", "prov1", 529);
      mockCallProvider.mockRejectedValue(err);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: { modelStatus: "degraded" },
      });
      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1");
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });

    it("retries the pinned endpoint once after 15 s on overload then succeeds", async () => {
      const overloadErr = new InferenceError("Provider overloaded on prov1", "overloaded", "prov1", 529);
      mockCallProvider
        .mockRejectedValueOnce(overloadErr)
        .mockResolvedValueOnce({ content: "ok after retry", inputTokens: 10, outputTokens: 5, inferenceMs: 100 });

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;

      expect(result.content).toBe("ok after retry");
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
      expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
    });

    it("does not retry overload on a fallback (non-pinned) endpoint", async () => {
      const decision: RouteDecision = {
        selectedEndpoint: "prov1",
        selectedModelId: "model1",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: ["fallback-prov"],
        candidates: [
          { endpointId: "prov1", providerId: "prov1", modelId: "model1",
            endpointName: "Prov1", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
          { endpointId: "fallback-prov", providerId: "fallback-prov", modelId: "fb-model",
            endpointName: "Fallback", fitnessScore: 0.5, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };

      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "fallback-prov", name: "Fallback" });

      const pinnedErr = new InferenceError("pinned auth fail", "auth", "prov1", 401);
      const overloadErr = new InferenceError("Provider overloaded on fallback", "overloaded", "fallback-prov", 529);
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(overloadErr);

      const pending = callWithFallbackChain(
        decision,
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });
  });

  // ── local fallback skip on large tool surfaces (FB-71FB3A53) ────────────────

  describe("local fallback skip on large tool surfaces", () => {
    function makeChainWithLocalFallback(): RouteDecision {
      return {
        selectedEndpoint: "prov1",
        selectedModelId: "model1",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: ["local"],
        candidates: [
          { endpointId: "prov1", providerId: "prov1", modelId: "model1",
            endpointName: "Prov1", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
          { endpointId: "local", providerId: "local", modelId: "local-7b",
            endpointName: "Local", fitnessScore: 0.5, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };
    }

    function manyTools(count: number): Array<Record<string, unknown>> {
      return Array.from({ length: count }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool ${i}`,
        parameters: { type: "object", properties: {} },
      }));
    }

    it("skips local fallback when tools.length exceeds threshold", async () => {
      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" });

      const pinnedErr = new InferenceError("preferred down", "auth", "prov1", 401);
      mockCallProvider.mockRejectedValueOnce(pinnedErr);

      const pending = callWithFallbackChain(
        makeChainWithLocalFallback(),
        [{ role: "user", content: "hi" }],
        "system",
        manyTools(30), // build-studio-shaped tool surface
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      // Only the primary was attempted; local fallback was skipped.
      expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    it("admits a surface the measured fidelity ceiling covers (BI-A8BFEFCE)", async () => {
      // The attachment budget will attach up to a MEASURED ceiling. Before this
      // gate shared that derivation it pinned the raw cliff of 15, so a budgeted
      // 30-tool surface was refused for exceeding a limit nothing else applied —
      // and with the cloud provider rate-limited the turn executed no tools.
      const { resolveLocalToolFidelityCeiling } = await import("./local-tool-fidelity");
      vi.mocked(resolveLocalToolFidelityCeiling).mockResolvedValueOnce(30);

      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "local", name: "Local" });

      const pinnedErr = new InferenceError("preferred down", "auth", "prov1", 401);
      const localErr = new InferenceError("local also down", "auth", "local", 401);
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(localErr);

      const pending = callWithFallbackChain(
        makeChainWithLocalFallback(),
        [{ role: "user", content: "hi" }],
        "system",
        manyTools(30), // past the raw cliff, within the measured ceiling
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      // Local was tried rather than skipped on a count the model has proven.
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    it("keeps local fallback when tools.length is within threshold", async () => {
      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "local", name: "Local" });

      const pinnedErr = new InferenceError("preferred down", "auth", "prov1", 401);
      const localErr = new InferenceError("local also down", "auth", "local", 401);
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(localErr);

      const pending = callWithFallbackChain(
        makeChainWithLocalFallback(),
        [{ role: "user", content: "hi" }],
        "system",
        manyTools(10), // small tool surface — local should still be tried
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      // Primary + local fallback both attempted.
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    it("keeps local fallback when no tools are passed at all", async () => {
      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "local", name: "Local" });

      const pinnedErr = new InferenceError("preferred down", "auth", "prov1", 401);
      const localErr = new InferenceError("local also down", "auth", "local", 401);
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(localErr);

      const pending = callWithFallbackChain(
        makeChainWithLocalFallback(),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    it("still attempts the local primary endpoint even on large tool surfaces", async () => {
      // If routing decided local IS the primary (e.g. local_only residency),
      // the skip-on-fallback guard should NOT block i=0.
      const decision: RouteDecision = {
        selectedEndpoint: "local",
        selectedModelId: "local-7b",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: [],
        candidates: [
          { endpointId: "local", providerId: "local", modelId: "local-7b",
            endpointName: "Local", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };

      mockPrisma.modelProvider.findUnique.mockResolvedValueOnce({ providerId: "local", name: "Local" });
      mockCallProvider.mockResolvedValueOnce({
        content: "ok",
        inputTokens: 10,
        outputTokens: 5,
        inferenceMs: 100,
      });

      const result = await callWithFallbackChain(
        decision,
        [{ role: "user", content: "hi" }],
        "system",
        manyTools(30),
      );

      expect(result.content).toBe("ok");
      expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });
  });
});
