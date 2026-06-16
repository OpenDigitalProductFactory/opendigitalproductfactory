import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    modelProfile: {
      count: vi.fn().mockResolvedValue(1),
    },
    discoveredModel: {
      aggregate: vi.fn(),
    },
  },
  syncInfraCI: vi.fn(),
}));

// Mock internal functions. ollama.ts now drives discovery/profiling/eval through
// autoDiscoverAndProfile (on activation — discover + profile + queue the
// deterministic capability eval) and queueUncalibratedModelEvals (steady-state
// catch-up calibration for models still on a seed prior).
vi.mock("./ai-provider-internals", () => ({
  autoDiscoverAndProfile: vi.fn().mockResolvedValue({ discovered: 2, profiled: 2 }),
  queueUncalibratedModelEvals: vi.fn().mockResolvedValue(0),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma, syncInfraCI } from "@dpf/db";
import { autoDiscoverAndProfile, queueUncalibratedModelEvals } from "./ai-provider-internals";
import { checkBundledProviders } from "./ollama";

const mockFindFirst = vi.mocked(prisma.modelProvider.findFirst);
const mockUpdate = vi.mocked(prisma.modelProvider.update);
const mockDiscoveredAggregate = vi.mocked(prisma.discoveredModel.aggregate);
const mockAutoDiscover = vi.mocked(autoDiscoverAndProfile);
const mockQueueEvals = vi.mocked(queueUncalibratedModelEvals);
const mockSyncInfraCI = vi.mocked(syncInfraCI);

describe("checkBundledProviders", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockUpdate.mockReset();
    mockFetch.mockReset();
    // Default: local model set was just seen, so the steady-state throttle does
    // NOT re-enumerate (BI-86CC0266). Stale-case tests override this.
    mockDiscoveredAggregate.mockReset().mockResolvedValue({ _max: { lastSeenAt: new Date() } } as any);
    mockAutoDiscover.mockReset().mockResolvedValue({ discovered: 2, profiled: 2 });
    mockQueueEvals.mockReset().mockResolvedValue(0);
    mockSyncInfraCI.mockReset();
  });

  it("activates the provider and runs auto-discover+profile when reachable and unconfigured", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "local",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    // /v1/models response (reachability check)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "llama3:8b" }, { id: "phi3:mini" }] }),
    });
    // /v1/models again (hardware info — getOllamaHardwareInfo)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "llama3:8b" }, { id: "phi3:mini" }] }),
    });

    await checkBundledProviders();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { providerId: "local" },
      data: { status: "active" },
    });
    // autoDiscoverAndProfile handles discovery + profiling + queues the eval that
    // calibrates seed scores; checkBundledProviders no longer calls the low-level
    // discover/profile functions directly.
    expect(mockAutoDiscover).toHaveBeenCalledWith("local");
  });

  it("deactivates the provider when unreachable and currently active", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "local",
      status: "active",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    await checkBundledProviders();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { providerId: "local" },
      data: { status: "inactive" },
    });
    expect(mockAutoDiscover).not.toHaveBeenCalled();
    expect(mockQueueEvals).not.toHaveBeenCalled();
    expect(mockSyncInfraCI).toHaveBeenCalledWith(
      expect.objectContaining({ status: "offline" }),
      undefined,
    );
  });

  it("leaves unconfigured status when unreachable and unconfigured", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "local",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    await checkBundledProviders();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAutoDiscover).not.toHaveBeenCalled();
  });

  it("runs auto-discover+profile via autoDiscoverAndProfile regardless of model count when unconfigured", async () => {
    // The prior count-based profiling skip (>= 20 models) lived in
    // checkBundledProviders; it is gone now that activation routes through
    // autoDiscoverAndProfile, which owns the discover+profile decision.
    mockFindFirst.mockResolvedValue({
      providerId: "local",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: Array.from({ length: 25 }, (_, i) => ({ id: `model-${i}` })) }),
    });

    await checkBundledProviders();

    expect(mockAutoDiscover).toHaveBeenCalledWith("local");
  });

  it("does nothing when the provider is not in the database", async () => {
    mockFindFirst.mockResolvedValue(null);

    await checkBundledProviders();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("queues calibration evals and refreshes hardware info when already active (steady state)", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "local",
      status: "active",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    // /v1/models (health check)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "llama3:8b" }] }),
    });
    // /v1/models (hardware info — getOllamaHardwareInfo)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "llama3:8b" }] }),
    });

    await checkBundledProviders();

    // Profiles already exist (count mocked to 1) AND the model set was just seen
    // (throttle default = fresh), so we don't re-run full discovery — but we DO
    // queue the catch-up calibration eval for any models still on a seed prior.
    expect(mockAutoDiscover).not.toHaveBeenCalled();
    expect(mockQueueEvals).toHaveBeenCalledWith("local");
    // Should update hardware info
    expect(mockSyncInfraCI).toHaveBeenCalledWith(
      expect.objectContaining({ status: "operational" }),
      expect.objectContaining({ modelCount: 1 }),
    );
  });

  it("re-enumerates in steady state when the local model set is stale (>1h since last seen) — BI-86CC0266", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "local",
      status: "active",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "ai/gemma4:12B" }] }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "ai/gemma4:12B" }] }),
    });
    // Freshest local discovery is 2h old → re-enumerate so a newly-pulled tag
    // (e.g. gemma4:12B replacing 26B/latest) gets profiled and the gone tag retired.
    mockDiscoveredAggregate.mockResolvedValue({
      _max: { lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    } as any);

    await checkBundledProviders();

    expect(mockAutoDiscover).toHaveBeenCalledWith("local");
    // Calibration catch-up still runs alongside the re-discovery.
    expect(mockQueueEvals).toHaveBeenCalledWith("local");
  });
});
