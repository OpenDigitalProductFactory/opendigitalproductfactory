import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, create, update } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    improvementSignal: { findUnique, create, update },
  },
}));

import { createOrTouchImprovementSignal } from "./signals";

describe("createOrTouchImprovementSignal", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
    update.mockReset();
  });

  it("creates a new signal when (sourceType, sourceId) is not present", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({});

    const result = await createOrTouchImprovementSignal({
      sourceType: "platform_issue_report",
      sourceId: "PIR-AB12C",
      title: "Coworker repeated create_backlog_item",
      evidence: { count: 3 },
      agentId: "AGT-1",
      threadId: "thread-1",
      routeContext: "/customer",
    });

    expect(result.isNew).toBe(true);
    expect(result.signalId.startsWith("IS-")).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.sourceType).toBe("platform_issue_report");
    expect(data.sourceId).toBe("PIR-AB12C");
    expect(data.evidence).toEqual({ count: 3 });
    expect(data.routeContext).toBe("/customer");
  });

  it("increments recurrenceCount on a duplicate (sourceType, sourceId)", async () => {
    findUnique.mockResolvedValue({ signalId: "IS-EXISTING" });
    update.mockResolvedValue({});

    const result = await createOrTouchImprovementSignal({
      sourceType: "platform_issue_report",
      sourceId: "PIR-AB12C",
      title: "Coworker repeated create_backlog_item",
    });

    expect(result).toEqual({ signalId: "IS-EXISTING", isNew: false });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = update.mock.calls[0]?.[0] as {
      where: { sourceType_sourceId: { sourceType: string; sourceId: string } };
      data: { recurrenceCount: { increment: number }; lastSeenAt: Date };
    };
    expect(updateCall.where.sourceType_sourceId).toEqual({
      sourceType: "platform_issue_report",
      sourceId: "PIR-AB12C",
    });
    expect(updateCall.data.recurrenceCount).toEqual({ increment: 1 });
    expect(updateCall.data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("preserves the original evidence on duplicate (does not overwrite)", async () => {
    findUnique.mockResolvedValue({ signalId: "IS-EXISTING" });
    update.mockResolvedValue({});

    await createOrTouchImprovementSignal({
      sourceType: "platform_issue_report",
      sourceId: "PIR-AB12C",
      title: "...",
      evidence: { newFieldThatShouldBeIgnored: true },
    });

    const updateCall = update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty("evidence");
  });
});
