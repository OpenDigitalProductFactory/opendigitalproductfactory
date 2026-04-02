import { describe, expect, it } from "vitest";

describe("inference barrel export", () => {
  it("exports ai-provider-types", async () => {
    const mod = await import("./ai-provider-types");
    expect(mod).toHaveProperty("computeTokenCost");
  });

  it("exports ai-profiling", async () => {
    const mod = await import("./ai-profiling");
    expect(mod).toHaveProperty("rankProvidersByCost");
  });

  it("exports ollama-url", async () => {
    const mod = await import("./ollama-url");
    expect(mod).toHaveProperty("getOllamaBaseUrl");
  });
});
