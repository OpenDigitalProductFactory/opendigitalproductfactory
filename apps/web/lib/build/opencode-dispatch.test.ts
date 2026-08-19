import { describe, it, expect, vi } from "vitest";

const recordProviderCapacityStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/routing/provider-capacity/store", () => ({
  recordProviderCapacityStatus: recordProviderCapacityStatusMock,
}));

import {
  sandboxReachableUrl,
  preflightLocalEndpoint,
  pickDefaultCodingModel,
  isEmbeddingModelId,
  buildOpencodeConfig,
  summarizeOpencodeEvent,
  extractOpencodeResult,
  buildOpencodeInstructions,
  detectOpencodeFatalError,
  buildOpencodeRunnerScript,
  recordOpencodeCapacityFailure,
} from "./opencode-dispatch";
import {
  estimatePromptTokens,
  computeInputTokenBudget,
  trimTaskPromptToContext,
  OPENCODE_OUTPUT_RESERVE_MIN_TOKENS,
} from "./opencode-task-context-budget";

describe("trimTaskPromptToContext (BI-B195F224)", () => {
  const samplePrompt = [
    "You are a software engineer building Next.js server actions.",
    "",
    "PROJECT CONTEXT:",
    "A".repeat(4_000),
    "",
    "RESULTS FROM PRIOR TASKS:",
    "B".repeat(3_000),
    "",
    "DPF BUILD DISCIPLINE (MANDATORY):",
    "- GROUND DOMAIN FACTS",
    "",
    "CRITICAL: This is a pnpm monorepo. Working directory is /workspace.",
    "",
    "TASK: Build accessible calendar grid component",
    "",
    "Implement the calendar grid with keyboard navigation.",
    "",
    "FILES (use these exact paths):",
    "- apps/web/components/calendar-grid.tsx (create): accessible grid",
    "",
    "TEST FIRST: write vitest for keyboard nav",
    "VERIFY: pnpm --filter web exec vitest run",
  ].join("\n");

  it("estimates ~chars/4", () => {
    expect(estimatePromptTokens("abcd")).toBe(1);
    expect(estimatePromptTokens("a".repeat(8))).toBe(2);
  });

  it("reserves output headroom inside the served window", () => {
    // 131072 * 0.15 = 19660.8 → clamped to MAX 8192
    const budget = computeInputTokenBudget(131_072);
    expect(budget).toBe(131_072 - 8_192);
    // tiny window: still leave MIN reserve, budget floored at MIN_INPUT
    const small = computeInputTokenBudget(3_000);
    expect(small).toBeGreaterThanOrEqual(OPENCODE_OUTPUT_RESERVE_MIN_TOKENS > 3_000 ? 1_024 : 3_000 - OPENCODE_OUTPUT_RESERVE_MIN_TOKENS);
  });

  it("passes through when served context is unknown", () => {
    const res = trimTaskPromptToContext({ prompt: samplePrompt, servedContextTokens: null });
    expect(res.fit).toBe(true);
    expect(res.trimmed).toBe(false);
    expect(res.prompt).toBe(samplePrompt);
    expect(res.budgetTokens).toBeNull();
  });

  it("does not trim when the prompt already fits", () => {
    const res = trimTaskPromptToContext({
      prompt: samplePrompt,
      servedContextTokens: 131_072,
    });
    expect(res.fit).toBe(true);
    expect(res.trimmed).toBe(false);
    expect(res.prompt).toBe(samplePrompt);
    expect(res.estimatedTokens).toBeLessThanOrEqual(res.budgetTokens!);
  });

  it("trims prior results then project context to fit a tight local window", () => {
    // Oversized soft context (~40k chars ≈ 10k tokens) vs a 4k-token input budget.
    const bulky = [
      "You are a software engineer.",
      "",
      "PROJECT CONTEXT:",
      "P".repeat(20_000),
      "",
      "RESULTS FROM PRIOR TASKS:",
      "R".repeat(20_000),
      "",
      "DPF BUILD DISCIPLINE (MANDATORY):",
      "- GROUND DOMAIN FACTS",
      "",
      "CRITICAL: This is a pnpm monorepo. Working directory is /workspace.",
      "",
      "TASK: Build accessible calendar grid component",
      "",
      "Implement the calendar grid with keyboard navigation.",
      "",
      "FILES (use these exact paths):",
      "- apps/web/components/calendar-grid.tsx (create): accessible grid",
      "",
      "TEST FIRST: write vitest for keyboard nav",
      "VERIFY: pnpm --filter web exec vitest run",
    ].join("\n");
    const res = trimTaskPromptToContext({
      prompt: bulky,
      servedContextTokens: 5_000,
      outputReserveTokens: 1_000, // budget = 4000 tokens ≈ 16k chars
    });
    expect(res.fit).toBe(true);
    expect(res.trimmed).toBe(true);
    expect(res.estimatedTokens).toBeLessThanOrEqual(res.budgetTokens!);
    // Task core must survive
    expect(res.prompt).toContain("CRITICAL:");
    expect(res.prompt).toContain("TASK: Build accessible calendar grid component");
    expect(res.prompt).toContain("calendar-grid.tsx");
    // Soft bulk should be reduced
    expect(res.prompt.length).toBeLessThan(bulky.length);
    expect(res.prompt).toMatch(/trimmed to fit local model context window/i);
  });

  it("fails closed with an actionable message when the task core alone exceeds budget", () => {
    const hugeCore = [
      "ROLE preamble",
      "",
      "CRITICAL: monorepo root",
      "TASK: impossible",
      "X".repeat(20_000),
    ].join("\n");
    const res = trimTaskPromptToContext({
      prompt: hugeCore,
      servedContextTokens: 2_500,
      outputReserveTokens: 1_000, // budget = 1500 tokens ≈ 6k chars; core is ~5k tokens
    });
    expect(res.fit).toBe(false);
    expect(res.reason).toMatch(/exceeds the local model input budget/i);
    expect(res.reason).toMatch(/cloud|context window/i);
  });
});

describe("detectOpencodeFatalError", () => {
  it("detects a llama.cpp ContextOverflowError in the stream", () => {
    // The exact shape observed live when a codegen prompt exceeded the served
    // context window — opencode emitted this AND still exited 0.
    const stdout = [
      '{"type":"step_start","time":1}',
      '{"type":"error","timestamp":1782014385749,"error":{"name":"ContextOverflowError","data":{"message":"request (24792 tokens) exceeds the available context size (24576 tokens), try increasing it"}}}',
    ].join("\n");
    const err = detectOpencodeFatalError(stdout);
    expect(err).toContain("ContextOverflowError");
    expect(err).toContain("24792");
  });

  it("returns null for a clean stream with no error event", () => {
    const stdout = [
      '{"type":"step_start"}',
      '{"type":"tool","tool":"write","path":"a.ts"}',
      '{"type":"result","text":"done"}',
    ].join("\n");
    expect(detectOpencodeFatalError(stdout)).toBeNull();
  });

  it("tolerates non-JSON / empty lines", () => {
    expect(detectOpencodeFatalError("plain log line\n\nnot json")).toBeNull();
  });
});

describe("recordOpencodeCapacityFailure", () => {
  it("records Z.ai insufficient credits as provider capacity state", async () => {
    recordProviderCapacityStatusMock.mockResolvedValue(undefined);

    await recordOpencodeCapacityFailure({
      providerId: "zai-coding",
      output: JSON.stringify({
        error: {
          code: "1113",
          message: "Insufficient balance or no resource package. Please recharge.",
        },
      }),
    });

    expect(recordProviderCapacityStatusMock).toHaveBeenCalledWith({
      providerId: "zai-coding",
      source: "opencode",
      rawSnippet: expect.stringContaining("1113"),
      classification: expect.objectContaining({
        state: "billing_action_required",
        action: "add_credits_or_plan",
        providerCode: "1113",
      }),
    });
  });
});

describe("sandboxReachableUrl", () => {
  it("rewrites localhost to host.docker.internal preserving port", () => {
    expect(sandboxReachableUrl("http://localhost:11434/v1")).toBe("http://host.docker.internal:11434/v1");
  });

  it("rewrites 127.0.0.1 to host.docker.internal", () => {
    expect(sandboxReachableUrl("http://127.0.0.1:8000/v1")).toBe("http://host.docker.internal:8000/v1");
  });

  it("leaves docker-internal hostnames untouched", () => {
    const url = "http://model-runner.docker.internal/v1";
    expect(sandboxReachableUrl(url)).toBe(url);
  });

  it("is overridable via OPENCODE_SANDBOX_BASE_URL", () => {
    process.env.OPENCODE_SANDBOX_BASE_URL = "http://custom:9999/v1";
    try {
      expect(sandboxReachableUrl("http://localhost:11434/v1")).toBe("http://custom:9999/v1");
    } finally {
      delete process.env.OPENCODE_SANDBOX_BASE_URL;
    }
  });
});

function modelsResponse(models: Array<string | { id: string; context_length?: number }>) {
  return {
    ok: true,
    json: async () => ({
      data: models.map((m) => (typeof m === "string" ? { id: m } : m)),
    }),
  } as Response;
}

describe("preflightLocalEndpoint", () => {
  it("blocks when the endpoint is unreachable", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "qwen", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("unreachable");
  });

  it("blocks on non-200", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "qwen", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("HTTP 503");
  });

  it("blocks when no models are served", async () => {
    const fetchImpl = (async () => modelsResponse([])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("no models");
  });

  it("blocks when the requested model is absent and lists what's available", async () => {
    const fetchImpl = (async () => modelsResponse(["qwen3-coder", "gemma"])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "deepseek", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("qwen3-coder");
  });

  it("resolves the requested model when present", async () => {
    const fetchImpl = (async () => modelsResponse(["qwen3-coder", "gemma"])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "qwen3-coder", fetchImpl);
    expect(res.ok).toBe(true);
    expect(res.resolvedModel).toBe("qwen3-coder");
  });

  it("falls back to the first served CHAT model when none requested", async () => {
    const fetchImpl = (async () => modelsResponse(["first-model", "second"])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "", fetchImpl);
    expect(res.ok).toBe(true);
    expect(res.resolvedModel).toBe("first-model");
  });

  it("never auto-resolves to an embedding model — skips nomic-embed and prefers the coder (regression: build dispatched to nomic-embed-text)", async () => {
    const fetchImpl = (async () =>
      modelsResponse(["docker.io/ai/nomic-embed-text-v1.5:latest", "docker.io/ai/qwen3-coder:latest"])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "", fetchImpl);
    expect(res.ok).toBe(true);
    expect(res.resolvedModel).toBe("docker.io/ai/qwen3-coder:latest");
  });
});

describe("pickDefaultCodingModel", () => {
  it("excludes embedding/rerank/stt models", () => {
    expect(pickDefaultCodingModel(["nomic-embed-text", "bge-m3", "qwen3:8b"])).toBe("qwen3:8b");
    expect(pickDefaultCodingModel(["whisper-base", "gemma3:latest"])).toBe("gemma3:latest");
  });

  it("excludes minilm, gte, and e5 models", () => {
    expect(pickDefaultCodingModel(["all-minilm:latest", "gemma3:latest"])).toBe("gemma3:latest");
    expect(pickDefaultCodingModel(["gte-large", "qwen3:8b"])).toBe("qwen3:8b");
    expect(pickDefaultCodingModel(["e5-large", "gemma3:latest"])).toBe("gemma3:latest");
    expect(pickDefaultCodingModel(["all-minilm:latest", "gte-large", "e5-large", "qwen3:8b"])).toBe("qwen3:8b");
  });

  it("excludes all-minilm:latest even when it's the only model", () => {
    expect(pickDefaultCodingModel(["all-minilm:latest"])).toBeNull();
  });

  it("excludes all-minilm:latest when paired with other coding models", () => {
    expect(pickDefaultCodingModel(["all-minilm:latest", "qwen3:8b", "gemma3:latest"])).toBe("qwen3:8b");
  });

  it("prefers a coder model over a plain chat model", () => {
    expect(pickDefaultCodingModel(["gemma3", "qwen3-coder", "qwen3"])).toBe("qwen3-coder");
  });

  it("prefers a qwen3 model when no explicit coder is present", () => {
    expect(pickDefaultCodingModel(["gemma3", "qwen3:14b"])).toBe("qwen3:14b");
  });

  it("returns null when only non-chat models are served", () => {
    expect(pickDefaultCodingModel(["nomic-embed-text", "bge-reranker", "all-minilm:latest", "gte-large"])).toBeNull();
  });

  it("enforces the context floor only when the endpoint reports it", async () => {
    const fetchImpl = (async () =>
      modelsResponse([{ id: "tiny", context_length: 4096 }])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "tiny", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("context");
  });

  it("passes when reported context clears the floor", async () => {
    const fetchImpl = (async () =>
      modelsResponse([{ id: "big", context_length: 131072 }])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "big", fetchImpl);
    expect(res.ok).toBe(true);
  });
});

describe("buildOpencodeConfig", () => {
  it("declares a local OpenAI-compatible provider with the model and allow permission", () => {
    const cfg = JSON.parse(buildOpencodeConfig("http://host.docker.internal:11434/v1", "qwen3-coder"));
    expect(cfg.provider.local.npm).toBe("@ai-sdk/openai-compatible");
    expect(cfg.provider.local.options.baseURL).toBe("http://host.docker.internal:11434/v1");
    expect(cfg.provider.local.models["qwen3-coder"]).toBeDefined();
    expect(cfg.model).toBe("local/qwen3-coder");
    expect(cfg.permission).toBe("allow");
  });

  it("declares a credentialed remote OpenAI-compatible provider without using the local provider slot", () => {
    const cfg = JSON.parse(buildOpencodeConfig({
      providerSlug: "zai",
      displayName: "Z.ai GLM Coding",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      apiKeyEnvVar: "OPENCODE_ZAI_API_KEY",
      model: "glm-5.2",
    }));

    expect(cfg.provider.local).toBeUndefined();
    expect(cfg.provider.zai.npm).toBe("@ai-sdk/openai-compatible");
    expect(cfg.provider.zai.name).toBe("Z.ai GLM Coding");
    expect(cfg.provider.zai.options.baseURL).toBe("https://api.z.ai/api/coding/paas/v4");
    expect(cfg.provider.zai.options.apiKey).toBe("{env:OPENCODE_ZAI_API_KEY}");
    expect(cfg.provider.zai.models["glm-5.2"]).toEqual({ name: "glm-5.2" });
    expect(cfg.model).toBe("zai/glm-5.2");
    expect(cfg.permission).toBe("allow");
  });
});

describe("buildOpencodeRunnerScript", () => {
  it("runs OpenCode against a credentialed remote provider model", () => {
    const script = buildOpencodeRunnerScript({
      workdir: "/workspace",
      promptFile: "/tmp/prompt.txt",
      runnerScript: "/tmp/run.sh",
      providerSlug: "zai",
      model: "glm-5.2",
      apiKeyEnvVar: "OPENCODE_ZAI_API_KEY",
      apiKeyValue: "zai-key-with-'quote",
    });

    expect(script).toContain("export OPENCODE_ZAI_API_KEY='zai-key-with-'\"'\"'quote'");
    expect(script).toContain("opencode run --dir '/workspace' -m 'zai/glm-5.2' --format json --dangerously-skip-permissions");
    expect(script).not.toContain("OPENCODE_LOCAL_KEY");
    expect(script).not.toContain("-m local/");
  });
});

describe("summarizeOpencodeEvent", () => {
  it("summarizes a tool/file event", () => {
    expect(summarizeOpencodeEvent('{"type":"tool_use","tool":"edit","path":"apps/web/x.ts"}')).toBe("edit: apps/web/x.ts");
  });
  it("returns Thinking for reasoning events", () => {
    expect(summarizeOpencodeEvent('{"type":"thinking"}')).toBe("Thinking...");
  });
  it("ignores non-JSON and unknown lines", () => {
    expect(summarizeOpencodeEvent("plain log line")).toBeNull();
    expect(summarizeOpencodeEvent('{"type":"noise"}')).toBeNull();
  });
});

describe("extractOpencodeResult", () => {
  it("returns the last result/message text from a JSON stream", () => {
    const stream = [
      '{"type":"tool_use","tool":"edit","path":"x"}',
      '{"type":"message","text":"first"}',
      '{"type":"result","text":"final answer"}',
    ].join("\n");
    expect(extractOpencodeResult(stream)).toBe("final answer");
  });

  it("falls back to raw stdout when no recognized events", () => {
    expect(extractOpencodeResult("just text output")).toBe("just text output");
  });
});

describe("isEmbeddingModelId", () => {
  it("flags embedding / non-chat model families", () => {
    expect(isEmbeddingModelId("docker.io/ai/nomic-embed-text-v1.5:latest")).toBe(true);
    expect(isEmbeddingModelId("bge-m3")).toBe(true);
    expect(isEmbeddingModelId("all-minilm:latest")).toBe(true);
    expect(isEmbeddingModelId("whisper-base")).toBe(true);
  });
  it("does not flag coding/chat models", () => {
    expect(isEmbeddingModelId("docker.io/ai/qwen3-coder:latest")).toBe(false);
    expect(isEmbeddingModelId("gemma4:12B")).toBe(false);
  });
});

// A fetch double that branches on whether the URL is the /models list or the
// DMR /engines/_configure runtime-config endpoint.
function urlAwareFetch(opts: {
  models: string[];
  configContextSize?: number | null; // null => configure endpoint 404 (unsupported)
}) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/engines/_configure")) {
      if (opts.configContextSize === null || opts.configContextSize === undefined) {
        return { ok: false, status: 404, json: async () => [], text: async () => "" } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => [{ Backend: "llama.cpp", Model: opts.models[0], Config: { "context-size": opts.configContextSize } }],
      } as unknown as Response;
    }
    // /models list
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: opts.models.map((id) => ({ id })) }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("preflightLocalEndpoint — embedding warnings + served context (a/b)", () => {
  it("warns when an embedding model is explicitly selected", async () => {
    const fetchImpl = urlAwareFetch({ models: ["docker.io/ai/nomic-embed-text-v1.5:latest", "docker.io/ai/qwen3-coder:latest"] });
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "docker.io/ai/nomic-embed-text-v1.5:latest", fetchImpl);
    expect(res.ok).toBe(true); // served + present, but…
    expect(res.warnings?.some((w) => /embedding model/i.test(w))).toBe(true);
  });

  it("gives an actionable message when only embedding models are served", async () => {
    const fetchImpl = urlAwareFetch({ models: ["docker.io/ai/nomic-embed-text-v1.5:latest", "all-minilm:latest"] });
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/embedding/i);
    expect(res.reason).toMatch(/coding model/i);
  });

  it("reads the authoritative served context and BLOCKS below the floor", async () => {
    const fetchImpl = urlAwareFetch({ models: ["docker.io/ai/qwen3-coder:latest"], configContextSize: 4096 });
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "docker.io/ai/qwen3-coder:latest", fetchImpl, { checkServedContext: true });
    expect(res.ok).toBe(false);
    expect(res.servedContextTokens).toBe(4096);
    expect(res.reason).toMatch(/context/i);
  });

  it("passes and reports the served context when it clears the floor", async () => {
    const fetchImpl = urlAwareFetch({ models: ["docker.io/ai/qwen3-coder:latest"], configContextSize: 32768 });
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "docker.io/ai/qwen3-coder:latest", fetchImpl, { checkServedContext: true });
    expect(res.ok).toBe(true);
    expect(res.servedContextTokens).toBe(32768);
  });

  it("degrades gracefully when the runtime has no configure API (404)", async () => {
    const fetchImpl = urlAwareFetch({ models: ["docker.io/ai/qwen3-coder:latest"], configContextSize: null });
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "docker.io/ai/qwen3-coder:latest", fetchImpl, { checkServedContext: true });
    expect(res.ok).toBe(true);
    expect(res.servedContextTokens).toBeNull();
  });
});

describe("buildOpencodeInstructions — domain-fact grounding", () => {
  it("tells the build agent to ground domain facts in the codebase and never invent conventions", () => {
    // Regression: a local build invented a semantic-ID taxonomy (colon-separated
    // words) instead of DPF's real BI-/EP-/FB- codes, because the plan deferred
    // the taxonomy to a knowledge base the build agent can't reach. The fix is a
    // mandatory grounding instruction — the agent has grep/bash, so it must find
    // the real convention rather than guess.
    const instructions = buildOpencodeInstructions("software-engineer", "PROJECT CONTEXT: build a classifier");
    expect(instructions).toContain("GROUND DOMAIN FACTS");
    expect(instructions).toMatch(/NEVER INVENT/);
    expect(instructions).toMatch(/grep/);
    // it's in the MANDATORY discipline block, applied to every role
    expect(instructions).toContain("DPF BUILD DISCIPLINE (MANDATORY)");
  });

  it("includes the grounding rule for every specialist role", () => {
    for (const role of ["data-architect", "software-engineer", "frontend-engineer", "documentation-specialist", "qa-engineer"] as const) {
      expect(buildOpencodeInstructions(role, "ctx")).toContain("GROUND DOMAIN FACTS");
    }
  });
});
