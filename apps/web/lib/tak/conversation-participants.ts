/**
 * EP-A2A — Conversation participant projection, DB wrapper (2026-06-04 spec,
 * Slice 1). Gathers the root + depth-1 child threads, their TaskRuns, the
 * acting agent per thread, and identity lookups, then runs the pure core
 * (`buildParticipants` in `conversation-participants-core.ts`).
 *
 * The load-bearing lineage edge is `AgentThread.parentThreadId`; the companion
 * `TaskRun.parentTaskRunId` is now populated when the parent thread has a
 * TaskRun, but root coworker threads often have none, so the thread edge
 * remains canonical.
 *
 * Identity: actors resolve to a `Principal` via `PrincipalAlias`
 * (aliasType=`agent`, aliasValue=agentId) per AGENTS.md §11. When no alias row
 * exists (agents predating principal-convergence), the projection FAILS OPEN to
 * the agentId as the actor key rather than crashing — consistent with the
 * Operations Map fail-open rule.
 */
import { prisma } from "@dpf/db";
import { isSafeKey } from "@/lib/security/safe-property";
import {
  buildParticipants,
  readCollaborationProvenance,
  type AgentIdentity,
  type CollaborationProvenance,
  type ConversationParticipant,
} from "./conversation-participants-core";

export * from "./conversation-participants-core";

/**
 * DB wrapper. Gathers the root + depth-1 child threads, their TaskRuns, the
 * acting agent per thread, and the identity lookups, then runs the pure core.
 */
export async function projectParticipants(
  rootThreadId: string,
  opts: { ownerAgentId?: string | null } = {},
): Promise<ConversationParticipant[]> {
  const threads = await prisma.agentThread.findMany({
    where: { OR: [{ id: rootThreadId }, { parentThreadId: rootThreadId }] },
    select: { id: true, parentThreadId: true },
  });
  const threadIds = threads.map((t) => t.id);

  const taskRuns = await prisma.taskRun.findMany({
    where: { threadId: { in: threadIds } },
    select: {
      threadId: true,
      taskRunId: true,
      status: true,
      currentAgentId: true,
      initiatingAgentId: true,
      startedAt: true,
      a2aMetadata: true,
    },
  });

  // Persisted collaboration provenance per child thread (latest TaskRun wins).
  // Keys (thread ids, agent ids) flow from DB rows; guard every computed-key
  // write with isSafeKey to bar prototype-polluting keys (__proto__ etc.) —
  // CodeQL js/remote-property-injection barrier (lib/security/safe-property.ts).
  const provenanceByThread: Record<string, CollaborationProvenance | null> = {};
  for (const t of threads) {
    if (!isSafeKey(t.id)) continue;
    const tr = taskRuns
      .filter((r) => r.threadId === t.id)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    provenanceByThread[t.id] = tr ? readCollaborationProvenance(tr.a2aMetadata) : null;
  }

  // Acting agent per thread: prefer the TaskRun's current/initiating agent;
  // else the most recent assistant message's agentId on that thread.
  const actingAgentByThread: Record<string, string | null> = {};
  for (const t of threads) {
    if (!isSafeKey(t.id)) continue;
    const tr = taskRuns
      .filter((r) => r.threadId === t.id)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    actingAgentByThread[t.id] = tr?.currentAgentId ?? tr?.initiatingAgentId ?? null;
  }
  const threadsMissingAgent = threads.filter((t) => !actingAgentByThread[t.id]);
  if (threadsMissingAgent.length > 0) {
    const recentMsgs = await prisma.agentMessage.findMany({
      where: { threadId: { in: threadsMissingAgent.map((t) => t.id) }, role: "assistant" },
      orderBy: { createdAt: "desc" },
      select: { threadId: true, agentId: true },
    });
    for (const t of threadsMissingAgent) {
      if (!isSafeKey(t.id)) continue;
      const msg = recentMsgs.find((m) => m.threadId === t.id && m.agentId);
      if (msg?.agentId) actingAgentByThread[t.id] = msg.agentId;
    }
  }

  const agentIds = Array.from(
    new Set(
      [opts.ownerAgentId ?? null, ...Object.values(actingAgentByThread)].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  );

  let identities: Record<string, AgentIdentity> = {};
  if (agentIds.length > 0) {
    const [agents, aliases] = await Promise.all([
      prisma.agent.findMany({
        where: { agentId: { in: agentIds } },
        select: { agentId: true, name: true },
      }),
      prisma.principalAlias.findMany({
        where: { aliasType: "agent", aliasValue: { in: agentIds } },
        select: { aliasValue: true, principal: { select: { principalId: true } } },
      }),
    ]);
    const labelByAgent = new Map(agents.map((a) => [a.agentId, a.name]));
    const principalByAgent = new Map(aliases.map((a) => [a.aliasValue, a.principal.principalId]));
    // Build via Object.fromEntries rather than a computed-key write
    // (identities[agentId] = ...) so DB-derived agent ids cannot reach a
    // prototype-polluting bracket-write sink (CWE-1321 /
    // CodeQL js/remote-property-injection). The project isSafeKey barrier is
    // modeled as return-value taint clearing, which does not sanitise a
    // boolean-guard usage, so the structural fix is used here.
    identities = Object.fromEntries(
      agentIds.map((agentId): [string, AgentIdentity] => [
        agentId,
        {
          agentId,
          label: labelByAgent.get(agentId) ?? agentId,
          principalId: principalByAgent.get(agentId) ?? null,
        },
      ]),
    );
  }

  return buildParticipants({
    rootThreadId,
    threads,
    taskRuns,
    actingAgentByThread,
    identities,
    ownerAgentId: opts.ownerAgentId ?? null,
    provenanceByThread,
  });
}
