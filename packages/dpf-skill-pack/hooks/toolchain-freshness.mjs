#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/toolchain-freshness.mjs
//
// SessionStart advisory: is the DPF toolchain on this machine current?
// BI-A67B65F4, design docs/superpowers/specs/2026-10-07-agent-toolchain-release-delivery-design.md section 5.4.
//
// The old check ran only from the source repo's .claude/settings.json, so a
// session opened in the installed-runtime folder (D:\DPF) never ran it. This
// hook ships in the plugin, so it runs wherever the plugin loads.
//
// - With Python, it runs scripts/installed_copy_freshness.py --json. That
//   compares every installed copy with the manifest the portal serves (or the
//   root clone when the portal cannot be reached and a checkout is present).
// - With no Python, it fetches the manifest itself and compares versions. It
//   can prove a copy stale, but not current, so a version match is "unknown".
// - The network wait is 2 seconds. Offline is "unknown", never "current".
// - It always prints one line (current, stale or unknown). It never writes.
//
// Clients: Claude Code and Codex load it from hooks/hooks.json. Grok runs
// plugin hooks only from ~/.grok/hooks, so grok-session-start.mjs calls this
// file. The hook only speeds things up; the server's toolchain verdict on each
// DPF connection is the guarantee. DPF_SKIP_PLUGIN_COPY_CHECK=1 silences it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BACKLOG_ID = "BI-A67B65F4";
const MANIFEST_PATH = "/api/agent-toolchain/manifest";
const NETWORK_TIMEOUT_MS = 2000;
const PYTHON_TIMEOUT_MS = 15000;
const TEMPLATE = /^\$\{DPF_MCP_URL:-([^}]+)\}$/;

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/** -1, 0 or 1 for dotted numeric versions (build metadata ignored); null if either is not numeric. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const parts = String(v ?? "").split("+")[0].split(".");
    return parts.every((p) => /^\d+$/.test(p)) ? parts.map(Number) : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Interpreters to try, in order. DPF_PYTHON names the only one ("" means none). */
export function pythonCandidates(env = process.env, platform = process.platform) {
  if (env.DPF_PYTHON !== undefined) return env.DPF_PYTHON ? [[env.DPF_PYTHON]] : [];
  return platform === "win32" ? [["python"], ["py", "-3"], ["python3"]] : [["python3"], ["python"]];
}

function homeDir(env) {
  return env.DPF_AGENT_TOOLCHAIN_HOME || homedir();
}

function packVersion(dir) {
  for (const manifest of [join(dir, ".claude-plugin", "plugin.json"), join(dir, ".codex-plugin", "plugin.json")]) {
    const version = readJson(manifest)?.version;
    if (version) return String(version).split("+")[0];
  }
  return null;
}

/** The manifest URL: DPF_TOOLCHAIN_MANIFEST_URL, else the origin of the shared copy's connector. */
export function resolveManifestUrl(env = process.env) {
  if (env.DPF_TOOLCHAIN_MANIFEST_URL) return env.DPF_TOOLCHAIN_MANIFEST_URL;
  const shared = join(homeDir(env), ".agents", "plugins", "plugins", "dpf-platform", "claude.mcp.json");
  let url = readJson(shared)?.mcpServers?.dpf?.url;
  if (typeof url !== "string") return null;
  const template = url.match(TEMPLATE);
  if (template) url = env.DPF_MCP_URL || template[1];
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.origin}${MANIFEST_PATH}`;
  } catch {
    return null;
  }
}

function display(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url);
  }
}

/** Run the Python checker. Returns its report, or { missing: reason } when no interpreter gave one. */
function runPythonChecker(cwd, env) {
  const checker = join(pluginRoot, "scripts", "installed_copy_freshness.py");
  if (!existsSync(checker)) return { missing: "the Python checker is not in this copy" };
  const args = [checker, "--json", "--project-dir", cwd];
  if (env.DPF_TOOLCHAIN_MANIFEST_URL) args.push("--manifest-url", env.DPF_TOOLCHAIN_MANIFEST_URL);
  let found = false;
  for (const [cmd, ...prefix] of pythonCandidates(env)) {
    const r = spawnSync(cmd, [...prefix, ...args], {
      encoding: "utf8",
      env: { ...env, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: PYTHON_TIMEOUT_MS,
      windowsHide: true,
    });
    if (r.error?.code === "ENOENT") continue;
    if (r.error?.code === "ETIMEDOUT") return { missing: "the Python checker timed out" };
    found = true;
    try {
      const report = JSON.parse(String(r.stdout ?? "").trim().split(/\r?\n/).pop() ?? "");
      if (report && typeof report.status === "string") return report;
    } catch {
      // A stub (the Windows Store alias) or an old interpreter: try the next.
    }
  }
  return { missing: found ? "Python could not run the checker" : "Python was not found" };
}

/**
 * GET a JSON document with a hard deadline. node:http with no keep-alive agent,
 * not fetch: fetch leaves pooled sockets that keep the process alive, and an
 * early process.exit() with them closing aborts Node on Windows (libuv assert).
 */
export function getJson(url, timeoutMs = NETWORK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const req = send(target, { method: "GET", agent: false, headers: { Accept: "application/json", Connection: "close" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        finish(reject, new Error(`HTTP ${res.statusCode}`));
        req.destroy();
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        try {
          finish(resolve, JSON.parse(body));
        } catch (error) {
          finish(reject, error);
        }
      });
    });
    const timer = setTimeout(() => {
      finish(reject, new Error("timed out"));
      req.destroy();
    }, timeoutMs);
    req.on("error", (error) => finish(reject, error));
    req.end();
  });
}

/** Version-only comparison against the manifest, for hosts with no Python. */
export async function versionOnlyCheck(env, why) {
  const url = resolveManifestUrl(env);
  if (!url) return { status: "unknown", reason: `${why}, and no portal address was found in the shared copy's connector` };
  let manifest;
  try {
    manifest = await getJson(url);
  } catch (error) {
    return { status: "unknown", reason: `${why}, and the portal manifest at ${display(url)} was unreachable (${error?.message || error?.code || error})` };
  }
  const want = typeof manifest?.packVersion === "string" ? manifest.packVersion : null;
  if (!want) return { status: "unknown", reason: `${why}, and the portal manifest at ${display(url)} has no packVersion` };
  const copies = [
    ["the copy this session loaded", pluginRoot],
    ["shared managed copy", join(homeDir(env), ".agents", "plugins", "plugins", "dpf-platform")],
  ];
  const lines = [];
  for (const [label, dir] of copies) {
    const have = packVersion(dir);
    if (have && compareVersions(have, want) === -1) {
      lines.push(`WARN: stale DPF plugin copy -- ${label} at ${dir}: version ${have}, the portal manifest is ${want}. Repair: update the DPF agent toolchain from ${new URL(url).origin}, then restart the client.`);
    }
  }
  const reference = `the portal manifest at ${display(url)} (pack ${want})`;
  if (lines.length) return { status: "stale", reference, lines: [...lines, `(${why}; versions only were compared.)`] };
  return { status: "unknown", reference, reason: `${why}, so only versions were compared: no copy is older than ${want}, but content was not checked` };
}

/** The one line (or block) the session sees. */
export function renderReport(report) {
  const tail = `(${BACKLOG_ID}; silence: DPF_SKIP_PLUGIN_COPY_CHECK=1)`;
  if (report?.status === "current") {
    return `DPF toolchain: current. No installed DPF plugin copy is behind ${report.reference}. ${tail}`;
  }
  if (report?.status === "stale") {
    return [`DPF toolchain: stale. Compared with ${report.reference}:`, ...(report.lines ?? []), tail].join("\n");
  }
  const reason = report?.reason ? `${report.reason}.` : "The check could not finish.";
  return `DPF toolchain: unknown. ${reason} The toolchain verdict on the DPF connection is the authority. ${tail}`;
}

function sessionCwd() {
  try {
    const raw = readFileSync(0, "utf8");
    const payload = raw ? JSON.parse(raw) : {};
    return payload.cwd || payload.workspaceRoot || process.cwd();
  } catch {
    return process.cwd();
  }
}

async function main() {
  const env = process.env;
  if (env.DPF_SKIP_PLUGIN_COPY_CHECK === "1") return;
  let report;
  try {
    const cwd = sessionCwd();
    report = runPythonChecker(cwd, env);
    if (report.missing) report = await versionOnlyCheck(env, report.missing);
  } catch (error) {
    report = { status: "unknown", reason: `the check failed (${error?.message ?? error})` };
  }
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: renderReport(report) } }),
  );
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Exit 0 by letting the event loop drain, never process.exit() (see getJson).
if (isEntryPoint()) {
  process.exitCode = 0;
  main().catch(() => {});
}
