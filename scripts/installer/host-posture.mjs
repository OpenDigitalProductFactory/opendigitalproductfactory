#!/usr/bin/env node
// Host posture snapshot (BI-3E2F87FA, WWMD DI-1984B00059B3).
//
// Run by dpf-start.consumer.sh on the host at sign-in. Reads, never changes, the
// settings that decide whether a Mac keeps serving the platform: whether it is on
// its power adapter, whether it sleeps while on power, and whether Docker Desktop
// starts when someone signs in. Writes one small JSON file into the install
// directory (data/host/posture.json), which the portal reads through its
// /host-dpf mount and shows on the installation page with plain fix steps
// (apps/web/lib/install/host-posture.ts holds the reader and the checks).
//
// Usage: node scripts/installer/host-posture.mjs <install-dir> [--platform macos|linux|windows]
// Never fails startup: every read is best-effort and an unknown value is null.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { scriptArgv } from "../lib/script-argv.mjs";

export const HOST_POSTURE_RELATIVE_PATH = join("data", "host", "posture.json");

/** `pmset -g batt` → power source and whether a battery is present. */
export function parsePmsetBattery(text) {
  if (typeof text !== "string" || text.trim() === "") return { powerSource: null, hasBattery: null };
  const source = /Now drawing from '([^']+)'/.exec(text)?.[1] ?? null;
  const powerSource = source === "AC Power" ? "ac" : source === "Battery Power" ? "battery" : null;
  const hasBattery = /InternalBattery/.test(text);
  return { powerSource, hasBattery };
}

/** `pmset -g custom` → the AC Power section's `sleep` minutes (0 = never), or null. */
export function parsePmsetAcSleep(text) {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  const isHeader = (line) => /^\S.*:\s*$/.test(line);
  const start = lines.findIndex((line) => /^AC Power:\s*$/.test(line));
  let body;
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex(isHeader);
    body = end >= 0 ? rest.slice(0, end) : rest;
  } else if (lines.some(isHeader)) {
    return null;
  } else {
    // A Mac with no battery may print its one profile without a section header.
    body = lines;
  }
  for (const line of body) {
    const match = /^\s*sleep\s+(\d+)\b/.exec(line);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

/** Docker Desktop's settings JSON → whether it starts at sign-in, or null. */
export function parseDockerAutoStart(text) {
  try {
    const value = JSON.parse(text);
    return typeof value?.AutoStart === "boolean" ? value.AutoStart : null;
  } catch {
    return null;
  }
}

function hostPlatform(name = platform()) {
  return name === "darwin" ? "macos" : name === "linux" ? "linux" : name === "win32" ? "windows" : "unknown";
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
  } catch {
    return "";
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Read the host and build the snapshot. `deps` lets tests replace the host. */
export function collectHostPosture(deps = {}) {
  const now = deps.now ?? (() => new Date());
  const name = hostPlatform(deps.platform);
  const snapshot = {
    schemaVersion: 1,
    observedAt: now().toISOString(),
    platform: name,
    hasBattery: null,
    powerSource: null,
    acSleepMinutes: null,
    dockerStartsAtLogin: null,
  };
  if (name !== "macos") return snapshot;
  const exec = deps.run ?? run;
  const read = deps.readText ?? readText;
  const home = deps.home ?? homedir();
  const battery = parsePmsetBattery(exec("pmset", ["-g", "batt"]));
  const docker = join(home, "Library", "Group Containers", "group.com.docker");
  return {
    ...snapshot,
    ...battery,
    acSleepMinutes: parsePmsetAcSleep(exec("pmset", ["-g", "custom"])),
    dockerStartsAtLogin: parseDockerAutoStart(read(join(docker, "settings-store.json"))) ?? parseDockerAutoStart(read(join(docker, "settings.json"))),
  };
}

/** Write atomically so the portal never reads half a file. */
export function writeHostPosture(installDir, snapshot) {
  const target = join(installDir, HOST_POSTURE_RELATIVE_PATH);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(temp, target);
  return target;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // The start script passes the platform it already detected with uname, so
  // the snapshot and the start script never disagree about the host.
  const { positionals, values } = parseArgs({
    args: scriptArgv(),
    allowPositionals: true,
    strict: false,
    options: { platform: { type: "string" } },
  });
  const installDir = positionals[0];
  const platformArg = { macos: "darwin", linux: "linux", windows: "win32" }[String(values.platform ?? "")];
  if (!installDir) {
    console.error("usage: host-posture.mjs <install-dir>");
    process.exit(0);
  }
  try {
    const path = writeHostPosture(installDir, collectHostPosture(platformArg ? { platform: platformArg } : {}));
    console.log(`Host posture: ${path}`);
  } catch (error) {
    console.error(`Host posture not recorded: ${error instanceof Error ? error.message : String(error)}`);
  }
}
