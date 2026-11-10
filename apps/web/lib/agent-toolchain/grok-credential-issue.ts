// BI-84C1F526 (AC-GROK, DI-4B843FAF62F9) — Grok's own credential, issued to
// the agent that converges the host.
//
// Grok authenticates with a client_credentials OAuth client (BI-5BCDB07C). The
// container script creates it on a source checkout; this is the same step over
// MCP, so an agent on any host can hand the client to the toolchain updater.
// It reuses ensureGrokCredentialsClient: one client per owner, never a
// personal access token, and an existing client is returned, not duplicated.
//
// The client is owned by the calling user and carries dpf.read dpf.work
// dpf.build. It is issued only when the calling credential already holds every
// grant those scopes give, so it is never wider than the caller.

import {
  ensureGrokCredentialsClient,
  GROK_CREDENTIAL_SCOPES,
  type GrokClientCreate,
  type GrokClientRow,
} from "@/lib/auth/grok-credentials-client";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { grantsBeyondCaller, type CredentialCaller } from "./credential-issue-authority";
export { grantsBeyondCaller } from "./credential-issue-authority";

export type GrokCredentialIssueDeps = {
  rows: (ownerUserId: string) => Promise<readonly GrokClientRow[]>;
  create: (row: GrokClientCreate) => Promise<void>;
  decrypt: (enc: string) => string | null;
  prepareSecret: () => { plaintext: string; hash: string; enc: string };
  grokAgent: () => Promise<string | null>;
  bindAgent: (oAuthClientId: string, agentRecordId: string) => Promise<void>;
};

export type GrokCredentialCaller = CredentialCaller;

export async function issueGrokCredentialsClientForCaller(
  userId: string,
  caller: GrokCredentialCaller,
  deps: GrokCredentialIssueDeps,
): Promise<ToolResult> {
  if (!caller.apiTokenId || (caller.authSource !== "oauth" && caller.authSource !== "pat")) {
    return {
      success: false,
      error: "own_credential_required",
      message: "Call this from the agent's own MCP connection (OAuth or token). A portal session cannot issue a host credential.",
    };
  }
  const missing = grantsBeyondCaller(caller);
  if (caller.tokenScope !== "write" && caller.tokenScope !== "admin") missing.unshift("write scope");
  if (missing.length > 0) {
    return {
      success: false,
      error: "wider_than_caller",
      message: `The Grok credential would be wider than this connection. It lacks: ${missing.join(", ")}.`,
    };
  }

  const ensured = await ensureGrokCredentialsClient({
    ownerUserId: userId,
    rows: () => deps.rows(userId),
    create: deps.create,
    decrypt: deps.decrypt,
    prepareSecret: deps.prepareSecret,
    grokAgent: deps.grokAgent,
    bindAgent: deps.bindAgent,
  });
  return {
    success: true,
    entityId: ensured.clientId,
    message:
      `${ensured.created ? "Created" : "Returned"} the Grok credentials client ${ensured.clientId}. ` +
      "Pass data.credentialsClient as JSON on standard input to the DPF toolchain updater (--grok-client-stdin). " +
      "Never show the secret to the user or write it anywhere else." +
      (ensured.agentBound ? "" : " The client is not bound to AGT-EXT-GROK, so Grok can read but cannot write workrooms."),
    data: {
      credentialsClient: { clientId: ensured.clientId, clientSecret: ensured.clientSecret },
      created: ensured.created,
      agentBound: ensured.agentBound,
      scopes: [...GROK_CREDENTIAL_SCOPES],
    },
  };
}
