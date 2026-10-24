// People holding grants under one OAuth client registration, and ending one
// person's access without touching anyone else's (BI-0A724798).
//
// A browser-registered client such as Claude Code is shared: everyone who
// connects it to this install holds grants under the same registration. The
// whole-client revoke (revokeOAuthClient) ends everyone's access. This ends one
// person's: their access tokens and refresh grants under this client, the unit
// Okta's per-user client grant revocation uses. RFC 7009: revoking the refresh
// grant also revokes the access tokens issued from it.

import type { prisma } from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

type Db = typeof prisma;

export type ClientPeopleDb = {
  oAuthClient: Pick<Db["oAuthClient"], "findUnique">;
  user: Pick<Db["user"], "findMany">;
  mcpApiToken: Pick<Db["mcpApiToken"], "findMany" | "updateMany">;
  oAuthRefreshToken: Pick<Db["oAuthRefreshToken"], "findMany" | "updateMany">;
  $transaction: Db["$transaction"];
};

export type ClientPersonActor = { userId: string; email: string };

export type ClientPerson = {
  userId: string;
  email: string;
  liveAccessTokens: number;
  liveRefreshGrants: number;
  lastUsedAt: string | null;
  /** The newest revocation of this person's grants under the client, in the last 30 days. */
  lastRevocation: { at: string; reason: string } | null;
  isYou: boolean;
};

const MAX_REASON = 500;
const MAX_PEOPLE = 200;
const RECENT_REVOCATION_MS = 30 * 86_400_000;

async function clientRowId(db: ClientPeopleDb, clientId: string): Promise<string | null> {
  const client = await db.oAuthClient.findUnique({ where: { oAuthClientId: clientId }, select: { id: true } });
  return client?.id ?? null;
}

export async function revokeClientPersonGrants(
  db: ClientPeopleDb,
  input: { clientId: string; userId: string; reason: string; actor: ClientPersonActor; now?: Date },
): Promise<ActionResult<{ revokedAccessTokens: number; revokedRefreshTokens: number }>> {
  const reason = input.reason?.trim() ?? "";
  if (!reason) return err("Say why this person's access is ending.");
  if (reason.length > MAX_REASON) return err(`Keep the reason under ${MAX_REASON} characters.`);
  if (input.userId === input.actor.userId) {
    return err("This would end your own access, possibly the session you are using. Disconnect from your own client instead.");
  }
  const rowId = await clientRowId(db, input.clientId);
  if (!rowId) return err("Unknown client.");

  const now = input.now ?? new Date();
  const where = { oauthClientId: rowId, userId: input.userId, revokedAt: null };
  const data = { revokedAt: now, revokedReason: `operator_revoked_person: ${reason} (by ${input.actor.email})` };
  const [accessTokens, refreshTokens] = await db.$transaction([
    db.mcpApiToken.updateMany({ where, data }),
    db.oAuthRefreshToken.updateMany({ where, data }),
  ]);
  return ok({ revokedAccessTokens: accessTokens.count, revokedRefreshTokens: refreshTokens.count });
}

type TokenRow = { userId: string; revokedAt: Date | null; revokedReason: string | null; expiresAt: Date | null };

export async function listClientPeople(
  db: ClientPeopleDb,
  input: { clientId: string; actor: ClientPersonActor; now?: Date },
): Promise<ActionResult<ClientPerson[]>> {
  const rowId = await clientRowId(db, input.clientId);
  if (!rowId) return err("Unknown client.");
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - RECENT_REVOCATION_MS);

  const select = { userId: true, revokedAt: true, revokedReason: true, expiresAt: true };
  const [access, refresh] = await Promise.all([
    db.mcpApiToken.findMany({
      where: { oauthClientId: rowId, OR: [{ revokedAt: null }, { revokedAt: { gte: since } }] },
      select: { ...select, lastUsedAt: true },
    }),
    db.oAuthRefreshToken.findMany({
      where: { oauthClientId: rowId, consumedAt: null, OR: [{ revokedAt: null }, { revokedAt: { gte: since } }] },
      select,
    }),
  ]);

  const live = (t: TokenRow) => !t.revokedAt && (!t.expiresAt || t.expiresAt > now);
  const people = new Map<string, Omit<ClientPerson, "email" | "isYou">>();
  const entry = (userId: string) => {
    let p = people.get(userId);
    if (!p) people.set(userId, (p = { userId, liveAccessTokens: 0, liveRefreshGrants: 0, lastUsedAt: null, lastRevocation: null }));
    return p;
  };
  const noteRevocation = (p: Omit<ClientPerson, "email" | "isYou">, t: TokenRow) => {
    if (!t.revokedAt || t.revokedAt < since) return;
    if (!p.lastRevocation || t.revokedAt.toISOString() > p.lastRevocation.at) {
      p.lastRevocation = { at: t.revokedAt.toISOString(), reason: t.revokedReason ?? "" };
    }
  };
  for (const t of access as Array<TokenRow & { lastUsedAt: Date | null }>) {
    const p = entry(t.userId);
    if (live(t)) p.liveAccessTokens += 1;
    const used = t.lastUsedAt?.toISOString() ?? null;
    if (used && (!p.lastUsedAt || used > p.lastUsedAt)) p.lastUsedAt = used;
    noteRevocation(p, t);
  }
  for (const t of refresh as TokenRow[]) {
    const p = entry(t.userId);
    if (live(t)) p.liveRefreshGrants += 1;
    noteRevocation(p, t);
  }

  const ids = [...people.keys()].slice(0, MAX_PEOPLE);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const rows = ids.map((id) => ({ ...people.get(id)!, email: emailById.get(id) ?? id, isYou: id === input.actor.userId }));
  // The caller first, then anyone still holding live grants, then the rest.
  const rank = (p: ClientPerson) => (p.isYou ? 0 : p.liveAccessTokens + p.liveRefreshGrants > 0 ? 1 : 2);
  return ok(rows.sort((a, b) => rank(a) - rank(b) || a.email.localeCompare(b.email)));
}
