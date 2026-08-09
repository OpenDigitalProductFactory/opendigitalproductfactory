import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createMobileSurfaceContext: vi.fn(),
  list: vi.fn(), open: vi.fn(), snapshot: vi.fn(), act: vi.fn(), syncClientState: vi.fn(), close: vi.fn(),
}));

vi.mock("@/lib/api/auth-middleware", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/coworker/mobile-authorized-surface", () => ({ createMobileSurfaceContext: mocks.createMobileSurfaceContext }));
vi.mock("@/lib/coworker/authorized-surface-registry", () => ({
  authorizedSurfaceRuntime: {
    list: mocks.list, open: mocks.open, snapshot: mocks.snapshot,
    act: mocks.act, syncClientState: mocks.syncClientState, close: mocks.close,
  },
}));

import { GET, POST } from "./route";
import { GET as GET_SESSION, DELETE as DELETE_SESSION } from "./[sessionId]/route";
import { POST as ACT } from "./[sessionId]/act/route";
import { POST as SYNC_CLIENT_STATE } from "./[sessionId]/client-state/route";

const user = { id: "user-1", platformRole: "HR-000", isSuperuser: false };
const params = { params: Promise.resolve({ sessionId: "session-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user });
  mocks.createMobileSurfaceContext.mockReturnValue({
    delegatingUserId: "user-1", actingAgentId: "mobile-renderer:user-1", mode: "mobile",
    locale: "en-US", timezone: "UTC",
  });
});

describe("Authorized Surface mobile REST projection", () => {
  it("lists and opens with server-owned authenticated mobile authority", async () => {
    mocks.list.mockResolvedValue([{ surfaceId: "platform.estate-discovery" }]);
    const listed = await GET(new Request("http://test/api/v1/surfaces?taskIntent=configure%20network%20discovery"));
    expect(listed.status).toBe(200);
    expect(mocks.createMobileSurfaceContext).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      selector: expect.objectContaining({ taskIntent: "configure network discovery" }),
    }));

    mocks.open.mockResolvedValue({ ok: true, session: { sessionId: "session-1" }, summary: { label: "Estate Discovery" } });
    const opened = await POST(new Request("http://test/api/v1/surfaces", {
      method: "POST", body: JSON.stringify({ mobileViewId: "estate-discovery" }),
    }));
    expect(opened.status).toBe(200);
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      selector: expect.objectContaining({ mobileViewId: "estate-discovery" }),
    }));
  });

  it("binds snapshot, action, state-sync, and close to the same human/mobile-renderer pair", async () => {
    mocks.snapshot.mockResolvedValue({ ok: true, graph: { revision: "r2" } });
    const snapshot = await GET_SESSION(new Request("http://test/api/v1/surfaces/session-1?sinceRevision=r1"), params);
    expect(snapshot.status).toBe(200);
    expect(mocks.snapshot).toHaveBeenCalledWith({
      sessionId: "session-1",
      caller: { delegatingUserId: "user-1", actingAgentId: "mobile-renderer:user-1" },
      sinceRevision: "r1",
    });

    mocks.act.mockResolvedValue({ ok: true, revision: "r3", message: "saved" });
    const acted = await ACT(new Request("http://test/api/v1/surfaces/session-1/act", {
      method: "POST", body: JSON.stringify({ actionId: "save", expectedRevision: "r2", args: {}, idempotencyKey: "key-1" }),
    }), params);
    expect(acted.status).toBe(200);
    expect(mocks.act).toHaveBeenCalledWith(expect.objectContaining({
      caller: { delegatingUserId: "user-1", actingAgentId: "mobile-renderer:user-1" },
      idempotencyKey: "key-1",
    }));

    mocks.syncClientState.mockResolvedValue({ ok: true, revision: "r4", message: "synced" });
    const synced = await SYNC_CLIENT_STATE(new Request("http://test/api/v1/surfaces/session-1/client-state", {
      method: "POST", body: JSON.stringify({ expectedRevision: "r3", sequence: 1, changes: { "connection.target": "10.0.0.1" } }),
    }), params);
    expect(synced.status).toBe(200);
    expect(mocks.syncClientState).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1 }));

    mocks.close.mockResolvedValue(true);
    const closed = await DELETE_SESSION(new Request("http://test/api/v1/surfaces/session-1", { method: "DELETE" }), params);
    expect(closed.status).toBe(204);
    expect(mocks.close).toHaveBeenCalledWith("session-1", {
      delegatingUserId: "user-1", actingAgentId: "mobile-renderer:user-1",
    });
  });

  it("maps stale writes to 409 without weakening the typed refusal", async () => {
    mocks.act.mockResolvedValue({ ok: false, code: "surface_revision_stale", message: "refresh", refreshRevision: "r2" });
    const response = await ACT(new Request("http://test/api/v1/surfaces/session-1/act", {
      method: "POST", body: JSON.stringify({ actionId: "save", expectedRevision: "r1" }),
    }), params);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "surface_revision_stale", refreshRevision: "r2" });
  });
});
