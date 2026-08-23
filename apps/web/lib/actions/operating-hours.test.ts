import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    businessProfile: {
      findFirst: vi.fn(),
    },
    storefrontConfig: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Helper: create fresh transaction mocks for saveOperatingHours tests.
// The saveOperatingHours action uses prisma.$transaction(async (tx) => { ... })
// so we mock $transaction to call through to a local txMocks object.
function makeTxMocks() {
  return {
    businessProfile: { upsert: vi.fn().mockResolvedValue({ id: "bp-1" }) },
    deploymentWindow: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    serviceProvider: { findMany: vi.fn().mockResolvedValue([]) },
    providerAvailability: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hospitalityResource: { findMany: vi.fn().mockResolvedValue([]) },
    hospitalityResourceAvailability: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    resource: {
      upsert: vi.fn().mockResolvedValue({ id: "resource-1" }),
    },
    resourceAvailability: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  getOperatingHours,
  saveOperatingHours,
  getDefaultHoursForArchetype,
} from "./operating-hours";
import { GENERIC_DEFAULTS, type WeeklySchedule } from "../operating-hours-types";

const mockSession = {
  user: { id: "user-1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
});

describe("getOperatingHours", () => {
  it("returns existing confirmed hours from BusinessProfile", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      businessHours: {
        monday: { open: "09:00", close: "17:00" },
        tuesday: { open: "09:00", close: "17:00" },
        wednesday: { open: "09:00", close: "17:00" },
        thursday: { open: "09:00", close: "17:00" },
        friday: { open: "09:00", close: "17:00" },
        saturday: null,
        sunday: null,
      },
      timezone: "Europe/London",
      hoursConfirmedAt: new Date(),
    } as never);

    const result = await getOperatingHours();
    expect(result.schedule.monday.enabled).toBe(true);
    expect(result.schedule.monday.open).toBe("09:00");
    expect(result.schedule.saturday.enabled).toBe(false);
    expect(result.timezone).toBe("Europe/London");
    expect(result.isConfirmed).toBe(true);
  });

  it("returns archetype defaults when profile exists but unconfirmed", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      businessHours: { monday: { open: "08:00", close: "18:00" } },
      timezone: "UTC",
      hoursConfirmedAt: null,
    } as never);
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      archetypeId: "healthcare-wellness/veterinary-clinic",
      archetype: { category: "healthcare-wellness" },
    } as never);

    const result = await getOperatingHours();
    expect(result.schedule.monday.open).toBe("08:00");
    expect(result.schedule.monday.close).toBe("17:00");
    expect(result.isConfirmed).toBe(false);
  });

  it("resolves Restaurant defaults from the canonical leaf template", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      businessHours: null,
      timezone: "America/Chicago",
      hoursConfirmedAt: null,
    } as never);
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      archetypeId: "cmpims3xf090p6ymggadp4075",
      archetype: {
        archetypeId: "restaurant",
        category: "food-hospitality",
      },
    } as never);

    const result = await getOperatingHours();

    expect(result.schedule.monday).toEqual({ enabled: true, open: "11:00", close: "22:00" });
    expect(result.schedule.sunday).toEqual({ enabled: true, open: "11:00", close: "22:00" });
    expect(result.isConfirmed).toBe(false);
  });

  it("returns generic defaults when no profile and no archetype", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null as never);

    const result = await getOperatingHours();
    expect(result.schedule.monday.enabled).toBe(true);
    expect(result.schedule.monday.open).toBe("09:00");
    expect(result.schedule.monday.close).toBe("17:00");
    expect(result.schedule.saturday.enabled).toBe(false);
    expect(result.isConfirmed).toBe(false);
  });

  it("falls through to generic defaults when unconfirmed and no archetype", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      businessHours: { monday: { open: "08:00", close: "18:00" } },
      timezone: "Europe/London",
      hoursConfirmedAt: null,
    } as never);
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null as never);

    const result = await getOperatingHours();
    expect(result.schedule.monday.open).toBe("09:00");
    expect(result.timezone).toBe("Europe/London");
    expect(result.isConfirmed).toBe(false);
  });
});

describe("getDefaultHoursForArchetype", () => {
  it("returns healthcare defaults for healthcare-wellness", async () => {
    const result = await getDefaultHoursForArchetype("healthcare-wellness");
    expect(result.monday.open).toBe("08:00");
    expect(result.monday.close).toBe("17:00");
    expect(result.saturday.enabled).toBe(false);
  });

  it("returns fitness defaults with extended hours", async () => {
    const result = await getDefaultHoursForArchetype("fitness-recreation");
    expect(result.monday.open).toBe("06:00");
    expect(result.monday.close).toBe("21:00");
    expect(result.saturday.enabled).toBe(true);
  });

  it("returns generic defaults for unknown category", async () => {
    const result = await getDefaultHoursForArchetype("unknown-category");
    expect(result.monday.open).toBe("09:00");
    expect(result.saturday.enabled).toBe(false);
  });

  it("returns generic defaults for null", async () => {
    const result = await getDefaultHoursForArchetype(null);
    expect(result.monday.open).toBe("09:00");
  });
});

describe("saveOperatingHours", () => {
  const MF_SCHEDULE: WeeklySchedule = {
    monday:    { enabled: true, open: "09:00", close: "17:00" },
    tuesday:   { enabled: true, open: "09:00", close: "17:00" },
    wednesday: { enabled: true, open: "09:00", close: "17:00" },
    thursday:  { enabled: true, open: "09:00", close: "17:00" },
    friday:    { enabled: true, open: "09:00", close: "17:00" },
    saturday:  { enabled: false, open: "09:00", close: "17:00" },
    sunday:    { enabled: false, open: "09:00", close: "17:00" },
  };

  it("upserts BusinessProfile with schedule and sets hoursConfirmedAt", async () => {
    const txMocks = makeTxMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE, timezone: "Europe/London" });

    expect(txMocks.businessProfile.upsert).toHaveBeenCalledOnce();
    const upsertArg = txMocks.businessProfile.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.hoursConfirmedAt).toBeInstanceOf(Date);
    expect(upsertArg.update.timezone).toBe("Europe/London");
  });

  it("replaces seed deployment windows with derived windows", async () => {
    const txMocks = makeTxMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE });

    // Deletes old seed + derived windows
    expect(txMocks.deploymentWindow.deleteMany).toHaveBeenCalledOnce();
    // Creates new derived windows
    expect(txMocks.deploymentWindow.createMany).toHaveBeenCalledOnce();
  });

  it("seeds ProviderAvailability when ServiceProvider exists", async () => {
    const txMocks = makeTxMocks();
    txMocks.serviceProvider.findMany.mockResolvedValue([
      { id: "sp-1" },
      { id: "sp-2" },
    ] as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE });

    expect(txMocks.providerAvailability.deleteMany).toHaveBeenCalledWith({
      where: { providerId: { in: ["sp-1", "sp-2"] } },
    });
    expect(txMocks.providerAvailability.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ providerId: "sp-1", days: [1, 2, 3, 4, 5] }),
        expect.objectContaining({ providerId: "sp-2", days: [1, 2, 3, 4, 5] }),
      ]),
    });
  });

  it("mirrors confirmed hours to table-resource availability", async () => {
    const txMocks = makeTxMocks();
    txMocks.serviceProvider.findMany.mockResolvedValue([{ id: "sp-table" }] as never);
    txMocks.hospitalityResource.findMany.mockResolvedValue([
      {
        id: "table-1",
        resourceId: "HR-TABLE1",
        organizationId: "org-1",
        storefrontId: "storefront-1",
        kind: "table",
        label: "Table 1",
        status: "active",
        capacity: 4,
        capacityUnit: "seats",
        serviceArea: "Dining room",
        blockedReason: null,
        attributes: {},
        version: 1,
        legacyServiceProviderId: "sp-table",
      },
    ] as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE });

    expect(txMocks.hospitalityResourceAvailability.deleteMany).toHaveBeenCalledWith({
      where: { resourceId: { in: ["table-1"] } },
    });
    expect(txMocks.hospitalityResourceAvailability.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        id: expect.any(String),
        organizationId: "org-1",
        resourceId: "table-1",
        kind: "available",
        days: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "17:00",
      })],
    });
    expect(txMocks.resource.upsert).toHaveBeenCalledWith({
      where: { sourceRef: "HospitalityResource:table-1" },
      create: expect.objectContaining({
        resourceKey: "HR-TABLE1",
        organizationId: "org-1",
        domain: "hospitality",
        kindSlug: "table",
      }),
      update: expect.objectContaining({
        resourceKey: "HR-TABLE1",
        organizationId: "org-1",
        domain: "hospitality",
        kindSlug: "table",
      }),
    });
    expect(txMocks.resourceAvailability.deleteMany).toHaveBeenCalledWith({
      where: { resourceId: "resource-1", organizationId: "org-1" },
    });
    expect(txMocks.resourceAvailability.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        organizationId: "org-1",
        resourceId: "resource-1",
        windowKind: "available",
        days: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "17:00",
        sourceRef: expect.stringMatching(/^HospitalityResourceAvailability:/),
      })],
    });
  });

  it("skips ProviderAvailability when no ServiceProvider", async () => {
    const txMocks = makeTxMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE });

    expect(txMocks.providerAvailability.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects schedule with no enabled days", async () => {
    const allClosed: WeeklySchedule = {
      monday:    { enabled: false, open: "09:00", close: "17:00" },
      tuesday:   { enabled: false, open: "09:00", close: "17:00" },
      wednesday: { enabled: false, open: "09:00", close: "17:00" },
      thursday:  { enabled: false, open: "09:00", close: "17:00" },
      friday:    { enabled: false, open: "09:00", close: "17:00" },
      saturday:  { enabled: false, open: "09:00", close: "17:00" },
      sunday:    { enabled: false, open: "09:00", close: "17:00" },
    };

    await expect(saveOperatingHours({ schedule: allClosed })).rejects.toThrow(
      "At least one day must be enabled"
    );
  });

  it("rejects close before open", async () => {
    const bad: WeeklySchedule = {
      ...GENERIC_DEFAULTS,
      monday: { enabled: true, open: "17:00", close: "09:00" },
    };

    await expect(saveOperatingHours({ schedule: bad })).rejects.toThrow(
      "monday: closing time must be after opening time"
    );
  });
});
