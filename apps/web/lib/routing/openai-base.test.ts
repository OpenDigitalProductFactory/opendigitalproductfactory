import { describe, expect, it } from "vitest";

import { resolveOpenAiCompatibleApiBase } from "./openai-base";

describe("resolveOpenAiCompatibleApiBase (BI-B6B8C1F9)", () => {
  it("appends /v1 to an unversioned base", () => {
    expect(resolveOpenAiCompatibleApiBase("http://localhost:11434")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("keeps a base already ending in /v1", () => {
    expect(resolveOpenAiCompatibleApiBase("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("keeps a base carrying its own version segment (Z.ai /v4)", () => {
    expect(resolveOpenAiCompatibleApiBase("https://api.z.ai/api/coding/paas/v4")).toBe(
      "https://api.z.ai/api/coding/paas/v4",
    );
  });

  it("normalises a trailing slash before deciding", () => {
    expect(resolveOpenAiCompatibleApiBase("https://api.z.ai/api/paas/v4/")).toBe(
      "https://api.z.ai/api/paas/v4",
    );
    expect(resolveOpenAiCompatibleApiBase("http://localhost:11434/")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("does not treat a non-version path segment as a version", () => {
    expect(resolveOpenAiCompatibleApiBase("https://example.com/vault")).toBe(
      "https://example.com/vault/v1",
    );
  });
});
