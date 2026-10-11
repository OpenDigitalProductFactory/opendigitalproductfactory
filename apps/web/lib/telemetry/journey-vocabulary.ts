// Closed vocabulary shared by the browser journey queue and the telemetry
// endpoint (BI-BD0B0DCC). A name outside these lists never becomes a
// Prometheus label: the server drops it, which bounds label cardinality.

export const JOURNEYS = ["shell-ready", "coworker-open", "thread-open", "message-ack"] as const;
export type JourneyName = (typeof JOURNEYS)[number];

/** Web vitals measured in milliseconds. CLS is unitless and kept separate. */
export const TIMED_WEB_VITALS = ["LCP", "INP", "FCP", "TTFB"] as const;
export type TimedWebVital = (typeof TIMED_WEB_VITALS)[number];
export type WebVitalName = TimedWebVital | "CLS";

export const MAX_BATCH = 50;
export const FLUSH_AT = 20;

export type JourneySample = {
  kind: "journey";
  journey: JourneyName;
  totalMs: number;
  serverMs?: number;
};

export type WebVitalSample = {
  kind: "vital";
  metric: WebVitalName;
  value: number;
  /** First path segment of the page, e.g. "workspace". The server allowlists it. */
  section: string;
};

export type TelemetrySample = JourneySample | WebVitalSample;

/** The first path segment, unvalidated. The server maps unknown values to "other". */
export function pathSection(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0];
  return first ? first.toLowerCase().slice(0, 40) : "root";
}
