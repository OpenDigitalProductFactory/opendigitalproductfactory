// packages/dpf-skill-pack/hooks/toolchain-freshness.test.mjs
//
// BI-A67B65F4 (design 2026-10-07-agent-toolchain-release-delivery section 5.4).
// The SessionStart freshness advisory runs from the plugin's own hooks, so it
// reaches installed-runtime sessions with no source checkout. It compares the
// installed copies with the manifest the portal serves, and it is never silent:
// each run prints current, stale or unknown. Offline is unknown, never current.
//
// Every case uses a fake HOME and a local manifest server; nothing reads the
// real home or the live portal.
//
// Run: node --test packages/dpf-skill-pack/hooks/toolchain-freshness.test.mjs

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { compareVersions, pythonCandidates, renderReport } from "./toolchain-freshness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "toolchain-freshness.mjs");
const packRoot = join(here, "..");
const ownVersion = JSON.parse(readFileSync(join(packRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
const MANIFEST_PATH = "/api/agent-toolchain/manifest";

/** A Python that can run the checker, or null. */
function findPython() {
  const candidates = process.platform === "win32" ? [["python"], ["py", "-3"], ["python3"]] : [["python3"], ["python"]];
  for (const [cmd, ...args] of candidates) {
    const r = spawnSync(cmd, [...args, "-c", "import sys; print(sys.executable)"], { encoding: "utf8", windowsHide: true });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}
const python = findPython();

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Start a manifest server. `state.manifest` is served; `state.hang` never answers. */
async function startPortal(t) {
  const state = { manifest: null, hang: false };
  const server = createServer((req, res) => {
    if (state.hang) return; // never answers
    if (req.url !== MANIFEST_PATH || !state.manifest) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(state.manifest));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  state.origin = `http://127.0.0.1:${server.address().port}`;
  return state;
}

function makeHome(t) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "dpf-toolchain-freshness-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, "home");
  const install = join(dir, "install"); // an installed-runtime folder: no checkout
  mkdirSync(home);
  mkdirSync(install);
  writeFileSync(join(install, ".install-mode"), "consumer\n");
  return { dir, home, install, shared: join(home, ".agents", "plugins", "plugins", "dpf-platform") };
}

/** A shared managed copy at `version` whose connector points at `origin`. */
function writeSharedCopy(box, version, origin) {
  writeJson(join(box.shared, ".claude-plugin", "plugin.json"), { name: "dpf-platform", version });
  writeJson(join(box.shared, "claude.mcp.json"), {
    // What the updater writes for a plain-http loopback portal: a bearer header.
    mcpServers: { dpf: { type: "http", url: `${origin}/api/mcp/v1?tier=full`, headers: { Authorization: "Bearer ${DPF_MCP_BEARER_TOKEN:-}" } } },
  });
  writeFileSync(join(box.shared, "README.md"), "pack\n");
}

function pythonDigest(dir) {
  const code = [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(join(packRoot, "scripts"))})`,
    "import installed_copy_freshness as f",
    `print(f.delivered_digest(__import__('pathlib').Path(${JSON.stringify(dir)})))`,
  ].join("; ");
  const r = spawnSync(python, ["-c", code], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

/** Run the hook as a client would: payload on stdin, fake HOME, async so the test server can answer. */
function runHook(box, origin, { pythonPath, extraEnv = {}, payload } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("DPF_")) env[k] = v;
  Object.assign(env, {
    HOME: box.home,
    USERPROFILE: box.home,
    DPF_AGENT_TOOLCHAIN_HOME: box.home,
    DPF_MCP_URL: `${origin}/api/mcp/v1?tier=full`,
    DPF_PYTHON: pythonPath ?? join(box.dir, "no-python-here"),
    ...extraEnv,
  });
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [hook], { env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(JSON.stringify(payload ?? { hook_event_name: "SessionStart", cwd: box.install }));
  });
}

/** The SessionStart envelope every client honours, and its text. */
function contextOf(result) {
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.decision, undefined, "SessionStart output carries no top-level decision");
  assert.equal(out.hookSpecificOutput?.hookEventName, "SessionStart");
  assert.equal(typeof out.hookSpecificOutput?.additionalContext, "string");
  return out.hookSpecificOutput.additionalContext;
}

function snapshot(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out.push(`${p}:${s.size}:${s.mtimeMs}`);
    }
  };
  walk(root);
  return out.sort();
}

// ── wiring ──────────────────────────────────────────────────────────────────

test("the plugin's own hooks.json runs the advisory at SessionStart from the plugin root", () => {
  const cfg = JSON.parse(readFileSync(join(here, "hooks.json"), "utf8"));
  const cmds = (cfg.hooks.SessionStart ?? []).flatMap((g) => (g.hooks ?? []).map((h) => String(h.command ?? "")));
  const mine = cmds.filter((c) => c.includes("toolchain-freshness.mjs"));
  assert.equal(mine.length, 1, "exactly one SessionStart entry runs toolchain-freshness.mjs");
  assert.ok(mine[0].includes("${CLAUDE_PLUGIN_ROOT}"), mine[0]);
  for (const event of ["PreToolUse", "Stop", "SessionEnd"]) {
    const other = (cfg.hooks[event] ?? []).flatMap((g) => (g.hooks ?? []).map((h) => String(h.command ?? "")));
    assert.ok(!other.some((c) => c.includes("toolchain-freshness.mjs")), `not on ${event}`);
  }
});

test("the Grok SessionStart entry carries the advisory (Grok ignores plugin-bundled hooks)", async (t) => {
  const box = makeHome(t);
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, "grok-session-start.mjs")], {
      cwd: box.install,
      env: { ...process.env, HOME: box.home, USERPROFILE: box.home, DPF_AGENT_TOOLCHAIN_HOME: box.home, DPF_PYTHON: "" },
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (status) => resolve({ status, stdout, stderr: "" }));
    child.stdin.end("{}");
  });
  assert.match(contextOf(result), /DPF toolchain: unknown\./);
});

test("the source repo no longer registers the old copy-freshness hook, so the advisory runs once", () => {
  const settingsPath = join(here, "..", "..", "..", ".claude", "settings.json");
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return; // standalone plugin install
  }
  const cmds = (settings.hooks?.SessionStart ?? []).flatMap((g) => (g.hooks ?? []).map((h) => String(h.command ?? "")));
  assert.ok(!cmds.some((c) => c.includes("plugin-copy-freshness")), JSON.stringify(cmds));
});

// ── pure helpers ────────────────────────────────────────────────────────────

test("compareVersions orders dotted versions numerically and ignores build metadata", () => {
  assert.equal(compareVersions("0.2.10", "0.2.9"), 1);
  assert.equal(compareVersions("0.2.9+codex.1", "0.2.9"), 0);
  assert.equal(compareVersions("0.2.8", "0.2.9"), -1);
  assert.equal(compareVersions("x", "0.2.9"), null);
});

test("DPF_PYTHON names the only interpreter; otherwise the platform's usual names", () => {
  assert.deepEqual(pythonCandidates({ DPF_PYTHON: "/opt/py" }, "linux"), [["/opt/py"]]);
  assert.deepEqual(pythonCandidates({}, "win32")[0], ["python"]);
  assert.deepEqual(pythonCandidates({}, "linux")[0], ["python3"]);
});

test("an unknown report names itself unknown and never current", () => {
  const text = renderReport({ status: "unknown", reason: "offline" });
  assert.match(text, /^DPF toolchain: unknown\./);
  assert.doesNotMatch(text, /current\./);
});

// ── with Python ─────────────────────────────────────────────────────────────

test("with Python: a copy matching the portal manifest is reported current", { skip: !python }, async (t) => {
  const portal = await startPortal(t);
  const box = makeHome(t);
  writeSharedCopy(box, "0.2.9", portal.origin);
  portal.manifest = { packVersion: "0.2.9", packDigest: pythonDigest(box.shared) };
  const text = contextOf(await runHook(box, portal.origin, { pythonPath: python }));
  assert.match(text, /^DPF toolchain: current\./);
  assert.ok(text.includes(portal.origin), text);
});

test("with Python: a stale copy is named with the portal it should match", { skip: !python }, async (t) => {
  const portal = await startPortal(t);
  const box = makeHome(t);
  writeSharedCopy(box, "0.2.5", portal.origin);
  portal.manifest = { packVersion: "0.2.9", packDigest: "0".repeat(64) };
  const before = snapshot(box.dir);
  const text = contextOf(await runHook(box, portal.origin, { pythonPath: python }));
  assert.match(text, /^DPF toolchain: stale\./);
  assert.match(text, /WARN: stale DPF plugin copy/);
  assert.ok(text.includes(box.shared), text);
  assert.ok(text.includes("0.2.5") && text.includes("0.2.9"), text);
  assert.deepEqual(snapshot(box.dir), before, "the advisory never writes");
});

test("with Python: an offline portal is unknown, never current", { skip: !python }, async (t) => {
  const portal = await startPortal(t);
  const box = makeHome(t);
  writeSharedCopy(box, "0.2.9", portal.origin);
  portal.hang = true;
  const result = await runHook(box, portal.origin, { pythonPath: python });
  const text = contextOf(result);
  assert.match(text, /^DPF toolchain: unknown\./);
  assert.match(text, /unreachable/);
  assert.ok(result.ms < 8000, `took ${result.ms} ms`);
});

// ── without Python ──────────────────────────────────────────────────────────

test("without Python: a newer portal version is reported stale by version alone", async (t) => {
  const portal = await startPortal(t);
  const box = makeHome(t);
  writeSharedCopy(box, "0.2.5", portal.origin);
  portal.manifest = { packVersion: "99.0.0", packDigest: "0".repeat(64) };
  const before = snapshot(box.dir);
  const text = contextOf(await runHook(box, portal.origin));
  assert.match(text, /^DPF toolchain: stale\./);
  assert.ok(text.includes(box.shared), text);
  assert.ok(text.includes("99.0.0"), text);
  assert.match(text, /Python/);
  assert.deepEqual(snapshot(box.dir), before, "the advisory never writes");
});

test("without Python: matching versions are unknown, because content was not compared", async (t) => {
  const portal = await startPortal(t);
  const box = makeHome(t);
  writeSharedCopy(box, ownVersion, portal.origin);
  portal.manifest = { packVersion: ownVersion, packDigest: "0".repeat(64) };
  const text = contextOf(await runHook(box, portal.origin));
  assert.match(text, /^DPF toolchain: unknown\./);
  assert.match(text, /Python/);
});

test("without Python: an offline portal is unknown within the 2-second budget", async (t) => {
  const portal = await startPortal(t);
  const box = makeHome(t);
  writeSharedCopy(box, ownVersion, portal.origin);
  portal.hang = true;
  const result = await runHook(box, portal.origin);
  const text = contextOf(result);
  assert.match(text, /^DPF toolchain: unknown\./);
  assert.ok(result.ms < 6000, `took ${result.ms} ms`);
});

test("without Python and no portal address: unknown, not silent", async (t) => {
  const box = makeHome(t);
  const text = contextOf(await runHook(box, "http://127.0.0.1:9"));
  assert.match(text, /^DPF toolchain: unknown\./);
});

test("without python on PATH (POSIX): the hook still answers", { skip: process.platform === "win32" }, async (t) => {
  const portal = await startPortal(t);
  const box = makeHome(t);
  writeSharedCopy(box, ownVersion, portal.origin);
  portal.manifest = { packVersion: ownVersion, packDigest: "0".repeat(64) };
  const result = await runHook(box, portal.origin, {
    pythonPath: "",
    extraEnv: { DPF_PYTHON: undefined, PATH: dirname(process.execPath) },
  });
  const text = contextOf(result);
  assert.match(text, /^DPF toolchain: (unknown|stale)\./);
});

test("the silence switch silences it", async (t) => {
  const box = makeHome(t);
  const result = await runHook(box, "http://127.0.0.1:9", { extraEnv: { DPF_SKIP_PLUGIN_COPY_CHECK: "1" } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("a garbage payload still yields an answer and exit 0", async (t) => {
  const box = makeHome(t);
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [hook], {
      env: { ...process.env, HOME: box.home, USERPROFILE: box.home, DPF_AGENT_TOOLCHAIN_HOME: box.home, DPF_PYTHON: join(box.dir, "none") },
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (status) => resolve({ status, stdout, stderr: "" }));
    child.stdin.end("{not json");
  });
  assert.match(contextOf(result), /^DPF toolchain: /);
});
