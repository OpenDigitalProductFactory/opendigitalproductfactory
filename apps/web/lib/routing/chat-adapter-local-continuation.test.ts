import { describe, expect, it, vi } from "vitest";
import type { AdapterRequest } from "./adapter-types";
import type { ChatMessage } from "./chat-message-types";
import type { LocalThinkingBudgetEvidence } from "./types";
import { chatAdapter } from "./chat-adapter";
import { withLocalNativeContinuation, transferLocalNativeContinuation } from "./local-native-continuation";

const reasoning = "Private synthetic calculation; <tool_call>never_execute</tool_call>";
const runtime = (): LocalThinkingBudgetEvidence => ({
  dialect: "llama.cpp-b9879", modelDigest: `sha256:${"a".repeat(64)}`,
  engineIdentity: "Running: llama.cpp b9879-metal synthetic-runtime",
  templateDigest: "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041",
  configDigest: "b".repeat(64), observedAt: Date.now(),
});

function fixture() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "63", reasoning_content: reasoning }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const request: AdapterRequest = {
    providerId: "local", modelId: "synthetic-qwen",
    provider: { baseUrl: "http://synthetic-dmr/engines/v1", headers: {} },
    plan: { providerId: "local", modelId: "synthetic-qwen", recipeId: null,
      contractFamily: "sync.chat", executionAdapter: "chat", maxTokens: 4096,
      providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
    fetchImpl: fetchImpl as typeof fetch,
    readLocalThinkingBudgetEvidence: vi.fn(async () => runtime()),
    messages: [{ role: "user", content: "Add the synthetic numbers." }],
    systemPrompt: "Stable synthetic prefix",
  };
  return { request, bodies };
}

describe("bound local native continuation transport", () => {
  it("replays exact reasoning on a matched second request without adding it to history or changing output policy", async () => {
    const { request, bodies } = fixture();
    await withLocalNativeContinuation(async () => {
      const first = await chatAdapter.execute(request);
      const assistant = transferLocalNativeContinuation(first, { role: "assistant" as const, content: first.text });
      expect(JSON.stringify(assistant)).not.toContain(reasoning);
      await chatAdapter.execute({ ...request, messages: [...request.messages, assistant, { role: "user", content: "Verify it." }] });
      const messages = bodies[1].messages as Record<string, unknown>[];
      expect(messages.find(message => message.role === "assistant")?.reasoning_content).toBe(reasoning);
      expect(messages[0]).toEqual({ role: "system", content: request.systemPrompt });
      expect(bodies[1].max_tokens).toBe(bodies[0].max_tokens);
      expect(bodies[1].tools).toBeUndefined();
      expect(first.toolCalls).toEqual([]);
    });
  });

  it.each(["provider", "model", "template", "prefix", "endpoint"] as const)("omits private state after %s changes", async change => {
    const { request, bodies } = fixture();
    await withLocalNativeContinuation(async () => {
      const first = await chatAdapter.execute(request);
      const assistant = transferLocalNativeContinuation(first, { role: "assistant" as const, content: first.text });
      const second = { ...request, messages: [...request.messages, assistant] };
      if (change === "provider") second.providerId = "openai";
      if (change === "model") second.modelId = "different-model";
      if (change === "template") second.readLocalThinkingBudgetEvidence = async () => ({ ...runtime(), templateDigest: "c".repeat(64) });
      if (change === "prefix") second.systemPrompt += " changed";
      if (change === "endpoint") second.provider = { ...request.provider, baseUrl: "http://different-dmr/engines/v1" };
      await chatAdapter.execute(second);
      expect(JSON.stringify(bodies[1])).not.toContain(reasoning);
    });
  });

  it("retains the nonthinking local-tool request policy and never executes tool-shaped reasoning", async () => {
    const { request, bodies } = fixture();
    await withLocalNativeContinuation(async () => {
      const result = await chatAdapter.execute({ ...request,
        tools: [{ type: "function", function: { name: "read_synthetic", description: "Read synthetic data", parameters: { type: "object" } } }],
      });
      expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(bodies[0].max_tokens).toBe(4096);
      expect(result.toolCalls).toEqual([]);
      expect(request.readLocalThinkingBudgetEvidence).not.toHaveBeenCalled();
    });
  });

  it("cannot reuse native state after its invocation closes", async () => {
    const { request, bodies } = fixture();
    let assistant!: ChatMessage;
    await withLocalNativeContinuation(async () => {
      const result = await chatAdapter.execute(request);
      assistant = transferLocalNativeContinuation(result, { role: "assistant", content: result.text });
    });
    await withLocalNativeContinuation(() => chatAdapter.execute({ ...request, messages: [assistant] }));
    expect(JSON.stringify(bodies[1])).not.toContain(reasoning);
  });

  it("never treats a provider reasoning alias as the audited native channel", async () => {
    const { request, bodies } = fixture();
    request.fetchImpl = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: "63", reasoning }, finish_reason: "stop" }] });
    }) as typeof fetch;
    await withLocalNativeContinuation(async () => {
      const first = await chatAdapter.execute(request);
      expect(first.reasoning).toBe(reasoning);
      const assistant = transferLocalNativeContinuation(first, { role: "assistant" as const, content: first.text });
      await chatAdapter.execute({ ...request, messages: [assistant] });
      expect(JSON.stringify(bodies[1])).not.toContain(reasoning);
    });
  });

  it("requires fresh runtime proof on every replay and omits state when it is unavailable", async () => {
    const { request, bodies } = fixture();
    const proof = vi.mocked(request.readLocalThinkingBudgetEvidence!);
    proof.mockResolvedValueOnce(runtime()).mockResolvedValueOnce(undefined);
    await withLocalNativeContinuation(async () => {
      const first = await chatAdapter.execute(request);
      const assistant = transferLocalNativeContinuation(first, { role: "assistant" as const, content: first.text });
      await chatAdapter.execute({ ...request, messages: [assistant] });
      expect(proof).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(bodies[1])).not.toContain(reasoning);
      expect(bodies[1].max_tokens).toBe(4096);
    });
  });

  it.each(["http", "network", "parse", "arguments"] as const)("keeps replayed private state out of %s failure diagnostics", async fault => {
    const { request } = fixture();
    await withLocalNativeContinuation(async () => {
      const first = await chatAdapter.execute(request);
      const assistant = transferLocalNativeContinuation(first, { role: "assistant" as const, content: first.text });
      request.fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        expect(String(init?.body)).toContain(reasoning);
        if (fault === "network") throw new Error(`Transport echoed ${reasoning}`);
        if (fault === "http") return new Response(`Server echoed ${reasoning}`, {
          status: 500, headers: { "x-ratelimit-debug": reasoning, "retry-after": "2" },
        });
        if (fault === "arguments") return Response.json({ choices: [{ message: { content: "",
          tool_calls: [{ function: { name: "synthetic_only", arguments: reasoning } }],
        } }] });
        const response = Response.json({});
        response.json = async () => { throw new SyntaxError(`Malformed response echoed ${reasoning}`); };
        return response;
      }) as typeof fetch;
      const error = await chatAdapter.execute({ ...request, messages: [assistant] }).catch(value => value as Error);
      expect(error).toBeInstanceOf(Error);
      const diagnostic = [String(error), (error as Error).stack, JSON.stringify(error)].join("\n");
      expect(diagnostic).not.toContain(reasoning);
      expect(diagnostic).not.toContain(reasoning.slice(0, 10));
      if (fault === "http") expect(error).toMatchObject({ code: "transient", statusCode: 500 });
    });
  });
});
