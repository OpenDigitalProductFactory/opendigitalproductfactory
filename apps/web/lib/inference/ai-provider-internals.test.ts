import { describe, expect, it } from "vitest";
import { extractTokenUsage } from "./ai-provider-internals";

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
