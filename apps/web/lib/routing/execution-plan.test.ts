/**
 * EP-INF-005b: Execution plan builder tests (TDD).
 *
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md
 */

import { describe, expect, it } from "vitest";
import {
  attachHarnessRecipeToPlan,
  buildPlanFromRecipe,
  buildDefaultPlan,
  resolveDefaultExecutionAdapter,
} from "./execution-plan";
import { bindHarnessRecipeForActivity } from "./harness-recipe";
import type { ActivityContract } from "./activity-contract";
import type { RecipeRow } from "./recipe-types";
import type { RequestContract } from "./request-contract";
import type { EndpointManifest } from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRecipe(overrides: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: "recipe-abc",
    providerId: "anthropic",
    modelId: "claude-3-5-sonnet-20241022",
    contractFamily: "sync.tool_action",
    executionAdapter: "chat",
    version: 1,
    status: "active",
    origin: "seed",
    providerSettings: {
      max_tokens: 8192,
      temperature: 0.3,
    },
    toolPolicy: { toolChoice: "auto", allowParallelToolCalls: true },
    responsePolicy: { strictSchema: false, stream: true },
    ...overrides,
  };
}

function makeContract(overrides: Partial<RequestContract> = {}): RequestContract {
  return {
    contractId: "cid-001",
    contractFamily: "sync.tool_action",
    taskType: "tool-action",
    modality: { input: ["text"], output: ["text", "tool_call"] },
    interactionMode: "sync",
    sensitivity: "internal",
    requiresTools: true,
    requiresStrictSchema: false,
    requiresStreaming: true,
    estimatedInputTokens: 200,
    estimatedOutputTokens: 500,
    reasoningDepth: "medium",
    budgetClass: "balanced",
    ...overrides,
  };
}

function makeEndpoint(overrides: Partial<EndpointManifest> = {}): EndpointManifest {
  return {
    id: "ep-001",
    providerId: "openai",
    modelId: "gpt-4o",
    name: "GPT-4o",
    endpointType: "chat",
    status: "active",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 80,
    codegen: 75,
    toolFidelity: 85,
    instructionFollowing: 85,
    structuredOutput: 80,
    conversational: 80,
    contextRetention: 75,
    customScores: {},
    avgLatencyMs: 500,
    recentFailureRate: 0.01,
    costPerOutputMToken: 15,
    profileSource: "evaluated",
    profileConfidence: "high",
    retiredAt: null,
    modelClass: "chat",
    modelFamily: "gpt-4",
    inputModalities: ["text"],
    outputModalities: ["text", "tool_call"],
    capabilities: {
      toolUse: true,
      structuredOutput: true,
      streaming: true,
      batch: null,
      citations: null,
      codeExecution: null,
      imageInput: false,
      pdfInput: false,
      thinking: null,
      adaptiveThinking: null,
      contextManagement: null,
      promptCaching: null,
      effortLevels: null,
    } as import("./model-card-types").ModelCardCapabilities,
    pricing: {
      inputPerMToken: 5,
      outputPerMToken: 15,
      cacheReadPerMToken: null,
      cacheWritePerMToken: null,
      imageInputPerMToken: null,
      imageOutputPerUnit: null,
      audioInputPerMToken: null,
      audioOutputPerMToken: null,
      reasoningPerMToken: null,
      requestFixed: null,
      webSearchPerRequest: null,
      discount: null,
    } as import("./model-card-types").ModelCardPricing,
    supportedParameters: ["temperature", "max_tokens"],
    deprecationDate: null,
    metadataSource: "openai-api",
    metadataConfidence: "high",
    perRequestLimits: null,
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityContract> = {}): ActivityContract {
  return {
    activityId: "act-build-001",
    parentRef: { buildId: "phase-build" },
    activityClass: "code-edit",
    title: "Build implementation",
    distributionShape: "edge",
    riskClass: "high",
    successShape: "patch",
    contextPolicy: "work-case-packet",
    tokenEnvelope: {
      maxInputTokens: 64000,
      maxOutputTokens: 8192,
      compression: "strict-packet",
    },
    evaluationPolicy: {
      evaluator: "tool-success",
      minimumSignal: "no-regression",
    },
    requestContractHints: {
      taskType: "analysis",
      budgetClass: "quality_first",
    },
    ...overrides,
  };
}

// ── buildPlanFromRecipe ───────────────────────────────────────────────────────

describe("buildPlanFromRecipe", () => {
  it("extracts maxTokens from providerSettings.max_tokens", () => {
    const recipe = makeRecipe({ providerSettings: { max_tokens: 8192 } });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.maxTokens).toBe(8192);
  });

  it("extracts temperature from providerSettings", () => {
    const recipe = makeRecipe({ providerSettings: { max_tokens: 4096, temperature: 0.7 } });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.temperature).toBe(0.7);
  });

  it("passes through remaining providerSettings (e.g. reasoning_effort)", () => {
    const recipe = makeRecipe({
      providerSettings: {
        max_tokens: 4096,
        temperature: 0.3,
        reasoning_effort: "high",
      },
    });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.providerSettings).toEqual({ reasoning_effort: "high" });
  });

  it("maps toolPolicy from the recipe row", () => {
    const recipe = makeRecipe({
      toolPolicy: { toolChoice: "required", allowParallelToolCalls: false },
    });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.toolPolicy).toEqual({
      toolChoice: "required",
      allowParallelToolCalls: false,
    });
  });

  it("maps responsePolicy from the recipe row", () => {
    const recipe = makeRecipe({
      responsePolicy: { strictSchema: true, stream: false },
    });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.responsePolicy).toEqual({ strictSchema: true, stream: false });
  });

  it("sets recipeId from recipe.id", () => {
    const recipe = makeRecipe({ id: "recipe-xyz-99" });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.recipeId).toBe("recipe-xyz-99");
  });

  it("defaults maxTokens to 4096 when max_tokens is not in providerSettings", () => {
    const recipe = makeRecipe({ providerSettings: { temperature: 0.5 } });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.maxTokens).toBe(4096);
  });

  it("does not set temperature when not present in providerSettings", () => {
    const recipe = makeRecipe({ providerSettings: { max_tokens: 2048 } });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.temperature).toBeUndefined();
  });

  it("includes executionAdapter from recipe", () => {
    const recipe = makeRecipe({ executionAdapter: "chat" });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.executionAdapter).toBe("chat");
  });

  it("passes through non-chat executionAdapter", () => {
    const recipe = makeRecipe({ executionAdapter: "image_gen" });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.executionAdapter).toBe("image_gen");
  });

  it("overrides codex recipes to the codex-cli adapter", () => {
    const recipe = makeRecipe({
      providerId: "codex",
      modelId: "gpt-5.3-codex",
      executionAdapter: "chat",
    });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.executionAdapter).toBe("codex-cli");
  });

  it("overrides anthropic-sub recipes to the claude-cli adapter", () => {
    const recipe = makeRecipe({
      providerId: "anthropic-sub",
      modelId: "claude-sonnet-4-6",
      executionAdapter: "chat",
    });
    const plan = buildPlanFromRecipe(recipe, makeContract());
    expect(plan.executionAdapter).toBe("claude-cli");
  });

  it("compiles restricted OpenRouter obligations into a typed execution policy", () => {
    const plan = buildPlanFromRecipe(
      makeRecipe({ providerId: "openrouter", modelId: "anthropic/claude" }),
      makeContract({
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
      }),
    );
    expect(plan.openRouterPolicy).toMatchObject({
      posture: "restricted",
      providerSettings: {
        only: ["anthropic"],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
      requireUnderlyingProviderEvidence: true,
      providerConnectionId: "conn-router",
    });
  });
});

// ── buildDefaultPlan ─────────────────────────────────────────────────────────

describe("buildDefaultPlan", () => {
  it("uses max_tokens=4096", () => {
    const plan = buildDefaultPlan(makeEndpoint(), makeContract());
    expect(plan.maxTokens).toBe(4096);
  });

  it("sets recipeId to null", () => {
    const plan = buildDefaultPlan(makeEndpoint(), makeContract());
    expect(plan.recipeId).toBeNull();
  });

  it("sets toolChoice to 'auto' when contract.requiresTools is true", () => {
    const plan = buildDefaultPlan(makeEndpoint(), makeContract({ requiresTools: true }));
    expect(plan.toolPolicy.toolChoice).toBe("auto");
  });

  it("does not set toolChoice when contract.requiresTools is false", () => {
    const plan = buildDefaultPlan(makeEndpoint(), makeContract({ requiresTools: false }));
    expect(plan.toolPolicy.toolChoice).toBeUndefined();
  });

  it("sets strictSchema from contract.requiresStrictSchema", () => {
    const plan = buildDefaultPlan(
      makeEndpoint(),
      makeContract({ requiresStrictSchema: true }),
    );
    expect(plan.responsePolicy.strictSchema).toBe(true);
  });

  it("sets stream from contract.requiresStreaming", () => {
    const plan = buildDefaultPlan(
      makeEndpoint(),
      makeContract({ requiresStreaming: false }),
    );
    expect(plan.responsePolicy.stream).toBe(false);
  });

  it("sets stream=true when contract.requiresStreaming is true", () => {
    const plan = buildDefaultPlan(
      makeEndpoint(),
      makeContract({ requiresStreaming: true }),
    );
    expect(plan.responsePolicy.stream).toBe(true);
  });

  it("returns empty providerSettings", () => {
    const plan = buildDefaultPlan(makeEndpoint(), makeContract());
    expect(plan.providerSettings).toEqual({});
  });

  it("carries providerId and modelId from endpoint", () => {
    const ep = makeEndpoint({ providerId: "gemini", modelId: "gemini-2.0-flash" });
    const plan = buildDefaultPlan(ep, makeContract());
    expect(plan.providerId).toBe("gemini");
    expect(plan.modelId).toBe("gemini-2.0-flash");
  });

  it("carries contractFamily from contract", () => {
    const contract = makeContract({ contractFamily: "background.data-extraction" });
    const plan = buildDefaultPlan(makeEndpoint(), contract);
    expect(plan.contractFamily).toBe("background.data-extraction");
  });

  it("defaults executionAdapter to 'chat'", () => {
    const plan = buildDefaultPlan(makeEndpoint(), makeContract());
    expect(plan.executionAdapter).toBe("chat");
  });

  it("selects codex-cli adapter for codex endpoints", () => {
    const plan = buildDefaultPlan(
      makeEndpoint({ providerId: "codex", modelId: "gpt-5.3-codex", modelClass: "code" }),
      makeContract(),
    );
    expect(plan.executionAdapter).toBe("codex-cli");
  });

  // ── EP-INF-009c: adapter selection based on requiredModelClass ──────────

  it("selects image_gen adapter when requiredModelClass is image_gen", () => {
    const plan = buildDefaultPlan(
      makeEndpoint(),
      makeContract({ requiredModelClass: "image_gen" as any }),
    );
    expect(plan.executionAdapter).toBe("image_gen");
  });

  it("selects embedding adapter when requiredModelClass is embedding", () => {
    const plan = buildDefaultPlan(
      makeEndpoint(),
      makeContract({ requiredModelClass: "embedding" as any }),
    );
    expect(plan.executionAdapter).toBe("embedding");
  });

  it("selects transcription adapter when requiredModelClass is audio", () => {
    const plan = buildDefaultPlan(
      makeEndpoint(),
      makeContract({ requiredModelClass: "audio" as any }),
    );
    expect(plan.executionAdapter).toBe("transcription");
  });

  it("selects chat adapter for reasoning modelClass", () => {
    const plan = buildDefaultPlan(
      makeEndpoint(),
      makeContract({ requiredModelClass: "reasoning" as any }),
    );
    expect(plan.executionAdapter).toBe("chat");
  });

  it("defaults to chat adapter when requiredModelClass is absent", () => {
    const plan = buildDefaultPlan(makeEndpoint(), makeContract());
    expect(plan.executionAdapter).toBe("chat");
  });

  it("selects claude-cli adapter for anthropic-sub endpoints", () => {
    const plan = buildDefaultPlan(
      makeEndpoint({ providerId: "anthropic-sub", modelId: "claude-sonnet-4-6" }),
      makeContract(),
    );
    expect(plan.executionAdapter).toBe("claude-cli");
  });
});

describe("resolveDefaultExecutionAdapter", () => {
  it("keeps Codex on the CLI adapter even without a full endpoint manifest", () => {
    expect(resolveDefaultExecutionAdapter("codex")).toBe("codex-cli");
  });

  it("keeps ChatGPT subscription calls on the responses adapter", () => {
    expect(resolveDefaultExecutionAdapter("chatgpt")).toBe("responses");
  });

  it("keeps Claude subscription calls on the Claude CLI adapter", () => {
    expect(resolveDefaultExecutionAdapter("anthropic-sub")).toBe("claude-cli");
  });

  it("falls back to required model-class adapters for generic providers", () => {
    expect(resolveDefaultExecutionAdapter("openai", "embedding")).toBe("embedding");
  });
});

describe("attachHarnessRecipeToPlan", () => {
  it("attaches activity harness metadata without changing the provider-ready plan", () => {
    const plan = buildDefaultPlan(
      makeEndpoint({
        providerId: "codex",
        modelId: "gpt-5.3-codex",
        modelClass: "code",
      }),
      makeContract(),
    );
    const harnessRecipe = bindHarnessRecipeForActivity(makeActivity());

    const planWithHarness = attachHarnessRecipeToPlan(plan, harnessRecipe);

    expect(planWithHarness).not.toBe(plan);
    expect(planWithHarness.providerId).toBe(plan.providerId);
    expect(planWithHarness.modelId).toBe(plan.modelId);
    expect(planWithHarness.executionAdapter).toBe(plan.executionAdapter);
    expect(planWithHarness.maxTokens).toBe(plan.maxTokens);
    expect(planWithHarness.toolPolicy).toEqual(plan.toolPolicy);
    expect(planWithHarness.responsePolicy).toEqual(plan.responsePolicy);
    expect(planWithHarness.harness).toEqual({
      recipeKey: harnessRecipe.recipeKey,
      activityClass: harnessRecipe.activityClass,
      activityConfidence: harnessRecipe.activityConfidence,
      promptStrategy: harnessRecipe.promptStrategy,
      contextAssembler: harnessRecipe.contextAssembler,
      memoryPolicy: harnessRecipe.memoryPolicy,
      tokenPolicy: harnessRecipe.tokenPolicy,
      evaluator: harnessRecipe.evaluator,
      providerFamily: harnessRecipe.providerFamily,
      modelFamily: harnessRecipe.modelFamily,
      executionAdapterHint: harnessRecipe.executionAdapterHint,
    });
    expect(plan.harness).toBeUndefined();
  });
});
