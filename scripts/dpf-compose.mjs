#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { validateComposeSafety } from "./lib/compose-safety.mjs";
import { governCapabilityComposeArgs } from "./lib/govern-capability-compose-args.mjs";

let args = process.argv.slice(2);
let capabilityProfilesGoverned = false;
const statePath = process.env.DPF_INSTALL_STATE_PATH ?? resolve(process.env.DPF_STATE_DIR ?? resolve(homedir(), ".dpf"), "install-state.json");
if (existsSync(statePath)) {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const currentRoot = resolve(process.cwd());
  if (state.installPath && resolve(state.installPath) === currentRoot) {
    const host = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
    const adapter = resolve(currentRoot, "scripts/lib/resolve-capability-compose-profiles.mjs");
    const projection = spawnSync(process.execPath, [adapter, "--state", statePath, "--host", host, "--migrate", "--write"], { encoding: "utf8" });
    if (projection.status !== 0) {
      process.stderr.write(projection.stderr);
      process.exit(projection.status ?? 2);
    }
    try {
      args = governCapabilityComposeArgs({ args, projection: JSON.parse(projection.stdout) });
      capabilityProfilesGoverned = true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }
  }
}
if (!capabilityProfilesGoverned) {
  try {
    args = governCapabilityComposeArgs({ args, projection: { runtimeProfiles: [] } });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
const result = validateComposeSafety({ args, env: process.env });

if (!result.ok) {
  console.error("[dpf-compose] Refusing unsafe docker compose command.");
  for (const error of result.errors) {
    console.error(`[dpf-compose] ${error}`);
  }
  console.error(`[dpf-compose] Resolved project: ${result.projectName || "(empty)"}`);
  process.exit(2);
}

const child = spawnSync("docker", ["compose", ...args], {
  stdio: "inherit",
  env: process.env,
});

if (child.error) {
  console.error(`[dpf-compose] Failed to start docker compose: ${child.error.message}`);
  process.exit(1);
}

process.exit(child.status ?? 1);
