// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSseResponse, SSE_HEARTBEAT_EVENT } from "./sse-stream";

async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
): Promise<string | null> {
  const { value, done } = await reader.read();
  return done ? null : decoder.decode(value);
}

describe("createSseResponse", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sets SSE headers and emits the initial connected comment", async () => {
    const ac = new AbortController();
    const res = createSseResponse({ signal: ac.signal, start: () => {} });

    expect(res.headers.get("content-type")).toBe("text/event-stream");
    // Anti-buffering headers are what make the heartbeat actually flush.
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("cache-control")).toContain("no-transform");

    const reader = res.body!.getReader();
    const first = await readFrame(reader, new TextDecoder());
    expect(first).toContain(": connected");
    ac.abort();
  });

  it("emits a named heartbeat on the configured interval", async () => {
    const ac = new AbortController();
    const res = createSseResponse({
      signal: ac.signal,
      start: () => {},
      heartbeatMs: 1_000,
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();

    await readFrame(reader, dec); // ": connected"
    await vi.advanceTimersByTimeAsync(1_000);
    const hb = await readFrame(reader, dec);
    expect(hb).toContain(`event: ${SSE_HEARTBEAT_EVENT}`);
    ac.abort();
  });

  it("delivers events pushed through the controller", async () => {
    const ac = new AbortController();
    const res = createSseResponse({
      signal: ac.signal,
      heartbeatMs: 0,
      start: (sse) => {
        sse.send({ type: "hello", n: 1 });
      },
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();

    await readFrame(reader, dec); // ": connected"
    const frame = await readFrame(reader, dec);
    expect(frame).toBe(`data: ${JSON.stringify({ type: "hello", n: 1 })}\n\n`);
    ac.abort();
  });

  it("runs the start cleanup exactly once when the client disconnects", () => {
    const ac = new AbortController();
    const cleanup = vi.fn();
    createSseResponse({
      signal: ac.signal,
      heartbeatMs: 1_000,
      start: () => cleanup,
    });

    ac.abort();
    ac.abort(); // idempotent — cleanup must not run twice
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("stops sending after close (no leaked heartbeats)", async () => {
    const ac = new AbortController();
    const cleanup = vi.fn();
    const res = createSseResponse({
      signal: ac.signal,
      heartbeatMs: 1_000,
      start: () => cleanup,
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    await readFrame(reader, dec); // connected

    ac.abort();
    expect(cleanup).toHaveBeenCalledTimes(1);

    // Advancing past several heartbeat intervals must not enqueue anything —
    // the stream is closed, so the reader sees done.
    await vi.advanceTimersByTimeAsync(5_000);
    const { done } = await reader.read();
    expect(done).toBe(true);
  });
});
