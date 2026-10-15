// RFC 6749 client_credentials exchange against the install's own
// authorization server, for Node scripts with no build step (BI-78B653D5).
//
// It lives in the skill pack so the Grok credential refresher works on a host
// that has the pack but no source checkout (BI-84C1F526).
// scripts/lib/mcp-credential.mjs re-exports it for the gate scripts.
//
// A plain node:http POST, so no undici handle is left open when a caller
// exits. The app's canonical home is @dpf/integration-shared (TypeScript),
// which a checked-in .mjs script cannot import.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/** Where the authorization server's token endpoint is, given the MCP URL. */
export function tokenEndpointFor(mcpUrl) {
  const url = new URL(mcpUrl);
  return `${url.origin}/api/oauth/token`;
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
