import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  listLocalModels: vi.fn(),
  removeLocalModel: vi.fn(),
  admitLocalModelInstall: vi.fn(),
  updateLocalModelOperation: vi.fn(),
  reconcileRemovedLocalModel: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/inference/local-model-management", () => ({
  listLocalModels: mocks.listLocalModels,
  removeLocalModel: mocks.removeLocalModel,
  LocalModelManagementError: class extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
vi.mock("@/lib/inference/local-model-operations", () => ({
  admitLocalModelInstall: mocks.admitLocalModelInstall,
  updateLocalModelOperation: mocks.updateLocalModelOperation,
  reconcileRemovedLocalModel: mocks.reconcileRemovedLocalModel,
}));
vi.mock("@/lib/queue/local-model-install-events", () => ({
  enqueueLocalModelInstall: mocks.send,
}));

import {
  deleteOllamaModel,
  listOllamaModels,
  pullOllamaModel,
} from "./ollama-management";

describe("local model management actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCapability.mockResolvedValue({ userId: "operator-1" });
    mocks.listLocalModels.mockResolvedValue([]);
    mocks.removeLocalModel.mockResolvedValue({ alreadyAbsent: false });
    mocks.reconcileRemovedLocalModel.mockResolvedValue(undefined);
    mocks.updateLocalModelOperation.mockResolvedValue(undefined);
    mocks.send.mockResolvedValue({ ids: ["event-1"] });
  });

  it("lists authoritative runtime inventory without inventing disk size", async () => {
    mocks.listLocalModels.mockResolvedValue([
      { name: "ai/qwen3:8B-Q4_K_M", sizeBytes: null, sizeLabel: null },
    ]);

    await expect(listOllamaModels()).resolves.toEqual({
      ok: true,
      data: [expect.objectContaining({ name: "ai/qwen3:8B-Q4_K_M", sizeBytes: null })],
    });
    expect(mocks.requireCapability).toHaveBeenCalledWith("manage_provider_connections");
  });

  it("admits and dispatches one retry-safe background install", async () => {
    mocks.admitLocalModelInstall.mockResolvedValue({
      admitted: true,
      eventId: "local-model-install:abc:1",
      operation: { jobId: "local-model-install:abc", attempt: 1, status: "queued" },
    });

    await expect(pullOllamaModel("ai/qwen3:8B-Q4_K_M")).resolves.toEqual({
      ok: true,
      data: expect.objectContaining({ operationId: "local-model-install:abc", status: "queued" }),
    });
    expect(mocks.send).toHaveBeenCalledWith(
      {
        jobId: "local-model-install:abc",
        attempt: 1,
        modelReference: "ai/qwen3:8B-Q4_K_M",
        requestedByUserId: "operator-1",
      },
      "local-model-install:abc:1",
    );
  });

  it("returns an existing active install without dispatching a duplicate", async () => {
    mocks.admitLocalModelInstall.mockResolvedValue({
      admitted: false,
      eventId: "local-model-install:abc:3",
      operation: { jobId: "local-model-install:abc", attempt: 3, status: "running" },
    });

    await expect(pullOllamaModel("ai/qwen3:8B-Q4_K_M")).resolves.toEqual({
      ok: true,
      data: expect.objectContaining({ operationId: "local-model-install:abc", status: "running" }),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("marks admission failed when background dispatch fails", async () => {
    mocks.admitLocalModelInstall.mockResolvedValue({
      admitted: true,
      eventId: "local-model-install:abc:2",
      operation: { jobId: "local-model-install:abc", attempt: 2, status: "queued" },
    });
    mocks.send.mockRejectedValue(new Error("secret queue endpoint refused"));

    await expect(pullOllamaModel("ai/qwen3:8B-Q4_K_M")).resolves.toEqual({
      ok: false,
      error: "The model install could not be started. Try again.",
    });
    expect(mocks.updateLocalModelOperation).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "local-model-install:abc",
      attempt: 2,
      status: "failed",
    }));
  });

  it("removes through the runtime and immediately reconciles routing projections", async () => {
    await expect(deleteOllamaModel("ai/nomic-embed-text-v1.5")).resolves.toEqual({
      ok: true,
      data: { alreadyAbsent: false },
    });
    expect(mocks.removeLocalModel).toHaveBeenCalledWith("ai/nomic-embed-text-v1.5");
    expect(mocks.reconcileRemovedLocalModel).toHaveBeenCalledWith("ai/nomic-embed-text-v1.5");
  });

  it("returns bounded in-product errors and never terminal instructions", async () => {
    mocks.listLocalModels.mockRejectedValue(new Error("connect ECONNREFUSED private-host"));

    const result = await listOllamaModels();
    expect(result).toEqual({ ok: false, error: "The installed model list is unavailable." });
    expect(JSON.stringify(result)).not.toMatch(/docker model|powershell|terminal|private-host/i);
  });
});
