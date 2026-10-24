import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), activity: vi.fn() }));
vi.mock("@dpf/db", () => {
  const tx = { backlogItem: { update: m.update }, backlogItemActivity: { create: m.activity } };
  return {
    attributeBacklogPortfolio: vi.fn(),
    prisma: {
      backlogItem: { findUnique: m.find },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { handleUpdateBacklogItem } from "./backlog-update-item-handler";

describe("update_backlog_item sensitivity (BI-0A5EE9C1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.find.mockResolvedValue({ id: "row-1", itemId: "BI-1", status: "open", sensitivity: "internal", demandStage: "raw" });
  });

  it("marks an item confidential and audits the change", async () => {
    const result = await handleUpdateBacklogItem({ itemId: "BI-1", sensitivity: "confidential" }, "user-1", { agentId: "AGT-1" });
    expect(result.success).toBe(true);
    expect(m.update.mock.calls[0][0].data).toEqual({ sensitivity: "confidential" });
    expect(m.activity.mock.calls[0][0].data).toMatchObject({
      backlogItemId: "row-1", kind: "sensitivity_changed",
      payload: { from: "internal", to: "confidential" }, recordedById: "user-1", recordedByAgentId: "AGT-1",
    });
  });

  it("rejects a value outside the classification vocabulary", async () => {
    const result = await handleUpdateBacklogItem({ itemId: "BI-1", sensitivity: "secret" });
    expect(result).toMatchObject({ success: false, error: "invalid_sensitivity" });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("records nothing when the value is unchanged", async () => {
    await handleUpdateBacklogItem({ itemId: "BI-1", sensitivity: "internal" });
    expect(m.activity).not.toHaveBeenCalled();
  });
});
