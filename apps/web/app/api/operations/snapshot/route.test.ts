import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, loadSnapshotMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  loadSnapshotMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/twin/operations-loader", () => ({
  loadVersionedOperationsSnapshot: loadSnapshotMock,
}));

import { GET } from "./route";

describe("GET /api/operations/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an authenticated operator", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(loadSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns the versioned current state with observable timing and no-store headers", async () => {
    authMock.mockResolvedValue({ user: { id: "operator-1" } });
    loadSnapshotMock.mockResolvedValue({
      schemaVersion: "operations.v1",
      version: "ops-v1-a1",
      freshness: "current",
      telemetry: { durationMs: 123.456, queryCount: 10, payloadBytes: 2048 },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toBe(
      'operations;dur=123.5;desc="current-state read";queries=10',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-operations-version")).toBe("ops-v1-a1");
    expect(response.headers.get("x-operations-freshness")).toBe("current");
    expect(await response.json()).toMatchObject({
      schemaVersion: "operations.v1",
      version: "ops-v1-a1",
    });
  });

  it("states when Operations has no configured archetype snapshot", async () => {
    authMock.mockResolvedValue({ user: { id: "operator-1" } });
    loadSnapshotMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "OPERATIONS_NOT_CONFIGURED",
      message: "Operations is not configured",
    });
  });
});
