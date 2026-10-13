#!/usr/bin/env node
// Refresh Grok's bearer_token_file from a client_credentials client.
//
//   node scripts/refresh-grok-mcp-credential.mjs refresh --mcp-url <url> --config <config.toml>
//   node scripts/refresh-grok-mcp-credential.mjs write-client --config <config.toml> < client.json
//
// write-client reads one JSON object from stdin and stores it beside the
// config. The secret stays on stdout of the container script only long enough
// to cross this pipe. This file never prints it.

import { readFileSync } from "node:fs";
import { parseArgs as utilParseArgs } from "node:util";

import { exchangeClientCredentials } from "./lib/mcp-credential.mjs";
import {
  grokBearerTokenFilePath,
  grokClientFilePath,
  refreshGrokCredential,
  writeGrokClientFile,
} from "./lib/grok-credential.mjs";
import { scriptArgv } from "./lib/script-argv.mjs";

function die(message, code) {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = utilParseArgs({
    args: scriptArgv(),
    strict: true,
    allowPositionals: true,
    options: {
      "mcp-url": { type: "string" },
      config: { type: "string" },
    },
  });
} catch (err) {
  die(err instanceof Error ? err.message : String(err), 2);
}

const { values, positionals } = parsed;
const command = positionals[0];
if (positionals.length !== 1 || (command !== "refresh" && command !== "write-client")) {
  die("refresh-grok-mcp-credential: expected refresh or write-client", 2);
}

function requireValue(name) {
  const value = values[name];
  if (typeof value !== "string" || value.length === 0) {
    die(`refresh-grok-mcp-credential: --${name} requires a value`, 2);
  }
  return value;
}

try {
  if (command === "write-client") {
    const config = requireValue("config");
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const stored = await writeGrokClientFile(config, payload);
    console.log(stored.revoked ? "stopped" : "stored");
  } else {
    const config = requireValue("config");
    const result = await refreshGrokCredential({
      tokenPath: grokBearerTokenFilePath(config),
      clientPath: grokClientFilePath(config),
      mcpUrl: requireValue("mcp-url"),
      exchange: exchangeClientCredentials,
    });
    console.log(result.action);
  }
} catch (err) {
  const code = err && err.code === "GROK_CLIENT_MISSING" ? 3 : 1;
  die(err instanceof Error ? err.message : String(err), code);
}
