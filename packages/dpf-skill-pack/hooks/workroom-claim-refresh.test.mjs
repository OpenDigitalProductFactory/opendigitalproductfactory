// packages/dpf-skill-pack/hooks/workroom-claim-refresh.test.mjs
//
// BI-AB4EA033 — the claim guard reads a cached marker whose expiry is the
// Workroom lease (~30 min). heartbeat_workroom / adopt_worktree / claim_* renew
// that lease over MCP but nothing re-cached it, so the guard kept denying edits
// on a claim the agent had just renewed. This hook re-caches the marker from the
// MCP tool's own answer.
//
// Run: node --test packages/dpf-skill-pack/hooks/workroom-claim-refresh.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLAIM_MARKER_NAME, classifyClaim, parseClaimMarker } from "./lib/workroom-claim-lookup.mjs";
import { capsuleFromAnswer, isClaimTool, parseToolResponse, planMarker } from "./workroom-claim-refresh.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = join(here, "workroom-claim-refresh.mjs");
const guardPath = join(here, "workroom-claim-guard.mjs");

const NOW = Date.parse("2026-10-14T02:00:00.000Z");
const future = new Date(NOW + 30 * 60 * 1000).toISOString();
const past = new Date(NOW - 60 * 1000).toISOString();

const capsule = (over = {}) => ({
  capsuleId: "WC-D24FEA53",
  status: "ready",
  headBranch: "fix/a",
  worktreePath: "D:/wt/a",
  leaseExpiresAt: future,
  backlogItemId: "BI-AB4EA033",
  ...over,
});

// ── which tools ──────────────────────────────────────────────────────────────

test("the dpf tools that return a live capsule are claim tools, on any server prefix", () => {
  for (const tool of ["adopt_worktree", "heartbeat_workroom", "claim_workroom_scope", "claim_backlog_item_for_work", "create_workroom"]) {
    assert.equal(isClaimTool(`mcp__plugin_dpf-platform_dpf__${tool}`), true, tool);
    assert.equal(isClaimTool(`mcp__dpf__${tool}`), true, tool);
  }
});

test("other tools are not claim tools", () => {
  for (const tool of ["Edit", "Bash", "mcp__plugin_dpf-platform_dpf__get_workroom", "mcp__x__heartbeat_workroom_v2", undefined, ""]) {
    assert.equal(isClaimTool(tool), false, String(tool));
  }
});

// ── reading the answer ───────────────────────────────────────────────────────

test("the MCP answer is read as the JSON text Claude Code records, or as content blocks", () => {
  const body = { capsule: capsule() };
  assert.deepEqual(parseToolResponse(JSON.stringify(body)), body);
  assert.deepEqual(parseToolResponse([{ type: "text", text: JSON.stringify(body) }]), body);
  assert.deepEqual(parseToolResponse({ content: [{ type: "text", text: JSON.stringify(body) }] }), body);
  assert.deepEqual(parseToolResponse({ structuredContent: body }), body);
  assert.deepEqual(parseToolResponse(body), body);
});

test("a failed call or an unreadable answer is no answer", () => {
  assert.equal(parseToolResponse('Error: {"success":false,"error":"portal_quiescing"}'), null);
  assert.equal(parseToolResponse("not json"), null);
  assert.equal(parseToolResponse(undefined), null);
  // Codex sends the raw MCP call result; an error result is no answer even if its text parses
  assert.equal(parseToolResponse({ isError: true, content: [{ type: "text", text: JSON.stringify({ capsule: capsule() }) }] }), null);
});

test("the capsule is found in each tool's answer shape", () => {
  // heartbeat_workroom / adopt_worktree / claim_workroom_scope
  assert.equal(capsuleFromAnswer({ capsule: capsule() })?.capsuleId, "WC-D24FEA53");
  // claim_backlog_item_for_work: lease is on the readback
  const claim = { capsuleId: "WC-D24FEA53", headBranch: "fix/a", worktreePath: "D:/wt/a", claimed: true, readback: capsule() };
  assert.equal(capsuleFromAnswer(claim)?.leaseExpiresAt, future);
  // tool-result envelope
  assert.equal(capsuleFromAnswer({ success: true, data: { capsule: capsule() } })?.capsuleId, "WC-D24FEA53");
});

test("a refusal or an unclaimed answer yields no capsule", () => {
  assert.equal(capsuleFromAnswer({ success: false, error: "branch_occupied", data: { capsuleId: "WC-X" } }), null);
  assert.equal(capsuleFromAnswer({ claimed: false, readback: capsule() }), null);
  assert.equal(capsuleFromAnswer({ capsule: { capsuleId: "WC-X" } }), null, "no lease, no marker");
});

// ── deciding to write ────────────────────────────────────────────────────────

test("a live capsule for the checked-out branch becomes the guard's marker", () => {
  const plan = planMarker({ capsule: capsule(), currentBranch: "fix/a", nowMs: NOW });
  assert.deepEqual(plan.marker, {
    capsuleId: "WC-D24FEA53",
    branch: "fix/a",
    leaseExpiresAt: future,
    worktreePath: "D:/wt/a",
    backlogItemId: "BI-AB4EA033",
  });
  // and the guard accepts exactly what this writes
  const verdict = classifyClaim({ branch: "fix/a", marker: parseClaimMarker(JSON.stringify(plan.marker)), nowMs: NOW });
  assert.equal(verdict.kind, "allow");
});

test("nothing is written for another branch, a closed capsule, a lapsed lease, or an exempt branch", () => {
  assert.equal(planMarker({ capsule: capsule(), currentBranch: "fix/b", nowMs: NOW }).marker, undefined);
  for (const status of ["complete", "abandoned", "archived"]) {
    assert.equal(planMarker({ capsule: capsule({ status }), currentBranch: "fix/a", nowMs: NOW }).marker, undefined, status);
  }
  assert.equal(planMarker({ capsule: capsule({ leaseExpiresAt: past }), currentBranch: "fix/a", nowMs: NOW }).marker, undefined);
  assert.equal(planMarker({ capsule: capsule({ headBranch: "main" }), currentBranch: "main", nowMs: NOW }).marker, undefined);
  assert.equal(planMarker({ capsule: capsule({ worktreePath: null }), currentBranch: "fix/a", nowMs: NOW }).marker, undefined);
});

// ── functional: the real binaries against a real worktree ────────────────────
//
// The claim guard once passed every unit test while reading the wrong payload
// keys and allowing everything. Only piping real payloads through the process
// proves the wiring, so AC-1 is asserted end to end: guard denies, a heartbeat
// answer passes through this hook, guard allows.

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "claim-refresh-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "packages", "dpf-skill-pack"), { recursive: true });
  git(root, "init", "-q", "-b", "main", repo);
  writeFileSync(join(repo, "README.md"), "x\n");
  git(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
  git(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init");
  const wt = join(root, "wt");
  git(repo, "worktree", "add", "-q", "-b", "fix/a", wt);
  mkdirSync(join(wt, "packages", "dpf-skill-pack"), { recursive: true });
  return { root, wt, gitDir: git(wt, "rev-parse", "--path-format=absolute", "--git-dir") };
}

function run(script, payload) {
  return execFileSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, DPF_WORKROOM_CLAIM_ENFORCE: "1" },
  });
}

const editIn = (wt) => ({ tool_name: "Edit", tool_input: { file_path: join(wt, "README.md") }, cwd: wt });

test("AC-1: after heartbeat_workroom renews the lease, the next edit is allowed", () => {
  const { root, wt, gitDir } = makeRepo();
  try {
    // a lapsed marker, as left behind when the lease ran out
    writeFileSync(join(gitDir, CLAIM_MARKER_NAME), JSON.stringify({ capsuleId: "WC-D24FEA53", branch: "fix/a", leaseExpiresAt: "2020-01-01T00:00:00.000Z", worktreePath: wt }));
    assert.match(run(guardPath, editIn(wt)), /"permissionDecision":"deny"/);

    const lease = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const answer = { capsule: capsule({ headBranch: "fix/a", worktreePath: wt.split("\\").join("/"), leaseExpiresAt: lease }) };
    // the session folder is the install, not the worktree: the hook must follow the answer's worktreePath
    run(hookPath, { hook_event_name: "PostToolUse", tool_name: "mcp__plugin_dpf-platform_dpf__heartbeat_workroom", tool_input: { capsuleId: "WC-D24FEA53" }, tool_response: JSON.stringify(answer), cwd: root });

    assert.equal(JSON.parse(readFileSync(join(gitDir, CLAIM_MARKER_NAME), "utf8")).leaseExpiresAt, lease);
    assert.equal(run(guardPath, editIn(wt)).trim(), "", "guard allows silently");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC-2: an answer for a different branch leaves the worktree's marker alone", () => {
  const { root, wt, gitDir } = makeRepo();
  try {
    const answer = { capsule: capsule({ headBranch: "fix/other", worktreePath: wt.split("\\").join("/") }) };
    run(hookPath, { hook_event_name: "PostToolUse", tool_name: "mcp__plugin_dpf-platform_dpf__adopt_worktree", tool_input: {}, tool_response: JSON.stringify(answer), cwd: root });
    assert.equal(existsSync(join(gitDir, CLAIM_MARKER_NAME)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC-3: the hook never crashes, never speaks and never blocks on a payload it does not own", () => {
  for (const payload of [
    {},
    { tool_name: "Edit", tool_input: {}, tool_response: { filePath: "x" } },
    { tool_name: "mcp__plugin_dpf-platform_dpf__heartbeat_workroom", tool_response: "Error: refused" },
    { tool_name: "mcp__plugin_dpf-platform_dpf__heartbeat_workroom", tool_response: JSON.stringify({ capsule: capsule({ worktreePath: "Z:/does/not/exist" }) }) },
  ]) {
    assert.equal(run(hookPath, payload), "", JSON.stringify(payload).slice(0, 80));
  }
});
