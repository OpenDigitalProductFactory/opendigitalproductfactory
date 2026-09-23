// The principal an MCP Workroom call acts as.
//
// Extracted from mcp-handlers.ts (BI-CB3AEBBF) when the module-size ratchet
// refused that file's growth. Identity resolution is plumbing every handler
// shares rather than handler logic, so it is the part that should move — golfing
// lines out of the handlers to fit under the ceiling would have kept the file
// oversized in substance while satisfying the count.
//
// OAuth ownership belongs to the authorizing human. The shared assistant is
// attribution, never a substitute for that human's ownership.

// Callers pass an optional tool context, so the parameter admits undefined —
// narrowing it here was the one behaviour change the extraction nearly made.
type ActorContext = { agentId?: string; authSource?: string } | undefined;

export async function workCapsuleActor(userId: string, context: ActorContext) {
  const { ensureAgentPrincipalIdentity, syncUserPrincipal } = await import("@/lib/identity/principal-linking");
  const agentId = context?.agentId ?? null;
  if (context?.authSource === "oauth") {
    const human = await syncUserPrincipal(userId);
    const agent = agentId ? await ensureAgentPrincipalIdentity(agentId) : null;
    if (!human?.id || !agent?.id) throw new Error("Your assistant connection could not be verified. Please try again shortly.");
    return { userId, agentId, principalId: human.id, agentPrincipalId: agent.id };
  }
  let principalId: string | null = null;

  try {
    if (agentId) {
      const synced = await ensureAgentPrincipalIdentity(agentId);
      principalId = synced?.id ?? null;
    } else {
      const synced = await syncUserPrincipal(userId);
      principalId = synced?.id ?? null;
    }
  } catch {
    principalId = null;
  }

  return { userId, agentId, principalId };
}
