import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockConnectMicrosoft365Communications } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockConnectMicrosoft365Communications: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/integrate/microsoft365-communications/connect-action", () => ({
  connectMicrosoft365Communications: mockConnectMicrosoft365Communications,
}));

import { POST } from "./route";

function makeReq(body: unknown, options: { raw?: string } = {}): Request {
  const bodyText = options.raw !== undefined ? options.raw : JSON.stringify(body);
  return new Request("http://test/api/integrations/microsoft365-communications/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockConnectMicrosoft365Communications.mockReset();
});

describe("POST /api/integrations/microsoft365-communications/connect", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
    expect(mockConnectMicrosoft365Communications).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks manage_provider_connections", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-100", isSuperuser: false },
    });

    const res = await POST(makeReq({}));
    expect(res.status).toBe(403);
    expect(mockConnectMicrosoft365Communications).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });

    const res = await POST(makeReq({}, { raw: "{not json" }));
    expect(res.status).toBe(400);
    expect(mockConnectMicrosoft365Communications).not.toHaveBeenCalled();
  });

  it("delegates to connectMicrosoft365Communications and returns 200 on success", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectMicrosoft365Communications.mockResolvedValue({
      ok: true,
      status: "connected",
      tenantDisplayName: "Acme Managed Services",
      mailboxDisplayName: "Alex Admin",
      lastTestedAt: "2026-04-24T00:00:00.000Z",
    });

    const res = await POST(makeReq({ tenantId: "tenant-123" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "connected",
      tenantDisplayName: "Acme Managed Services",
      mailboxDisplayName: "Alex Admin",
      lastTestedAt: "2026-04-24T00:00:00.000Z",
    });
  });

  it("returns the action statusCode on failure", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectMicrosoft365Communications.mockResolvedValue({
      ok: false,
      status: "error",
      error: "invalid Microsoft 365 credentials",
      statusCode: 400,
    });

    const res = await POST(makeReq({ tenantId: "tenant-123" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid Microsoft 365 credentials",
      status: "error",
    });
  });
});
