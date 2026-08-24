import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  getSnapshot: vi.fn(),
  getServedContextInfo: vi.fn(),
}));

vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/inference/local-model-operations", () => ({
  getLocalModelStatusSnapshot: mocks.getSnapshot,
}));
vi.mock("@/lib/inference/local-model-context-reconcile", () => ({
  resolveServedContextInfo: mocks.getServedContextInfo,
}));

import { GET } from "./route";

describe("GET /api/platform/ai/local-models/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCapability.mockResolvedValue({ userId: "operator-1" });
    mocks.getServedContextInfo.mockResolvedValue({
      served: 131_072,
      target: 131_072,
      ceiling: 131_072,
      reasoningEnvelope: 30_720,
      reasoningEligible: true,
      host: { architecture: "discrete", vramGb: 24 },
      selectedModel: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
    });
  });

  it("returns a no-store authoritative snapshot", async () => {
    const snapshot = { observedAt: "2026-08-24T01:00:00.000Z", models: [], operations: [] };
    mocks.getSnapshot.mockResolvedValue(snapshot);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      ...snapshot,
      runtime: {
        reviewer: expect.objectContaining({
          role: "high-trust-reviewer",
          effectiveTimeoutMs: 600_000,
        }),
        servedContext: expect.objectContaining({
          servedTokens: 131_072,
          selectedModel: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
        }),
      },
    });
    expect(mocks.requireCapability).toHaveBeenCalledWith("manage_provider_connections");
  });

  it("uses an RFC 9457 problem response without exposing runtime errors", async () => {
    mocks.getSnapshot.mockRejectedValue(new Error("connect ECONNREFUSED private-host"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(body).toEqual(expect.objectContaining({
      type: "https://dpf.local/problems/local-model-status-unavailable",
      title: "Local model status unavailable",
      status: 503,
      correlationId: expect.any(String),
    }));
    expect(JSON.stringify(body)).not.toContain("private-host");
  });

  it("distinguishes authorization failure", async () => {
    mocks.requireCapability.mockRejectedValue(new Error("Unauthorized"));

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      type: "https://dpf.local/problems/unauthorized",
      status: 401,
    }));
  });
});
