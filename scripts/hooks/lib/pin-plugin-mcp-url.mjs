#!/usr/bin/env node
// scripts/hooks/lib/pin-plugin-mcp-url.mjs
//
// SessionStart step after the plugin reconcile (BI-5201141C follow-up). The
// checked-in plugin descriptor names the endpoint as
// `${DPF_MCP_URL:-https://localhost/api/mcp/v1?tier=full}` so one file serves
// every install. Claude Code expands that, but the Claude desktop app checks a
// plugin connector's URL before it starts sign-in and cannot parse a variable:
// its log reads `verifyPluginMcpBinding ... URL mismatch; expected=<unparseable>`
// and the user sees "This session's copy of the connector points at a
// different server URL". So the per-machine installed copy (the plugin cache
// the reconcile step materializes) gets this machine's literal endpoint.
//
// The target is DPF_MCP_URL when it is a parseable https URL, else the
// template's own default. A fixed `localhost` in the repo would not do: an
// install with a configured PUBLIC_URL names that origin as its OAuth resource,
// and a client on another host name would be refused its token.
//
// Only the URL-only OAuth form is touched: a `dpf` server with headers (a
// bearer descriptor) is left alone. The write is atomic and a rerun with the
// same endpoint does nothing. Shared by reconcile-claude-plugin.sh and .ps1.
//
// Usage: node pin-plugin-mcp-url.mjs <installed_plugins.json> <projectRoot>
// Exit codes: 0 pinned (one line printed), 10 nothing to do, 11 left alone.
// Never throws.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isEntryModule } from "../../lib/entry-module.mjs";

export const EXIT_PINNED = 0;
export const EXIT_NOTHING = 10;
export const EXIT_LEFT_ALONE = 11;

const PLUGIN_KEY = "dpf-platform@dpf-platform-local";
const TEMPLATE_RE = /^\$\{DPF_MCP_URL:-([^}]+)\}$/;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" || process.platform === "darwin"
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}

function httpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The literal endpoint this machine's descriptor should carry, or null. */
export function resolvePinTarget(currentUrl, env = process.env) {
  const fromEnv = httpsUrl(env.DPF_MCP_URL);
  if (fromEnv) return fromEnv;
  const template = typeof currentUrl === "string" ? currentUrl.match(TEMPLATE_RE) : null;
  if (template) return httpsUrl(template[1]);
  return null;
}

export function pinPluginMcpUrl({ installedPath, root, env = process.env }) {
  const installed = readJson(installedPath);
  const entries = installed?.plugins?.[PLUGIN_KEY];
  const record = Array.isArray(entries)
    ? entries.find((entry) => entry && samePath(entry.projectPath, root))
    : null;
  if (!record?.installPath) return { code: EXIT_NOTHING };

  const descriptorPath = join(record.installPath, "claude.mcp.json");
  const descriptor = readJson(descriptorPath);
  const server = descriptor?.mcpServers?.dpf;
  if (!server || typeof server !== "object") return { code: EXIT_NOTHING };
  if (server.headers && Object.keys(server.headers).length > 0) return { code: EXIT_LEFT_ALONE };

  const target = resolvePinTarget(server.url, env);
  if (!target) return { code: EXIT_LEFT_ALONE };
  if (server.url === target) return { code: EXIT_NOTHING };

  server.url = target;
  const tmp = `${descriptorPath}.tmp${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(descriptor, null, 2)}\n`);
  renameSync(tmp, descriptorPath);
  return {
    code: EXIT_PINNED,
    message:
      `DPF MCP -- pinned the dpf-platform plugin connector to ${target} so the desktop app can start sign-in; ` +
      "it takes effect in the next session.",
  };
}

if (isEntryModule(import.meta.url)) {
  let code;
  try {
    const [installedPath, root] = process.argv.slice(2);
    const result = pinPluginMcpUrl({ installedPath, root: root || process.cwd() });
    if (result.message) process.stdout.write(`${result.message}\n`);
    code = result.code;
  } catch {
    code = EXIT_LEFT_ALONE;
  }
  process.exit(code);
}
