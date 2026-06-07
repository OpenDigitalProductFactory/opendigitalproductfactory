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

import {
  SIGNAL_BACKLOG_THRESHOLD,
  createOrTouchImprovementSignal,
  signalSourceTypeToWorkType,
} from "./signals";

describe("signalSourceTypeToWorkType", () => {
  it("maps skill/curation, tool, doc, and defaults the rest to bug", () => {
    expect(signalSourceTypeToWorkType("skill_curation")).toBe("skill");
    expect(signalSourceTypeToWorkType("tool_failure")).toBe("tool");
    expect(signalSourceTypeToWorkType("doc_gap")).toBe("doc");
    expect(signalSourceTypeToWorkType("user_correction")).toBe("bug");
  });
});

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

  it("files once when recurrence reaches the threshold and back-links the signal", async () => {
    findUnique.mockResolvedValue({ signalId: "IS-EXISTING" });
    update
      .mockResolvedValueOnce({ recurrenceCount: SIGNAL_BACKLOG_THRESHOLD, backlogItemId: null })
      .mockResolvedValueOnce({});
    const fileBacklogItem = vi.fn(async () => ({ itemId: "BI-SIG-1" }));

    const result = await createOrTouchImprovementSignal(
      { sourceType: "platform_issue_report", sourceId: "PIR-AB12C", title: "Persistent friction" },
      { fileBacklogItem },
    );

    expect(fileBacklogItem).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: "IS-EXISTING", recurrenceCount: SIGNAL_BACKLOG_THRESHOLD }),
    );
    expect(result).toEqual({ signalId: "IS-EXISTING", isNew: false, backlogItemId: "BI-SIG-1" });
    // Second update persists the back-link.
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { backlogItemId: "BI-SIG-1" } }));
  });

  it("does not re-file a signal that already has a backlog item", async () => {
    findUnique.mockResolvedValue({ signalId: "IS-EXISTING" });
    update.mockResolvedValue({
      recurrenceCount: SIGNAL_BACKLOG_THRESHOLD + 5,
      backlogItemId: "BI-SIG-EXISTING",
    });
    const fileBacklogItem = vi.fn();

    const result = await createOrTouchImprovementSignal(
      { sourceType: "platform_issue_report", sourceId: "PIR-AB12C", title: "Already filed" },
      { fileBacklogItem },
    );

    expect(fileBacklogItem).not.toHaveBeenCalled();
    expect(result.backlogItemId).toBe("BI-SIG-EXISTING");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("stays non-fatal when projection fails — signal recorded, no back-link", async () => {
    findUnique.mockResolvedValue({ signalId: "IS-EXISTING" });
    update.mockResolvedValue({ recurrenceCount: SIGNAL_BACKLOG_THRESHOLD, backlogItemId: null });
    const fileBacklogItem = vi.fn(async () => null);

    const result = await createOrTouchImprovementSignal(
      { sourceType: "platform_issue_report", sourceId: "PIR-AB12C", title: "Projection fails" },
      { fileBacklogItem },
    );

    expect(fileBacklogItem).toHaveBeenCalledOnce();
    expect(result).toEqual({ signalId: "IS-EXISTING", isNew: false });
    expect(update).toHaveBeenCalledTimes(1); // no link write
  });
});
