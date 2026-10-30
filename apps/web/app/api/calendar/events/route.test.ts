import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/calendar-data", () => ({ getCalendarEvents: vi.fn().mockResolvedValue([]) }));
import { auth } from "@/lib/auth";
import { getCalendarEvents } from "@/lib/calendar-data";
import { GET } from "./route";

beforeEach(() => { vi.clearAllMocks(); vi.mocked(auth).mockResolvedValue({ user: { id: "fixture-user" } } as never); });
function request(start: string, end: string, civilStart = "2026-10-29", civilEnd = "2026-10-30") {
  return new NextRequest(`https://fixture.example/api/calendar/events?${new URLSearchParams({ start, end, civilStart, civilEnd })}`);
}

describe("native all-day range boundary", () => {
  it.each([
    ["2026-10-29T05:00:00Z", "2026-10-30T05:00:00Z"],
    ["2026-10-28T10:00:00Z", "2026-10-29T10:00:00Z"],
  ])("retains viewer civil range alongside instants %s", async (start, end) => {
    expect((await GET(request(start, end))).status).toBe(200);
    expect(getCalendarEvents).toHaveBeenCalledWith(new Date(start), new Date(end), undefined, {
      start: new Date("2026-10-29T00:00:00Z"), end: new Date("2026-10-30T00:00:00Z"),
    });
  });
  it("refuses a civil range unrelated to the requested instant window", async () => {
    expect((await GET(request("2026-10-29T05:00:00Z", "2026-10-30T05:00:00Z", "2020-01-01", "2030-01-01"))).status).toBe(400);
    expect(getCalendarEvents).not.toHaveBeenCalled();
  });
});
