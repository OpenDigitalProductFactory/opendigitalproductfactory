// Grok credential file writer (BI-5BCDB07C, design 12.4.7). Ships in the
// skill pack so a pack-only host can refresh it (BI-84C1F526).
//
// Setup stores a client_credentials client beside the Grok config. The
// refresher exchanges that grant and replaces bearer_token_file before
// expiry. The file holds only the access token: Grok re-reads it on each
// request. A personal access token is never written. Revocation deletes the
// token file and stops later exchanges.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { exchangeClientCredentials } from "./client-credentials-exchange.mjs";

export const installExchange = exchangeClientCredentials;
export const GROK_BEARER_FILE_NAME = "dpf-mcp-token";
export const GROK_CLIENT_FILE_NAME = "dpf-mcp-client.json";
export const GROK_CREDENTIAL_SCOPE = "dpf.read dpf.work dpf.build";
export const GROK_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const defaultFs = { chmod, mkdir, readFile, rename, unlink, writeFile };

export function grokBearerTokenFilePath(configPath) {
  return siblingPath(configPath, GROK_BEARER_FILE_NAME);
}

export function grokClientFilePath(configPath) {
  return siblingPath(configPath, GROK_CLIENT_FILE_NAME);
}

export function isPersonalAccessToken(token) {
  return typeof token === "string" && token.startsWith("dpfmcp_");
}

export function isCredentialRefusal(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /refused \((?:invalid_client|invalid_grant|unauthorized_client|http_401|http_403)\)/.test(message);
}

function siblingPath(configPath, name) {
  const text = String(configPath);
  let end = text.length;
  while (end > 0 && (text[end - 1] === "/" || text[end - 1] === "\\")) end -= 1;
  const normalized = text.slice(0, end);
  const cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const sep = cut >= 0 && normalized[cut] === "\\" ? "\\" : "/";
  const dir = cut >= 0 ? normalized.slice(0, cut) : ".";
  return `${dir}${sep}${name}`;
}

function expiresSidecar(tokenPath) {
  return `${tokenPath}.expires`;
}

async function readText(fs, path) {
  try {
    return await fs.readFile(path, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function removeIfPresent(fs, path) {
  try {
    await fs.unlink(path);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
}

async function writeAtomic(fs, path, content) {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  try {
    await fs.rename(tmp, path);
  } catch (err) {
    await removeIfPresent(fs, tmp);
    throw err;
  }
}

export async function writeGrokClientFile(configPath, payload, fs = defaultFs) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (parsed == null || typeof parsed !== "object") {
    throw new Error("Grok client payload must be a JSON object.");
  }
  if (parsed.revoked === true) {
    if (typeof parsed.clientId !== "string" || parsed.clientId.length === 0) {
      throw new Error("A revoked Grok client file needs a clientId.");
    }
    await writeAtomic(fs, grokClientFilePath(configPath), `${JSON.stringify({ clientId: parsed.clientId, revoked: true })}\n`);
    await removeIfPresent(fs, grokBearerTokenFilePath(configPath));
    await removeIfPresent(fs, expiresSidecar(grokBearerTokenFilePath(configPath)));
    return { revoked: true };
  }
  if (typeof parsed.clientId !== "string" || !parsed.clientId.startsWith("dpfoc_")) {
    throw new Error("Refusing to store a Grok client id that is not a credentials client.");
  }
  if (typeof parsed.clientSecret !== "string" || !parsed.clientSecret.startsWith("dpfocs_") || isPersonalAccessToken(parsed.clientSecret)) {
    throw new Error("Refusing to store a personal access token as the Grok client secret.");
  }
  await writeAtomic(
    fs,
    grokClientFilePath(configPath),
    `${JSON.stringify({ clientId: parsed.clientId, clientSecret: parsed.clientSecret })}\n`,
  );
  return { revoked: false };
}

export async function refreshGrokCredential({
  tokenPath,
  clientPath,
  mcpUrl,
  now = Date.now(),
  marginMs = GROK_REFRESH_MARGIN_MS,
  exchange,
  fs = defaultFs,
}) {
  const rawClient = await readText(fs, clientPath);
  if (rawClient == null) {
    const error = new Error("Grok client file is missing. Setup has not created the credentials client.");
    error.code = "GROK_CLIENT_MISSING";
    throw error;
  }
  let client;
  try {
    client = JSON.parse(rawClient);
  } catch {
    throw new Error("Grok client file is not valid JSON.");
  }
  if (client.revoked === true) {
    await removeIfPresent(fs, tokenPath);
    await removeIfPresent(fs, expiresSidecar(tokenPath));
    return { action: "stopped" };
  }
  if (typeof client.clientId !== "string" || typeof client.clientSecret !== "string") {
    throw new Error("Grok client file is missing clientId or clientSecret.");
  }

  const token = await readText(fs, tokenPath);
  const expiryRaw = await readText(fs, expiresSidecar(tokenPath));
  const expiresAt = expiryRaw == null ? Number.NaN : Number(expiryRaw.trim());
  const fresh = token != null
    && token.trim().length > 0
    && !isPersonalAccessToken(token.trim())
    && Number.isFinite(expiresAt)
    && expiresAt - now > marginMs;
  if (fresh) return { action: "kept" };

  let minted;
  try {
    minted = await exchange({
      mcpUrl,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: GROK_CREDENTIAL_SCOPE,
    });
  } catch (err) {
    if (isCredentialRefusal(err)) {
      await writeAtomic(fs, clientPath, `${JSON.stringify({ clientId: client.clientId, revoked: true })}\n`);
      await removeIfPresent(fs, tokenPath);
      await removeIfPresent(fs, expiresSidecar(tokenPath));
      return { action: "stopped" };
    }
    throw err;
  }

  const accessToken = minted && typeof minted.accessToken === "string" ? minted.accessToken : "";
  if (accessToken.length === 0) {
    throw new Error("client_credentials exchange returned no access token.");
  }
  if (isPersonalAccessToken(accessToken)) {
    throw new Error("Refusing to write a personal access token into the Grok bearer file.");
  }
  const expiry = Number(minted.expiresAt);
  if (!Number.isFinite(expiry)) {
    throw new Error("client_credentials exchange returned no expiry.");
  }
  await writeAtomic(fs, tokenPath, accessToken);
  await writeAtomic(fs, expiresSidecar(tokenPath), String(expiry));
  return { action: "refreshed", expiresAt: expiry };
}
