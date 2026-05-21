// apps/web/lib/integrate/coding-agent.test.ts
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
