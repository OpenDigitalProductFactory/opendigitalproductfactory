// apps/web/components/twin/PresenceRow.tsx
//
// Primitive 8/10 — presence row: who inhabits the twin NOW — humans and AI
// coworkers on one plane, each with what they're attending to. The operating-twin
// doctrine made visible (parent spec §3.3). Pure + server-usable.

import { ActorMark } from "./ActorMark";
import type { TwinActor } from "./types";

export interface PresenceRowProps {
  members: TwinActor[];
  className?: string;
}

export function PresenceRow({ members, className = "" }: PresenceRowProps) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {members.map((m) => (
        <div
          key={`${m.kind}:${m.name}`}
          className="flex items-center gap-2 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-1"
        >
          <ActorMark name={m.name} kind={m.kind} />
          {m.focus ? (
            <span className="text-[11px] text-[var(--dpf-muted)]">· {m.focus}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
