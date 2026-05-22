import { describe, it, expect } from "vitest";
import { buildResearchPrompt } from "./ideate-dispatch";

describe("buildResearchPrompt", () => {
  const baseParams = {
    featureTitle: "Test feature",
    featureDescription: "Test description",
    reusabilityScope: "one-off",
    userContext: "test user",
  };

  it("includes scout findings when arrays are populated", () => {
    const prompt = buildResearchPrompt({
      ...baseParams,
      scoutFindings: {
        relatedModels: [
          { name: "User", file: "schema.prisma", line: 42 },
          { name: "Org", file: "schema.prisma", line: 78 },
        ],
        gaps: [{ entity: "PermissionScope", reason: "no model exists" }],
        suggestedQuestions: [],
      },
    });

    expect(prompt).toContain("Related models found: User at schema.prisma:42, Org at schema.prisma:78");
    expect(prompt).toContain("Gaps identified: PermissionScope — no model exists");
  });

  it("does not throw when scoutFindings.relatedModels is undefined", () => {
    // Regression: type says required, but runtime JSON can omit fields. The
    // pre-fix path crashed with "Cannot read properties of undefined (reading 'map')"
    // on the first BS dispatch of a fresh build, before any scout has run.
    expect(() =>
      buildResearchPrompt({
        ...baseParams,
        scoutFindings: {
          // @ts-expect-error — intentionally simulating partial JSON shape
          relatedModels: undefined,
          gaps: [{ entity: "X", reason: "y" }],
          suggestedQuestions: [],
        },
      }),
    ).not.toThrow();

    const prompt = buildResearchPrompt({
      ...baseParams,
      scoutFindings: {
        // @ts-expect-error
        relatedModels: undefined,
        gaps: [],
        suggestedQuestions: [],
      },
    });
    expect(prompt).toContain("Related models found: (none reported)");
  });

  it("does not throw when scoutFindings.gaps is undefined", () => {
    expect(() =>
      buildResearchPrompt({
        ...baseParams,
        scoutFindings: {
          relatedModels: [],
          // @ts-expect-error — intentionally simulating partial JSON shape
          gaps: undefined,
          suggestedQuestions: [],
        },
      }),
    ).not.toThrow();

    const prompt = buildResearchPrompt({
      ...baseParams,
      scoutFindings: {
        relatedModels: [],
        // @ts-expect-error
        gaps: undefined,
        suggestedQuestions: [],
      },
    });
    expect(prompt).toContain("Gaps identified: (none reported)");
  });

  it("omits the SCOUT FINDINGS block entirely when scoutFindings is undefined", () => {
    const prompt = buildResearchPrompt(baseParams);
    expect(prompt).not.toContain("SCOUT FINDINGS");
  });
});
