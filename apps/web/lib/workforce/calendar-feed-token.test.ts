// BI-051A74CE AC-2 / AC-3: feed tokens resolve only for their own user, in
// their own install, until rotated or revoked.
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  CALENDAR_FEED_TOKEN_PREFIX,
  generateCalendarFeedToken,
  getCalendarFeedTokenIssuedAt,
  hashCalendarFeedToken,
  isWellFormedCalendarFeedToken,
  resolveCalendarFeedOwner,
  revokeCalendarFeedToken,
  rotateCalendarFeedToken,
} from "./calendar-feed-token";

type Row = {
  id: string; isActive: boolean; isSuperuser: boolean; automationExpiresAt: Date | null;
  roles: string[]; calendarFeedTokenHash: string | null; calendarFeedTokenIssuedAt: Date | null;
};

/** One organization's install: its own User table, nothing shared with another. */
function orgStore(rows: Array<Partial<Row> & { id: string }>) {
  const users = new Map<string, Row>(rows.map((r) => [r.id, {
    isActive: true, isSuperuser: false, automationExpiresAt: null, roles: [],
    calendarFeedTokenHash: null, calendarFeedTokenIssuedAt: null, ...r,
  }]));
  const project = (u: Row) => ({
    ...u, groups: u.roles.map((roleId) => ({ platformRole: { roleId } })),
  });
  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; calendarFeedTokenHash?: string } }) => {
        if (where.id) { const u = users.get(where.id); return u ? project(u) : null; }
        const u = [...users.values()].find((row) => row.calendarFeedTokenHash === where.calendarFeedTokenHash);
        return u ? project(u) : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const u = users.get(where.id)!;
        Object.assign(u, data);
        return u;
      }),
    },
  };
  return { db: db as never, users };
}

describe("calendar feed token", () => {
  it("is unguessable in shape and stored only as a hash", async () => {
    const a = generateCalendarFeedToken();
    const b = generateCalendarFeedToken();
    expect(a).not.toBe(b);
    expect(a.startsWith(CALENDAR_FEED_TOKEN_PREFIX)).toBe(true);
    expect(isWellFormedCalendarFeedToken(a)).toBe(true);
    expect(isWellFormedCalendarFeedToken("dpfcal_short")).toBe(false);
    expect(isWellFormedCalendarFeedToken("user-a")).toBe(false);

    const { db, users } = orgStore([{ id: "user-a" }]);
    const token = await rotateCalendarFeedToken("user-a", db);
    expect(users.get("user-a")!.calendarFeedTokenHash).toBe(hashCalendarFeedToken(token));
    expect(users.get("user-a")!.calendarFeedTokenHash).not.toContain(token);
    expect(await getCalendarFeedTokenIssuedAt("user-a", db)).toBeInstanceOf(Date);
  });

  it("AC-2: resolves the owner with their current roles", async () => {
    const { db } = orgStore([{ id: "user-a", roles: ["HR-200"] }]);
    const token = await rotateCalendarFeedToken("user-a", db);

    const owner = await resolveCalendarFeedOwner("user-a", token, db);
    expect(owner).toMatchObject({ userId: "user-a", context: { platformRoles: ["HR-200"], isSuperuser: false } });
  });

  it("AC-2: a rotated token stops working immediately; revoke kills the link", async () => {
    const { db } = orgStore([{ id: "user-a" }]);
    const first = await rotateCalendarFeedToken("user-a", db);
    const second = await rotateCalendarFeedToken("user-a", db);

    expect(await resolveCalendarFeedOwner("user-a", first, db)).toBeNull();
    expect(await resolveCalendarFeedOwner("user-a", second, db)).not.toBeNull();

    await revokeCalendarFeedToken("user-a", db);
    expect(await resolveCalendarFeedOwner("user-a", second, db)).toBeNull();
    expect(await getCalendarFeedTokenIssuedAt("user-a", db)).toBeNull();
  });

  it("AC-3: refuses a cross-user token (B's valid token on A's feed, and A's on B's)", async () => {
    const { db } = orgStore([{ id: "user-a", isSuperuser: true }, { id: "user-b" }]);
    const tokenA = await rotateCalendarFeedToken("user-a", db);
    const tokenB = await rotateCalendarFeedToken("user-b", db);

    expect(await resolveCalendarFeedOwner("user-a", tokenB, db)).toBeNull();
    expect(await resolveCalendarFeedOwner("user-b", tokenA, db)).toBeNull();
  });

  it("AC-3: refuses a cross-organization token, even for the same user id", async () => {
    const orgA = orgStore([{ id: "shared-id", isSuperuser: true }]);
    const orgB = orgStore([{ id: "shared-id" }]);
    const tokenFromOrgB = await rotateCalendarFeedToken("shared-id", orgB.db);
    await rotateCalendarFeedToken("shared-id", orgA.db);

    expect(await resolveCalendarFeedOwner("shared-id", tokenFromOrgB, orgA.db)).toBeNull();
  });

  it("refuses an inactive or expired owner, and a malformed token without a lookup", async () => {
    const { db } = orgStore([
      { id: "gone", isActive: false },
      { id: "bot", automationExpiresAt: new Date(Date.now() - 1000) },
    ]);
    const gone = await rotateCalendarFeedToken("gone", db);
    const bot = await rotateCalendarFeedToken("bot", db);
    expect(await resolveCalendarFeedOwner("gone", gone, db)).toBeNull();
    expect(await resolveCalendarFeedOwner("bot", bot, db)).toBeNull();

    const lookups = (db as { user: { findUnique: { mock: { calls: unknown[] } } } }).user.findUnique.mock.calls.length;
    expect(await resolveCalendarFeedOwner("gone", null, db)).toBeNull();
    expect(await resolveCalendarFeedOwner("gone", "gone", db)).toBeNull();
    expect((db as { user: { findUnique: { mock: { calls: unknown[] } } } }).user.findUnique.mock.calls.length).toBe(lookups);
  });
});
