// The principal an MCP Workroom call acts as.
//
// Extracted from mcp-handlers.ts (BI-CB3AEBBF) when the module-size ratchet
// refused that file's growth. Identity resolution is plumbing every handler
// shares rather than handler logic, so it is the part that should move — golfing
// lines out of the handlers to fit under the ceiling would have kept the file
// oversized in substance while satisfying the count.
//
// Behaviour is unchanged, including the deliberate swallow: a principal that
// cannot be resolved yields a null principalId rather than failing the call, so
// an identity-service hiccup does not take out Workroom writes.

// Callers pass an optional tool context, so the parameter admits undefined —
// narrowing it here was the one behaviour change the extraction nearly made.
type ActorContext = { agentId?: string } | undefined;

export async function workCapsuleActor(userId: string, context: ActorContext) {
  const { ensureAgentPrincipalIdentity, syncUserPrincipal } = await import("@/lib/identity/principal-linking");
  const agentId = context?.agentId ?? null;
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
