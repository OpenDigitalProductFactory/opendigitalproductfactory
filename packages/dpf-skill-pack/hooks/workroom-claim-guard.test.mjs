import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { shellMutatesTree, isMutatingCall, FILE_WRITE_TOOL_NAMES } from "./workroom-claim-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const guard = join(here, "workroom-claim-guard.mjs");

function run(payload, { env = {}, cwd = here } = {}) {
  const r = spawnSync(process.execPath, [guard], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd,
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", ...env },
  });
  return { status: r.status, stdout: r.stdout.trim() };
}

test("every file-write tool is treated as mutating", () => {
  for (const t of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    assert.ok(FILE_WRITE_TOOL_NAMES.has(t));
    assert.equal(isMutatingCall({ toolName: t, toolInput: {} }), true, `${t} must be gated`);
  }
});

test("read-only shell commands are not gated", () => {
  for (const c of [
    "grep -rn foo src/",
    "git status --short",
    "git log --oneline -5",
    "git diff",
    "cat AGENTS.md",
    "ls -la",
    "node --test packages/x/y.test.mjs",
  ]) {
    assert.equal(shellMutatesTree(c), false, `must not gate: ${c}`);
  }
});

test("shell writes are gated — including the shapes that route around Write/Edit hooks", () => {
  // Bypass permissions mode sends file edits through Bash, skipping every
  // Write|Edit hook. A guard that misses these is trivially defeated.
  for (const c of [
    "cat > /tmp/x.txt <<EOF\nhi\nEOF",
    "cat >> notes.md <<'EOF'\nx\nEOF",
    'sed -i "" s/a/b/ AGENTS.md',
    "perl -i -pe s/a/b/ f",
    "rm -rf build",
    "mv a b",
    "cp a b",
    "mkdir -p x",
    "touch f",
    "tee out.txt",
    "git add .",
    "git commit -m x",
    "git checkout main",
    "git reset --hard",
    "echo hi > f",
    "pnpm install",
  ]) {
    assert.equal(shellMutatesTree(c), true, `must gate: ${c}`);
  }
});

test("remediation commands are never blocked by the condition they repair", () => {
  // Blocking the repair path would make an unclaimed worktree unrecoverable.
  for (const c of [
    "bash scripts/dpf-bootstrap-agent-toolchain.sh",
    "pwsh scripts/dpf-bootstrap-agent-toolchain.ps1",
    "bash scripts/seed-worktree-mcp.sh",
    "git worktree add ~/dpf-worktrees/x -b feat/x origin/main",
  ]) {
    assert.equal(shellMutatesTree(c), false, `must not block remediation: ${c}`);
  }
});

test("non-tree tools are ignored entirely", () => {
  assert.equal(isMutatingCall({ toolName: "Read", toolInput: {} }), false);
  assert.equal(isMutatingCall({ toolName: "Grep", toolInput: {} }), false);
  assert.equal(isMutatingCall({ toolName: "WebFetch", toolInput: {} }), false);
});

test("the skip env disables the guard outright", () => {
  const r = run({ tool_name: "Write", tool_input: { file_path: "/x" } }, { env: { DPF_SKIP_WORKROOM_CLAIM_GUARD: "1" } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("the bypass door allows the call but declares the session UNGOVERNED", () => {
  const r = run(
    { tool_name: "Write", tool_input: { file_path: "/x" } },
    { env: { DPF_WORKROOM_BYPASS: "portal down during incident" } },
  );
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, "bypass must allow, not deny");
  assert.match(out.hookSpecificOutput.additionalContext, /UNGOVERNED/);
  assert.match(out.hookSpecificOutput.additionalContext, /portal down during incident/);
});

test("an empty bypass value is NOT a bypass — a reason is required", () => {
  // A blank env var must not silently disable governance.
  const r = run({ tool_name: "Bash", tool_input: { command: "git status" } }, { env: { DPF_WORKROOM_BYPASS: "   " } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "", "a read is allowed regardless; the point is no UNGOVERNED banner was emitted");
});

test("an unparseable payload fails open at the boundary", () => {
  const r = spawnSync(process.execPath, [guard], { input: "not json", encoding: "utf8", cwd: here });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});
