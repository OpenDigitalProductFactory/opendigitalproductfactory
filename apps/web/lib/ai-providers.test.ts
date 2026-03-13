import { describe, it, expect } from "vitest";
import {
  computeTokenCost,
  computeComputeCost,
  computeNextRunAt,
  SCHEDULE_INTERVALS_MS,
  getTestUrl,
  parseModelsResponse,
} from "./ai-provider-types";

describe("computeTokenCost", () => {
  it("returns 0 for zero tokens", () => {
    expect(computeTokenCost(0, 0, 3.0, 15.0)).toBe(0);
  });

  it("computes cost for input tokens only", () => {
    // 1M input tokens at $3/M = $3.00
    expect(computeTokenCost(1_000_000, 0, 3.0, 15.0)).toBeCloseTo(3.0);
  });

  it("computes cost for output tokens only", () => {
    // 1M output tokens at $15/M = $15.00
    expect(computeTokenCost(0, 1_000_000, 3.0, 15.0)).toBeCloseTo(15.0);
  });

  it("computes combined cost", () => {
    // 500K in + 100K out = $1.50 + $1.50 = $3.00
    expect(computeTokenCost(500_000, 100_000, 3.0, 15.0)).toBeCloseTo(3.0);
  });
});

describe("computeComputeCost", () => {
  it("returns 0 for zero inference time", () => {
    expect(computeComputeCost(0, 150, 0.12)).toBe(0);
  });

  it("computes cost for 1 hour at 150W and $0.12/kWh", () => {
    // 1h = 3_600_000ms, 150W = 0.15kW, 0.15kWh * $0.12 = $0.018
    expect(computeComputeCost(3_600_000, 150, 0.12)).toBeCloseTo(0.018);
  });

  it("computes cost for 10 minutes at 300W", () => {
    // 600_000ms = 1/6 hour, 300W = 0.3kW, (1/6)*0.3*0.12 = 0.006
    expect(computeComputeCost(600_000, 300, 0.12)).toBeCloseTo(0.006);
  });
});

describe("computeNextRunAt", () => {
  it("returns null for disabled schedule", () => {
    expect(computeNextRunAt("disabled", new Date())).toBeNull();
  });

  it("adds 1 day for daily", () => {
    const now = new Date("2026-03-12T00:00:00Z");
    const next = computeNextRunAt("daily", now);
    expect(next?.getTime()).toBe(now.getTime() + SCHEDULE_INTERVALS_MS.daily);
  });

  it("adds 7 days for weekly", () => {
    const now = new Date("2026-03-12T00:00:00Z");
    const next = computeNextRunAt("weekly", now);
    expect(next?.getTime()).toBe(now.getTime() + SCHEDULE_INTERVALS_MS.weekly);
  });

  it("adds 30 days for monthly", () => {
    const now = new Date("2026-03-12T00:00:00Z");
    const next = computeNextRunAt("monthly", now);
    expect(next?.getTime()).toBe(now.getTime() + SCHEDULE_INTERVALS_MS.monthly);
  });
});

describe("getTestUrl", () => {
  it("returns baseUrl + /models for standard provider", () => {
    expect(getTestUrl({ providerId: "openai", baseUrl: "https://api.openai.com/v1", endpoint: null }))
      .toBe("https://api.openai.com/v1/models");
  });

  it("returns baseUrl + /api/tags for ollama", () => {
    expect(getTestUrl({ providerId: "ollama", baseUrl: "http://localhost:11434", endpoint: null }))
      .toBe("http://localhost:11434/api/tags");
  });

  it("returns endpoint + /models when baseUrl is null", () => {
    expect(getTestUrl({ providerId: "azure-openai", baseUrl: null, endpoint: "https://my-instance.openai.azure.com" }))
      .toBe("https://my-instance.openai.azure.com/models");
  });

  it("returns null when both baseUrl and endpoint are null", () => {
    expect(getTestUrl({ providerId: "azure-openai", baseUrl: null, endpoint: null }))
      .toBeNull();
  });
});

describe("parseModelsResponse", () => {
  it("parses OpenAI-compatible format", () => {
    const json = { data: [{ id: "gpt-4o" }, { id: "gpt-4-turbo" }] };
    const result = parseModelsResponse("openai", json);
    expect(result).toEqual([
      { modelId: "gpt-4o", rawMetadata: { id: "gpt-4o" } },
      { modelId: "gpt-4-turbo", rawMetadata: { id: "gpt-4-turbo" } },
    ]);
  });

  it("parses Ollama format", () => {
    const json = { models: [{ name: "llama3" }, { name: "mistral" }] };
    const result = parseModelsResponse("ollama", json);
    expect(result).toEqual([
      { modelId: "llama3", rawMetadata: { name: "llama3" } },
      { modelId: "mistral", rawMetadata: { name: "mistral" } },
    ]);
  });

  it("parses Cohere format", () => {
    const json = { models: [{ name: "command-r-plus" }] };
    const result = parseModelsResponse("cohere", json);
    expect(result).toEqual([{ modelId: "command-r-plus", rawMetadata: { name: "command-r-plus" } }]);
  });

  it("returns empty array for empty response", () => {
    expect(parseModelsResponse("openai", {})).toEqual([]);
    expect(parseModelsResponse("openai", { data: [] })).toEqual([]);
  });

  it("returns empty array for missing data key", () => {
    expect(parseModelsResponse("openai", { models: [] })).toEqual([]);
  });
});
