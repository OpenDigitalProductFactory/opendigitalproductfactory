import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockUpdateMany, mockUpdate, mockFindUniqueTaskRun, mockFindUniqueFeatureBuild, mockFindUniqueThreshold } =
  vi.hoisted(() => ({
    mockUpdateMany: vi.fn(),
    mockUpdate: vi.fn(),
    mockFindUniqueTaskRun: vi.fn(),
    mockFindUniqueFeatureBuild: vi.fn(),
    mockFindUniqueThreshold: vi.fn(),
  }));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { updateMany: mockUpdateMany, update: mockUpdate, findUnique: mockFindUniqueTaskRun },
    featureBuild: { findUnique: mockFindUniqueFeatureBuild },
    buildStudioStallThreshold: { findUnique: mockFindUniqueThreshold },
  },
}));

import {
  heartbeat,
  markTaskRunWorking,
  reserveSubmittedTaskRunWorking,
  withHeartbeatTicker,
} from "./heartbeat";

beforeEach(() => {
  mockUpdateMany.mockReset();
  mockUpdate.mockReset();
  mockFindUniqueTaskRun.mockReset();
  mockFindUniqueFeatureBuild.mockReset();
  mockFindUniqueThreshold.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("heartbeat()", () => {
  it("returns true when the row was updated", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await heartbeat("TR-1")).toBe(true);
  });

  it("returns false when the row is no longer in working state", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    expect(await heartbeat("TR-1")).toBe(false);
  });

  it("only updates rows in an in-flight state (cooperative-cancel signal)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await heartbeat("TR-2");
    expect(mockUpdateMany).toHaveBeenCalledWith({
      // Accepts both "working" (canonical) and "active" (legacy) — see
      // heartbeat.ts inline comment.
      where: { taskRunId: "TR-2", status: { in: ["working", "active"] } },
      data: { lastHeartbeatAt: expect.any(Date) },
    });
  });
});

describe("markTaskRunWorking()", () => {
  it("sets status='working' and lastHeartbeatAt atomically", async () => {
    mockUpdate.mockResolvedValue({});
    await markTaskRunWorking("TR-3");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { taskRunId: "TR-3" },
      data: { status: "working", lastHeartbeatAt: expect.any(Date) },
    });
  });
});

describe("reserveSubmittedTaskRunWorking()", () => {
  it("CAS-reserves one submitted generation with its first heartbeat atomically", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const updatedAt = new Date("2026-08-28T01:00:00.000Z");
    const progressPayload = { resourceWait: { attempt: 1 }, resumeReservedAt: "now" };

    const reserved = await reserveSubmittedTaskRunWorking({
      taskRunId: "TR-CAPACITY",
      updatedAt,
      progressPayload,
    });

    expect(reserved).toBe(true);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { taskRunId: "TR-CAPACITY", status: "submitted", updatedAt },
      data: {
        status: "working",
        lastHeartbeatAt: expect.any(Date),
        completedAt: null,
        progressPayload,
      },
    });
  });
});

describe("withHeartbeatTicker()", () => {
  it("calls fn exactly once and returns its result", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const fn = vi.fn(async () => "hello");
    const result = await withHeartbeatTicker("TR-4", fn, 1_000_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe("hello");
  });

  it("emits heartbeats while fn is in flight", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const ticked: number[] = [];
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    await withHeartbeatTicker("TR-5", fn, 25);
    // fn took 100ms, ticker fires every 25ms — expect at least 2 calls.
    expect(mockUpdateMany.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("clears the interval even when fn throws", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(withHeartbeatTicker("TR-6", fn, 100)).rejects.toThrow("boom");
    // Wait a beat to confirm no further ticks fire after the throw.
    const callsAtThrow = mockUpdateMany.mock.calls.length;
    await new Promise((r) => setTimeout(r, 250));
    expect(mockUpdateMany.mock.calls.length).toBe(callsAtThrow);
  });

  it("derives interval from the resolved threshold when no override provided", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUniqueTaskRun.mockResolvedValue({ buildId: "FB-X" });
    mockFindUniqueFeatureBuild.mockResolvedValue({ phase: "ideate" });
    mockFindUniqueThreshold.mockResolvedValue({
      heartbeatTimeoutSeconds: 90,
      totalPhaseTimeoutSeconds: 900,
    });
    const fn = vi.fn(async () => undefined);
    await withHeartbeatTicker("TR-7", fn);
    // The threshold lookup must have been called — proves the derivation
    // path is wired, not bypassed by some hardcoded constant.
    expect(mockFindUniqueTaskRun).toHaveBeenCalled();
  });
});
