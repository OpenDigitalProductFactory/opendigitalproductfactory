import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    businessProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    deploymentWindow: {
      create: vi.fn(),
    },
    blackoutPeriod: {
      create: vi.fn(),
    },
    changeRequest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  getBusinessProfile,
  getAvailableWindows,
  checkSchedulingConflicts,
  createBusinessProfile,
  createDeploymentWindow,
  createBlackoutPeriod,
} from "./deployment-windows";

const mockSession = {
  user: {
    id: "user-1",
    email: "ops@test.com",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
});

// ─── Test Data ───────────────────────────────────────────────────────────────

const weekdayWindow = {
  id: "win-1",
  businessProfileId: "bp-1",
  windowKey: "weekday-maint",
  name: "Weekday Maintenance",
  dayOfWeek: [2, 4],
  startTime: "02:00",
  endTime: "06:00",
  maxConcurrentChanges: 2,
  allowedChangeTypes: ["standard", "normal"],
  allowedRiskLevels: ["low", "medium"],
  enforcement: "advisory",
};

const emergencyWindow = {
  id: "win-2",
  businessProfileId: "bp-1",
  windowKey: "emergency-anytime",
  name: "Emergency Window",
  dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  maxConcurrentChanges: 1,
  allowedChangeTypes: ["emergency"],
  allowedRiskLevels: ["low", "medium", "high", "critical"],
  enforcement: "mandatory",
};

const highRiskWindow = {
  id: "win-3",
  businessProfileId: "bp-1",
  windowKey: "weekend-highrisk",
  name: "Weekend High-Risk",
  dayOfWeek: [6, 0],
  startTime: "01:00",
  endTime: "05:00",
  maxConcurrentChanges: 1,
  allowedChangeTypes: ["normal", "standard"],
  allowedRiskLevels: ["high", "critical"],
  enforcement: "mandatory",
};

const mockProfile = {
  id: "bp-1",
  profileKey: "default",
  name: "Default Profile",
  isActive: true,
  businessHours: { mon: "09:00-17:00" },
  timezone: "UTC",
  hasStorefront: false,
  deploymentWindows: [weekdayWindow, emergencyWindow, highRiskWindow],
  blackoutPeriods: [],
};

// ─── getBusinessProfile ──────────────────────────────────────────────────────

describe("getBusinessProfile", () => {
  it("returns the active profile with windows and blackouts", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue(mockProfile as never);

    const result = await getBusinessProfile();

    expect(result).toEqual(mockProfile);
    const call = vi.mocked(prisma.businessProfile.findFirst).mock.calls[0][0] as {
      where: Record<string, unknown>;
      include: Record<string, unknown>;
    };
    expect(call.where.isActive).toBe(true);
    expect(call.include.deploymentWindows).toBe(true);
    expect(call.include.blackoutPeriods).toBe(true);
  });

  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(getBusinessProfile()).rejects.toThrow("Unauthorized");
  });
});

// ─── getAvailableWindows ─────────────────────────────────────────────────────

describe("getAvailableWindows", () => {
  it("returns only windows matching type and risk level", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      ...mockProfile,
      blackoutPeriods: [],
    } as never);

    const result = await getAvailableWindows("normal", "low");

    // weekdayWindow matches (normal+low), emergencyWindow does not (emergency only),
    // highRiskWindow does not (low not in allowedRiskLevels)
    expect(result).toHaveLength(1);
    expect(result[0].windowKey).toBe("weekday-maint");
  });

  it("returns emergency window for emergency type", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      ...mockProfile,
      blackoutPeriods: [],
    } as never);

    const result = await getAvailableWindows("emergency", "critical");

    expect(result).toHaveLength(1);
    expect(result[0].windowKey).toBe("emergency-anytime");
  });

  it("returns high-risk window for high risk level", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      ...mockProfile,
      blackoutPeriods: [],
    } as never);

    const result = await getAvailableWindows("normal", "high");

    expect(result).toHaveLength(1);
    expect(result[0].windowKey).toBe("weekend-highrisk");
  });

  it("returns empty when no profile exists", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue(null as never);

    const result = await getAvailableWindows("normal", "low");
    expect(result).toEqual([]);
  });

  it("excludes windows during blackout periods", async () => {
    const now = new Date();
    const blackout = {
      id: "bo-1",
      businessProfileId: "bp-1",
      name: "Year-End Freeze",
      reason: "Financial close",
      startAt: new Date(now.getTime() - 86400000), // yesterday
      endAt: new Date(now.getTime() + 86400000), // tomorrow
      scope: "all",
      exceptions: [],
    };

    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      ...mockProfile,
      blackoutPeriods: [blackout],
    } as never);

    const result = await getAvailableWindows("normal", "low");
    expect(result).toHaveLength(0);
  });

  it("allows emergency changes during blackouts with emergency exception", async () => {
    const now = new Date();
    const blackout = {
      id: "bo-2",
      businessProfileId: "bp-1",
      name: "Holiday Freeze",
      reason: "Holiday period",
      startAt: new Date(now.getTime() - 86400000),
      endAt: new Date(now.getTime() + 86400000),
      scope: "all",
      exceptions: ["emergency"],
    };

    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      ...mockProfile,
      blackoutPeriods: [blackout],
    } as never);

    const result = await getAvailableWindows("emergency", "critical");

    // Emergency window should be available despite blackout
    expect(result).toHaveLength(1);
    expect(result[0].windowKey).toBe("emergency-anytime");
  });

  it("blocks non-emergency changes during blackout with emergency exception only", async () => {
    const now = new Date();
    const blackout = {
      id: "bo-3",
      businessProfileId: "bp-1",
      name: "Holiday Freeze",
      reason: "Holiday period",
      startAt: new Date(now.getTime() - 86400000),
      endAt: new Date(now.getTime() + 86400000),
      scope: "all",
      exceptions: ["emergency"],
    };

    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      ...mockProfile,
      blackoutPeriods: [blackout],
    } as never);

    const result = await getAvailableWindows("normal", "low");
    expect(result).toHaveLength(0);
  });

  it("uses proposedDate for forward-looking blackout checks", async () => {
    const futureDate = new Date("2026-12-25T12:00:00Z");
    const blackout = {
      id: "bo-4",
      businessProfileId: "bp-1",
      name: "Christmas Freeze",
      reason: "Christmas",
      startAt: new Date("2026-12-24T00:00:00Z"),
      endAt: new Date("2026-12-26T23:59:59Z"),
      scope: "all",
      exceptions: [],
    };

    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      ...mockProfile,
      blackoutPeriods: [blackout],
    } as never);

    // With proposed date during blackout — blocked
    const blockedResult = await getAvailableWindows("normal", "low", futureDate);
    expect(blockedResult).toHaveLength(0);

    // With proposed date outside blackout — available
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      ...mockProfile,
      blackoutPeriods: [blackout],
    } as never);

    const beforeDate = new Date("2026-12-20T12:00:00Z");
    const availableResult = await getAvailableWindows("normal", "low", beforeDate);
    expect(availableResult).toHaveLength(1);
    expect(availableResult[0].windowKey).toBe("weekday-maint");
  });
});

// ─── checkSchedulingConflicts ────────────────────────────────────────────────

describe("checkSchedulingConflicts", () => {
  it("detects overlapping RFCs targeting same entities", async () => {
    // The RFC being checked
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-AAAA0001",
      changeItems: [
        { inventoryEntityId: "entity-1", digitalProductId: null },
        { inventoryEntityId: null, digitalProductId: "prod-1" },
      ],
    } as never);

    // Overlapping RFC targeting the same entity
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([
      {
        rfcId: "RFC-2026-BBBB0001",
        title: "Conflicting change",
        status: "scheduled",
        plannedStartAt: new Date("2026-04-01T03:00:00Z"),
        plannedEndAt: new Date("2026-04-01T05:00:00Z"),
        changeItems: [
          { inventoryEntityId: "entity-1", digitalProductId: null },
        ],
      },
    ] as never);

    const result = await checkSchedulingConflicts(
      "RFC-2026-AAAA0001",
      new Date("2026-04-01T02:00:00Z"),
      new Date("2026-04-01T06:00:00Z")
    );

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].rfcId).toBe("RFC-2026-BBBB0001");
    expect(result.conflicts[0].overlappingEntityIds).toEqual(["entity-1"]);
  });

  it("detects overlapping RFCs targeting same digital products", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-AAAA0002",
      changeItems: [
        { inventoryEntityId: null, digitalProductId: "prod-1" },
      ],
    } as never);

    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([
      {
        rfcId: "RFC-2026-BBBB0002",
        title: "Product deploy",
        status: "in-progress",
        plannedStartAt: new Date("2026-04-01T01:00:00Z"),
        plannedEndAt: new Date("2026-04-01T04:00:00Z"),
        changeItems: [
          { inventoryEntityId: null, digitalProductId: "prod-1" },
        ],
      },
    ] as never);

    const result = await checkSchedulingConflicts(
      "RFC-2026-AAAA0002",
      new Date("2026-04-01T02:00:00Z"),
      new Date("2026-04-01T06:00:00Z")
    );

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts[0].overlappingProductIds).toEqual(["prod-1"]);
  });

  it("returns no conflicts for non-overlapping windows", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-CCCC0001",
      changeItems: [
        { inventoryEntityId: "entity-1", digitalProductId: null },
      ],
    } as never);

    // No overlapping RFCs found
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([] as never);

    const result = await checkSchedulingConflicts(
      "RFC-2026-CCCC0001",
      new Date("2026-04-01T02:00:00Z"),
      new Date("2026-04-01T06:00:00Z")
    );

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it("returns no conflicts when overlapping RFCs target different entities", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-DDDD0001",
      changeItems: [
        { inventoryEntityId: "entity-1", digitalProductId: null },
      ],
    } as never);

    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([
      {
        rfcId: "RFC-2026-EEEE0001",
        title: "Different entity change",
        status: "scheduled",
        plannedStartAt: new Date("2026-04-01T03:00:00Z"),
        plannedEndAt: new Date("2026-04-01T05:00:00Z"),
        changeItems: [
          { inventoryEntityId: "entity-2", digitalProductId: null },
        ],
      },
    ] as never);

    const result = await checkSchedulingConflicts(
      "RFC-2026-DDDD0001",
      new Date("2026-04-01T02:00:00Z"),
      new Date("2026-04-01T06:00:00Z")
    );

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it("returns no conflicts when RFC has no target entities", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-FFFF0001",
      changeItems: [
        { inventoryEntityId: null, digitalProductId: null },
      ],
    } as never);

    const result = await checkSchedulingConflicts(
      "RFC-2026-FFFF0001",
      new Date("2026-04-01T02:00:00Z"),
      new Date("2026-04-01T06:00:00Z")
    );

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
    // Should not even query for overlapping RFCs
    expect(prisma.changeRequest.findMany).not.toHaveBeenCalled();
  });

  it("throws when RFC not found", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue(null as never);

    await expect(
      checkSchedulingConflicts(
        "RFC-2026-NONEXIST",
        new Date("2026-04-01T02:00:00Z"),
        new Date("2026-04-01T06:00:00Z")
      )
    ).rejects.toThrow("RFC not found: RFC-2026-NONEXIST");
  });
});

// ─── createBusinessProfile ───────────────────────────────────────────────────

describe("createBusinessProfile", () => {
  it("creates a profile and revalidates", async () => {
    const mockResult = { id: "bp-new", profileKey: "retail", name: "Retail Profile" };
    vi.mocked(prisma.businessProfile.create).mockResolvedValue(mockResult as never);

    const result = await createBusinessProfile({
      profileKey: "retail",
      name: "Retail Profile",
      businessHours: { mon: "09:00-17:00", tue: "09:00-17:00" },
      timezone: "Europe/London",
      hasStorefront: true,
    });

    expect(result).toEqual(mockResult);

    const createCall = vi.mocked(prisma.businessProfile.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.profileKey).toBe("retail");
    expect(createCall.data.name).toBe("Retail Profile");
    expect(createCall.data.timezone).toBe("Europe/London");
    expect(createCall.data.hasStorefront).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/ops");
  });
});

// ─── createDeploymentWindow ──────────────────────────────────────────────────

describe("createDeploymentWindow", () => {
  it("creates a window and revalidates", async () => {
    const mockResult = { id: "win-new", windowKey: "nightly" };
    vi.mocked(prisma.deploymentWindow.create).mockResolvedValue(mockResult as never);

    const result = await createDeploymentWindow({
      businessProfileId: "bp-1",
      windowKey: "nightly",
      name: "Nightly Window",
      dayOfWeek: [1, 2, 3, 4, 5],
      startTime: "01:00",
      endTime: "05:00",
      allowedChangeTypes: ["standard", "normal"],
      allowedRiskLevels: ["low"],
    });

    expect(result).toEqual(mockResult);

    const createCall = vi.mocked(prisma.deploymentWindow.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.windowKey).toBe("nightly");
    expect(createCall.data.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(createCall.data.allowedChangeTypes).toEqual(["standard", "normal"]);
    expect(revalidatePath).toHaveBeenCalledWith("/ops");
  });
});

// ─── createBlackoutPeriod ────────────────────────────────────────────────────

describe("createBlackoutPeriod", () => {
  it("creates a blackout period and revalidates", async () => {
    const mockResult = { id: "bo-new", name: "Q4 Freeze" };
    vi.mocked(prisma.blackoutPeriod.create).mockResolvedValue(mockResult as never);

    const startAt = new Date("2026-12-20T00:00:00Z");
    const endAt = new Date("2027-01-03T00:00:00Z");

    const result = await createBlackoutPeriod({
      businessProfileId: "bp-1",
      name: "Q4 Freeze",
      reason: "Year-end financial close",
      startAt,
      endAt,
      exceptions: ["emergency"],
    });

    expect(result).toEqual(mockResult);

    const createCall = vi.mocked(prisma.blackoutPeriod.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.name).toBe("Q4 Freeze");
    expect(createCall.data.startAt).toEqual(startAt);
    expect(createCall.data.endAt).toEqual(endAt);
    expect(createCall.data.exceptions).toEqual(["emergency"]);
    expect(revalidatePath).toHaveBeenCalledWith("/ops");
  });

  it("defaults scope and exceptions", async () => {
    vi.mocked(prisma.blackoutPeriod.create).mockResolvedValue({} as never);

    await createBlackoutPeriod({
      businessProfileId: "bp-1",
      name: "Minimal Blackout",
      startAt: new Date("2026-06-01T00:00:00Z"),
      endAt: new Date("2026-06-02T00:00:00Z"),
    });

    const createCall = vi.mocked(prisma.blackoutPeriod.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.scope).toBe("all");
    expect(createCall.data.exceptions).toEqual([]);
  });
});
