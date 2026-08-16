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

describe("trust ladder in the byline (BI-A013BBA9)", () => {
  it("renders each ladder level in plain language — who acts, on whose say-so", () => {
    const expected: Record<string, string> = {
      shadow: "observing only",
      propose: "needs your approval",
      supervised: "acts with your sign-off",
      autopilot: "acts independently",
    };
    for (const [level, phrase] of Object.entries(expected)) {
      expect(formatAttentionByline({ roleLabel: "COO", trustLevel: level })).toBe(
        `AI · your COO · ${phrase}`,
      );
    }
  });

  it("composes with the AI client", () => {
    expect(
      formatAttentionByline({ roleLabel: "COO", aiClient: "Claude", trustLevel: "propose" }),
    ).toBe("AI · your COO · Claude · needs your approval");
  });

  it("NEVER leaks an internal level name or L-shorthand into the byline", () => {
    for (const level of ["shadow", "propose", "supervised", "autopilot", "L0", "L1", "L2", "L3"]) {
      const line = formatAttentionByline({ roleLabel: "COO", trustLevel: level });
      expect(line).not.toContain(level);
    }
  });

  it("renders NOTHING for an unrecognized stored value — absence is honest, a leaked enum is not", () => {
    for (const bogus of ["L1", "trusted", "", "root"]) {
      expect(formatAttentionByline({ roleLabel: "COO", trustLevel: bogus })).toBe("AI · your COO");
    }
  });
});
