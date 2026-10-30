import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {
  employeeProfile: { findUnique: vi.fn() },
  calendarEvent: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { createCalendarEvent, updateCalendarEvent } from "./calendar";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "fixture-user" } } as never);
  vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue({ id: "fixture-employee" } as never);
  vi.mocked(prisma.calendarEvent.findUnique).mockResolvedValue({ syncSource: null } as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("native civil date storage controls", () => {
  for (const zone of ["America/Chicago", "Pacific/Kiritimati"]) {
    it(`keeps create and supported edit UTC civil-day storage unchanged in ${zone}`, async () => {
      vi.stubEnv("TZ", zone);
      await createCalendarEvent({ title: "Isolated fixture", startAt: "2026-10-29", endAt: "2026-10-31", allDay: true });
      const created = vi.mocked(prisma.calendarEvent.create).mock.calls[0]![0]!.data;
      expect((created.startAt as Date).toISOString()).toBe("2026-10-29T00:00:00.000Z");
      expect((created.endAt as Date).toISOString()).toBe("2026-10-31T00:00:00.000Z");
      await updateCalendarEvent("CE-FIXTURE", { startAt: "2026-11-01", allDay: true });
      const updated = vi.mocked(prisma.calendarEvent.update).mock.calls[0]![0]!.data;
      expect((updated.startAt as Date).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    });
  }
  it("does not change synchronized events through the native edit operation", async () => {
    vi.mocked(prisma.calendarEvent.findUnique).mockResolvedValue({ syncSource: "external" } as never);
    expect(await updateCalendarEvent("CE-FIXTURE", { startAt: "2026-10-29" })).toMatchObject({ success: false });
    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
  });
});
