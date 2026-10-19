// BI-78B653D5: gate scripts obtain their MCP credential from the same
// authorization server as every other client — client_credentials first, the
// legacy PAT until retirement, an actionable refusal when neither is set.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mcpCall } from "./mcp-client.mjs";
import {
  MCP_CREDENTIAL_HELP,
  createClientCredentialsBearer,
  exchangeClientCredentials,
  materializeBearer,
  readClientCredentials,
  resolveMcpCredential,
  tokenEndpointFor,
} from "./mcp-credential.mjs";


test("tokenEndpointFor derives the install's token endpoint from the MCP URL", () => {
  assert.equal(tokenEndpointFor("http://127.0.0.1:3000/api/mcp/v1?tier=full"), "http://127.0.0.1:3000/api/oauth/token");
  assert.equal(tokenEndpointFor("https://localhost:3443/api/mcp/v1"), "https://localhost:3443/api/oauth/token");
});

test("resolution order: client_credentials beats the PAT; PAT alone still works; nothing is an actionable refusal", () => {
  const cc = resolveMcpCredential({
    mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
    env: { DPF_MCP_CLIENT_ID: "cid", DPF_MCP_CLIENT_SECRET: "sec", DPF_MCP_BEARER_TOKEN: "dpfmcp_old", DPF_MCP_CLIENT_CREDENTIALS_FILE: "/nonexistent" },
  });
  assert.equal(cc.kind, "client_credentials");
  assert.equal(typeof cc.bearer.get, "function");

  const pat = resolveMcpCredential({
    mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
    env: { DPF_MCP_BEARER_TOKEN: "dpfmcp_old", DPF_MCP_CLIENT_CREDENTIALS_FILE: "/nonexistent" },
  });
  assert.equal(pat.kind, "pat");
  assert.equal(pat.bearer, "dpfmcp_old");

  assert.throws(
    () => resolveMcpCredential({ mcpUrl: "http://127.0.0.1:3000/api/mcp/v1", env: { DPF_MCP_CLIENT_CREDENTIALS_FILE: "/nonexistent" } }),
    (error) => error.message === MCP_CREDENTIAL_HELP
      && /Admin > Platform Development > MCP/.test(error.message)
      && /DPF_MCP_CLIENT_ID/.test(error.message)
      && /DPF_MCP_BEARER_TOKEN/.test(error.message),
  );
});

test("a credentials file outside the checkout is read, validated, and half-set env is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-mcp-cred-"));
  try {
    const file = join(dir, "creds.json");
    writeFileSync(file, JSON.stringify({ clientId: "file-cid", clientSecret: "file-sec" }));
    assert.deepEqual(readClientCredentials({ DPF_MCP_CLIENT_CREDENTIALS_FILE: file }), { clientId: "file-cid", clientSecret: "file-sec", source: file });
    writeFileSync(file, JSON.stringify({ clientId: "only-id" }));
    assert.throws(() => readClientCredentials({ DPF_MCP_CLIENT_CREDENTIALS_FILE: file }), /both "clientId" and "clientSecret"/);
    assert.throws(() => readClientCredentials({ DPF_MCP_CLIENT_ID: "x", DPF_MCP_CLIENT_CREDENTIALS_FILE: "/nonexistent" }), /must be set together/);
    assert.equal(readClientCredentials({ DPF_MCP_CLIENT_CREDENTIALS_FILE: join(dir, "missing.json") }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A stub authorization server + MCP endpoint on loopback. */
async function withStubServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}/api/mcp/v1`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function readBody(request) {
  return new Promise((resolve) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { data += chunk; });
    request.on("end", () => resolve(data));
  });
}

test("exchangeClientCredentials posts an RFC 6749 §4.4 form and surfaces the AS's refusal verbatim", async () => {
  const seen = [];
  await withStubServer(async (request, response) => {
    const body = await readBody(request);
    seen.push({ url: request.url, body: new URLSearchParams(body) });
    if (seen.length === 1) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ access_token: "at-1", token_type: "Bearer", expires_in: 3600 }));
      return;
    }
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_client", error_description: "secret rotated" }));
  }, async (mcpUrl) => {
    const minted = await exchangeClientCredentials({ mcpUrl, clientId: "cid", clientSecret: "sec", now: () => 1000 });
    assert.equal(minted.accessToken, "at-1");
    assert.equal(minted.expiresAt, 1000 + 3600 * 1000);
    assert.equal(seen[0].url, "/api/oauth/token");
    assert.equal(seen[0].body.get("grant_type"), "client_credentials");
    assert.equal(seen[0].body.get("client_id"), "cid");
    assert.equal(seen[0].body.get("client_secret"), "sec");
    assert.match(seen[0].body.get("resource"), /\/api\/mcp\/v1$/);

    await assert.rejects(
      exchangeClientCredentials({ mcpUrl, clientId: "cid", clientSecret: "sec" }),
      /refused \(invalid_client\) — secret rotated.*Admin > Platform Development > MCP/,
    );
  });
});

test("a client_credentials bearer caches its token, re-mints before expiry, and dedupes concurrent mints", async () => {
  let clock = 0;
  let mints = 0;
  const exchange = async () => { mints += 1; return { accessToken: `at-${mints}`, expiresAt: clock + 120_000 }; };
  const bearer = createClientCredentialsBearer({ mcpUrl: "http://127.0.0.1:3000/api/mcp/v1", clientId: "c", clientSecret: "s", exchange, now: () => clock });
  const [a, b] = await Promise.all([bearer.get(), bearer.get()]);
  assert.equal(a, "at-1"); assert.equal(b, "at-1"); assert.equal(mints, 1);
  clock = 30_000;
  assert.equal(await bearer.get(), "at-1", "still valid with >60s left");
  clock = 70_000;
  assert.equal(await bearer.get(), "at-2", "re-minted inside the 60s skew window");
  bearer.invalidate();
  assert.equal(await bearer.get(), "at-3", "invalidate() forces a fresh mint");
  assert.equal(await materializeBearer("dpfmcp_x"), "dpfmcp_x");
  await assert.rejects(materializeBearer({}), /string or a credential/);
});

test("mcpCall puts the minted client_credentials token on the wire", async () => {
  const seenAuth = [];
  await withStubServer(async (request, response) => {
    const body = await readBody(request);
    if (request.url === "/api/oauth/token") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ access_token: "minted-token", expires_in: 3600 }));
      return;
    }
    seenAuth.push(request.headers.authorization);
    assert.equal(JSON.parse(body).params.name, "get_quiescence_status");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ success: true }) }] } }));
  }, async (mcpUrl) => {
    const { bearer } = resolveMcpCredential({ mcpUrl, env: { DPF_MCP_CLIENT_ID: "cid", DPF_MCP_CLIENT_SECRET: "sec", DPF_MCP_CLIENT_CREDENTIALS_FILE: "/nonexistent" } });
    const result = await mcpCall("get_quiescence_status", {}, { mcpUrl, bearerToken: bearer });
    assert.deepEqual(result, { success: true });
    assert.deepEqual(seenAuth, ["Bearer minted-token"]);
  });
});
