import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  loadOperationsMapData: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai-operations-map/load-map-data", () => ({
  loadOperationsMapData: mocks.loadOperationsMapData,
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/platform/operations-map${query}`);
}

const platformSession = {
  user: { platformRole: "HR-000", isSuperuser: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(platformSession);
  mocks.loadOperationsMapData.mockResolvedValue({ recentWindowLabel: "stub" });
});

describe("GET /api/platform/operations-map", () => {
  it("404s without a view_platform session (mirrors the shell layout gate)", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(makeRequest());
    expect(response.status).toBe(404);
    expect(mocks.loadOperationsMapData).not.toHaveBeenCalled();
  });

  it("loads the default snapshot when no window params are given", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    expect(mocks.loadOperationsMapData).toHaveBeenCalledWith(undefined);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("passes a parsed evidence window through (epoch-ms params)", async () => {
    const start = Date.parse("2026-06-01T00:00:00.000Z");
    const end = Date.parse("2026-06-15T00:00:00.000Z");
    const response = await GET(makeRequest(`?start=${start}&end=${end}`));
    expect(response.status).toBe(200);
    expect(mocks.loadOperationsMapData).toHaveBeenCalledWith({
      window: { start: new Date(start), end: new Date(end) },
    });
  });

  it("accepts ISO-8601 window params", async () => {
    const response = await GET(
      makeRequest("?start=2026-06-01T00:00:00.000Z&end=2026-06-15T00:00:00.000Z"),
    );
    expect(response.status).toBe(200);
    expect(mocks.loadOperationsMapData).toHaveBeenCalledWith({
      window: {
        start: new Date("2026-06-01T00:00:00.000Z"),
        end: new Date("2026-06-15T00:00:00.000Z"),
      },
    });
  });

  it("400s on a lone start param", async () => {
    const response = await GET(makeRequest("?start=1750000000000"));
    expect(response.status).toBe(400);
    expect(mocks.loadOperationsMapData).not.toHaveBeenCalled();
  });

  it("400s on unparseable or inverted windows", async () => {
    expect((await GET(makeRequest("?start=nonsense&end=alsononsense"))).status).toBe(400);
    expect((await GET(makeRequest("?start=2000&end=1000"))).status).toBe(400);
    expect(mocks.loadOperationsMapData).not.toHaveBeenCalled();
  });
});
