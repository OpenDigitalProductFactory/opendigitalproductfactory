import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Voice Input Slice 1 / Task 11 — server-side STT readiness tests.
 *
 * Mocks prisma at module boundary so each test can shape the
 * EndpointTaskPerformance + ModelProfile + ModelProvider responses
 * without a live database.
 */

const mocks = vi.hoisted(() => ({
  findFirstPerf: vi.fn(),
  findProfile: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    endpointTaskPerformance: { findFirst: mocks.findFirstPerf },
    modelProfile: { findUnique: mocks.findProfile },
  },
}));

import { getSpeechToTextReadiness } from "./readiness";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ data: [{ id: "base" }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getSpeechToTextReadiness", () => {
  it("returns 'unconfigured' when no transcription endpoint exists (fresh install)", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce(null);
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("unconfigured");
    expect(result.providerId).toBeNull();
    // Per the never-ask-user-to-run-commands kernel commandment, the
    // operator-facing reason must not name shell.
    expect(result.reason).not.toMatch(/docker compose|docker exec|`docker/);
    expect(result.reason).toMatch(/Platform Tools|Enable/i);
  });

  it("returns 'healthy' when speaches is seeded + active + unblocked", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "base",
      modelStatus: "active",
      provider: {
        name: "Local STT (whisper-server)",
        baseUrl: "http://dpf-stt:9000",
        authMethod: "none",
        status: "active",
      },
    });
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("healthy");
    expect(result.providerId).toBe("speaches");
    expect(result.modelId).toBe("base");
    expect(result.baseUrl).toBe("http://dpf-stt:9000");
    expect(result.providerName).toBe("Local STT (whisper-server)");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://dpf-stt:9000/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns 'unhealthy' when the local sidecar health probe fails", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "base",
      modelStatus: "active",
      provider: {
        name: "Local STT (whisper-server)",
        baseUrl: "http://dpf-stt:8000",
        authMethod: "none",
        status: "active",
      },
    });
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("unhealthy");
    expect(result.reason).toMatch(/health probe/i);
    expect(result.reason).toMatch(/http:\/\/dpf-stt:8000/);
  });

  it("does not expose runner-specific network errors in operator readiness copy", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND dpf-stt"));
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "base",
      modelStatus: "active",
      provider: {
        name: "Local STT (whisper-server)",
        baseUrl: "http://dpf-stt:8000",
        authMethod: "none",
        status: "active",
      },
    });

    const result = await getSpeechToTextReadiness();

    expect(result.reason).toContain("health probe failed: endpoint unavailable");
    expect(result.reason).not.toContain("ENOTFOUND");
  });

  it("returns 'unhealthy' when the local sidecar does not advertise the selected model", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "tiny.en" }] }), { status: 200 }),
    );
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "base",
      modelStatus: "active",
      provider: {
        name: "Local STT (whisper-server)",
        baseUrl: "http://dpf-stt:9000",
        authMethod: "none",
        status: "active",
      },
    });
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("unhealthy");
    expect(result.reason).toMatch(/does not list model "base"/);
  });

  it("returns 'unhealthy' when the perf row references a missing profile", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "orphaned-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce(null);
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("unhealthy");
    expect(result.reason).toMatch(/Re-run the seed/);
  });

  it("returns 'unhealthy' when the perf row is blocked", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: true,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "base",
      modelStatus: "active",
      provider: { name: "Speaches", baseUrl: "http://dpf-stt:9000", authMethod: "none", status: "active" },
    });
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("unhealthy");
    expect(result.reason).toMatch(/blocked/i);
  });

  it("returns 'unhealthy' when the model status is not active", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "base",
      modelStatus: "retired",
      provider: { name: "Speaches", baseUrl: "http://dpf-stt:9000", authMethod: "none", status: "active" },
    });
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("unhealthy");
    expect(result.reason).toMatch(/retired/);
  });

  it("returns 'unhealthy' when the provider is unconfigured", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "base",
      modelStatus: "active",
      provider: { name: "Speaches", baseUrl: "http://dpf-stt:9000", authMethod: "none", status: "unconfigured" },
    });
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("unhealthy");
    expect(result.reason).toMatch(/unconfigured/);
  });

  it("accepts a 'degraded' provider as healthy-enough", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "base",
      modelStatus: "active",
      provider: { name: "Speaches", baseUrl: "http://dpf-stt:9000", authMethod: "none", status: "degraded" },
    });
    const result = await getSpeechToTextReadiness();
    // Degraded providers can still serve traffic — routing manifest already
    // includes both "active" and "degraded" statuses per loader.ts.
    expect(result.status).toBe("healthy");
  });
});
