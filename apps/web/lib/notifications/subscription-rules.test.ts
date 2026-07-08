import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    notificationSubscription: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    notification: { createMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";

import {
  createSubscription,
  dispatchEventToSubscribers,
  matchesSubscriptionFilter,
} from "./subscription-rules";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("matchesSubscriptionFilter", () => {
  it("matches everything in the category when the filter is null or empty", () => {
    expect(matchesSubscriptionFilter(null, { status: "open" })).toBe(true);
    expect(matchesSubscriptionFilter({}, { status: "open" })).toBe(true);
  });

  it("requires every filter key to be present AND strictly equal", () => {
    expect(matchesSubscriptionFilter({ status: "open" }, { status: "open", pri: "P1" })).toBe(true);
    expect(matchesSubscriptionFilter({ status: "open", pri: "P1" }, { status: "open", pri: "P2" })).toBe(false);
  });

  it("does not fire on an attribute the event never reported", () => {
    expect(matchesSubscriptionFilter({ status: "open" }, { pri: "P1" })).toBe(false);
  });

  it("uses strict equality (no type coercion)", () => {
    expect(matchesSubscriptionFilter({ count: 1 }, { count: 1 })).toBe(true);
    // number filter vs string attribute must NOT match
    expect(matchesSubscriptionFilter({ count: 1 }, { count: "1" as unknown as number })).toBe(false);
  });
});

describe("createSubscription", () => {
  it("rejects an empty category and an unknown cadence before any write", async () => {
    expect(await createSubscription({ userId: "u1", eventCategory: "  " })).toMatchObject({ ok: false });
    expect(
      await createSubscription({ userId: "u1", eventCategory: "backlog", cadence: "hourly" as never }),
    ).toMatchObject({ ok: false });
    expect(prisma.notificationSubscription.create).not.toHaveBeenCalled();
  });

  it("persists a trimmed category and returns the id", async () => {
    asMock(prisma.notificationSubscription.create).mockResolvedValueOnce({ id: "sub-1" });
    const res = await createSubscription({ userId: "u1", eventCategory: " backlog ", filter: { status: "open" } });
    expect(res).toEqual({ ok: true, subscriptionId: "sub-1" });
    expect(prisma.notificationSubscription.create).toHaveBeenCalledWith({
      data: { userId: "u1", eventCategory: "backlog", filter: { status: "open" }, channel: "in_app", cadence: "immediate" },
      select: { id: true },
    });
  });
});

describe("dispatchEventToSubscribers", () => {
  const event = {
    eventCategory: "backlog",
    attributes: { status: "done", pri: "P1" },
    title: "A backlog item you follow is done",
  };

  it("notifies only owners whose filter matches, one notification per user", async () => {
    asMock(prisma.notificationSubscription.findMany).mockResolvedValueOnce([
      { id: "s1", userId: "alice", filter: { status: "done" } }, // match
      { id: "s2", userId: "bob", filter: { status: "open" } }, // no match
      { id: "s3", userId: "alice", filter: null }, // match (all) — same user, de-duped
      { id: "s4", userId: "carol", filter: { pri: "P1" } }, // match
    ]);
    asMock(prisma.notification.createMany).mockResolvedValueOnce({ count: 2 });

    const res = await dispatchEventToSubscribers(event);

    expect(res).toEqual({ notified: 2 });
    const created = asMock(prisma.notification.createMany).mock.calls[0][0].data;
    expect(created.map((d: { userId: string }) => d.userId).sort()).toEqual(["alice", "carol"]);
    expect(created[0].type).toBe("subscription:backlog");
  });

  it("creates nothing when no active rule matches", async () => {
    asMock(prisma.notificationSubscription.findMany).mockResolvedValueOnce([
      { id: "s1", userId: "bob", filter: { status: "open" } },
    ]);
    const res = await dispatchEventToSubscribers(event);
    expect(res).toEqual({ notified: 0 });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it("only queries active immediate rules in the category", async () => {
    asMock(prisma.notificationSubscription.findMany).mockResolvedValueOnce([]);
    await dispatchEventToSubscribers(event);
    expect(prisma.notificationSubscription.findMany).toHaveBeenCalledWith({
      where: { eventCategory: "backlog", active: true, cadence: "immediate" },
      select: { id: true, userId: true, filter: true },
    });
  });
});
