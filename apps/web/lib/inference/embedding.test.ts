import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/routing/local-provider-capacity", () => ({
  assertLocalProviderCapacityAvailable: vi.fn(),
}));

import { assertLocalProviderCapacityAvailable } from "@/lib/routing/local-provider-capacity";
import { generateEmbedding, isOversizeRejection } from "./embedding";

/** The exact rejection llama.cpp emits once n_batch is clamped to n_ubatch. */
const OVERSIZE_BODY =
  "input (599 tokens) is too large to process. increase the physical batch size (current batch size: 512)";

function okEmbedding(vec: number[]): Response {
  return new Response(JSON.stringify({ data: [{ embedding: vec }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertLocalProviderCapacityAvailable).mockResolvedValue(undefined);
});

describe("generateEmbedding local-CI arbitration", () => {
  it("does not contact the local embedding provider while local CI owns capacity", async () => {
    vi.mocked(assertLocalProviderCapacityAvailable).mockRejectedValue(
      new Error("local-ci-active-capacity-reservation"),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(generateEmbedding("durable knowledge")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dispatches normally when local capacity is available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(generateEmbedding("durable knowledge")).resolves.toEqual([0.1, 0.2]);
    expect(assertLocalProviderCapacityAvailable).toHaveBeenCalledOnce();
  });
});

describe("oversize rejection detection (BI-633845B0)", () => {
  it("recognises the live llama.cpp batch-size rejection", () => {
    expect(isOversizeRejection(500, OVERSIZE_BODY)).toBe(true);
  });

  it("does not treat a success or an unrelated failure as oversize", () => {
    expect(isOversizeRejection(200, OVERSIZE_BODY)).toBe(false);
    expect(isOversizeRejection(503, "model is loading")).toBe(false);
    expect(isOversizeRejection(404, "model not found")).toBe(false);
  });
});

describe("oversize retry (BI-633845B0)", () => {
  // The char cap is a proxy for a token limit. Dense text (code, ids, markdown)
  // runs ~2.8 chars/token, so 1700 chars becomes ~600 tokens and is rejected —
  // observed live at 520, 550 and 599 tokens. Retrying shorter recovers it.
  it("retries at a shorter slice and returns the embedding instead of null", async () => {
    const sent: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { input: string };
      sent.push(body.input.length);
      // Reject anything over 1000 chars, mimicking a dense-text token overflow.
      if (body.input.length > 1000) {
        return new Response(OVERSIZE_BODY, { status: 500 });
      }
      return okEmbedding([0.5]);
    });

    const dense = "a".repeat(5000);
    await expect(generateEmbedding(dense)).resolves.toEqual([0.5]);

    // First attempt at the full cap, then a strictly shorter retry that succeeds.
    expect(sent.length).toBeGreaterThan(1);
    expect(sent[0]).toBe(1700);
    expect(sent[sent.length - 1]).toBeLessThan(sent[0]!);
  });

  it("gives up after the last slice rather than retrying forever", async () => {
    // A fresh Response per call: a body can only be read once, so a single
    // shared Response would make the second read empty and mask the retry.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(OVERSIZE_BODY, { status: 500 }));

    await expect(generateEmbedding("x".repeat(5000))).resolves.toBeNull();
    // One full-length attempt plus the configured retry slices — bounded.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a non-oversize failure — one attempt, then null", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("model not found", { status: 404 }));

    await expect(generateEmbedding("durable knowledge")).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("does not retry when the first attempt succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okEmbedding([0.9]));

    await expect(generateEmbedding("short text")).resolves.toEqual([0.9]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
