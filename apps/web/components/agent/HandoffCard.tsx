// apps/web/components/agent/HandoffCard.tsx
//
// EP-A2A (Slice 1A) — card rendered inside the collaboration disclosure when
// one coworker hands off to, summons, or returns from another coworker (G1).
// Driven by collaboration:handoff / :summon / :return events. Theme tokens only
// (AGENTS.md §12); lucide icon + text carry meaning, not color.

import { Handshake, UserPlus, Undo2 } from "lucide-react";
export { collaborationReturnMessage } from "./collaboration-return-message";

export type CollaborationCard = {
  id: string;
  kind: "handoff" | "summon" | "return";
  fromLabel: string;
  toLabel: string;
  tier: 2 | 3;
  summary?: string;
  outcome?: "completed" | "failed" | "canceled";
  childThreadId: string;
};

const KIND_VERB: Record<CollaborationCard["kind"], string> = {
  handoff: "asked",
  summon: "summoned",
  return: "returned from",
};

const KIND_ICON = {
  handoff: Handshake,
  summon: UserPlus,
  return: Undo2,
} as const;

export function HandoffCard({ card }: { card: CollaborationCard }) {
  const isReturn = card.kind === "return";
  const Icon = KIND_ICON[card.kind];
  return (
    <div
      role="note"
      aria-label={`${card.fromLabel} ${KIND_VERB[card.kind]} ${card.toLabel}${card.summary ? `: ${card.summary}` : ""}`}
      className="my-1 flex flex-col gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
    >
      <div className="flex items-center gap-2 text-xs text-[var(--dpf-text)]">
        <Icon aria-hidden size={14} className="shrink-0 text-[var(--dpf-muted)]" />
        <span className="font-medium">{card.fromLabel}</span>
        <span className="text-[var(--dpf-muted)]">{KIND_VERB[card.kind]}</span>
        <span className="font-medium">{card.toLabel}</span>
        <span className="ml-auto rounded bg-[var(--dpf-surface-1)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
          Tier {card.tier}
        </span>
      </div>
      {card.summary ? (
        <p className="text-xs text-[var(--dpf-muted)]">{card.summary}</p>
      ) : null}
      {isReturn && card.outcome ? (
        <p className="text-[11px] text-[var(--dpf-muted)]">Outcome: {card.outcome}</p>
      ) : null}
    </div>
  );
}
