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
  },
  syncInfraCI: vi.fn(),
}));

// Mock internal functions
vi.mock("./ai-provider-internals", () => ({
  discoverModelsInternal: vi.fn().mockResolvedValue({ discovered: 2, newCount: 2 }),
  profileModelsInternal: vi.fn().mockResolvedValue({ profiled: 2, failed: 0 }),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma, syncInfraCI } from "@dpf/db";
import { discoverModelsInternal, profileModelsInternal } from "./ai-provider-internals";
import { checkBundledProviders } from "./ollama";

const mockFindFirst = vi.mocked(prisma.modelProvider.findFirst);
const mockUpdate = vi.mocked(prisma.modelProvider.update);
const mockDiscover = vi.mocked(discoverModelsInternal);
const mockProfile = vi.mocked(profileModelsInternal);
const mockSyncInfraCI = vi.mocked(syncInfraCI);

describe("checkBundledProviders", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockUpdate.mockReset();
    mockFetch.mockReset();
    mockDiscover.mockReset().mockResolvedValue({ discovered: 2, newCount: 2 });
    mockProfile.mockReset().mockResolvedValue({ profiled: 2, failed: 0 });
    mockSyncInfraCI.mockReset();
  });

  it("activates Ollama and triggers discovery when reachable and unconfigured", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    // /api/tags response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b" }, { name: "phi3:mini" }] }),
    });
    // /api/ps response (for hardware enrichment)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });
    // /api/tags again (for model count in hardware info)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b" }, { name: "phi3:mini" }] }),
    });

    await checkBundledProviders();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { providerId: "ollama" },
      data: { status: "active" },
    });
    expect(mockDiscover).toHaveBeenCalledWith("ollama");
    expect(mockProfile).toHaveBeenCalledWith("ollama");
  });

  it("deactivates Ollama when unreachable and currently active", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "active",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    await checkBundledProviders();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { providerId: "ollama" },
      data: { status: "inactive" },
    });
    expect(mockDiscover).not.toHaveBeenCalled();
    expect(mockSyncInfraCI).toHaveBeenCalledWith(
      expect.objectContaining({ status: "offline" }),
      undefined,
    );
  });

  it("leaves unconfigured status when unreachable and unconfigured", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    await checkBundledProviders();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("skips auto-profiling when model count >= 20", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: Array.from({ length: 25 }, (_, i) => ({ name: `model-${i}` })) }),
    });
    mockDiscover.mockResolvedValue({ discovered: 25, newCount: 25 });

    await checkBundledProviders();

    expect(mockDiscover).toHaveBeenCalled();
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it("does nothing when Ollama provider not in database", async () => {
    mockFindFirst.mockResolvedValue(null);

    await checkBundledProviders();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refreshes hardware info when already active and reachable (steady state)", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
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

    // Should NOT re-discover or re-profile
    expect(mockDiscover).not.toHaveBeenCalled();
    expect(mockProfile).not.toHaveBeenCalled();
    // Should update hardware info
    expect(mockSyncInfraCI).toHaveBeenCalledWith(
      expect.objectContaining({ status: "operational" }),
      expect.objectContaining({ modelCount: 1 }),
    );
  });
});
