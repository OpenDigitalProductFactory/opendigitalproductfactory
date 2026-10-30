// apps/web/lib/workforce/calendar-feed-token.ts
//
// BI-051A74CE: private calendar subscription links. A calendar app cannot hold
// a session, so the .ics feed is reachable without one; what it must present
// instead is a per-user token. The token is random, shown once at issue, and
// stored only as its SHA-256 on the owning User row. Rotating overwrites the
// hash (the previous link dies at once); revoking clears it.

import { createHash, randomBytes } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";

import { currentUserContextFromRecord } from "@/lib/govern/current-user-context";
import type { UserContext } from "@/lib/govern/permissions";

export const CALENDAR_FEED_TOKEN_PREFIX = "dpfcal_";
/** 32 random bytes, base64url without padding. */
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;

type FeedTokenDb = Pick<Prisma.TransactionClient, "user">;

export type CalendarFeedOwner = {
  userId: string;
  context: UserContext;
};

export function generateCalendarFeedToken(): string {
  return `${CALENDAR_FEED_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashCalendarFeedToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedCalendarFeedToken(token: string | null | undefined): token is string {
  return typeof token === "string"
    && token.startsWith(CALENDAR_FEED_TOKEN_PREFIX)
    && TOKEN_BODY.test(token.slice(CALENDAR_FEED_TOKEN_PREFIX.length));
}

/** The feed path for a user; the token travels as `?token=` because calendar apps cannot send headers. */
export function calendarFeedPath(userId: string, token: string): string {
  return `/api/calendar/feed/${encodeURIComponent(userId)}?token=${encodeURIComponent(token)}`;
}

/**
 * Resolve who a feed request is for. Null — and so a 404 — unless the token is
 * well formed, matches a stored hash in THIS install's database, belongs to the
 * user named in the path, and that user is currently active. A token minted for
 * another person or by another organization's install resolves to nothing here.
 */
export async function resolveCalendarFeedOwner(
  pathUserId: string,
  token: string | null | undefined,
  db: FeedTokenDb = prisma,
): Promise<CalendarFeedOwner | null> {
  if (!pathUserId || !isWellFormedCalendarFeedToken(token)) return null;
  const user = await db.user.findUnique({
    where: { calendarFeedTokenHash: hashCalendarFeedToken(token) },
    select: {
      id: true, isActive: true, isSuperuser: true, automationExpiresAt: true,
      groups: { include: { platformRole: true } },
    },
  });
  if (!user || user.id !== pathUserId) return null;
  const context = currentUserContextFromRecord(user.id, user);
  return context ? { userId: user.id, context } : null;
}

/** Issue a new token for the user, replacing any previous one. Returns the plaintext once. */
export async function rotateCalendarFeedToken(
  userId: string,
  db: FeedTokenDb = prisma,
  now: Date = new Date(),
): Promise<string> {
  const token = generateCalendarFeedToken();
  await db.user.update({
    where: { id: userId },
    data: { calendarFeedTokenHash: hashCalendarFeedToken(token), calendarFeedTokenIssuedAt: now },
  });
  return token;
}

export async function revokeCalendarFeedToken(userId: string, db: FeedTokenDb = prisma): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { calendarFeedTokenHash: null, calendarFeedTokenIssuedAt: null },
  });
}

export async function getCalendarFeedTokenIssuedAt(
  userId: string,
  db: FeedTokenDb = prisma,
): Promise<Date | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { calendarFeedTokenIssuedAt: true, calendarFeedTokenHash: true },
  });
  return user?.calendarFeedTokenHash ? user.calendarFeedTokenIssuedAt ?? null : null;
}
