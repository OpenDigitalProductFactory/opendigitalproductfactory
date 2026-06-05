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
// The hook's stdin JSON payload is forwarded to the target script unchanged
// (stdio: 'inherit'), and the target's stdout/stderr pass straight back to
// Claude Code (so e.g. a WorktreeCreate script can still print its path).
//
// This launcher NEVER blocks the triggering action: a missing target script,
// a spawn error, or a non-zero child exit all resolve to exit 0 -- matching
// the "exit 0 ALWAYS" contract of the snapshot scripts it fronts.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const [cmd, args] = isWindows
  ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", target]]
  : ["sh", [target]];

const child = spawn(cmd, args, { stdio: "inherit" });
child.on("error", () => process.exit(0));
child.on("exit", () => process.exit(0));
