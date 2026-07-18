#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";

import { validateComposeSafety } from "./lib/compose-safety.mjs";
import { governCapabilityComposeEnvironment } from "./lib/govern-capability-compose-args.mjs";
import { canonicalizeComposeFileArgs, resolveComposeInstallContext, resolveDpfStatePath } from "./lib/resolve-compose-install-context.mjs";

let args = process.argv.slice(2);
let capabilityProjection = { runtimeProfiles: [] };
let composeContext;
try {
  composeContext = resolveComposeInstallContext({ args, cwd: process.cwd(), env: process.env });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const { projectRoot, composeFiles } = composeContext;
const statePath = resolveDpfStatePath({ env: process.env, home: homedir() });
if (existsSync(statePath)) {
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    console.error("capability_install_state_invalid");
    process.exit(2);
  }
  if (state.installPath && resolve(state.installPath) !== projectRoot) {
    console.error("capability_install_state_mismatch");
    process.exit(2);
  }
  if (state.installPath) {
    const host = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
    const adapter = resolve(projectRoot, "scripts/lib/resolve-capability-compose-profiles.mjs");
    const projection = spawnSync(process.execPath, [adapter, "--state", statePath, "--host", host, "--migrate", "--write"], { encoding: "utf8" });
    if (projection.status !== 0) {
      process.stderr.write(projection.stderr);
      process.exit(projection.status ?? 2);
    }
    capabilityProjection = JSON.parse(projection.stdout);
  }
}
const childEnv = { ...process.env };
try {
  const governed = governCapabilityComposeEnvironment({ args, projection: capabilityProjection, composeProfiles: process.env.COMPOSE_PROFILES });
  args = canonicalizeComposeFileArgs({ args: governed.args, composeFiles });
  childEnv.COMPOSE_PROFILES = governed.composeProfiles.join(",");
  childEnv.COMPOSE_FILE = composeFiles.join(delimiter);
  childEnv.COMPOSE_PATH_SEPARATOR = delimiter;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const result = validateComposeSafety({ args, env: childEnv });

if (!result.ok) {
  console.error("[dpf-compose] Refusing unsafe docker compose command.");
  for (const error of result.errors) {
    console.error(`[dpf-compose] ${error}`);
  }
  console.error(`[dpf-compose] Resolved project: ${result.projectName || "(empty)"}`);
  process.exit(2);
}

const child = spawnSync(process.env.DPF_DOCKER_BIN || "docker", ["compose", ...args], {
  stdio: "inherit",
  env: childEnv,
});

if (child.error) {
  console.error(`[dpf-compose] Failed to start docker compose: ${child.error.message}`);
  process.exit(1);
}

process.exit(child.status ?? 1);
