// The Grok credentials client acts as AGT-EXT-GROK (BI-8D152751).
//
// A client_credentials token carries its OAuth client's agent (oauth/token
// route). workCapsuleActor refuses every workroom write from an OAuth caller
// without one, so an unbound Grok client could read but never claim, adopt or
// heartbeat a Workroom. These are the two database steps ensureGrokCredentialsClient
// needs, shared by the container setup script and the MCP issuer.
import type { Prisma } from "@dpf/db";

export const GROK_AGENT_ID = "AGT-EXT-GROK";

type Db = Pick<Prisma.TransactionClient, "agent" | "oAuthClient">;

/** AGT-EXT-GROK's record id when it may act for the client, else null. */
export async function grokAgentRecordId(db: Db): Promise<string | null> {
  const agent = await db.agent.findFirst({
    where: {
      agentId: GROK_AGENT_ID,
      status: "active",
      archived: false,
      toolGrants: { some: { grantKey: "work_room_write" } },
    },
    select: { id: true },
  });
  return agent?.id ?? null;
}

/** Bind an unbound client only; a client bound elsewhere is never rewritten. */
export async function bindGrokClientAgent(db: Db, oAuthClientId: string, agentRecordId: string): Promise<void> {
  await db.oAuthClient.updateMany({
    where: { oAuthClientId, agentId: null },
    data: { agentId: agentRecordId },
  });
}
