// Browser-side operator journey timing (BI-BD0B0DCC). A journey starts at the
// user's interaction and ends at the first frame painted after the result is
// rendered, never at a component mount: that is the time the operator waits.
//
// Interaction-path cost is one performance mark, one animation frame and one
// array push. Samples leave in batches via navigator.sendBeacon only on
// page-hide or once FLUSH_AT samples are waiting, so telemetry never adds a
// network round trip to what the operator is doing.

import {
  FLUSH_AT,
  JOURNEYS,
  TIMED_WEB_VITALS,
  pathSection,
  type JourneyName,
  type TelemetrySample,
  type WebVitalName,
} from "./journey-vocabulary";

export const TELEMETRY_ENDPOINT = "/api/telemetry/journeys";

/** Injectable browser seams so the timing is testable with a fake clock. */
export type JourneyEnvironment = {
  now: () => number;
  requestFrame: (cb: () => void) => void;
  /** Run after the frame is presented (a macrotask after rAF). */
  afterFrame: (cb: () => void) => void;
  sendBeacon: (url: string, body: string) => boolean;
  /** `app;dur` of the most recent resource timing entry for this URL. */
  serverTimingMs: (url: string) => number | undefined;
};

function browserEnvironment(): JourneyEnvironment | null {
  if (typeof window === "undefined" || typeof performance === "undefined") return null;
  return {
    now: () => performance.now(),
    requestFrame: (cb) => window.requestAnimationFrame(() => cb()),
    afterFrame: (cb) => window.setTimeout(cb, 0),
    sendBeacon: (url, body) =>
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(url, new Blob([body], { type: "text/plain" })),
    serverTimingMs: (url) => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      for (let i = entries.length - 1; i >= 0; i--) {
        if (!entries[i].name.endsWith(url) && !entries[i].name.includes(`${url}?`)) continue;
        const app = entries[i].serverTiming?.find((t) => t.name === "app");
        return app ? app.duration : undefined;
      }
      return undefined;
    },
  };
}

const journeySet = new Set<string>(JOURNEYS);
const vitalSet = new Set<string>([...TIMED_WEB_VITALS, "CLS"]);

const started = new Map<JourneyName, number>();
let queue: TelemetrySample[] = [];

/**
 * Mark the interaction that starts a journey. A repeat start restarts it.
 * `atMs` overrides the start (shell-ready starts at navigation, time 0).
 */
export function beginJourney(name: JourneyName, env = browserEnvironment(), atMs?: number): void {
  if (!env) return;
  started.set(name, atMs ?? env.now());
}

/**
 * Finish a journey at the first frame painted after this call. Without a
 * live beginJourney this is a no-op, so a stray call cannot invent a sample.
 */
export function completeJourney(
  name: JourneyName,
  opts: { serverUrl?: string } = {},
  env = browserEnvironment(),
): void {
  if (!env) return;
  const start = started.get(name);
  if (start === undefined) return;
  started.delete(name);
  env.requestFrame(() =>
    env.afterFrame(() => {
      const totalMs = Math.max(0, Math.round(env.now() - start));
      const serverMs = opts.serverUrl ? env.serverTimingMs(opts.serverUrl) : undefined;
      enqueue(
        {
          kind: "journey",
          journey: name,
          totalMs,
          ...(serverMs !== undefined ? { serverMs: Math.round(serverMs) } : {}),
        },
        env,
      );
    }),
  );
}

/** Queue a web-vital reading from next/web-vitals. */
export function queueWebVital(
  metric: { name: string; value: number },
  pathname: string,
  env = browserEnvironment(),
): void {
  if (!env || !vitalSet.has(metric.name)) return;
  enqueue(
    { kind: "vital", metric: metric.name as WebVitalName, value: metric.value, section: pathSection(pathname) },
    env,
  );
}

function enqueue(sample: TelemetrySample, env: JourneyEnvironment): void {
  queue.push(sample);
  if (queue.length >= FLUSH_AT) flushTelemetry(env);
}

/** Send whatever is queued. Failure is silent: telemetry never reaches the operator. */
export function flushTelemetry(env = browserEnvironment()): void {
  if (!env || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    env.sendBeacon(TELEMETRY_ENDPOINT, JSON.stringify({ samples: batch }));
  } catch {
    // Dropped samples only thin the histogram.
  }
}

/** Test seam. */
export function __resetJourneysForTest(): void {
  started.clear();
  queue = [];
}

export function isJourneyName(name: string): name is JourneyName {
  return journeySet.has(name);
}
