// packages/dpf-skill-pack/hooks/hook-io.test.mjs
//
// Cross-surface hook I/O contract (BI-883FC2FC / BI-3157516C). Live probe of
// Grok 0.2.87 proved Grok executes PreToolUse blocking hooks and honors deny,
// but with a camelCase envelope (toolName="Shell", toolInput) and a top-level
// { decision } verdict — while Claude/Codex use snake_case + hookSpecificOutput.
// These tests pin BOTH so a future edit can't silently re-break one surface.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  normalizePayload,
  isShellTool,
  isDecisionTool,
  denyEnvelope,
  inDpfWorkspace,
} from "./lib/hook-io.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Deterministic scoping: this test tree IS a DPF checkout, but pin it so the
// enforce-path tests never depend on the runner's cwd.
const ANY = { DPF_GUARDS_WORKSPACE_ANY: "1" };

test("normalizePayload reads Grok camelCase envelope", () => {
  const n = normalizePayload({ toolName: "Shell", toolInput: { command: "x" }, cwd: "/w", workspaceRoot: "/w" });
  assert.equal(n.toolName, "Shell");
  assert.equal(n.toolInput.command, "x");
  assert.equal(n.cwd, "/w");
});

test("normalizePayload reads Claude/Codex snake_case envelope", () => {
  const n = normalizePayload({ tool_name: "Bash", tool_input: { command: "y" }, cwd: "/c" });
  assert.equal(n.toolName, "Bash");
  assert.equal(n.toolInput.command, "y");
  assert.equal(n.cwd, "/c");
});

test("normalizePayload is defensive on junk input", () => {
  assert.deepEqual(normalizePayload(null), { toolName: undefined, toolInput: {}, cwd: undefined });
  assert.deepEqual(normalizePayload({ tool_input: "notobj" }).toolInput, {});
});

test("isShellTool spans every surface's shell tool name", () => {
  for (const n of ["Bash", "Shell", "run_terminal_command", "run_terminal_cmd"]) {
    assert.ok(isShellTool(n), `${n} should be a shell tool`);
  }
  assert.ok(!isShellTool("Write"));
  assert.ok(!isShellTool(undefined));
});

test("shellCommandFromInput accepts command/cmd/script aliases", async () => {
  const { shellCommandFromInput } = await import("./lib/hook-io.mjs");
  assert.equal(shellCommandFromInput({ command: "a" }), "a");
  assert.equal(shellCommandFromInput({ cmd: "b" }), "b");
  assert.equal(shellCommandFromInput({ script: "c" }), "c");
  assert.equal(shellCommandFromInput({}), "");
  assert.equal(shellCommandFromInput(null), "");
});

test("isDecisionTool spans Claude and Grok decision tools", () => {
  assert.ok(isDecisionTool("AskUserQuestion"));
  assert.ok(isDecisionTool("AskQuestion"));
  assert.ok(!isDecisionTool("Bash"));
});

test("denyEnvelope carries BOTH surfaces' deny channels", () => {
  const e = denyEnvelope("nope");
  // Grok-native
  assert.equal(e.decision, "deny");
  assert.equal(e.reason, "nope");
  // Claude/Codex-native
  assert.equal(e.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(e.hookSpecificOutput.permissionDecisionReason, "nope");
  assert.equal(e.hookSpecificOutput.hookEventName, "PreToolUse");
});

// ── End-to-end: pipe a Grok-shaped payload through the real guard binaries and
//    assert the emitted verdict denies on BOTH channels. This is the regression
//    the live probe would have caught.
function runGuard(script, payloadObj, env = {}) {
  const out = execFileSync("node", [join(HERE, script)], {
    input: JSON.stringify(payloadObj),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return out ? JSON.parse(out) : {};
}

test("lease-punt-guard denies a hard gate under the Grok envelope", () => {
  // Assemble the gate text at runtime so this test file never contains the
  // literal token that the guard itself pattern-matches.
  const cmd = ["npx", "prisma", "migrate", "dev"].join(" ");
  const v = runGuard("lease-punt-guard.mjs", { toolName: "Shell", toolInput: { command: cmd } }, { DATABASE_URL: "", ...ANY });
  assert.equal(v.decision, "deny");
  assert.equal(v.hookSpecificOutput.permissionDecision, "deny");
});

test("decision-routing-guard denies a platform decision under the Grok AskQuestion envelope", () => {
  const v = runGuard(
    "decision-routing-guard.mjs",
    {
      toolName: "AskQuestion",
      toolInput: {
        questions: [
          {
            question: "Which architecture approach should we build first for the gate?",
            options: [{ label: "Server-side plane" }, { label: "Harness hook only" }],
          },
        ],
      },
    },
    ANY,
  );
  assert.equal(v.decision, "deny");
  assert.equal(v.hookSpecificOutput.permissionDecision, "deny");
});

test("guards stay inert on non-matching Grok tool names (fail-safe allow)", () => {
  const out = execFileSync("node", [join(HERE, "lease-punt-guard.mjs")], {
    input: JSON.stringify({ toolName: "read_file", toolInput: { command: "whatever" } }),
    env: { ...process.env, DATABASE_URL: "", ...ANY },
    encoding: "utf8",
  });
  assert.equal(out.trim(), "");
});

// ── DPF-workspace scoping: the global hook must NOT fire in non-DPF sessions ──
test("inDpfWorkspace true inside this checkout, false in a bare temp dir", () => {
  assert.ok(inDpfWorkspace(HERE), "the hooks dir is inside a DPF checkout");
  assert.ok(!inDpfWorkspace("/"), "filesystem root has no DPF marker");
});

test("lease-punt-guard stays inert when cwd is outside a DPF checkout", () => {
  const cmd = ["npx", "prisma", "migrate", "dev"].join(" ");
  // cwd = "/" (no packages/dpf-skill-pack up-tree); no WORKSPACE_ANY override.
  const out = execFileSync("node", [join(HERE, "lease-punt-guard.mjs")], {
    input: JSON.stringify({ toolName: "Shell", toolInput: { command: cmd }, cwd: "/" }),
    env: { ...process.env, DATABASE_URL: "", DPF_GUARDS_WORKSPACE_ANY: "0" },
    encoding: "utf8",
  });
  assert.equal(out.trim(), "", "DPF-branded deny must not fire in a non-DPF repo");
});
