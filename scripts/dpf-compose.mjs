#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import { validateComposeSafety } from "./lib/compose-safety.mjs";

const args = process.argv.slice(2);
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
