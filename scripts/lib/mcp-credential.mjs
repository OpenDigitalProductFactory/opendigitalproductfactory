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
//      never be committed). Issued from Admin > Platform Development > MCP.
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
// step and cannot import it, which is why this small exchange lives here.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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
  + `(override the path with ${MCP_CLIENT_CREDENTIALS_FILE_ENV}). Mint one in the portal: Admin > Platform Development > MCP.\n`
  + `  - a legacy dpfmcp_ personal access token: set ${MCP_BEARER_TOKEN_ENV} (being retired; a client_credentials client replaces it).`;

/** Where the authorization server's token endpoint is, given the MCP URL. */
export function tokenEndpointFor(mcpUrl) {
  const url = new URL(mcpUrl);
  return `${url.origin}/api/oauth/token`;
}

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

function postForm(endpoint, form, { timeoutMs }) {
  const url = new URL(endpoint);
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = requestFn(url, {
      method: "POST",
      agent: false,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json",
        Connection: "close",
      },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`client_credentials exchange timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * RFC 6749 §4.4 client_credentials exchange (client_secret_post) against the
 * install's own authorization server. Returns { accessToken, expiresAt }.
 */
export async function exchangeClientCredentials({
  mcpUrl,
  clientId,
  clientSecret,
  scope = "",
  timeoutMs = 10_000,
  post = postForm,
  now = () => Date.now(),
}) {
  const endpoint = tokenEndpointFor(mcpUrl);
  const form = {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    resource: new URL(mcpUrl).origin + "/api/mcp/v1",
  };
  if (scope) form.scope = scope;
  const response = await post(endpoint, form, { timeoutMs });
  let payload = null;
  try {
    payload = JSON.parse(response.body);
  } catch {
    // fall through to the status-based error below
  }
  if (response.status !== 200 || typeof payload?.access_token !== "string") {
    const code = payload?.error ?? `http_${response.status}`;
    const detail = payload?.error_description ? ` — ${String(payload.error_description).replace(/\.$/, "")}` : "";
    throw new Error(
      `client_credentials exchange at ${endpoint} refused (${code})${detail}. `
      + "The client may be revoked or its secret rotated; re-issue it in Admin > Platform Development > MCP.",
    );
  }
  const expiresIn = Number(payload.expires_in);
  const ttlSeconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300;
  return { accessToken: payload.access_token, expiresAt: now() + ttlSeconds * 1000 };
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
