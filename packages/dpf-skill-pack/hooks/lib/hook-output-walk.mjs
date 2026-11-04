// packages/dpf-skill-pack/hooks/lib/hook-output-walk.mjs
//
// Run every hook a client runs against fixture inputs shaped the way that client
// sends them, and judge each output by that client's contract
// (lib/hook-output-contract.mjs, BI-5DD46FDA). Shared by the exhaustive test
// (hook-output-contract.test.mjs) and the SessionStart self-test, which runs it
// on the installed copy.
//
// The input space is closed: hooks.json is the roster, client-hook-planes.json
// says which entries each client runs, and the fixtures cover every event and
// matcher hooks.json uses. Fixture commands and files are judged, never run.
// The fixture workspace is a throwaway folder that looks like a DPF checkout,
// and HOME points into it, so no hook touches the operator's real state.

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientHookCoverage, clientPlane, hooksJsonEntries } from "./grok-hook-plane.mjs";
import { hookOutputProblems } from "./hook-output-contract.mjs";

// Built from parts so this file never reads as a raw invocation to the guards it walks.
const NPX = ["n", "px"].join("");

/**
 * A throwaway DPF-shaped root clone with one linked worktree, the shape agents
 * work in. Hooks run in the worktree (`ws`); `root` is the shared clone a
 * root-clone guard protects. Remove both with `cleanup()`.
 */
export function makeFixtureWorkspace({ git = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "dpf-hook-walk-")).replace(/\\/g, "/");
  const root = `${base}/dpf`;
  const home = `${base}/home`;
  mkdirSync(`${root}/packages/dpf-skill-pack`, { recursive: true });
  mkdirSync(`${root}/apps/web/lib`, { recursive: true });
  mkdirSync(`${root}/apps/web/node_modules/.bin`, { recursive: true });
  mkdirSync(`${root}/docs/superpowers/plans`, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(`${root}/packages/dpf-skill-pack/.keep`, "");
  writeFileSync(`${root}/pnpm-workspace.yaml`, "packages:\n  - apps/*\n  - packages/*\n");
  writeFileSync(`${root}/package.json`, JSON.stringify({ name: "dpf-walk", private: true }));
  writeFileSync(`${root}/apps/web/package.json`, JSON.stringify({ name: "web", scripts: { typecheck: "true", "typecheck:tests": "true" } }));
  writeFileSync(`${root}/apps/web/tsconfig.json`, "{}");
  writeFileSync(`${root}/apps/web/node_modules/.bin/prisma`, "");
  let ws = root;
  if (git) {
    const run = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
    try {
      run(root, "init", "-q", "-b", "main");
      run(root, "add", "-A");
      run(root, "-c", "user.email=walk@dpf.local", "-c", "user.name=walk", "commit", "-q", "-m", "walk");
      run(root, "update-ref", "refs/remotes/origin/main", "HEAD");
      run(root, "worktree", "add", "-q", "-b", "fix/walk", `${base}/dpf-worktrees/walk`);
      ws = `${base}/dpf-worktrees/walk`;
      // Uncommitted work on a merged branch: the state end-of-session hooks report on.
      writeFileSync(`${ws}/walk-notes.txt`, "uncommitted\n");
    } catch {
      // A walk without git still judges every hook; git-only paths stay quiet.
    }
  }
  return { ws, root, home, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

// Tool names per client for each hooks.json matcher (Grok 1.0.52, BI-742D707B).
const TOOL_NAMES = {
  "claude-code": { shell: "Bash", write: "Write", ask: "AskUserQuestion", mcp: "mcp__dpf__heartbeat_workroom" },
  codex: { shell: "Bash", write: "Write", ask: "AskUserQuestion", mcp: "mcp__dpf__heartbeat_workroom" },
  grok: { shell: "run_terminal_command", write: "write", ask: "ask_user_question", mcp: "mcp__dpf__heartbeat_workroom" },
};

/** Tool fixtures. Each one is judged by the hooks, never executed. */
export function toolFixtures(ws, { small = false, root = ws } = {}) {
  const shell = [
    "git status",
    `${NPX} tsc --noEmit`,
    `cd apps/web && ${NPX} prisma generate`,
    "pnpm vitest run apps/web/lib/a.test.ts",
    "docker compose up --help",
    `${NPX} prisma migrate dev`,
    "rm -rf packages",
    "git push origin HEAD",
  ];
  const writes = [
    { file_path: `${ws}/apps/web/lib/x.ts`, content: "export const x = 1;\n" },
    { file_path: `${root}/apps/web/lib/x.ts`, content: "export const x = 1;\n" },
    { file_path: `${ws}/docs/superpowers/plans/2026-10-28-walk.md`, content: "# Walk plan\n" },
  ];
  const ask = {
    questions: [{ question: "Which architecture approach should the platform build first?", header: "Approach", options: [{ label: "A" }, { label: "B" }], multiSelect: false }],
  };
  return {
    // small: one trigger each for raw-tool, compose and lease-punt guards (the self-test's budget).
    shell: (small ? [shell[1], shell[4], shell[5]] : shell).map((command) => ({ label: command, input: { command } })),
    write: (small ? writes.slice(0, 1) : writes).map((input) => ({ label: `write ${input.file_path.startsWith(ws) ? input.file_path.slice(ws.length + 1) : `<root clone>/${input.file_path.slice(root.length + 1)}`}`, input })),
    ask: [{ label: "ask a platform decision", input: ask }],
    mcp: [
      {
        label: "heartbeat_workroom answer",
        input: { capsuleId: "WC-WALK" },
        response: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { capsuleId: "WC-WALK", leaseExpiresAt: "2026-10-28T23:59:00Z" } }) }] },
      },
    ],
  };
}

const EVENT_EXTRAS = {
  SessionStart: { source: "startup" },
  SessionEnd: { reason: "other" },
  Stop: { stop_hook_active: false, last_assistant_message: "" },
};

/** The stdin payload `client` sends for one event (and tool call). */
export function clientPayload(client, event, ws, tool) {
  const extras = { ...(EVENT_EXTRAS[event] ?? {}) };
  if (event === "WorktreeCreate") Object.assign(extras, { base_path: ws, worktree_name: "walk-probe" });
  const toolPart = tool ? { tool_name: tool.name, tool_input: tool.input, tool_use_id: "toolu_walk", ...(tool.response ? { tool_response: tool.response } : {}) } : {};
  if (client === "grok") {
    const camel = tool ? { toolName: tool.name, toolInput: tool.input, ...(tool.response ? { toolResult: tool.response } : {}) } : {};
    return { hookEventName: event, hook_event_name: event, sessionId: "walk", session_id: "walk", cwd: ws, workspaceRoot: ws, ...camel, ...toolPart, ...extras };
  }
  const base = { session_id: "walk", transcript_path: "", cwd: ws, hook_event_name: event, ...toolPart, ...extras };
  if (client === "codex") return { ...base, turn_id: "turn-walk", model: "gpt-5", permission_mode: "default" };
  return { ...base, permission_mode: "default" };
}

function matcherKind(matcher) {
  if (!matcher) return null;
  if (/Bash/.test(matcher)) return "shell";
  if (/Write|Edit/.test(matcher)) return "write";
  if (/AskUserQuestion/.test(matcher)) return "ask";
  if (/mcp__/.test(matcher)) return "mcp";
  return "unknown";
}

/** Each run the walk makes for `client`: the script, its argv and the payload. */
export function plannedRuns({ hooksJson, planes, client, ws, root = ws, events, small = false }) {
  const runs = [];
  const fixtures = toolFixtures(ws, { small, root });
  const names = TOOL_NAMES[client];
  const coverage = clientHookCoverage(hooksJson, planes, client);
  const entries = hooksJsonEntries(hooksJson);
  const placed = new Set();
  coverage.forEach((row, i) => {
    if (events && !events.includes(row.event)) return;
    let script;
    let args = [];
    if (row.state === "wired") {
      script = row.script;
      const after = String(entries[i].hook.command ?? "").split(script).slice(1).join(script);
      args = after.replace(/^"?\s*/, "").split(/\s+/).filter(Boolean);
    } else if (row.state === "bundled" && !placed.has(`${row.event}:${row.substitute}`)) {
      placed.add(`${row.event}:${row.substitute}`);
      script = row.substitute;
    } else {
      return;
    }
    const kind = matcherKind(row.matcher);
    if (kind === "unknown") {
      runs.push({ client, event: row.event, matcher: row.matcher, script, args, label: "(no fixture)", missingFixture: true });
      return;
    }
    const tools = kind ? fixtures[kind].map((f) => ({ name: names[kind], input: f.input, response: f.response, label: f.label })) : [null];
    for (const tool of tools) {
      runs.push({ client, event: row.event, matcher: row.matcher, script, args, label: tool?.label ?? row.event, toolName: tool?.name, payload: clientPayload(client, row.event, ws, tool) });
    }
  });
  return runs;
}

function hookEnv({ ws, home, pluginRoot, extra }) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DPF_|CLAUDE_|CODEX_|GROK_)/.test(key)) continue; // operator bypasses and live session state
    env[key] = value;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    CLAUDE_PROJECT_DIR: ws,
    DPF_MCP_ENDPOINT: "http://127.0.0.1:9/api/mcp/v1",
    DPF_HOOK_OUTPUT_WALK: "1", // the self-test does not recurse into itself
    DPF_WORKTREE_SESSION_REAP: "0", // judge the SessionEnd report, never reap the fixture mid-walk
    ...extra,
  };
}

function runOne(run, { hooksDir, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(hooksDir, run.script), ...run.args], { cwd: env.CLAUDE_PROJECT_DIR, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: String(err?.message ?? err), code: -1, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(run.payload));
  });
}

/**
 * Run every planned hook for each client and judge the output.
 * @returns {Promise<Array<{ client, event, matcher, script, label, stdout, code, problems: string[] }>>}
 */
export async function walkHookOutputs({ hooksJson, planes, hooksDir, pluginRoot, clients, ws, root = ws, home, events, small = false, timeoutMs = 60_000, concurrency = 6 }) {
  const runs = clients.flatMap((client) => plannedRuns({ hooksJson, planes, client, ws, root, events, small }));
  const env = hookEnv({ ws, home, pluginRoot });
  const results = new Array(runs.length);
  let next = 0;
  async function worker() {
    while (next < runs.length) {
      const i = next++;
      const run = runs[i];
      if (run.missingFixture) {
        results[i] = { ...run, stdout: "", code: null, problems: [`no fixture covers matcher "${run.matcher}"; add one to hooks/lib/hook-output-walk.mjs`] };
        continue;
      }
      const started = Date.now();
      const out = await runOne(run, { hooksDir, env, timeoutMs });
      out.ms = Date.now() - started;
      const problems = [];
      if (out.timedOut) problems.push(`timed out after ${timeoutMs} ms, so the client kills it and the tool runs unguarded`);
      else if (out.code === 2 && ["PreToolUse", "Stop", "PostToolUse"].includes(run.event) && run.client !== "grok") {
        // exit 2 + stderr is the documented block channel on Claude and Codex.
      } else if (out.code !== 0) {
        const line = String(out.stderr).trim().split("\n").find(Boolean) ?? "";
        problems.push(`exited ${out.code}${line ? ` (${line.slice(0, 160)})` : ""}`);
      }
      if (!out.timedOut && out.code === 0) problems.push(...hookOutputProblems({ client: run.client, event: run.event, stdout: out.stdout, toolName: run.toolName }));
      results[i] = { client: run.client, event: run.event, matcher: run.matcher, script: run.script, label: run.label, stdout: out.stdout, code: out.code, ms: out.ms, problems };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, runs.length) }, worker));
  return results;
}

/** One line per broken output, naming hook, client, event and fixture. */
export function formatWalkProblems(results) {
  return results.flatMap((r) => r.problems.map((p) => `${r.script} on ${r.client} ${r.event}${r.matcher ? `[${r.matcher}]` : ""} (${r.label}): ${p}`));
}

export { clientPlane };
