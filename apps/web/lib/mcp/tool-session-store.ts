// apps/web/lib/mcp/tool-session-store.ts
//
// Per-token deferred-tool-loading store (BI-D8101329, MCP tool-tier Phase 2).
// A short-TTL record, keyed by the MCP token id, of which extra tool names a
// model has pulled into scope via `load_tools`. `tools/list` reads it to APPEND
// those tools to the lean tier floor (append-not-swap). Discovery-only state:
// it carries NO authorization meaning — tools/call still gates on grants.
//
// The pure merge/expiry logic lives in tool-tier.ts (unit-tested there); this
// module is the thin Prisma wrapper around it.

import { prisma } from "@dpf/db";
import { mergeLoadedToolNames, isToolSessionExpired } from "./tool-tier";

/** Default session lifetime: long enough to span a working agentic loop,
 *  short enough that stale token sessions self-expire without a reaper. */
export const MCP_TOOL_SESSION_TTL_MS = 30 * 60_000;

/**
 * The tool names this token has loaded, or [] when there is no session or it
 * has expired. Expired rows read as empty (and are swept lazily) so a model
 * always starts from the lean floor after a gap.
 */
export async function getLoadedToolNames(tokenId: string, now: Date = new Date()): Promise<string[]> {
  // Fail-open: deferred loading is a discovery convenience, so any store hiccup
  // must degrade to the lean tier floor (empty set), never break tools/list.
  try {
    const row = await prisma.mcpToolSession.findUnique({ where: { tokenId } });
    if (!row) return [];
    if (isToolSessionExpired(row.expiresAt, now)) {
      // Lazy sweep: drop the expired row so it can't accumulate.
      await prisma.mcpToolSession.deleteMany({ where: { tokenId, expiresAt: row.expiresAt } });
      return [];
    }
    return row.loadedToolNames;
  } catch (err) {
    console.warn("[mcp/tool-session-store] getLoadedToolNames failed (fail-open):", err);
    return [];
  }
}

/**
 * Union `names` into the token's loaded set and (re)extend the TTL. Returns the
 * full merged, sorted set now loaded for this token. Idempotent on re-load.
 */
export async function loadToolsForSession(
  tokenId: string,
  names: readonly string[],
  now: Date = new Date(),
  ttlMs: number = MCP_TOOL_SESSION_TTL_MS,
): Promise<string[]> {
  const existing = await getLoadedToolNames(tokenId, now);
  const merged = mergeLoadedToolNames(existing, names);
  const expiresAt = new Date(now.getTime() + ttlMs);
  await prisma.mcpToolSession.upsert({
    where: { tokenId },
    create: { tokenId, loadedToolNames: merged, expiresAt },
    update: { loadedToolNames: merged, expiresAt },
  });
  return merged;
}

/** Delete every expired session row. Safe to call opportunistically. */
export async function sweepExpiredToolSessions(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.mcpToolSession.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}
