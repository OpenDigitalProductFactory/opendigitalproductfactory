import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("getOllamaBaseUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OLLAMA_INTERNAL_URL;
    delete process.env.LLM_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns OLLAMA_INTERNAL_URL when set", async () => {
    process.env.OLLAMA_INTERNAL_URL = "http://ollama:11434";
    const { getOllamaBaseUrl } = await import("./ollama-url");
    expect(getOllamaBaseUrl()).toBe("http://ollama:11434");
  });

  it("returns baseUrl as-is (no /v1 stripping)", async () => {
    const { getOllamaBaseUrl } = await import("./ollama-url");
    expect(
      getOllamaBaseUrl({ providerId: "local", baseUrl: "http://model-runner.docker.internal/v1", endpoint: null }),
    ).toBe("http://model-runner.docker.internal/v1");
  });

  it("returns baseUrl unchanged when it has no /v1 suffix", async () => {
    const { getOllamaBaseUrl } = await import("./ollama-url");
    expect(
      getOllamaBaseUrl({ providerId: "local", baseUrl: "http://localhost:11434", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("returns baseUrl unchanged when it has a trailing slash after /v1", async () => {
    const { getOllamaBaseUrl } = await import("./ollama-url");
    expect(
      getOllamaBaseUrl({ providerId: "local", baseUrl: "http://localhost:11434/v1/", endpoint: null }),
    ).toBe("http://localhost:11434/v1/");
  });

  it("prefers endpoint over baseUrl", async () => {
    const { getOllamaBaseUrl } = await import("./ollama-url");
    expect(
      getOllamaBaseUrl({ providerId: "local", baseUrl: "http://localhost:11434/v1", endpoint: "http://custom:9999/v1" }),
    ).toBe("http://custom:9999/v1");
  });

  it("falls back to Docker Model Runner default when no provider given", async () => {
    const { getOllamaBaseUrl } = await import("./ollama-url");
    expect(getOllamaBaseUrl()).toBe("http://model-runner.docker.internal/v1");
  });

  it("OLLAMA_INTERNAL_URL takes precedence over provider", async () => {
    process.env.OLLAMA_INTERNAL_URL = "http://ollama:11434";
    const { getOllamaBaseUrl } = await import("./ollama-url");
    expect(
      getOllamaBaseUrl({ providerId: "local", baseUrl: "http://localhost:11434/v1", endpoint: null }),
    ).toBe("http://ollama:11434");
  });

  it("LLM_BASE_URL env var takes highest priority", async () => {
    process.env.LLM_BASE_URL = "http://custom:8080/v1";
    const { getOllamaBaseUrl } = await import("./ollama-url");
    expect(getOllamaBaseUrl()).toBe("http://custom:8080/v1");
    delete process.env.LLM_BASE_URL;
  });
});

describe("getOllamaApiRoot", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OLLAMA_INTERNAL_URL;
    delete process.env.LLM_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("strips the /v1 inference prefix so /api/* hits the management root", async () => {
    // Regression: `${base}/api/tags` on the /v1 base => /v1/api/tags (404 on
    // Docker Model Runner), which silently disabled first-run auto-pull.
    const { getOllamaApiRoot } = await import("./ollama-url");
    expect(getOllamaApiRoot()).toBe("http://model-runner.docker.internal");
  });

  it("strips an /engines/v1 prefix", async () => {
    const { getOllamaApiRoot } = await import("./ollama-url");
    expect(
      getOllamaApiRoot({ providerId: "local", baseUrl: "http://model-runner.docker.internal/engines/v1", endpoint: null }),
    ).toBe("http://model-runner.docker.internal");
  });

  it("strips a /v1 with a trailing slash", async () => {
    const { getOllamaApiRoot } = await import("./ollama-url");
    expect(
      getOllamaApiRoot({ providerId: "local", baseUrl: "http://localhost:11434/v1/", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("leaves a native Ollama base URL (no /v1) unchanged", async () => {
    const { getOllamaApiRoot } = await import("./ollama-url");
    expect(
      getOllamaApiRoot({ providerId: "local", baseUrl: "http://localhost:11434", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("respects LLM_BASE_URL and strips its /v1 suffix", async () => {
    process.env.LLM_BASE_URL = "http://custom:8080/v1";
    const { getOllamaApiRoot } = await import("./ollama-url");
    expect(getOllamaApiRoot()).toBe("http://custom:8080");
    delete process.env.LLM_BASE_URL;
  });
});
