import { describe, expect, it } from "vitest";
import {
  buildAutoDiscoveryEvalEvents,
  extractTokenUsage,
} from "./ai-provider-internals";

describe("extractTokenUsage", () => {
  it("reads OpenAI-compatible prompt and completion token fields", () => {
    expect(
      extractTokenUsage({
        usage: {
          prompt_tokens: 12,
          completion_tokens: 7,
        },
      }),
    ).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it("reads anthropic-style input and output token fields", () => {
    expect(
      extractTokenUsage({
        usage: {
          input_tokens: 20,
          output_tokens: 9,
        },
      }),
    ).toEqual({ inputTokens: 20, outputTokens: 9 });
  });

  it("returns undefined values when usage is missing", () => {
    expect(extractTokenUsage({})).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
    });
  });
});

describe("buildAutoDiscoveryEvalEvents", () => {
  it("uses the provider id as endpointId, not the ModelProfile row id", () => {
    const events = buildAutoDiscoveryEvalEvents("anthropic-sub", [
      { id: "cmogs56yp00018xqagh6iq4px", modelId: "claude-sonnet-4-6" },
      { id: "cmogs56z800038xqa9gwwdmlq", modelId: "claude-opus-4-6" },
    ]);

    expect(events).toEqual([
      {
        name: "ai/eval.run",
        data: {
          endpointId: "anthropic-sub",
          modelId: "claude-sonnet-4-6",
          userId: "system",
        },
      },
      {
        name: "ai/eval.run",
        data: {
          endpointId: "anthropic-sub",
          modelId: "claude-opus-4-6",
          userId: "system",
        },
      },
    ]);
  });
});
