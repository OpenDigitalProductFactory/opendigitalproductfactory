// apps/web/components/twin/AttributedFeed.tsx
//
// Primitive 9/10 — attributed feed: who did what, human or AI, on one shared
// event plane (seat/dispatch/allocate actions + AI reactions). Every entry is
// attributed to its actor so the AI coworker reads as a teammate, not an
// invisible automation. Pure + server-usable.

import { ActorMark } from "./ActorMark";
import type { FeedEventData } from "./types";

export interface AttributedFeedProps {
  events: FeedEventData[];
  emptyLabel?: string;
  className?: string;
}

export function AttributedFeed({ events, emptyLabel, className = "" }: AttributedFeedProps) {
  if (events.length === 0) {
    return (
      <p className={`text-[11px] text-[var(--dpf-muted)] ${className}`.trim()}>
        {emptyLabel ?? "No activity yet"}
      </p>
    );
  }
  return (
    <ul className={`flex flex-col gap-1.5 ${className}`.trim()}>
      {events.map((e) => (
        <li key={e.key} className="flex items-baseline gap-2 text-[11px]">
          <ActorMark name={e.actor.name} kind={e.actor.kind} />
          <span className="text-[var(--dpf-text-secondary)]">
            {e.action}
            {e.target ? (
              <span className="text-[var(--dpf-text)]"> {e.target}</span>
            ) : null}
          </span>
          {e.at ? (
            <span className="ml-auto shrink-0 tabular-nums text-[var(--dpf-muted)]">{e.at}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
