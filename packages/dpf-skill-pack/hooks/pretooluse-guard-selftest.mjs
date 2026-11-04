#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/pretooluse-guard-selftest.mjs
//
// SessionStart self-test for the PreToolUse guard plane (BI-E5C45F61).
//
// Every deny guard fails OPEN on error, and a Claude host that rejects a hook's
// output logs only a non-blocking error the operator never sees. In the desktop
// app 2.31226.1 every deny was discarded that way for days, with nothing said.
// This check makes the plane's state visible at session start:
//
//   1. Probes: a harmless input each guard must deny, piped through the guard
//      next to this file. The verdict must meet the Claude contract
//      (lib/claude-hook-contract.mjs), not merely say "deny".
//   2. Declared commands: each PreToolUse command in the plugin hooks.json and
//      the project settings must resolve (its ${VAR} set, its script present).
//      An unresolved command crashes at tool time, and the host lets the tool run.
//
// Silent when healthy. When not, prints "PreToolUse guards inactive in this
// session" with each failure. It cannot see what the host does at tool time,
// so the server-side controls stay the backstop (BI-271B8EEC Direction 2).
// Never blocks session start: exit 0 always.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeDenyProblem } from "./lib/claude-hook-contract.mjs";
import { inDpfWorkspace } from "./lib/hook-io.mjs";
import { makeFixtureWorkspace, walkHookOutputs, formatWalkProblems } from "./lib/hook-output-walk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_TIMEOUT_MS = 5_000;

const ask = (question) => ({
  tool_name: "AskUserQuestion",
  tool_input: {
    questions: [{ question, header: "Probe", options: [{ label: "Server-side plane" }, { label: "Harness hook only" }] }],
  },
});

/** One harmless input per guard that the guard must deny. None of them is executed. */
export const PROBES = [
  { guard: "compose-guard.mjs", payload: { tool_name: "Bash", tool_input: { command: "docker compose up --help" } } },
  { guard: "raw-tool-guard.mjs", payload: { tool_name: "Bash", tool_input: { command: "npx tsc --noEmit" } } },
  {
    guard: "lease-punt-guard.mjs",
    payload: { tool_name: "Bash", tool_input: { command: ["npx", "prisma", "migrate", "dev"].join(" ") } },
    env: { DATABASE_URL: "" },
  },
  { guard: "decision-routing-guard.mjs", payload: ask("Which architecture approach should BI-E5C45F61 build first?") },
];

// Operator bypasses would make a probe pass for the wrong reason; the probe tests the plumbing.
function probeEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("DPF_ALLOW_") || key.startsWith("DPF_GUARDS_") || key === "COMPOSE_PROJECT_NAME") delete env[key];
  }
  return { ...env, DPF_GUARDS_WORKSPACE_ANY: "1", ...extra };
}

/**
 * Pipe each probe through its guard; one line per guard that would not deny on a Claude host.
 * @param {{ hooksDir: string, cwd: string, probes?: typeof PROBES }} opts
 * @returns {string[]}
 */
export function runProbes({ hooksDir, cwd, probes = PROBES }) {
  const problems = [];
  for (const probe of probes) {
    const script = join(hooksDir, probe.guard);
    if (!existsSync(script)) {
      problems.push(`${probe.guard}: script missing at ${script}`);
      continue;
    }
    let stdout;
    try {
      stdout = execFileSync(process.execPath, [script], {
        input: JSON.stringify({ hook_event_name: "PreToolUse", cwd, ...probe.payload }),
        env: probeEnv(probe.env),
        encoding: "utf8",
        timeout: PROBE_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      const why = err?.code === "ETIMEDOUT" ? "timed out" : `exited ${err?.status ?? "abnormally"}`;
      const detail = String(err?.stderr ?? "").trim().split("\n").find(Boolean) ?? "";
      problems.push(`${probe.guard}: ${why}${detail ? ` (${detail})` : ""}, so the host lets the tool run`);
      continue;
    }
    const problem = claudeDenyProblem(stdout);
    if (problem) problems.push(`${probe.guard}: ${problem}`);
  }
  return problems;
}

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const SCRIPT_RE = /\bnode\s+("([^"]+)"|'([^']+)'|(\S+))/;

/**
 * Every PreToolUse command in a hooks config that cannot run as declared.
 * @param {any} config hooks.json or settings.json content
 * @param {Record<string, string|undefined>} vars the variables the host expands
 * @param {string} source label for the report
 * @returns {string[]}
 */
export function declaredCommandProblems(config, vars, source) {
  const problems = [];
  const groups = config?.hooks?.PreToolUse;
  if (!Array.isArray(groups)) return problems;
  for (const group of groups) {
    for (const hook of group?.hooks ?? []) {
      if (hook?.type !== "command" || typeof hook.command !== "string") continue;
      const unset = [...hook.command.matchAll(VAR_RE)].map((m) => m[1]).filter((name) => !vars[name]);
      if (unset.length) {
        problems.push(`${source}: ${[...new Set(unset)].join(", ")} is not set, so "${hook.command}" cannot run`);
        continue;
      }
      const expanded = hook.command.replace(VAR_RE, (_, name) => vars[name]);
      const m = expanded.match(SCRIPT_RE);
      const script = m && (m[2] ?? m[3] ?? m[4]);
      if (script && !existsSync(script)) problems.push(`${source}: ${script} is missing, so its guard cannot run`);
    }
  }
  return problems;
}

/**
 * 3. Output contract (BI-5DD46FDA): every tool hook in the INSTALLED hooks.json,
 * run on fixture calls shaped as Claude and as Codex send them, must emit
 * output that client honours. A rejected output is a block the client skips.
 * Same walk as hook-output-contract.test.mjs, narrowed to tool events and one
 * trigger per guard so it fits in session start.
 * @param {{ pluginRoot: string, hooksDir: string }} opts
 * @returns {Promise<string[]>}
 */
export async function installedOutputProblems({ pluginRoot, hooksDir, cacheFile }) {
  const hooksJson = readJson(join(pluginRoot, "hooks", "hooks.json"));
  const planes = readJson(join(hooksDir, "client-hook-planes.json"));
  if (!hooksJson || !planes) return [`hooks.json or client-hook-planes.json is unreadable under ${pluginRoot}, so no hook output could be checked`];
  // The installed copy changes only on update, so the walk's verdict is kept per
  // content hash of the hook files; a session start re-walks only after a change.
  const key = cacheFile ? hookFilesHash(pluginRoot, hooksDir) : null;
  const cached = key ? readJson(cacheFile) : null;
  if (cached?.key === key && Array.isArray(cached.problems)) return cached.problems;
  const problems = await walkInstalled({ hooksJson, planes, pluginRoot, hooksDir });
  if (key) {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ key, checkedAt: new Date().toISOString(), problems }));
    } catch {
      // an unwritable cache only costs the next session another walk
    }
  }
  return problems;
}

/** sha256 over every hook script and config the walk reads. */
export function hookFilesHash(pluginRoot, hooksDir) {
  const hash = createHash("sha256");
  const files = [join(pluginRoot, "hooks", "hooks.json")];
  for (const dir of [hooksDir, join(hooksDir, "lib")]) {
    try {
      for (const name of readdirSync(dir).sort()) if (/\.(mjs|json)$/.test(name)) files.push(join(dir, name));
    } catch {
      // a missing lib dir hashes as absent
    }
  }
  for (const file of files) {
    hash.update(file.slice(pluginRoot.length));
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update("\u0000missing");
    }
  }
  return hash.digest("hex");
}

async function walkInstalled({ hooksJson, planes, pluginRoot, hooksDir }) {
  const fixture = makeFixtureWorkspace();
  try {
    const results = await walkHookOutputs({
      hooksJson,
      planes,
      hooksDir,
      pluginRoot,
      clients: ["claude-code", "codex"],
      ws: fixture.ws,
      root: fixture.root,
      home: fixture.home,
      events: ["PreToolUse", "PostToolUse"],
      small: true,
      timeoutMs: PROBE_TIMEOUT_MS * 2,
      concurrency: 12,
    });
    return formatWalkProblems(results);
  } finally {
    fixture.cleanup();
  }
}

/**
 * @param {string[]} problems guards that cannot run or deny
 * @param {string[]} [outputProblems] hook outputs a client would reject
 */
export function formatNotice(problems, outputProblems = []) {
  if (!problems.length && !outputProblems.length) return "";
  const repair =
    "The server-side controls still apply. Repair: run python3 packages/dpf-skill-pack/scripts/update_agent_toolchain.py, then restart the client. Cause and probes: docs/install/platform-support-watchlist.md (BI-E5C45F61, BI-5DD46FDA).";
  const lines = [];
  if (problems.length) {
    lines.push("PreToolUse guards inactive in this session: a guard that cannot run or answer fails OPEN, so the tool call runs unguarded.", ...problems.map((p) => `  - ${p}`));
  }
  if (outputProblems.length) {
    lines.push("Installed hooks emit output the client would ignore: a rejected output is a block that never happens.", ...outputProblems.map((p) => `  - ${p}`));
  }
  return [...lines, repair].join("\n");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  if (process.env.DPF_HOOK_OUTPUT_WALK === "1") return; // run by a walk: do not walk again
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  const cwd = projectDir || process.cwd();
  if (!inDpfWorkspace(cwd)) return;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || resolve(HERE, "..");
  const vars = { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot };
  const problems = runProbes({ hooksDir: HERE, cwd });
  problems.push(...declaredCommandProblems(readJson(join(pluginRoot, "hooks", "hooks.json")), vars, "plugin hooks.json"));
  for (const name of ["settings.json", "settings.local.json"]) {
    const file = join(cwd, ".claude", name);
    if (existsSync(file)) problems.push(...declaredCommandProblems(readJson(file), vars, `.claude/${name}`));
  }
  let outputProblems = [];
  try {
    const cacheFile = join(homedir(), ".dpf", "hook-output-contract-selftest.json");
    outputProblems = await installedOutputProblems({ pluginRoot, hooksDir: HERE, cacheFile });
  } catch (err) {
    outputProblems = [`the output-contract walk could not run (${String(err?.message ?? err).split("\n")[0]}), so no hook output was checked`];
  }
  const notice = formatNotice(problems, outputProblems);
  if (notice) process.stdout.write(`${notice}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .catch(() => {
      // never block session start
    })
    .finally(() => process.exit(0));
}
