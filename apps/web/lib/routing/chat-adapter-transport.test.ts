import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withInferenceCancellation } from "@/lib/inference/inference-admission";

const localLane = vi.hoisted(() => ({ withLocalInferenceLock: vi.fn() }));
vi.mock("@/lib/queue/resource-lane", () => localLane);

const aiInferenceFake = vi.hoisted(() => ({
  InferenceError: class InferenceError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly providerId: string,
    ) {
      super(message);
    }
  },
  classifyHttpError: vi.fn(),
  extractAnthropicToolCalls: vi.fn(() => []),
  extractOpenAIToolCalls: vi.fn(() => []),
  extractTextualToolCalls: vi.fn(() => ({ toolCalls: [], cleanText: "" })),
  formatMessageForAnthropic: vi.fn(),
  formatMessageForOpenAI: vi.fn(),
  formatMessageForResponses: vi.fn(),
}));
vi.mock("@/lib/routing/inference-error", () => aiInferenceFake);
vi.mock("@/lib/routing/provider-message-format", () => aiInferenceFake);

import type { AdapterRequest } from "./adapter-types";
import { chatAdapter } from "./chat-adapter";

describe("chat adapter provider transport", () => {
  beforeEach(() => { localLane.withLocalInferenceLock.mockReset().mockImplementation(work => work()); });
  afterEach(() => vi.restoreAllMocks());

  it("cancels a utility caller waiting for the GPU without issuing HTTP or wrapping cancellation as network failure", async () => {
    localLane.withLocalInferenceLock.mockImplementation((_work, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const caller = new AbortController();
    const providerFetch = vi.fn();
    const request: AdapterRequest = {
      providerId: "local", modelId: "test-model",
      plan: { providerId: "local", modelId: "test-model", recipeId: null,
        contractFamily: "sync.chat", executionAdapter: "chat", maxTokens: 128,
        providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
      provider: { baseUrl: "http://127.0.0.1:1", headers: {} },
      fetchImpl: providerFetch as typeof fetch,
      messages: [{ role: "user", content: "Classify this synthetic input." }], systemPrompt: "Bounded utility",
    };
    let result: unknown;
    const pending = withInferenceCancellation(caller.signal, () => chatAdapter.execute(request))
      .catch(error => { result = error; });
    await vi.waitFor(() => expect(localLane.withLocalInferenceLock).toHaveBeenCalledOnce());
    const reason = new Error("utility expired in GPU queue");
    caller.abort(reason);
    await Promise.resolve();
    await Promise.resolve();
    expect(result).toBe(reason);
    expect(providerFetch).not.toHaveBeenCalled();
    await pending;
  });

  it("uses the server-injected transport and preserves Gemini tool calls", async () => {
    const globalFetch = vi.fn().mockRejectedValue(new Error("poisoned process-global fetch"));
    const providerFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: "record_initiative_design_review",
                args: { decision: "pass", findings: [] },
              },
            }],
          },
        }],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 7 },
      }),
      headers: new Headers(),
    } as Response);
    vi.stubGlobal("fetch", globalFetch);
    const request: AdapterRequest = {
      providerId: "gemini",
      modelId: "gemini-3.1-pro-preview",
      plan: {
        providerId: "gemini",
        modelId: "gemini-3.1-pro-preview",
        recipeId: null,
        contractFamily: "sync.review",
        executionAdapter: "chat",
        maxTokens: 2048,
        providerSettings: {},
        toolPolicy: { toolChoice: "required" },
        responsePolicy: { terminalWriterToolName: "record_initiative_design_review" },
      },
      provider: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        headers: { "Content-Type": "application/json" },
      },
      fetchImpl: providerFetch as typeof fetch,
      messages: [{ role: "user", content: "Review the immutable design." }],
      systemPrompt: "Use the governed writer.",
    };

    const result = await chatAdapter.execute(request);

    expect(providerFetch).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: "record_initiative_design_review",
        arguments: { decision: "pass", findings: [] },
      }),
    ]);
  });
});
