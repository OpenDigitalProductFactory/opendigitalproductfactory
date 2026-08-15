import { AlertTriangle, ArrowLeft, Clock, Users } from "lucide-react";

import { LocalTime } from "@/components/ui/LocalTime";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { WorkRoomStructurePanel } from "@/components/workspace/work-room/WorkRoomStructurePanel";
import type { WorkspaceWorkCaseListItem } from "@/lib/work-management/workspace-case-loader";
import type { WorkRoomView } from "@/lib/work-management/room-types";

import {
  roomLabel,
} from "./presentation";

type Props = {
  room: WorkRoomView;
  summary: WorkspaceWorkCaseListItem;
};

function accountableName(room: WorkRoomView): string {
  return room.participants.find((participant) =>
    participant.roles.includes("accountable"),
  )?.displayName ?? "Accountable owner not assigned";
}

function participantSummary(room: WorkRoomView): string {
  const count = room.participants.length;
  if (count === 0) return "No participants listed";
  const names = room.participants.slice(0, 2).map((participant) => participant.displayName);
  const remainder = count - names.length;
  return `${count} ${count === 1 ? "participant" : "participants"} · ${names.join(", ")}${remainder > 0 ? ` +${remainder}` : ""}`;
}

export function WorkRoomHeader({ room, summary }: Props) {
  const health = room.outcome.health;
  const purposeNeedsDisclosure = (room.purpose?.length ?? 0) > 280;
  const dueAt = room.boundary.timeBoundary.reviewAt
    ?? room.boundary.timeBoundary.dueAt
    ?? summary.dueAt;

  return (
    <>
      <a
        href="/workspace/my-queue"
        className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-[var(--dpf-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        My Work
      </a>

      {room.projection.sourceHealth === "unavailable" ? (
        <Notice variant="error" title="Room source unavailable">
          This is the last available room projection. Return to My Work and try opening the room again.
        </Notice>
      ) : null}

      <header
        aria-labelledby="work-room-title"
        className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 sm:p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
              Work Room
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge
                domain="workCaseState"
                status={room.state}
                label={roomLabel(room.state)}
                variant="soft"
              />
              <StatusBadge intent="neutral" label={roomLabel(room.mode)} variant="outline" />
              <StatusBadge
                intent={summary.attentionRequired ? "warning" : "neutral"}
                label={summary.urgencyLabel}
                variant="outline"
              />
              {room.boundary.sensitivityCeiling ? (
                <span className="text-xs text-[var(--dpf-muted)]">
                  {roomLabel(room.boundary.sensitivityCeiling)}
                </span>
              ) : null}
              <span className="text-xs text-[var(--dpf-muted)]">{summary.sourceLabel}</span>
            </div>
            <h1 id="work-room-title" className="mt-3 text-2xl font-semibold text-[var(--dpf-text)] sm:text-3xl">
              {room.title}
            </h1>
            {room.purpose && purposeNeedsDisclosure ? (
              <details className="group mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-[var(--dpf-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
                  Room purpose
                </summary>
                <p className="pb-1 leading-6">{room.purpose}</p>
              </details>
            ) : room.purpose ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">{room.purpose}</p>
            ) : null}
          </div>
          {dueAt ? (
            <div className="inline-flex shrink-0 items-center gap-2 text-sm text-[var(--dpf-muted)]">
              <Clock className="size-4" aria-hidden="true" />
              <span>
                {room.boundary.timeBoundary.reviewAt ? "Review " : "Due "}
                <LocalTime value={dueAt} mode="date" />
              </span>
            </div>
          ) : null}
        </div>

        <section aria-labelledby="work-room-outcome-title" className="mt-5 rounded-lg bg-[var(--dpf-surface-2)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="work-room-outcome-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              Outcome
            </h2>
            {health ? (
              <StatusBadge domain="workRoomOutcomeHealth" status={health} label={roomLabel(health)} variant="soft" />
            ) : null}
          </div>
          <p className="mt-2 text-base font-semibold leading-6 text-[var(--dpf-text)]">
            {room.outcome.statement ?? "Outcome not defined"}
          </p>
        </section>

        <WorkRoomStructurePanel structure={room.structure} />

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <section aria-label="Attention" className="rounded-lg border border-[var(--dpf-border)] p-3">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
              {room.work.attentionRequired ? <AlertTriangle className="size-4 text-[var(--dpf-warning)]" aria-hidden="true" /> : null}
              Attention
            </p>
            <p className="mt-2 text-sm font-medium text-[var(--dpf-text)]">
              {room.work.attentionRequired
                ? room.work.attentionReason ?? "Attention is required."
                : "No immediate attention needed."}
            </p>
          </section>
          <section aria-label="Next action" className="rounded-lg border border-[var(--dpf-accent)] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">Next action</p>
            <p className="mt-2 text-sm font-semibold text-[var(--dpf-text)]">{room.work.nextAction}</p>
          </section>
          <section aria-label="Accountability" className="rounded-lg border border-[var(--dpf-border)] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">Accountable</p>
            <p className="mt-2 text-sm font-medium text-[var(--dpf-text)]">{accountableName(room)}</p>
          </section>
          <section aria-label="Participant summary" className="rounded-lg border border-[var(--dpf-border)] p-3">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
              <Users className="size-4" aria-hidden="true" />
              Participants
            </p>
            <p className="mt-2 text-sm font-medium text-[var(--dpf-text)]">{participantSummary(room)}</p>
          </section>
        </div>
      </header>
    </>
  );
}
