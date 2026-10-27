// scripts/lib/mcp-credential.mjs — how a Node-native gate script obtains the
// bearer credential it puts on the MCP wire (BI-78B653D5).
//
// One authorization server, two grant types (design
// docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md
// §2.1): a caller with a browser uses authorization_code; a caller without one
// — this file's callers: the pregate, the lease claim, evidence recording —
// uses `client_credentials`. The `dpfmcp_` PAT is a migration concern with a
// deprecation horizon, so it stays a fallback here until Slice 6 retires it.
//
// Resolution order, first hit wins:
//   1. A client_credentials client — DPF_MCP_CLIENT_ID + DPF_MCP_CLIENT_SECRET,
//      or the JSON file named by DPF_MCP_CLIENT_CREDENTIALS_FILE (default
//      ~/.dpf/mcp-client-credentials.json, outside every checkout so it can
//      never be committed). Issued through issue_source_credentials_client for the calling assistant,
//      or manually from Admin > Platform Development > MCP.
//      Access tokens are short-lived and re-minted on demand, so a gate that
//      outlives one token never strands on a stale copy.
//   2. DPF_MCP_BEARER_TOKEN — the legacy PAT, until the retirement horizon.
//   3. Nothing: an actionable refusal naming BOTH paths and where to mint one,
//      instead of a bare "env var required" at the point of use.
//
// The token exchange is a plain node:http POST for the same reason
// mcp-client.mjs is: no undici handle may be left open when a gate calls
// process.exit(). The app's canonical client_credentials home is
// @dpf/integration-shared (TypeScript); a checked-in .mjs script has no build
// step and cannot import it, which is why the small exchange lives in the
// skill pack (scripts/lib/client-credentials-exchange.mjs).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// The exchange itself ships in the skill pack (BI-84C1F526), so a host with
// only the pack can still refresh Grok's credential. Source callers add the
// host adapter; the exchange implementation remains in the pack.
import { exchangeClientCredentials as exchangeBase, tokenEndpointFor } from "../../packages/dpf-skill-pack/scripts/lib/client-credentials-exchange.mjs";
import { resolveHostMcpTrust } from "./mcp-host-trust.mjs";

// An already-running source client needs request-level trust for OAuth too.
// The packaged exchanger keeps its host-independent default for pack callers.
export function exchangeClientCredentials(options) {
  const trust = new URL(options.mcpUrl).protocol === "https:"
    ? resolveHostMcpTrust({ mcpUrl: options.mcpUrl }) : null;
  return exchangeBase({ ...options, tlsOptions: trust?.tlsOptions });
}

export { tokenEndpointFor };

export const MCP_CLIENT_ID_ENV = "DPF_MCP_CLIENT_ID";
export const MCP_CLIENT_SECRET_ENV = "DPF_MCP_CLIENT_SECRET";
export const MCP_CLIENT_CREDENTIALS_FILE_ENV = "DPF_MCP_CLIENT_CREDENTIALS_FILE";
export const MCP_BEARER_TOKEN_ENV = "DPF_MCP_BEARER_TOKEN";
export const DEFAULT_CLIENT_CREDENTIALS_FILE = join(homedir(), ".dpf", "mcp-client-credentials.json");

// Re-mint this many seconds before the server's stated expiry so an in-flight
// call never carries a token that expires mid-request.
const EXPIRY_SKEW_SECONDS = 60;

export const MCP_CREDENTIAL_HELP =
  "No MCP credential is configured. A gate script authenticates one of two ways:\n"
  + `  - a client_credentials client (preferred): set ${MCP_CLIENT_ID_ENV} and ${MCP_CLIENT_SECRET_ENV}, `
  + `or write {"clientId","clientSecret"} to ${DEFAULT_CLIENT_CREDENTIALS_FILE} `
  + `(override the path with ${MCP_CLIENT_CREDENTIALS_FILE_ENV}). An authenticated assistant can issue its own client through issue_source_credentials_client. Use a separate per-assistant file and an explicit path override on shared hosts. Manual alternative: Admin > Platform Development > MCP.\n`
  + `  - a legacy dpfmcp_ personal access token: set ${MCP_BEARER_TOKEN_ENV} (being retired; a client_credentials client replaces it).`;

function readCredentialsFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
  const clientId = typeof parsed?.clientId === "string" ? parsed.clientId.trim() : "";
  const clientSecret = typeof parsed?.clientSecret === "string" ? parsed.clientSecret.trim() : "";
  if (!clientId || !clientSecret) {
    throw new Error(`${path} must carry both "clientId" and "clientSecret".`);
  }
  return { clientId, clientSecret, source: path };
}

/** The configured client_credentials client, or null when none is configured. */
export function readClientCredentials(env = process.env) {
  const clientId = env[MCP_CLIENT_ID_ENV]?.trim() ?? "";
  const clientSecret = env[MCP_CLIENT_SECRET_ENV]?.trim() ?? "";
  if (clientId && clientSecret) return { clientId, clientSecret, source: "env" };
  if (clientId || clientSecret) {
    throw new Error(`${MCP_CLIENT_ID_ENV} and ${MCP_CLIENT_SECRET_ENV} must be set together.`);
  }
  const file = env[MCP_CLIENT_CREDENTIALS_FILE_ENV]?.trim() || DEFAULT_CLIENT_CREDENTIALS_FILE;
  return readCredentialsFile(file);
}

/**
 * A bearer credential that mints and refreshes itself. `get()` returns a
 * token string valid for at least EXPIRY_SKEW_SECONDS; mcp-client.mjs accepts
 * this object anywhere it accepts a bearer string.
 */
export function createClientCredentialsBearer({ mcpUrl, clientId, clientSecret, exchange = exchangeClientCredentials, now = () => Date.now() }) {
  let current = null;
  let inFlight = null;
  return {
    kind: "client_credentials",
    async get() {
      if (current && current.expiresAt - EXPIRY_SKEW_SECONDS * 1000 > now()) return current.accessToken;
      if (!inFlight) {
        inFlight = exchange({ mcpUrl, clientId, clientSecret, now })
          .then((minted) => { current = minted; return minted.accessToken; })
          .finally(() => { inFlight = null; });
      }
      return inFlight;
    },
    /** Forget the cached token so the next get() re-mints (after a 401). */
    invalidate() { current = null; },
  };
}

/**
 * Resolve the credential a gate script should use, in the order documented
 * at the top of this file. Returns { bearer, kind, source } or throws with
 * MCP_CREDENTIAL_HELP when nothing is configured. `bearer` is either a
 * self-refreshing object (client_credentials) or the PAT string.
 */
export function resolveMcpCredential({ mcpUrl, env = process.env, exchange = exchangeClientCredentials } = {}) {
  if (!mcpUrl) throw new Error("resolveMcpCredential: mcpUrl is required");
  const client = readClientCredentials(env);
  if (client) {
    return {
      kind: "client_credentials",
      source: client.source,
      bearer: createClientCredentialsBearer({ mcpUrl, clientId: client.clientId, clientSecret: client.clientSecret, exchange }),
    };
  }
  const pat = env[MCP_BEARER_TOKEN_ENV]?.trim() ?? "";
  if (pat) return { kind: "pat", source: MCP_BEARER_TOKEN_ENV, bearer: pat };
  throw new Error(MCP_CREDENTIAL_HELP);
}

/** Turn whatever a caller passed as `bearerToken` into the string for the wire. */
export async function materializeBearer(bearer) {
  if (typeof bearer === "string") return bearer;
  if (bearer && typeof bearer.get === "function") return bearer.get();
  throw new Error("bearerToken must be a string or a credential with get()");
}
