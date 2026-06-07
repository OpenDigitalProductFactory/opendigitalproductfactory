/**
 * EP-A2A — Conversation participant projection, PURE CORE (2026-06-04 spec,
 * Slice 1). No IO, no prisma import — deterministic over its inputs so it is
 * unit-testable without a DB (mirrors the AI Operations Map's pure
 * `project-events.ts` split from the DB-bound `load-map-data.ts`).
 *
 * The DB wrapper that gathers rows and calls `buildParticipants` lives in
 * `conversation-participants.ts`.
 */
import { TASK_STATES, type TaskState } from "@/lib/tak/task-states";

/** How a participant entered the conversation. */
export type ParticipantEnteredVia = "route" | "summon" | "handoff" | "escalation" | "spawn";

/**
 * Collaboration provenance persisted on the child `TaskRun.a2aMetadata`
 * (`{ collaboration: CollaborationProvenance }`) so handoff/summon cards and
 * accurate `enteredVia` survive a page refresh — the projection and card
 * reconstruction both read this. No new table (spec A1 / Data Model Posture).
 */
export type CollaborationProvenance = {
  kind: "handoff" | "summon";
  fromAgentId: string | null;
  toAgentId: string;
  enteredVia: ParticipantEnteredVia;
  tier: 2 | 3;
  summary?: string;
  byUserId?: string;
};

/** Narrow an unknown a2aMetadata JSON blob to its embedded provenance, if present. */
export function readCollaborationProvenance(a2aMetadata: unknown): CollaborationProvenance | null {
  if (!a2aMetadata || typeof a2aMetadata !== "object") return null;
  const collab = (a2aMetadata as Record<string, unknown>)["collaboration"];
  if (!collab || typeof collab !== "object") return null;
  const c = collab as Record<string, unknown>;
  if (typeof c["toAgentId"] !== "string") return null;
  const kind = c["kind"] === "summon" ? "summon" : "handoff";
  const enteredVia = ((): ParticipantEnteredVia => {
    const v = c["enteredVia"];
    return v === "summon" || v === "handoff" || v === "escalation" || v === "spawn" || v === "route"
      ? v
      : kind;
  })();
  return {
    kind,
    fromAgentId: typeof c["fromAgentId"] === "string" ? (c["fromAgentId"] as string) : null,
    toAgentId: c["toAgentId"] as string,
    enteredVia,
    tier: c["tier"] === 3 ? 3 : 2,
    summary: typeof c["summary"] === "string" ? (c["summary"] as string) : undefined,
    byUserId: typeof c["byUserId"] === "string" ? (c["byUserId"] as string) : undefined,
  };
}

/** A coworker participating in a conversation, projected from thread/task edges. */
export type ConversationParticipant = {
  /** Canonical identity (AGENTS.md §11). Falls back to agentId when no alias row exists. */
  principalId: string;
  /** True when principalId is a fail-open agentId fallback, not a resolved Principal. */
  principalResolved: boolean;
  agentId: string;
  label: string;
  /** owner = route-resolved primary; peer = summoned; sub-agent = spawned worker. */
  role: "owner" | "peer" | "sub-agent";
  /** Interaction tier per the 1-1 → 2nd/3rd-tier framing. */
  tier: 1 | 2 | 3;
  state: TaskState;
  enteredVia: ParticipantEnteredVia;
  /** Thread cuid this participant is acting on. */
  threadId: string;
  /** The participant (by threadId) that brought this one in, if any. */
  parentThreadId: string | null;
  taskRunId: string | null;
};

/** A thread row, narrowed to the fields the projection needs. */
export type ParticipantThreadRow = {
  id: string;
  parentThreadId: string | null;
};

/** A TaskRun row, narrowed. */
export type ParticipantTaskRunRow = {
  threadId: string | null;
  taskRunId: string;
  status: string;
  currentAgentId: string | null;
  initiatingAgentId: string | null;
  startedAt: Date;
};

/** Resolution of an agentId to its display + identity. */
export type AgentIdentity = {
  agentId: string;
  label: string;
  /** Resolved Principal.principalId, or null when no PrincipalAlias row exists. */
  principalId: string | null;
};

export type ParticipantProjectionInput = {
  rootThreadId: string;
  /** root + depth-1 child threads (`parentThreadId === rootThreadId`). */
  threads: ParticipantThreadRow[];
  /** TaskRuns for any of those threads. */
  taskRuns: ParticipantTaskRunRow[];
  /** Acting agentId per threadId (TaskRun current/initiating, else latest assistant message). */
  actingAgentByThread: Record<string, string | null>;
  /** Identity lookup per agentId. */
  identities: Record<string, AgentIdentity>;
  /** Route-resolved owner agentId for the root conversation, if known. */
  ownerAgentId?: string | null;
  /** Persisted collaboration provenance per child threadId (from a2aMetadata). */
  provenanceByThread?: Record<string, CollaborationProvenance | null>;
};

function toTaskState(status: string): TaskState {
  return (TASK_STATES as readonly string[]).includes(status) ? (status as TaskState) : "working";
}

function latestTaskRunForThread(
  threadId: string,
  taskRuns: ParticipantTaskRunRow[],
): ParticipantTaskRunRow | null {
  let latest: ParticipantTaskRunRow | null = null;
  for (const tr of taskRuns) {
    if (tr.threadId !== threadId) continue;
    if (!latest || tr.startedAt.getTime() > latest.startedAt.getTime()) latest = tr;
  }
  return latest;
}

/**
 * Pure projection core. Deterministic over its inputs; no IO. The owner is the
 * root thread's participant; depth-1 child threads are sub-agents (Slice 1 has
 * no persisted summon/handoff metadata yet, so existing children are
 * `enteredVia: "spawn"`; `summon`/`handoff` are attached by the collaboration
 * tools as those land).
 */
export function buildParticipants(input: ParticipantProjectionInput): ConversationParticipant[] {
  const { rootThreadId, threads, taskRuns, actingAgentByThread, identities, ownerAgentId } = input;
  const provenanceByThread = input.provenanceByThread ?? {};

  const participants: ConversationParticipant[] = [];

  for (const thread of threads) {
    const isOwner = thread.id === rootThreadId;
    const acting = actingAgentByThread[thread.id] ?? null;
    const agentId = isOwner ? ownerAgentId ?? acting : acting;
    if (!agentId) continue; // a thread with no resolvable agent contributes no participant

    const identity: AgentIdentity = identities[agentId] ?? {
      agentId,
      label: agentId,
      principalId: null,
    };

    const tr = latestTaskRunForThread(thread.id, taskRuns);
    const state: TaskState = tr ? toTaskState(tr.status) : isOwner ? "working" : "submitted";

    // Persisted provenance makes role/enteredVia/tier accurate across refresh.
    // A summoned coworker is a "peer"; a requested handoff is a "sub-agent".
    const prov = provenanceByThread[thread.id] ?? null;
    participants.push({
      principalId: identity.principalId ?? identity.agentId,
      principalResolved: identity.principalId != null,
      agentId,
      label: identity.label,
      role: isOwner ? "owner" : prov?.kind === "summon" ? "peer" : "sub-agent",
      tier: isOwner ? 1 : prov?.tier ?? 2,
      state,
      enteredVia: isOwner ? "route" : prov?.enteredVia ?? "spawn",
      threadId: thread.id,
      parentThreadId: thread.parentThreadId,
      taskRunId: tr?.taskRunId ?? null,
    });
  }

  // Owner first, then children in stable insertion order.
  participants.sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0));
  return participants;
}
