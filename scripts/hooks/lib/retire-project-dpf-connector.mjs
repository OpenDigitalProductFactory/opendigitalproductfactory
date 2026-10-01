#!/usr/bin/env node
// scripts/hooks/lib/retire-project-dpf-connector.mjs
//
// SessionStart converger for existing machines (BI-5201141C, design 12.4.4 and
// AC-CANON-3). Since S3 the dpf-platform plugin's URL-only descriptor is the one
// Claude Code `dpf` connector and no writer produces a project .mcp.json `dpf`
// entry on https. A machine that already has one keeps loading it beside the
// plugin's server (Claude Code de-duplicates plugin and project servers by
// endpoint), so this retires it -- under conditions that make it safe:
//
//   1. The endpoint the client uses is https (the caller passes it).
//   2. The installed dpf-platform plugin's claude.mcp.json is found and its
//      `dpf` server is URL-only (no headers). If that cannot be confirmed,
//      nothing is touched.
//   3. The entry is platform-written: key `dpf`, url on /api/mcp/v1 at
//      loopback (127.0.0.1, localhost, [::1]) or at the DPF_MCP_URL origin.
//      Other servers and other keys are never touched.
//
// The JSON is rewritten with every other server preserved; when `dpf` was the
// only server the file becomes {"mcpServers": {}} (disable, not delete). The
// write is atomic (temp file + rename) and a one-time backup is kept at
// .mcp.json.pre-single-connector. A rerun finds no `dpf` entry and does nothing.
//
// Shared by mcp-health.sh and mcp-health.ps1 so the twins cannot drift.
// Usage: node retire-project-dpf-connector.mjs <projectRoot> <resolvedMcpUrl>
// Exit codes: 0 retired (one line printed), 10 no dpf entry (nothing to do),
// 11 dpf entry present but left alone (conditions unmet). Never throws.

import { existsSync, readFileSync, renameSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { isEntryModule } from "../../lib/entry-module.mjs";
import { gitTextOrNull } from "../../lib/git.mjs";

export const EXIT_RETIRED = 0;
export const EXIT_NOTHING = 10;
export const EXIT_LEFT_ALONE = 11;

const PLUGIN_KEY = "dpf-platform@dpf-platform-local";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
export const BACKUP_SUFFIX = ".pre-single-connector";

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

function mainCloneRoot(root) {
  const common = gitTextOrNull(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root });
  return common ? dirname(common) : null;
}

/**
 * The installed plugin descriptor that applies to this project: an entry for
 * this project, else for the root clone, else a user-scope entry. Returns the
 * parsed `dpf` server or null when none can be found.
 */
export function installedPluginDpfServer(root, env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR || join(env.HOME || env.USERPROFILE || homedir(), ".claude");
  const installed = readJson(join(configDir, "plugins", "installed_plugins.json"));
  const entries = Array.isArray(installed?.plugins?.[PLUGIN_KEY]) ? installed.plugins[PLUGIN_KEY] : [];
  const main = mainCloneRoot(root);
  const ordered = [
    ...entries.filter((e) => samePath(e?.projectPath, root)),
    ...entries.filter((e) => main && samePath(e?.projectPath, main)),
    ...entries.filter((e) => e?.scope === "user"),
  ];
  for (const entry of ordered) {
    if (typeof entry?.installPath !== "string") continue;
    const descriptor = readJson(join(entry.installPath, "claude.mcp.json"));
    const server = descriptor?.mcpServers?.dpf;
    if (server && typeof server === "object") return server;
  }
  return null;
}

export function isUrlOnly(server) {
  return Boolean(server) && typeof server.url === "string" && server.url.length > 0 && !("headers" in server);
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Key `dpf`, url on /api/mcp/v1 at loopback or at the DPF_MCP_URL origin. */
export function isPlatformWrittenEntry(server, env = process.env) {
  if (!server || typeof server.url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(server.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.pathname.replace(/\/+$/, "") !== "/api/mcp/v1") return false;
  if (LOOPBACK_HOSTS.has(parsed.hostname)) return true;
  const configured = env.DPF_MCP_URL ? originOf(env.DPF_MCP_URL) : null;
  return configured !== null && parsed.origin === configured;
}

export function retireProjectDpfConnector({ root, url, env = process.env }) {
  const cfg = join(root, ".mcp.json");
  if (!existsSync(cfg)) return { code: EXIT_NOTHING };
  const config = readJson(cfg);
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers) || !("dpf" in servers)) {
    return { code: EXIT_NOTHING };
  }
  if (typeof url !== "string" || !url.startsWith("https://")) return { code: EXIT_LEFT_ALONE };
  if (!isUrlOnly(installedPluginDpfServer(root, env))) return { code: EXIT_LEFT_ALONE };
  if (!isPlatformWrittenEntry(servers.dpf, env)) return { code: EXIT_LEFT_ALONE };

  const { dpf: _retired, ...kept } = servers;
  const next = { ...config, mcpServers: kept };
  const backup = cfg + BACKUP_SUFFIX;
  const tmp = `${cfg}.tmp-${process.pid}`;
  try {
    if (!existsSync(backup)) copyFileSync(cfg, backup);
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
    renameSync(tmp, cfg);
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    return { code: EXIT_LEFT_ALONE };
  }
  return {
    code: EXIT_RETIRED,
    message:
      `DPF MCP -- retired the project 'dpf' server from ${cfg} (backup: ${backup}); `
      + "the dpf-platform plugin is the one dpf connector, so the next session start loads a single connector.",
  };
}

if (isEntryModule(import.meta.url)) {
  let code;
  try {
    const [root, url] = process.argv.slice(2);
    const result = retireProjectDpfConnector({ root: root || process.cwd(), url });
    if (result.message) process.stdout.write(result.message + "\n");
    code = result.code;
  } catch {
    code = EXIT_LEFT_ALONE;
  }
  process.exit(code);
}
