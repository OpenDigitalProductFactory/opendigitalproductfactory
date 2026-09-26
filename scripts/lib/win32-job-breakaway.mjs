// BI-27A37D27. On Windows a process spawned by node — `detached: true` or not —
// stays inside its parent's JOB OBJECT. The Claude Code desktop client runs its
// whole tree in one job, so when a session closed, every durable-wait resumer it
// had started died with it: the queue row stopped heartbeating and lapsed while
// pregate:status went on saying "queued" for hours. Measured 2026-09-26 with
// kernel32 IsProcessInJob: the live resumer and claude.exe were IN-JOB; a process
// created through WMI Win32_Process.Create (parent WmiPrvSE) was in no job and
// kept running after its launching shell exited.
//
// So on Windows the resumer is started through WMI. WMI takes a single command
// line and gives the new process its own environment, so the exact command,
// arguments, cwd and environment travel in a launch spec written to a private
// temp directory. This file, run as the WMI-created launcher, reads the spec,
// deletes it (it holds the session's credentials), and starts the real resumer
// as its own detached child — also outside the caller's job.
//
// If WMI is unavailable the launch falls back to the in-job spawn and says the
// waiter is session-bound, so the gate reports honestly rather than promising a
// wait that will not survive.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as utilParseArgs } from "node:util";

import { isEntryModule } from "./entry-module.mjs";

const LAUNCHER_PATH = fileURLToPath(import.meta.url);

// Win32_ProcessStartup.ShowWindow = SW_HIDE: a background waiter never opens a
// window (BI-69178E02). Command and cwd arrive by environment so no quoting of
// user paths ever reaches the PowerShell parser.
const CREATE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
  "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:DPF_BREAKAWAY_CMD; CurrentDirectory = $env:DPF_BREAKAWAY_CWD; ProcessStartupInformation = $s }",
  "Write-Output (\"{0} {1}\" -f $r.ReturnValue, $r.ProcessId)",
].join("; ");

/**
 * spawn()-compatible: `(command, args, options)` → a child-like `{ pid, unref }`
 * that also reports `via` and `sessionBound`.
 */
export function spawnOutsideCallerJob(command, args, options = {}, deps = {}) {
  const {
    execFileSyncImpl = execFileSync,
    nodeSpawn = spawn,
    nodePath = process.execPath,
    launcherPath = LAUNCHER_PATH,
    stateDirectory = mkdtempSync(join(tmpdir(), "dpf-resumer-launch-")),
  } = deps;
  const specPath = join(stateDirectory, "launch.json");
  const inJobFallback = (reason) => {
    try { rmSync(stateDirectory, { recursive: true, force: true }); } catch { /* best effort */ }
    const child = nodeSpawn(command, args, { ...options, detached: true, stdio: "ignore", windowsHide: true });
    child.via = "detached";
    child.sessionBound = true;
    child.breakawayError = reason;
    return child;
  };
  try {
    writeFileSync(specPath, JSON.stringify({
      command,
      args,
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
    }), { encoding: "utf8", mode: 0o600 });
    const stdout = String(execFileSyncImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", CREATE_SCRIPT], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      env: {
        ...process.env,
        DPF_BREAKAWAY_SPEC: specPath,
        DPF_BREAKAWAY_CMD: `"${nodePath}" "${launcherPath}" "${specPath}"`,
        DPF_BREAKAWAY_CWD: options.cwd ?? process.cwd(),
      },
    })).trim();
    const [returnValue, pid] = stdout.split(/\s+/).map(Number);
    if (returnValue !== 0 || !Number.isInteger(pid) || pid <= 0) {
      return inJobFallback(`Win32_Process.Create returned ${stdout || "nothing"}`);
    }
    return { pid, unref() {}, via: "wmi-breakaway", sessionBound: false };
  } catch (error) {
    return inJobFallback(error?.message || String(error));
  }
}

/** The WMI-created launcher: consume the spec, start the resumer, exit. */
export function runBreakawayLaunch(specPath, { spawnImpl = spawn } = {}) {
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  // The spec carries the session environment, credentials included.
  rmSync(specPath, { force: true });
  try { rmSync(dirname(specPath), { recursive: true, force: true }); } catch { /* not ours to keep */ }
  const child = spawnImpl(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  if (typeof child?.unref === "function") child.unref();
  return child;
}

if (isEntryModule(import.meta.url)) {
  const { positionals: [specPath] } = utilParseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true });
  runBreakawayLaunch(specPath);
}
