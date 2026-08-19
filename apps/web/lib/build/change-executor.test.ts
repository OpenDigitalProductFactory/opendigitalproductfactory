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
    changeRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    changeItem: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    changePromotion: {
      update: vi.fn(),
    },
    inventoryEntity: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock fetch for health checks
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  executeChangeItems,
  runHealthCheck,
} from "./change-executor";

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

// ─── runHealthCheck ──────────────────────────────────────────────────────────

describe("runHealthCheck", () => {
  it("returns healthy when entity not found", async () => {
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue(null as never);

    const result = await runHealthCheck("nonexistent");

    expect(result.healthy).toBe(true);
    expect(result.message).toContain("not found");
  });

  it("returns healthy when no health endpoint configured", async () => {
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue({
      properties: { name: "some-service" },
    } as never);

    const result = await runHealthCheck("entity-1");

    expect(result.healthy).toBe(true);
    expect(result.message).toContain("No health endpoint");
  });

  it("returns healthy when endpoint returns 200", async () => {
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue({
      properties: { healthEndpoint: "http://localhost:3000/health" },
    } as never);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await runHealthCheck("entity-1");

    expect(result.healthy).toBe(true);
    expect(result.message).toContain("200");
  });

  it("returns unhealthy when endpoint returns 500", async () => {
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue({
      properties: { healthEndpoint: "http://localhost:3000/health" },
    } as never);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await runHealthCheck("entity-1");

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("500");
  });

  it("returns unhealthy when fetch throws (timeout/network error)", async () => {
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue({
      properties: { healthEndpoint: "http://localhost:3000/health" },
    } as never);
    mockFetch.mockRejectedValue(new Error("The operation was aborted"));

    const result = await runHealthCheck("entity-1");

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("aborted");
  });
});

// ─── executeChangeItems ──────────────────────────────────────────────────────

describe("executeChangeItems", () => {
  it("throws when RFC not found", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue(null as never);

    await expect(executeChangeItems("RFC-2026-NONEXIST")).rejects.toThrow(
      "RFC not found"
    );
  });

  it("throws when RFC is not in-progress", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-11111111",
      status: "draft",
      changeItems: [],
    } as never);

    await expect(executeChangeItems("RFC-2026-11111111")).rejects.toThrow(
      /must be in "in-progress" status/
    );
  });

  it("executes items in order and completes RFC on success", async () => {
    const updateOrder: string[] = [];

    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-22222222",
      status: "in-progress",
      changeItems: [
        {
          id: "item-a",
          status: "pending",
          executionOrder: 1,
          inventoryEntityId: null,
        },
        {
          id: "item-b",
          status: "pending",
          executionOrder: 2,
          inventoryEntityId: null,
        },
        {
          id: "item-c",
          status: "pending",
          executionOrder: 3,
          inventoryEntityId: null,
        },
      ],
    } as never);

    vi.mocked(prisma.changeItem.update).mockImplementation(((args: {
      where: { id: string };
      data: { status: string };
    }) => {
      if (args.data.status === "completed") {
        updateOrder.push(args.where.id);
      }
      return Promise.resolve({} as never);
    }) as never);

    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const result = await executeChangeItems("RFC-2026-22222222");

    expect(result.success).toBe(true);
    expect(result.rollbackTriggered).toBe(false);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.status === "completed")).toBe(true);

    // Items executed in order
    expect(updateOrder).toEqual(["item-a", "item-b", "item-c"]);

    // RFC updated to completed
    const rfcUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(rfcUpdate.data.status).toBe("completed");
    expect(rfcUpdate.data.outcome).toBe("success");
    expect(rfcUpdate.data.completedAt).toBeInstanceOf(Date);
  });

  it("runs health check between items and continues when healthy", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-33333333",
      status: "in-progress",
      changeItems: [
        {
          id: "item-a",
          status: "pending",
          executionOrder: 1,
          inventoryEntityId: "entity-1",
        },
        {
          id: "item-b",
          status: "pending",
          executionOrder: 2,
          inventoryEntityId: null,
        },
      ],
    } as never);

    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    // Entity has a health endpoint that returns OK
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue({
      properties: { healthEndpoint: "http://localhost:3000/health" },
    } as never);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await executeChangeItems("RFC-2026-33333333");

    expect(result.success).toBe(true);
    expect(result.rollbackTriggered).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("stops and triggers rollback on health check failure", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-44444444",
      status: "in-progress",
      changeItems: [
        {
          id: "item-a",
          status: "pending",
          executionOrder: 1,
          inventoryEntityId: "entity-1",
        },
        {
          id: "item-b",
          status: "pending",
          executionOrder: 2,
          inventoryEntityId: null,
        },
      ],
    } as never);

    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    // Health check fails
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue({
      properties: { healthEndpoint: "http://localhost:3000/health" },
    } as never);
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    // Mock executeRollback's prisma.changeItem.findUnique call
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-a",
      itemType: "configuration",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: null,
    } as never);

    const result = await executeChangeItems("RFC-2026-44444444");

    expect(result.success).toBe(false);
    expect(result.rollbackTriggered).toBe(true);

    // item-a completed then health check failed, item-b should be skipped
    const completedResults = result.results.filter((r) => r.status === "completed");
    const skippedResults = result.results.filter((r) => r.status === "skipped");
    expect(completedResults).toHaveLength(1);
    expect(skippedResults).toHaveLength(1);
    expect(skippedResults[0].changeItemId).toBe("item-b");

    // RFC should be rolled back
    const rfcUpdateCalls = vi.mocked(prisma.changeRequest.update).mock.calls;
    const lastRfcUpdate = rfcUpdateCalls[rfcUpdateCalls.length - 1][0] as {
      data: Record<string, unknown>;
    };
    expect(lastRfcUpdate.data.status).toBe("rolled-back");
  });

  it("rolls back completed items in reverse order on failure", async () => {
    const rollbackOrder: string[] = [];

    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-55555555",
      status: "in-progress",
      changeItems: [
        {
          id: "item-a",
          status: "pending",
          executionOrder: 1,
          inventoryEntityId: null,
        },
        {
          id: "item-b",
          status: "pending",
          executionOrder: 2,
          inventoryEntityId: null,
        },
        {
          id: "item-c",
          status: "pending",
          executionOrder: 3,
          inventoryEntityId: "entity-fail",
        },
      ],
    } as never);

    // Let items a and b complete, item c completes but health check fails
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    // Health check fails for entity-fail
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue({
      properties: { healthEndpoint: "http://localhost:3000/health" },
    } as never);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    // Track rollback order via changeItem.findUnique calls from executeRollback
    vi.mocked(prisma.changeItem.findUnique).mockImplementation(((args: {
      where: { id: string };
    }) => {
      rollbackOrder.push(args.where.id);
      return Promise.resolve({
        id: args.where.id,
        itemType: "configuration",
        changePromotionId: null,
        changePromotion: null,
        rollbackSnapshot: null,
      });
    }) as never);

    const result = await executeChangeItems("RFC-2026-55555555");

    expect(result.success).toBe(false);
    expect(result.rollbackTriggered).toBe(true);

    // Items a, b, c were completed. Rollback should be in reverse: c, b, a
    expect(rollbackOrder).toEqual(["item-c", "item-b", "item-a"]);
  });

  it("handles execution error with rollback", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-66666666",
      status: "in-progress",
      changeItems: [
        {
          id: "item-a",
          status: "pending",
          executionOrder: 1,
          inventoryEntityId: null,
        },
        {
          id: "item-b",
          status: "pending",
          executionOrder: 2,
          inventoryEntityId: null,
        },
      ],
    } as never);

    let callCount = 0;
    vi.mocked(prisma.changeItem.update).mockImplementation((() => {
      callCount++;
      // First two calls are for item-a (in-progress + completed)
      // Third call is for item-b (in-progress) — succeeds
      // Fourth call would be item-b (completed) — throw error
      if (callCount === 4) {
        return Promise.reject(new Error("Database connection lost"));
      }
      return Promise.resolve({} as never);
    }) as never);

    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    // Mock executeRollback's findUnique for the rollback of item-a
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-a",
      itemType: "configuration",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: null,
    } as never);

    const result = await executeChangeItems("RFC-2026-66666666");

    expect(result.success).toBe(false);
    expect(result.rollbackTriggered).toBe(true);

    const failedResults = result.results.filter((r) => r.status === "failed");
    expect(failedResults).toHaveLength(1);
    expect(failedResults[0].message).toContain("Database connection lost");
  });

  it("skips items that are not in pending status", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-77777777",
      status: "in-progress",
      changeItems: [
        {
          id: "item-a",
          status: "completed",
          executionOrder: 1,
          inventoryEntityId: null,
        },
        {
          id: "item-b",
          status: "pending",
          executionOrder: 2,
          inventoryEntityId: null,
        },
      ],
    } as never);

    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const result = await executeChangeItems("RFC-2026-77777777");

    expect(result.success).toBe(true);
    expect(result.results[0].status).toBe("skipped");
    expect(result.results[0].message).toContain("already in");
    expect(result.results[1].status).toBe("completed");
  });

  it("calls revalidatePath after successful execution", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-88888888",
      status: "in-progress",
      changeItems: [],
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await executeChangeItems("RFC-2026-88888888");

    expect(revalidatePath).toHaveBeenCalledWith("/ops");
  });
});
