// BI-051A74CE: a user manages only their own subscription link.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockRotate, mockRevoke, mockIssuedAt } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRotate: vi.fn(),
  mockRevoke: vi.fn(),
  mockIssuedAt: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/workforce/calendar-feed-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workforce/calendar-feed-token")>()),
  rotateCalendarFeedToken: mockRotate,
  revokeCalendarFeedToken: mockRevoke,
  getCalendarFeedTokenIssuedAt: mockIssuedAt,
}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { getCalendarFeedStatus, revokeCalendarFeed, rotateCalendarFeed } from "./calendar-feed";

describe("calendar feed actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses every action without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await rotateCalendarFeed()).toEqual({ ok: false, error: "Unauthorized" });
    expect(await revokeCalendarFeed()).toEqual({ ok: false, error: "Unauthorized" });
    expect(await getCalendarFeedStatus()).toEqual({ ok: false, error: "Unauthorized" });
    expect(mockRotate).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("rotates and revokes only the session user's link", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-a" } });
    mockRotate.mockResolvedValue("dpfcal_x");

    expect(await rotateCalendarFeed()).toEqual({ ok: true, data: { path: "/api/calendar/feed/user-a?token=dpfcal_x" } });
    expect(mockRotate).toHaveBeenCalledWith("user-a");

    await revokeCalendarFeed();
    expect(mockRevoke).toHaveBeenCalledWith("user-a");
  });

  it("reports status without ever returning a token", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-a" } });
    mockIssuedAt.mockResolvedValue(new Date("2026-10-14T12:00:00.000Z"));
    expect(await getCalendarFeedStatus()).toEqual({ ok: true, data: { active: true, issuedAt: "2026-10-14T12:00:00.000Z" } });
    expect(mockIssuedAt).toHaveBeenCalledWith("user-a");
  });
});
