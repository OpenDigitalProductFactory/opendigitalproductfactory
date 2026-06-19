"use client";

/**
 * useResilientEventSource — drop-in wrapper around the browser's EventSource
 * with three resilience additions on top of the default behavior
 * (BI-QUIESCE-008 §7.5; heartbeat watchdog added by BI-864E83B0):
 *
 *   1. Minimum 5s reconnect floor — even if the server returns immediate
 *      retry, the hook waits at least 5s. Prevents the upgrade window
 *      being hammered by N tabs reconnecting in lockstep.
 *
 *   2. Retry-After respect — if the server returned 503 on the most
 *      recent connect attempt with a Retry-After header, the hook waits
 *      max(5s, Retry-After seconds) before retrying. EventSource itself
 *      doesn't honor Retry-After, so the wrapper enforces it.
 *
 *   3. Heartbeat watchdog (the zombie-reaper) — the server now emits a
 *      named `dpf-hb` event every ~15s (lib/sse/sse-stream.ts). The hook
 *      resets a watchdog on every inbound frame; if NOTHING arrives within
 *      HEARTBEAT_WATCHDOG_MS it treats the connection as dead and force-
 *      closes + reconnects. This is the fix for the recurring "Chrome
 *      wedged, had to restart the browser after a portal rebuild" defect:
 *      a self-upgrade recreates the portal container, the old TCP socket is
 *      silently stranded (no FIN through the recreated docker-proxy), and
 *      a plain EventSource never errors on a silent dead socket — so it
 *      becomes a zombie holding one of the browser's ~6 HTTP/1.1 connection
 *      slots per origin until the browser is restarted. The watchdog reaps
 *      that zombie itself, freeing the slot, so the page never wedges.
 *
 * This hook NEVER reloads the page. A transport wrapper reconnecting an SSE
 * stream is the orthodox behavior; deciding to reload after a deploy is an
 * application concern, owned by PlatformBanner's controlled post-upgrade
 * reload (gated on the explicit `system:quiescence` "succeeded" event), not
 * a side effect of every (re)connect. (An earlier version reloaded on a
 * bundle-hash mismatch on every connect; with the boot/identity signals
 * derived from divergent env sources that mismatch was permanent, so the
 * page reloaded every ~1-2s — removed in BI-864E83B0-followup.)
 *
 * Migration: replaces `new EventSource(url)` in consumers. The always-on
 * consumers (PlatformBanner, usePlatformReady) are migrated; the remaining
 * transient streams migrate in BI-1AFF530D.
 */
import { useEffect, useRef, useState } from "react";
import { SSE_HEARTBEAT_EVENT } from "@/lib/sse/constants";

const MIN_RECONNECT_DELAY_MS = 5_000;

/**
 * If no frame (heartbeat OR data) arrives within this window, the connection
 * is presumed dead and the hook force-reconnects. The server heartbeats every
 * ~15s, so 40s tolerates ~2 missed beats plus jitter/latency before acting —
 * aggressive enough to self-heal within seconds of a rebuild, slack enough not
 * to false-trip on a momentarily quiet link.
 */
export const HEARTBEAT_WATCHDOG_MS = 40_000;

export type ResilientEventSourceOptions = {
  /**
   * Called with the raw MessageEvent for each `data:` frame. Caller is
   * responsible for parsing JSON (matches native EventSource ergonomics).
   */
  onMessage: (event: MessageEvent) => void;
  /**
   * Optional named-event listener map. EventSource supports server-named
   * events via `event: <name>\ndata: ...\n\n`; consumers that use them
   * can register handlers here.
   */
  onNamed?: Record<string, (event: MessageEvent) => void>;
  /**
   * If true, the hook will not attempt to reconnect after the server
   * closes the stream cleanly. Default: true (allow reconnect). When false,
   * the heartbeat watchdog is also disabled (a one-shot stream is expected
   * to fall quiet and end).
   */
  reconnect?: boolean;
};

export type ResilientEventSourceStatus =
  | "connecting"
  | "open"
  | "reconnecting";

export function useResilientEventSource(
  url: string | null,
  opts: ResilientEventSourceOptions,
): { status: ResilientEventSourceStatus } {
  const [status, setStatus] = useState<ResilientEventSourceStatus>("connecting");
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!url) {
      setStatus("connecting");
      return;
    }

    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let lastConnectAt = 0;

    const watchdogEnabled = optsRef.current.reconnect !== false;

    function clearWatchdog(): void {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    }

    // Reset the liveness watchdog. Called on connect and on every inbound
    // frame (heartbeat, named event, or data). If it ever fires, the stream
    // has gone silent past the tolerance → reap and reconnect.
    function armWatchdog(): void {
      if (!watchdogEnabled || closed) return;
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        if (closed) return;
        // Dead/zombie connection: no traffic for HEARTBEAT_WATCHDOG_MS even
        // though the server should be heartbeating. Force a clean reconnect.
        setStatus("reconnecting");
        source?.close();
        source = null;
        scheduleReconnect();
      }, HEARTBEAT_WATCHDOG_MS);
    }

    function scheduleReconnect(): void {
      if (closed) return;
      clearWatchdog();
      // Backoff: at least MIN_RECONNECT_DELAY_MS, plus jitter so tabs that
      // dropped together don't reconnect in lockstep and re-storm the server.
      const sinceConnect = Date.now() - lastConnectAt;
      const minWait = Math.max(0, MIN_RECONNECT_DELAY_MS - sinceConnect);
      const jitter = Math.floor(Math.random() * 1_000);
      retryTimer = setTimeout(connect, minWait + jitter);
    }

    function connect(): void {
      if (closed) return;
      lastConnectAt = Date.now();
      setStatus("connecting");
      source = new EventSource(url as string);
      armWatchdog();

      source.onopen = () => {
        setStatus("open");
        armWatchdog();
      };

      source.onmessage = (event) => {
        armWatchdog();
        optsRef.current.onMessage(event);
      };

      // Internal liveness listener — resets the watchdog and is never
      // forwarded to the consumer. This is the frame that keeps an idle
      // stream (e.g. the system banner) alive between real events.
      source.addEventListener(SSE_HEARTBEAT_EVENT, () => {
        armWatchdog();
      });

      if (optsRef.current.onNamed) {
        for (const [name, handler] of Object.entries(optsRef.current.onNamed)) {
          source.addEventListener(name, ((event: MessageEvent) => {
            armWatchdog();
            handler(event);
          }) as EventListener);
        }
      }

      source.onerror = () => {
        // EventSource auto-reconnect is unreliable for our use case
        // (no Retry-After respect, no floor). Close it and schedule
        // our own reconnect with the resilience policy applied.
        if (closed) return;
        if (optsRef.current.reconnect === false) {
          closed = true;
          clearWatchdog();
          source?.close();
          return;
        }
        setStatus("reconnecting");
        source?.close();
        source = null;
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearWatchdog();
      source?.close();
    };
  }, [url]);

  return { status };
}
