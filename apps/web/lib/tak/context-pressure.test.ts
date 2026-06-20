import { describe, expect, it } from "vitest";
import {
  estimateContextTokens,
  classifyContextPressure,
  deriveCompactionCaps,
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

describe("classifyContextPressure — ratio-of-window (BI-9679EB1A)", () => {
  it("bands by ratio when the window is known", () => {
    expect(classifyContextPressure(50_000, 200_000).zone).toBe("sharp"); // 0.25
    expect(classifyContextPressure(130_000, 200_000).zone).toBe("warning"); // 0.65
    expect(classifyContextPressure(170_000, 200_000).zone).toBe("dumb"); // 0.85
  });

  it("does not cry wolf on a large window where absolute thresholds would", () => {
    // 190k tokens is past the absolute dumb floor (180k) but only 19% of a 1M window.
    expect(classifyContextPressure(190_000).zone).toBe("dumb");
    expect(classifyContextPressure(190_000, 1_000_000).zone).toBe("sharp");
  });

  it("falls back to absolute thresholds for an unknown / non-positive window", () => {
    expect(classifyContextPressure(190_000, null).zone).toBe("dumb");
    expect(classifyContextPressure(190_000, 0).zone).toBe("dumb");
    expect(classifyContextPressure(190_000, undefined).zone).toBe("dumb");
  });
});

describe("deriveCompactionCaps (BI-9679EB1A)", () => {
  const FLOOR = { maxHistory: 24, toolCap: 1_500, textCap: 4_000 };

  it("returns the floor exactly for an unknown / non-positive window (non-regressive)", () => {
    expect(deriveCompactionCaps(undefined, FLOOR)).toEqual(FLOOR);
    expect(deriveCompactionCaps(null, FLOOR)).toEqual(FLOOR);
    expect(deriveCompactionCaps(0, FLOOR)).toEqual(FLOOR);
  });

  it("never returns a cap below the floor, even for a tiny local window", () => {
    const small = deriveCompactionCaps(8_000, FLOOR);
    expect(small.maxHistory).toBeGreaterThanOrEqual(FLOOR.maxHistory);
    expect(small.toolCap).toBeGreaterThanOrEqual(FLOOR.toolCap);
    expect(small.textCap).toBeGreaterThanOrEqual(FLOOR.textCap);
  });

  it("raises the history depth for a large window, monotonic in window size", () => {
    const w200k = deriveCompactionCaps(200_000, FLOOR);
    const w1m = deriveCompactionCaps(1_000_000, FLOOR);
    expect(w200k.maxHistory).toBeGreaterThan(FLOOR.maxHistory);
    expect(w1m.maxHistory).toBeGreaterThan(w200k.maxHistory);
    // Per-message caps stay at/above the floor (depth grows, per-msg size does not shrink).
    expect(w1m.toolCap).toBeGreaterThanOrEqual(FLOOR.toolCap);
    expect(w1m.textCap).toBeGreaterThanOrEqual(FLOOR.textCap);
  });
});
