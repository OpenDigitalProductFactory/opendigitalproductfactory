#!/usr/bin/env node
// Self-upgrade step: bridge a macOS/Linux autostart launch script to the
// shipped start entrypoint (BI-084F85E5, BI-EEFDB9E8).
//
// install-dpf.sh writes ~/.dpf/dpf-autostart.sh (or $XDG_STATE_HOME/dpf/...)
// once, outside the install directory, so no release-asset install can replace
// it, and every launch script before this one holds the whole start sequence
// inline; scripts generated before 2026-07-18 run nothing but
// `docker compose up -d`. The promoter mounts that state directory on every
// self-upgrade (promoter.ts, /dpf-state), so promote.sh runs this step after
// the release assets are committed: an inline launch script is rewritten,
// atomically, into the one-line pointer install-dpf.sh now writes. The next
// boot or login runs the shipped scripts/installer/dpf-start.consumer.sh, which
// converges the host. It keeps the recorded install path and compose chain,
// and works for every launch script generation.
//
// promote.sh runs it from the install root rather than from the promoter
// image: an older portal stages the promoter's build context from its own file
// list, so a file new in this release is absent from the promoter on the first
// upgrade that carries it, but the verified release assets are present.
//
// No launch script (Windows, or an operator who chose --no-autostart), a
// script that is already a pointer, an operator's own script, or an install
// without the shipped entrypoint are all left untouched. It never fails the
// upgrade: the status is printed and the exit code is 0.

import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { scriptArgv } from "../lib/script-argv.mjs";

export const POINTER = "scripts/installer/dpf-start.consumer.sh";
export const LAUNCH_SCRIPT = "dpf-autostart.sh";

// The pointer for an inline launch script, or null when the text is already a
// pointer or lacks the shape install-dpf.sh has generated since 2026-05:
// `cd "<install>"` and `exec docker compose <chain> up -d`.
export function bridgedLaunchScript(text) {
  if (typeof text !== "string" || text.includes(POINTER)) return null;
  const install = text.match(/^cd "([^"]+)"$/m)?.[1];
  const chain = text.match(/^exec docker compose (.+) up -d$/m)?.[1]?.trim();
  if (!install || !chain) return null;
  return {
    install,
    script: [
      "#!/usr/bin/env bash",
      `# Rewritten on ${new Date().toISOString()} by the self-upgrade (BI-084F85E5).`,
      "# Invoked by the platform-native autostart unit. Don't edit by hand;",
      "# re-run install-dpf.sh to regenerate. The start logic is the shipped",
      `# ${POINTER}; install-state.json sits beside this script.`,
      `exec /bin/bash "${install}/${POINTER}" "${install}" "$(cd "$(dirname "$0")" && pwd)/install-state.json" ${chain}`,
      "",
    ].join("\n"),
  };
}

// stateDir and installRoot are the promoter's container paths; the script it
// writes names host paths, which it takes from the launch script itself.
export function bridgeAutostartLaunchScript({ stateDir, installRoot }) {
  try {
    if (!stateDir) return "no-state-dir";
    const launcher = join(stateDir, LAUNCH_SCRIPT);
    if (!existsSync(launcher)) return "no-launch-script";
    const bridged = bridgedLaunchScript(readFileSync(launcher, "utf8"));
    if (!bridged) return "unchanged";
    if (!installRoot || !existsSync(join(installRoot, POINTER))) return "entrypoint-missing";
    const temporary = join(stateDir, `.${LAUNCH_SCRIPT}.${process.pid}.tmp`);
    writeFileSync(temporary, bridged.script);
    chmodSync(temporary, 0o755);
    renameSync(temporary, launcher);
    return "bridged";
  } catch (error) {
    return `failed:${error instanceof Error ? error.message : String(error)}`;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    args: scriptArgv(),
    options: { "state-dir": { type: "string" }, "install-root": { type: "string" } },
    strict: false,
  });
  const status = bridgeAutostartLaunchScript({
    stateDir: typeof values["state-dir"] === "string" ? values["state-dir"] : undefined,
    installRoot: typeof values["install-root"] === "string" ? values["install-root"] : undefined,
  });
  process.stdout.write(`step=autostart-bridge status=${status}\n`);
}
