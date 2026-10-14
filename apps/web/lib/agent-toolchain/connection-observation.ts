import "server-only";

// BI-54469E18 — record what each MCP connection declared it loaded (design
// 2026-10-07-agent-toolchain-release-delivery §5.2b).
//
// Writes are coalesced to at most one per (credential, loaded digest) every
// five minutes ACROSS processes: an update guarded on `lastObservedAt` does
// nothing while the row is fresh, and a racing first insert loses on the
// unique key and is ignored. A per-process memo skips even that query on the
// hot path. Recording is fail-open: an observation can never fail a request.

import { deriveCallerClient } from "@/lib/mcp/caller-client";

import { credentialKindOf, parseToolchainDeclaration, type ToolchainDeclaration } from "./toolchain-verdict";

export const OBSERVATION_COALESCE_MS = 5 * 60 * 1000;
const UNDECLARED = "undeclared";
const MEMO_LIMIT = 2_000;

export type ObservationAuthSource = "oauth" | "pat" | "session-jwt";

export type ObservationInput = {
  credentialRef: string;
  declaration: ToolchainDeclaration | null;
  authSource: ObservationAuthSource;
  probableClient: string | null;
  clientInfo: { name: string | null; version: string | null } | null;
  now: Date;
};

type ObservationDb = {
  agentToolchainObservation: {
    updateMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<unknown>;
  };
};

const memo = new Map<string, number>();

function authMode(source: ObservationAuthSource): "oauth" | "bearer" | "session" {
  return source === "oauth" ? "oauth" : source === "pat" ? "bearer" : "session";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Upsert one observation, coalesced. Returns whether a write was attempted. */
export async function recordToolchainObservation(db: ObservationDb, input: ObservationInput): Promise<boolean> {
  const loadedDigest = input.declaration?.digest ?? UNDECLARED;
  const key = `${input.credentialRef}\u0000${loadedDigest}`;
  const now = input.now.getTime();
  const last = memo.get(key);
  if (last !== undefined && now - last < OBSERVATION_COALESCE_MS) return false;
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, now);

  const facts = {
    clientKind: input.declaration?.client ?? UNDECLARED,
    probableClient: input.probableClient,
    loadedPackVersion: input.declaration?.pack ?? null,
    authMode: authMode(input.authSource),
    ...(input.clientInfo ? { clientInfoName: input.clientInfo.name, clientInfoVersion: input.clientInfo.version } : {}),
    lastObservedAt: input.now,
  };
  const updated = await db.agentToolchainObservation.updateMany({
    where: {
      credentialRef: input.credentialRef,
      loadedDigest,
      lastObservedAt: { lt: new Date(now - OBSERVATION_COALESCE_MS) },
    },
    data: facts,
  });
  if (updated.count > 0) return true;
  try {
    await db.agentToolchainObservation.create({
      data: { credentialRef: input.credentialRef, loadedDigest, ...facts, firstObservedAt: input.now },
    });
  } catch (error) {
    // The row exists and is still fresh, or another process inserted it first.
    if (!isUniqueViolation(error)) throw error;
  }
  return true;
}

/** Test seam. */
export function _resetObservationMemo(): void {
  memo.clear();
}

type CredentialLookupDb = {
  mcpApiToken: {
    findUnique(args: unknown): Promise<{
      oauthClientId: string | null;
      kind: string | null;
      oauthClient?: { registrationKind: string; clientName: string } | null;
    } | null>;
  };
};

const credentialCache = new Map<string, { credentialRef: string; credentialKind: string | null }>();

/**
 * The stable credential identity for a token. OAuth access tokens rotate
 * hourly, so they resolve to their OAuth client; a bearer token is itself.
 * Session-JWT callers (portal coworkers) are not agent clients and get none.
 */
export async function resolveCredentialRef(
  db: CredentialLookupDb,
  token: { tokenId: string; source: ObservationAuthSource },
): Promise<{ credentialRef: string; credentialKind: string | null } | null> {
  if (token.source === "session-jwt") return null;
  const cached = credentialCache.get(token.tokenId);
  if (cached) return cached;
  const row = await db.mcpApiToken.findUnique({
    where: { id: token.tokenId },
    select: { oauthClientId: true, kind: true, oauthClient: { select: { registrationKind: true, clientName: true } } },
  });
  const credentialKind = credentialKindOf(row?.kind, row?.oauthClient);
  const resolved =
    token.source === "oauth" && row?.oauthClientId
      ? { credentialRef: `oauth:${row.oauthClientId}`, credentialKind }
      : { credentialRef: `token:${token.tokenId}`, credentialKind };
  if (credentialCache.size >= MEMO_LIMIT) credentialCache.clear();
  credentialCache.set(token.tokenId, resolved);
  return resolved;
}

/** `params.clientInfo` from an initialize call, bounded. */
export function readClientInfo(params: unknown): { name: string | null; version: string | null } | null {
  const info = (params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined)?.clientInfo;
  if (!info || typeof info !== "object") return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null);
  return { name: text(info.name), version: text(info.version) };
}

/**
 * Record this request's connection, fail-open. Called once per MCP POST after
 * authentication; returns immediately and never throws to the caller.
 */
export function observeConnection(input: {
  request: Request;
  token: { tokenId: string; source: ObservationAuthSource };
  method: string;
  params: unknown;
}): void {
  void (async () => {
    const { prisma } = await import("@dpf/db");
    const credential = await resolveCredentialRef(prisma as never, input.token);
    if (!credential) return;
    await recordToolchainObservation(prisma as never, {
      credentialRef: credential.credentialRef,
      declaration: parseToolchainDeclaration(input.request.url, input.request.headers),
      authSource: input.token.source,
      probableClient: deriveCallerClient(input.request.headers.get("user-agent")) ?? null,
      clientInfo: input.method === "initialize" ? readClientInfo(input.params) : null,
      now: new Date(),
    });
  })().catch((error: unknown) => {
    console.warn("[agent-toolchain] connection observation skipped:", error);
  });
}
