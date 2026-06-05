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
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { taskStateIntent } from "@/lib/tak/task-state-intent";

const ROLE_LABEL: Record<ConversationParticipant["role"], string> = {
  owner: "Owner",
  peer: "Peer",
  "sub-agent": "Sub-agent",
};

// Roster body of the collaboration disclosure (CollaborationActivityPanel).
// Visibility is decided by the parent disclosure, not here.
export function ConversationParticipantRail({
  participants,
}: {
  participants: ConversationParticipant[];
}) {
  if (participants.length === 0) return null;

  return (
    <div role="list" aria-label="Conversation participants" className="flex flex-wrap items-center gap-2">
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
          <StatusBadge intent={taskStateIntent(p.state)} label={p.state} size="sm" variant="soft" />
        </div>
      ))}
    </div>
  );
}
