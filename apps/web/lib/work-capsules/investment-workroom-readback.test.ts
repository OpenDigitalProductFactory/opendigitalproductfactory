import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, projection } = vi.hoisted(() => ({
  db: { workroom: { findUnique: vi.fn() }, workroomActivity: { findMany: vi.fn() } },
  projection: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("../portfolio/investment-balance-server", () => ({ projectItemInvestment: projection }));
vi.mock("@/lib/work-management/semantic-review-room-projection", () => ({
  loadSemanticReviewRoomProjection: vi.fn(async () => ({ runs: [], partial: false, attentionReason: null })),
}));

import { getWorkCapsuleTool } from "./mcp-handlers";
import { clampToolResultForModel, MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

const room = {
  id: "room-row", capsuleId: "WC-FUNDING", backlogItemId: "BI-FUNDING", status: "ready",
  repositoryFullName: "owner/repo", headBranch: "feat/funding", worktreePath: "D:/funding",
  baseSha: "0".repeat(40), headSha: "1".repeat(40), taskRun: null, activities: [],
  leaseHolderPrincipalId: "funding-owner", executorRef: "current-executor", activitySequence: 11,
};
const investment = {
  resolved: true, ownerKind: "founder", scope: { principalId: "funding-owner", organizationId: "org", purpose: "shared-platform" },
  policy: { refactorPercent: 80 }, guidance: "Founder shared-platform allocation: 80% repair and 20% new.",
};

describe("funding policy in bounded Workroom readback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.workroom.findUnique.mockResolvedValue(room);
    db.workroomActivity.findMany.mockResolvedValue([]);
    projection.mockResolvedValue(investment);
  });

  it("returns the room's effective policy alongside current recovery", async () => {
    const result = await getWorkCapsuleTool({ capsuleId: room.capsuleId }, "reader");
    expect(result).toMatchObject({ success: true, data: { capsule: { investment, recovery: { state: "actionable" } } } });
    expect(projection).toHaveBeenCalledWith(db, { itemId: room.backlogItemId, roomId: room.id });
  });

  it("retains policy, exact source, owner and recovery when history requires compaction", async () => {
    db.workroom.findUnique.mockResolvedValue({ ...room, activities: [{ payload: "x".repeat(150_000) }] });
    const result = await getWorkCapsuleTool({ capsuleId: room.capsuleId }, "reader");
    const formatted = clampToolResultForModel(result, { maxChars: MCP_ROUTE_TOOL_RESULT_CHAR_CAP });
    expect(formatted.truncated).toBe(false);
    const readback = JSON.parse(formatted.text.slice(formatted.text.indexOf("\n") + 1));
    expect(readback).toMatchObject({ capsule: { investment, headSha: room.headSha,
      leaseHolderPrincipalId: room.leaseHolderPrincipalId, recovery: { state: "actionable" } },
      omittedFields: expect.arrayContaining(["capsule.activities"]) });
    expect(readback.omittedFields).not.toContain("capsule.investment");
  });

  it("refuses an essential policy that cannot fit instead of silently dropping it", async () => {
    projection.mockResolvedValue({ ...investment, guidance: "x".repeat(150_000) });
    expect(await getWorkCapsuleTool({ capsuleId: room.capsuleId }, "reader")).toMatchObject({
      success: false, error: "workroom_recovery_budget_exceeded",
    });
  });
});
