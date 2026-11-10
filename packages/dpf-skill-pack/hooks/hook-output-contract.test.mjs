// packages/dpf-skill-pack/hooks/hook-output-contract.test.mjs
//
// Every hook in hooks.json, run against fixture inputs for each client that runs
// it, must emit output that client honours (BI-5DD46FDA). The workroom-claim
// guard's top-level "decision":"deny" was rejected by Claude as invalid output
// and its block was skipped 477 times in a week; nothing noticed, because no
// check compared a hook's output with the client's contract.

import assert from "node:assert/strict";
import { test, after } from "node:test";
import { cpus } from "node:os";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hookOutputProblems, CONTRACT_CLIENTS } from "./lib/hook-output-contract.mjs";
import { makeFixtureWorkspace, walkHookOutputs, formatWalkProblems } from "./lib/hook-output-walk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
const problems = (client, event, out, toolName = "Bash") => hookOutputProblems({ client, event, stdout: typeof out === "string" ? out : JSON.stringify(out), toolName });

// ── the contract itself ──────────────────────────────────────────────────────
test("the 10-07 incident output fails Claude's contract", () => {
  const found = problems("claude-code", "PreToolUse", { decision: "deny", reason: "claim a workroom first" });
  assert.ok(found.some((p) => /decision "deny"/.test(p)), found.join("\n"));
  // The dual envelope Grok needs is still invalid on Claude.
  assert.ok(problems("claude-code", "PreToolUse", { decision: "deny", reason: "x", ...deny("x") }).length > 0);
});

test("the shapes DPF hooks emit pass on the clients that run them", () => {
  assert.deepEqual(problems("claude-code", "PreToolUse", deny("x")), []);
  assert.deepEqual(problems("codex", "PreToolUse", deny("x")), []);
  assert.deepEqual(problems("grok", "PreToolUse", { decision: "deny", reason: "x", ...deny("x") }), []);
  const context = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "c" } };
  for (const client of CONTRACT_CLIENTS) assert.deepEqual(problems(client, "SessionStart", context), [], client);
  assert.deepEqual(problems("claude-code", "Stop", { decision: "block", reason: "commit first" }), []);
  assert.deepEqual(problems("claude-code", "SessionStart", "plain text context"), []);
  assert.deepEqual(problems("claude-code", "WorktreeCreate", "D:/DPF-worktrees/x"), []);
});

test("a rewrite passes on Claude and fails on Codex-ask and Grok", () => {
  const rewrite = (decision) => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: "r", updatedInput: { command: "pnpm exec prisma generate" }, additionalContext: "r" },
  });
  assert.deepEqual(problems("claude-code", "PreToolUse", rewrite("allow")), []);
  assert.deepEqual(problems("claude-code", "PreToolUse", rewrite("ask")), []);
  assert.deepEqual(problems("codex", "PreToolUse", rewrite("allow")), []);
  assert.ok(problems("codex", "PreToolUse", rewrite("ask")).length > 0);
  assert.ok(problems("grok", "PreToolUse", rewrite("allow")).length > 0);
  assert.ok(problems("claude-code", "PreToolUse", { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { cmd: "x" } } }).length > 0);
});

test("other broken shapes are named", () => {
  assert.ok(problems("claude-code", "PreToolUse", "{not json").length > 0);
  assert.ok(problems("claude-code", "PreToolUse", { hookSpecificOutput: { hookEventName: "PostToolUse", permissionDecision: "deny" } }).length > 0);
  assert.ok(problems("claude-code", "PreToolUse", { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "block" } }).length > 0);
  assert.ok(problems("claude-code", "SessionStart", { decision: "block" }).length > 0);
  assert.ok(problems("codex", "Stop", "plain text").length > 0);
  assert.ok(problems("grok", "PreToolUse", deny("x")).length > 0, "a Claude-only deny is ignored by Grok");
  assert.ok(problems("claude-code", "WorktreeCreate", JSON.stringify({ path: "D:/x" })).length > 0);
  assert.ok(problems("claude-code", "WorktreeCreate", "").length > 0);
});

// ── the exhaustive walk ──────────────────────────────────────────────────────
const fixture = makeFixtureWorkspace();
after(() => fixture.cleanup());
const concurrency = Math.max(4, Math.min(16, cpus().length));

test("every hooks.json hook emits output each client that runs it honours", async () => {
  const hooksJson = readJson(join(HERE, "hooks.json"));
  const planes = readJson(join(HERE, "client-hook-planes.json"));
  const results = await walkHookOutputs({
    hooksJson,
    planes,
    hooksDir: HERE,
    pluginRoot: dirname(HERE),
    clients: CONTRACT_CLIENTS,
    ws: fixture.ws,
    root: fixture.root,
    home: fixture.home,
    concurrency,
  });
  assert.deepEqual(formatWalkProblems(results), []);

  // The walk is not vacuous: every client ran hooks of every event it wires,
  // and the guards the incident class is about actually decided.
  for (const client of CONTRACT_CLIENTS) {
    const ran = new Set(results.filter((r) => r.client === client).map((r) => r.event));
    for (const event of ["PreToolUse", "PostToolUse", "SessionStart", "SessionEnd", "Stop"]) assert.ok(ran.has(event), `${client} ran no ${event} hook`);
  }
  const decided = (client, script, pattern) =>
    results.some((r) => r.client === client && r.script === script && pattern.test(r.stdout));
  for (const client of CONTRACT_CLIENTS) {
    for (const script of ["raw-tool-guard.mjs", "compose-guard.mjs", "lease-punt-guard.mjs", "decision-routing-guard.mjs", "root-clone-guard.mjs"]) {
      assert.ok(decided(client, script, /"deny"/), `${script} never denied on ${client}`);
    }
  }
  // A write into the root clone from a worktree session is judged by the file, on every client.
  for (const client of CONTRACT_CLIENTS) {
    assert.ok(
      results.some((r) => r.client === client && r.script === "root-clone-guard.mjs" && r.label.includes("<root clone>") && /"deny"/.test(r.stdout)),
      `root-clone-guard let a root-clone write through on ${client}`,
    );
    assert.ok(decided(client, "workroom-claim-guard.mjs", /"deny"/), `workroom-claim-guard never denied on ${client}`);
  }
  assert.ok(decided("claude-code", "raw-tool-guard.mjs", /"updatedInput"/), "raw-tool-guard never rewrote on Claude");
  assert.ok(!decided("codex", "raw-tool-guard.mjs", /"updatedInput"/), "raw-tool-guard rewrote on Codex");
  assert.ok(!decided("grok", "raw-tool-guard.mjs", /"updatedInput"/), "raw-tool-guard rewrote on Grok");
  assert.ok(results.some((r) => r.client === "claude-code" && r.event === "WorktreeCreate"), "WorktreeCreate was not walked");
});

test("a hook that emits an invalid decision fails the walk, naming the hook and the client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-bad-hook-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "hooks"));
  writeFileSync(join(dir, "hooks", "bad-guard.mjs"), 'process.stdout.write(JSON.stringify({ decision: "deny", reason: "no" }));\n');
  const hooksJson = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/bad-guard.mjs"' }] }] } };
  const planes = readJson(join(HERE, "client-hook-planes.json"));
  const results = await walkHookOutputs({ hooksJson, planes, hooksDir: join(dir, "hooks"), pluginRoot: dir, clients: ["claude-code", "codex"], ws: fixture.ws, home: fixture.home, small: true, concurrency });
  const lines = formatWalkProblems(results);
  assert.ok(lines.some((l) => l.startsWith("bad-guard.mjs on claude-code PreToolUse")), lines.join("\n"));
  assert.ok(lines.some((l) => l.startsWith("bad-guard.mjs on codex PreToolUse")), lines.join("\n"));
});
