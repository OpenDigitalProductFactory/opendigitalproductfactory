import { describe, expect, it } from "vitest";
import { localToolThinkingKwargs } from "./local-tool-thinking";

describe("localToolThinkingKwargs", () => {
  it("turns thinking off only for a local call that has tools", () => {
    expect(localToolThinkingKwargs("local", 3)).toEqual({ enable_thinking: false });
  });

  it("leaves a local answer with no tools on the model default", () => {
    expect(localToolThinkingKwargs("local", 0)).toBeUndefined();
  });

  it("does not change cloud calls", () => {
    expect(localToolThinkingKwargs("anthropic-sub", 4)).toBeUndefined();
    expect(localToolThinkingKwargs("openai", 1)).toBeUndefined();
  });
});
