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
import { resolveHostMcpTrust } from "./mcp-host-trust.mjs";

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
/** Fresh observations after an expired one. Each restart discards every claim read so far. */
const MAX_RESTARTS = 2;
/** Server codes meaning "this observation is gone, start a new one" — not an outage. */
const RESTART_CODES = new Set(["snapshot_expired", "snapshot_unavailable"]);
const ROOM_STATUSES = new Set([...ACTIVE_WORKROOM_STATUSES, "complete", "abandoned", "archived"]);

class ObservationExpired extends Error {}

const releasedNote = released => (released.count ? `, ${released.count} non-live claim(s) released` : "");

function readToolResult(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("empty response");
  const dataLine = raw.split(/\r?\n/).find(line => line.startsWith("data:"));
  const rpc = JSON.parse(dataLine ? dataLine.slice(5).trim() : raw);
  // A JSON-RPC error is an object; a bare tool failure carries a string code.
  if (rpc.error && typeof rpc.error === "object") throw new Error("MCP error response");
  const result = extractToolResult(rpc);
  if (RESTART_CODES.has(result?.error)) {
    throw new ObservationExpired(`workroom observation ${result.error === "snapshot_expired" ? "expired" : "evicted"}`);
  }
  if (rpc.result?.isError) throw new Error("MCP error response");
  return result;
}

/** A path the row itself proves: present, not shortened, and null or non-empty. */
function rowCarriesPath(row) {
  return Object.hasOwn(row, "worktreePath")
    && (row.worktreePath === null || (typeof row.worktreePath === "string" && row.worktreePath.trim() !== ""))
    && !row.shortenedFields?.includes("worktreePath");
}

/** The governed detail read named by the row itself, and only for that row. */
function detailArguments(row) {
  const detail = row.detail;
  return detail?.toolName === "get_workroom" && detail.arguments?.capsuleId === row.capsuleId
    ? { capsuleId: row.capsuleId } : null;
}

/**
 * Read only known envelopes. Arbitrary nested path objects are not an inventory.
 * A compact row without a provable path is accepted only when `allowDetail` and
 * the row names its own detail read; the caller must then resolve it.
 */
function readObservation(raw, { allowDetail = false } = {}) {
  const result = readToolResult(raw);
  const data = result?.data ?? result;
  if (!data || result.success === false || result.isError || data._truncated || data.truncated) {
    throw new Error("failed or truncated workroom observation");
  }
  const rooms = data.capsules ?? data.workrooms;
  if (!Array.isArray(rooms)) throw new Error("no workroom list in response");
  for (const row of rooms) {
    if (!row || typeof row.capsuleId !== "string" || !row.capsuleId || !ROOM_STATUSES.has(row.status)) {
      throw new Error("missing workroom ownership identity");
    }
    if (!rowCarriesPath(row) && !(allowDetail && detailArguments(row))) {
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

/**
 * The server's own verdict that this room is dead (lease expired past the pause
 * grace, build or execution terminal, idle past the floor, or delivered) —
 * computed once, in apps/web/lib/work-capsules/liveness.ts. A non-terminal
 * status alone kept 391 lease-expired rooms' trees on 2026-10-27 (BI-CAA84E43).
 * Only a plain, unshortened `true` releases: anything else keeps the claim.
 */
function serverSaysReapable(row) {
  return row.isReapable === true && !row.shortenedFields?.includes("isReapable");
}

/** Adds proven paths; returns active rows whose path only their detail read can prove. */
function addOwners(rooms, paths, ids, released = { count: 0 }) {
  const unresolved = [];
  for (const row of rooms) {
    if (ids.has(row.capsuleId)) throw new Error("duplicate workroom in observation");
    ids.add(row.capsuleId);
    if (!ACTIVE_WORKROOM_STATUSES.includes(row.status)) continue;
    if (serverSaysReapable(row)) {
      released.count++;
      continue;
    }
    if (!rowCarriesPath(row)) unresolved.push(row);
    else if (row.worktreePath !== null) paths.add(normalizePath(row.worktreePath));
  }
  return unresolved;
}

/**
 * The detail must be the same room and carry a definite path. A room that was
 * active when observed keeps its claim even if the detail now reads terminal:
 * the protective reading, since the two reads are not one snapshot.
 */
function readDetailPath(raw, row) {
  const result = readToolResult(raw);
  const data = result?.data ?? result;
  const capsule = data?.capsule ?? data?.workroom;
  if (!capsule || result.success === false || capsule.capsuleId !== row.capsuleId
    || !ROOM_STATUSES.has(capsule.status) || !rowCarriesPath(capsule)) {
    throw new Error(`workroom detail for ${row.capsuleId} has no ownership identity`);
  }
  return capsule.worktreePath;
}

export function parseActiveWorktreePaths(raw) {
  try {
    const { rooms, page } = readObservation(raw);
    if (page && (page.disposition !== "complete" || page.populationCount !== rooms.length)) {
      throw new Error("incomplete workroom observation");
    }
    const activePaths = new Set(), released = { count: 0 };
    addOwners(rooms, activePaths, new Set(), released);
    return { available: true, activePaths, reason: `${rooms.length} workroom(s) read${releasedNote(released)}` };
  } catch (error) { return unavailable(error.message); }
}

/** Every page of ONE observation, or a throw. Never returns a partial population. */
async function traverseObservation(callTool) {
  const paths = new Set(), ids = new Set(), cursors = new Set(), unresolved = [], released = { count: 0 };
  let cursor, observation;
  for (let pages = 0; pages <= MAX_ROOMS; pages++) {
    const text = await callTool("list_workrooms", { limit: 100, ...(cursor ? { cursor } : {}) });
    const { rooms, page } = readObservation(text, { allowDetail: true });
    if (cursor && !page) throw new Error("workroom continuation lost its observation");
    if (page) {
      const identity = JSON.stringify([page.observationId, page.observedAt, page.populationCount]);
      if (observation && observation !== identity) throw new Error("workroom observation changed during traversal");
      observation = identity;
    }
    unresolved.push(...addOwners(rooms, paths, ids, released));
    if (ids.size > MAX_ROOMS || (page && ids.size > page.populationCount)) throw new Error("workroom count exceeded observation");
    if (!page || page.disposition === "complete") {
      if (page && ids.size !== page.populationCount) throw new Error("incomplete workroom observation");
      return { paths, unresolved, count: ids.size, released };
    }
    if (cursors.has(page.nextCursor)) throw new Error("workroom cursor loop");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error("workroom observation page budget exceeded");
}

/**
 * Ask the platform which worktrees are claimed. Never rejects.
 *
 * Traverses every page of one observation; an expired observation restarts the
 * traversal (bounded). Rows whose page omits or shortens the path are resolved
 * through the row's own `get_workroom` detail read (BI-83345811). Any read that
 * does not complete returns `available: false`.
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
    // Resolve the install's saved connection once for the whole observation.
    // Otherwise each HTTPS page starts a host shell to rediscover the same CA.
    // The transport still rereads and validates that bundle on every request;
    // no certificate, credential or authority decision is cached here.
    const transportEnv = new URL(url).protocol === "https:"
      ? (options.resolveTrust ?? resolveHostMcpTrust)({ mcpUrl: url, env }).env : env;
    const credential = (options.resolveCredential ?? resolveMcpCredential)({ mcpUrl: url, env: transportEnv });
    const deadline = Date.now() + READ_BUDGET_MS;
    const callTool = async (name, args) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("workroom observation read budget exceeded");
      const reply = await mcpPost("tools/call", { name, arguments: args }, {
        mcpUrl: url,
        env: transportEnv,
        bearerToken: credential.bearer,
        timeoutMs: Math.min(20_000, remaining),
        accept: "application/json, text/event-stream",
        fetchImpl: options.fetchImpl,
        // DPF_MCP_URL is operator intent; `env` may be an injected copy, so the
        // client's own process.env check cannot see it.
        allowNonLoopbackEndpoint: Boolean(env.DPF_MCP_URL),
      });
      if (reply.status < 200 || reply.status >= 300) throw new Error(`${name} returned HTTP ${reply.status}`);
      return reply.text;
    };

    let traversal;
    for (let attempt = 0; !traversal; attempt++) {
      try {
        traversal = await traverseObservation(callTool);
      } catch (err) {
        // An expired observation is restarted from nothing; claims read from it
        // are dropped with it, so no mixed population is ever returned.
        if (!(err instanceof ObservationExpired) || attempt >= MAX_RESTARTS) throw err;
      }
    }
    // Detail reads run after the listing so they cannot outlive its cursor.
    for (const row of traversal.unresolved) {
      const worktreePath = readDetailPath(await callTool("get_workroom", detailArguments(row)), row);
      if (worktreePath !== null) traversal.paths.add(normalizePath(worktreePath));
    }
    const resolved = traversal.unresolved.length ? `, ${traversal.unresolved.length} resolved by detail` : "";
    return {
      available: true,
      activePaths: traversal.paths,
      reason: `${traversal.count} workroom(s) read${resolved}${releasedNote(traversal.released)}`,
    };
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
