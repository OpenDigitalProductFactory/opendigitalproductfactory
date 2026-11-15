// apps/web/lib/routing/local-native-request.test.ts
//
// BI-8B2DB9E8. The point of this transport is the three keys /v1 silently drops:
// top_k, min_p and repeat_penalty, plus num_ctx.
import { describe, expect, it } from "vitest";
import {
  buildLocalNativeRequest,
  localNativeChatUrl,
  localNativeTransportEnabled,
} from "./local-native-request";
import type { RoutedExecutionPlan } from "./recipe-types";

function plan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "local",
    modelId: "qwen3.8-27b",
    recipeId: null,
    contractFamily: "sync.code_gen",
    executionAdapter: "chat",
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    sampling: {
      values: { temperature: 0.6, topP: 0.95, topK: 20, minP: 0 },
      provenance: {},
      mode: "thinking",
    },
    ...overrides,
  } as RoutedExecutionPlan;
}

const messages = [{ role: "user" as const, content: "hello" }];

describe("buildLocalNativeRequest", () => {
  it("carries the full Qwen3 thinking profile, including the keys /v1 drops", () => {
    const req = buildLocalNativeRequest({ modelId: "qwen3.8-27b", messages, plan: plan() });
    expect(req.options).toMatchObject({
      temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0,
    });
  });

  it("sets num_predict from the plan's output ceiling", () => {
    expect(buildLocalNativeRequest({ modelId: "m", messages, plan: plan() }).options.num_predict)
      .toBe(4096);
  });

  it("uses the served context window it is given", () => {
    const req = buildLocalNativeRequest({
      modelId: "m", messages, plan: plan(), servedContextTokens: 131072,
    });
    expect(req.options.num_ctx).toBe(131072);
  });

  it("omits num_ctx rather than guessing when the served window is unknown", () => {
    // Guessing high makes Ollama spill KV cache to host RAM — a 20-50x slowdown
    // that costs far more than the parameter is worth.
    for (const served of [null, undefined, 0]) {
      const req = buildLocalNativeRequest({
        modelId: "m", messages, plan: plan(), servedContextTokens: served,
      });
      expect(req.options.num_ctx).toBeUndefined();
    }
  });

  it("keeps the model resident", () => {
    expect(buildLocalNativeRequest({ modelId: "m", messages, plan: plan() }).keep_alive).toBe(-1);
  });

  it("passes the reasoning toggle through when effort asked for it", () => {
    const req = buildLocalNativeRequest({
      modelId: "m", messages, plan: plan({ providerSettings: { think: true } }),
    });
    expect(req.think).toBe(true);
  });

  it("leaves think unset when no effort was requested", () => {
    expect(buildLocalNativeRequest({ modelId: "m", messages, plan: plan() }).think).toBeUndefined();
  });

  it("prefers a real schema over generic JSON mode", () => {
    const schema = { type: "object", properties: { total: { type: "number" } } };
    const req = buildLocalNativeRequest({
      modelId: "m", messages, plan: plan({ responsePolicy: { strictSchema: true } }),
      jsonSchema: schema,
    });
    // A schema makes malformed output mechanically impossible; "json" only
    // guarantees the result parses.
    expect(req.format).toEqual(schema);
  });

  it("falls back to json mode when strict schema is asked for without a schema", () => {
    const req = buildLocalNativeRequest({
      modelId: "m", messages, plan: plan({ responsePolicy: { strictSchema: true } }),
    });
    expect(req.format).toBe("json");
  });

  it("constrains nothing when the contract did not ask for it", () => {
    expect(buildLocalNativeRequest({ modelId: "m", messages, plan: plan() }).format).toBeUndefined();
  });

  it("puts the system prompt first", () => {
    const req = buildLocalNativeRequest({
      modelId: "m", messages, plan: plan(), systemPrompt: "be terse",
    });
    expect(req.messages[0]).toEqual({ role: "system", content: "be terse" });
    expect(req.messages).toHaveLength(2);
  });

  it("omits tools rather than sending an empty array", () => {
    expect(buildLocalNativeRequest({ modelId: "m", messages, plan: plan(), tools: [] }).tools)
      .toBeUndefined();
  });

  it("asserts no sampling when the plan resolved none", () => {
    const req = buildLocalNativeRequest({
      modelId: "m", messages, plan: plan({ sampling: undefined }),
    });
    expect(req.options.temperature).toBeUndefined();
    expect(req.options.top_k).toBeUndefined();
  });
});

describe("localNativeChatUrl", () => {
  it("derives the native endpoint from a base url", () => {
    expect(localNativeChatUrl("http://localhost:11434")).toBe("http://localhost:11434/api/chat");
  });

  it("strips a /v1 suffix and trailing slashes", () => {
    expect(localNativeChatUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/api/chat");
    expect(localNativeChatUrl("http://localhost:11434/")).toBe("http://localhost:11434/api/chat");
  });
});

describe("localNativeTransportEnabled", () => {
  it("is off unless explicitly switched on", () => {
    // The compatibility endpoint stays the default until there is evidence from
    // a live install: this transport's response shape, streaming frames and
    // tool-call extraction are not exercised by these tests.
    for (const config of [null, undefined, {}, { enabled: false }]) {
      expect(localNativeTransportEnabled(config)).toBe(false);
    }
  });

  it("is on when an operator switched it on", () => {
    expect(localNativeTransportEnabled({ enabled: true })).toBe(true);
  });
});
