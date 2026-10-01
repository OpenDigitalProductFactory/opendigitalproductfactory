#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/install-folder-contract.mjs
//
// SessionStart (BI-77BE1389, WWMD DI-F11C21173A30). A session that opens in a
// DPF install folder (the installer's `.install-mode` marker, no checkout) never
// loads the source checkout's AGENTS.md: the install's own AGENTS.md says so and
// "nothing warns you that it is missing". Until now the only reminder was an
// agent's memory note, which is prose, not a control. This hook finds the source
// checkout beside the install and puts its contract, by path and section, into
// the session's context at start, every time.
//
// Emits nothing outside an install folder, and nothing inside a checkout (the
// harness loads the checkout's AGENTS.md itself there). Fails open.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const isCheckout = (dir) => existsSync(join(dir, "packages", "dpf-skill-pack")) && existsSync(join(dir, "AGENTS.md"));

/** The install folder at or above `cwd`, or null. */
export function findInstallFolder(cwd) {
  let dir = cwd;
  for (let i = 0; dir && i < 64; i++) {
    if (isCheckout(dir)) return null; // inside a checkout: not an install session
    if (existsSync(join(dir, ".install-mode"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The source checkout for an install: DPF_SOURCE_ROOT, then `<install>-source-root`, then a sibling checkout named after the install (<install>-*). */
export function findSourceCheckout(install, env = process.env) {
  const candidates = [];
  if (env.DPF_SOURCE_ROOT) candidates.push(env.DPF_SOURCE_ROOT);
  candidates.push(`${install}-source-root`);
  try {
    const parent = dirname(install);
    const siblings = readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== basename(install) && d.name.startsWith(`${basename(install)}-`))
      .map((d) => join(parent, d.name))
      .sort((a, b) => Number(/source-root$/.test(b)) - Number(/source-root$/.test(a)));
    candidates.push(...siblings);
  } catch {
    // unreadable parent: env and the conventional name are still tried
  }
  return candidates.find((dir) => isCheckout(dir)) ?? null;
}

export function contractContext(cwd, env = process.env) {
  const install = findInstallFolder(cwd);
  if (!install) return null;
  const source = findSourceCheckout(install, env);
  if (!source) {
    return `DPF install folder (${install}): no source checkout was found beside it (set DPF_SOURCE_ROOT). Source changes need a separate checkout and a governed worktree; do not edit this folder as source.`;
  }
  const contract = join(source, "AGENTS.md").replace(/\\/g, "/");
  let sections = "";
  try {
    sections = readFileSync(contract, "utf8").split(/\r?\n/).filter((l) => /^## /.test(l)).map((l) => l.slice(3)).join("; ");
  } catch {
    // the path alone is still the instruction
  }
  return [
    `This session opened in the DPF install folder (${install.replace(/\\/g, "/")}), so the harness did not load the source contract.`,
    `Before planning or editing any platform source, read ${contract} in full; it is the canonical operating contract for source work, and worktrees live beside ${source.replace(/\\/g, "/")}.`,
    sections ? `Its sections: ${sections}.` : "",
    "Process guards judge each action by the folder it targets, so they apply to worktree commands from this session.",
  ].filter(Boolean).join(" ");
}

function main() {
  let cwd = process.cwd();
  try {
    const raw = readFileSync(0, "utf8");
    const payload = raw ? JSON.parse(raw) : {};
    cwd = payload.cwd ?? payload.workspaceRoot ?? cwd;
  } catch {
    // no payload: use the process folder
  }
  let context = null;
  try {
    context = contractContext(cwd);
  } catch {
    return; // fail open
  }
  if (!context) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("install-folder-contract.mjs")) {
  main();
}
