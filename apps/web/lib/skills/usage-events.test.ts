import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMany } = vi.hoisted(() => ({ createMany: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    skillUsageEvent: { createMany },
  },
}));

import { recordSkillUsageEvents } from "./usage-events";

describe("recordSkillUsageEvents", () => {
  beforeEach(() => {
    createMany.mockReset();
    createMany.mockResolvedValue({ count: 0 });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("is a no-op when no skill ids are supplied", async () => {
    const written = await recordSkillUsageEvents({
      phase: "loaded",
      skillIds: [],
      agentId: "AGT-1",
    });
    expect(written).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown phase without calling the DB", async () => {
    const written = await recordSkillUsageEvents({
      // @ts-expect-error — intentionally passing an invalid phase
      phase: "panicked",
      skillIds: ["a"],
      agentId: "AGT-1",
    });
    expect(written).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("writes one row per unique skill id", async () => {
    createMany.mockResolvedValue({ count: 2 });
    const written = await recordSkillUsageEvents({
      phase: "eligible",
      skillIds: ["a", "b", "a"],
      agentId: "AGT-1",
      threadId: "thread-1",
      taskRunId: "run-1",
      routeContext: "/customer",
    });
    expect(written).toBe(2);
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(2);
    expect(new Set(data.map((row) => row.skillId))).toEqual(new Set(["a", "b"]));
    expect(data[0]?.phase).toBe("eligible");
    expect(data[0]?.threadId).toBe("thread-1");
    expect(data[0]?.routeContext).toBe("/customer");
    expect(typeof data[0]?.eventId).toBe("string");
    expect((data[0]?.eventId as string).startsWith("SUE-")).toBe(true);
  });

  it("uses unique event ids per row even for identical input", async () => {
    createMany.mockResolvedValue({ count: 2 });
    await recordSkillUsageEvents({
      phase: "invoked",
      skillIds: ["a", "b"],
      agentId: "AGT-1",
    });
    const data = createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(data[0]?.eventId).not.toBe(data[1]?.eventId);
  });

  it("preserves metadata on every row", async () => {
    createMany.mockResolvedValue({ count: 1 });
    await recordSkillUsageEvents({
      phase: "completed",
      skillIds: ["a"],
      agentId: "AGT-1",
      metadata: { toolName: "create_backlog_item", iteration: 3 },
    });
    const data = createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(data[0]?.metadata).toEqual({ toolName: "create_backlog_item", iteration: 3 });
  });

  it("swallows DB failures and returns 0 so the response path is never blocked", async () => {
    createMany.mockRejectedValue(new Error("db down"));
    const written = await recordSkillUsageEvents({
      phase: "loaded",
      skillIds: ["a"],
      agentId: "AGT-1",
    });
    expect(written).toBe(0);
  });
});
