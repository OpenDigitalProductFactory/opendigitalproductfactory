import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateThreadConformance, formatWorkShapeBanner } from "./lib/thread-conformance.mjs";

/** A tree with the given CLAUDE.md body; `linked` picks worktree (.git file) vs root clone (.git dir). */
function makeTree({ pointer = "@AGENTS.md\n", linked = true, withAgents = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-conf-"));
  if (withAgents) writeFileSync(join(dir, "AGENTS.md"), "# rules\n");
  if (pointer !== null) writeFileSync(join(dir, "CLAUDE.md"), pointer);
  if (linked) writeFileSync(join(dir, ".git"), "gitdir: /elsewhere\n");
  else mkdirSync(join(dir, ".git"));
  return dir;
}

const gitFor = (top, branch = "feat/x") => (args) => {
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return top;
  if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return branch;
  return null;
};

/** MCP double. `status` drives tools/list; `capsules`/`capsule` drive the tool calls. */
function mcpFor({ status = 200, capsules = [], capsule = undefined } = {}) {
  return async (method, params) => {
    if (method === "tools/list") {
      return status === 0 ? { httpStatus: 0, json: null, reason: "unreachable" } : { httpStatus: status, json: {} };
    }
    const name = params?.name;
    if (name === "list_workrooms") {
      return { httpStatus: 200, json: { result: { content: [{ type: "text", text: JSON.stringify({ data: { capsules } }) }] } } };
    }
    if (name === "get_workroom") {
      if (capsule === undefined) return { httpStatus: 500, json: null };
      return { httpStatus: 200, json: { result: { capsule } } };
    }
    return { httpStatus: 500, json: null };
  };
}

const ENV = { DPF_MCP_BEARER_TOKEN: "dpfmcp_test" };
const stepOf = (r, key) => r.steps.find((s) => s.key === key);

test("root clone is refused as a working location", async () => {
  const dir = makeTree({ linked: false });
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor() });
  const s = stepOf(r, "worktree");
  assert.equal(s.status, "fail");
  assert.match(s.detail, /root clone/);
  assert.equal(r.governed, false);
});

test("tool-native .claude/worktrees nesting is refused (AGENTS.md section 12)", async () => {
  const base = makeTree();
  const nested = join(base, ".claude", "worktrees", "goofy-x");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "AGENTS.md"), "# rules\n");
  writeFileSync(join(nested, "CLAUDE.md"), "@AGENTS.md\n");
  writeFileSync(join(nested, ".git"), "gitdir: /elsewhere\n");
  const r = await evaluateThreadConformance({ cwd: nested, env: ENV, git: gitFor(nested), mcpCall: mcpFor() });
  assert.equal(stepOf(r, "worktree").status, "fail");
  assert.match(stepOf(r, "worktree").detail, /tool-native nesting/);
});

test("a prose pointer no longer starves the thread — doctrine is injected instead", async () => {
  // The 70-of-80 defect: "Read [/AGENTS.md](AGENTS.md)" loads nothing. Before
  // BI-E659ED37 that meant no doctrine at all. Now the rulebook is injected, so
  // the step passes AND says why, rather than silently passing.
  const dir = makeTree({ pointer: "Read [/AGENTS.md](AGENTS.md) at the repo root before any work.\n" });
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor() });
  const s2 = stepOf(r, "doctrine");
  assert.equal(s2.status, "pass");
  assert.match(s2.detail, /injected/);
  assert.match(s2.detail, /pointer/);
});

test("a prose pointer WITH no reachable rulebook still fails — injection is not assumed", async () => {
  const dir = makeTree({ pointer: "Read the rules somewhere.\n", withAgents: false });
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor() });
  const s2 = stepOf(r, "doctrine");
  assert.equal(s2.status, "fail");
  assert.equal(r.governed, false);
});

test("an @AGENTS.md import passes doctrine", async () => {
  const dir = makeTree();
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor() });
  assert.equal(stepOf(r, "doctrine").status, "pass");
});

test("a rejected token fails MCP and names the repair", async () => {
  const dir = makeTree();
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor({ status: 401 }) });
  const s = stepOf(r, "mcp");
  assert.equal(s.status, "fail");
  assert.match(s.remediation, /dpf-bootstrap-agent-toolchain\.sh/);
});

test("an unreachable endpoint is UNPROVEN, never a pass", async () => {
  const dir = makeTree();
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor({ status: 0 }) });
  assert.equal(stepOf(r, "mcp").status, "unknown");
  assert.equal(r.governed, false, "unknown must never count as governed");
});

test("workroom and BI are unproven — not failed — while MCP is down", async () => {
  const dir = makeTree();
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor({ status: 0 }) });
  assert.equal(stepOf(r, "workroom").status, "unknown");
  assert.equal(stepOf(r, "backlog").status, "unknown");
});

test("no live capsule claiming this worktree fails the workroom step", async () => {
  const dir = makeTree();
  const capsules = [{ capsuleId: "WC-OTHER", isLive: true, worktreePath: "/somewhere/else", headBranch: "feat/other" }];
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor({ capsules }) });
  assert.equal(stepOf(r, "workroom").status, "fail");
  assert.match(stepOf(r, "workroom").remediation, /claim_backlog_item_for_work/);
});

test("an EXPIRED capsule on this worktree does not count as a claim", async () => {
  const dir = makeTree();
  const capsules = [{ capsuleId: "WC-DEAD", isLive: false, worktreePath: dir, headBranch: "feat/x" }];
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor({ capsules }) });
  assert.equal(stepOf(r, "workroom").status, "fail");
});

test("a live BI-bound capsule makes the thread governed", async () => {
  const dir = makeTree();
  const capsules = [{ capsuleId: "WC-1", isLive: true, worktreePath: dir, headBranch: "feat/x", livenessReason: "Lease valid." }];
  const r = await evaluateThreadConformance({
    cwd: dir, env: ENV, git: gitFor(dir),
    mcpCall: mcpFor({ capsules, capsule: { capsuleId: "WC-1", backlogItemId: "BI-123" } }),
  });
  assert.equal(stepOf(r, "workroom").status, "pass");
  assert.equal(stepOf(r, "backlog").status, "pass");
  assert.equal(stepOf(r, "backlog").detail, "BI-123");
  assert.equal(r.governed, true);
});

test("regression: list_workrooms omits backlogItemId, so BI coverage must not false-MISSING", async () => {
  // The list projection carries no backlogItemId. Reading it off the list shape
  // reported MISSING for a capsule that IS bound — a false negative that would
  // block editing on a conformant thread once the guards enforce this.
  const dir = makeTree();
  const capsules = [{ capsuleId: "WC-1", isLive: true, worktreePath: dir, headBranch: "feat/x" }]; // no backlogItemId
  const r = await evaluateThreadConformance({
    cwd: dir, env: ENV, git: gitFor(dir),
    mcpCall: mcpFor({ capsules, capsule: { capsuleId: "WC-1", backlogItemId: "BI-299C953D" } }),
  });
  assert.equal(stepOf(r, "backlog").status, "pass");
});

test("an unresolvable capsule is unknown, never a false fail", async () => {
  const dir = makeTree();
  const capsules = [{ capsuleId: "WC-1", isLive: true, worktreePath: dir, headBranch: "feat/x" }];
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor({ capsules }) });
  assert.equal(stepOf(r, "backlog").status, "unknown");
});

test("a genuinely unbound capsule fails BI coverage", async () => {
  const dir = makeTree();
  const capsules = [{ capsuleId: "WC-1", isLive: true, worktreePath: dir, headBranch: "feat/x" }];
  const r = await evaluateThreadConformance({
    cwd: dir, env: ENV, git: gitFor(dir),
    mcpCall: mcpFor({ capsules, capsule: { capsuleId: "WC-1", backlogItemId: null } }),
  });
  assert.equal(stepOf(r, "backlog").status, "fail");
});

test("the banner shows a remediation for the FIRST unmet step only", async () => {
  const dir = makeTree({ linked: false, pointer: "prose link\n" }); // two failures
  const r = await evaluateThreadConformance({ cwd: dir, env: ENV, git: gitFor(dir), mcpCall: mcpFor({ status: 401 }) });
  const text = formatWorkShapeBanner(r).join("\n");
  assert.match(text, /-> Next: worktree/);
  assert.doesNotMatch(text, /-> Next: doctrine/);
  assert.match(text, /Editing is blocked until step 1 passes/);
});

test("the banner reports the ready count and every step", async () => {
  const dir = makeTree();
  const capsules = [{ capsuleId: "WC-1", isLive: true, worktreePath: dir, headBranch: "feat/x" }];
  const r = await evaluateThreadConformance({
    cwd: dir, env: ENV, git: gitFor(dir),
    mcpCall: mcpFor({ capsules, capsule: { capsuleId: "WC-1", backlogItemId: "BI-1" } }),
  });
  const text = formatWorkShapeBanner(r).join("\n");
  assert.match(text, /DPF WORK SHAPE — 5 of 5 ready/);
  for (const label of ["worktree", "doctrine", "governed MCP", "workroom", "BI coverage"]) {
    assert.ok(text.includes(label), `banner must list ${label}`);
  }
});

test("a missing token fails MCP without pretending it is merely absent locally", async () => {
  const dir = makeTree();
  const r = await evaluateThreadConformance({ cwd: dir, env: {}, git: gitFor(dir), mcpCall: undefined });
  assert.equal(stepOf(r, "mcp").status, "fail");
});
