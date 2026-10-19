// A Workroom's agent-CLI session credential (BI-05715F4C, design
// 2026-10-07-durable-delegation-ledger-design.md §4.7).
//
// Each supervised CLI session gets its own MCP bearer token, issued by the room
// and revoked by it. The token is an McpApiToken row (kind workroom_session),
// hashed like every other, with its own `dpfroom_` prefix: the PAT and OAuth
// resolvers only accept their own prefixes, so this token is never read as a
// general credential, and it resolves even where PATs are retired. Authority
// comes from the room, not from a pasted PAT: the MCP route refuses it for any
// other room (workroomBindingRefusal), it expires after a day without use, and
// the room revokes it when the session stops, the executor changes or the room
// reaches a terminal status.

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@dpf/db";
import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";

import type { ResolvedMcpToken } from "./mcp-api-token";

export const WORKROOM_SESSION_TOKEN_KIND = "workroom_session";
const TOKEN_PREFIX = "dpfroom_";
const IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * What a supervised CLI session may do through DPF: read the room and its
 * backlog context, and write the room's own record. Anything wider stays behind
 * the owner's own connection.
 */
export const WORKROOM_SESSION_SCOPES = [
  "work_capsule_read",
  "work_capsule_write",
  "workroom_evidence_write",
  "backlog_read",
  "spec_plan_read",
  "file_read",
  "registry_read",
] as const;

export type ResolvedWorkroomSessionToken = ResolvedMcpToken & {
  workroomRef: string;
  runRef: string | null;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function issueWorkroomSessionToken(input: {
  userId: string;
  agentId: string | null;
  capsuleId: string;
  runRef: string | null;
  now?: Date;
}): Promise<{ tokenId: string; plaintext: string }> {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const now = input.now ?? new Date();
  const row = await prisma.mcpApiToken.create({
    data: {
      userId: input.userId,
      agentId: coworkerAuthorityAgentId(input.agentId ?? "") || null,
      kind: WORKROOM_SESSION_TOKEN_KIND,
      workroomRef: input.capsuleId,
      runRef: input.runRef,
      name: `room:${input.capsuleId}${input.runRef ? ` run:${input.runRef}` : ""}`,
      tokenHash: sha256(plaintext),
      prefix: plaintext.slice(0, 12),
      tokenSuffix: plaintext.slice(-4),
      scopes: [...WORKROOM_SESSION_SCOPES],
      capability: "write",
      scope: "write",
      expiresAt: new Date(now.getTime() + IDLE_EXPIRY_MS),
    },
    select: { id: true },
  });
  return { tokenId: row.id, plaintext };
}

/** Resolve a room session token; each use moves its idle expiry a day forward. */
export async function resolveWorkroomSessionToken(
  plaintext: string,
  now: Date = new Date(),
): Promise<ResolvedWorkroomSessionToken | null> {
  if (typeof plaintext !== "string" || !plaintext.startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.mcpApiToken.findUnique({ where: { tokenHash: sha256(plaintext) } });
  if (!row || row.kind !== WORKROOM_SESSION_TOKEN_KIND || !row.workroomRef) return null;
  if (row.revokedAt != null) return null;
  if (row.expiresAt != null && row.expiresAt.getTime() < now.getTime()) return null;
  // A room that ended takes its session's authority with it.
  const room = await prisma.workroom.findUnique({ where: { capsuleId: row.workroomRef }, select: { status: true, archivedAt: true } });
  if (!room || room.archivedAt || TERMINAL_WORKROOM_STATUSES.has(room.status)) return null;
  prisma.mcpApiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + IDLE_EXPIRY_MS) } })
    .catch(() => {});
  return {
    tokenId: row.id,
    userId: row.userId,
    agentId: row.agentId ? coworkerAuthorityAgentId(row.agentId) : null,
    scopes: [...row.scopes],
    scope: "write",
    capability: "write",
    workroomRef: row.workroomRef,
    runRef: row.runRef ?? null,
  };
}

/** Revoke a room's live session tokens: all of them, or one. Returns how many. */
export async function revokeWorkroomSessionTokens(input: {
  capsuleId: string;
  reason: string;
  tokenId?: string;
  now?: Date;
}): Promise<number> {
  const result = await prisma.mcpApiToken.updateMany({
    where: {
      kind: WORKROOM_SESSION_TOKEN_KIND,
      workroomRef: input.capsuleId,
      revokedAt: null,
      ...(input.tokenId ? { id: input.tokenId } : {}),
    },
    data: { revokedAt: input.now ?? new Date(), revokedReason: input.reason },
  });
  return result.count;
}

/** Room-scoped param names a bound token may only point at its own room. */
const ROOM_PARAMS = ["capsuleId", "workroomId"] as const;

/**
 * A room-bound token's call that names another room, refused before it runs.
 * Null when the call is in bounds (or the token is not room-bound).
 */
export function workroomBindingRefusal(
  token: { workroomRef?: string | null },
  args: Record<string, unknown>,
): { success: false; error: "workroom_scope_mismatch"; message: string } | null {
  if (!token.workroomRef) return null;
  for (const key of ROOM_PARAMS) {
    const value = args[key];
    if (typeof value === "string" && value.trim() && value.trim() !== token.workroomRef) {
      return {
        success: false,
        error: "workroom_scope_mismatch",
        message: `This session's credential is scoped to Workroom ${token.workroomRef}; it cannot act on ${value.trim()}.`,
      };
    }
  }
  return null;
}
