import { randomUUID } from "node:crypto";

export const HEADLESS_CREDENTIAL_SCOPES = ["dpf.read", "dpf.work", "dpf.build"] as const;
export type OwnedClientRow = {
  oAuthClientId: string; clientName: string; registrationKind: string;
  ownerUserId: string | null; revokedAt: Date | null; allowedScopes: string[];
  clientSecretEnc: string | null; agentId: string | null;
};
export type OwnedClientCreate = {
  oAuthClientId: string; clientName: string; registrationKind: "credentials";
  clientSecretHash: string; clientSecretEnc: string; ownerUserId: string;
  allowedScopes: readonly string[]; redirectUris: readonly []; agentId: string | null;
};
export type EnsuredOwnedClient = { clientId: string; clientSecret: string; created: boolean; agentBound: boolean };
export type OwnedClientProfile = {
  name: string; label: string; scopes: readonly string[];
  binding: "exact" | "upgrade-unbound";
};
export type OwnedCredentialsInput = {
  ownerUserId: string; profile: OwnedClientProfile;
  rows: () => Promise<readonly OwnedClientRow[]>;
  create: (row: OwnedClientCreate) => Promise<void>;
  decrypt: (enc: string) => string | null;
  prepareSecret: () => { plaintext: string; hash: string; enc: string };
  newClientId?: () => string;
  agent: () => Promise<string | null>;
  bindAgent?: (clientId: string, agentRecordId: string) => Promise<void>;
};

function sameScopes(actual: readonly string[], expected: readonly string[]) {
  if (actual.length !== expected.length) return false;
  const left = [...actual].sort(), right = [...expected].sort();
  return left.every((value, index) => value === right[index]);
}
export function selectActiveOwnedCredentialsClient(rows: readonly OwnedClientRow[], owner: string, name: string, scopes: readonly string[]) {
  return rows.find(row => row.ownerUserId === owner && row.clientName === name
    && row.registrationKind === "credentials" && row.revokedAt == null && sameScopes(row.allowedScopes, scopes)) ?? null;
}

/** Caller serializes its subject; storage and crypto have one implementation. */
export async function ensureOwnedCredentialsClient(input: OwnedCredentialsInput): Promise<EnsuredOwnedClient> {
  const { profile } = input;
  const agentId = await input.agent();
  if (profile.binding === "exact" && (!input.ownerUserId || !agentId)) throw new Error("No eligible source assistant.");
  const rows = await input.rows();
  if (profile.binding === "exact") {
    const current = rows.filter(row => row.ownerUserId === input.ownerUserId && row.clientName === profile.name && row.revokedAt == null);
    if (current.length > 1) throw new Error("The existing source client is ambiguous.");
    if (current.some(row => !row.oAuthClientId.startsWith("dpfoc_") || row.registrationKind !== "credentials" || row.agentId !== agentId || !sameScopes(row.allowedScopes, profile.scopes))) {
      throw new Error("The existing source client has a conflicting scope or assistant binding.");
    }
  }
  const existing = selectActiveOwnedCredentialsClient(rows, input.ownerUserId, profile.name, profile.scopes);
  if (existing) {
    if (!existing.clientSecretEnc) throw new Error(`The stored ${profile.label} client secret cannot be read. Refusing to mint a second client.`);
    const secret = input.decrypt(existing.clientSecretEnc);
    if (!secret?.startsWith("dpfocs_")) throw new Error(`The stored ${profile.label} client secret cannot be read. Refusing to mint a second client.`);
    let agentBound = agentId !== null && existing.agentId === agentId;
    if (profile.binding === "upgrade-unbound" && agentId !== null && existing.agentId === null) {
      if (!input.bindAgent) throw new Error("The client binding cannot be updated safely.");
      await input.bindAgent(existing.oAuthClientId, agentId);
      agentBound = true;
    }
    return { clientId: existing.oAuthClientId, clientSecret: secret, created: false, agentBound };
  }
  const secret = input.prepareSecret();
  if (!secret.plaintext.startsWith("dpfocs_")) throw new Error(`Refusing to mint a personal access token for the ${profile.label} connection.`);
  const clientId = (input.newClientId ?? (() => `dpfoc_${randomUUID().replace(/-/g, "")}`))();
  if (!clientId.startsWith("dpfoc_")) throw new Error("Refusing to store an invalid credentials client id.");
  await input.create({ oAuthClientId: clientId, clientName: profile.name, registrationKind: "credentials",
    clientSecretHash: secret.hash, clientSecretEnc: secret.enc, ownerUserId: input.ownerUserId,
    allowedScopes: profile.scopes, redirectUris: [], agentId });
  return { clientId, clientSecret: secret.plaintext, created: true, agentBound: agentId !== null };
}
