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

import { exchangeClientCredentials } from "./lib/mcp-credential.mjs";
import {
  grokBearerTokenFilePath,
  grokClientFilePath,
  refreshGrokCredential,
  writeGrokClientFile,
} from "./lib/grok-credential.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`refresh-grok-mcp-credential: ${name} requires a value`);
    process.exit(2);
  }
  return value;
}

const command = process.argv[2];
if (command !== "refresh" && command !== "write-client") {
  console.error("refresh-grok-mcp-credential: expected refresh or write-client");
  process.exit(2);
}

try {
  if (command === "write-client") {
    const config = arg("--config");
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const stored = await writeGrokClientFile(config, payload);
    console.log(stored.revoked ? "stopped" : "stored");
  } else {
    const result = await refreshGrokCredential({
      tokenPath: grokBearerTokenFilePath(arg("--config")),
      clientPath: grokClientFilePath(arg("--config")),
      mcpUrl: arg("--mcp-url"),
      exchange: exchangeClientCredentials,
    });
    console.log(result.action);
  }
} catch (err) {
  const code = err && err.code === "GROK_CLIENT_MISSING" ? 3 : 1;
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(code);
}
