// Idempotent client_credentials client for the installing operator's Grok
// connection (BI-5BCDB07C, design 12.4.7). No UI step and no personal access
// token. A revoked row is left revoked; a later setup may create a new client.

import { randomUUID } from "node:crypto";

export const GROK_CREDENTIALS_CLIENT_NAME = "DPF Grok connection";
export const GROK_CREDENTIAL_SCOPES = ["dpf.read", "dpf.work", "dpf.build"] as const;

export type GrokClientRow = {
  oAuthClientId: string;
  clientName: string;
  registrationKind: string;
  ownerUserId: string | null;
  revokedAt: Date | null;
  allowedScopes: string[];
  clientSecretEnc: string | null;
  /** OAuthClient.agentId: the Agent record id the client acts as, or null. */
  agentId: string | null;
};

export type GrokClientCreate = {
  oAuthClientId: string;
  clientName: string;
  registrationKind: "credentials";
  clientSecretHash: string;
  clientSecretEnc: string;
  ownerUserId: string;
  allowedScopes: readonly string[];
  redirectUris: readonly [];
  agentId: string | null;
};

export type EnsuredGrokClient = {
  clientId: string;
  clientSecret: string;
  created: boolean;
  /** True when the client acts as the Grok agent, so its tokens can write workrooms. */
  agentBound: boolean;
};

function sameScopeSet(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.every((scope, index) => scope === right[index]);
}

export function selectActiveGrokCredentialsClient(
  rows: readonly GrokClientRow[],
  ownerUserId: string,
): GrokClientRow | null {
  return rows.find((row) =>
    row.ownerUserId === ownerUserId
    && row.clientName === GROK_CREDENTIALS_CLIENT_NAME
    && row.registrationKind === "credentials"
    && row.revokedAt == null
    && sameScopeSet(row.allowedScopes, GROK_CREDENTIAL_SCOPES)
  ) ?? null;
}

export async function ensureGrokCredentialsClient(input: {
  ownerUserId: string;
  rows: () => Promise<readonly GrokClientRow[]>;
  create: (row: GrokClientCreate) => Promise<void>;
  decrypt: (enc: string) => string | null;
  prepareSecret: () => { plaintext: string; hash: string; enc: string };
  newClientId?: () => string;
  /**
   * The Agent record id of AGT-EXT-GROK when it may act for this client
   * (active, not archived, holds work_room_write), else null (BI-8D152751).
   * The token endpoint carries the client's agent into every token; without
   * one, workCapsuleActor refuses every workroom write from Grok.
   */
  grokAgent: () => Promise<string | null>;
  bindAgent: (oAuthClientId: string, agentRecordId: string) => Promise<void>;
}): Promise<EnsuredGrokClient> {
  const grokAgentId = await input.grokAgent();
  const existing = selectActiveGrokCredentialsClient(await input.rows(), input.ownerUserId);
  if (existing) {
    if (!existing.clientSecretEnc) {
      throw new Error("The stored Grok client secret cannot be read. Refusing to mint a second client.");
    }
    const secret = input.decrypt(existing.clientSecretEnc);
    if (!secret || !secret.startsWith("dpfocs_")) {
      throw new Error("The stored Grok client secret cannot be read. Refusing to mint a second client.");
    }
    // Bind an unbound client in place. A client already bound to some other
    // agent is left alone: rebinding an identity is not setup's call.
    let agentBound = grokAgentId !== null && existing.agentId === grokAgentId;
    if (grokAgentId !== null && existing.agentId === null) {
      await input.bindAgent(existing.oAuthClientId, grokAgentId);
      agentBound = true;
    }
    return { clientId: existing.oAuthClientId, clientSecret: secret, created: false, agentBound };
  }

  const secret = input.prepareSecret();
  if (!secret.plaintext.startsWith("dpfocs_") || secret.plaintext.startsWith("dpfmcp_")) {
    throw new Error("Refusing to mint a personal access token for the Grok connection.");
  }
  const clientId = (input.newClientId ?? (() => `dpfoc_${randomUUID().replace(/-/g, "")}`))();
  if (!clientId.startsWith("dpfoc_")) {
    throw new Error("Refusing to store a Grok client id that is not a credentials client.");
  }
  await input.create({
    oAuthClientId: clientId,
    clientName: GROK_CREDENTIALS_CLIENT_NAME,
    registrationKind: "credentials",
    clientSecretHash: secret.hash,
    clientSecretEnc: secret.enc,
    ownerUserId: input.ownerUserId,
    allowedScopes: GROK_CREDENTIAL_SCOPES,
    redirectUris: [],
    agentId: grokAgentId,
  });
  return { clientId, clientSecret: secret.plaintext, created: true, agentBound: grokAgentId !== null };
}
