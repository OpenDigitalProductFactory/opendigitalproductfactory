import { describe, expect, it } from "vitest";

import {
  assessArchetypeFit,
  isImportedTestArtifact,
  isPublishBlockedByFit,
  worstFitSeverity,
} from "./archetype-fit";

describe("assessArchetypeFit — platform leaks (universal hard block)", () => {
  it.each([
    "Build Studio",
    "Digital Product Factory",
    "technical founders",
    "technical co-founder",
    "AI workflow",
    "agentic",
    "AI coworker",
    "SaaS",
    "self-upgrade",
    "MCP server",
    "backlog item",
    "Prisma",
    "codebase",
  ])("blocks software-platform term %s regardless of archetype", (term) => {
    const result = assessArchetypeFit({
      text: `Join our ${term} launch this weekend!`,
      category: "food-hospitality",
    });
    expect(result.severity).toBe("block");
    expect(result.blocked).toBe(true);
    expect(isPublishBlockedByFit(result)).toBe(true);
    expect(isImportedTestArtifact(result)).toBe(true);
    expect(result.summary.toLowerCase()).toContain("imported/test data");
  });

  it("flags a restaurant campaign that leaked DPF founder/AI-workflow language", () => {
    const result = assessArchetypeFit({
      text: "Meet our technical founders and see the AI workflow behind Build Studio.",
      category: "food-hospitality",
    });
    expect(result.blocked).toBe(true);
    const terms = result.findings.map((f) => f.term);
    expect(terms).toContain("technical founders");
    expect(terms).toContain("AI workflow");
    expect(terms).toContain("Build Studio");
  });
});

describe("assessArchetypeFit — restaurant vocabulary is in-archetype", () => {
  it("passes food-hospitality copy in its own vocabulary", () => {
    const result = assessArchetypeFit({
      text: "Reserve a table for our seasonal tasting menu — fill your quiet midweek covers.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("ok");
    expect(result.blocked).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it("does not trip the active category's own signature terms", () => {
    const result = assessArchetypeFit({
      text: "New dinner menu, private dining, and no-show policy update.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("ok");
  });
});

describe("assessArchetypeFit — off-archetype (warn, not block)", () => {
  it("warns when banking language appears on a restaurant surface", () => {
    const result = assessArchetypeFit({
      text: "Open an account today and lock in a 5% APY before rates change.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("warn");
    expect(result.blocked).toBe(false);
    expect(result.findings.every((f) => f.kind === "off-archetype")).toBe(true);
    expect(result.summary.toLowerCase()).toContain("confirm");
  });

  it("blocks (not just warns) when a platform leak co-occurs with off-archetype copy", () => {
    const result = assessArchetypeFit({
      text: "Open an account — powered by our SaaS platform.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("block");
  });
});

describe("assessArchetypeFit — edge cases and helpers", () => {
  it("returns ok for empty content", () => {
    expect(assessArchetypeFit({ text: "", category: "food-hospitality" }).severity).toBe("ok");
    expect(assessArchetypeFit({ text: null, category: null }).severity).toBe("ok");
  });

  it("worstFitSeverity picks the most severe across assessments", () => {
    const ok = assessArchetypeFit({ text: "Reserve a table.", category: "food-hospitality" });
    const warn = assessArchetypeFit({ text: "Open an account.", category: "food-hospitality" });
    const block = assessArchetypeFit({ text: "Build Studio launch.", category: "food-hospitality" });
    expect(worstFitSeverity([ok, warn])).toBe("warn");
    expect(worstFitSeverity([ok, warn, block])).toBe("block");
    expect(worstFitSeverity([ok])).toBe("ok");
  });
});
