import { grantsForPublicScopes } from "@/lib/auth/oauth-scope-map";
import { HEADLESS_CREDENTIAL_SCOPES } from "@/lib/auth/owned-credentials-client";
import { expandGrants } from "@/lib/tak/agent-grants";

export type CredentialCaller = {
  apiTokenId?: string; authSource?: string; tokenScope?: string;
  tokenGrantScopes?: string[]; agentId?: string;
};
/** The same fixed headless scope ceiling for every owned-client issuer. */
export function grantsBeyondCaller(caller: CredentialCaller): string[] {
  const held = new Set(expandGrants(caller.tokenGrantScopes ?? []));
  return grantsForPublicScopes([...HEADLESS_CREDENTIAL_SCOPES]).filter(grant => !held.has(grant));
}
