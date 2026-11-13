// Grok compatibility wrapper around the shared owned OAuth client mechanism.
import {
  ensureOwnedCredentialsClient, selectActiveOwnedCredentialsClient, HEADLESS_CREDENTIAL_SCOPES,
  type OwnedClientCreate, type OwnedClientRow, type EnsuredOwnedClient, type OwnedCredentialsInput,
} from "./owned-credentials-client";

export const GROK_CREDENTIALS_CLIENT_NAME = "DPF Grok connection";
export const GROK_CREDENTIAL_SCOPES = HEADLESS_CREDENTIAL_SCOPES;
export type GrokClientRow = OwnedClientRow;
export type GrokClientCreate = OwnedClientCreate;
export type EnsuredGrokClient = EnsuredOwnedClient;

export function selectActiveGrokCredentialsClient(rows: readonly GrokClientRow[], ownerUserId: string): GrokClientRow | null {
  return selectActiveOwnedCredentialsClient(rows, ownerUserId, GROK_CREDENTIALS_CLIENT_NAME, GROK_CREDENTIAL_SCOPES);
}

/** Preserve Grok's established unbound upgrade and foreign-binding behavior. */
export async function ensureGrokCredentialsClient(input: Omit<OwnedCredentialsInput, "profile" | "agent"> & {
  grokAgent: () => Promise<string | null>;
  bindAgent: (clientId: string, agentRecordId: string) => Promise<void>;
}): Promise<EnsuredGrokClient> {
  return ensureOwnedCredentialsClient({ ...input, agent: input.grokAgent,
    profile: { name: GROK_CREDENTIALS_CLIENT_NAME, label: "Grok", scopes: GROK_CREDENTIAL_SCOPES, binding: "upgrade-unbound" } });
}
