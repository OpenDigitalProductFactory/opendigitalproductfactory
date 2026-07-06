// apps/web/lib/queue/queue-tile-model.ts
//
// EP-3516E23D Phase 3 — pure mapping from a queue snapshot to the props a
// report-kit StatCard needs. Kept separate from the React component so the
// human-tile logic (label, headline value, hint line, intent color, throughput
// delta) is unit-tested without rendering. Same numbers the coworker MCP tool
// quotes — both read QueueSnapshotView. Spec §4.5.

import type { QueueSnapshotView } from "./queue-snapshot-service";
import { assessQueueHealth, type QueueHealth } from "./queue-snapshot-service";

export type QueueTileIntent = "success" | "warning" | "danger" | "info" | "neutral";

export interface QueueTileModel {
  label: string;
  value: string;
  hint: string;
  intent: QueueTileIntent;
  delta: { label: string; direction: "up" | "down" | "flat" } | null;
  health: QueueHealth;
}

const HEALTH_INTENT: Record<QueueHealth, QueueTileIntent> = {
  healthy: "success",
  watch: "warning",
  "at-risk": "danger",
  idle: "neutral",
};

/** Human-readable queue label from a queueKey ("cwq:triage-default" → "triage-default"). */
export function humanizeQueueKey(queueKey: string): string {
  const [prefix, ...rest] = queueKey.split(":");
  const name = rest.join(":") || prefix || queueKey;
  if (prefix === "compute") return `${name} (compute)`;
  return name;
}

function ms(v: number | null): string {
  if (v == null) return "—";
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  if (m < 90) return `${m.toFixed(0)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Map a snapshot to StatCard-ready tile props. Pure. */
export function queueTileModel(s: QueueSnapshotView): QueueTileModel {
  const { health } = assessQueueHealth(s);
  const hintParts = [`p95 wait ${ms(s.waitP95Ms)}`, `cycle ${ms(s.cycleP50Ms)}`];
  if (s.firstPassYield != null) hintParts.push(`FPY ${pct(s.firstPassYield)}`);
  if (s.slaAttainment != null) hintParts.push(`SLA ${pct(s.slaAttainment)}`);

  return {
    label: humanizeQueueKey(s.queueKey),
    value: `${s.depth} waiting`,
    hint: hintParts.join(" · "),
    intent: HEALTH_INTENT[health],
    delta:
      s.throughput > 0 || s.arrivals > 0
        ? { label: `${s.throughput}/${s.arrivals} done/in`, direction: s.throughput >= s.arrivals ? "up" : "down" }
        : null,
    health,
  };
}
