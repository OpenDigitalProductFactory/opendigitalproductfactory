import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-inference", () => ({
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

import type { AdapterRequest } from "./adapter-types";
import { chatAdapter } from "./chat-adapter";

describe("chat adapter provider transport", () => {
  afterEach(() => vi.restoreAllMocks());

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
