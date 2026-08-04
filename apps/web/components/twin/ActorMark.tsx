// apps/web/components/twin/ActorMark.tsx
//
// Shared rendering of an actor on the twin — a human or an AI coworker — on ONE
// plane (the operating-twin doctrine, parent spec §3.3). Used by resource units,
// work items, presence, and the feed so the two are always visually attributed
// and never segregated into separate lists.

import { Bot, Handshake, User } from "lucide-react";

import type { TwinActorKind } from "./types";

export interface ActorMarkProps {
  name: string;
  kind: TwinActorKind;
  /** Icon-only (for dense contexts like a resource-unit owner line). */
  compact?: boolean;
  className?: string;
}

// One visual treatment per actor kind, on one plane (parent spec §3.3). Partners
// (resellers/franchisees) read distinctly from staff without a second list.
const KIND_STYLE: Record<
  TwinActorKind,
  { Icon: typeof Bot; iconColor: string; textColor: string; suffix: string }
> = {
  ai: { Icon: Bot, iconColor: "var(--dpf-accent)", textColor: "var(--dpf-accent)", suffix: " (AI coworker)" },
  partner: {
    Icon: Handshake,
    iconColor: "var(--dpf-info, var(--dpf-accent))",
    textColor: "var(--dpf-text-secondary)",
    suffix: " (partner)",
  },
  human: { Icon: User, iconColor: "var(--dpf-muted)", textColor: "var(--dpf-text-secondary)", suffix: "" },
};

export function ActorMark({ name, kind, compact, className = "" }: ActorMarkProps) {
  const { Icon, iconColor, textColor, suffix } = KIND_STYLE[kind] ?? KIND_STYLE.human;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${className}`.trim()}
      title={`${name}${suffix}`}
    >
      <Icon aria-hidden size={12} style={{ color: iconColor }} />
      {compact ? (
        <span className="sr-only">{`${name}${suffix ? `,${suffix}` : ""}`}</span>
      ) : (
        <span style={{ color: textColor }}>{name}</span>
      )}
    </span>
  );
}
