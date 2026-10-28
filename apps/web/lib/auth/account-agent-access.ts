// Every agent credential one account still holds, and ending all of it in one
// governed act (BI-DB506554).
//
// An account handover moves work, not access (DI-F60AEA3E7D84), so a handed-over
// account keeps its personal tokens, its OAuth grants under every client, and
// any headless credentials client it owns, which mints tokens with no consent
// screen. The per-client People panel (oauth-client-people.ts) shows one client
// at a time. This shows one account across all of them (DI-ECD8C6F6FFB4: surface,
// not refuse) and ends them with the same attributed stamp the per-client
// control writes. User.isActive stays the switch that stops sign-in.

import type { prisma } from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import { personRevocation, type ClientPersonActor } from "./oauth-client-people";

type Db = typeof prisma;

export type AccountAgentAccessDb = {
  user: Pick<Db["user"], "findFirst">;
  mcpApiToken: Pick<Db["mcpApiToken"], "findMany" | "updateMany">;
  oAuthRefreshToken: Pick<Db["oAuthRefreshToken"], "findMany" | "updateMany">;
  oAuthClient: Pick<Db["oAuthClient"], "findMany" | "updateMany">;
  $transaction: Db["$transaction"];
};

export type AccountAgentAccess = {
  account: {
    userId: string;
    email: string;
    isActive: boolean;
    workHandedOverAt: string | null;
    isYou: boolean;
  };
  /** Tokens issued directly to the person, not through an OAuth client. */
  personalTokens: Array<{
    id: string; name: string; prefix: string; tokenSuffix: string | null; kind: string;
    lastUsedAt: string | null; expiresAt: string | null; createdAt: string;
  }>;
  /** Live OAuth access tokens and refresh grants, grouped by the client that holds them. */
  clientGrants: Array<{
    clientId: string; clientName: string; liveAccessTokens: number; liveRefreshGrants: number; lastUsedAt: string | null;
  }>;
  /** Headless clients this account owns: each mints tokens under its authority without a consent screen. */
  ownedCredentialsClients: Array<{ clientId: string; clientName: string; lastUsedAt: string | null; createdAt: string }>;
  totals: { personalTokens: number; oauthAccessTokens: number; refreshGrants: number; credentialsClients: number };
};

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

async function findAccount(db: AccountAgentAccessDb, account: string) {
  const key = account.trim();
  if (!key) return null;
  return db.user.findFirst({
    where: { OR: [{ id: key }, { email: key }] },
    select: { id: true, email: true, isActive: true, workHandedOverAt: true },
  });
}

export async function listAccountAgentAccess(
  db: AccountAgentAccessDb,
  input: { account: string; actor: ClientPersonActor; now?: Date },
): Promise<ActionResult<AccountAgentAccess>> {
  const user = await findAccount(db, input.account);
  if (!user) return err(`No account matches ${input.account.trim()}.`);
  const now = input.now ?? new Date();

  const [access, refresh, owned] = await Promise.all([
    db.mcpApiToken.findMany({
      where: { userId: user.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: {
        id: true, name: true, prefix: true, tokenSuffix: true, kind: true, oauthClientId: true,
        lastUsedAt: true, expiresAt: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.oAuthRefreshToken.findMany({
      where: { userId: user.id, revokedAt: null, consumedAt: null, expiresAt: { gt: now } },
      select: { oauthClientId: true },
    }),
    db.oAuthClient.findMany({
      where: { ownerUserId: user.id, registrationKind: "credentials", revokedAt: null },
      select: { oAuthClientId: true, clientName: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const personal = access.filter((t) => !t.oauthClientId);
  const grants = new Map<string, { liveAccessTokens: number; liveRefreshGrants: number; lastUsedAt: string | null }>();
  const grant = (rowId: string) => {
    let g = grants.get(rowId);
    if (!g) grants.set(rowId, (g = { liveAccessTokens: 0, liveRefreshGrants: 0, lastUsedAt: null }));
    return g;
  };
  for (const t of access) {
    if (!t.oauthClientId) continue;
    const g = grant(t.oauthClientId);
    g.liveAccessTokens += 1;
    const used = iso(t.lastUsedAt);
    if (used && (!g.lastUsedAt || used > g.lastUsedAt)) g.lastUsedAt = used;
  }
  for (const t of refresh) if (t.oauthClientId) grant(t.oauthClientId).liveRefreshGrants += 1;

  const clients = grants.size
    ? await db.oAuthClient.findMany({
      where: { id: { in: [...grants.keys()] } },
      select: { id: true, oAuthClientId: true, clientName: true },
    })
    : [];
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const clientGrants = [...grants.entries()]
    .map(([rowId, g]) => ({
      clientId: clientById.get(rowId)?.oAuthClientId ?? rowId,
      clientName: clientById.get(rowId)?.clientName ?? "Unknown client",
      ...g,
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.clientId.localeCompare(b.clientId));

  return ok({
    account: {
      userId: user.id,
      email: user.email,
      isActive: user.isActive,
      workHandedOverAt: iso(user.workHandedOverAt),
      isYou: user.id === input.actor.userId,
    },
    personalTokens: personal.map((t) => ({
      id: t.id, name: t.name, prefix: t.prefix, tokenSuffix: t.tokenSuffix ?? null, kind: t.kind,
      lastUsedAt: iso(t.lastUsedAt), expiresAt: iso(t.expiresAt), createdAt: t.createdAt.toISOString(),
    })),
    clientGrants,
    ownedCredentialsClients: owned.map((c) => ({
      clientId: c.oAuthClientId, clientName: c.clientName, lastUsedAt: iso(c.lastUsedAt), createdAt: c.createdAt.toISOString(),
    })),
    totals: {
      personalTokens: personal.length,
      oauthAccessTokens: access.length - personal.length,
      refreshGrants: refresh.length,
      credentialsClients: owned.length,
    },
  });
}

/**
 * End every agent credential one account holds: its tokens and refresh grants
 * under every client, and the headless credentials clients it owns. An
 * interactive registration it merely created stays, because other people may
 * hold grants under it; their access is theirs to lose, not this account's.
 */
export async function endAccountAgentAccess(
  db: AccountAgentAccessDb,
  input: { userId: string; reason: string; actor: ClientPersonActor; now?: Date },
): Promise<ActionResult<{ revokedAccessTokens: number; revokedRefreshTokens: number; revokedCredentialsClients: number }>> {
  const stamp = personRevocation(input);
  if (!stamp.ok) return stamp;
  const user = await findAccount(db, input.userId);
  if (!user || user.id !== input.userId) return err("Unknown account.");

  const where = { userId: user.id, revokedAt: null };
  const [accessTokens, refreshTokens, clients] = await db.$transaction([
    db.mcpApiToken.updateMany({ where, data: stamp.data }),
    db.oAuthRefreshToken.updateMany({ where, data: stamp.data }),
    db.oAuthClient.updateMany({
      where: { ownerUserId: user.id, registrationKind: "credentials", revokedAt: null },
      data: stamp.data,
    }),
  ]);
  return ok({
    revokedAccessTokens: accessTokens.count,
    revokedRefreshTokens: refreshTokens.count,
    revokedCredentialsClients: clients.count,
  });
}
