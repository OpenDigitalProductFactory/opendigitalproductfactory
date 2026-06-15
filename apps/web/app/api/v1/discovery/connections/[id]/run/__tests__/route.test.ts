import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRerunDiscoveryConnection } = vi.hoisted(() => ({
  mockRerunDiscoveryConnection: vi.fn(),
}));

vi.mock("@/lib/actions/discovery", () => ({
  rerunDiscoveryConnection: mockRerunDiscoveryConnection,
}));

import { POST } from "../route";

const PERSISTENCE_SUMMARY = {
  ok: true as const,
  runId: "run-abc",
  itemCount: 5,
  relationshipCount: 2,
  status: "active",
};

function makeRequest(): Request {
  return new Request("http://test/api/v1/discovery/connections/conn-1/run", {
    method: "POST",
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/v1/discovery/connections/[id]/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when requireManageDiscovery denies access", async () => {
    mockRerunDiscoveryConnection.mockResolvedValue({ ok: false, error: "Unauthorized" });

    const res = await POST(makeRequest(), makeContext("conn-1"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when connection is not found", async () => {
    mockRerunDiscoveryConnection.mockResolvedValue({ ok: false, error: "Connection not found" });

    const res = await POST(makeRequest(), makeContext("conn-does-not-exist"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Connection not found" });
  });

  it("returns 400 when connection status is unconfigured", async () => {
    mockRerunDiscoveryConnection.mockResolvedValue({
      ok: false,
      error: 'Cannot rerun discovery for connection with status "unconfigured"',
    });

    const res = await POST(makeRequest(), makeContext("conn-1"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("unconfigured");
  });

  it("returns 400 when connection status is auth_failed", async () => {
    mockRerunDiscoveryConnection.mockResolvedValue({
      ok: false,
      error: 'Cannot rerun discovery for connection with status "auth_failed"',
    });

    const res = await POST(makeRequest(), makeContext("conn-1"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("auth_failed");
  });

  it("returns 200 with discovery summary on success", async () => {
    mockRerunDiscoveryConnection.mockResolvedValue(PERSISTENCE_SUMMARY);

    const res = await POST(makeRequest(), makeContext("conn-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(PERSISTENCE_SUMMARY);
    expect(mockRerunDiscoveryConnection).toHaveBeenCalledWith("conn-1");
  });

  it("returns 200 with runId, itemCount, relationshipCount on success", async () => {
    const result = { ok: true as const, runId: "run-1", itemCount: 3, relationshipCount: 1, status: "active" };
    mockRerunDiscoveryConnection.mockResolvedValue(result);

    const res = await POST(makeRequest(), makeContext("conn-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(result);
  });
});
