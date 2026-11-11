import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), dispatch: vi.fn(), run: vi.fn() }));

vi.mock("@/lib/jobs", () => ({
  jobs: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) },
}));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: mocks.gate }));
vi.mock("@/lib/work-management/room-message-wake.server", () => ({
  dispatchRoomMessage: mocks.dispatch,
  runRoomWake: mocks.run,
}));
vi.mock("@/lib/actions/agent-task-scheduler", () => ({ executeScheduledAgentTask: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceLevel: vi.fn(async () => "normal") }));

import { roomMessageDispatch, roomWakeRun } from "./room-message-wake";

type Fn = { config: Record<string, unknown>; handler: (ctx: unknown) => Promise<unknown> };
const step = { run: vi.fn(async (_id: string, f: () => unknown) => f()), sleepUntil: vi.fn(async () => undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue({ proceed: true });
});

describe("room/message-dispatch", () => {
  it("dispatches the posted message", async () => {
    mocks.dispatch.mockResolvedValue({ plan: "wake" });
    const fn = roomMessageDispatch as unknown as Fn;
    expect(fn.config).toMatchObject({ id: "room/message-dispatch", triggers: [{ event: "room/message.posted" }] });
    await fn.handler({ event: { data: { messageId: "MSG-1" } }, step });
    expect(mocks.dispatch).toHaveBeenCalledWith("MSG-1");
  });

  it("decides nothing during a drain, leaving the wake pending for the sweep", async () => {
    mocks.gate.mockResolvedValue({ proceed: false, reason: "draining" });
    const fn = roomMessageDispatch as unknown as Fn;
    expect(await fn.handler({ event: { data: { messageId: "MSG-1" } }, step })).toEqual({ skipped: true, reason: "draining" });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe("room/wake-run", () => {
  it("runs one lane per coworker per room, after the coalescing window closes", async () => {
    const fn = roomWakeRun as unknown as Fn;
    expect(fn.config).toMatchObject({
      id: "room/wake-run",
      concurrency: [{ limit: 1, key: "event.data.laneKey" }],
      triggers: [{ event: "room/wake.requested" }],
    });
    const data = { workItemId: "wi-1", agentId: "AGT-B", laneKey: "wi-1:AGT-B", closesAt: "2026-11-11T05:00:15.000Z" };
    await fn.handler({ event: { data }, step });
    expect(step.sleepUntil).toHaveBeenCalledWith("await-window-close", new Date(data.closesAt));
    expect(mocks.run).toHaveBeenCalledWith(data, expect.objectContaining({ execute: expect.any(Function), quiescenceLevel: expect.any(Function) }));
    expect(mocks.gate).not.toHaveBeenCalled();
  });
});
