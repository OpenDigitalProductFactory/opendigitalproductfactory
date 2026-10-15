// One-time bridge for macOS/Linux autostart launch scripts written before
// BI-084F85E5.
//
// Those scripts live in ~/.dpf, outside the install directory, so a self-upgrade
// can never replace them, and they hold the whole start sequence inline. The one
// piece of shipped, upgrade-refreshed code they run at boot is the compose-profile
// resolver (`--migrate --write`). When the resolver finds that its parent process
// IS such a launch script, it calls bridgeAutostartFromParent, which:
//   1. rewrites the launch script atomically (new file, then rename, so the bash
//      already running it keeps its own descriptor) into the thin pointer that
//      install-dpf.sh now writes, keeping the recorded compose chain;
//   2. starts the shipped entrypoint once in --converge-only mode, detached, so
//      this boot also converges the host instead of waiting for the next one.
// Any other caller (the promoter, state helpers, installers, the new entrypoint
// itself) never matches, and every failure is swallowed: the resolver's own
// output and exit status are never affected.

import { spawn, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LAUNCHER = /(?:^|[\s/])dpf-autostart\.sh(?:\s|$)/;
const POINTER = "scripts/installer/dpf-start.consumer.sh";

export function isAutostartLauncher(commandLine) {
  return typeof commandLine === "string" && LAUNCHER.test(commandLine);
}

// The launch script path is the argument of the parent command that names it.
export function launcherPathFrom(commandLine) {
  return commandLine.split(/\s+/).find((part) => part.endsWith("/dpf-autostart.sh")) ?? null;
}

// Returns the pointer script for an inline launch script, or null when the text
// is already a pointer or does not have the recognised shape.
export function bridgedLaunchScript(text) {
  if (typeof text !== "string" || text.includes(POINTER)) return null;
  const install = text.match(/^cd "([^"]+)"$/m)?.[1];
  const state = text.match(/--state "([^"]+)"/)?.[1];
  const chain = text.match(/^exec docker compose (.+) up -d$/m)?.[1]?.trim();
  if (!install || !state || !chain) return null;
  return [
    "#!/usr/bin/env bash",
    `# Rewritten on ${new Date().toISOString()} by the BI-084F85E5 autostart bridge.`,
    "# Invoked by the platform-native autostart unit. Don't edit by hand;",
    "# re-run install-dpf.sh to regenerate. The start logic is the shipped",
    `# ${POINTER} (BI-084F85E5).`,
    `exec /bin/bash "${install}/${POINTER}" "${install}" "${state}" ${chain}`,
    "",
  ].join("\n");
}

export function parentCommandLine(ppid = process.ppid, platform = process.platform) {
  if (platform === "linux") {
    return readFileSync(`/proc/${ppid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
  }
  if (platform === "darwin") {
    return execFileSync("ps", ["-o", "command=", "-p", String(ppid)], { encoding: "utf8" }).trim();
  }
  return "";
}

export function bridgeAutostartFromParent({ commandLine, spawnConverge = true } = {}) {
  try {
    const parent = commandLine ?? parentCommandLine();
    if (!isAutostartLauncher(parent)) return "not-launcher";
    const launcher = launcherPathFrom(parent);
    if (!launcher || !existsSync(launcher)) return "launcher-missing";
    const current = readFileSync(launcher, "utf8");
    const pointer = bridgedLaunchScript(current);
    if (!pointer) return "already-bridged";
    const temporary = join(dirname(launcher), `.dpf-autostart.sh.${process.pid}.tmp`);
    writeFileSync(temporary, pointer);
    chmodSync(temporary, 0o755);
    renameSync(temporary, launcher);
    const install = current.match(/^cd "([^"]+)"$/m)[1];
    const state = current.match(/--state "([^"]+)"/)[1];
    const entrypoint = join(install, POINTER);
    if (spawnConverge && existsSync(entrypoint)) {
      const logDir = join(dirname(launcher), "logs");
      mkdirSync(logDir, { recursive: true });
      const log = openSync(join(logDir, "dpf-autostart.log"), "a");
      spawn("/bin/bash", [entrypoint, install, state, "--converge-only"], {
        cwd: install,
        detached: true,
        stdio: ["ignore", log, log],
      }).unref();
    }
    return "bridged";
  } catch {
    return "failed";
  }
}
