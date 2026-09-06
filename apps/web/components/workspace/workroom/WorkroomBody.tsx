"use client";

import {
  Activity,
  FileCheck2,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";

import { LocalTime } from "@/components/ui/LocalTime";
import { EmptyState, Notice, StatusBadge } from "@/components/ui/report-kit";
import { WorkItemCommentBox } from "@/components/workspace/WorkItemCommentBox";
import { projectRoomShape } from "@/lib/work-management/shape-projection";
import type { WorkspaceWorkCaseDetailView } from "@/lib/work-management/workspace-case-loader";
import type {
  WorkroomActivityView,
  WorkroomBoundaryGap,
  WorkroomView,
} from "@/lib/work-management/room-types";

import {
  ACTIVITY_KIND_LABEL,
  roomLabel,
} from "./presentation";
import { WorkroomCycles } from "./WorkroomCycles";
import { WorkroomShapeSection } from "./WorkroomShapeSection";
import { WorkroomParticipants } from "./WorkroomParticipants";
import { WorkroomPosture } from "./WorkroomPosture";
import { WorkroomProcessOverseer } from "./WorkroomProcessOverseer";
import {
  useWorkroomViewMode,
  type WorkroomViewMode,
} from "./ShapeViewToggle";

type Props = {
  detail: WorkspaceWorkCaseDetailView;
  room: WorkroomView;
};

const BOUNDARY_GAP_LABEL: Record<WorkroomBoundaryGap, string> = {
  purpose: "Purpose not defined",
  outcome: "Outcome not defined",
  scope: "Scope not defined",
  participants: "Participants not identified",
  accountable: "Accountable owner not assigned",
  authority: "Authority boundary not defined",
  sensitivity: "Sensitivity ceiling not defined",
  context: "Context not attached",
  measures: "Measures not defined",
  "time-boundary": "Time boundary not defined",
  "closure-rule": "Closure rule not defined",
};

function ActivityEvent({ event }: { event: WorkroomActivityView }) {
  const label = ACTIVITY_KIND_LABEL[event.kind];

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3">
      <span
        aria-label={label}
        className="mt-0.5 inline-flex size-8 items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]"
      >
        <Activity className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge domain="workroomActivity" status={event.kind} label={label} variant="soft" />
          {event.occurredAt ? (
            <LocalTime value={event.occurredAt} mode="datetime" className="text-xs text-[var(--dpf-muted)]" />
          ) : null}
        </div>
        <p className={`mt-2 text-sm leading-6 ${event.emphasis === "quiet" ? "text-[var(--dpf-muted)]" : "text-[var(--dpf-text)]"}`}>
          {event.summary}
        </p>
      </div>
    </li>
  );
}

function BoundaryNotice({ room }: { room: WorkroomView }) {
  if (!room.projection.incompleteBoundary) return null;

  const gaps = room.boundary.gaps.map((gap) => BOUNDARY_GAP_LABEL[gap]);
  const repair = room.boundary.gaps.includes("outcome") && room.boundary.gaps.includes("accountable")
    ? "Define the intended outcome and accountable owner before consequential work continues."
    : `Complete the room boundary before consequential work continues: ${gaps.join(", ")}.`;

  return (
    <Notice variant="warn" title="This room needs a clearer boundary">
      <p>{repair}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {gaps.map((gap) => <li key={gap}>{gap}</li>)}
      </ul>
    </Notice>
  );
}

function ContextPanels({ room }: { room: WorkroomView }) {
  const decisions = room.activity.filter((event) =>
    event.kind === "decision-proposed" || event.kind === "decision-resolved",
  );

  return (
    <div className="space-y-3">
      <WorkroomParticipants room={room} />

      <WorkroomProcessOverseer room={room} />

      <section aria-label="Work" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <details>
          <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
            Work
          </summary>
          <div className="space-y-3 border-t border-[var(--dpf-border)] px-4 py-3 text-sm">
            <div>
              <p className="text-xs text-[var(--dpf-muted)]">Next action</p>
              <p className="mt-1 font-medium text-[var(--dpf-text)]">{room.work.nextAction}</p>
            </div>
            {room.boundary.scopeIncluded.length > 0 ? (
              <div>
                <p className="text-xs text-[var(--dpf-muted)]">In scope</p>
                <p className="mt-1 text-[var(--dpf-text)]">{room.boundary.scopeIncluded.join(", ")}</p>
              </div>
            ) : null}
          </div>
        </details>
      </section>

      <WorkroomPosture room={room} />

      <section aria-label="Context" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <details>
          <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
            Context
          </summary>
          <div className="border-t border-[var(--dpf-border)] px-4 py-3 text-sm leading-6 text-[var(--dpf-muted)]">
            {room.context.digest ?? "No context digest has been recorded yet."}
          </div>
        </details>
      </section>

      <section aria-label="Decisions" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <details>
          <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
            Decisions
          </summary>
          <div className="border-t border-[var(--dpf-border)] px-4 py-3 text-sm">
            {decisions.length > 0 ? (
              <ul className="space-y-2">
                {decisions.map((decision) => <li key={decision.eventId}>{decision.summary}</li>)}
              </ul>
            ) : (
              <p className="text-[var(--dpf-muted)]">No decisions have been recorded.</p>
            )}
          </div>
        </details>
      </section>

      <section aria-label="Outcome" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <details>
          <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
            Outcome
          </summary>
          <div className="border-t border-[var(--dpf-border)] px-4 py-3 text-sm leading-6 text-[var(--dpf-muted)]">
            {room.outcome.packet?.summary
              ?? room.outcome.statement
              ?? "The intended outcome has not been defined."}
          </div>
        </details>
      </section>
    </div>
  );
}

function RoomDetails({ detail, room }: Props) {
  return (
    <details className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
        Room details
      </summary>
      <div className="grid gap-4 border-t border-[var(--dpf-border)] px-4 py-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-[var(--dpf-muted)]">A2A status</p>
          <p className="mt-1 font-medium text-[var(--dpf-text)]">{detail.summary.a2aStatus}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--dpf-muted)]">Definition</p>
          <p className="mt-1 break-all font-medium text-[var(--dpf-text)]">
            {room.identity.definition?.definitionId ?? "Unresolved"}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--dpf-muted)]">Occurrence</p>
          <p className="mt-1 break-all font-medium text-[var(--dpf-text)]">
            {room.identity.instance.instanceId}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--dpf-muted)]">Projection</p>
          <p className="mt-1 font-medium text-[var(--dpf-text)]">
            {roomLabel(room.projection.confidence)} confidence · {roomLabel(room.projection.sourceHealth)}
          </p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs text-[var(--dpf-muted)]">Source references</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {room.sourceRefs.map((ref) => (
              <li key={`${ref.kind}:${ref.id}`} className="min-w-0 rounded-md bg-[var(--dpf-surface-2)] px-3 py-2">
                <span className="text-xs text-[var(--dpf-muted)]">{roomLabel(ref.kind)}</span>
                <span className="ml-2 break-all font-medium text-[var(--dpf-text)]">{ref.id}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

function WorkroomDetailsContent({ detail, room }: Props) {
  return (
    <>
      <WorkroomCycles room={room} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.75fr)]">
        <section
          aria-labelledby="work-room-activity-title"
          className="overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--dpf-border)] px-4 py-3">
            <MessageSquareText className="size-4 text-[var(--dpf-accent)]" aria-hidden="true" />
            <h2 id="work-room-activity-title" className="text-sm font-semibold text-[var(--dpf-text)]">Activity</h2>
          </div>
          {room.activity.length > 0 ? (
            <ol className="divide-y divide-[var(--dpf-border)]">
              {room.activity.map((event) => <ActivityEvent key={event.eventId} event={event} />)}
            </ol>
          ) : (
            <EmptyState
              size="sm"
              bordered={false}
              title="No activity yet"
              description={`This room is ready. Next: ${room.work.nextAction}.`}
              icon={<MessageSquareText className="size-6" />}
            />
          )}

          {detail.evidenceTimeline.length > 0 ? (
            <details className="border-t border-[var(--dpf-border)]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
                <ShieldCheck className="size-4 text-[var(--dpf-success)]" aria-hidden="true" />
                Evidence
              </summary>
              <ol className="divide-y divide-[var(--dpf-border)] border-t border-[var(--dpf-border)]">
                {detail.evidenceTimeline.map((event) => (
                  <li key={event.eventId} className="px-4 py-3 text-sm text-[var(--dpf-text)]">{event.label}</li>
                ))}
              </ol>
            </details>
          ) : null}

          {detail.workItemId ? (
            <div className="border-t border-[var(--dpf-border)] p-4">
              <WorkItemCommentBox workItemId={detail.workItemId} caseKey={room.roomKey} />
            </div>
          ) : null}
        </section>

        <aside aria-label="Work Room context" className="space-y-3">
          <ContextPanels room={room} />
        </aside>
      </div>

      <RoomDetails detail={detail} room={room} />

      {room.receipts.length > 0 ? (
        <section aria-label="Receipts" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <FileCheck2 className="size-4" aria-hidden="true" />
            Receipts
          </h2>
          <p className="mt-2 text-sm text-[var(--dpf-muted)]">{room.receipts.length} recorded</p>
        </section>
      ) : null}
    </>
  );
}

export function WorkroomBodyContent({
  detail,
  room,
  mode,
  onModeChange,
}: Props & {
  mode: WorkroomViewMode;
  onModeChange: (next: WorkroomViewMode) => void;
}) {
  return (
    <>
      <BoundaryNotice room={room} />

      <WorkroomShapeSection
        graph={projectRoomShape(room)}
        room={room}
        mode={mode}
        onModeChange={onModeChange}
      />

      {mode === "detail" ? (
        <WorkroomDetailsContent detail={detail} room={room} />
      ) : null}
    </>
  );
}

export function WorkroomBody({ detail, room }: Props) {
  const [mode, setMode] = useWorkroomViewMode();
  return (
    <WorkroomBodyContent
      detail={detail}
      room={room}
      mode={mode}
      onModeChange={setMode}
    />
  );
}
