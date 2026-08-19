import { describe, it, expect, vi } from "vitest";
import {
  buildResearchPrompt,
  deriveSearchTerms,
  runLocalIdeateWithRetry,
  LOCAL_IDEATE_MAX_ATTEMPTS,
} from "./ideate-dispatch";

describe("runLocalIdeateWithRetry", () => {
  const VALID = '```json\n{"title":"X","summary":"ok"}\n```';
  const MALFORMED = "Sure! Here is the design: it should do stuff (no JSON at all)";

  it("parses on the first attempt without a reformat call", async () => {
    const call = vi.fn(async () => VALID);
    const { designDoc, attempts } = await runLocalIdeateWithRetry(call, "base prompt");
    expect(designDoc).toEqual({ title: "X", summary: "ok" });
    expect(attempts).toBe(1);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("recovers when a malformed first turn is reformatted into valid JSON", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(MALFORMED)
      .mockResolvedValueOnce(VALID);
    const onAttempt = vi.fn();
    const { designDoc, attempts } = await runLocalIdeateWithRetry(call, "base prompt", 2, onAttempt);
    expect(designDoc).toEqual({ title: "X", summary: "ok" });
    expect(attempts).toBe(2);
    expect(call).toHaveBeenCalledTimes(2);
    // The reformat turn feeds the model its own prior output + a strict instruction.
    const secondCallMessages = call.mock.calls[1]![0] as Array<{ role: string; content: string }>;
    expect(secondCallMessages).toHaveLength(3);
    expect(secondCallMessages[1]).toEqual({ role: "assistant", content: MALFORMED });
    expect(secondCallMessages[2]!.content).toContain("valid JSON object");
    expect(onAttempt).toHaveBeenCalledWith(2);
  });

  it("gives up after the attempt cap and returns no design doc", async () => {
    const call = vi.fn(async () => MALFORMED);
    const { designDoc, attempts } = await runLocalIdeateWithRetry(call, "base prompt", LOCAL_IDEATE_MAX_ATTEMPTS);
    expect(designDoc).toBeNull();
    expect(attempts).toBe(LOCAL_IDEATE_MAX_ATTEMPTS);
    expect(call).toHaveBeenCalledTimes(LOCAL_IDEATE_MAX_ATTEMPTS);
  });
});

describe("deriveSearchTerms", () => {
  it("splits camelCase and drops boilerplate stopwords", () => {
    const terms = deriveSearchTerms("Add truncateMiddle string helper with unit tests", "A pure utility function");
    expect(terms).toContain("truncate");
    expect(terms).toContain("middle");
    expect(terms).not.toContain("add");
    expect(terms).not.toContain("helper");
  });

  it("keeps distinctive identifier terms and caps the list at 6 (title-priority)", () => {
    const terms = deriveSearchTerms("Exclude minilm models", "harden the pickDefaultCodingModel selection regex");
    expect(terms).toContain("minilm");
    expect(terms).toContain("pick"); // camelCase split of pickDefaultCodingModel
    expect(terms.length).toBeLessThanOrEqual(6);
  });

  it("returns an empty list for an all-stopword input", () => {
    expect(deriveSearchTerms("Add a helper", "with unit tests")).toEqual([]);
  });
});

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

  // Brief-drift guards (BI-4E84841D): the design researcher is the source of
  // the auto-populated Feature Brief, so its prompt must (a) carry the
  // user's explicit requirements into acceptanceCriteria untouched and
  // (b) know that internal platform/meta-features have an internal audience.
  it("instructs the researcher to preserve explicit user requirements verbatim in acceptance criteria", () => {
    const prompt = buildResearchPrompt(baseParams);
    expect(prompt).toContain("PRESERVE EXPLICIT USER REQUIREMENTS");
    expect(prompt).toMatch(/never substitute your own design choice/i);
  });

  it("asks for targetRoles with internal-meta-feature audience guidance", () => {
    const prompt = buildResearchPrompt(baseParams);
    expect(prompt).toContain('"targetRoles"');
    expect(prompt).toContain("INTERNAL platform/meta-feature");
    expect(prompt).toMatch(/never 'customer'/i);
  });
});
