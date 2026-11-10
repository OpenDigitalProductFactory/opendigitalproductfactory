import { describe, expect, it, vi } from "vitest";
import { chatAdapter } from "./chat-adapter";
import type { AdapterRequest } from "./adapter-types";

function request(model: unknown, providerId = "local"): AdapterRequest {
  return {
    providerId, modelId: "requested-model",
    plan: { providerId, modelId: "requested-model", recipeId: null,
      contractFamily: "sync.chat", executionAdapter: "chat", maxTokens: 128,
      providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
    provider: { baseUrl: "http://provider.invalid/v1", headers: {} },
    messages: [{ role: "user", content: "Synthetic identity fixture" }], systemPrompt: "",
    fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model, provider: "provider-fixture", providerOnlyDetail: "not projected",
      choices: [{ message: { content: "answer" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }), { status: 200 })) as typeof fetch,
  };
}

describe("chat adapter returned model evidence", () => {
  it("projects the actual provider model without copying its response body", async () => {
    const result = await chatAdapter.execute(request("returned-model"));
    expect(result.raw).toEqual({ model: "returned-model" });
    expect(result.text).toBe("answer");
  });

  it.each([undefined, null, 42, "", "   "])("does not substitute the requested model for %s", async model => {
    const result = await chatAdapter.execute(request(model));
    expect(result.raw?.model).toBeUndefined();
  });

  it("preserves OpenRouter routing evidence beside the returned model", async () => {
    const result = await chatAdapter.execute(request("returned-model", "openrouter"));
    expect(result.raw?.model).toBe("returned-model");
    expect(result.raw?.openRouterRoutingEvidence).toBeDefined();
    expect(result.raw).not.toHaveProperty("providerOnlyDetail");
  });
});
