// BI-051A74CE: the .ics feed must never serve a calendar for a bare user id.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindUnique, mockProfileFindUnique, mockGetCalendarEvents } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockProfileFindUnique: vi.fn(),
  mockGetCalendarEvents: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    employeeProfile: { findUnique: mockProfileFindUnique },
    calendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/calendar-data", () => ({ getCalendarEvents: mockGetCalendarEvents }));

import { GET } from "./route";
import { generateCalendarFeedToken, hashCalendarFeedToken } from "@/lib/workforce/calendar-feed-token";

const LEAKY_EVENT = {
  id: "invoice-1",
  title: "Invoice INV-9 due",
  start: "2026-10-20T00:00:00.000Z",
  end: null,
  allDay: true,
  category: "finance",
  eventType: "invoice",
  color: "#facc15",
  editable: false,
  sourceType: "projected",
};

function call(url: string, userId: string) {
  return GET(new Request(url) as never, { params: Promise.resolve({ userId }) });
}

describe("GET /api/calendar/feed/[userId] (BI-051A74CE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // An existing, active superuser: the worst case for a leak.
    mockUserFindUnique.mockResolvedValue({
      id: "user-a", email: "a@example.com", isActive: true, isSuperuser: true,
      automationExpiresAt: null, groups: [],
    });
    mockProfileFindUnique.mockResolvedValue({ id: "profile-a" });
    mockGetCalendarEvents.mockResolvedValue([LEAKY_EVENT]);
  });

  it("AC-1: refuses an id-only request with 404 and serves no event data", async () => {
    const res = await call("http://test/api/calendar/feed/user-a", "user-a");

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("BEGIN:VCALENDAR");
    expect(body).not.toContain("INV-9");
    expect(body).not.toContain("a@example.com");
    expect(mockGetCalendarEvents).not.toHaveBeenCalled();
  });

  it("AC-1: refuses a malformed token without touching the database", async () => {
    const res = await call("http://test/api/calendar/feed/user-a?token=guess", "user-a");

    expect(res.status).toBe(404);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockGetCalendarEvents).not.toHaveBeenCalled();
  });

  it("AC-2: serves the owner's feed for a valid token, scoped to their roles", async () => {
    const token = generateCalendarFeedToken();
    mockUserFindUnique.mockImplementation(async ({ where }: { where: { calendarFeedTokenHash?: string } }) =>
      where.calendarFeedTokenHash === hashCalendarFeedToken(token)
        ? { id: "user-a", isActive: true, isSuperuser: false, automationExpiresAt: null,
            groups: [{ platformRole: { roleId: "HR-600" } }] }
        : null);

    const res = await call(`http://test/api/calendar/feed/user-a?token=${token}`, "user-a");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    // HR-600 may not see finance: the invoice stays out of the feed.
    expect(body).not.toContain("INV-9");
  });

  it("AC-3: refuses another user's valid token on this user's feed", async () => {
    const tokenB = generateCalendarFeedToken();
    mockUserFindUnique.mockImplementation(async ({ where }: { where: { calendarFeedTokenHash?: string } }) =>
      where.calendarFeedTokenHash === hashCalendarFeedToken(tokenB)
        ? { id: "user-b", isActive: true, isSuperuser: true, automationExpiresAt: null, groups: [] }
        : null);

    const res = await call(`http://test/api/calendar/feed/user-a?token=${tokenB}`, "user-a");

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("BEGIN:VCALENDAR");
    expect(mockGetCalendarEvents).not.toHaveBeenCalled();
  });
});
