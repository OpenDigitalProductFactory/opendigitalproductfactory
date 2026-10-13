import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { exchangeClientCredentials } from "./mcp-credential.mjs";
import {
  GROK_CREDENTIAL_SCOPE,
  grokBearerTokenFilePath,
  grokClientFilePath,
  installExchange,
  isPersonalAccessToken,
  refreshGrokCredential,
  writeGrokClientFile,
} from "./grok-credential.mjs";

test("the Grok refresher uses the install client_credentials exchange", () => {
  assert.equal(installExchange, exchangeClientCredentials);
  assert.equal(isPersonalAccessToken("dpfmcp_secret"), true);
  assert.equal(isPersonalAccessToken("dpfoc_access"), false);
});

test("bearer file sits beside the Grok config on either separator", () => {
  assert.equal(
    grokBearerTokenFilePath("C:\\Users\\Test\\.grok\\config.toml"),
    "C:\\Users\\Test\\.grok\\dpf-mcp-token",
  );
  assert.equal(
    grokBearerTokenFilePath("/tmp/home/.grok/config.toml"),
    "/tmp/home/.grok/dpf-mcp-token",
  );
  assert.equal(
    grokClientFilePath("/tmp/home/.grok/config.toml"),
    "/tmp/home/.grok/dpf-mcp-client.json",
  );
});

test("writeGrokClientFile refuses a personal access token and a non-credentials client", async () => {
  const home = await mkdtemp(join(tmpdir(), "grok-cred-"));
  const config = join(home, "config.toml");
  await assert.rejects(
    () => writeGrokClientFile(config, { clientId: "dpfoc_a", clientSecret: "dpfmcp_no" }),
    /personal access token/,
  );
  await assert.rejects(
    () => writeGrokClientFile(config, { clientId: "dpfmcp_a", clientSecret: "dpfocs_ok" }),
    /credentials client/,
  );
  await rm(home, { recursive: true, force: true });
});

test("refresh exchanges client_credentials and writes the bearer file before expiry", async () => {
  const home = await mkdtemp(join(tmpdir(), "grok-cred-"));
  const config = join(home, "config.toml");
  await writeGrokClientFile(config, { clientId: "dpfoc_one", clientSecret: "dpfocs_secret" });
  const calls = [];
  const now = 1_700_000_000_000;
  const result = await refreshGrokCredential({
    tokenPath: grokBearerTokenFilePath(config),
    clientPath: grokClientFilePath(config),
    mcpUrl: "https://localhost/api/mcp/v1",
    now,
    exchange: async (input) => {
      calls.push(input);
      return { accessToken: "short-lived-access", expiresAt: now + 3_600_000 };
    },
  });
  assert.equal(result.action, "refreshed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].clientId, "dpfoc_one");
  assert.equal(calls[0].clientSecret, "dpfocs_secret");
  assert.equal(calls[0].scope, GROK_CREDENTIAL_SCOPE);
  assert.equal(calls[0].mcpUrl, "https://localhost/api/mcp/v1");
  const tokenPath = grokBearerTokenFilePath(config);
  assert.equal(await readFile(tokenPath, "utf8"), "short-lived-access");
  const mode = (await stat(tokenPath)).mode & 0o777;
  assert.equal(mode, 0o600);
  const kept = await refreshGrokCredential({
    tokenPath,
    clientPath: grokClientFilePath(config),
    mcpUrl: "https://localhost/api/mcp/v1",
    now: now + 60_000,
    exchange: async () => {
      throw new Error("exchange must not run while the token is fresh");
    },
  });
  assert.equal(kept.action, "kept");
  await rm(home, { recursive: true, force: true });
});

test("a token inside the refresh margin is rewritten, and a personal access token is never kept", async () => {
  const home = await mkdtemp(join(tmpdir(), "grok-cred-"));
  const config = join(home, "config.toml");
  await writeGrokClientFile(config, { clientId: "dpfoc_one", clientSecret: "dpfocs_secret" });
  const tokenPath = grokBearerTokenFilePath(config);
  const now = 1_700_000_000_000;
  await writeFile(tokenPath, "dpfmcp_old");
  await writeFile(`${tokenPath}.expires`, String(now + 3_600_000));
  let calls = 0;
  const result = await refreshGrokCredential({
    tokenPath,
    clientPath: grokClientFilePath(config),
    mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
    now,
    exchange: async () => {
      calls += 1;
      return { accessToken: "replaced-access", expiresAt: now + 3_600_000 };
    },
  });
  assert.equal(result.action, "refreshed");
  assert.equal(calls, 1);
  assert.equal(await readFile(tokenPath, "utf8"), "replaced-access");
  await writeFile(`${tokenPath}.expires`, String(now + 60_000));
  const soon = await refreshGrokCredential({
    tokenPath,
    clientPath: grokClientFilePath(config),
    mcpUrl: "http://127.0.0.1:3000/api/mcp/v1",
    now,
    exchange: async () => {
      calls += 1;
      return { accessToken: "refreshed-early", expiresAt: now + 3_600_000 };
    },
  });
  assert.equal(soon.action, "refreshed");
  assert.equal(calls, 2);
  assert.equal(await readFile(tokenPath, "utf8"), "refreshed-early");
  await rm(home, { recursive: true, force: true });
});

test("revocation stops the refresher and removes the bearer file", async () => {
  const home = await mkdtemp(join(tmpdir(), "grok-cred-"));
  const config = join(home, "config.toml");
  await writeGrokClientFile(config, { clientId: "dpfoc_one", clientSecret: "dpfocs_secret" });
  const tokenPath = grokBearerTokenFilePath(config);
  const now = 1_700_000_000_000;
  await refreshGrokCredential({
    tokenPath,
    clientPath: grokClientFilePath(config),
    mcpUrl: "https://localhost/api/mcp/v1",
    now,
    exchange: async () => {
      throw new Error("client_credentials exchange at https://localhost/api/oauth/token refused (invalid_client)");
    },
  }).then((result) => {
    assert.equal(result.action, "stopped");
  });
  await assert.rejects(() => readFile(tokenPath, "utf8"));
  const stored = JSON.parse(await readFile(grokClientFilePath(config), "utf8"));
  assert.equal(stored.revoked, true);
  assert.equal(stored.clientSecret, undefined);
  let calls = 0;
  const again = await refreshGrokCredential({
    tokenPath,
    clientPath: grokClientFilePath(config),
    mcpUrl: "https://localhost/api/mcp/v1",
    now,
    exchange: async () => {
      calls += 1;
      return { accessToken: "should-not-write", expiresAt: now + 1000 };
    },
  });
  assert.equal(again.action, "stopped");
  assert.equal(calls, 0);
  await rm(home, { recursive: true, force: true });
});

test("a network failure leaves the current bearer file in place", async () => {
  const home = await mkdtemp(join(tmpdir(), "grok-cred-"));
  const config = join(home, "config.toml");
  await writeGrokClientFile(config, { clientId: "dpfoc_one", clientSecret: "dpfocs_secret" });
  const tokenPath = grokBearerTokenFilePath(config);
  await writeFile(tokenPath, "still-good");
  await assert.rejects(
    () => refreshGrokCredential({
      tokenPath,
      clientPath: grokClientFilePath(config),
      mcpUrl: "https://localhost/api/mcp/v1",
      now: 1_700_000_000_000,
      exchange: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    }),
    /ECONNREFUSED/,
  );
  assert.equal(await readFile(tokenPath, "utf8"), "still-good");
  const stored = JSON.parse(await readFile(grokClientFilePath(config), "utf8"));
  assert.equal(stored.revoked, undefined);
  await rm(home, { recursive: true, force: true });
});

test("an exchanged personal access token is not written", async () => {
  const home = await mkdtemp(join(tmpdir(), "grok-cred-"));
  const config = join(home, "config.toml");
  await writeGrokClientFile(config, { clientId: "dpfoc_one", clientSecret: "dpfocs_secret" });
  const tokenPath = grokBearerTokenFilePath(config);
  await assert.rejects(
    () => refreshGrokCredential({
      tokenPath,
      clientPath: grokClientFilePath(config),
      mcpUrl: "https://localhost/api/mcp/v1",
      now: 1_700_000_000_000,
      exchange: async () => ({ accessToken: "dpfmcp_minted", expiresAt: 1_700_003_600_000 }),
    }),
    /personal access token/,
  );
  await assert.rejects(() => readFile(tokenPath, "utf8"));
  await rm(home, { recursive: true, force: true });
});
