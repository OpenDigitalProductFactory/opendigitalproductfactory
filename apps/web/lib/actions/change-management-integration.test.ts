import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────

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
    $transaction: vi.fn(),
    productVersion: { create: vi.fn() },
    changePromotion: { create: vi.fn(), update: vi.fn() },
    changeRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    changeItem: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    inventoryEntity: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../actions/change-management", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions/change-management")>();
  return {
    ...actual,
    generateRfcId: vi.fn(() => "RFC-2026-INTG0001"),
  };
});

// Mock fetch for health checks
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { createProductVersionWithRFC } from "@/lib/version-tracking";
import {
  submitRFC,
  assessRFC,
  approveRFC,
  scheduleRFC,
  transitionRFC,
} from "./change-management";
import { executeChangeItems } from "@/lib/change-executor";
import { rollbackRFC } from "@/lib/rollback-strategies";

// ─── Shared Setup ───────────────────────────────────────────────────────────

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

// ─── Test 1: Full Self-Dev Flow ─────────────────────────────────────────────

describe("Self-development flow: shipBuild → auto-RFC → approve → schedule → execute → verify", () => {
  it("completes the full promotion lifecycle", async () => {
    // ── Step 1: createProductVersionWithRFC ──────────────────────────────
    const txMocks = {
      productVersion: { create: vi.fn().mockResolvedValue({ id: "pv-1" }) },
      changePromotion: { create: vi.fn().mockResolvedValue({ id: "cp-1" }) },
      changeRequest: { create: vi.fn().mockResolvedValue({ id: "cr-1" }) },
      changeItem: { create: vi.fn().mockResolvedValue({ id: "ci-1" }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(txMocks));

    const created = await createProductVersionWithRFC({
      digitalProductId: "dp-1",
      version: "1.0.0",
      gitTag: "v1.0.0",
      gitCommitHash: "abc123",
      shippedBy: "user-1",
      changeSummary: "Initial release",
    });

    expect(created.version).toEqual({ id: "pv-1" });
    expect(created.promotion.id).toBe("cp-1");
    expect(created.promotion.promotionId).toMatch(/^CP-/);
    expect(created.rfc.id).toBe("cr-1");
    expect(created.rfc.rfcId).toBe("RFC-2026-INTG0001");

    // Verify RFC was created in draft status
    const rfcData = txMocks.changeRequest.create.mock.calls[0][0].data;
    expect(rfcData.status).toBe("draft");

    // ── Step 2: submitRFC ────────────────────────────────────────────────
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INTG0001",
      status: "draft",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await submitRFC("RFC-2026-INTG0001");

    const submitUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(submitUpdate.data.status).toBe("submitted");
    expect(submitUpdate.data.submittedAt).toBeInstanceOf(Date);

    // ── Step 3: assessRFC ────────────────────────────────────────────────
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as never);
    vi.mocked(can).mockReturnValue(true);

    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INTG0001",
      status: "submitted",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const impact = { affectedSystems: ["api"], riskScore: 2 };
    await assessRFC("RFC-2026-INTG0001", impact);

    const assessUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(assessUpdate.data.status).toBe("assessed");
    expect(assessUpdate.data.impactReport).toEqual(impact);
    expect(assessUpdate.data.assessedAt).toBeInstanceOf(Date);

    // ── Step 4: approveRFC ───────────────────────────────────────────────
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as never);
    vi.mocked(can).mockReturnValue(true);

    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INTG0001",
      status: "assessed",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await approveRFC("RFC-2026-INTG0001", "Low risk, ship it");

    const approveUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(approveUpdate.data.status).toBe("approved");
    expect(approveUpdate.data.approvedAt).toBeInstanceOf(Date);

    // ── Step 5: scheduleRFC ──────────────────────────────────────────────
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as never);
    vi.mocked(can).mockReturnValue(true);

    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INTG0001",
      status: "approved",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const scheduledDate = new Date("2026-04-01T02:00:00Z");
    await scheduleRFC("RFC-2026-INTG0001", scheduledDate);

    const scheduleUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(scheduleUpdate.data.status).toBe("scheduled");
    expect(scheduleUpdate.data.plannedStartAt).toEqual(scheduledDate);

    // ── Step 6: transitionRFC to in-progress ─────────────────────────────
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as never);
    vi.mocked(can).mockReturnValue(true);

    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INTG0001",
      status: "scheduled",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await transitionRFC("RFC-2026-INTG0001", "in-progress");

    const progressUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(progressUpdate.data.status).toBe("in-progress");
    expect(progressUpdate.data.startedAt).toBeInstanceOf(Date);

    // ── Step 7: executeChangeItems ───────────────────────────────────────
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as never);
    vi.mocked(can).mockReturnValue(true);

    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INTG0001",
      status: "in-progress",
      changeItems: [
        {
          id: "ci-1",
          status: "pending",
          executionOrder: 1,
          inventoryEntityId: null,
        },
      ],
    } as never);
    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const execResult = await executeChangeItems("RFC-2026-INTG0001");

    expect(execResult.success).toBe(true);
    expect(execResult.rollbackTriggered).toBe(false);
    expect(execResult.results).toHaveLength(1);
    expect(execResult.results[0].status).toBe("completed");

    // RFC should be completed
    const completeUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(completeUpdate.data.status).toBe("completed");
    expect(completeUpdate.data.completedAt).toBeInstanceOf(Date);
    expect(completeUpdate.data.outcome).toBe("success");
  });
});

// ─── Test 2: Execution Failure Triggers Auto-Rollback ───────────────────────

describe("Execution failure triggers auto-rollback", () => {
  it("rolls back completed items and marks RFC as rolled-back on health check failure", async () => {
    // RFC in-progress with two items; first item has a health-checked entity
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-ROLLBACK",
      status: "in-progress",
      changeItems: [
        {
          id: "item-1",
          status: "pending",
          executionOrder: 1,
          inventoryEntityId: "entity-1",
        },
        {
          id: "item-2",
          status: "pending",
          executionOrder: 2,
          inventoryEntityId: null,
        },
      ],
    } as never);

    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    // Health check returns 500 after item-1 completes
    vi.mocked(prisma.inventoryEntity.findUnique).mockResolvedValue({
      properties: { healthEndpoint: "http://localhost:3000/health" },
    } as never);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    // Mock executeRollback's findUnique for rollback of item-1
    vi.mocked(prisma.changeItem.findUnique).mockResolvedValue({
      id: "item-1",
      itemType: "configuration",
      changePromotionId: null,
      changePromotion: null,
      rollbackSnapshot: null,
    } as never);

    const result = await executeChangeItems("RFC-2026-ROLLBACK");

    // First item completed, then health check failed
    expect(result.success).toBe(false);
    expect(result.rollbackTriggered).toBe(true);

    // item-1 was completed, item-2 should be skipped
    const completedResults = result.results.filter((r) => r.status === "completed");
    const skippedResults = result.results.filter((r) => r.status === "skipped");
    expect(completedResults).toHaveLength(1);
    expect(completedResults[0].changeItemId).toBe("item-1");
    expect(skippedResults).toHaveLength(1);
    expect(skippedResults[0].changeItemId).toBe("item-2");

    // RFC status should be rolled-back
    const rfcUpdateCalls = vi.mocked(prisma.changeRequest.update).mock.calls;
    const lastRfcUpdate = rfcUpdateCalls[rfcUpdateCalls.length - 1][0] as {
      data: Record<string, unknown>;
    };
    expect(lastRfcUpdate.data.status).toBe("rolled-back");
    expect(lastRfcUpdate.data.outcomeNotes).toContain("Health check failed");
  });
});

// ─── Test 3: One-Click Rollback Reverses Completed RFC ──────────────────────

describe("One-click rollback reverses completed RFC", () => {
  it("rolls back items in reverse execution order and updates RFC status", async () => {
    const rollbackOrder: string[] = [];

    // RFC completed with two items, returned in DESC order by executionOrder
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-ONECLICK",
      status: "completed",
      changeItems: [
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
          itemType: "configuration",
          executionOrder: 1,
          status: "completed",
          changePromotionId: null,
          changePromotion: null,
          rollbackSnapshot: null,
        },
      ],
    } as never);

    // Track rollback order through executeRollback's changeItem.findUnique calls
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

    vi.mocked(prisma.changeItem.update).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const result = await rollbackRFC("RFC-2026-ONECLICK", "Operator requested");

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);

    // Items rolled back in reverse execution order: item-b (order 2) first, then item-a (order 1)
    // rollbackRFC queries with orderBy executionOrder DESC, so item-b comes first
    expect(rollbackOrder).toEqual(["item-b", "item-a"]);

    // RFC should be updated to rolled-back with the reason
    const rfcUpdate = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(rfcUpdate.data.status).toBe("rolled-back");
    expect(rfcUpdate.data.outcome).toBe("rolled-back");
    expect(rfcUpdate.data.outcomeNotes).toBe("Operator requested");
  });
});

// ─── Test 4: Invalid Transitions Are Rejected ───────────────────────────────

describe("Invalid transitions are rejected", () => {
  it("rejects direct approval from draft (skipping submit and assess)", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INVALID1",
      status: "draft",
    } as never);

    await expect(
      approveRFC("RFC-2026-INVALID1", "Trying to skip steps")
    ).rejects.toThrow(/Invalid transition/);
  });

  it("rejects scheduling before approval", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INVALID2",
      status: "assessed",
    } as never);

    const scheduledDate = new Date("2026-05-01T00:00:00Z");
    await expect(
      scheduleRFC("RFC-2026-INVALID2", scheduledDate)
    ).rejects.toThrow(/Invalid transition/);
  });

  it("rejects submitting from assessed status", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INVALID3",
      status: "assessed",
    } as never);

    await expect(
      submitRFC("RFC-2026-INVALID3")
    ).rejects.toThrow(/Invalid transition/);
  });

  it("rejects transitioning completed back to draft", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-INVALID4",
      status: "completed",
    } as never);

    await expect(
      transitionRFC("RFC-2026-INVALID4", "draft")
    ).rejects.toThrow(/Invalid transition/);
  });
});
