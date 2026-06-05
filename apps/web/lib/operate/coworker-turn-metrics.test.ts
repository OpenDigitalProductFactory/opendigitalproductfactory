import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  recordCoworkerTurnMetric,
  type CoworkerTurnMetricUpserter,
} from "./coworker-turn-metrics";

function makeDelegate(impl?: CoworkerTurnMetricUpserter["upsert"]) {
  const upsert = vi.fn(impl ?? (async () => ({})));
  const delegate: CoworkerTurnMetricUpserter = { upsert };
  return { delegate, upsert, getDelegate: async () => delegate };
}

describe("recordCoworkerTurnMetric", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("upserts by the (threadId, agentMessageId) natural key", async () => {
    const { upsert, getDelegate } = makeDelegate();

    await recordCoworkerTurnMetric(
      {
        threadId: "thr-1",
        agentMessageId: "msg-1",
        agentId: "support-specialist",
        routeContext: "/platform/ai",
        taskType: "conversation",
        providerId: "anthropic-sub",
        modelId: "claude-haiku-4-5",
        dispatches: 3,
        nudges: 2,
        toolsAttached: true,
        executedTools: 1,
        totalMs: 9000,
      },
      { getDelegate },
    );

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      threadId_agentMessageId: { threadId: "thr-1", agentMessageId: "msg-1" },
    });
    expect(arg.create).toMatchObject({
      threadId: "thr-1",
      agentMessageId: "msg-1",
      agentId: "support-specialist",
      routeContext: "/platform/ai",
      taskType: "conversation",
      providerId: "anthropic-sub",
      modelId: "claude-haiku-4-5",
      dispatches: 3,
      nudges: 2,
      toolsAttached: true,
      executedTools: 1,
      totalMs: 9000,
    });
    // Update payload mirrors create minus the key fields.
    expect(arg.update).toMatchObject({ nudges: 2, dispatches: 3, totalMs: 9000 });
    expect(arg.update.threadId).toBeUndefined();
  });

  it("stores null for absent optional values rather than placeholders", async () => {
    const { upsert, getDelegate } = makeDelegate();

    await recordCoworkerTurnMetric(
      { threadId: "thr-2", agentMessageId: "msg-2" },
      { getDelegate },
    );

    const arg = upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      agentId: null,
      routeContext: null,
      taskType: null,
      providerId: null,
      modelId: null,
      totalMs: null,
      // numeric counters default to 0, toolsAttached to false
      dispatches: 0,
      nudges: 0,
      executedTools: 0,
      toolsAttached: false,
    });
  });

  it("does not write when threadId is missing", async () => {
    const { upsert, getDelegate } = makeDelegate();
    await recordCoworkerTurnMetric(
      { threadId: null, agentMessageId: "msg-3" },
      { getDelegate },
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("does not write when agentMessageId is missing", async () => {
    const { upsert, getDelegate } = makeDelegate();
    await recordCoworkerTurnMetric(
      { threadId: "thr-3", agentMessageId: null },
      { getDelegate },
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails open: suppresses Prisma errors and never throws", async () => {
    const { getDelegate, upsert } = makeDelegate(async () => {
      throw new Error("connection refused");
    });

    await expect(
      recordCoworkerTurnMetric(
        { threadId: "thr-4", agentMessageId: "msg-4" },
        { getDelegate },
      ),
    ).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("fails open when delegate resolution itself throws", async () => {
    await expect(
      recordCoworkerTurnMetric(
        { threadId: "thr-5", agentMessageId: "msg-5" },
        {
          getDelegate: async () => {
            throw new Error("client unavailable");
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
