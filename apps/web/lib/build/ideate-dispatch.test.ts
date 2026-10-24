import { describe, it, expect, vi } from "vitest";
import {
  buildResearchPrompt,
  buildIdeateRunnerScript,
  deriveSearchTerms,
  runLocalIdeateWithRetry,
  IDEATE_SOURCE_DIR,
  IDEATE_WORKING_DIR,
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

describe("buildIdeateRunnerScript — where research runs, and what it can read", () => {
  it("does NOT run claude from the repository root", () => {
    // Running FROM /workspace makes claude treat the repo as its project: it
    // walks up from cwd and loads CLAUDE.md (which imports the whole AGENTS.md
    // rulebook), settings and hooks. That turned a single-shot "return a design
    // document" call into a continuing agentic session whose reply was session
    // meta-commentary — which is what "Could not parse design document from
    // research output" actually was.
    const script = buildIdeateRunnerScript("claude", { model: "sonnet" });
    expect(script).not.toMatch(/^cd \/workspace$/m);
    expect(script).toContain(`cd ${IDEATE_WORKING_DIR}`);
  });

  it("still gives claude the repository, as an allowed directory rather than a project root", () => {
    // The neutral cwd must not cost it source access — the prompt asks it to
    // read real code. --add-dir grants the tools that directory without making
    // it the project.
    const script = buildIdeateRunnerScript("claude", { model: "sonnet" });
    expect(script).toContain(`--add-dir ${IDEATE_SOURCE_DIR}`);
  });

  it("creates the neutral directory before entering it", () => {
    const script = buildIdeateRunnerScript("claude", {});
    expect(script.indexOf(`mkdir -p ${IDEATE_WORKING_DIR}`)).toBeLessThan(
      script.indexOf(`cd ${IDEATE_WORKING_DIR}`),
    );
  });

  it("preserves the auth-mode flag from ensureClaudeAuth", () => {
    // Regression guard for the extraction: dropping bareFlag would silently
    // change how the CLI authenticates.
    expect(buildIdeateRunnerScript("claude", { claudeBareFlag: "--bare " })).toContain("claude --bare -p -");
    expect(buildIdeateRunnerScript("claude", {})).toContain("claude -p -");
  });

  it("omits the model flag when no model is pinned", () => {
    expect(buildIdeateRunnerScript("claude", { model: null })).not.toContain("--model");
    expect(buildIdeateRunnerScript("claude", { model: "sonnet" })).toContain("--model sonnet");
  });

  it("leaves grok and codex on the repository root, which is NOT yet proven safe", () => {
    // Deliberate: both plausibly have the same exposure (codex reads AGENTS.md
    // natively), but neither was measured, and changing a dispatch path blind is
    // how you trade one silent failure for another. This test records the
    // current state honestly rather than asserting it is correct.
    expect(buildIdeateRunnerScript("grok", {})).toContain(`cd ${IDEATE_SOURCE_DIR}`);
    expect(buildIdeateRunnerScript("codex", {})).toContain(`cd ${IDEATE_SOURCE_DIR}`);
  });
});
