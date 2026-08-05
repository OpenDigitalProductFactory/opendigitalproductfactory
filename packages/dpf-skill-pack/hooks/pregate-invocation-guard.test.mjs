import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { decide } from "./pregate-invocation-guard.mjs";

const guard = fileURLToPath(new URL("./pregate-invocation-guard.mjs", import.meta.url));

function runGuard(payload, env = {}) {
  const r = spawnSync(process.execPath, [guard], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", ...env },
  });
  return { status: r.status, stdout: r.stdout.trim() };
}

// ── the four shapes that actually cost the hour ──────────────────────────────

test("denies a PIPED pregate and names the canonical form", () => {
  const v = decide({ command: "pnpm run pregate | head -5" });
  assert.equal(v.block, true);
  assert.match(v.reason, /PIPED/);
  assert.match(v.reason, /pnpm run pregate/);
  assert.match(v.reason, /pregate:status/);
});

test("denies a grep-piped pregate (the same shape, a different reader)", () => {
  assert.equal(decide({ command: 'pnpm run pregate | grep -E "^gate passed"' }).block, true);
});

test("denies run_in_background even when the command text is clean", () => {
  const v = decide({ command: "pnpm run pregate", runInBackground: true });
  assert.equal(v.block, true);
  assert.match(v.reason, /CAPS and KILLS/);
});

test("denies a `&`-backgrounded pregate", () => {
  assert.equal(decide({ command: "pnpm run pregate &" }).block, true);
});

test("denies a chain whose exit code is somebody else's", () => {
  const v = decide({ command: "pnpm run pregate; echo EXIT=$?; tail -50 out.log" });
  assert.equal(v.block, true);
  assert.match(v.reason, /exit code, not the gate/);
});

test("denies `||` chaining too — it also runs regardless and hands you its status", () => {
  assert.equal(decide({ command: "pnpm run pregate || echo failed" }).block, true);
});

test("denies a timeout-wrapped pregate", () => {
  const v = decide({ command: "timeout 900 pnpm run pregate" });
  assert.equal(v.block, true);
  assert.match(v.reason, /false\s+green/);
});

test("reports EVERY fault at once so a fix does not arrive one denial at a time", () => {
  const v = decide({ command: "timeout 600 pnpm run pregate | head -5; echo done" });
  assert.equal(v.block, true);
  assert.match(v.reason, /PIPED/);
  assert.match(v.reason, /timeout/);
  assert.match(v.reason, /exit code/);
});

// ── the canonical form and its neighbours must stay allowed ──────────────────

test("permits the canonical invocation", () => {
  assert.equal(decide({ command: "pnpm run pregate" }).block, false);
});

test("permits the canonical invocation with gate arguments", () => {
  assert.equal(
    decide({ command: 'pnpm run pregate -- --branch "feat/x;y" --no-push' }).block,
    false,
    "quoted data must not be read as a chain",
  );
});

test("permits `&&` — it short-circuits, so the shell still reports the gate's status", () => {
  assert.equal(decide({ command: "pnpm run pregate && git push" }).block, false);
});

test("permits piping the read-only status command — that habit is the one being encouraged", () => {
  assert.equal(decide({ command: "pnpm run pregate:status --json | jq .verdict" }).block, false);
});

test("permits piping the cheap non-admitting modes", () => {
  assert.equal(decide({ command: "pnpm run pregate -- --dry-run | head -20" }).block, false);
  assert.equal(decide({ command: "node scripts/pregate.mjs --help | head" }).block, false);
});

test("ignores commands that are not pregate at all", () => {
  assert.equal(decide({ command: "pnpm test | head -20" }).block, false);
  assert.equal(decide({ command: "git log --oneline | head -5" }).block, false);
});

test("does not fire on pregate merely MENTIONED inside quoted data", () => {
  // Same class of false positive lease-punt-guard hit on 2026-07-06: filing a bug
  // about a blocked command must not itself be blocked.
  assert.equal(
    decide({ command: 'gh issue comment 1 --body "we ran pnpm run pregate | head -5 and it died"' }).block,
    false,
  );
});

test("honors the deliberate escape hatch", () => {
  assert.equal(decide({ command: "DPF_ALLOW_PREGATE_SHAPE=1 pnpm run pregate | head -5" }).block, false);
  assert.equal(
    decide({ command: "pnpm run pregate | head -5", env: { DPF_ALLOW_PREGATE_SHAPE: "1" } }).block,
    false,
  );
});

// ── runtime envelope + fail-open contract ────────────────────────────────────

test("emits a dual-envelope deny that every surface honors", () => {
  const r = runGuard({ tool_name: "Bash", tool_input: { command: "pnpm run pregate | head -5" }, cwd: process.cwd() });
  assert.equal(r.status, 0, "a deny is delivered on stdout with exit 0");
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "deny", "Grok reads the top-level decision");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny", "Claude/Codex read hookSpecificOutput");
  assert.match(out.reason, /BI-B1065D41/);
});

test("reads Grok's camelCase envelope, not just Claude's snake_case", () => {
  const r = runGuard({ toolName: "Shell", toolInput: { command: "pnpm run pregate | head -5" }, cwd: process.cwd() });
  assert.equal(JSON.parse(r.stdout).decision, "deny");
});

test("denies run_in_background delivered through the tool input", () => {
  const r = runGuard({
    tool_name: "Bash",
    tool_input: { command: "pnpm run pregate", run_in_background: true },
    cwd: process.cwd(),
  });
  assert.match(JSON.parse(r.stdout).reason, /CAPS and KILLS/);
});

test("stays silent on the canonical form", () => {
  const r = runGuard({ tool_name: "Bash", tool_input: { command: "pnpm run pregate" }, cwd: process.cwd() });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "", "an allow emits nothing");
});

test("fails OPEN on an unparseable payload (a guard must never wedge a session)", () => {
  const r = spawnSync(process.execPath, [guard], {
    input: "{not json",
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1" },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("fails OPEN on a non-shell tool", () => {
  const r = runGuard({ tool_name: "Read", tool_input: { file_path: "x" }, cwd: process.cwd() });
  assert.equal(r.stdout, "");
});

test("stays out of non-DPF workspaces", () => {
  const r = spawnSync(process.execPath, [guard], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "pnpm run pregate | head" }, cwd: "/nowhere-at-all" }),
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "" },
  });
  assert.equal(r.stdout.trim(), "");
});
