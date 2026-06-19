// apps/web/lib/sse/sse-stream.ts
//
// Shared Server-Sent-Events stream builder with LIVENESS HEARTBEATS.
//
// Why this exists (BI-864E83B0): every SSE route in the portal used to
// build its own `ReadableStream`, emit a single `: connected` comment, then
// stay SILENT until a domain event happened. A silent long-lived stream sends
// zero bytes for minutes — which is the root cause of the recurring "Chrome
// wedged, had to restart the browser" defect:
//
//   1. The portal is served over HTTP/1.1 (Next.js standalone, no HTTP/2),
//      so the browser caps connections at ~6 per origin.
//   2. Each open EventSource holds one of those 6 slots for its whole life.
//   3. When a self-upgrade RECREATES the portal container, the host port
//      proxy (docker-proxy for 3000:3000) is torn down and the old Node
//      process dies. A silent SSE connection has no traffic to fail on, so
//      the browser's EventSource never sees an error, never fires `onerror`,
//      and never auto-reconnects. It becomes a ZOMBIE that keeps holding its
//      connection slot (and a half-open socket).
//   4. Enough zombies across tabs/rebuilds exhaust the 6-slot cap, so a fresh
//      navigation to localhost:3000 can't open a socket and the page hangs.
//      Only restarting the browser tears the zombie sockets down.
//
// The fix is a periodic heartbeat the *client can observe*:
//   - The server sends a NAMED `dpf-hb` event on an interval. Named (not a
//     bare `:` comment) so the browser's EventSource can surface it to JS and
//     `useResilientEventSource` can run a watchdog: if no heartbeat arrives
//     within the watchdog window, the client force-closes and reconnects,
//     reaping the zombie itself.
//   - The heartbeat write also lets the SERVER detect a dead client fast: the
//     enqueue throws once the socket is gone, so we clean up the subscription
//     instead of leaking it.
//
// This builder is the single source of truth for that behavior so the five
// SSE routes don't each re-implement (and forget) it.

import { SSE_HEARTBEAT_EVENT } from "./constants";

// Re-export so existing importers can keep pulling it from the builder module.
export { SSE_HEARTBEAT_EVENT };

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 1_000 ? Math.floor(raw) : fallback;
}

/** Server heartbeat cadence. 15s is the conventional SSE keep-alive interval
 *  (well under typical 30-60s proxy idle timeouts) and gives the client three
 *  chances inside a ~40s watchdog before it reconnects. Override with
 *  DPF_SSE_HEARTBEAT_MS. */
const DEFAULT_HEARTBEAT_MS = readPositiveIntEnv("DPF_SSE_HEARTBEAT_MS", 15_000);

/** Controller handed to the caller's `start` so it can push events without
 *  touching the encoder or the raw ReadableStream controller. */
export type SseController = {
  /** Send a default (unnamed) `data:` frame — delivered to EventSource.onmessage.
   *  Returns false if the stream is already closed. */
  send: (data: unknown) => boolean;
  /** Send a named event frame — delivered only to addEventListener(name, …). */
  sendNamed: (event: string, data: unknown) => boolean;
  /** Send a raw comment line (`: text`). Invisible to JS; transport keep-alive. */
  comment: (text: string) => boolean;
  /** True once the stream has been closed/cleaned up. */
  readonly closed: boolean;
  /** Close the stream and run cleanup. Idempotent. */
  close: () => void;
};

export type CreateSseStreamOptions = {
  /** The request abort signal — cleanup runs when the client disconnects. */
  signal: AbortSignal;
  /**
   * Subscribe logic. Receives the controller, runs synchronously, and may
   * return a cleanup function (e.g. the event-bus unsubscribe) that runs
   * exactly once when the stream closes for any reason (client disconnect,
   * write failure, max-age, or explicit close()).
   */
  start: (controller: SseController) => void | (() => void);
  /** Heartbeat cadence in ms. Defaults to DPF_SSE_HEARTBEAT_MS (15s). 0 disables. */
  heartbeatMs?: number;
  /**
   * Optional hard lifetime. After this many ms the server closes the stream so
   * the client reconnects on a fresh socket (belt-and-suspenders against
   * long-lived half-open connections). 0 / undefined disables. The heartbeat
   * watchdog is the primary zombie-reaper; this is secondary.
   */
  maxAgeMs?: number;
  /** Extra response headers merged over the SSE defaults. */
  headers?: HeadersInit;
};

/**
 * Build a heartbeating SSE `Response`. The caller's `start` runs inside the
 * ReadableStream start with a friendly controller; everything else (initial
 * confirmation comment, heartbeat interval, abort/maxAge cleanup, dead-client
 * reaping) is handled here.
 */
export function createSseResponse(opts: CreateSseStreamOptions): Response {
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const maxAgeMs = opts.maxAgeMs ?? 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let maxAgeTimer: ReturnType<typeof setTimeout> | null = null;
      let userCleanup: (() => void) | undefined;

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (maxAgeTimer) clearTimeout(maxAgeTimer);
        try {
          opts.signal.removeEventListener("abort", cleanup);
        } catch {
          /* ignore */
        }
        try {
          userCleanup?.();
        } catch {
          /* a subscriber's unsubscribe must never break teardown */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const enqueue = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          // Client is gone (socket closed) — reap the subscription.
          cleanup();
          return false;
        }
      };

      const sse: SseController = {
        send: (data) => enqueue(`data: ${JSON.stringify(data)}\n\n`),
        sendNamed: (event, data) =>
          enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        comment: (text) => enqueue(`: ${text}\n\n`),
        get closed() {
          return closed;
        },
        close: cleanup,
      };

      // Initial confirmation comment (preserves prior behavior — lets the
      // EventSource confirm the connection opened).
      enqueue(`: connected\n\n`);

      // Client already gone before we got going.
      if (opts.signal.aborted) {
        cleanup();
        return;
      }
      opts.signal.addEventListener("abort", cleanup);

      // Liveness heartbeat — a named event the client watchdog observes.
      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          sse.sendNamed(SSE_HEARTBEAT_EVENT, { t: Date.now() });
        }, heartbeatMs);
        // Don't let the heartbeat alone keep the Node event loop alive.
        (heartbeat as unknown as { unref?: () => void }).unref?.();
      }

      if (maxAgeMs > 0) {
        maxAgeTimer = setTimeout(cleanup, maxAgeMs);
        (maxAgeTimer as unknown as { unref?: () => void }).unref?.();
      }

      // Run the caller's subscribe logic last, so a synchronous enqueue
      // failure during replay can't strand a subscription.
      if (!closed) {
        const ret = opts.start(sse);
        if (typeof ret === "function") {
          userCleanup = ret;
          // If the stream closed during start (e.g. immediate write failure),
          // make sure the just-registered cleanup still runs.
          if (closed) {
            try {
              userCleanup();
            } catch {
              /* ignore */
            }
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      // no-transform stops compression proxies from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy (nginx) response buffering so events flush immediately.
      "X-Accel-Buffering": "no",
      ...opts.headers,
    },
  });
}
