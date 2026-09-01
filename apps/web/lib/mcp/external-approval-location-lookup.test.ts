import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    coworkerActionEnvelope: {
      findFirst: (...args: unknown[]) => db.findFirst(...args),
    },
  },
}));

import { loadExternalApprovalLocationForTaskRun } from "./external-approval-location-lookup";

const OWNER = "admin-token-user";
const TASK = "TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-0C8D679DE842";
const ENVELOPE = "cmthpk6kpfylj01lc5r5cealp";

beforeEach(() => {
  vi.clearAllMocks();
  db.findFirst.mockResolvedValue(null);
});

describe("loadExternalApprovalLocationForTaskRun", () => {
  it("returns the token owner's pending envelope and approval location", async () => {
    db.findFirst.mockResolvedValue({
      id: ENVELOPE,
      delegatingUserId: OWNER,
      taskRunId: TASK,
      status: "proposed",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      rationale: "Record research evidence.",
      manifestActionId: "record_initiative_evidence",
    });

    const location = await loadExternalApprovalLocationForTaskRun({
      taskRunId: TASK,
      callerUserId: OWNER,
    });

    expect(location?.envelopeId).toBe(ENVELOPE);
    expect(location?.delegatingUserId).toBe(OWNER);
    expect(location?.inboxHref).toBe("/workspace/inbox");
    expect(location?.approveHref).toBe(`/api/agent/envelope/${ENVELOPE}/approve`);
    expect(db.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        taskRunId: TASK,
        delegatingUserId: OWNER,
        status: "proposed",
      }),
    }));
  });

  it("never queries another user's envelopes for an empty caller", async () => {
    expect(await loadExternalApprovalLocationForTaskRun({
      taskRunId: TASK,
      callerUserId: "",
    })).toBeNull();
    expect(db.findFirst).not.toHaveBeenCalled();
  });

  it("asks only for the caller's proposed unexpired envelope", async () => {
    await loadExternalApprovalLocationForTaskRun({
      taskRunId: TASK,
      callerUserId: OWNER,
    });
    const where = db.findFirst.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.delegatingUserId).toBe(OWNER);
    expect(where.status).toBe("proposed");
    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ]);
  });
});
