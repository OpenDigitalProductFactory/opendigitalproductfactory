import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-CEFF2535: the governed backlog lane's only writer. Pins that the flag and
// cap persist through the singleton upsert, that an omitted cap keeps the stored
// one (the column is NOT NULL), that a bad cap is refused before any write, and
// that the manage_platform grant is enforced first.
const { mockPrisma, mockCan, mockAuth, mockRevalidate } = vi.hoisted(() => ({
  mockPrisma: { platformDevConfig: { upsert: vi.fn(), findUnique: vi.fn() } },
  mockCan: vi.fn(),
  mockAuth: vi.fn(),
  mockRevalidate: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

describe("saveGovernedBacklogSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u-1", platformRole: "admin", isSuperuser: false } });
    mockCan.mockReturnValue(true);
    mockPrisma.platformDevConfig.upsert.mockResolvedValue({});
  });

  it("turns the lane on with a cap and revalidates the two surfaces that read it", async () => {
    const { saveGovernedBacklogSettings } = await import("./governed-backlog-settings");
    const result = await saveGovernedBacklogSettings({ enabled: true, dailyCap: 5 });
    expect(result).toEqual({ ok: true, data: { enabled: true, dailyCap: 5 } });
    const call = mockPrisma.platformDevConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: "singleton" });
    expect(call.update).toMatchObject({ governedBacklogEnabled: true, backlogTeeUpDailyCap: 5, configuredById: "u-1" });
    expect(call.create).toMatchObject({ id: "singleton", governedBacklogEnabled: true, backlogTeeUpDailyCap: 5 });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/platform-development");
    expect(mockRevalidate).toHaveBeenCalledWith("/build");
  });

  it("keeps the stored cap when none is supplied and turns the lane off", async () => {
    const { saveGovernedBacklogSettings } = await import("./governed-backlog-settings");
    const result = await saveGovernedBacklogSettings({ enabled: false });
    expect(result).toEqual({ ok: true, data: { enabled: false, dailyCap: null } });
    const call = mockPrisma.platformDevConfig.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty("backlogTeeUpDailyCap");
    expect(call.update.governedBacklogEnabled).toBe(false);
  });

  it("refuses a cap outside 0..50 or non-integer before writing", async () => {
    const { saveGovernedBacklogSettings } = await import("./governed-backlog-settings");
    for (const dailyCap of [-1, 51, 2.5]) {
      const result = await saveGovernedBacklogSettings({ enabled: true, dailyCap });
      expect(result.ok).toBe(false);
    }
    expect(mockPrisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });

  it("enforces manage_platform before touching the config", async () => {
    mockCan.mockReturnValue(false);
    const { saveGovernedBacklogSettings } = await import("./governed-backlog-settings");
    await expect(saveGovernedBacklogSettings({ enabled: true })).rejects.toThrow();
    expect(mockPrisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });
});
