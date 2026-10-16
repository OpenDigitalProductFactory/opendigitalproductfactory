import { ensureOwnedCredentialsClient, HEADLESS_CREDENTIAL_SCOPES, type OwnedCredentialsInput } from "@/lib/auth/owned-credentials-client";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { grantsBeyondCaller, type CredentialCaller } from "./credential-issue-authority";

export type SourceCredentialStore = Pick<OwnedCredentialsInput, "rows" | "create" | "decrypt" | "prepareSecret"> & {
  eligible: () => Promise<{ id: string; agentId: string } | null>;
};
export type SourceCredentialDeps = {
  withOwnerLock: <T>(ownerUserId: string, agentId: string, run: (store: SourceCredentialStore) => Promise<T>) => Promise<T>;
};

export function sourceCredentialsClientName(agentId: string): string {
  return `DPF source connection (${agentId})`;
}

export async function issueSourceCredentialsClientForCaller(userId: string, caller: CredentialCaller, deps: SourceCredentialDeps): Promise<ToolResult> {
  if (!userId || !caller.apiTokenId || !caller.agentId || (caller.authSource !== "oauth" && caller.authSource !== "pat")) {
    return { success: false, error: "own_bound_credential_required", message: "Use your own assistant-bound MCP connection to provision source credentials." };
  }
  if ((caller.tokenScope !== "write" && caller.tokenScope !== "admin") || grantsBeyondCaller(caller).length > 0) {
    return { success: false, error: "wider_than_caller", message: "The source credential would exceed this connection's approved scope." };
  }
  const actorId = caller.agentId;
  try {
    return await deps.withOwnerLock(userId, actorId, async store => {
      const actor = await store.eligible();
      if (!actor || actor.agentId !== actorId) return { success: false, error: "assistant_not_eligible", message: "This account cannot provision the current assistant's source client." };
      const ensured = await ensureOwnedCredentialsClient({ ...store, ownerUserId: userId,
        profile: { name: sourceCredentialsClientName(actorId), label: "source", scopes: HEADLESS_CREDENTIAL_SCOPES, binding: "exact" },
        agent: async () => actor.id });
      return { success: true, entityId: ensured.clientId,
        message: `${ensured.created ? "Created" : "Returned"} your assistant-bound source client. Store credentialsClient only in the canonical untracked source credential file; keep it out of transcripts.`,
        data: { credentialsClient: { clientId: ensured.clientId, clientSecret: ensured.clientSecret },
          ownerUserId: userId, assistantId: actorId, agentBound: true, created: ensured.created, scopes: [...HEADLESS_CREDENTIAL_SCOPES] } };
    });
  } catch {
    return { success: false, error: "source_credential_unavailable", message: "The source client could not be reused safely. Inspect its owner, assistant, scopes and stored secret before retrying." };
  }
}
