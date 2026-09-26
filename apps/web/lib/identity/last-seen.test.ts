import { beforeEach, describe, expect, it, vi } from "vitest";

import { LAST_SEEN_STAMP_INTERVAL_MS, recordUserSeen, resetLastSeenThrottle } from "./last-seen";

function fakeDb() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return { db: { user: { updateMany } }, updateMany };
}

beforeEach(() => resetLastSeenThrottle());

describe("recordUserSeen (BI-61DE8177)", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("stamps lastSeenAt only when it is missing or older than the interval", async () => {
    const { db, updateMany } = fakeDb();
    await recordUserSeen(db, "user-1", now);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_STAMP_INTERVAL_MS) } }],
      },
      data: { lastSeenAt: now },
    });
  });

  it("does not touch the database again for the same user inside the interval", async () => {
    const { db, updateMany } = fakeDb();
    await recordUserSeen(db, "user-1", now);
    await recordUserSeen(db, "user-1", new Date(now.getTime() + 60_000));
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("stamps again once the interval has passed", async () => {
    const { db, updateMany } = fakeDb();
    await recordUserSeen(db, "user-1", now);
    await recordUserSeen(db, "user-1", new Date(now.getTime() + LAST_SEEN_STAMP_INTERVAL_MS + 1));
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("never lets a failed write break the page that called it", async () => {
    const db = { user: { updateMany: vi.fn().mockRejectedValue(new Error("db down")) } };
    await expect(recordUserSeen(db, "user-1", now)).resolves.toBeUndefined();
  });

  it("ignores an empty user id", async () => {
    const { db, updateMany } = fakeDb();
    await recordUserSeen(db, "", now);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
