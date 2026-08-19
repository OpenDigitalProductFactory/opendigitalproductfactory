// apps/web/lib/build/coding-agent.test.ts
// Regression tests for null-brief guard in buildCodeGenPrompt.
// FB-71FB3A53: builds whose FeatureBuild.brief is null (ideate phase never
// completed) crashed stepGenerateCode with "Cannot read properties of null
// (reading 'title')".

import { vi, describe, it, expect } from "vitest";
import type { FeatureBrief } from "@/lib/feature-build-types";

// Mock server-only dependencies that coding-agent.ts imports at module level
// so the pure buildCodeGenPrompt function can be exercised in isolation.
vi.mock("@/lib/sandbox", () => ({ execInSandbox: vi.fn() }));
vi.mock("@/lib/ai-provider-priority", () => ({ getProviderPriority: vi.fn() }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

const { buildCodeGenPrompt } = await import("./coding-agent");

describe("buildCodeGenPrompt", () => {
  it("does not throw when brief is null (FB-71FB3A53 regression)", () => {
    expect(() => buildCodeGenPrompt(null, {})).not.toThrow();
  });

  it("returns a non-empty prompt when brief is null", () => {
    const result = buildCodeGenPrompt(null, {});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses fallback placeholders when brief is null", () => {
    const result = buildCodeGenPrompt(null, {});
    expect(result).toContain("(no title)");
    expect(result).toContain("Not specified");
  });

  it("includes brief fields when brief is provided", () => {
    const brief: FeatureBrief = {
      title: "Ollama backend build",
      description: "Adds Ollama as a local AI provider",
      portfolioContext: "platform",
      targetRoles: ["Admin"],
      inputs: [],
      dataNeeds: "None",
      acceptanceCriteria: ["Ollama routes requests", "Health check passes"],
    };
    const result = buildCodeGenPrompt(brief, {});
    expect(result).toContain("Ollama backend build");
    expect(result).toContain("Adds Ollama as a local AI provider");
    expect(result).toContain("Ollama routes requests");
    expect(result).toContain("Health check passes");
  });

  it("handles an empty plan without throwing", () => {
    expect(() => buildCodeGenPrompt(null, {})).not.toThrow();
    expect(() => buildCodeGenPrompt(null, { fileStructure: [], tasks: [] })).not.toThrow();
  });
});

const { deriveScopedTestFiles, groupTestFilesByPackage } = await import("./coding-agent");

describe("deriveScopedTestFiles", () => {
  it("includes changed test files directly", () => {
    expect(deriveScopedTestFiles(["apps/web/lib/utils/string-helpers.test.ts"]))
      .toContain("apps/web/lib/utils/string-helpers.test.ts");
  });

  it("derives sibling test candidates for a changed source file", () => {
    const result = deriveScopedTestFiles(["apps/web/lib/utils/string-helpers.ts"]);
    expect(result).toContain("apps/web/lib/utils/string-helpers.test.ts");
    expect(result).toContain("apps/web/lib/utils/string-helpers.test.tsx");
  });

  it("returns an empty list when nothing testable changed", () => {
    expect(deriveScopedTestFiles(["README.md", "package.json", ""])).toEqual([]);
  });

  it("does not duplicate when both source and its test changed", () => {
    const result = deriveScopedTestFiles([
      "apps/web/lib/utils/string-helpers.ts",
      "apps/web/lib/utils/string-helpers.test.ts",
    ]);
    const occurrences = result.filter((p) => p === "apps/web/lib/utils/string-helpers.test.ts");
    expect(occurrences).toHaveLength(1);
  });
});

describe("groupTestFilesByPackage", () => {
  it("groups files by their apps/* or packages/* workspace root", () => {
    const grouped = groupTestFilesByPackage([
      "apps/web/lib/a.test.ts",
      "apps/web/lib/b.test.ts",
      "packages/db/src/c.test.ts",
    ]);
    expect(grouped.get("apps/web")).toEqual(["lib/a.test.ts", "lib/b.test.ts"]);
    expect(grouped.get("packages/db")).toEqual(["src/c.test.ts"]);
  });

  it("ignores paths outside a workspace package", () => {
    const grouped = groupTestFilesByPackage(["scripts/x.test.ts", "foo.test.ts"]);
    expect(grouped.size).toBe(0);
  });
});

const { outputIndicatesTestFailure } = await import("./coding-agent");

describe("outputIndicatesTestFailure", () => {
  it("detects failures in ANSI-colored vitest output (regression: color code defeats \\b)", () => {
    // The real bug: `\x1b[31m` ends in "m" (a word char) directly before the
    // digit, so `\b[1-9]` never matches a colored "3 failed". This exact string
    // returned false before the ANSI strip.
    const ansi = " Tests \x1b[22m \x1b[1m\x1b[31m3 failed\x1b[39m\x1b[2m | \x1b[22m\x1b[1m\x1b[32m2 passed\x1b[39m (5)";
    expect(outputIndicatesTestFailure(ansi)).toBe(true);
  });

  it("returns false for an all-passing ANSI summary", () => {
    const ansi = " Tests \x1b[1m\x1b[32m5 passed\x1b[39m (5)";
    expect(outputIndicatesTestFailure(ansi)).toBe(false);
  });

  it("detects an ANSI FAIL marker line", () => {
    const ansi = "\x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m lib/utils/string-helpers.test.ts";
    expect(outputIndicatesTestFailure(ansi)).toBe(true);
  });

  it("works on plain (non-colored) output too", () => {
    expect(outputIndicatesTestFailure("Tests  3 failed | 2 passed")).toBe(true);
    expect(outputIndicatesTestFailure("Tests  5 passed (5)")).toBe(false);
  });
});
