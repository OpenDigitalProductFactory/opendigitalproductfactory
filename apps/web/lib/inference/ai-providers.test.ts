import { describe, it, expect } from "vitest";
import {
  computeTokenCost,
  computeComputeCost,
  computeNextRunAt,
  SCHEDULE_INTERVALS_MS,
  getTestUrl,
  parseModelsResponse,
  getBillingLabel,
} from "./ai-provider-types";
import { generatePKCE } from "@/lib/provider-oauth";

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

describe("getBillingLabel", () => {
  it("returns explicit billingLabel when set", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: "Custom label",
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
    })).toBe("Custom label");
  });

  it("auto-generates label for token provider with prices", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: null,
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
    })).toBe("Pay-per-use · $3.00/$15.00 per M tokens");
  });

  it("auto-generates label for token provider without prices", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: null,
      inputPricePerMToken: null,
      outputPricePerMToken: null,
    })).toBe("Pay-per-use · rates vary by model");
  });

  it("auto-generates label for compute provider", () => {
    expect(getBillingLabel({
      costModel: "compute",
      billingLabel: null,
      inputPricePerMToken: null,
      outputPricePerMToken: null,
    })).toBe("Local compute · electricity cost only");
  });

  it("returns null for unknown costModel without explicit label", () => {
    expect(getBillingLabel({
      costModel: "subscription",
      billingLabel: null,
      inputPricePerMToken: null,
      outputPricePerMToken: null,
    })).toBeNull();
  });

  it("treats empty string billingLabel as absent", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: "",
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
    })).toBe("Pay-per-use · $3.00/$15.00 per M tokens");
  });

  it("formats prices with two decimal places", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: null,
      inputPricePerMToken: 1.5,
      outputPricePerMToken: 6.0,
    })).toBe("Pay-per-use · $1.50/$6.00 per M tokens");
  });
});

describe("generatePKCE", () => {
  it("generates a code_verifier of correct length", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates a code_challenge that differs from verifier", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    expect(codeChallenge).not.toBe(codeVerifier);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates unique values each call", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("PKCE S256 compliance", () => {
  it("code_challenge is SHA-256 of code_verifier in base64url", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const { createHash } = require("crypto");
    const expectedChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(codeChallenge).toBe(expectedChallenge);
  });

  it("code_verifier uses only base64url characters (no +, /, =)", () => {
    for (let i = 0; i < 10; i++) {
      const { codeVerifier } = generatePKCE();
      expect(codeVerifier).not.toMatch(/[+/=]/);
    }
  });
});
