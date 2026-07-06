// apps/web/components/queue/QueueHealthSection.tsx
//
// EP-3516E23D Phase 3 — the human half of queue visibility. A SYNCHRONOUS
// presentational component: it renders one report-kit StatCard per queue with a
// snapshot today, so an operator sees at a glance where scarce-resource work is
// piling up (depth, p95 wait, cycle time, first-pass yield, SLA) — the same
// numbers the AI coworker reads through get_queue_status. Spec §4.5.
//
// Data-in-props (not a self-fetching async component) so a page can render it in
// a synchronous pass — the caller (a server component) does the awaiting.

import { StatCard } from "@/components/ui/report-kit";
import type { QueueSnapshotView } from "@/lib/queue/queue-snapshot-service";
import { queueTileModel } from "@/lib/queue/queue-tile-model";

export function QueueHealthSection({ snapshots }: { snapshots: QueueSnapshotView[] }) {
  return (
    <section aria-labelledby="queue-health-heading" style={{ display: "grid", gap: "0.75rem" }}>
      <div>
        <h2 id="queue-health-heading" style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
          Queue health
        </h2>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--dpf-muted)" }}>
          Flow metrics for scarce-resource queues today — wait, cycle time, throughput, and
          first-pass yield. Rolled up hourly from queue telemetry.
        </p>
      </div>

      {snapshots.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--dpf-muted)" }}>
          No queue activity recorded yet today.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
        >
          {snapshots.map((s) => {
            const m = queueTileModel(s);
            return (
              <StatCard
                key={s.queueKey}
                label={m.label}
                value={m.value}
                hint={m.hint}
                intent={m.intent}
                delta={m.delta ?? undefined}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
