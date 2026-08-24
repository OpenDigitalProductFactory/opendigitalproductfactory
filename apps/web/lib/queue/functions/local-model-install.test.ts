import { describe, expect, it, vi } from "vitest";

vi.mock("../inngest-client", () => ({
  inngest: { createFunction: vi.fn(() => ({ id: "local-model-install" })) },
}));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: vi.fn() }));
vi.mock("@/lib/inference/local-model-management", () => ({ installLocalModel: vi.fn() }));
vi.mock("@/lib/inference/local-model-operations", () => ({
  updateLocalModelOperation: vi.fn(),
}));
vi.mock("@/lib/inference/ai-provider-internals", () => ({
  discoverModelsInternal: vi.fn(),
  profileModelsInternal: vi.fn(),
}));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { broadcastSystem: vi.fn() },
}));

import { runLocalModelInstall, type LocalModelInstallDependencies } from "./local-model-install";

function dependencies(
  overrides: Partial<LocalModelInstallDependencies> = {},
): LocalModelInstallDependencies {
  return {
    update: vi.fn().mockResolvedValue({}),
    install: vi.fn().mockImplementation(async (_reference, onProgress) => {
      await onProgress({ transferredBytes: 25, totalBytes: 100, percent: 25, message: "Downloading" });
      await onProgress({ transferredBytes: 100, totalBytes: 100, percent: 100, message: "Downloaded" });
    }),
    discover: vi.fn().mockResolvedValue({ discovered: 1, newCount: 1 }),
    profile: vi.fn().mockResolvedValue({ profiled: 1, failed: 0 }),
    emit: vi.fn(),
    ...overrides,
  };
}

const input = {
  jobId: "local-model-install:abc",
  attempt: 2,
  modelReference: "ai/qwen3:8B-Q4_K_M",
  requestedByUserId: "operator-1",
};

describe("local model install worker", () => {
  it("persists running progress, reconciles routing, and completes", async () => {
    const deps = dependencies();

    await expect(runLocalModelInstall(input, deps)).resolves.toEqual({ status: "completed" });
    expect(deps.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "running" }));
    expect(deps.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "running",
      transferredBytes: 100,
      totalBytes: 100,
      percent: 100,
    }));
    expect(deps.discover).toHaveBeenCalledWith("local");
    expect(deps.profile).toHaveBeenCalledWith("local");
    expect(deps.update).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "completed",
      percent: 100,
    }));
    expect(deps.emit).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "system:local-model",
      status: "completed",
    }));
  });

  it("records a bounded failure and rethrows for queue retry", async () => {
    const deps = dependencies({
      install: vi.fn().mockRejectedValue(new Error("registry token=secret refused")),
    });

    await expect(runLocalModelInstall(input, deps)).rejects.toThrow("registry token=secret refused");
    expect(deps.update).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed",
      error: "The local runtime could not install that model.",
    }));
    expect(deps.emit).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed",
    }));
  });

  it("does not claim success when routing reconciliation fails", async () => {
    const deps = dependencies({
      discover: vi.fn().mockResolvedValue({ discovered: 0, newCount: 0, error: "offline" }),
    });

    await expect(runLocalModelInstall(input, deps)).rejects.toThrow("routing refresh");
    expect(deps.update).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed",
      error: "The model installed, but routing refresh needs attention.",
    }));
  });
});
