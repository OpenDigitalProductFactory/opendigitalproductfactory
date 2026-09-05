// Who is actually working in a worktree — answered by the PLATFORM, not by a client.
//
// The reaper's one guarantee is "never reap an in-use worktree". Until now that
// rested entirely on `.dpf-session-heartbeat.json`, a file written by a Claude
// Code plugin hook (packages/dpf-skill-pack/hooks/hooks.json). Codex, Grok and
// Build Studio write nothing, so for three of four surfaces the guard read
// "no heartbeat" as "no live session" when it meant "no client writing
// heartbeats" — and failed OPEN.
//
// On 2026-09-02 that reaped the worktrees of 24 workrooms that were still
// active, including a codex-desktop room touched minutes earlier. Committed work
// survived (Tier-A also requires merged+clean), but live threads lost their
// working directories.
//
// This is the commandment applied to the reaper itself: a platform guarantee may
// not depend on a client artifact
// (docs/founder-kernel/wiki/principles/platform-function-never-depends-on-a-client.md).
// The Workroom claim is the platform's own record of who owns which worktree, and
// it is the same record every surface writes to — so it answers for all four.
//
// FAIL SAFE, NOT FAIL OPEN. If the claim record cannot be read — no token, portal
// down, MCP error — this returns `available: false`, and the classifier must then
// refuse to reap rather than assume nothing is live. Absence of evidence is not
// evidence of absence, and the previous code made exactly that mistake twice
// (this signal, and the lease payload, which returns "" without a token).

import { spawnSync } from "node:child_process";

/** Statuses that mean a room still owns its worktree. Anything terminal is not here. */
export const ACTIVE_WORKROOM_STATUSES = Object.freeze([
  "draft",
  "ready",
  "working",
  "verifying",
  "ready-for-review",
  "ready-for-promotion",
  "blocked",
]);

/** Normalise for comparison: Windows and git disagree about separators and case. */
export function normalizePath(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Extract worktree paths of non-terminal Workrooms from an MCP response.
 * Tolerant of shape: the payload may be JSON-RPC, SSE-wrapped, or a bare list.
 *
 * @returns {{ available: boolean, activePaths: Set<string>, reason: string }}
 */
export function parseActiveWorktreePaths(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { available: false, activePaths: new Set(), reason: "empty response" };
  }

  // Pull every {"worktreePath": "...", ... "status": "..."} pairing out of the
  // payload without depending on the envelope, which differs between the
  // JSON-RPC and SSE transports.
  let text = raw;
  const dataLine = raw.split(/\r?\n/).find((l) => l.startsWith("data:"));
  if (dataLine) text = dataLine.slice(5).trim();

  let rooms;
  try {
    rooms = collectRooms(JSON.parse(text));
  } catch {
    return { available: false, activePaths: new Set(), reason: "unparseable response" };
  }

  if (rooms === null) {
    return { available: false, activePaths: new Set(), reason: "no workroom list in response" };
  }

  const active = new Set();
  for (const room of rooms) {
    const path = normalizePath(room.worktreePath);
    if (!path) continue;
    if (ACTIVE_WORKROOM_STATUSES.includes(String(room.status ?? "").trim())) {
      active.add(path);
    }
  }
  return { available: true, activePaths: active, reason: `${rooms.length} workroom(s) read` };
}

/** Walk an arbitrary JSON shape for objects carrying a worktreePath. */
function collectRooms(node, found = []) {
  if (node === null || typeof node !== "object") return found.length > 0 ? found : null;
  if (Array.isArray(node)) {
    for (const item of node) collectRooms(item, found);
    return found.length > 0 ? found : null;
  }
  if ("worktreePath" in node) found.push(node);
  // MCP wraps tool output as {content:[{type:"text",text:"<json>"}]}.
  if (typeof node.text === "string" && node.text.includes("worktreePath")) {
    try {
      collectRooms(JSON.parse(node.text), found);
    } catch {
      /* a non-JSON text block is not a failure of the whole parse */
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectRooms(value, found);
  }
  return found.length > 0 ? found : null;
}

/**
 * Ask the platform which worktrees are claimed. Never throws.
 *
 * @returns {{ available: boolean, activePaths: Set<string>, reason: string }}
 */
export function loadActiveWorkroomPaths(options = {}) {
  const env = options.env ?? process.env;
  const run = options.run ?? spawnSync;
  const token = env.DPF_MCP_BEARER_TOKEN;

  if (!token) {
    // Deliberately NOT an empty success. Without a token the platform cannot be
    // asked who is working, and guessing "nobody" is how live worktrees died.
    return { available: false, activePaths: new Set(), reason: "no DPF_MCP_BEARER_TOKEN" };
  }

  const url = env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1";
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "list_workrooms", arguments: {} },
  });

  let result;
  try {
    result = run(
      "curl",
      [
        "-sS", "-X", "POST", url,
        "-H", `Authorization: Bearer ${token}`,
        "-H", "Content-Type: application/json",
        "-H", "Accept: application/json, text/event-stream",
        "--max-time", "20",
        "-d", body,
      ],
      { encoding: "utf8", windowsHide: true },
    );
  } catch (err) {
    return {
      available: false,
      activePaths: new Set(),
      reason: `workroom query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!result || result.status !== 0) {
    return { available: false, activePaths: new Set(), reason: "workroom query returned non-zero" };
  }
  return parseActiveWorktreePaths(String(result.stdout ?? ""));
}

/** Is this worktree claimed by a live Workroom? */
export function pathHasActiveClaim(activePaths, worktreePath) {
  if (!(activePaths instanceof Set) || activePaths.size === 0) return false;
  return activePaths.has(normalizePath(worktreePath));
}
