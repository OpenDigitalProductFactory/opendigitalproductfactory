// BI-E9DAA23F AC-1: a build waiting on an upgrade pause resumes when the pause
// clears — on platform.quiescence-cleared — not on the next 10-minute tick.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLevelMock, findHeldMock, resumeHeldMock } = vi.hoisted(() => ({
  getLevelMock: vi.fn(),
  findHeldMock: vi.fn(),
  resumeHeldMock: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  jobs: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) },
}));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceLevel: () => getLevelMock(),
}));
vi.mock("@/lib/build/upgrade-pause-hold", () => ({
  findBuildsHeldByUpgradePause: (...a: unknown[]) => findHeldMock(...a),
  resumeBuildHeldByUpgradePause: (...a: unknown[]) => resumeHeldMock(...a),
}));

import { buildResumeAfterUpgradePause } from "./build-resume-after-upgrade-pause";

type Fn = {
  config: { id: string; triggers: Array<{ event: string }> };
  handler: (ctx: { event: unknown; step: { run: (id: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
};
const fn = buildResumeAfterUpgradePause as unknown as Fn;
const step = { run: vi.fn(async (_id: string, f: () => unknown) => f()) };
const cleared = { name: "platform.quiescence-cleared", data: { runId: "QR-1", outcome: "succeeded" } };

beforeEach(() => {
  getLevelMock.mockReset().mockResolvedValue("normal");
  findHeldMock.mockReset().mockResolvedValue([]);
  resumeHeldMock.mockReset().mockResolvedValue("resumed");
  step.run.mockClear();
});

describe("build resume after an upgrade pause", () => {
  it("is triggered by the quiescence-cleared event", () => {
    expect(fn.config.triggers).toEqual([{ event: "platform.quiescence-cleared" }]);
  });

  it("resumes every build the pause was holding, one durable step each", async () => {
    findHeldMock.mockResolvedValue([
      { buildId: "FB-A", phase: "plan", userId: "u" },
      { buildId: "FB-B", phase: "ideate", userId: "u" },
    ]);
    const result = await fn.handler({ event: cleared, step });
    expect(resumeHeldMock).toHaveBeenCalledTimes(2);
    expect(resumeHeldMock).toHaveBeenCalledWith({ buildId: "FB-A" });
    expect(resumeHeldMock).toHaveBeenCalledWith({ buildId: "FB-B" });
    expect(step.run.mock.calls.map((c) => c[0])).toEqual(["find-held-builds", "resume-FB-A", "resume-FB-B"]);
    expect(result).toEqual({ held: 2, resumed: 2 });
  });

  it("does nothing while a new pause is already in force; the next clear will wake them", async () => {
    getLevelMock.mockResolvedValue("draining");
    findHeldMock.mockResolvedValue([{ buildId: "FB-A", phase: "plan", userId: "u" }]);
    const result = await fn.handler({ event: cleared, step });
    expect(resumeHeldMock).not.toHaveBeenCalled();
    expect(result).toEqual({ held: 0, resumed: 0, skipped: "platform still paused (draining)" });
  });
});
