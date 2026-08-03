// scripts/hooks/run-hook.test.mjs
//
// BI-BDA89375 — launcher must own stdin forwarding and child lifetime so
// transcript-snapshot (and every other run-hook target) cannot exhaust the
// host process table by hanging on inherited Claude Code stdin.
//
// Run: node --test scripts/hooks/run-hook.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const launcher = join(here, "run-hook.mjs");
const isWindows = process.platform === "win32";

/**
 * @param {{
 *   scriptBody: string,
 *   payload?: string,
 *   timeoutMs?: number,
 *   base?: string,
 *   maxWaitMs?: number,
 * }} opts
 */
function runLauncher(opts) {
  const base = opts.base ?? "hooks-fixtures/probe";
  const repoRoot = mkdtempSync(join(tmpdir(), "run-hook-"));
  const scriptRel = `${base}${isWindows ? ".ps1" : ".sh"}`;
  const scriptPath = join(repoRoot, "scripts", scriptRel);
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, opts.scriptBody, "utf8");
  if (!isWindows) {
    // sh targets need execute bit only if invoked directly; we invoke via `sh`.
  }

  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: repoRoot,
    DPF_HOOK_TIMEOUT_MS: String(opts.timeoutMs ?? 15_000),
  };

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [launcher, base], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));

    const maxWait = opts.maxWaitMs ?? Math.max((opts.timeoutMs ?? 15_000) + 5_000, 10_000);
    const watchdog = setTimeout(() => {
      child.kill("SIGKILL");
      cleanup();
      resolvePromise({
        code: child.exitCode ?? 1,
        timedOutWatchdog: true,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        repoRoot,
        scriptPath,
        pid: child.pid,
      });
    }, maxWait);

    const cleanup = () => {
      clearTimeout(watchdog);
      try {
        rmSync(repoRoot, { recursive: true, force: true });
      } catch {
        // best-effort temp cleanup
      }
    };

    child.on("error", (error) => {
      cleanup();
      resolvePromise({
        code: 1,
        error,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        repoRoot,
        scriptPath,
        pid: child.pid,
      });
    });

    child.on("exit", (code) => {
      const result = {
        code: code ?? 0,
        timedOutWatchdog: false,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        repoRoot,
        scriptPath,
        pid: child.pid,
      };
      // Delay cleanup until caller can inspect written fixture files when needed.
      resolvePromise({
        ...result,
        cleanup,
      });
    });

    if (opts.payload != null) {
      child.stdin.write(opts.payload);
    }
    child.stdin.end();
  });
}

/**
 * @param {number | undefined} pid
 * @returns {boolean}
 */
function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * On Windows, PowerShell children can outlive a killed node if we only
 * killed the node wrapper. Probe by command line via tasklist is heavy;
 * instead fixture scripts write a PID file we can check.
 * @param {string} pidFile
 * @returns {boolean}
 */
function fixtureChildAlive(pidFile) {
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  return processAlive(pid);
}

test("forwards payload bytes unchanged to an EOF-reading child and exits 0", async () => {
  const markerDir = mkdtempSync(join(tmpdir(), "run-hook-payload-"));
  const outFile = join(markerDir, "payload.txt");
  const pidFile = join(markerDir, "child.pid");

  const payload = JSON.stringify({
    session_id: "sess-test-1",
    transcript_path: "C:/tmp/does-not-matter.jsonl",
    hook_event_name: "PostToolUse",
  });

  const scriptBody = isWindows
    ? `#Requires -Version 5.1
$ErrorActionPreference = 'Continue'
$raw = [Console]::In.ReadToEnd()
$pid | Set-Content -LiteralPath '${pidFile.replace(/'/g, "''")}'
$raw | Set-Content -LiteralPath '${outFile.replace(/'/g, "''")}' -NoNewline
exit 0
`
    : `#!/bin/sh
printf '%s' "$$" > '${pidFile.replace(/'/g, "'\\''")}'
cat > '${outFile.replace(/'/g, "'\\''")}'
exit 0
`;

  const result = await runLauncher({
    scriptBody,
    payload,
    timeoutMs: 5_000,
    maxWaitMs: 12_000,
  });

  assert.equal(result.timedOutWatchdog, false, "launcher must complete without test watchdog");
  assert.equal(result.code, 0, `launcher must exit 0; stderr=${result.stderr}`);
  assert.equal(readFileSync(outFile, "utf8"), payload, "payload must be forwarded unchanged");
  assert.equal(fixtureChildAlive(pidFile), false, "child must not survive after launcher exit");
  result.cleanup?.();
  rmSync(markerDir, { recursive: true, force: true });
});

test("timeout kills an EOF-waiting hang that never finishes and still exits 0", async () => {
  // Simulate the pre-fix failure mode: child blocks forever after reading
  // stdin (or on a long sleep). Launcher must bound the wait and reap the tree.
  const markerDir = mkdtempSync(join(tmpdir(), "run-hook-hang-"));
  const pidFile = join(markerDir, "child.pid");
  const startedFile = join(markerDir, "started");

  const scriptBody = isWindows
    ? `#Requires -Version 5.1
$ErrorActionPreference = 'Continue'
$raw = [Console]::In.ReadToEnd()
$pid | Set-Content -LiteralPath '${pidFile.replace(/'/g, "''")}'
'started' | Set-Content -LiteralPath '${startedFile.replace(/'/g, "''")}'
Start-Sleep -Seconds 120
exit 0
`
    : `#!/bin/sh
cat >/dev/null
printf '%s' "$$" > '${pidFile.replace(/'/g, "'\\''")}'
printf started > '${startedFile.replace(/'/g, "'\\''")}'
sleep 120
exit 0
`;

  const started = Date.now();
  const result = await runLauncher({
    scriptBody,
    payload: '{"hook_event_name":"PostToolUse"}',
    timeoutMs: 800,
    maxWaitMs: 15_000,
  });
  const elapsed = Date.now() - started;

  assert.equal(result.timedOutWatchdog, false, "launcher timeout path must finish before test watchdog");
  assert.equal(result.code, 0, `launcher must exit 0 on timeout; stderr=${result.stderr}`);
  assert.ok(elapsed < 8_000, `must bound completion (elapsed ${elapsed}ms)`);
  assert.ok(existsSync(startedFile), "hanging child should have started before timeout");
  // Give Windows taskkill a moment to reap the tree.
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(fixtureChildAlive(pidFile), false, "timed-out child tree must not survive");
  result.cleanup?.();
  rmSync(markerDir, { recursive: true, force: true });
});

test("missing target script exits 0 without spawning", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "run-hook-missing-"));
  mkdirSync(join(repoRoot, "scripts"), { recursive: true });

  const result = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [launcher, "hooks-fixtures/does-not-exist"], {
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: repoRoot,
        DPF_HOOK_TIMEOUT_MS: "1000",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.end();
    child.on("exit", (code) => {
      resolvePromise({ code: code ?? 0 });
    });
  });

  assert.equal(result.code, 0);
  rmSync(repoRoot, { recursive: true, force: true });
});

test("child non-zero exit still yields launcher exit 0", async () => {
  const scriptBody = isWindows
    ? `#Requires -Version 5.1
$raw = [Console]::In.ReadToEnd()
exit 7
`
    : `#!/bin/sh
cat >/dev/null
exit 7
`;

  const result = await runLauncher({
    scriptBody,
    payload: "{}",
    timeoutMs: 5_000,
    maxWaitMs: 12_000,
  });

  assert.equal(result.code, 0, "non-zero child must not fail the hook contract");
  result.cleanup?.();
});

test("traversal or empty base is a no-op exit 0", async () => {
  for (const base of ["", "../etc/passwd", "foo/../../bar"]) {
    const result = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, base ? [launcher, base] : [launcher], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdin.end();
      child.on("exit", (code) => resolvePromise({ code: code ?? 0 }));
    });
    assert.equal(result.code, 0, `base=${JSON.stringify(base)}`);
  }
});
