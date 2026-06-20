import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    businessContext: { findFirst: vi.fn() },
    businessProfile: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import {
  deriveTimezoneFromBusinessLocation,
  resolveOperatingScheduleForSystem,
} from "./operating-hours-read";

const orgFindFirst = vi.mocked(prisma.organization.findFirst);
const ctxFindFirst = vi.mocked(prisma.businessContext.findFirst);
const profileFindFirst = vi.mocked(prisma.businessProfile.findFirst);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveTimezoneFromBusinessLocation", () => {
  it("uses the precise US state from Organization.address (beats the country fallback)", async () => {
    orgFindFirst.mockResolvedValue({ address: { stateCode: "IL", countryCode: "US" } } as never);
    // Even if BusinessContext would resolve to Eastern, the address state wins.
    ctxFindFirst.mockResolvedValue({ stateCode: null, operatesIn: ["us"] } as never);

    expect(await deriveTimezoneFromBusinessLocation()).toBe("America/Chicago");
    // Address resolved → the BusinessContext fallback is never consulted.
    expect(ctxFindFirst).not.toHaveBeenCalled();
  });

  it("uses the address country code when it carries no state", async () => {
    orgFindFirst.mockResolvedValue({ address: { countryCode: "GB" } } as never);
    expect(await deriveTimezoneFromBusinessLocation()).toBe("Europe/London");
  });

  it("falls back to BusinessContext.stateCode when the address has no location signal", async () => {
    orgFindFirst.mockResolvedValue({ address: null } as never);
    ctxFindFirst.mockResolvedValue({ stateCode: "TX", operatesIn: [] } as never);
    expect(await deriveTimezoneFromBusinessLocation()).toBe("America/Chicago");
  });

  it("falls back to the operating-jurisdiction country code when nothing more precise exists", async () => {
    orgFindFirst.mockResolvedValue(null as never);
    ctxFindFirst.mockResolvedValue({ stateCode: null, operatesIn: ["gb"] } as never);
    expect(await deriveTimezoneFromBusinessLocation()).toBe("Europe/London");
  });

  it("returns null when neither the address nor BusinessContext resolves", async () => {
    orgFindFirst.mockResolvedValue({ address: {} } as never);
    ctxFindFirst.mockResolvedValue(null as never);
    expect(await deriveTimezoneFromBusinessLocation()).toBeNull();
  });

  it("is fail-open (returns null) when a query throws", async () => {
    orgFindFirst.mockRejectedValue(new Error("db down"));
    expect(await deriveTimezoneFromBusinessLocation()).toBeNull();
  });
});

describe("resolveOperatingScheduleForSystem", () => {
  it("derives the timezone from the address when the profile is still on the UTC placeholder", async () => {
    profileFindFirst.mockResolvedValue({
      timezone: "UTC",
      businessHours: null,
      hoursConfirmedAt: null,
    } as never);
    orgFindFirst.mockResolvedValue({ address: { stateCode: "CA", countryCode: "US" } } as never);
    ctxFindFirst.mockResolvedValue(null as never);

    const result = await resolveOperatingScheduleForSystem();
    expect(result.timezone).toBe("America/Los_Angeles");
  });

  it("keeps a pinned profile timezone over the derived one", async () => {
    profileFindFirst.mockResolvedValue({
      timezone: "America/Denver",
      businessHours: { monday: { open: "09:00", close: "17:00" } },
      hoursConfirmedAt: new Date(),
    } as never);

    const result = await resolveOperatingScheduleForSystem();
    expect(result.timezone).toBe("America/Denver");
    // A real pinned timezone short-circuits derivation — no address lookup.
    expect(orgFindFirst).not.toHaveBeenCalled();
  });
});
