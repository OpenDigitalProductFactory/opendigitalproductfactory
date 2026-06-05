import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQueryRaw } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { $queryRaw: mockQueryRaw },
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  // Restore real timers and delete any threshold override between tests.
  vi.useRealTimers();
  delete process.env["EVENT_LOOP_LAG_THRESHOLD_MS"];
});

describe("GET /api/health", () => {
  it("returns 200 status:ok when database is healthy and event loop is responsive", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.eventLoop).toBe("ok");
    expect(typeof body.lagMs).toBe("number");
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns 503 status:degraded when the database is unreachable", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("error");
    expect(body.checks.eventLoop).toBe("ok");
    expect(body.error).toContain("connection refused");
  });

  it("returns 503 with eventLoop:lagging when lag exceeds threshold (BI-9F106818)", async () => {
    // Force the event-loop guard branch without relying on host timer
    // granularity. A 0ms timeout can resolve with either 0ms or 1ms lag.
    process.env["EVENT_LOOP_LAG_THRESHOLD_MS"] = "-1";
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.eventLoop).toBe("lagging");
    expect(body.checks.database).toBe("unknown");
    // DB query must NOT have been called — loop check is the first gate.
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});
