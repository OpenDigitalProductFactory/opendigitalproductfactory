// BI-84C1F526 — Grok's SessionStart keeps its DPF credential fresh with the
// pack's own refresher. Fixture Grok home; no network.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GROK_REPAIR_LINE, refreshGrokSessionCredential } from "./grok-credential-refresh.mjs";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const SECRET = "dpfocs_fixture-secret";

async function grokHome({ client = true, token, expiresAt, config = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), "grok-session-"));
  const dir = join(home, ".grok");
  await mkdir(dir, { recursive: true });
  if (config) {
    await writeFile(join(dir, "config.toml"), `[mcp_servers.dpf]\nurl = "https://localhost/api/mcp/v1?tier=full"\nbearer_token_file = "${join(dir, "dpf-mcp-token").replaceAll("\\", "\\\\")}"\n`);
  }
  if (client) await writeFile(join(dir, "dpf-mcp-client.json"), JSON.stringify({ clientId: "dpfoc_fixture", clientSecret: SECRET }));
  if (token !== undefined) await writeFile(join(dir, "dpf-mcp-token"), token);
  if (expiresAt !== undefined) await writeFile(join(dir, "dpf-mcp-token.expires"), String(expiresAt));
  return { home, dir };
}

function recordingExchange(result = { accessToken: "fresh-access", expiresAt: NOW + 3_600_000 }) {
  const calls = [];
  const exchange = async (args) => {
    calls.push(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, exchange };
}

test("a fresh token is left alone and nothing is exchanged", async (t) => {
  const { home, dir } = await grokHome({ token: "current-access", expiresAt: NOW + 3_600_000 });
  t.after(() => rm(home, { recursive: true, force: true }));
  const { calls, exchange } = recordingExchange();
  assert.equal(await refreshGrokSessionCredential({ home, now: NOW, exchange }), null);
  assert.equal(calls.length, 0);
  assert.equal(await readFile(join(dir, "dpf-mcp-token"), "utf8"), "current-access");
});

test("a missing token is refreshed silently, with a bounded exchange", async (t) => {
  const { home, dir } = await grokHome();
  t.after(() => rm(home, { recursive: true, force: true }));
  const { calls, exchange } = recordingExchange();
  assert.equal(await refreshGrokSessionCredential({ home, now: NOW, exchange }), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mcpUrl, "https://localhost/api/mcp/v1?tier=full");
  assert.ok(calls[0].timeoutMs <= 5_000);
  assert.equal(await readFile(join(dir, "dpf-mcp-token"), "utf8"), "fresh-access");
});

test("an expired token is refreshed", async (t) => {
  const { home, dir } = await grokHome({ token: "old-access", expiresAt: NOW - 1 });
  t.after(() => rm(home, { recursive: true, force: true }));
  const { calls, exchange } = recordingExchange();
  assert.equal(await refreshGrokSessionCredential({ home, now: NOW, exchange }), null);
  assert.equal(calls.length, 1);
  assert.equal(await readFile(join(dir, "dpf-mcp-token"), "utf8"), "fresh-access");
});

test("a failed refresh prints one plain repair line and never the secret", async (t) => {
  const { home } = await grokHome({ token: "old-access", expiresAt: NOW - 1 });
  t.after(() => rm(home, { recursive: true, force: true }));
  const { exchange } = recordingExchange(new Error(`exchange failed for ${SECRET}`));
  const line = await refreshGrokSessionCredential({ home, now: NOW, exchange });
  assert.equal(line, GROK_REPAIR_LINE);
  assert.match(line, /issue_grok_credentials_client/);
  assert.match(line, /--grok-client-stdin/);
  assert.doesNotMatch(line, /dpfocs_|old-access|\n/);
});

test("no stored client: the repair line, no exchange", async (t) => {
  const { home } = await grokHome({ client: false });
  t.after(() => rm(home, { recursive: true, force: true }));
  const { calls, exchange } = recordingExchange();
  assert.equal(await refreshGrokSessionCredential({ home, now: NOW, exchange }), GROK_REPAIR_LINE);
  assert.equal(calls.length, 0);
});

test("refresher absent: fail-open with the repair line", async (t) => {
  const { home } = await grokHome();
  t.after(() => rm(home, { recursive: true, force: true }));
  const loadRefresher = async () => { throw new Error("Cannot find module"); };
  assert.equal(await refreshGrokSessionCredential({ home, now: NOW, loadRefresher }), GROK_REPAIR_LINE);
});

test("a host whose Grok is not wired to DPF is left silent", async (t) => {
  const bare = await mkdtemp(join(tmpdir(), "grok-bare-"));
  t.after(() => rm(bare, { recursive: true, force: true }));
  assert.equal(await refreshGrokSessionCredential({ home: bare, now: NOW }), null);
  const { home } = await grokHome({ config: false, client: false });
  t.after(() => rm(home, { recursive: true, force: true }));
  assert.equal(await refreshGrokSessionCredential({ home, now: NOW }), null);
});

test("the SessionStart entry runs it as a bounded, fail-open child", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const script = fileURLToPath(new URL("./grok-credential-refresh.mjs", import.meta.url));
  const { home } = await grokHome({ client: false });
  t.after(() => rm(home, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [script], {
    encoding: "utf8", timeout: 15_000, env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), GROK_REPAIR_LINE);
  const entry = await readFile(fileURLToPath(new URL("./grok-session-start.mjs", import.meta.url)), "utf8");
  assert.match(entry, /grok-credential-refresh\.mjs/);
});
