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
    changeItem: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    changePromotion: {
      update: vi.fn(),
    },
    changeRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { executeRollback, rollbackRFC } from "./rollback-strategies";

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

// ─── executeRollback ─────────────────────────────────────────────────────────

describe("executeRollback", () => {
  it("returns failure when change item not found", async () => {
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue(null as never);

    const result = await executeRollback("nonexistent-id");

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("marks ChangePromotion as rolled_back for code_deployment", async () => {
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-1",
      itemType: "code_deployment",
      changePromotionId: "cp-id-1",
      changePromotion: {
        id: "cp-id-1",
        promotionId: "CP-AABBCCDD",
        status: "deployed",
      },
      rollbackSnapshot: null,
    } as never);
    vi.mocked(prisma.changePromotion.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);

    const result = await executeRollback("item-1");

    expect(result.success).toBe(true);
    expect(result.message).toContain("CP-AABBCCDD");
    expect(result.message).toContain("rolled_back");

    const promoUpdate = vi.mocked(prisma.changePromotion.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(promoUpdate.data.status).toBe("rolled_back");
    expect(promoUpdate.data.rolledBackAt).toBeInstanceOf(Date);
    expect(promoUpdate.data.rollbackReason).toContain("item-1");
  });

  it("handles code_deployment without linked ChangePromotion", async () => {
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-2",
      itemType: "code_deployment",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: null,
    } as never);
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);

    const result = await executeRollback("item-2");

    expect(result.success).toBe(true);
    expect(result.message).toContain("no linked ChangePromotion");
    expect(prisma.changePromotion.update).not.toHaveBeenCalled();
  });

  it("logs snapshot restore message for infrastructure with snapshot", async () => {
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-3",
      itemType: "infrastructure",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: { config: "previous-state" },
    } as never);
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);

    const result = await executeRollback("item-3");

    expect(result.success).toBe(true);
    expect(result.message).toContain("snapshot available");
  });

  it("logs no-snapshot message for infrastructure without snapshot", async () => {
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-4",
      itemType: "infrastructure",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: null,
    } as never);
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);

    const result = await executeRollback("item-4");

    expect(result.success).toBe(true);
    expect(result.message).toContain("no snapshot available");
  });

  it("logs snapshot restore message for configuration with snapshot", async () => {
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-5",
      itemType: "configuration",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: { setting: "old-value" },
    } as never);
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);

    const result = await executeRollback("item-5");

    expect(result.success).toBe(true);
    expect(result.message).toContain("Configuration rollback");
    expect(result.message).toContain("snapshot available");
  });

  it("returns manual rollback required for external items", async () => {
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-6",
      itemType: "external",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: null,
    } as never);
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);

    const result = await executeRollback("item-6");

    expect(result.success).toBe(true);
    expect(result.message).toBe("Manual rollback required");
  });

  it("records rollback timestamp and notes on ChangeItem", async () => {
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-7",
      itemType: "configuration",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: null,
    } as never);
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);

    await executeRollback("item-7");

    const updateCall = vi.mocked(prisma.changeItem.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("rolled-back");
    expect(updateCall.data.rolledBackAt).toBeInstanceOf(Date);
    expect(updateCall.data.rollbackNotes).toBeTruthy();
  });
});

// ─── rollbackRFC ─────────────────────────────────────────────────────────────

describe("rollbackRFC", () => {
  it("throws when RFC not found", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue(null as never);

    await expect(rollbackRFC("RFC-2026-NONEXIST", "test")).rejects.toThrow(
      "RFC not found"
    );
  });

  it("throws when RFC is in invalid status for rollback", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-11111111",
      status: "draft",
      changeItems: [],
    } as never);

    await expect(
      rollbackRFC("RFC-2026-11111111", "test reason")
    ).rejects.toThrow(/Cannot rollback RFC in "draft" status/);
  });

  it("reverses completed items in reverse execution order", async () => {
    const rollbackOrder: string[] = [];
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-22222222",
      status: "completed",
      changeItems: [
        // Already sorted DESC by executionOrder from the query
        {
          id: "item-c",
          itemType: "configuration",
          executionOrder: 3,
          status: "completed",
          changePromotionId: null,
          changePromotion: null,
          rollbackSnapshot: null,
        },
        {
          id: "item-b",
          itemType: "infrastructure",
          executionOrder: 2,
          status: "completed",
          changePromotionId: null,
          changePromotion: null,
          rollbackSnapshot: null,
        },
        {
          id: "item-a",
          itemType: "external",
          executionOrder: 1,
          status: "completed",
          changePromotionId: null,
          changePromotion: null,
          rollbackSnapshot: null,
        },
      ],
    } as never);

    vi.mocked(prisma.changeItem.findUnique).mockImplementation(((args: { where: { id: string } }) => {
      const id = args.where.id;
      rollbackOrder.push(id);
      return Promise.resolve({
        id,
        itemType: id === "item-c" ? "configuration" : id === "item-b" ? "infrastructure" : "external",
        changePromotionId: null,
        changePromotion: null,
        rollbackSnapshot: null,
      });
    }) as never);

    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const result = await rollbackRFC("RFC-2026-22222222", "Health check failed");

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);

    // Items should be rolled back in reverse order (3, 2, 1)
    expect(rollbackOrder).toEqual(["item-c", "item-b", "item-a"]);

    // RFC should be updated to rolled-back
    const rfcUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(rfcUpdate.data.status).toBe("rolled-back");
    expect(rfcUpdate.data.outcome).toBe("rolled-back");
    expect(rfcUpdate.data.outcomeNotes).toBe("Health check failed");
  });

  it("accepts rollback of in-progress RFC", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-33333333",
      status: "in-progress",
      changeItems: [],
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const result = await rollbackRFC("RFC-2026-33333333", "Execution failure");

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it("calls revalidatePath after rollback", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-44444444",
      status: "completed",
      changeItems: [],
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await rollbackRFC("RFC-2026-44444444", "Post-deploy issue");

    expect(revalidatePath).toHaveBeenCalledWith("/ops");
  });
});
