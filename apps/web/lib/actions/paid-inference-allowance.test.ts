import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-F3B6713F: the owner-set paid AI allowance's only writer. A spending
// decision: needs platform and finance capability and records who and why.
const { mockPrisma, mockCan, mockAuth, mockRevalidate } = vi.hoisted(() => ({
  mockPrisma: { platformDevConfig: { upsert: vi.fn() } },
  mockCan: vi.fn(),
  mockAuth: vi.fn(),
  mockRevalidate: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

import { savePaidInferenceAllowance } from "./paid-inference-allowance";

describe("savePaidInferenceAllowance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u-1", platformRole: "admin", isSuperuser: false } });
    mockCan.mockReturnValue(true);
    mockPrisma.platformDevConfig.upsert.mockResolvedValue({});
  });

  it("records the amount with who set it and why", async () => {
    expect(await savePaidInferenceAllowance({ dailyUsd: 25.456, reason: "Sized to measured review volume" }))
      .toEqual({ ok: true, data: { dailyUsd: 25.46 } });
    const call = mockPrisma.platformDevConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: "singleton" });
    expect(call.update).toMatchObject({ paidInferenceDailyUsdAllowance: 25.46, paidInferenceAllowanceSetById: "u-1",
      paidInferenceAllowanceReason: "Sized to measured review volume" });
    expect(call.update.paidInferenceAllowanceSetAt).toBeInstanceOf(Date);
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/platform-development");
  });

  it("clears the amount so the built-in caps apply again", async () => {
    expect(await savePaidInferenceAllowance({ dailyUsd: null, reason: "Back to defaults" })).toEqual({ ok: true, data: { dailyUsd: null } });
    expect(mockPrisma.platformDevConfig.upsert.mock.calls[0][0].update.paidInferenceDailyUsdAllowance).toBeNull();
  });

  it("refuses a missing reason or an invalid amount before writing", async () => {
    expect((await savePaidInferenceAllowance({ dailyUsd: 10, reason: "  " })).ok).toBe(false);
    expect((await savePaidInferenceAllowance({ dailyUsd: -1, reason: "x" })).ok).toBe(false);
    expect((await savePaidInferenceAllowance({ dailyUsd: Number.NaN, reason: "x" })).ok).toBe(false);
    expect(mockPrisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });

  it("requires the finance capability as well as platform management", async () => {
    mockCan.mockImplementation((_user: unknown, capability: string) => capability !== "manage_finance");
    await expect(savePaidInferenceAllowance({ dailyUsd: 10, reason: "x" })).rejects.toThrow("Unauthorized");
    expect(mockPrisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });
});
