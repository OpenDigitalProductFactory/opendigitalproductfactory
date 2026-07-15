// apps/web/components/twin/ActorMark.tsx
//
// Shared rendering of an actor on the twin — a human or an AI coworker — on ONE
// plane (the operating-twin doctrine, parent spec §3.3). Used by resource units,
// work items, presence, and the feed so the two are always visually attributed
// and never segregated into separate lists.

import { Bot, User } from "lucide-react";

import type { TwinActorKind } from "./types";

export interface ActorMarkProps {
  name: string;
  kind: TwinActorKind;
  /** Icon-only (for dense contexts like a resource-unit owner line). */
  compact?: boolean;
  className?: string;
}

export function ActorMark({ name, kind, compact, className = "" }: ActorMarkProps) {
  const isAi = kind === "ai";
  const Icon = isAi ? Bot : User;
  const color = isAi ? "var(--dpf-accent)" : "var(--dpf-muted)";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${className}`.trim()}
      title={isAi ? `${name} (AI coworker)` : name}
    >
      <Icon aria-hidden size={12} style={{ color }} />
      {compact ? (
        <span className="sr-only">{isAi ? `${name}, AI coworker` : name}</span>
      ) : (
        <span style={{ color: isAi ? "var(--dpf-accent)" : "var(--dpf-text-secondary)" }}>
          {name}
        </span>
      )}
    </span>
  );
}
