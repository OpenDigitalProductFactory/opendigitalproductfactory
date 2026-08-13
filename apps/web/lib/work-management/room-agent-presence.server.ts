/**
 * Agent presence in a Work Room (EP-WORKROOM-COMMS, BI-3F21C4D5).
 *
 * The human heartbeat (work-item-presence-actions.ts) is auth()-gated and writes
 * principalType="user"; an agent has no browser session. This writes an
 * principalType="agent" presence row keyed by the agent's canonical principalId
 * (so the participant projection lights it up "active" without an alias remap).
 * filterActivePresence already handles the "agent" principalType. Presence never
 * grants authority — admission is decided separately (room-agent-access).
 */
import { prisma } from "@dpf/db";

export async function heartbeatAgentWorkItemPresence(input: {
  workItemId: string;
  agentPrincipalId: string;
  label?: string | null;
}): Promise<{ ok: boolean }> {
  const label = input.label?.trim() || null;
  await prisma.workItemPresence.upsert({
    where: {
      workItemId_principalType_principalId: {
        workItemId: input.workItemId,
        principalType: "agent",
        principalId: input.agentPrincipalId,
      },
    },
    create: {
      workItemId: input.workItemId,
      principalType: "agent",
      principalId: input.agentPrincipalId,
      displayLabel: label,
    },
    update: { lastSeenAt: new Date(), displayLabel: label },
  });
  return { ok: true };
}
