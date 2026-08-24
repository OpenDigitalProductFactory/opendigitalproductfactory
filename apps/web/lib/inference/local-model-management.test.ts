import { describe, expect, it, vi } from "vitest";
import {
  LocalModelManagementError,
  canonicalLocalModelKey,
  installLocalModel,
  listLocalModels,
  parseDmrSize,
  removeLocalModel,
  validateLocalModelReference,
} from "./local-model-management";

const API_ROOT = "http://model-runner.test";

const liveModels = [
  {
    id: "sha256:653017dd060f5cd345118ff90382ceb213d383de2887820d2f303893d32ef40d",
    tags: ["docker.io/ai/nomic-embed-text-v1.5:latest"],
    created: 1778854020,
    config: {
      format: "gguf",
      quantization: "MOSTLY_F16",
      parameters: "136.73M",
      architecture: "nomic-bert",
      size: "260.86MiB",
      context_size: 2048,
    },
  },
  {
    id: "sha256:b9c79f8f56a90a86860d20d8025fde1ac0c03ef282b4f439b271abb7e8c72624",
    tags: ["huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M"],
    created: 1786721194,
    config: {
      format: "gguf",
      quantization: "MOSTLY_Q4_K_M",
      parameters: "26.90B",
      architecture: "qwen35",
      size: "17.66GiB",
      context_size: 262144,
    },
  },
];

describe("local model management adapter", () => {
  it.each([
    ["260.86MiB", Math.round(260.86 * 1024 ** 2)],
    ["17.66GiB", Math.round(17.66 * 1024 ** 3)],
    ["1.5 GB", 1_500_000_000],
    ["0B", 0],
    ["", null],
    ["unknown", null],
    [undefined, null],
  ])("parses DMR size %s without fabricating unknown values", (input, expected) => {
    expect(parseDmrSize(input)).toBe(expected);
  });

  it("maps the native live inventory and preserves honest size metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(liveModels), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const models = await listLocalModels({ apiRoot: API_ROOT, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(`${API_ROOT}/models`, expect.objectContaining({ cache: "no-store" }));
    expect(models).toEqual([
      expect.objectContaining({
        name: "docker.io/ai/nomic-embed-text-v1.5:latest",
        comparisonKey: "ai/nomic-embed-text-v1.5",
        sizeBytes: Math.round(260.86 * 1024 ** 2),
        sizeLabel: "260.86 MiB",
        digest: liveModels[0].id,
        parameterSize: "136.73M",
        quantization: "MOSTLY_F16",
      }),
      expect.objectContaining({
        name: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
        comparisonKey: "hf.co/ggml-org/qwen3.8-27b-gguf:q4_k_m",
        sizeBytes: Math.round(17.66 * 1024 ** 3),
        sizeLabel: "17.66 GiB",
        digest: liveModels[1].id,
        contextSize: 262144,
      }),
    ]);
  });

  it("keeps missing native size metadata unavailable instead of zero", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "sha256:x", tags: ["ai/test"], config: {} }]), {
        status: 200,
      }),
    );

    await expect(listLocalModels({ apiRoot: API_ROOT, fetchImpl })).resolves.toEqual([
      expect.objectContaining({ sizeBytes: null, sizeLabel: null }),
    ]);
  });

  it.each([
    ["docker.io/ai/nomic-embed-text-v1.5:latest", "ai/nomic-embed-text-v1.5"],
    ["ai/nomic-embed-text-v1.5", "ai/nomic-embed-text-v1.5"],
    ["hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M", "hf.co/ggml-org/qwen3.8-27b-gguf:q4_k_m"],
    ["huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M", "hf.co/ggml-org/qwen3.8-27b-gguf:q4_k_m"],
  ])("normalizes runtime alias %s for comparison", (input, expected) => {
    expect(canonicalLocalModelKey(input)).toBe(expected);
  });

  it.each([
    "",
    "https://huggingface.co/org/model",
    "../model",
    "ai/../model",
    "ai/model?force=true",
    "ai/model#fragment",
    "ai\\model",
    "ai/model name",
    `ai/${"x".repeat(300)}`,
  ])("rejects unsafe model reference %j before network access", (input) => {
    expect(() => validateLocalModelReference(input)).toThrow(LocalModelManagementError);
    try {
      validateLocalModelReference(input);
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid-reference" });
    }
  });

  it.each([
    "ai/qwen3:8B-Q4_K_M",
    "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
    "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
  ])("accepts supported registry reference %s", (input) => {
    expect(validateLocalModelReference(input)).toBe(input);
  });

  it("posts a validated native create request and projects streamed byte progress", async () => {
    const onProgress = vi.fn();
    const stream = [
      { type: "progress", total: 1000, layer: { id: "a", size: 600, current: 200 }, mode: "pull" },
      { type: "progress", total: 1000, layer: { id: "b", size: 400, current: 100 }, mode: "pull" },
      { type: "progress", total: 1000, layer: { id: "a", size: 600, current: 600 }, mode: "pull" },
      { type: "success", total: 1000, layer: {}, mode: "pull" },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));

    await installLocalModel("hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M", onProgress, {
      apiRoot: API_ROOT,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(`${API_ROOT}/models/create`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/x-ndjson, application/json" },
      body: JSON.stringify({ from: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M" }),
    });
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ transferredBytes: 700, totalBytes: 1000, percent: 70 }),
    );
  });

  it("reports an NDJSON chunk before the download response closes", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const onProgress = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));

    const installing = installLocalModel("ai/qwen3:8B-Q4_K_M", onProgress, {
      apiRoot: API_ROOT,
      fetchImpl,
    });
    controller.enqueue(
      encoder.encode(
        `${JSON.stringify({ type: "progress", total: 100, layer: { id: "a", current: 25 } })}\n`,
      ),
    );
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ transferredBytes: 25, totalBytes: 100, percent: 25 }),
    ));
    controller.close();
    await installing;
  });

  it("surfaces an error record from a nominally successful pull stream", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "error", message: "registry denied the request" }), {
        status: 200,
      }),
    );

    await expect(
      installLocalModel("ai/qwen3:8B-Q4_K_M", vi.fn(), { apiRoot: API_ROOT, fetchImpl }),
    ).rejects.toMatchObject({ code: "registry-failure" });
  });

  it("deletes the complete namespaced reference and treats already absent as success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const reference = "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M";

    await expect(removeLocalModel(reference, { apiRoot: API_ROOT, fetchImpl })).resolves.toEqual({
      alreadyAbsent: false,
    });
    await expect(removeLocalModel(reference, { apiRoot: API_ROOT, fetchImpl })).resolves.toEqual({
      alreadyAbsent: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${API_ROOT}/models/huggingface.co/ggml-org/qwen3.8-27b-gguf%3AQ4_K_M`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each([404, 405])("classifies native management status %i as update-needed", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("missing", { status }));

    await expect(listLocalModels({ apiRoot: API_ROOT, fetchImpl })).rejects.toMatchObject({
      code: "management-unsupported",
    });
  });

  it("classifies a network failure without leaking its raw message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.1.2.3:12434"));

    await expect(listLocalModels({ apiRoot: API_ROOT, fetchImpl })).rejects.toMatchObject({
      code: "runtime-unreachable",
      message: "The local model runtime is unavailable.",
    });
  });
});
