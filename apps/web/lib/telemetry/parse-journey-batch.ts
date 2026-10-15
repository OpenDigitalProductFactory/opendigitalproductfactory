// Validate a browser telemetry batch before any value reaches a Prometheus
// label (BI-BD0B0DCC). Invalid samples are dropped one by one; nothing here
// throws, so a buggy client can only thin the histograms, never break them.

import {
  JOURNEYS,
  MAX_BATCH,
  TIMED_WEB_VITALS,
  type JourneyName,
  type TelemetrySample,
  type TimedWebVital,
} from "./journey-vocabulary";

const MAX_DURATION_MS = 120_000;
const MAX_CLS = 10;

const journeySet = new Set<string>(JOURNEYS);
const timedVitalSet = new Set<string>(TIMED_WEB_VITALS);

function finiteIn(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}

export function parseJourneyBatch(
  body: unknown,
  allowedSections: ReadonlySet<string>,
): TelemetrySample[] {
  const raw = (body as { samples?: unknown } | null)?.samples;
  if (!Array.isArray(raw)) return [];

  const samples: TelemetrySample[] = [];
  for (const entry of raw.slice(0, MAX_BATCH)) {
    if (!entry || typeof entry !== "object") continue;
    const s = entry as Record<string, unknown>;

    if (s.kind === "journey") {
      if (typeof s.journey !== "string" || !journeySet.has(s.journey)) continue;
      if (!finiteIn(s.totalMs, MAX_DURATION_MS)) continue;
      const serverMs = finiteIn(s.serverMs, MAX_DURATION_MS) && s.serverMs <= s.totalMs ? s.serverMs : undefined;
      samples.push({
        kind: "journey",
        journey: s.journey as JourneyName,
        totalMs: s.totalMs,
        ...(serverMs !== undefined ? { serverMs } : {}),
      });
      continue;
    }

    if (s.kind === "vital") {
      const section = typeof s.section === "string" && allowedSections.has(s.section) ? s.section : "other";
      if (s.metric === "CLS") {
        if (!finiteIn(s.value, MAX_CLS)) continue;
        samples.push({ kind: "vital", metric: "CLS", value: s.value, section });
        continue;
      }
      if (typeof s.metric !== "string" || !timedVitalSet.has(s.metric)) continue;
      if (!finiteIn(s.value, MAX_DURATION_MS)) continue;
      samples.push({ kind: "vital", metric: s.metric as TimedWebVital, value: s.value, section });
    }
  }
  return samples;
}
