"use client";

import { DeliveryTaskGroupSection } from "@/components/work-capsules/DeliveryTaskCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/report-kit/EmptyState";
import { Notice } from "@/components/ui/report-kit/Notice";
import { Surface } from "@/components/ui/Surface";
import type { DeliveryTaskGroup } from "@/lib/work-capsules/delivery-task-hub";
import type { DeliveryTaskHubPage } from "@/lib/work-capsules/delivery-task-hub-store";
import { useDeliveryTaskHub } from "@/lib/work-capsules/use-delivery-task-hub";

const GROUPS: Array<{ key: DeliveryTaskGroup; label: string }> = [
  { key: "needs-attention", label: "Needs attention" },
  { key: "working", label: "Working" },
  { key: "waiting", label: "Waiting" },
  { key: "ready", label: "Ready" },
  { key: "complete", label: "Complete" },
];

export function DeliveryTaskHub({ initialPage }: { initialPage: DeliveryTaskHubPage }) {
  const hub = useDeliveryTaskHub(initialPage);
  const counts = Object.fromEntries(GROUPS.map(({ key }) => [key, hub.rows.filter((row) => row.group === key).length]));
  const pageNextCapsuleId = GROUPS.flatMap(({ key }) => hub.rows.filter((row) => row.group === key))[0]?.capsuleId ?? null;
  return (
    <section aria-labelledby="delivery-task-hub-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div data-dpf-lead>
          <h2 id="delivery-task-hub-heading" className="text-lg font-semibold text-[var(--dpf-text)]">Delivery task hub</h2>
          <p className="text-sm text-[var(--dpf-muted)]">Leave long-running work safely and return to the durable Workroom outcome.</p>
        </div>
        <span aria-live="polite" className="text-xs text-[var(--dpf-muted)]">
          {hub.streamStatus === "open" ? "Live updates connected" : hub.streamStatus === "reconnecting" ? "Reconnecting — confirmed tasks retained" : "Connecting to live updates"}
        </span>
      </div>
      <dl aria-label="Delivery task counts" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {GROUPS.map(({ key, label }) => <Surface key={key} padding="sm"><dt className="text-xs text-[var(--dpf-muted)]">{label}</dt><dd className="text-lg font-semibold text-[var(--dpf-text)]">{counts[key] ?? 0}</dd></Surface>)}
      </dl>
      {hub.streamStatus === "reconnecting" ? <Notice variant="warn" title="Reconnecting">Confirmed Workrooms remain visible while the bounded snapshot reconnects.</Notice> : null}
      {hub.liveError ? <Notice variant="warn" title="Live view could not refresh">Confirmed Workrooms are retained. The stream will reconcile from canonical records when it reconnects.</Notice> : null}
      {hub.rows.length === 0 ? (
        <EmptyState title="No delivery Workrooms in this 30-day window" description="This is an empty observation window, not a delivery success signal." />
      ) : GROUPS.map(({ key, label }) => (
        <DeliveryTaskGroupSection key={key} groupKey={key} label={label} rows={hub.rows.filter((row) => row.group === key)} observationTime={hub.observedAt} pageNextCapsuleId={pageNextCapsuleId} />
      ))}
      {hub.olderError ? <Notice variant="warn">{hub.olderError}</Notice> : null}
      {hub.olderCursor ? (
        <Button variant="secondary" className="min-h-11" onClick={() => void hub.loadOlder()} disabled={hub.loadingOlder} aria-label="Load older delivery tasks">
          {hub.loadingOlder ? "Loading older tasks…" : "Load older tasks"}
        </Button>
      ) : hub.rows.length > 0 ? <p className="text-xs text-[var(--dpf-muted)]">No more delivery tasks in this window.</p> : null}
    </section>
  );
}
