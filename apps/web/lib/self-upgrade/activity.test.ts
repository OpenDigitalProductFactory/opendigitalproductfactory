import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    toolExecution: {
      findFirst: mocks.findFirst,
    },
  },
}));

import {
  getPortalActivity,
  PORTAL_ACTIVITY_THRESHOLD_MS,
  EDGE_AGENT_PREFIX,
} from "./activity";

describe("PORTAL_ACTIVITY_THRESHOLD_MS", () => {
  it("defaults to 5 minutes", () => {
    expect(PORTAL_ACTIVITY_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });
});

describe("EDGE_AGENT_PREFIX", () => {
  it("is 'edge-node:'", () => {
    expect(EDGE_AGENT_PREFIX).toBe("edge-node:");
  });
});

describe("getPortalActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns active=false when no recent non-edge tool execution exists", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const snapshot = await getPortalActivity();
    expect(snapshot).toEqual({
      active: false,
      lastActivityAt: null,
      lastActivityToolName: null,
      thresholdMs: PORTAL_ACTIVITY_THRESHOLD_MS,
    });
  });

  it("returns active=true with row details when a recent non-edge execution exists", async () => {
    const ts = new Date("2026-05-21T12:00:00Z");
    mocks.findFirst.mockResolvedValue({ createdAt: ts, toolName: "triage_backlog_item" });
    const snapshot = await getPortalActivity();
    expect(snapshot).toEqual({
      active: true,
      lastActivityAt: ts,
      lastActivityToolName: "triage_backlog_item",
      thresholdMs: PORTAL_ACTIVITY_THRESHOLD_MS,
    });
  });

  it("excludes edge-node activity via agentId NOT startsWith filter", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await getPortalActivity();
    const call = mocks.findFirst.mock.calls[0][0];
    expect(call.where.NOT).toEqual({ agentId: { startsWith: "edge-node:" } });
  });

  it("uses provided threshold and now for the cutoff window", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const now = new Date("2026-05-21T12:00:00Z");
    const customThreshold = 10 * 60 * 1000; // 10 minutes
    await getPortalActivity(customThreshold, now);
    const call = mocks.findFirst.mock.calls[0][0];
    const expectedCutoff = new Date(now.getTime() - customThreshold);
    expect(call.where.createdAt).toEqual({ gte: expectedCutoff });
  });

  it("orders by createdAt desc so the latest activity wins", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await getPortalActivity();
    const call = mocks.findFirst.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: "desc" });
  });

  it("threads the threshold value into the returned snapshot for caller inspection", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const customThreshold = 60_000;
    const snapshot = await getPortalActivity(customThreshold);
    expect(snapshot.thresholdMs).toBe(customThreshold);
  });
});
