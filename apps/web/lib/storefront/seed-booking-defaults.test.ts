import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the template source so the helper's branching logic is tested against
// fixed archetype shapes (mirroring the real restaurant/catering templates)
// rather than the shipped data — the real templates are guarded by
// archetypes.test.ts. This also keeps the suite hermetic (no workspace-package
// resolution) like the sibling archetype-reset.test.ts.
const { FIXTURE_ARCHETYPES } = vi.hoisted(() => ({
  FIXTURE_ARCHETYPES: [
    {
      archetypeId: "restaurant",
      ctaType: "booking",
      itemTemplates: [
        { name: "Table for 2", ctaType: "booking", bookingDurationMinutes: 90 },
        { name: "Table for 4", ctaType: "booking", bookingDurationMinutes: 90 },
        { name: "Private Dining", ctaType: "booking", bookingDurationMinutes: 180 },
      ],
      schedulingDefaults: {
        schedulingPattern: "slot",
        assignmentMode: "next-available",
        defaultOperatingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "11:00", end: "22:00" })),
        defaultBeforeBuffer: 0,
        defaultAfterBuffer: 15,
        minimumNoticeHours: 1,
        maxAdvanceDays: 30,
      },
    },
    {
      // Inquiry archetype with no booking items and no schedulingDefaults.
      archetypeId: "catering",
      ctaType: "inquiry",
      itemTemplates: [{ name: "Corporate Catering", ctaType: "inquiry" }],
    },
    {
      // Booking items but NO explicit schedulingDefaults — must fall back to the
      // built-in defence-in-depth schedule rather than ship an empty calendar.
      archetypeId: "booking-no-defaults",
      ctaType: "booking",
      itemTemplates: [{ name: "Slot A", ctaType: "booking" }],
    },
  ],
}));

vi.mock("@dpf/storefront-templates", () => ({ ALL_ARCHETYPES: FIXTURE_ARCHETYPES }));

const mockNanoid = vi.hoisted(() => vi.fn());
vi.mock("nanoid", () => ({ nanoid: mockNanoid }));

import { seedBookingScheduleDefaults } from "./seed-booking-defaults";

type MockDb = ReturnType<typeof makeDb>;

function makeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    serviceProvider: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "prov_new" }),
    },
    providerAvailability: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    providerService: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    storefrontItem: {
      findMany: vi.fn().mockResolvedValue([{ id: "i1" }, { id: "i2" }, { id: "i3" }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    businessProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

describe("seedBookingScheduleDefaults", () => {
  beforeEach(() => {
    mockNanoid.mockReset();
    mockNanoid.mockReturnValue("abc123");
  });

  it("seeds a provider, availability, links, and bookingConfig for a fresh booking archetype", async () => {
    const db = makeDb();
    const result = await seedBookingScheduleDefaults(db, {
      storefrontId: "sf_1",
      archetypeId: "restaurant",
      providerName: "Joe's Diner",
    });

    expect(result).toBe(true);

    // Creates one default provider when none exists.
    expect(db.serviceProvider.create).toHaveBeenCalledTimes(1);
    expect(db.serviceProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storefrontId: "sf_1", name: "Joe's Diner", isActive: true }),
      }),
    );

    // Seeds restaurant hours (all 7 days, 11:00–22:00) as one grouped row.
    expect(db.providerAvailability.create).toHaveBeenCalledTimes(1);
    expect(db.providerAvailability.create).toHaveBeenCalledWith({
      data: { providerId: "prov_new", days: [0, 1, 2, 3, 4, 5, 6], startTime: "11:00", endTime: "22:00" },
    });

    // Links the provider to every booking item.
    expect(db.providerService.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([{ providerId: "prov_new", itemId: "i1" }]),
        skipDuplicates: true,
      }),
    );

    // Writes bookingConfig for each of the 3 booking items, with the template duration.
    expect(db.storefrontItem.updateMany).toHaveBeenCalledTimes(3);
    expect(db.storefrontItem.updateMany).toHaveBeenCalledWith({
      where: { storefrontId: "sf_1", name: "Table for 2" },
      data: {
        bookingConfig: expect.objectContaining({
          durationMinutes: 90,
          schedulingPattern: "slot",
          assignmentMode: "next-available",
        }),
      },
    });
  });

  it("reuses an existing provider and never clobbers its availability", async () => {
    const db = makeDb({
      serviceProvider: {
        findMany: vi.fn().mockResolvedValue([{ id: "prov_existing" }]),
        create: vi.fn(),
      },
      providerAvailability: {
        count: vi.fn().mockResolvedValue(3), // already has hours
        create: vi.fn(),
      },
    }) as MockDb;

    const result = await seedBookingScheduleDefaults(db, {
      storefrontId: "sf_1",
      archetypeId: "restaurant",
      providerName: "Joe's Diner",
    });

    expect(result).toBe(true);
    expect(db.serviceProvider.create).not.toHaveBeenCalled();
    expect(db.providerAvailability.create).not.toHaveBeenCalled();
    // Still re-links the surviving provider to the new booking items (the step
    // the reset bug was missing).
    expect(db.providerService.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([{ providerId: "prov_existing", itemId: "i1" }]),
        skipDuplicates: true,
      }),
    );
  });

  it("prefers the operator's confirmed business hours over the template defaults", async () => {
    const db = makeDb({
      businessProfile: {
        findFirst: vi.fn().mockResolvedValue({
          businessHours: {
            monday: { open: "08:00", close: "16:00" },
            tuesday: { open: "08:00", close: "16:00" },
            sunday: null,
          },
        }),
      },
    }) as MockDb;

    await seedBookingScheduleDefaults(db, {
      storefrontId: "sf_1",
      archetypeId: "restaurant",
      providerName: "Joe's Diner",
    });

    expect(db.providerAvailability.create).toHaveBeenCalledWith({
      data: { providerId: "prov_new", days: [1, 2], startTime: "08:00", endTime: "16:00" },
    });
  });

  it("falls back to a default schedule for a booking archetype lacking schedulingDefaults", async () => {
    const db = makeDb();
    const result = await seedBookingScheduleDefaults(db, {
      storefrontId: "sf_1",
      archetypeId: "booking-no-defaults",
      providerName: "Acme",
    });

    expect(result).toBe(true);
    // Fallback is Mon–Fri 09:00–17:00 — the calendar must not be empty.
    expect(db.providerAvailability.create).toHaveBeenCalledWith({
      data: { providerId: "prov_new", days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" },
    });
  });

  it("is a no-op for a non-booking archetype", async () => {
    const db = makeDb();
    const result = await seedBookingScheduleDefaults(db, {
      storefrontId: "sf_1",
      archetypeId: "catering", // inquiry archetype, no booking items
      providerName: "X",
    });

    expect(result).toBe(false);
    expect(db.serviceProvider.findMany).not.toHaveBeenCalled();
    expect(db.serviceProvider.create).not.toHaveBeenCalled();
    expect(db.storefrontItem.updateMany).not.toHaveBeenCalled();
  });

  it("is a no-op for an unknown archetype", async () => {
    const db = makeDb();
    const result = await seedBookingScheduleDefaults(db, {
      storefrontId: "sf_1",
      archetypeId: "does-not-exist",
      providerName: "X",
    });

    expect(result).toBe(false);
    expect(db.serviceProvider.findMany).not.toHaveBeenCalled();
  });
});
