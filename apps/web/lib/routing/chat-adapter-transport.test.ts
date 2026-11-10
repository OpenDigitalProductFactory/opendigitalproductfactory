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

  it("cancels the injected transport without reacquiring admission or wrapping cancellation as network failure", async () => {
    const caller = new AbortController();
    let finish!: (response: Response) => void;
    const providerFetch = vi.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        finish = resolve;
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      }));
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
    await vi.waitFor(() => expect(providerFetch).toHaveBeenCalledOnce());
    const reason = new Error("utility expired during transport");
    caller.abort(reason);
    try {
      await vi.waitFor(() => expect(result).toBe(reason), { timeout: 1_000 });
      expect(providerFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(localLane.withLocalInferenceLock).not.toHaveBeenCalled();
    } finally {
      finish(new Response(JSON.stringify({
        choices: [{ message: { content: "finished" }, finish_reason: "stop" }],
      }), { status: 200 }));
      await pending;
    }
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
