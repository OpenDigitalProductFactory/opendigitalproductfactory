#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const separatorIndex = process.argv.indexOf("--");
if (separatorIndex < 0 || separatorIndex === process.argv.length - 1) {
  console.error("Usage: node scripts/run-with-node-options.mjs <node-options...> -- <command> [args...]");
  process.exit(2);
}

const nodeOptions = process.argv.slice(2, separatorIndex).join(" ");
const [command, ...args] = process.argv.slice(separatorIndex + 1);
const existing = process.env.NODE_OPTIONS?.trim();
const env = {
  ...process.env,
  NODE_OPTIONS: [existing, nodeOptions].filter(Boolean).join(" "),
};

const result = spawnSync(command, args, {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
