import { describe, expect, it } from "vitest";
import { formatUserBriefingMessage } from "./coworker-briefing";
import { screenInferencePayload } from "../inference/data-screening/screen-inference-payload";

function screen(content: string) {
  return screenInferencePayload({
    systemPrompt: "Help maintain the platform.",
    messages: [formatUserBriefingMessage(content)!, { role: "user", content: "Should I worry about clients behind on updates?" }],
    messageOrigins: ["user-briefing", "turn"],
    taskType: "conversation", routeContext: { sensitivity: "internal" },
  });
}

describe("user briefing does not manufacture customer records", () => {
  it("removes only the legacy identity heading before screening", () => {
    const result = screen("BRIEFING — owner@example.com\nKnown facts:\n- preference: concise replies");
    expect(result.receipt.routeEffect).toBe("allow");
    expect(result.routeContext.sensitivity).toBe("internal");
  });
  it("preserves real contact data in facts for normal screening", () => {
    const content = "BRIEFING — owner@example.com\nKnown facts:\n- customer contact: customer@example.com";
    expect(formatUserBriefingMessage(content)?.content).toContain("customer@example.com");
    expect(screen(content).receipt.routeEffect).toBe("local-only");
  });
  it("does not strip arbitrary first lines or empty content", () => {
    expect(formatUserBriefingMessage("Customer: customer@example.com")?.content).toContain("customer@example.com");
    expect(formatUserBriefingMessage(null)).toBeNull();
  });
});
