import { describe, expect, it } from "vitest";
import {
  estimateContextTokens,
  classifyContextPressure,
  CONTEXT_WARNING_ZONE_TOKENS,
  CONTEXT_DUMB_ZONE_TOKENS,
} from "./context-pressure";

type Msgs = Parameters<typeof estimateContextTokens>[0];

describe("estimateContextTokens", () => {
  it("estimates ~chars/4 across system prompt + string content", () => {
    const msgs = [{ role: "user", content: "x".repeat(400) }] as Msgs;
    // 400 content + 40 system = 440 chars → ceil(440/4) = 110
    expect(estimateContextTokens(msgs, "y".repeat(40))).toBe(110);
  });

  it("counts non-string content via JSON length", () => {
    const content = { parts: ["abc"] };
    const msgs = [{ role: "user", content }] as Msgs;
    expect(estimateContextTokens(msgs, "")).toBe(Math.ceil(JSON.stringify(content).length / 4));
  });

  it("includes assistant tool-call payloads in the estimate", () => {
    const withCalls = [
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "foo", arguments: "{}" }] },
    ] as Msgs;
    const without = [{ role: "assistant", content: "" }] as Msgs;
    expect(estimateContextTokens(withCalls, "")).toBeGreaterThan(estimateContextTokens(without, ""));
  });

  it("ignores toolCalls on non-assistant roles", () => {
    const msgs = [{ role: "user", content: "", toolCalls: [{ id: "t1" }] }] as Msgs;
    expect(estimateContextTokens(msgs, "")).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(estimateContextTokens([] as Msgs, "")).toBe(0);
  });
});

describe("classifyContextPressure", () => {
  it("is sharp below the warning threshold", () => {
    expect(classifyContextPressure(0).zone).toBe("sharp");
    expect(classifyContextPressure(CONTEXT_WARNING_ZONE_TOKENS - 1).zone).toBe("sharp");
  });

  it("is warning from the warning threshold up to the dumb floor", () => {
    expect(classifyContextPressure(CONTEXT_WARNING_ZONE_TOKENS).zone).toBe("warning");
    expect(classifyContextPressure(CONTEXT_DUMB_ZONE_TOKENS - 1).zone).toBe("warning");
  });

  it("is dumb at and above the dumb floor", () => {
    expect(classifyContextPressure(CONTEXT_DUMB_ZONE_TOKENS).zone).toBe("dumb");
    expect(classifyContextPressure(500_000).zone).toBe("dumb");
  });

  it("echoes the estimated tokens", () => {
    expect(classifyContextPressure(12_345).estimatedTokens).toBe(12_345);
  });

  it("keeps the thresholds ordered (sharp < warning < dumb)", () => {
    expect(CONTEXT_WARNING_ZONE_TOKENS).toBeLessThan(CONTEXT_DUMB_ZONE_TOKENS);
  });
});
