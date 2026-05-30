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
});

describe("GET /api/health", () => {
  it("returns 200 status:ok only after the database check succeeds", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns 503 status:degraded when the database is unreachable", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("error");
    expect(body.error).toContain("connection refused");
  });
});
