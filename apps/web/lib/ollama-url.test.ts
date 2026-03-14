import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("getOllamaBaseUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OLLAMA_INTERNAL_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns OLLAMA_INTERNAL_URL when set", async () => {
    process.env.OLLAMA_INTERNAL_URL = "http://ollama:11434";
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(getOllamaBaseUrl()).toBe("http://ollama:11434");
  });

  it("strips /v1 suffix from baseUrl", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434/v1", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("strips /v1/ suffix with trailing slash", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434/v1/", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("returns baseUrl unchanged if no /v1 suffix", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("prefers endpoint over baseUrl", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434/v1", endpoint: "http://custom:9999/v1" }),
    ).toBe("http://custom:9999");
  });

  it("falls back to localhost when no provider given", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(getOllamaBaseUrl()).toBe("http://localhost:11434");
  });

  it("OLLAMA_INTERNAL_URL takes precedence over provider", async () => {
    process.env.OLLAMA_INTERNAL_URL = "http://ollama:11434";
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434/v1", endpoint: null }),
    ).toBe("http://ollama:11434");
  });
});
