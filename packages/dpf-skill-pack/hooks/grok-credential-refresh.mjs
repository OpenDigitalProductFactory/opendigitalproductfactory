#!/usr/bin/env node
// Keep Grok's DPF credential fresh at SessionStart (BI-84C1F526).
//
// Grok reads its DPF access token from bearer_token_file, which the pack's
// refresher (scripts/lib/grok-credential.mjs) rewrites from Grok's
// client_credentials client. Nothing else schedules that refresh, so Grok's
// SessionStart entry runs this: when the token is missing or inside the
// refresh window, it refreshes it once, with a bounded exchange.
//
// Fail-open: it always exits 0. It never prints the token or the secret. On a
// failed or impossible refresh it prints one plain line naming the repair.
// A host whose Grok config has no DPF bearer_token_file is left alone.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const GROK_REPAIR_LINE =
  "DPF: Grok's DPF credential could not be refreshed. Repair: call the issue_grok_credentials_client MCP tool, " +
  "then run the DPF toolchain updater with --grok-client-stdin and pass it the credentialsClient.";
export const SESSION_EXCHANGE_TIMEOUT_MS = 4_000;
const SESSION_DEADLINE_MS = 6_000;

const DPF_TABLE = /^\s*\[\s*mcp_servers\s*\.\s*(?:dpf|"dpf"|'dpf')\s*\]\s*(?:#.*)?$/;

/** The DPF url when [mcp_servers.dpf] names a bearer_token_file; else null. */
export function grokDpfEndpoint(configText) {
  let inTable = false;
  let url = null;
  let usesFile = false;
  for (const line of configText.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      if (inTable) break;
      inTable = DPF_TABLE.test(line);
      continue;
    }
    if (!inTable) continue;
    const match = /^\s*([A-Za-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (!match) continue;
    if (match[1] === "url") url = JSON.parse(`"${match[2]}"`);
    if (match[1] === "bearer_token_file") usesFile = true;
  }
  return usesFile && url ? url : null;
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function refreshGrokSessionCredential({
  home = homedir(),
  now = Date.now(),
  exchange,
  loadRefresher = () => import("../scripts/lib/grok-credential.mjs"),
} = {}) {
  const configPath = join(home, ".grok", "config.toml");
  const configText = await readText(configPath);
  const mcpUrl = configText == null ? null : grokDpfEndpoint(configText);
  if (!mcpUrl) return null;
  try {
    const refresher = await loadRefresher();
    const baseExchange = exchange ?? refresher.installExchange;
    const result = await refresher.refreshGrokCredential({
      tokenPath: refresher.grokBearerTokenFilePath(configPath),
      clientPath: refresher.grokClientFilePath(configPath),
      mcpUrl,
      now,
      exchange: (args) => baseExchange({ ...args, timeoutMs: SESSION_EXCHANGE_TIMEOUT_MS }),
    });
    return result?.action === "stopped" ? GROK_REPAIR_LINE : null;
  } catch {
    return GROK_REPAIR_LINE;
  }
}

async function main() {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(GROK_REPAIR_LINE), SESSION_DEADLINE_MS);
  });
  try {
    const line = await Promise.race([refreshGrokSessionCredential(), deadline]);
    if (line) process.stdout.write(`${line}\n`);
  } catch {
    // fail-open
  } finally {
    clearTimeout(timer);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
