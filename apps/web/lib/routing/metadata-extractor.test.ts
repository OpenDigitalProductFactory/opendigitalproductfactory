import { describe, expect, it } from "vitest";
import { extractModelMetadata, type ExtractedMetadata } from "./metadata-extractor";

describe("extractModelMetadata", () => {
  it("extracts OpenRouter metadata", () => {
    const raw = {
      id: "anthropic/claude-sonnet-4-5",
      context_length: 200000,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools", "structured_outputs", "temperature", "max_tokens"],
      architecture: { modality: "text+image->text" },
    };
    const result = extractModelMetadata("openrouter", "anthropic/claude-sonnet-4-5", raw);
    expect(result.maxContextTokens).toBe(200000);
    expect(result.inputPricePerMToken).toBeCloseTo(3.0);
    expect(result.outputPricePerMToken).toBeCloseTo(15.0);
    expect(result.supportsToolUse).toBe(true);
    expect(result.supportsStructuredOutput).toBe(true);
    expect(result.inputModalities).toContain("image");
  });

  it("extracts Gemini metadata", () => {
    const raw = {
      name: "models/gemini-2.0-flash",
      inputTokenLimit: 1048576,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ["generateContent"],
    };
    const result = extractModelMetadata("gemini", "gemini-2.0-flash", raw);
    expect(result.maxContextTokens).toBe(1048576);
    expect(result.maxOutputTokens).toBe(8192);
  });

  it("extracts Ollama metadata", () => {
    const raw = {
      name: "llama3.1:latest",
      size: 4661224000, // ~4.3GB ≈ 8B params
    };
    const result = extractModelMetadata("ollama", "llama3.1:latest", raw);
    expect(result.inputPricePerMToken).toBe(0);
    expect(result.outputPricePerMToken).toBe(0);
  });

  it("returns defaults for unknown provider format", () => {
    const result = extractModelMetadata("unknown-provider", "some-model", {});
    expect(result.maxContextTokens).toBeNull();
    expect(result.supportsToolUse).toBeNull();
  });
});
