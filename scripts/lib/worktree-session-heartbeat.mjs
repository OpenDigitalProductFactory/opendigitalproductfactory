// scripts/lib/worktree-session-heartbeat.mjs
//
// Worktree session heartbeat (EP-PROCESS-SPINE, plan 2026-08-11-worktree-lifecycle-hygiene).
//
// A live session writes a small, GITIGNORED marker into its worktree and refreshes
// it every turn (SessionStart + Stop) and removes it on SessionEnd. The fleet
// worktree janitor reads it as a liveness signal so it never reaps a worktree out
// from under a session that is still working in it — the "janitor reaped an active
// session's worktree mid-session" near-miss.
//
// It is deliberately a FILE, not a DB/MCP record: the janitor is a host Node script
// that may have no portal/DB view, and every CLI surface (Claude/Codex/Grok) shares
// the same host filesystem. The marker is gitignored so it never dirties the tree —
// which would otherwise both muddy the janitor's `dirty` signal and block a
// worktree's own Tier-A SessionEnd reap.
//
// Pure helpers + injectable fs so the janitor and the session hook share one
// contract and it stays exhaustively unit-testable.

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Gitignored marker filename written into each live worktree. */
export const HEARTBEAT_FILENAME = ".dpf-session-heartbeat.json";

/** Default liveness window. A session that has not had a turn (Stop) in this long
 *  is treated as idle and its worktree becomes reap-eligible again. Generous on
 *  purpose: erring toward NOT reaping a live session is the safe direction, and a
 *  truly dead session's clean+merged worktree is low-harm to keep for an hour. */
export const DEFAULT_TTL_MS = 60 * 60_000;

/** Small forward-clock tolerance so a marker written on a host whose clock is a
 *  little ahead of the janitor's is still read as live, not discarded. */
const FUTURE_SKEW_MS = 5 * 60_000;

/** @param {string} worktreePath */
export function heartbeatPath(worktreePath) {
  return join(worktreePath, HEARTBEAT_FILENAME);
}

/**
 * Resolve the liveness TTL in ms, honoring DPF_WORKTREE_SESSION_HEARTBEAT_TTL_MIN.
 * @param {Record<string, string | undefined>} [env]
 */
export function heartbeatTtlMs(env = process.env) {
  const raw = env?.DPF_WORKTREE_SESSION_HEARTBEAT_TTL_MIN;
  const mins = Number(raw);
  if (Number.isFinite(mins) && mins > 0) return mins * 60_000;
  return DEFAULT_TTL_MS;
}

/**
 * Parse raw marker text into a heartbeat record, or null when unreadable.
 * @param {string} raw
 * @returns {{ beatAt: number, pid?: number, sessionId?: string, startedAt?: number, event?: string } | null}
 */
export function parseHeartbeat(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj.beatAt === "number") {
      return obj;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Is this heartbeat record live at `now`? Pure.
 * @param {{ beatAt: number } | null | undefined} hb
 * @param {number} now  epoch ms
 * @param {number} [ttlMs]
 */
export function isHeartbeatLive(hb, now, ttlMs = DEFAULT_TTL_MS) {
  if (!hb || typeof hb.beatAt !== "number" || !Number.isFinite(hb.beatAt)) return false;
  if (hb.beatAt > now + FUTURE_SKEW_MS) return false; // implausibly future — ignore
  return now - hb.beatAt <= ttlMs;
}

/**
 * Read a worktree's heartbeat record, or null. Injectable fs for tests.
 * @param {string} worktreePath
 * @param {{ fs?: { existsSync: typeof existsSync, readFileSync: typeof readFileSync } }} [deps]
 */
export function readHeartbeat(worktreePath, deps = {}) {
  const fs = deps.fs ?? { existsSync, readFileSync };
  const p = heartbeatPath(worktreePath);
  if (!fs.existsSync(p)) return null;
  try {
    return parseHeartbeat(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * True when a worktree currently holds a fresh session heartbeat.
 * @param {string} worktreePath
 * @param {{ now?: number, ttlMs?: number, fs?: object }} [deps]
 */
export function isWorktreeSessionLive(worktreePath, deps = {}) {
  const now = deps.now ?? Date.now();
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  return isHeartbeatLive(readHeartbeat(worktreePath, deps), now, ttlMs);
}

// ── several sessions in one worktree (BI-296C9E24) ──────────────────────────
// Two sessions can share a worktree (a desktop session plus short CLI runs in
// the same folder). The marker used to hold one record that the last writer
// overwrote, and SessionEnd deleted it whatever its owner, so the session that
// was still working lost its liveness and an ending session's reap gutted its
// tree. The marker now keeps one entry per session under `sessions`, and the
// top-level fields mirror the freshest entry so existing readers
// (isWorktreeSessionLive, the fleet janitor) keep working unchanged.

const ANONYMOUS_SESSION = "(unknown)";

/** Per-session entries of a marker; a legacy single-record marker is one entry. */
function sessionEntries(hb) {
  if (!hb) return {};
  if (hb.sessions && typeof hb.sessions === "object") {
    const out = {};
    for (const [id, entry] of Object.entries(hb.sessions)) {
      if (entry && typeof entry.beatAt === "number") out[id] = entry;
    }
    return out;
  }
  return { [hb.sessionId || ANONYMOUS_SESSION]: hb };
}

/** Marker text for a set of per-session entries, or null when none remain. */
function markerFor(entries) {
  const ids = Object.keys(entries);
  if (!ids.length) return null;
  const freshest = ids.reduce((a, b) => (entries[b].beatAt > entries[a].beatAt ? b : a));
  const top = entries[freshest];
  return {
    beatAt: top.beatAt,
    startedAt: Math.min(...ids.map((id) => entries[id].startedAt ?? entries[id].beatAt)),
    pid: top.pid,
    sessionId: freshest === ANONYMOUS_SESSION ? undefined : freshest,
    event: top.event,
    sessions: entries,
  };
}

/**
 * Ids of OTHER sessions holding a fresh heartbeat in this worktree. A reap that
 * runs when one session ends must not remove a tree another session still uses.
 * An entry with no session id counts as another session (fail safe).
 * @param {string} worktreePath
 * @param {string | undefined} selfSessionId
 * @param {{ now?: number, ttlMs?: number, fs?: object }} [deps]
 * @returns {string[]}
 */
export function liveOtherSessionIds(worktreePath, selfSessionId, deps = {}) {
  const now = deps.now ?? Date.now();
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const entries = sessionEntries(readHeartbeat(worktreePath, deps));
  return Object.keys(entries).filter(
    (id) => (id === ANONYMOUS_SESSION || id !== selfSessionId) && isHeartbeatLive(entries[id], now, ttlMs),
  );
}

/**
 * Write/refresh this session's heartbeat entry. Preserves its `startedAt` across
 * beats and leaves other sessions' entries untouched. Never throws — returns
 * false on failure. Injectable fs.
 * @param {string} worktreePath
 * @param {{ now?: number, pid?: number, sessionId?: string, event?: string, fs?: object }} [deps]
 * @returns {boolean}
 */
export function writeHeartbeat(worktreePath, deps = {}) {
  const fs = deps.fs ?? { existsSync, readFileSync, writeFileSync };
  const now = deps.now ?? Date.now();
  const entries = sessionEntries(readHeartbeat(worktreePath, { fs }));
  const id = deps.sessionId || ANONYMOUS_SESSION;
  entries[id] = {
    beatAt: now,
    startedAt: entries[id]?.startedAt ?? now,
    pid: deps.pid ?? (typeof process !== "undefined" ? process.pid : undefined),
    event: deps.event,
  };
  try {
    fs.writeFileSync(heartbeatPath(worktreePath), `${JSON.stringify(markerFor(entries))}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a session's heartbeat entry (SessionEnd). With a sessionId only that
 * entry goes, and the file is deleted once no entry remains; without one the
 * whole marker is removed (legacy callers). Never throws.
 * @param {string} worktreePath
 * @param {{ sessionId?: string, fs?: object }} [deps]
 * @returns {boolean}
 */
export function removeHeartbeat(worktreePath, deps = {}) {
  const fs = deps.fs ?? { existsSync, readFileSync, writeFileSync, rmSync };
  try {
    if (deps.sessionId) {
      const entries = sessionEntries(readHeartbeat(worktreePath, { fs }));
      delete entries[deps.sessionId];
      const marker = markerFor(entries);
      if (marker) {
        fs.writeFileSync(heartbeatPath(worktreePath), `${JSON.stringify(marker)}\n`, "utf8");
        return true;
      }
    }
    fs.rmSync(heartbeatPath(worktreePath), { force: true });
    return true;
  } catch {
    return false;
  }
}
