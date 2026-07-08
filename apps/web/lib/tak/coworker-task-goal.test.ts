import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    coworkerTaskGoal: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

import {
  buildGoalJudgePrompt,
  classifyGoalStatus,
  createCoworkerGoal,
  evaluateCoworkerGoal,
  interpretGoalVerdict,
} from "./coworker-task-goal";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("interpretGoalVerdict", () => {
  it("reads an explicit MET verdict and its rationale", () => {
    expect(interpretGoalVerdict("VERDICT: MET — the row exists")).toEqual({
      met: true,
      rationale: "the row exists",
    });
  });

  it("reads an explicit UNMET verdict", () => {
    expect(interpretGoalVerdict("VERDICT: UNMET — no such row")).toEqual({
      met: false,
      rationale: "no such row",
    });
  });

  it("defaults to UNMET when the verdict is missing or ambiguous", () => {
    expect(interpretGoalVerdict("I think it's probably fine")).toMatchObject({ met: false });
    expect(interpretGoalVerdict("")).toEqual({ met: false, rationale: "No judge verdict." });
  });

  it("is case- and separator-tolerant", () => {
    expect(interpretGoalVerdict("verdict: met: done").met).toBe(true);
    expect(interpretGoalVerdict("Preamble.\nVERDICT: UNMET - nope").met).toBe(false);
  });
});

describe("classifyGoalStatus", () => {
  it("maps the boolean verdict to the persisted status", () => {
    expect(classifyGoalStatus(true)).toBe("met");
    expect(classifyGoalStatus(false)).toBe("unmet");
  });
});

describe("buildGoalJudgePrompt", () => {
  it("embeds the condition and output and demands a leading VERDICT token", () => {
    const { system, user } = buildGoalJudgePrompt("row exists", "I made the row");
    expect(system).toMatch(/VERDICT: MET/);
    expect(user).toContain("row exists");
    expect(user).toContain("I made the row");
  });
});

describe("createCoworkerGoal", () => {
  it("rejects an empty condition before any write", async () => {
    const res = await createCoworkerGoal({ agentCuid: "cuid-a", condition: "   " });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/must not be empty/i) });
    expect(prisma.coworkerTaskGoal.create).not.toHaveBeenCalled();
  });

  it("persists a trimmed condition and returns the new id", async () => {
    asMock(prisma.coworkerTaskGoal.create).mockResolvedValueOnce({ id: "goal-1" });
    const res = await createCoworkerGoal({ agentCuid: "cuid-a", condition: "  row exists  ", createdBy: "user_1" });
    expect(res).toEqual({ ok: true, goalId: "goal-1" });
    expect(prisma.coworkerTaskGoal.create).toHaveBeenCalledWith({
      data: { agentId: "cuid-a", condition: "row exists", scheduledTaskId: null, createdBy: "user_1" },
      select: { id: true },
    });
  });
});

describe("evaluateCoworkerGoal", () => {
  it("marks the goal met and stamps resolvedAt on a MET verdict", async () => {
    asMock(prisma.coworkerTaskGoal.findUnique).mockResolvedValueOnce({ id: "goal-1", condition: "row exists" });
    asMock(prisma.coworkerTaskGoal.update).mockResolvedValueOnce({});
    const judge = vi.fn().mockResolvedValue("VERDICT: MET — the row exists");

    const res = await evaluateCoworkerGoal({ goalId: "goal-1", output: "done", sensitivity: "internal", judge });

    expect(res).toEqual({ ok: true, status: "met", rationale: "the row exists" });
    const call = asMock(prisma.coworkerTaskGoal.update).mock.calls[0][0];
    expect(call.data.status).toBe("met");
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
  });

  it("marks the goal unmet WITHOUT resolvedAt on an UNMET verdict", async () => {
    asMock(prisma.coworkerTaskGoal.findUnique).mockResolvedValueOnce({ id: "goal-1", condition: "row exists" });
    asMock(prisma.coworkerTaskGoal.update).mockResolvedValueOnce({});
    const judge = vi.fn().mockResolvedValue("VERDICT: UNMET — nothing was created");

    const res = await evaluateCoworkerGoal({ goalId: "goal-1", output: "I will do it later", sensitivity: "internal", judge });

    expect(res).toMatchObject({ ok: true, status: "unmet" });
    const call = asMock(prisma.coworkerTaskGoal.update).mock.calls[0][0];
    expect(call.data.status).toBe("unmet");
    expect(call.data.resolvedAt).toBeUndefined();
  });

  it("fails closed (no status write) when the judge throws", async () => {
    asMock(prisma.coworkerTaskGoal.findUnique).mockResolvedValueOnce({ id: "goal-1", condition: "row exists" });
    const judge = vi.fn().mockRejectedValue(new Error("provider down"));

    const res = await evaluateCoworkerGoal({ goalId: "goal-1", output: "x", sensitivity: "internal", judge });

    expect(res).toMatchObject({ ok: false });
    expect(prisma.coworkerTaskGoal.update).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown goal", async () => {
    asMock(prisma.coworkerTaskGoal.findUnique).mockResolvedValueOnce(null);
    const res = await evaluateCoworkerGoal({ goalId: "ghost", output: "x", sensitivity: "internal", judge: vi.fn() });
    expect(res).toMatchObject({ ok: false });
  });
});
