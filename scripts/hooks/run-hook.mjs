#!/usr/bin/env node
// scripts/hooks/run-hook.mjs
//
// Portable Claude Code hook launcher.
//
// Node is the only runtime guaranteed present across Windows/macOS/Linux for
// Claude Code: the default hook shell is PowerShell on Windows and `sh -c` on
// Unix, and Claude Code does NOT bundle Git Bash -- so a committed hook that
// invokes a `.sh` directly would silently no-op on Windows. Routing every
// cross-platform hook through this single Node entry point sidesteps that: it
// dispatches to the OS-appropriate sibling script.
//
// Usage (from .claude/settings.json):
//   node "${CLAUDE_PROJECT_DIR}/scripts/hooks/run-hook.mjs" <script-base>
// where <script-base> is a path under scripts/ WITHOUT extension, e.g.
//   safety/transcript-snapshot  ->  scripts/safety/transcript-snapshot.{ps1,sh}
//
// Stdin contract (BI-BDA89375):
//   The launcher owns stdin forwarding and child lifetime. It reads the hook
//   payload once, spawns the OS target with an explicit stdin pipe, writes and
//   ends the pipe, then enforces a short bounded timeout. Children never
//   inherit the long-lived Claude Code stdin (which previously left
//   PowerShell `[Console]::In.ReadToEnd()` hung for tens of minutes).
//
// Stdout/stderr still inherit so WorktreeCreate-style hooks can print a path.
//
// This launcher NEVER blocks the triggering action: a missing target script,
// a spawn error, a non-zero child exit, or a timeout all resolve to exit 0.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Conservative default: enough for a transcript copy, short enough to protect host process pressure. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * @returns {Promise<Buffer>}
 */
function readStdinOnce() {
  return new Promise((resolveBuf) => {
    // No piped payload (interactive shell / empty) -> empty buffer.
    if (process.stdin.isTTY) {
      resolveBuf(Buffer.alloc(0));
      return;
    }

    /** @type {Buffer[]} */
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveBuf(Buffer.concat(chunks));
    };

    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    // Safety: if stdin never ends, still unblock the launcher promptly.
    // Hook payloads are small JSON; multi-second stall means a stuck parent.
    setTimeout(finish, 2_000).unref?.();
  });
}

/**
 * Terminate the exact child process tree cross-platform.
 * @param {number | undefined} pid
 */
function killChildTree(pid) {
  if (!pid || !Number.isFinite(pid)) return;

  if (process.platform === "win32") {
    // /T kills the tree; /F forces. Best-effort — never throw from a hook.
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already exited
  }
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
function resolveTimeoutMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  // Cap at 5 minutes so a misconfigured env var cannot reintroduce the leak.
  return Math.min(Math.floor(n), 5 * 60_000);
}

async function main() {
  const base = process.argv[2];
  // No hook named, or a traversal attempt -> no-op.
  if (!base || base.includes("..")) process.exit(0);

  // Repo root: prefer Claude Code's per-invocation env var; fall back to this
  // file's location (scripts/hooks/run-hook.mjs -> repo root is two dirs up).
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = process.env.CLAUDE_PROJECT_DIR
    ? resolve(process.env.CLAUDE_PROJECT_DIR)
    : resolve(here, "..", "..");

  const isWindows = process.platform === "win32";
  const target = join(repoRoot, "scripts", `${base}${isWindows ? ".ps1" : ".sh"}`);

  // No OS-appropriate script for this hook on this platform -> no-op.
  if (!existsSync(target)) process.exit(0);

  const payload = await readStdinOnce();
  const timeoutMs = resolveTimeoutMs(process.env.DPF_HOOK_TIMEOUT_MS);

  const [cmd, args] = isWindows
    ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", target]]
    : ["sh", [target]];

  const child = spawn(cmd, args, {
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
  });

  let settled = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    process.exit(0);
  };

  child.on("error", finish);
  child.on("exit", finish);

  timer = setTimeout(() => {
    killChildTree(child.pid);
    // Brief grace so the kill can land before we force-exit.
    setTimeout(finish, 150);
  }, timeoutMs);

  if (child.stdin) {
    child.stdin.on("error", () => {
      // EPIPE when child exits before write completes — ignore.
    });
    if (payload.length > 0) {
      child.stdin.write(payload);
    }
    child.stdin.end();
  }
}

main().catch(() => process.exit(0));
