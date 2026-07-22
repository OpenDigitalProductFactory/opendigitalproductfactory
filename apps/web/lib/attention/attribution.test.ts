import { describe, it, expect } from "vitest";
import { attentionAuthorForAgent, formatAttentionByline } from "./attribution";

describe("attentionAuthorForAgent (BI-AB12B3D3)", () => {
  it("resolves a role label for a known agent, never a persona name", () => {
    const author = attentionAuthorForAgent("coo");
    expect(author.roleLabel).toBe("COO");
    expect(author.roleLabel.toLowerCase()).not.toContain("jiminy");
  });

  it("derives a role label for an unknown agent", () => {
    expect(attentionAuthorForAgent("marketing-specialist").roleLabel).toBe("Marketing");
  });

  it("falls back to a generic AI label when the agent is missing", () => {
    expect(attentionAuthorForAgent(null).roleLabel).toBe("an AI coworker");
    expect(attentionAuthorForAgent(undefined).roleLabel).toBe("an AI coworker");
  });

  it("carries the AI client and trust level when provided", () => {
    const author = attentionAuthorForAgent("coo", { aiClient: "Claude", trustLevel: "L1" });
    expect(author.aiClient).toBe("Claude");
    expect(author.trustLevel).toBe("L1");
  });
});

describe("formatAttentionByline (BI-AB12B3D3)", () => {
  it("is always AI-labeled and never implies a human decided", () => {
    const line = formatAttentionByline({ roleLabel: "COO" });
    expect(line.startsWith("AI ·")).toBe(true);
    expect(line).toBe("AI · your COO");
    expect(line).not.toContain("decided");
  });

  it("appends the AI client when known", () => {
    expect(formatAttentionByline({ roleLabel: "COO", aiClient: "Claude" })).toBe(
      "AI · your COO · Claude",
    );
  });

  it("degrades to a generic AI label when there is no author", () => {
    expect(formatAttentionByline(undefined)).toBe("AI coworker");
    expect(formatAttentionByline(null)).toBe("AI coworker");
  });
});
