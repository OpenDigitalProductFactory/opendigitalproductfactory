import { LocalTime } from "@/components/ui/LocalTime";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import type { WorkroomView } from "@/lib/work-management/room-types";
import type { WorkroomShapeConformanceDisposition } from "@/lib/work-management/workroom-shape-conformance";

import { roomLabel } from "./presentation";

const DISPOSITION_INTENT = {
  continue: "success",
  complete: "success",
  "not-applicable": "neutral",
  pause: "warning",
  escalate: "danger",
  stop: "danger",
} as const;

function coordinatorLabel(room: WorkroomView): string {
  const ref = room.processOverseer.processOverseerPrincipalRef;
  return room.participants.find((participant) => participant.principalRef === ref)?.displayName
    ?? ref
    ?? "Not assigned";
}

function sourceLabel(source: WorkroomView["processOverseer"]["processOverseerSource"]): string {
  if (source === "explicit") return "Explicit assignment";
  if (source === "derived") return "Compatibility-only derived assignment";
  return "No assignment";
}

function interventionVariant(disposition: WorkroomShapeConformanceDisposition) {
  if (disposition === "stop" || disposition === "escalate") return "error" as const;
  if (disposition === "pause") return "warn" as const;
  return "info" as const;
}

export function WorkroomProcessOverseer({ room }: { room: WorkroomView }) {
  const projection = room.processOverseer;
  const shapeIdentity = projection.shapeKey
    ? `${projection.shapeKey}@${projection.shapeVersion ?? "unresolved"}`
    : "No executable work shape";

  return (
    <Surface as="section" aria-label="Process Overseer" padding="none" rounded="xl">
      <details>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
          <span>Process Overseer</span>
          <StatusBadge
            intent={DISPOSITION_INTENT[projection.disposition]}
            label={roomLabel(projection.disposition)}
            variant="soft"
          />
        </summary>
        <div className="space-y-3 border-t border-[var(--dpf-border)] px-4 py-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-[var(--dpf-muted)]">Coordinator</p>
              <p className="mt-1 font-medium text-[var(--dpf-text)]">{coordinatorLabel(room)}</p>
              <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">{sourceLabel(projection.processOverseerSource)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--dpf-muted)]">Work shape</p>
              <p className="mt-1 break-all font-medium text-[var(--dpf-text)]">{shapeIdentity}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--dpf-muted)]">Current stage</p>
              <p className="mt-1 font-medium text-[var(--dpf-text)]">{roomLabel(projection.currentStageKey ?? "Not started")}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--dpf-muted)]">Next permitted stage</p>
              <p className="mt-1 font-medium text-[var(--dpf-text)]">{roomLabel(projection.nextPermittedStageKey ?? "None")}</p>
            </div>
          </div>

          {projection.interventionReason ? (
            <Notice variant={interventionVariant(projection.disposition)} title="Overseer assessment">
              <p>{projection.interventionReason}</p>
            </Notice>
          ) : null}

          {projection.deviations.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
              {projection.deviations.map((deviation) => (
                <li key={`${deviation.code}:${deviation.summary}`}>{deviation.summary}</li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-[var(--dpf-muted)]">
            Checked <time dateTime={projection.checkedAt}><LocalTime value={projection.checkedAt} mode="datetime" /></time> · {projection.reconciliationKey}
          </p>
        </div>
      </details>
    </Surface>
  );
}
