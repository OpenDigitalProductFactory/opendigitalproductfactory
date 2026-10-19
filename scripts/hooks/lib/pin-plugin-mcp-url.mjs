#!/usr/bin/env node
// scripts/hooks/lib/pin-plugin-mcp-url.mjs
//
// SessionStart step after the plugin reconcile (BI-5201141C follow-up). The
// checked-in plugin descriptor names the endpoint as
// `${DPF_CLAUDE_MCP_URL:-https://localhost/api/mcp/v1?tier=full}` so one file serves
// every install. Claude Code expands that, but the Claude desktop app checks a
// plugin connector's URL before it starts sign-in and cannot parse a variable:
// its log reads `verifyPluginMcpBinding ... URL mismatch; expected=<unparseable>`
// and the user sees "This session's copy of the connector points at a
// different server URL". So the per-machine installed copy (the plugin cache
// the reconcile step materializes) gets this machine's literal endpoint.
//
// The target is DPF_CLAUDE_MCP_URL when it is a parseable https URL whose host
// is not an IPv6 literal, else the template's own default. The shared
// DPF_MCP_URL is never read: every client, gate and stale checkout can set it,
// and Claude's connector does not read it (BI-D6A6462A). A copy still on the
// legacy `${DPF_MCP_URL:-...}` template is pinned from its own default. An inherited plain-http or
// [::1] value (BI-8FD7C0C9: a test once wrote http://[::1]:3000 into launchd,
// and Docker publishes the portal on IPv4 only) never becomes the connector,
// and an OAuth descriptor already holding a plain-http literal -- which cannot
// authenticate by any path, BI-46B636B0 -- is repinned to the canonical
// https endpoint. A fixed `localhost` in the repo would not do: an
// install with a configured PUBLIC_URL names that origin as its OAuth resource,
// and a client on another host name would be refused its token.
//
// Only the OAuth form is touched: a `dpf` server with an Authorization header
// (a bearer descriptor) is left alone. Other headers, such as the toolchain
// declaration `X-DPF-Toolchain`, stay as they are. Query parameters the current
// URL carries that the target does not set (the catalog tier, a declaration)
// are kept (BI-DE1E6485). The write is atomic and a rerun with the same
// endpoint does nothing. Shared by reconcile-claude-plugin.sh and .ps1. The
// updater applies the same rule to every converged record
// (toolchain_convergence.pin_record_descriptors).
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
const TEMPLATE_RE = /^\$\{DPF_(?:CLAUDE_)?MCP_URL:-([^}]+)\}$/;
// The checked-in descriptor's default (packages/dpf-skill-pack/claude.mcp.json).
export const CANONICAL_MCP_URL = "https://localhost/api/mcp/v1?tier=full";

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
    if (url.protocol !== "https:" || url.username || url.password || url.hostname.startsWith("[")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The literal endpoint this machine's descriptor should carry, or null. */
export function resolvePinTarget(currentUrl, env = process.env) {
  const fromEnv = httpsUrl(env.DPF_CLAUDE_MCP_URL);
  if (fromEnv) return fromEnv;
  const template = typeof currentUrl === "string" ? currentUrl.match(TEMPLATE_RE) : null;
  if (template) return httpsUrl(template[1]);
  if (typeof currentUrl === "string" && /^http:\/\//i.test(currentUrl.trim())) return CANONICAL_MCP_URL;
  return null;
}

/** `target`, plus any query parameter the current URL (or its template default) carries that `target` does not set. */
export function preserveQuery(target, currentUrl) {
  const template = typeof currentUrl === "string" ? currentUrl.match(TEMPLATE_RE) : null;
  const source = template ? template[1] : currentUrl;
  if (typeof source !== "string") return target;
  try {
    const kept = new URL(source).searchParams;
    const url = new URL(target);
    for (const [key, value] of kept) {
      if (!url.searchParams.has(key)) url.searchParams.append(key, value);
    }
    return url.toString();
  } catch {
    return target;
  }
}

function hasAuthorization(headers) {
  return Boolean(headers) && typeof headers === "object" && Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
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
  if (hasAuthorization(server.headers)) return { code: EXIT_LEFT_ALONE };

  const resolved = resolvePinTarget(server.url, env);
  if (!resolved) return { code: EXIT_LEFT_ALONE };
  const target = preserveQuery(resolved, server.url);
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
