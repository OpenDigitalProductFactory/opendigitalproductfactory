import { describe, expect, it, vi } from "vitest";
import { loadStageDispatchTimes } from "./workroom-drive-data";

describe("loadStageDispatchTimes", () => {
  it("loads real dispatch timestamps for the current room stage and cycle", async () => {
    const at = new Date("2026-09-08T10:00:00Z");
    const query = vi.fn().mockResolvedValue([{ capsuleId: "WC-TEST", dispatchedAt: at }]);
    const result = await loadStageDispatchTimes(["WC-TEST"], { $queryRaw: query } as never);
    expect(result.get("WC-TEST")).toEqual(at);
    const sql = query.mock.calls[0][0].join("?");
    expect(sql).toContain("'dispatch_agent'");
    expect(sql).toContain("'agent_stage'");
    expect(sql).toContain("{workroomDrive,stageKey}");
    expect(sql).toContain("{workroomDrive,lastCycleKey}");
  });
  it("also starts a governed-decision stage at the drive's attention ask (never-dispatched stage)", async () => {
    const askedAt = new Date("2026-09-26T01:30:00.806Z");
    const query = vi.fn().mockResolvedValue([{ capsuleId: "WC-DECIDE", dispatchedAt: askedAt }]);
    const result = await loadStageDispatchTimes(["WC-DECIDE"], { $queryRaw: query } as never);
    expect(result.get("WC-DECIDE")).toEqual(askedAt);
    expect(result.get("WC-OTHER")).toBeUndefined();
    const sql = query.mock.calls[0][0].join("?");
    // The attention row: the drive's own ask for THIS stage's governed decision.
    expect(sql).toContain("'workroom-drive-attention'");
    expect(sql).toContain("'attention'");
    expect(sql).toContain("'governed_decision'");
    // Scoped to the room still waiting on that decision. role_stage/person_stage
    // attention is not a start time: only governed_decision is accepted.
    expect(sql).toContain("{workroomDrive,pendingAttention,reason}");
    expect(sql).toContain("{workroomDrive,pendingAttention,stageKey}");
    expect(sql).not.toContain("'role_stage'");
    // The dispatch branch keeps its cycle scope; latest row wins.
    expect(sql).toMatch(/ORDER BY w\."capsuleId", a\."recordedAt" DESC/);
  });
  it("does not query an empty room set", async () => {
    const query = vi.fn();
    expect(await loadStageDispatchTimes([], { $queryRaw: query } as never)).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});
