import { ShieldCheck, Users } from "lucide-react";

import { Notice, StatusBadge } from "@/components/ui/report-kit";
import type { WorkroomView } from "@/lib/work-management/room-types";

import { roomLabel } from "./presentation";

export function WorkroomParticipants({ room }: { room: WorkroomView }) {
  const hasUnavailableCoworker = room.participants.some(
    (participant) => participant.kind === "agent" && participant.presence === "unknown",
  );

  return (
    <section aria-labelledby="work-room-participants-title" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <details open={hasUnavailableCoworker}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
          <span id="work-room-participants-title" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <Users className="size-4" aria-hidden="true" />
            Participants
          </span>
          <span className="text-xs text-[var(--dpf-muted)]">{room.participants.length}</span>
        </summary>
        <div className="border-t border-[var(--dpf-border)] px-4 py-3">
          {room.participants.length > 0 ? (
            <ul className="space-y-4">
              {room.participants.map((participant) => (
                <li key={participant.principalRef} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--dpf-text)]">{participant.displayName}</span>
                    <StatusBadge intent={participant.kind === "agent" ? "accent" : "neutral"} label={roomLabel(participant.kind)} variant="outline" />
                    {participant.presence === "active" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--dpf-muted)]">
                        <span className="size-1.5 rounded-full bg-[var(--dpf-success)]" aria-hidden="true" />
                        Active now
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                    {participant.roles.map(roomLabel).join(", ")}
                    {participant.currentWorkSummary ? ` · ${participant.currentWorkSummary}` : ""}
                  </p>
                  <dl className="mt-2 grid gap-1.5 text-xs leading-5">
                    {participant.enteredReason ? (
                      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                        <dt className="text-[var(--dpf-muted)]">Why here</dt>
                        <dd className="text-[var(--dpf-text)]">{participant.enteredReason}</dd>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                      <dt className="inline-flex items-center gap-1 text-[var(--dpf-muted)]">
                        <ShieldCheck className="size-3" aria-hidden="true" />
                        Authority
                      </dt>
                      <dd className="text-[var(--dpf-text)]">{participant.authoritySummary}</dd>
                    </div>
                    {participant.sponsorPrincipalRef ? (
                      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                        <dt className="text-[var(--dpf-muted)]">Sponsor</dt>
                        <dd className="text-[var(--dpf-text)]">
                          {participant.sponsorDisplayName ?? participant.sponsorPrincipalRef}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {participant.kind === "agent" && participant.presence === "unknown" ? (
                    <div className="mt-2">
                      <Notice variant="warn" title="Coworker status unavailable">
                        Continue with the room’s next action: {room.work.nextAction}.
                      </Notice>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-6 text-[var(--dpf-muted)]">
              No participants are listed yet. People and coworkers enter through assignment or governed work.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
