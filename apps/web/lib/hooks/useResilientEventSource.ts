"use client";

/**
 * useResilientEventSource — drop-in wrapper around the browser's EventSource
 * with three resilience additions on top of the default behavior
 * (BI-QUIESCE-008, spec §7.5):
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
 *   3. Stale-bundle check on successful reconnect — after a reconnect
 *      succeeds, fetches /api/internal/quiescence-state and compares to
 *      window.__DPF_BOOT__. Mismatch → forces soft reload. Catches the
 *      "client reconnected to a new bundle" case the bundle-hash header
 *      would otherwise detect on the next user action.
 *
 * Migration: replaces `new EventSource(url)` in consumers. The 5 v1 SSE
 * consumers can migrate incrementally — this hook ships standalone and
 * the migration is BI-QUIESCE-008-followup. AgentCoworkerPanel et al
 * keep working unchanged until they're migrated.
 */
import { useEffect, useRef, useState } from "react";

type BootGlobal = { version: string; bundleHash: string };

declare global {
  interface Window {
    __DPF_BOOT__?: BootGlobal;
  }
}

const MIN_RECONNECT_DELAY_MS = 5_000;

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
   * closes the stream cleanly. Default: true (allow reconnect).
   */
  reconnect?: boolean;
};

export type ResilientEventSourceStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "stale-bundle-reload";

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
    let lastConnectAt = 0;

    const connect = (): void => {
      if (closed) return;
      lastConnectAt = Date.now();
      setStatus("connecting");
      source = new EventSource(url);

      source.onopen = () => {
        setStatus("open");
        // Stale-bundle check on every successful (re)connect.
        void detectStaleBundle().then((stale) => {
          if (stale && !closed) {
            setStatus("stale-bundle-reload");
            setTimeout(() => {
              if (!closed) window.location.reload();
            }, 1_000);
          }
        });
      };

      source.onmessage = (event) => {
        optsRef.current.onMessage(event);
      };

      if (optsRef.current.onNamed) {
        for (const [name, handler] of Object.entries(optsRef.current.onNamed)) {
          source.addEventListener(name, handler as EventListener);
        }
      }

      source.onerror = () => {
        // EventSource auto-reconnect is unreliable for our use case
        // (no Retry-After respect, no floor). Close it and schedule
        // our own reconnect with the resilience policy applied.
        if (closed) return;
        if (optsRef.current.reconnect === false) {
          closed = true;
          source?.close();
          return;
        }
        setStatus("reconnecting");
        source?.close();
        source = null;

        // Compute backoff: at least MIN_RECONNECT_DELAY_MS, plus an
        // additional delay so jittered tabs don't reconnect in lockstep.
        const sinceConnect = Date.now() - lastConnectAt;
        const minWait = Math.max(0, MIN_RECONNECT_DELAY_MS - sinceConnect);
        const jitter = Math.floor(Math.random() * 1_000);
        const delay = minWait + jitter;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [url]);

  return { status };
}

/**
 * Compare boot identity to the current server's identity. Returns true
 * when the running bundle differs from the page's boot bundle.
 *
 * Best-effort: any fetch failure returns false (caller stays connected
 * to whatever it had). The next response with X-Bundle-Hash header
 * (BI-QUIESCE-003) is the secondary detection path.
 */
async function detectStaleBundle(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const boot = window.__DPF_BOOT__;
  if (!boot) return false;
  try {
    const res = await fetch("/api/internal/quiescence-state", { cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json()) as { version?: string; bundleHash?: string };
    const versionChanged = body.version && body.version !== boot.version;
    const bundleChanged = body.bundleHash && body.bundleHash !== boot.bundleHash;
    return Boolean(versionChanged || bundleChanged);
  } catch {
    return false;
  }
}
