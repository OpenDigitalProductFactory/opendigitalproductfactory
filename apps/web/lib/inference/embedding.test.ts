import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/routing/local-provider-capacity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/routing/local-provider-capacity")>()),
  assertLocalProviderCapacityAvailable: vi.fn(),
}));

import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";
import { generateEmbedding, generateEmbeddingDetailed, isOversizeRejection } from "./embedding";

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
});

describe("embedding is exempt from the local-CI capacity gate (BI-0AA939DF / DI-7F674966B4B2)", () => {
  it("contacts the provider even while local CI holds the slot", async () => {
    // Inverts the prior contract deliberately. Measured 2026-08-25: 10ms with
    // no gate, 10-20ms with an active gate and three queued, no observable
    // effect on the gate. Gating it suppressed retrieval platform-wide for the
    // duration of every gate run and bought nothing.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(generateEmbedding("durable knowledge")).resolves.toEqual([0.1, 0.2]);
    expect(fetchSpy).toHaveBeenCalled();
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

describe("source hygiene - no literal control bytes", () => {
  // This file and embedding.ts once carried LITERAL control bytes (0x00, 0x1F,
  // 0x7F) inside a character class instead of escapes. Runtime behaviour was
  // correct, so tests, typecheck, build and CodeQL all passed - but a NUL byte
  // makes a file BINARY to grep/ripgrep, so code search silently finds nothing
  // in it. Escapes are equivalent at runtime and keep the file searchable.
  it("embedding.ts and this test contain no raw control characters", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const name of ["./embedding.ts", "./embedding.test.ts"]) {
      const src = await readFile(new URL(name, import.meta.url), "utf8");
      const offenders = [...src].filter((ch) => {
        const c = ch.codePointAt(0)!;
        return c < 0x09 || (c > 0x0d && c < 0x20) || c === 0x7f;
      });
      expect({ name, offenders }).toEqual({ name, offenders: [] });
    }
  });
});

describe("generateEmbeddingDetailed reports WHY it produced no vector (BI-339C441F)", () => {
  it("reports a capacity deferral as deferred, carrying the lease reason", async () => {
    // The regression this closes: the deferral was caught alongside real
    // errors and collapsed to null, so a colleague's pre-PR gate read as a
    // broken embedding model across the whole install.
    // No gate raises this any more, but the branch stays: any future capacity
    // boundary must still report a deferral as deferred rather than failed.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new LocalProviderCapacityDeferredError("local-ci-active-capacity-reservation"),
    );

    const result = await generateEmbeddingDetailed("anything");

    expect(result.status).toBe("deferred");
    if (result.status === "deferred") {
      expect(result.reason).toBe("local-ci-active-capacity-reservation");
    }
  });

  it("reports a genuine backend error as failed, not deferred", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));

    const result = await generateEmbeddingDetailed("anything");

    expect(result.status).toBe("failed");
  });

  it("keeps generateEmbedding null-returning, so its existing callers are untouched", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new LocalProviderCapacityDeferredError("local-ci-active-capacity-reservation"),
    );

    await expect(generateEmbedding("anything")).resolves.toBeNull();
  });
});
