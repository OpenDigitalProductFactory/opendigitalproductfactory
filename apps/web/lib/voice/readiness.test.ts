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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSpeechToTextReadiness", () => {
  it("returns 'unconfigured' when no transcription endpoint exists (fresh install)", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce(null);
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("unconfigured");
    expect(result.providerId).toBeNull();
    expect(result.reason).toMatch(/docker compose --profile stt/);
  });

  it("returns 'healthy' when speaches is seeded + active + unblocked", async () => {
    mocks.findFirstPerf.mockResolvedValueOnce({
      endpointId: "profile-cuid",
      blocked: false,
    });
    mocks.findProfile.mockResolvedValueOnce({
      providerId: "speaches",
      modelId: "Systran/faster-distil-whisper-large-v3",
      modelStatus: "active",
      provider: {
        name: "Speaches (local STT sidecar)",
        baseUrl: "http://dpf-stt:8000",
        status: "active",
      },
    });
    const result = await getSpeechToTextReadiness();
    expect(result.status).toBe("healthy");
    expect(result.providerId).toBe("speaches");
    expect(result.modelId).toBe("Systran/faster-distil-whisper-large-v3");
    expect(result.baseUrl).toBe("http://dpf-stt:8000");
    expect(result.providerName).toBe("Speaches (local STT sidecar)");
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
      modelId: "Systran/faster-distil-whisper-large-v3",
      modelStatus: "active",
      provider: { name: "Speaches", baseUrl: "http://dpf-stt:8000", status: "active" },
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
      modelId: "Systran/faster-distil-whisper-large-v3",
      modelStatus: "retired",
      provider: { name: "Speaches", baseUrl: "http://dpf-stt:8000", status: "active" },
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
      modelId: "Systran/faster-distil-whisper-large-v3",
      modelStatus: "active",
      provider: { name: "Speaches", baseUrl: "http://dpf-stt:8000", status: "unconfigured" },
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
      modelId: "Systran/faster-distil-whisper-large-v3",
      modelStatus: "active",
      provider: { name: "Speaches", baseUrl: "http://dpf-stt:8000", status: "degraded" },
    });
    const result = await getSpeechToTextReadiness();
    // Degraded providers can still serve traffic — routing manifest already
    // includes both "active" and "degraded" statuses per loader.ts.
    expect(result.status).toBe("healthy");
  });
});
