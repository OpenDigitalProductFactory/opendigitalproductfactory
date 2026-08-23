#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/guard-liveness-probe.mjs
//
// Prove that a guard actually DENIES on this surface (BI-E8E7FCDF).
//
// WHY
// guard_liveness_advisory() in the updater is static prose. It says
// "live-probed" but probes nothing at runtime, so its claims can go stale and
// nobody would know — presence-not-liveness applied to the guard plane itself.
// Worse, on Codex every guard is silently fail-open until a human clicks "Trust
// all" in an interactive TUI (openai/codex#21615), and installation still
// reports success. A surface can therefore look governed while enforcing
// nothing.
//
// WHAT THIS DOES
// Spawns each guard with a payload that MUST be denied and checks for a deny
// envelope. A guard that allows the payload is reported NOT-ENFORCING. A guard
// with no probe defined is reported UNPROBED and is never counted as passing —
// honest degradation beats a false green.
//
// This proves the guard binary denies when executed. It cannot prove the HOST
// executes it; that is the Codex trust gap, which no local probe can close and
// which is reported separately rather than assumed.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A DPF-shaped tree that no workroom claims, for guards that need a workspace. */
function unclaimedTree() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-probe-"));
  writeFileSync(join(dir, ".git"), "gitdir: /elsewhere\n");
  return dir;
}

/**
 * Each probe is a payload the guard is REQUIRED to deny.
 * Add a probe when you add a guard; an unprobed guard is reported, not assumed.
 */
export const PROBES = [
  {
    script: "root-clone-guard.mjs",
    what: "destructive rm aimed at the root clone",
    payload: { tool_name: "Bash", tool_input: { command: "rm -rf /Users/markbodman/dpf/apps" } },
  },
  {
    script: "compose-guard.mjs",
    what: "docker compose down that tears down shared services",
    payload: { tool_name: "Bash", tool_input: { command: "docker compose down --volumes" } },
  },
  {
    script: "workroom-claim-guard.mjs",
    what: "file write in a worktree no workroom claims",
    payload: { tool_name: "Write", tool_input: { file_path: "x.ts", content: "y" } },
    cwd: unclaimedTree,
  },
];

function isDeny(stdout) {
  if (!stdout || !stdout.trim()) return false;
  try {
    const o = JSON.parse(stdout);
    return o?.decision === "deny" || o?.hookSpecificOutput?.permissionDecision === "deny";
  } catch {
    return false;
  }
}

/** Probe one guard. Returns { script, what, verdict, detail }. */
export function probeGuard(probe, { hooksDir = here, env = {} } = {}) {
  const script = join(hooksDir, probe.script);
  if (!existsSync(script)) return { script: probe.script, what: probe.what, verdict: "missing", detail: "script not on disk" };

  const cwd = typeof probe.cwd === "function" ? probe.cwd() : probe.cwd || hooksDir;
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(probe.payload),
    encoding: "utf8",
    cwd,
    timeout: 20_000,
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", ...env },
  });

  if (r.error) return { script: probe.script, what: probe.what, verdict: "error", detail: String(r.error.message) };
  if (isDeny(r.stdout)) return { script: probe.script, what: probe.what, verdict: "deny-proven", detail: "" };
  return {
    script: probe.script,
    what: probe.what,
    verdict: "NOT-ENFORCING",
    detail: "the guard allowed a payload it is required to deny",
  };
}

/** Every wired PreToolUse guard, so an unprobed one is visible rather than silent. */
function wiredGuards(hooksDir) {
  try {
    const cfg = JSON.parse(spawnSync("cat", [join(hooksDir, "hooks.json")], { encoding: "utf8" }).stdout);
    const pre = (cfg.hooks ?? cfg).PreToolUse ?? [];
    const names = new Set();
    for (const e of pre) for (const h of e.hooks ?? []) {
      const m = /([a-z0-9-]+\.mjs)/.exec(h.command ?? "");
      if (m) names.add(m[1]);
    }
    return [...names];
  } catch {
    return [];
  }
}

export function runAllProbes({ hooksDir = here } = {}) {
  const results = PROBES.map((p) => probeGuard(p, { hooksDir }));
  const probed = new Set(results.map((r) => r.script));
  for (const g of wiredGuards(hooksDir)) {
    if (!probed.has(g)) results.push({ script: g, what: "(no probe defined)", verdict: "UNPROBED", detail: "enforcement not proven" });
  }
  return results;
}

export function formatProbeReport(results) {
  const lines = ["GUARD LIVENESS — does each guard actually DENY on this surface?"];
  for (const r of results) {
    lines.push(`  ${r.verdict.padEnd(14)} ${r.script}${r.detail ? `  — ${r.detail}` : ""}`);
  }
  const proven = results.filter((r) => r.verdict === "deny-proven").length;
  const bad = results.filter((r) => r.verdict === "NOT-ENFORCING" || r.verdict === "error" || r.verdict === "missing");
  lines.push(`  ${proven} of ${results.length} proven to deny.`);
  if (bad.length) lines.push(`  ${bad.length} guard(s) are NOT enforcing — this surface is not governed for those checks.`);
  lines.push("  Note: this proves the guard denies when RUN. It cannot prove the host runs it —");
  lines.push("  on Codex every hook is fail-open until a human trusts it (openai/codex#21615).");
  return lines;
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("guard-liveness-probe.mjs")) {
  const results = runAllProbes();
  process.stdout.write(formatProbeReport(results).join("\n") + "\n");
  process.exit(results.some((r) => r.verdict === "NOT-ENFORCING") ? 1 : 0);
}
