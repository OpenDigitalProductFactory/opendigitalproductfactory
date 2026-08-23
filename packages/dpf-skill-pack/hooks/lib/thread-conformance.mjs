// packages/dpf-skill-pack/hooks/lib/thread-conformance.mjs
//
// The single computation of "is this thread governed yet?" (BI-21B04901).
//
// WHY THIS EXISTS
// A thread could begin substantive work with no doctrine in context, no
// authenticated MCP, and no workroom — and nothing detected it. Measured
// 2026-08-22: doctrine inert in 70 of 80 worktrees, HTTP 401 in every
// worktree, 0 of 80 worktrees holding a live capsule.
//
// ONE COMPUTATION, TWO FACES
// The session-start banner is the READABLE face of this module; the PreToolUse
// guards (BI-865E1755) are its ENFORCING face. Both import from here so what a
// thread is told and what it is blocked on cannot diverge. A banner that says
// one thing while a guard enforces another is worse than no banner.
//
// PRESENCE IS NOT LIVENESS
// Every check proves behaviour, never structure: MCP is probed for a real HTTP
// 200, not for an env var; a workroom is checked for a LIVE lease, not for a
// row. `unknown` means "could not be evaluated" and is NOT a pass — under a
// deny failurePolicy the enforcing face treats it as failure. The readable
// face reports it honestly as unproven.
//
// This module performs NO writes and NO repairs.

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Ordered — the work shape is a sequence, and the first unmet step is the only one that matters. */
export const STEP_KEYS = ["worktree", "doctrine", "mcp", "workroom", "backlog"];

const DEFAULT_MCP_URL = "http://127.0.0.1:3000/api/mcp/v1";
const PROBE_TIMEOUT_MS = 4000;

function defaultGit(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** POST one JSON-RPC call. Returns { httpStatus, json } — never throws. */
async function defaultMcpCall(method, params, { env }) {
  const token = env.DPF_MCP_BEARER_TOKEN;
  const url = env.DPF_MCP_URL || DEFAULT_MCP_URL;
  if (!token) return { httpStatus: 0, json: null, reason: "no-token" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* a 401 body is not always JSON; the status is what matters */
    }
    return { httpStatus: res.status, json };
  } catch {
    return { httpStatus: 0, json: null, reason: "unreachable" };
  }
}

function step(key, label, status, detail, remediation, failurePolicy = "deny") {
  return { key, label, status, detail, remediation, failurePolicy };
}

// --- individual checks -------------------------------------------------------

function checkWorktree({ cwd, git }) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (!top) {
    return step("worktree", "worktree", "unknown", "not a git working tree", "Start the session inside a DPF worktree.");
  }
  const norm = top.replace(/\\/g, "/");
  // A linked worktree has .git as a FILE; the root clone has it as a DIRECTORY.
  const isLinked = isGitFile(join(top, ".git"));
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);

  if (!isLinked) {
    return step(
      "worktree",
      "worktree",
      "fail",
      `root clone (${norm})`,
      "Take your own worktree:  git worktree add ~/dpf-worktrees/<slug> -b <prefix>/<slug> origin/main",
    );
  }
  if (norm.includes("/.claude/worktrees/")) {
    return step(
      "worktree",
      "worktree",
      "fail",
      `tool-native nesting (${norm})`,
      "Move to the canonical base ~/dpf-worktrees/<slug> — AGENTS.md §12.",
    );
  }
  if (branch === "main" || branch === "HEAD") {
    return step("worktree", "worktree", "fail", `on ${branch}`, "Branch first:  git switch -c <prefix>/<slug>");
  }
  return step("worktree", "worktree", "pass", `${norm} (${branch})`, null);
}

function isGitFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Doctrine is loaded when the pointer actually imports the rulebook.
 * A prose link loads nothing — that is the 70-of-80 defect. Phase 3
 * (BI-E659ED37) replaces this proxy with an assertion on injected content.
 */
function checkDoctrine({ cwd, git }) {
  const top = git(["rev-parse", "--show-toplevel"], cwd) || cwd;
  const pointer = join(top, "CLAUDE.md");
  const rulebook = join(top, "AGENTS.md");
  if (!existsSync(rulebook)) {
    return step("doctrine", "doctrine", "fail", "AGENTS.md missing from this tree", "Refresh the worktree base from origin/main.");
  }
  if (!existsSync(pointer)) {
    return step("doctrine", "doctrine", "fail", "CLAUDE.md missing — nothing imports the rulebook", "Refresh the worktree base from origin/main.");
  }
  const body = safeRead(pointer);
  if (!/^@AGENTS\.md\s*$/m.test(body || "")) {
    return step(
      "doctrine",
      "doctrine",
      "fail",
      "CLAUDE.md does not import AGENTS.md (pre-#4477 prose pointer) — NO doctrine is loaded",
      "Refresh this worktree onto current main, or restore the '@AGENTS.md' import line in CLAUDE.md.",
    );
  }
  return step("doctrine", "doctrine", "pass", "AGENTS.md imported by CLAUDE.md", null);
}

function safeRead(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

async function checkMcp({ env, mcpCall }) {
  const { httpStatus, reason } = await mcpCall("tools/list", {}, { env });
  if (httpStatus === 200) return step("mcp", "governed MCP", "pass", "authenticated (HTTP 200)", null);
  if (httpStatus === 401 || httpStatus === 403) {
    return step(
      "mcp",
      "governed MCP",
      "fail",
      `token rejected (HTTP ${httpStatus})`,
      "bash scripts/dpf-bootstrap-agent-toolchain.sh   # repairs the client environment and re-probes",
    );
  }
  if (reason === "no-token") {
    return step(
      "mcp",
      "governed MCP",
      "fail",
      "no token in this process environment (a shell may still have one)",
      "bash scripts/dpf-bootstrap-agent-toolchain.sh   # injects the token for GUI-launched clients",
    );
  }
  return step("mcp", "governed MCP", "unknown", "endpoint unreachable — authentication NOT proven", "Start the portal, then restart this session.");
}

/** Parse list_workrooms, which returns its payload as JSON inside a text content block. */
function capsulesFrom(json) {
  try {
    const text = json?.result?.content?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text)?.data?.capsules ?? null;
  } catch {
    return null;
  }
}

/**
 * Read backlogItemId off a get_workroom response.
 * Returns the id, null when genuinely unbound, or undefined when unresolvable.
 */
function boundBacklogItem(json) {
  if (!json) return undefined;
  const direct = json?.result?.capsule?.backlogItemId;
  if (direct !== undefined) return direct ?? null;
  try {
    const text = json?.result?.content?.[0]?.text;
    if (!text) return undefined;
    const parsed = JSON.parse(text);
    const v = parsed?.capsule?.backlogItemId ?? parsed?.data?.capsule?.backlogItemId;
    return v === undefined ? undefined : (v ?? null);
  } catch {
    return undefined;
  }
}

async function checkWorkroomAndBacklog({ cwd, git, env, mcpCall, mcpPassed }) {
  const notProven = (key, label) =>
    step(key, label, "unknown", "cannot be checked while governed MCP is down", "Restore governed MCP first (step 3).");

  if (!mcpPassed) return [notProven("workroom", "workroom"), notProven("backlog", "BI coverage")];

  const top = (git(["rev-parse", "--show-toplevel"], cwd) || cwd).replace(/\\/g, "/");
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const { json } = await mcpCall("tools/call", { name: "list_workrooms", arguments: {} }, { env });
  const capsules = capsulesFrom(json);
  if (!capsules) return [notProven("workroom", "workroom"), notProven("backlog", "BI coverage")];

  const mine = capsules.find(
    (c) => c?.isLive && ((c.worktreePath || "").replace(/\\/g, "/") === top || (branch && c.headBranch === branch)),
  );

  if (!mine) {
    return [
      step(
        "workroom",
        "workroom",
        "fail",
        "no live workroom claims this worktree",
        `claim_backlog_item_for_work(itemId=<BI>, worktreePath="${top}", branchName="${branch}", provider="claude", sessionRef=<session>)`,
      ),
      step("backlog", "BI coverage", "fail", "no workroom, so no BI is bound", "Claim the workroom first (step 4)."),
    ];
  }

  const wr = step("workroom", "workroom", "pass", `${mine.capsuleId} (${mine.livenessReason || "live"})`, null);

  // list_workrooms does NOT project backlogItemId — reading it off the list
  // shape reports MISSING for a capsule that IS bound. Under a deny policy that
  // false negative blocks editing on a conformant thread, so resolve the
  // capsule properly. An unresolvable capsule is `unknown`, never a false fail.
  const detail = await mcpCall("tools/call", { name: "get_workroom", arguments: { capsuleId: mine.capsuleId } }, { env });
  const bound = boundBacklogItem(detail.json);
  if (bound === undefined) {
    return [wr, step("backlog", "BI coverage", "unknown", `could not resolve ${mine.capsuleId}`, "Retry, or check governed MCP.")];
  }
  const bi = bound
    ? step("backlog", "BI coverage", "pass", String(bound), null)
    : step(
        "backlog",
        "BI coverage",
        "fail",
        `${mine.capsuleId} is bound to no backlog item`,
        "File or claim a BI:  claim_backlog_item_for_work(itemId=<BI>, ...)",
      );
  return [wr, bi];
}

// --- public API --------------------------------------------------------------

/**
 * Evaluate the five-step work shape for this thread.
 * Dependencies are injectable so the checks are testable without a live host.
 */
export async function evaluateThreadConformance({
  cwd = process.cwd(),
  env = process.env,
  git = defaultGit,
  mcpCall = defaultMcpCall,
} = {}) {
  const worktree = checkWorktree({ cwd, git });
  const doctrine = checkDoctrine({ cwd, git });
  const mcp = await checkMcp({ env, mcpCall });
  const [workroom, backlog] = await checkWorkroomAndBacklog({
    cwd,
    git,
    env,
    mcpCall,
    mcpPassed: mcp.status === "pass",
  });

  const steps = [worktree, doctrine, mcp, workroom, backlog];
  const firstUnmet = steps.find((s) => s.status !== "pass") ?? null;
  return {
    steps,
    firstUnmet,
    readyCount: steps.filter((s) => s.status === "pass").length,
    total: steps.length,
    /** True only when every step passes. `unknown` never counts as governed. */
    governed: steps.every((s) => s.status === "pass"),
  };
}

const GLYPH = { pass: "OK", fail: "MISSING", unknown: "UNPROVEN" };

/**
 * Render the readable face. Deliberately short: one ordered checklist and a
 * remediation for the FIRST unmet step only. Ten accurate paragraphs nobody
 * reads are a defect, not thoroughness.
 */
export function formatWorkShapeBanner(result) {
  const lines = [`DPF WORK SHAPE — ${result.readyCount} of ${result.total} ready`];
  result.steps.forEach((s, i) => {
    const label = `${i + 1}. ${s.label}`.padEnd(20, ".");
    const state = GLYPH[s.status] ?? s.status;
    lines.push(`  ${label} ${state}${s.detail ? `   ${s.detail}` : ""}`);
  });
  if (result.firstUnmet) {
    lines.push(`  -> Next: ${result.firstUnmet.label}`);
    if (result.firstUnmet.remediation) lines.push(`     ${result.firstUnmet.remediation}`);
    if (result.firstUnmet.failurePolicy === "deny") {
      lines.push(`     Editing is blocked until step ${result.steps.indexOf(result.firstUnmet) + 1} passes.`);
    }
  }
  return lines;
}
