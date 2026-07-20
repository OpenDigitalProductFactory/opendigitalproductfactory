// apps/web/lib/inference/phase-model-resolution.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockGetConfig = vi.fn();
const mockPreviewRoute = vi.fn();
const mockPreflight = vi.fn();

vi.mock("@/lib/integrate/build-studio-config", () => ({
  getBuildStudioConfig: async () => withSelection(await mockGetConfig()),
}));
vi.mock("@/lib/inference/routed-inference", () => ({
  previewRoute: (...args: unknown[]) => mockPreviewRoute(...args),
}));
vi.mock("@/lib/inference/ollama-url", () => ({
  getOllamaBaseUrl: () => "http://model-runner.docker.internal/v1",
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findUnique: vi.fn(async () => ({
        providerId: "local",
        endpoint: "http://model-runner.docker.internal/v1",
        baseUrl: null,
      })),
    },
  },
}));
vi.mock("@/lib/integrate/opencode-dispatch", () => ({
  preflightLocalEndpoint: (...args: unknown[]) => mockPreflight(...args),
  isLikelyNonChatModel: (m: string) =>
    /embed|nomic|bge[-_]|rerank|whisper/i.test(m),
  OPENCODE_MIN_CONTEXT_TOKENS: 22_000,
}));

import { resolveModelSelectionByPhase } from "./phase-model-resolution";

// ── Fixtures ───────────────────────────────────────────────────────────────────
const OPENCODE_CONFIG = {
  provider: "opencode" as const,
  claudeProviderId: "",
  codexProviderId: "",
  grokProviderId: "",
  opencodeProviderId: "local",
  claudeModel: "sonnet",
  codexModel: "",
  grokModel: "",
  opencodeModel: "qwen3-coder",
};

function withSelection<T extends {
  provider: "claude" | "codex" | "grok" | "opencode" | "agentic";
  claudeProviderId: string;
  codexProviderId: string;
  grokProviderId: string;
  opencodeProviderId: string;
  claudeModel: string;
  opencodeModel: string;
}>(config: T) {
  if ("selection" in config) return config;
  const providerId = config.provider === "claude"
    ? config.claudeProviderId
    : config.provider === "codex"
      ? config.codexProviderId
      : config.provider === "grok"
        ? config.grokProviderId
        : config.opencodeProviderId || "chatgpt";
  return {
    ...config,
    enginePolicy: "auto" as const,
    pinnedEngine: null,
    selection: {
      status: "selected" as const,
      policy: { mode: "auto" as const, pinnedEngine: null },
      selected: {
        engine: config.provider,
        providerId,
        modelId: config.provider === "opencode" ? config.opencodeModel : config.provider === "claude" ? config.claudeModel : null,
        local: config.provider === "opencode",
        registered: true,
        present: true,
        providerStatus: "active",
        authMethod: config.provider === "opencode" ? "none" : "oauth",
        credentialStatus: config.provider === "opencode" ? null : "active",
        credentialExpiresAt: null,
        providerCapacityState: "available",
        providerRetryAt: null,
        cliRetryAt: null,
        providerHealth: "healthy" as const,
      },
      reason: `Selected ${providerId} through routeEndpointV2.`,
      rejected: [],
      fallbackChain: [],
      fallbackDisabled: false,
      action: null,
    },
  };
}

function cloudWinner() {
  return {
    decision: {
      selectedEndpoint: "ep-chatgpt",
      selectedModelId: "gpt-5.1",
      reason: "Selected ChatGPT (chatgpt) for task type 'analysis'.",
      fitnessScore: 90,
      fallbackChain: ["ep-chatgpt"],
      candidates: [],
      excludedCount: 0,
      excludedReasons: [],
      policyRulesApplied: [],
      taskType: "analysis",
      sensitivity: "internal",
      timestamp: new Date(0),
    },
    selectedManifest: {
      id: "ep-chatgpt",
      providerId: "chatgpt",
      modelId: "gpt-5.1",
      name: "ChatGPT GPT-5.1",
      providerTier: "user_configured",
      maxContextTokens: 200_000,
    },
    contract: { taskType: "analysis" },
  };
}

function localWinner() {
  return {
    decision: {
      selectedEndpoint: "ep-local",
      selectedModelId: "qwen3-coder",
      reason: "Selected Local qwen3-coder (local) for task type 'analysis'.",
      fitnessScore: 80,
      fallbackChain: ["ep-local"],
      candidates: [],
      excludedCount: 0,
      excludedReasons: [],
      policyRulesApplied: [],
      taskType: "analysis",
      sensitivity: "internal",
      timestamp: new Date(0),
    },
    selectedManifest: {
      id: "ep-local",
      providerId: "local",
      modelId: "qwen3-coder",
      name: "Local qwen3-coder",
      providerTier: "bundled",
      maxContextTokens: 32_000,
    },
    contract: { taskType: "analysis" },
  };
}

const HEALTHY_PREFLIGHT = {
  ok: true,
  resolvedModel: "qwen3-coder",
  models: ["qwen3-coder"],
  contextOk: true,
  reason: null,
  reportedContextTokens: 32_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveModelSelectionByPhase — the local-but-cloud blind spot", () => {
  it("passes activity-derived route context into routed phase previews", async () => {
    mockGetConfig.mockResolvedValue(OPENCODE_CONFIG);
    mockPreviewRoute.mockResolvedValue(cloudWinner());
    mockPreflight.mockResolvedValue(HEALTHY_PREFLIGHT);

    await resolveModelSelectionByPhase();

    const planCall = mockPreviewRoute.mock.calls.find(([, , opts]) =>
      Boolean(opts && typeof opts === "object" && (opts as { activityId?: string }).activityId === "build:unknown:plan"),
    );
    expect(planCall?.[2]).toMatchObject({
      activityId: "build:unknown:plan",
      activityClass: "plan",
      distributionShape: "edge",
      riskClass: "high",
      successShape: "decision",
      contextPolicy: "work-case-packet",
      taskType: "reasoning",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
    });
  });

  it("flags every reasoning phase that routes to cloud when the build engine is Local (OpenCode)", async () => {
    mockGetConfig.mockResolvedValue(OPENCODE_CONFIG);
    mockPreviewRoute.mockResolvedValue(cloudWinner()); // plan, design-review, plan-review
    mockPreflight.mockResolvedValue(HEALTHY_PREFLIGHT); // build (local)

    const overview = await resolveModelSelectionByPhase();

    expect(overview.verdict).toBe("mixed");
    expect(overview.summary).toMatch(/GPU sits idle/i);

    const build = overview.phases.find((p) => p.phase === "build")!;
    expect(build.isLocal).toBe(true);
    expect(build.mechanism).toBe("local-opencode");

    const ideate = overview.phases.find((phase) => phase.phase === "ideate")!;
    expect(ideate.isLocal).toBe(true);
    expect(ideate.providerId).toBe("local");

    for (const phase of ["plan", "design-review", "plan-review"] as const) {
      const p = overview.phases.find((x) => x.phase === phase)!;
      expect(p.isLocal).toBe(false);
      expect(p.flags.some((f) => f.code === "local-intent-cloud-reasoning")).toBe(true);
    }
    // The headline mismatch is an error.
    expect(overview.flags.some((f) => f.severity === "error" && f.code === "local-intent-cloud-reasoning")).toBe(true);
  });

  it("flags a served context window below the OpenCode floor", async () => {
    mockGetConfig.mockResolvedValue(OPENCODE_CONFIG);
    mockPreviewRoute.mockResolvedValue(cloudWinner());
    mockPreflight.mockResolvedValue({
      ok: false,
      resolvedModel: "qwen3-coder",
      models: ["qwen3-coder"],
      contextOk: false,
      reason: "serves only 4096 context tokens",
      reportedContextTokens: 4096,
    });

    const overview = await resolveModelSelectionByPhase();
    const build = overview.phases.find((p) => p.phase === "build")!;
    expect(build.contextTokens).toBe(4096);
    const ctx = build.flags.find((f) => f.code === "context-too-small")!;
    expect(ctx).toBeTruthy();
    expect(ctx.message).toMatch(/4096/);
    expect(ctx.message).toMatch(/22000/);
  });

  it("warns when the local endpoint lists an embedding model first", async () => {
    mockGetConfig.mockResolvedValue(OPENCODE_CONFIG);
    mockPreviewRoute.mockResolvedValue(cloudWinner());
    mockPreflight.mockResolvedValue({
      ok: true,
      resolvedModel: "qwen3-coder",
      models: ["nomic-embed-text", "qwen3-coder"],
      contextOk: true,
      reason: null,
      reportedContextTokens: 32_000,
    });

    const overview = await resolveModelSelectionByPhase();
    const build = overview.phases.find((p) => p.phase === "build")!;
    expect(build.flags.some((f) => f.code === "embedding-model-first")).toBe(true);
  });

  it("reports all-local and raises no error flags when every phase resolves local", async () => {
    mockGetConfig.mockResolvedValue(OPENCODE_CONFIG);
    mockPreviewRoute.mockResolvedValue(localWinner()); // routed reasoning phases land local
    mockPreflight.mockResolvedValue(HEALTHY_PREFLIGHT);

    const overview = await resolveModelSelectionByPhase();
    expect(overview.verdict).toBe("all-local");
    expect(overview.flags.some((f) => f.severity === "error")).toBe(false);
    expect(overview.flags.some((f) => f.code === "local-intent-cloud-reasoning")).toBe(false);
  });
});

describe("resolveModelSelectionByPhase — non-local engines", () => {
  it("reports all-cloud for a Claude engine and notes the build phase still routes", async () => {
    mockGetConfig.mockResolvedValue({
      ...OPENCODE_CONFIG,
      provider: "claude" as const,
      claudeProviderId: "anthropic",
      opencodeProviderId: "",
      opencodeModel: "",
    });
    mockPreviewRoute.mockResolvedValue(cloudWinner()); // plan, reviews, build

    const overview = await resolveModelSelectionByPhase();

    expect(overview.verdict).toBe("all-cloud");

    const ideate = overview.phases.find((p) => p.phase === "ideate")!;
    expect(ideate.mechanism).toBe("vendor-cli");
    expect(ideate.isLocal).toBe(false);
    expect(ideate.providerId).toBe("anthropic");

    const build = overview.phases.find((p) => p.phase === "build")!;
    expect(build.mechanism).toBe("vendor-cli");
    expect(build.providerId).toBe("anthropic");

    // Not opencode → no local-intent mismatch flag anywhere.
    expect(overview.flags.some((f) => f.code === "local-intent-cloud-reasoning")).toBe(false);
  });

  it("reports the selector's supported agentic fallback for Ideate", async () => {
    mockGetConfig.mockResolvedValue({
      ...OPENCODE_CONFIG,
      provider: "agentic" as const,
      opencodeProviderId: "",
      opencodeModel: "",
    });
    mockPreviewRoute.mockResolvedValue(cloudWinner());

    const overview = await resolveModelSelectionByPhase();
    const ideate = overview.phases.find((p) => p.phase === "ideate")!;
    expect(ideate.mechanism).toBe("routed");
    expect(ideate.providerId).toBe("chatgpt");
    expect(ideate.flags).toEqual([]);
  });

  it("surfaces a configuration gap when no providers are eligible", async () => {
    mockGetConfig.mockResolvedValue({
      ...OPENCODE_CONFIG,
      provider: "agentic" as const,
      opencodeProviderId: "",
      opencodeModel: "",
      selection: {
        status: "blocked" as const,
        policy: { mode: "auto" as const, pinnedEngine: null },
        selected: null,
        reason: "No endpoint satisfied the Build Studio contract.",
        rejected: [],
        fallbackChain: [],
        fallbackDisabled: false,
        action: "Connect one allowed provider and retry.",
      },
    });
    mockPreviewRoute.mockRejectedValue(new Error("No active endpoint manifests found."));

    const overview = await resolveModelSelectionByPhase();
    // ideate is unsupported (null) and every routed phase errored (null) → unconfigured.
    expect(overview.verdict).toBe("unconfigured");
    expect(overview.flags.some((f) => f.code === "no-providers")).toBe(true);
  });
});
