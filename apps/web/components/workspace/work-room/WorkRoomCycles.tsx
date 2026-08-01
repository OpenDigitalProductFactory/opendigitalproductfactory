import {
  CalendarClock,
  CheckCircle2,
  History,
  RefreshCw,
} from "lucide-react";

import { LocalTime } from "@/components/ui/LocalTime";
import { EmptyState, StatusBadge } from "@/components/ui/report-kit";
import type {
  WorkRoomCycleView,
  WorkRoomOutcomePacket,
  WorkRoomView,
} from "@/lib/work-management/room-types";

function OutcomePacketSummary({ packet }: { packet: WorkRoomOutcomePacket }) {
  const durableCount = packet.decisionRefs.length
    + packet.artifactRefs.length
    + packet.actionRefs.length
    + packet.receiptRefs.length
    + packet.evidenceRefs.length;

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-[var(--dpf-text)]">{packet.summary}</p>
      <div className="flex flex-wrap gap-2 text-xs text-[var(--dpf-muted)]">
        <span>{durableCount} durable {durableCount === 1 ? "record" : "records"}</span>
        <span aria-hidden="true">·</span>
        <span>{packet.unresolvedWork.length} unresolved</span>
        {packet.verifiedByRef ? (
          <>
            <span aria-hidden="true">·</span>
            <span>Verified</span>
          </>
        ) : null}
      </div>
      {packet.unresolvedWork.length > 0 ? (
        <ul className="space-y-2 border-l-2 border-[var(--dpf-border)] pl-3 text-sm">
          {packet.unresolvedWork.map((item) => (
            <li key={`${item.disposition}:${item.summary}`}>
              <span className="text-[var(--dpf-text)]">{item.summary}</span>
              <span className="ml-2 text-xs text-[var(--dpf-muted)]">{item.disposition.replaceAll("-", " ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CurrentCycle({ cycle }: { cycle: WorkRoomCycleView }) {
  return (
    <section aria-labelledby="work-room-current-cycle-title" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--dpf-border)] px-4 py-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--dpf-muted)]">Current cycle</p>
          <h2 id="work-room-current-cycle-title" className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
            {cycle.objective}
          </h2>
        </div>
        <StatusBadge
          intent={cycle.status === "verifying" ? "warning" : "accent"}
          label={cycle.status === "verifying" ? "Verifying" : "In progress"}
          variant="soft"
        />
      </div>
      <div className="grid gap-4 px-4 py-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-[var(--dpf-muted)]">Triggered by</p>
          <p className="mt-1 leading-6 text-[var(--dpf-text)]">{cycle.trigger}</p>
        </div>
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs text-[var(--dpf-muted)]">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            Review by
          </p>
          <p className="mt-1 font-medium text-[var(--dpf-text)]">
            {cycle.expectedReviewAt ? <LocalTime value={cycle.expectedReviewAt} mode="datetime" /> : "Not set"}
          </p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs text-[var(--dpf-muted)]">Measure of done</p>
          <p className="mt-1 leading-6 text-[var(--dpf-text)]">{cycle.measureSummary}</p>
        </div>
      </div>
      <details className="border-t border-[var(--dpf-border)]">
        <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
          Stop conditions and cycle record
        </summary>
        <div className="space-y-3 border-t border-[var(--dpf-border)] px-4 py-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
            {cycle.stopConditions.map((condition) => <li key={condition}>{condition}</li>)}
          </ul>
          <p className="text-xs text-[var(--dpf-muted)]">Cycle {cycle.cycleKey} · {cycle.carrierKind}</p>
        </div>
      </details>
    </section>
  );
}

function CompletedCycles({ cycles }: { cycles: readonly WorkRoomCycleView[] }) {
  if (cycles.length === 0) return null;

  return (
    <section aria-labelledby="work-room-completed-cycles-title" className="overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--dpf-border)] px-4 py-3">
        <h2 id="work-room-completed-cycles-title" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
          <History className="size-4" aria-hidden="true" />
          Completed cycles
        </h2>
        <span className="text-xs text-[var(--dpf-muted)]">{cycles.length}</span>
      </div>
      <ol className="divide-y divide-[var(--dpf-border)]">
        {cycles.map((cycle, index) => (
          <li key={cycle.cycleKey}>
            <details open={index === 0}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--dpf-accent)]">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-[var(--dpf-text)]">
                  <CheckCircle2 className="size-4 shrink-0 text-[var(--dpf-success)]" aria-hidden="true" />
                  <span className="truncate">{cycle.outcomePacket?.summary ?? cycle.objective}</span>
                </span>
                {cycle.outcomePacket?.completedAt ? (
                  <LocalTime value={cycle.outcomePacket.completedAt} mode="date" className="shrink-0 text-xs text-[var(--dpf-muted)]" />
                ) : null}
              </summary>
              {cycle.outcomePacket ? (
                <div className="border-t border-[var(--dpf-border)] px-4 py-4">
                  <OutcomePacketSummary packet={cycle.outcomePacket} />
                </div>
              ) : null}
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WorkRoomCycles({ room }: { room: WorkRoomView }) {
  if (room.mode !== "standing") return null;

  return (
    <div className="space-y-3">
      {room.currentCycle ? (
        <CurrentCycle cycle={room.currentCycle} />
      ) : (
        <section aria-label="Current cycle" className="rounded-xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <EmptyState
            size="sm"
            bordered={false}
            title="Ready for the next cycle"
            description="This standing room is healthy and idle. Open a bounded cycle when the next trigger arrives."
            icon={<RefreshCw className="size-6" />}
          />
        </section>
      )}
      <CompletedCycles cycles={room.completedCycles} />
    </div>
  );
}
