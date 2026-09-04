// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalModelStatusSnapshot } from "@/lib/inference/local-model-operations";

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  observer: null as null | {
    snapshot: LocalModelStatusSnapshot;
    refresh: () => Promise<void>;
    pending: boolean;
    error: string | null;
  },
}));

vi.mock("@/lib/actions/ollama-management", () => ({
  pullOllamaModel: mocks.pull,
  deleteOllamaModel: mocks.remove,
}));
vi.mock("@/lib/hooks/useBackgroundOperationObserver", () => ({
  useBackgroundOperationObserver: () => mocks.observer,
}));

import { OllamaManagement } from "./OllamaManagement";

const baseModel = {
  comparisonKey: "",
  createdAt: null,
  digest: "sha256:test",
  parameterSize: "",
  quantization: "",
  architecture: "qwen",
  format: "gguf",
  contextSize: null,
};

const snapshot: LocalModelStatusSnapshot = {
  observedAt: "2026-08-24T01:00:00.000Z",
  models: [
    {
      ...baseModel,
      name: "huggingface.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
      comparisonKey: "hf.co/ggml-org/qwen3.8-27b-gguf:q4_k_m",
      sizeBytes: 18_963_182_551,
      sizeLabel: "17.66 GiB",
      parameterSize: "26.90B",
      quantization: "MOSTLY_Q4_K_M",
      contextSize: 262_144,
    },
    {
      ...baseModel,
      name: "docker.io/ai/nomic-embed-text-v1.5:latest",
      comparisonKey: "ai/nomic-embed-text-v1.5",
      sizeBytes: 273_531_126,
      sizeLabel: "260.86 MiB",
      parameterSize: "136.73M",
      quantization: "MOSTLY_F16",
    },
  ],
  operations: [],
};

describe("OllamaManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refresh.mockResolvedValue(undefined);
    mocks.observer = { snapshot, refresh: mocks.refresh, pending: false, error: null };
    mocks.pull.mockResolvedValue({ ok: true, data: { operationId: "op-1", status: "queued" } });
    mocks.remove.mockResolvedValue({ ok: true, data: { alreadyAbsent: false } });
  });

  afterEach(cleanup);

  it("shows authoritative disk sizes and no command-copy workflow", () => {
    const { container } = render(<OllamaManagement canWrite vramGb={24} providerId="local" />);

    expect(screen.getByText("17.66 GiB")).toBeTruthy();
    expect(screen.getByText("260.86 MiB")).toBeTruthy();
    expect(screen.getByText(/2 installed/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/copy|terminal|powershell|docker model/i);
  });

  it("identifies Qwen3.8 27B as the high-trust reviewer without recommending 8B", () => {
    const { container } = render(<OllamaManagement canWrite vramGb={24} providerId="local" />);

    expect(screen.getByText("High-trust reviewer")).toBeTruthy();
    expect(container.textContent).not.toContain("★ Qwen3 8B");
  });

  it("makes the embedding consequence explicit before removing Nomic", async () => {
    render(<OllamaManagement canWrite vramGb={24} providerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Nomic Embed Text v1.5" }));
    expect(screen.getByText(/semantic search and memory will stop/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(
      "docker.io/ai/nomic-embed-text-v1.5:latest",
    ));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("installs a catalog model directly in the product", async () => {
    render(<OllamaManagement canWrite vramGb={24} providerId="local" />);

    fireEvent.click(screen.getByRole("tab", { name: "Coding" }));
    fireEvent.click(screen.getByRole("button", { name: "Install Qwen2.5 Coder 14B" }));

    await waitFor(() => expect(mocks.pull).toHaveBeenCalledWith("ai/qwen2.5-coder:14b"));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows durable progress for an active install", () => {
    mocks.observer = {
      ...mocks.observer!,
      snapshot: {
        ...snapshot,
        operations: [{
          jobId: "local-model-install:abc",
          modelReference: "ai/qwen3:14B-Q6_K",
          comparisonKey: "ai/qwen3:14b-q6_k",
          status: "running",
          attempt: 1,
          requestedByUserId: "operator-1",
          transferredBytes: 50,
          totalBytes: 100,
          percent: 50,
          message: "Downloading",
          error: null,
          updatedAt: "2026-08-24T01:00:00.000Z",
        }],
      },
    };

    render(<OllamaManagement canWrite vramGb={24} providerId="local" />);

    expect(screen.getAllByText("50%")).not.toHaveLength(0);
    expect(screen.getByText("Downloading")).toBeTruthy();
  });
});
