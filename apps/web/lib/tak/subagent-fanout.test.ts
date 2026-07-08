import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { taskRun: { create: vi.fn() } },
}));

vi.mock("./delegation-authority", () => ({
  startChain: vi.fn(),
}));

import { prisma } from "@dpf/db";

import { startChain } from "./delegation-authority";
import { capFanoutWidth, MAX_FANOUT_WIDTH, spawnSubagentFanout } from "./subagent-fanout";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const allowLink = (chainId: string, id: string) => ({
  allowed: true,
  link: { chainId, id },
  reason: "Chain started",
  propagatedAuthority: ["backlog_read"],
});

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  asMock(prisma.taskRun.create).mockImplementation(async () => ({ taskRunId: `TR-${++n}` }));
});

describe("capFanoutWidth", () => {
  it("passes a list at or under the cap through unchanged", () => {
    expect(capFanoutWidth([1, 2, 3], 8)).toEqual({ accepted: [1, 2, 3], dropped: [] });
  });

  it("splits an over-cap list into accepted head and dropped tail", () => {
    const req = Array.from({ length: 10 }, (_, i) => i);
    const { accepted, dropped } = capFanoutWidth(req, MAX_FANOUT_WIDTH);
    expect(accepted).toHaveLength(MAX_FANOUT_WIDTH);
    expect(dropped).toHaveLength(10 - MAX_FANOUT_WIDTH);
  });
});

describe("spawnSubagentFanout", () => {
  const base = { parentAgentId: "AGT-PARENT", userId: "u1", originAuthority: ["backlog_read"] };

  it("spawns a child TaskRun for each approved delegation", async () => {
    asMock(startChain)
      .mockResolvedValueOnce(allowLink("chain-1", "link-1"))
      .mockResolvedValueOnce(allowLink("chain-2", "link-2"));

    const res = await spawnSubagentFanout({
      ...base,
      subtasks: [
        { objective: "research pricing", toAgentId: "cuid-a" },
        { objective: "draft brief", toAgentId: "cuid-b" },
      ],
    });

    expect(res.spawned.filter((s) => s.ok)).toHaveLength(2);
    expect(prisma.taskRun.create).toHaveBeenCalledTimes(2);
    const firstData = asMock(prisma.taskRun.create).mock.calls[0][0].data;
    expect(firstData).toMatchObject({
      initiatingAgentId: "AGT-PARENT",
      currentAgentId: "cuid-a",
      status: "submitted",
      source: "coworker",
    });
    expect(firstData.a2aMetadata).toMatchObject({ fanout: true, chainId: "chain-1" });
  });

  it("isolates a governance-blocked delegation — others still spawn", async () => {
    asMock(startChain)
      .mockResolvedValueOnce({ allowed: false, link: null, reason: "Cannot delegate to self", propagatedAuthority: [] })
      .mockResolvedValueOnce(allowLink("chain-2", "link-2"));

    const res = await spawnSubagentFanout({
      ...base,
      subtasks: [
        { objective: "self work", toAgentId: "AGT-PARENT" },
        { objective: "real work", toAgentId: "cuid-b" },
      ],
    });

    expect(res.spawned[0]).toEqual({ ok: false, toAgentId: "AGT-PARENT", reason: "Cannot delegate to self" });
    expect(res.spawned[1]).toMatchObject({ ok: true });
    expect(prisma.taskRun.create).toHaveBeenCalledTimes(1); // only the approved one
  });

  it("rejects an empty objective without a delegation call", async () => {
    const res = await spawnSubagentFanout({ ...base, subtasks: [{ objective: "   ", toAgentId: "cuid-a" }] });
    expect(res.spawned[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/empty objective/i) });
    expect(startChain).not.toHaveBeenCalled();
    expect(prisma.taskRun.create).not.toHaveBeenCalled();
  });

  it("caps the fan-out width and reports the dropped overflow", async () => {
    asMock(startChain).mockResolvedValue(allowLink("chain-x", "link-x"));
    const subtasks = Array.from({ length: MAX_FANOUT_WIDTH + 3 }, (_, i) => ({
      objective: `task ${i}`,
      toAgentId: `cuid-${i}`,
    }));
    const res = await spawnSubagentFanout({ ...base, subtasks });
    expect(res.spawned).toHaveLength(MAX_FANOUT_WIDTH);
    expect(res.dropped).toHaveLength(3);
    expect(prisma.taskRun.create).toHaveBeenCalledTimes(MAX_FANOUT_WIDTH);
  });
});
