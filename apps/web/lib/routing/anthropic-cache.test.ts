// apps/web/lib/routing/anthropic-cache.test.ts
import { describe, it, expect } from "vitest";
import { buildAnthropicSystem, type AnthropicTextBlock } from "./anthropic-cache";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "../tak/prompt-boundary";

const STABLE = "You are DPF. Identity, mode, and mission are fixed for this session.";
const DYNAMIC = "Today is 2026-06-26.\n--- PAGE DATA ---\nvolatile per-turn content";

describe("buildAnthropicSystem (BI-79A5C00F)", () => {
  it("splits on the boundary and caches ONLY the stable prefix", () => {
    const prompt = STABLE + SYSTEM_PROMPT_DYNAMIC_BOUNDARY + DYNAMIC;
    const result = buildAnthropicSystem(prompt);

    expect(Array.isArray(result)).toBe(true);
    const blocks = result as AnthropicTextBlock[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "text",
      text: STABLE,
      cache_control: { type: "ephemeral" },
    });
    expect(blocks[1]).toEqual({ type: "text", text: DYNAMIC });
    // The cached block must never contain dynamic content.
    expect(blocks[0].text).not.toContain(DYNAMIC);
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it("returns the string UNCHANGED when no boundary is present (simplest-safe)", () => {
    const prompt = "A flat prompt with no boundary marker at all.";
    expect(buildAnthropicSystem(prompt)).toBe(prompt);
  });

  it("returns unchanged when the stable prefix is empty (boundary at start)", () => {
    const prompt = SYSTEM_PROMPT_DYNAMIC_BOUNDARY + DYNAMIC;
    expect(buildAnthropicSystem(prompt)).toBe(prompt);
  });

  it("handles empty / null / undefined system prompts without throwing", () => {
    expect(buildAnthropicSystem("")).toBe("");
    expect(buildAnthropicSystem(undefined)).toBe("");
    expect(buildAnthropicSystem(null)).toBe("");
  });

  it("omits the dynamic block when nothing follows the boundary", () => {
    const prompt = STABLE + SYSTEM_PROMPT_DYNAMIC_BOUNDARY;
    const result = buildAnthropicSystem(prompt) as AnthropicTextBlock[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].cache_control).toEqual({ type: "ephemeral" });
    expect(result[0].text).toBe(STABLE);
  });
});
