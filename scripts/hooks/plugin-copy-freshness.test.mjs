// scripts/hooks/plugin-copy-freshness.test.mjs
//
// BI-16EAAB62: the SessionStart hook that names an installed dpf-platform copy
// which drifted from the root clone's pack. The comparison itself is covered by
// packages/dpf-skill-pack/scripts/installed_copy_freshness_test.py; this pins
// the wiring a session actually runs -- the settings entry and the launcher's
// .sh target -- against a fake HOME, and that the hook never fails a session.
//
// POSIX-only for the run cases (the .sh twin); skipped where sh or python3 is
// unavailable. The .ps1 twin is held to the same contract by reading it.
//
// Run: node --test scripts/hooks/plugin-copy-freshness.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const twin = join(here, "plugin-copy-freshness.ps1");
const posix = process.platform !== "win32";
const hasPython = posix && spawnSync("sh", ["-c", "command -v python3"], { stdio: "ignore" }).status === 0;
const STALE_URL = "http://127.0.0.1:3000/api/mcp/v1";

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** A project root carrying this repo's checker and a minimal reference pack. */
function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-plugin-copy-"));
  const root = join(dir, "root");
  const home = join(dir, "home");
  const pack = join(root, "packages", "dpf-skill-pack");
  mkdirSync(join(root, "scripts"), { recursive: true });
  cpSync(join(repo, "scripts", "hooks"), join(root, "scripts", "hooks"), { recursive: true });
  cpSync(join(repo, "packages", "dpf-skill-pack", "scripts"), join(pack, "scripts"), { recursive: true });
  writeJson(join(pack, ".claude-plugin", "plugin.json"), { name: "dpf-platform", version: "0.2.8" });
  writeJson(join(pack, "claude.mcp.json"), {
    mcpServers: { dpf: { type: "http", url: "${DPF_MCP_URL:-https://localhost/api/mcp/v1?tier=full}", oauth: { scopes: "dpf.read dpf.work dpf.build" } } },
  });
  mkdirSync(home);
  return {
    dir,
    root,
    home,
    pack,
    shared: join(home, ".agents", "plugins", "plugins", "dpf-platform"),
    run(extra = {}) {
      const env = { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: root, ...extra };
      return spawnSync(process.execPath, [join(root, "scripts", "hooks", "run-hook.mjs"), "hooks/plugin-copy-freshness"], {
        env,
        input: "{}",
        encoding: "utf8",
        timeout: 30_000,
      });
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("the checked-in settings run the hook at SessionStart through the launcher", () => {
  const settings = JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8"));
  const commands = (settings.hooks.SessionStart ?? []).flatMap((group) => group.hooks.map((h) => h.command));
  assert.ok(
    commands.some((c) => c.includes("run-hook.mjs") && c.endsWith("hooks/plugin-copy-freshness")),
    `no SessionStart entry for hooks/plugin-copy-freshness in ${JSON.stringify(commands)}`,
  );
});

test("the PowerShell twin calls the same checker, honours the silence switch and is ASCII", () => {
  const text = readFileSync(twin, "utf8");
  assert.ok(/^[\x00-\x7F]*$/.test(text), "plugin-copy-freshness.ps1 must be plain ASCII");
  assert.match(text, /installed_copy_freshness\.py/);
  assert.match(text, /DPF_SKIP_PLUGIN_COPY_CHECK/);
  assert.match(text, /exit 0/);
});

test("a stale shared copy (0.2.5, plain-http bearer descriptor) is named with its repair", { skip: !hasPython }, (t) => {
  const box = makeSandbox();
  t.after(() => box.cleanup());
  cpSync(box.pack, box.shared, { recursive: true });
  writeJson(join(box.shared, ".claude-plugin", "plugin.json"), { name: "dpf-platform", version: "0.2.5" });
  writeJson(join(box.shared, "claude.mcp.json"), {
    mcpServers: { dpf: { type: "http", url: STALE_URL, headers: { Authorization: "Bearer ${DPF_MCP_BEARER_TOKEN:-}" } } },
  });
  const result = box.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^WARN: stale DPF plugin copy/m);
  assert.ok(result.stdout.includes(box.shared), result.stdout);
  assert.ok(result.stdout.includes(STALE_URL), result.stdout);
  assert.ok(result.stdout.includes(join(box.pack, "scripts", "update_agent_toolchain.py")), result.stdout);

  const silenced = box.run({ DPF_SKIP_PLUGIN_COPY_CHECK: "1" });
  assert.equal(silenced.status, 0);
  assert.equal(silenced.stdout, "");
});

test("a current shared copy stays quiet", { skip: !hasPython }, (t) => {
  const box = makeSandbox();
  t.after(() => box.cleanup());
  cpSync(box.pack, box.shared, { recursive: true });
  const result = box.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("without python3 on PATH the hook is silent and exits 0", { skip: !posix }, (t) => {
  const box = makeSandbox();
  t.after(() => box.cleanup());
  // The launcher still finds sh; only the interpreter is missing.
  const bin = join(box.dir, "bin");
  mkdirSync(bin);
  symlinkSync(spawnSync("sh", ["-c", "command -v sh"], { encoding: "utf8" }).stdout.trim(), join(bin, "sh"));
  const result = box.run({ PATH: bin });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});
