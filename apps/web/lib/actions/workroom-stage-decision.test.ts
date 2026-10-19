import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), record: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("@dpf/db", () => ({ prisma: { marker: "prisma" } }));
vi.mock("@/lib/work-management/workroom-stage-decision.server", () => ({ recordWorkroomStageDecisionForUser: m.record }));

import { recordWorkroomStageDecision } from "./workroom-stage-decision";

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: "session-user" } });
});

it("takes the caller from the session, never from input, and revalidates the room and queue", async () => {
  m.record.mockResolvedValue({ ok: true });
  const result = await recordWorkroomStageDecision("case-1", "room-row-1", { stageKey: "decide", choice: "accept" });
  expect(result).toEqual({ ok: true });
  expect(m.record).toHaveBeenCalledWith({ marker: "prisma" }, expect.objectContaining({
    userId: "session-user", roomRowId: "room-row-1", stageKey: "decide", choice: "accept",
  }));
  expect(m.refresh).toHaveBeenCalledWith("/workspace/cases/case-1");
  expect(m.refresh).toHaveBeenCalledWith("/workspace/my-queue");
});

it("refuses without a session and writes nothing", async () => {
  m.auth.mockResolvedValue(null);
  const result = await recordWorkroomStageDecision("case-1", "room-row-1", { stageKey: "decide", choice: "accept" });
  expect(result.ok).toBe(false);
  expect(m.record).not.toHaveBeenCalled();
});

it("passes a refusal through without revalidating, and hides internal errors", async () => {
  m.record.mockResolvedValue({ ok: false, error: "Only Alex Owner (the room's accountable owner) can record this decision." });
  expect(await recordWorkroomStageDecision("case-1", "room-row-1", { stageKey: "decide", choice: "accept" }))
    .toEqual({ ok: false, error: "Only Alex Owner (the room's accountable owner) can record this decision." });
  expect(m.refresh).not.toHaveBeenCalled();
  m.record.mockRejectedValue(new Error("private DB detail"));
  expect(JSON.stringify(await recordWorkroomStageDecision("case-1", "room-row-1", { stageKey: "decide", choice: "accept" })))
    .not.toContain("private DB");
});
