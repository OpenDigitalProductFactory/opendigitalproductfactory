import { describe, it, expect } from "vitest";
import { rankProvidersByCost, buildProfilingPrompt, parseProfilingResponse } from "./ai-profiling";

describe("rankProvidersByCost", () => {
  it("ranks active providers by outputPricePerMToken ascending", () => {
    const providers = [
      { providerId: "expensive", status: "active", outputPricePerMToken: 15 },
      { providerId: "cheap", status: "active", outputPricePerMToken: 5 },
      { providerId: "mid", status: "active", outputPricePerMToken: 10 },
    ];
    expect(rankProvidersByCost(providers)).toEqual(["cheap", "mid", "expensive"]);
  });

  it("filters out inactive providers", () => {
    const providers = [
      { providerId: "active1", status: "active", outputPricePerMToken: 10 },
      { providerId: "inactive", status: "unconfigured", outputPricePerMToken: 1 },
    ];
    expect(rankProvidersByCost(providers)).toEqual(["active1"]);
  });

  it("puts null pricing last", () => {
    const providers = [
      { providerId: "priced", status: "active", outputPricePerMToken: 10 },
      { providerId: "free", status: "active", outputPricePerMToken: null },
    ];
    expect(rankProvidersByCost(providers)).toEqual(["priced", "free"]);
  });
});

describe("buildProfilingPrompt", () => {
  it("includes model IDs and provider name in prompt", () => {
    const models = [{ modelId: "gpt-4o", providerName: "OpenAI", rawMetadata: { id: "gpt-4o" } }];
    const prompt = buildProfilingPrompt(models);
    expect(prompt).toContain("gpt-4o");
    expect(prompt).toContain("OpenAI");
    expect(prompt).toContain("non-technical");
  });
});

describe("parseProfilingResponse", () => {
  it("parses valid JSON array", () => {
    const text = JSON.stringify([{
      modelId: "gpt-4o",
      friendlyName: "Smart Worker",
      summary: "A versatile model",
      capabilityTier: "fast-worker",
      costTier: "$$",
      bestFor: ["writing", "analysis"],
      avoidFor: ["batch jobs"],
      contextWindow: "Large (128K)",
      speedRating: "Fast",
    }]);
    const result = parseProfilingResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.friendlyName).toBe("Smart Worker");
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseProfilingResponse("not json")).toEqual([]);
  });

  it("strips markdown code fences", () => {
    const json = JSON.stringify([{ modelId: "m1", friendlyName: "Test", summary: "S", capabilityTier: "budget", costTier: "$", bestFor: [], avoidFor: [] }]);
    const text = "```json\n" + json + "\n```";
    const result = parseProfilingResponse(text);
    expect(result).toHaveLength(1);
  });

  it("filters out items missing required fields", () => {
    const text = JSON.stringify([
      { modelId: "good", friendlyName: "Good", summary: "S" },
      { modelId: "bad" },
    ]);
    const result = parseProfilingResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.modelId).toBe("good");
  });
});
