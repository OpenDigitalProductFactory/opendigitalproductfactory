import { describe, expect, it } from "vitest";

import {
  GROK_CREDENTIAL_SCOPES,
  GROK_CREDENTIALS_CLIENT_NAME,
  type GrokClientCreate,
  type GrokClientRow,
  ensureGrokCredentialsClient,
} from "./grok-credentials-client";

const SECRET = { plaintext: "dpfocs_same", hash: "hash", enc: "enc-same" };

function row(overrides: Partial<GrokClientRow> = {}): GrokClientRow {
  return {
    oAuthClientId: "dpfoc_existing",
    clientName: GROK_CREDENTIALS_CLIENT_NAME,
    registrationKind: "credentials",
    ownerUserId: "user-1",
    revokedAt: null,
    allowedScopes: [...GROK_CREDENTIAL_SCOPES],
    clientSecretEnc: "enc-same",
    agentId: "agent-grok",
    ...overrides,
  };
}

function harness(initial: GrokClientRow[] = [], grokAgentRecordId: string | null = "agent-grok") {
  const rows = [...initial];
  const created: GrokClientCreate[] = [];
  const bound: Array<{ oAuthClientId: string; agentRecordId: string }> = [];
  return {
    rows,
    created,
    bound,
    deps: {
      ownerUserId: "user-1",
      rows: async () => rows,
      create: async (input: GrokClientCreate) => {
        created.push(input);
        rows.push({
          oAuthClientId: input.oAuthClientId,
          clientName: input.clientName,
          registrationKind: input.registrationKind,
          ownerUserId: input.ownerUserId,
          revokedAt: null,
          allowedScopes: [...input.allowedScopes],
          clientSecretEnc: input.clientSecretEnc,
          agentId: input.agentId,
        });
      },
      grokAgent: async () => grokAgentRecordId,
      bindAgent: async (oAuthClientId: string, agentRecordId: string) => {
        bound.push({ oAuthClientId, agentRecordId });
        const target = rows.find((r) => r.oAuthClientId === oAuthClientId);
        if (target) target.agentId = agentRecordId;
      },
      decrypt: (enc: string) => (enc === "enc-same" ? "dpfocs_same" : null),
      prepareSecret: () => SECRET,
      newClientId: () => "dpfoc_new",
    },
  };
}

describe("ensureGrokCredentialsClient", () => {
  it("returns the same active client on a second setup", async () => {
    const { created, deps } = harness();
    const first = await ensureGrokCredentialsClient(deps);
    const second = await ensureGrokCredentialsClient(deps);

    expect(first).toEqual({ clientId: "dpfoc_new", clientSecret: "dpfocs_same", created: true, agentBound: true });
    expect(second).toEqual({ clientId: "dpfoc_new", clientSecret: "dpfocs_same", created: false, agentBound: true });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      clientName: GROK_CREDENTIALS_CLIENT_NAME,
      registrationKind: "credentials",
      ownerUserId: "user-1",
      allowedScopes: [...GROK_CREDENTIAL_SCOPES],
      redirectUris: [],
    });
  });

  it("does not restore a revoked client", async () => {
    const { rows, created, deps } = harness([
      row({ revokedAt: new Date("2026-10-01T00:00:00.000Z") }),
    ]);
    const result = await ensureGrokCredentialsClient(deps);

    expect(result.clientId).toBe("dpfoc_new");
    expect(result.created).toBe(true);
    expect(created).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull();
  });

  it("does not reuse a client with a hole, an extra scope, another owner, or another name", async () => {
    for (const candidate of [
      row({ allowedScopes: ["dpf.read", "dpf.work"] }),
      row({ allowedScopes: ["dpf.read", "dpf.work", "dpf.build", "dpf.admin"] }),
      row({ ownerUserId: "someone-else" }),
      row({ clientName: "custom" }),
      row({ registrationKind: "dcr" }),
    ]) {
      const { created, deps } = harness([candidate]);
      const result = await ensureGrokCredentialsClient(deps);
      expect(result.created).toBe(true);
      expect(created).toHaveLength(1);
    }
  });

  it("refuses to mint a personal access token", async () => {
    const { created, deps } = harness();
    deps.prepareSecret = () => ({ plaintext: "dpfmcp_nope", hash: "h", enc: "e" });
    await expect(ensureGrokCredentialsClient(deps)).rejects.toThrow(/personal access token/);
    expect(created).toHaveLength(0);
  });

  it("does not mint a second client when the stored secret cannot be read", async () => {
    const { created, deps } = harness([row({ clientSecretEnc: "unreadable" })]);
    await expect(ensureGrokCredentialsClient(deps)).rejects.toThrow(/cannot be read/);
    expect(created).toHaveLength(0);
  });

  // BI-8D152751: a client_credentials token carries the client's agent
  // (oauth/token route.ts). Unbound, every workroom write from Grok is refused.
  it("creates the client bound to the Grok agent", async () => {
    const { created, deps } = harness();
    const result = await ensureGrokCredentialsClient(deps);
    expect(created[0].agentId).toBe("agent-grok");
    expect(result.agentBound).toBe(true);
  });

  it("binds an existing unbound client on the next setup, without minting a new one", async () => {
    const { created, bound, deps } = harness([row({ agentId: null })]);
    const result = await ensureGrokCredentialsClient(deps);
    expect(created).toHaveLength(0);
    expect(bound).toEqual([{ oAuthClientId: "dpfoc_existing", agentRecordId: "agent-grok" }]);
    expect(result).toMatchObject({ clientId: "dpfoc_existing", created: false, agentBound: true });
  });

  it("leaves the client unbound, and says so, when the Grok agent is not eligible", async () => {
    const { created, bound, deps } = harness([], null);
    const result = await ensureGrokCredentialsClient(deps);
    expect(created[0].agentId).toBeNull();
    expect(bound).toHaveLength(0);
    expect(result.agentBound).toBe(false);
  });

  it("never rebinds a client that is already bound to another agent", async () => {
    const { bound, deps } = harness([row({ agentId: "agent-someone-else" })]);
    const result = await ensureGrokCredentialsClient(deps);
    expect(bound).toHaveLength(0);
    expect(result.agentBound).toBe(false);
  });
});
