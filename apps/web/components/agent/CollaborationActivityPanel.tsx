"use client";

// apps/web/components/agent/CollaborationActivityPanel.tsx
//
// EP-A2A Slice 1A (Mark, 2026-06-05) — the canonical "sub-agent activity"
// disclosure: collapsed and summarized by default with a done indicator,
// because the human is not necessarily a direct participant in coworker-to-
// coworker work. Collapsed = one summary row (who, how many, aggregate state +
// in-progress/done indicator). Expanded = the participant roster + the
// handoff/summon/return cards. Quiet for 1-1 conversations.
//
// Theme tokens + lucide only (AGENTS.md §12); the done state is a runtime fact
// derived from participant TaskState (in-flight vs terminal), reduced-motion
// safe (motion-safe:animate-spin).

import { useState } from "react";
import { ChevronDown, ChevronRight, Users, Loader2, CheckCircle2 } from "lucide-react";
import type { ConversationParticipant } from "@/lib/tak/conversation-participants-core";
import { isTaskInFlight } from "@/lib/tak/task-state-intent";
import { ConversationParticipantRail } from "./ConversationParticipantRail";
import { HandoffCard, type CollaborationCard } from "./HandoffCard";

export function CollaborationActivityPanel({
  participants,
  cards,
}: {
  participants: ConversationParticipant[];
  cards: CollaborationCard[];
}) {
  const [open, setOpen] = useState(false);

  const subAgents = participants.filter((p) => p.role !== "owner");
  // Quiet for 1-1: nothing renders unless a peer/sub-agent exists or a
  // collaboration event has fired.
  if (subAgents.length === 0 && cards.length === 0) return null;

  const inFlight = subAgents.filter((p) => isTaskInFlight(p.state)).length;
  const allDone = subAgents.length > 0 && inFlight === 0;

  const names = subAgents.map((p) => p.label);
  const summaryNames =
    names.length === 0
      ? "Coworker"
      : names.length === 1
        ? names[0]
        : `${names[0]} +${names.length - 1}`;
  const statusText = subAgents.length === 0 ? "done" : allDone ? "done" : `${inFlight} working`;

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Sub-agent activity: ${summaryNames}, ${statusText}. ${open ? "Collapse" : "Expand"}`}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)]"
      >
        <Chevron aria-hidden size={14} className="shrink-0 text-[var(--dpf-muted)]" />
        <Users aria-hidden size={14} className="shrink-0 text-[var(--dpf-muted)]" />
        <span className="font-medium">Sub-agent activity</span>
        <span className="truncate text-[var(--dpf-muted)]">— {summaryNames}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[var(--dpf-muted)]">
          {allDone ? (
            <CheckCircle2 aria-hidden size={14} className="text-[var(--dpf-success)]" />
          ) : (
            <Loader2 aria-hidden size={14} className="motion-safe:animate-spin text-[var(--dpf-accent)]" />
          )}
          <span>{statusText}</span>
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {subAgents.length > 0 ? <ConversationParticipantRail participants={participants} /> : null}
          {cards.map((card) => (
            <HandoffCard key={card.id} card={card} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
