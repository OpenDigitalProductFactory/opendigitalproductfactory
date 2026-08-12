"use client";

/**
 * usePlatformReady — client-side hook for forms / buttons to detect that
 * the platform is currently draining or swapping, so they can disable
 * themselves upfront rather than firing 503-bound actions (BI-QUIESCE-009,
 * spec §7.4).
 *
 * Subscribes to /api/agent/system-stream for system:quiescence events
 * (same source PlatformBanner uses). Returns { ready, level } so callers
 * can branch UX:
 *
 *   const { ready, level } = usePlatformReady();
 *   <Button disabled={!ready} title={!ready ? "Platform upgrading…" : undefined}>
 *     Save
 *   </Button>
 *
 * v1 ships the hook only. Migrating individual forms across the codebase
 * to consume it is BI-QUIESCE-009-followup (per spec §7.6: "v1 ships
 * Pattern 1 on highest-traffic forms (server-action POSTs in the
 * coworker panel, build settings, prompt editor) — the middleware 503 +
 * auto-retry-once shim is the fallback for everything else").
 *
 * The middleware 503 (BI-QUIESCE-003) is still authoritative; this hook
 * is a UX enhancement, not a security boundary.
 */
import { useEffect, useState } from "react";
import { useSystemEvent } from "@/components/platform/SystemEventProvider";

export type PlatformReadyState = {
  ready: boolean;
  level: "normal" | "draining" | "swapping" | "unknown";
};

type SystemQuiescenceEvent = {
  type: "system:quiescence";
  level: "draining" | "swapping" | "cleared";
};

export function usePlatformReady(): PlatformReadyState {
  const [state, setState] = useState<PlatformReadyState>({ ready: true, level: "unknown" });

  useEffect(() => {
    // Initial state — poll the state route once so the hook reflects
    // current level on mount without waiting for the next SSE event.
    void fetch("/api/internal/quiescence-state", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body) return;
        const level = normalizeLevel(body.level);
        setState({ ready: level === "normal", level });
      })
      .catch(() => {
        // Fail open — assume ready. The middleware 503 will catch any
        // actual mid-drain attempts.
      });
  }, []);

  // The authenticated shell owns one resilient system stream per tab. This
  // hook subscribes to its in-process fan-out rather than opening another SSE
  // connection beside PlatformBanner.
  useSystemEvent("system:quiescence", (event: SystemQuiescenceEvent) => {
      if (event.level === "draining") {
        setState({ ready: false, level: "draining" });
      } else if (event.level === "swapping") {
        setState({ ready: false, level: "swapping" });
      } else if (event.level === "cleared") {
        setState({ ready: true, level: "normal" });
      }
  });

  return state;
}

function normalizeLevel(raw: unknown): PlatformReadyState["level"] {
  if (raw === "draining" || raw === "swapping" || raw === "normal") return raw;
  return "unknown";
}
