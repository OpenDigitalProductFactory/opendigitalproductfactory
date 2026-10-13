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

import { mcpPost, extractToolResult } from "./mcp-client.mjs";
import { resolveMcpCredential } from "./mcp-credential.mjs";

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
 * Supports JSON-RPC, SSE and direct tool results with explicit completeness.
 *
 * @returns {{ available: boolean, activePaths: Set<string>, reason: string }}
 */
const unavailable = (reason) => ({ available: false, activePaths: new Set(), reason });
const MAX_ROOMS = 10_000;
const READ_BUDGET_MS = 120_000;
const ROOM_STATUSES = new Set([...ACTIVE_WORKROOM_STATUSES, "complete", "abandoned", "archived"]);

/** Read only known envelopes. Arbitrary nested path objects are not an inventory. */
function readObservation(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("empty response");
  const dataLine = raw.split(/\r?\n/).find(line => line.startsWith("data:"));
  const rpc = JSON.parse(dataLine ? dataLine.slice(5).trim() : raw);
  if (rpc.error || rpc.result?.isError) throw new Error("MCP error response");
  const result = extractToolResult(rpc);
  const data = result?.data ?? result;
  if (!data || result.success === false || result.isError || data._truncated || data.truncated) {
    throw new Error("failed or truncated workroom observation");
  }
  const rooms = data.capsules ?? data.workrooms;
  if (!Array.isArray(rooms)) throw new Error("no workroom list in response");
  for (const row of rooms) {
    if (!row || typeof row.capsuleId !== "string" || !row.capsuleId
      || !ROOM_STATUSES.has(row.status)
      || !(row.worktreePath === null || (typeof row.worktreePath === "string" && row.worktreePath.trim()))
      || row.shortenedFields?.includes("worktreePath")) {
      throw new Error("missing or shortened workroom ownership identity");
    }
  }
  const page = data.page;
  if (page) {
    if (page.version !== 1 || page.ownershipScope !== "installation"
      || typeof page.observationId !== "string" || !page.observationId
      || typeof page.observedAt !== "string" || !Number.isFinite(Date.parse(page.observedAt))
      || !Number.isSafeInteger(page.populationCount) || page.populationCount < 0 || page.populationCount > MAX_ROOMS
      || page.pageCount !== rooms.length || rooms.length > page.populationCount
      || !["more", "complete"].includes(page.disposition)
      || (page.disposition === "more" ? !(typeof page.nextCursor === "string" && page.nextCursor && rooms.length)
        : page.nextCursor !== null)) throw new Error("invalid or scoped workroom observation page");
  } else if (data.truncated !== false || data.total !== rooms.length) {
    throw new Error("legacy inventory has no completeness proof");
  }
  return { rooms, page };
}

function addOwners(rooms, paths, ids) {
  for (const row of rooms) {
    if (ids.has(row.capsuleId)) throw new Error("duplicate workroom in observation");
    ids.add(row.capsuleId);
    if (ACTIVE_WORKROOM_STATUSES.includes(row.status) && row.worktreePath !== null) {
      paths.add(normalizePath(row.worktreePath));
    }
  }
}

export function parseActiveWorktreePaths(raw) {
  try {
    const { rooms, page } = readObservation(raw);
    if (page && (page.disposition !== "complete" || page.populationCount !== rooms.length)) {
      throw new Error("incomplete workroom observation");
    }
    const activePaths = new Set();
    addOwners(rooms, activePaths, new Set());
    return { available: true, activePaths, reason: `${rooms.length} workroom(s) read` };
  } catch (error) { return unavailable(error.message); }
}

/**
 * Ask the platform which worktrees are claimed. Never rejects.
 *
 * `fetchImpl` is the test seam; production goes through the shared MCP client
 * (scripts/lib/mcp-client.mjs) over node:http, with no curl dependency.
 *
 * @returns {Promise<{ available: boolean, activePaths: Set<string>, reason: string }>}
 */
export async function loadActiveWorkroomPaths(options = {}) {
  const env = options.env ?? process.env;
  const url = env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1";
  try {
    const credential = (options.resolveCredential ?? resolveMcpCredential)({ mcpUrl: url, env });
    const deadline = Date.now() + READ_BUDGET_MS;
    const paths = new Set(), ids = new Set(), cursors = new Set();
    let cursor, observation;
    for (let pages = 0; pages <= MAX_ROOMS; pages++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("workroom observation read budget exceeded");
      const reply = await mcpPost("tools/call", { name: "list_workrooms", arguments: {
        limit: 100, ...(cursor ? { cursor } : {}),
      } }, {
        mcpUrl: url,
        bearerToken: credential.bearer,
        timeoutMs: Math.min(20_000, remaining),
        accept: "application/json, text/event-stream",
        fetchImpl: options.fetchImpl,
        // DPF_MCP_URL is operator intent; `env` may be an injected copy, so the
        // client's own process.env check cannot see it.
        allowNonLoopbackEndpoint: Boolean(env.DPF_MCP_URL),
      });
      if (reply.status < 200 || reply.status >= 300) throw new Error(`workroom query returned HTTP ${reply.status}`);
      const { rooms, page } = readObservation(reply.text);
      if (cursor && !page) throw new Error("workroom continuation lost its observation");
      if (page) {
        const identity = JSON.stringify([page.observationId, page.observedAt, page.populationCount]);
        if (observation && observation !== identity) throw new Error("workroom observation changed during traversal");
        observation = identity;
      }
      addOwners(rooms, paths, ids);
      if (ids.size > MAX_ROOMS || (page && ids.size > page.populationCount)) throw new Error("workroom count exceeded observation");
      if (!page || page.disposition === "complete") {
        if (page && ids.size !== page.populationCount) throw new Error("incomplete workroom observation");
        return { available: true, activePaths: paths, reason: `${ids.size} workroom(s) read` };
      }
      if (cursors.has(page.nextCursor)) throw new Error("workroom cursor loop");
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new Error("workroom observation page budget exceeded");
  } catch (err) {
    return {
      available: false,
      activePaths: new Set(),
      reason: `workroom query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Is this worktree claimed by a live Workroom? */
export function pathHasActiveClaim(activePaths, worktreePath) {
  if (!(activePaths instanceof Set) || activePaths.size === 0) return false;
  return activePaths.has(normalizePath(worktreePath));
}
