import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/inference/routed-inference", () => ({
  routeAndCall: vi.fn().mockResolvedValue({
    content:
      "• Database schema extended with Workroom model\n" +
      "• REST endpoints designed at /api/work-capsules\n" +
      "• Auth pattern confirmed: uses existing auth() middleware\n" +
      "• Open: need to confirm FK relationship with FeatureBuild",
    providerId: "anthropic-sub",
    modelId: "claude-haiku-4-5-20251001",
    inputTokens: 300,
    outputTokens: 60,
  }),
}));

import { compactPhase } from "./phase-compaction";
import type { ChatMessage } from "@/lib/ai-inference";

function makePhaseMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Turn ${i + 1}: discussion about design decisions for the feature.`,
  }));
}

describe("compactPhase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a ChatMessage with [PHASE HANDOFF] prefix", async () => {
    const messages = makePhaseMessages(8);
    const result = await compactPhase("ideate", messages);

    expect(result.role).toBe("user");
    expect(typeof result.content).toBe("string");
    expect(result.content as string).toMatch(/\[IDEATE PHASE HANDOFF/);
  });

  it("includes the turn count in the handoff message", async () => {
    const messages = makePhaseMessages(12);
    const result = await compactPhase("design", messages);
    expect(result.content as string).toContain("12 turns");
  });

  it("embeds the LLM summary in the handoff content", async () => {
    const messages = makePhaseMessages(5);
    const result = await compactPhase("implement", messages);
    expect(result.content as string).toContain("Workroom model");
  });

  it("returns a fallback message when routeAndCall throws", async () => {
    const { routeAndCall } = await import("@/lib/inference/routed-inference");
    vi.mocked(routeAndCall).mockRejectedValueOnce(new Error("provider unavailable"));

    const messages = makePhaseMessages(6);
    const result = await compactPhase("review", messages);

    expect(result.role).toBe("user");
    expect(result.content as string).toMatch(/\[REVIEW PHASE HANDOFF\]/);
    expect(result.content as string).toContain("summary unavailable");
  });
});
