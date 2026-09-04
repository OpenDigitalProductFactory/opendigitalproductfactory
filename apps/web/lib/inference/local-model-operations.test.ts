import { beforeEach, describe, expect, it, vi } from "vitest";

const listLocalModels = vi.hoisted(() => vi.fn());
vi.mock("./local-model-management", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local-model-management")>();
  return { ...actual, listLocalModels };
});

import {
  admitLocalModelInstall,
  getLocalModelStatusSnapshot,
  localModelInstallJobId,
  localModelReferenceAliases,
  reconcileRemovedLocalModel,
  type LocalModelOperationRepository,
} from "./local-model-operations";

function repository(
  overrides: Partial<LocalModelOperationRepository> = {},
): LocalModelOperationRepository {
  return {
    admit: vi.fn().mockResolvedValue({
      admitted: true,
      row: {
        jobId: "local-model-install:abc",
        lastStatus: "queued",
        lastError: null,
        metadata: {
          modelReference: "ai/qwen3:8B-Q4_K_M",
          requestedByUserId: "operator-1",
          attempt: 1,
          transferredBytes: null,
          totalBytes: null,
          percent: null,
          message: "Waiting to download",
        },
        updatedAt: new Date("2026-08-24T01:00:00.000Z"),
      },
    }),
    update: vi.fn(),
    listRecent: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("local model durable operations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses one deterministic job identity across pull and runtime aliases", () => {
    expect(localModelInstallJobId("hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M")).toBe(
      localModelInstallJobId("huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M"),
    );
    expect(localModelInstallJobId("ai/qwen3:8B-Q4_K_M")).toMatch(
      /^local-model-install:[a-f0-9]{24}$/,
    );
  });

  it("admits a validated attempt and returns its retry-safe event identity", async () => {
    const store = repository();

    const result = await admitLocalModelInstall(
      "ai/qwen3:8B-Q4_K_M",
      "operator-1",
      store,
    );

    expect(store.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: localModelInstallJobId("ai/qwen3:8B-Q4_K_M"),
        modelReference: "ai/qwen3:8B-Q4_K_M",
        requestedByUserId: "operator-1",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        admitted: true,
        eventId: expect.stringMatching(/:1$/),
        operation: expect.objectContaining({ status: "queued", attempt: 1 }),
      }),
    );
  });

  it("does not dispatch a second event for an already-active attempt", async () => {
    const store = repository({
      admit: vi.fn().mockResolvedValue({
        admitted: false,
        row: {
          jobId: "local-model-install:active",
          lastStatus: "running",
          lastError: null,
          metadata: {
            modelReference: "ai/qwen3:8B-Q4_K_M",
            requestedByUserId: "operator-1",
            attempt: 3,
            transferredBytes: 50,
            totalBytes: 100,
            percent: 50,
            message: "Downloading",
          },
          updatedAt: new Date("2026-08-24T01:00:00.000Z"),
        },
      }),
    });

    await expect(
      admitLocalModelInstall("ai/qwen3:8B-Q4_K_M", "operator-1", store),
    ).resolves.toEqual(
      expect.objectContaining({
        admitted: false,
        eventId: expect.stringMatching(/:3$/),
        operation: expect.objectContaining({ status: "running", percent: 50 }),
      }),
    );
  });

  it("combines live DMR inventory with a bounded durable operation projection", async () => {
    listLocalModels.mockResolvedValue([
      { name: "ai/qwen3:8B-Q4_K_M", comparisonKey: "ai/qwen3:8b-q4_k_m" },
    ]);
    const store = repository({
      listRecent: vi.fn().mockResolvedValue([
        {
          jobId: "local-model-install:queued",
          lastStatus: "queued",
          lastError: null,
          metadata: {
            modelReference: "ai/qwen3:14B-Q6_K",
            requestedByUserId: "operator-1",
            attempt: 2,
            transferredBytes: null,
            totalBytes: null,
            percent: null,
            message: "Waiting to download",
          },
          updatedAt: new Date("2026-08-24T01:00:00.000Z"),
        },
      ]),
    });

    const snapshot = await getLocalModelStatusSnapshot(store);

    expect(store.listRecent).toHaveBeenCalledWith(100);
    expect(snapshot).toEqual({
      observedAt: expect.any(String),
      models: [expect.objectContaining({ name: "ai/qwen3:8B-Q4_K_M" })],
      operations: [
        expect.objectContaining({
          modelReference: "ai/qwen3:14B-Q6_K",
          status: "queued",
          attempt: 2,
        }),
      ],
    });
  });

  it("drops malformed historical metadata rather than inventing an operation", async () => {
    listLocalModels.mockResolvedValue([]);
    const store = repository({
      listRecent: vi.fn().mockResolvedValue([
        {
          jobId: "local-model-install:bad",
          lastStatus: "mystery",
          lastError: null,
          metadata: { arbitrary: true },
          updatedAt: new Date(),
        },
      ]),
    });

    await expect(getLocalModelStatusSnapshot(store)).resolves.toEqual(
      expect.objectContaining({ operations: [] }),
    );
  });

  it("enumerates stored aliases for explicit post-remove reconciliation", () => {
    expect(localModelReferenceAliases("hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M")).toEqual(
      expect.arrayContaining([
        "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
        "huggingface.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
      ]),
    );
    expect(localModelReferenceAliases("ai/nomic-embed-text-v1.5")).toEqual(
      expect.arrayContaining([
        "ai/nomic-embed-text-v1.5",
        "docker.io/ai/nomic-embed-text-v1.5",
        "docker.io/ai/nomic-embed-text-v1.5:latest",
      ]),
    );
  });

  it("retires every stored alias before reconciling the remaining inventory", async () => {
    const dependencies = {
      removeProjection: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue({ discovered: 1, newCount: 0 }),
      profile: vi.fn().mockResolvedValue({ profiled: 1, failed: 0 }),
    };

    await reconcileRemovedLocalModel("docker.io/ai/nomic-embed-text-v1.5:latest", dependencies);

    expect(dependencies.removeProjection).toHaveBeenCalledWith(expect.arrayContaining([
      "docker.io/ai/nomic-embed-text-v1.5:latest",
      "ai/nomic-embed-text-v1.5",
    ]));
    expect(dependencies.discover).toHaveBeenCalledWith("local");
    expect(dependencies.profile).toHaveBeenCalledWith("local");
  });

  it("accepts an empty post-remove inventory without inventing a profile failure", async () => {
    const dependencies = {
      removeProjection: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue({ discovered: 0, newCount: 0 }),
      profile: vi.fn(),
    };

    await expect(reconcileRemovedLocalModel("ai/only-model", dependencies)).resolves.toBeUndefined();
    expect(dependencies.profile).not.toHaveBeenCalled();
  });
});
