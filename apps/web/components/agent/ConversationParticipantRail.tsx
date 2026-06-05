// apps/web/components/agent/ConversationParticipantRail.tsx
//
// EP-A2A (2026-06-04 spec, Slice 1) — renders the multi-agent participant
// roster for a conversation so the user SEES who else is involved beyond the
// owner coworker (closes part of G1). Reuses report-kit StatusBadge for state
// (no hand-rolled badge / hardcoded color, AGENTS.md §12). Color is never the
// sole channel: every participant carries role + label text + state label.
//
// Quiet by default: renders nothing for a 1-1 conversation (owner only).

import type { ConversationParticipant } from "@/lib/tak/conversation-participants-core";
import type { TaskState } from "@/lib/tak/task-states";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import type { Intent } from "@/components/ui/report-kit/statusColors";

function stateIntent(state: TaskState): Intent {
  switch (state) {
    case "completed":
    case "archived":
      return "success";
    case "failed":
    case "rejected":
    case "stalled":
    case "paused-for-upgrade-forced":
      return "danger";
    case "input-required":
    case "auth-required":
      return "warning";
    case "working":
    case "submitted":
      return "accent";
    default:
      return "neutral";
  }
}

const ROLE_LABEL: Record<ConversationParticipant["role"], string> = {
  owner: "Owner",
  peer: "Peer",
  "sub-agent": "Sub-agent",
};

export function ConversationParticipantRail({
  participants,
}: {
  participants: ConversationParticipant[];
}) {
  // Quiet for 1-1 (owner only or empty).
  if (participants.length < 2) return null;

  return (
    <div
      role="list"
      aria-label="Conversation participants"
      className="flex flex-wrap items-center gap-2 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
    >
      <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
        Participants
      </span>
      {participants.map((p) => (
        <div
          key={`${p.threadId}:${p.agentId}`}
          role="listitem"
          aria-label={`${p.label}, ${ROLE_LABEL[p.role]}, tier ${p.tier}, ${p.state}`}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1"
        >
          <span
            aria-hidden
            className="text-[10px] font-semibold text-[var(--dpf-muted)]"
            title={`${ROLE_LABEL[p.role]} · tier ${p.tier}`}
          >
            T{p.tier}
          </span>
          <span className="max-w-[10rem] truncate text-xs text-[var(--dpf-text)]">{p.label}</span>
          <StatusBadge intent={stateIntent(p.state)} label={p.state} size="sm" variant="soft" />
        </div>
      ))}
    </div>
  );
}
