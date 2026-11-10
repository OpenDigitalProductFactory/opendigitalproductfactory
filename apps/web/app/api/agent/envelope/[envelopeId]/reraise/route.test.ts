// POST /api/agent/envelope/:envelopeId/reraise — "Ask again" (BI-0012E6CA).
// Mirrors the deny route's contract: auth gate, param extraction, action
// dispatch with the session user, refusal → http status.
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const reraiseMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/coworker/envelope-reraise", () => ({
  reraiseEnvelope: (...args: unknown[]) => reraiseMock(...args),
}));

beforeEach(() => {
  authMock.mockReset();
  reraiseMock.mockReset();
});

const context = (envelopeId: string) => ({ params: Promise.resolve({ envelopeId }) });
const request = () => new Request("http://localhost:3000/api/agent/envelope/env-1/reraise", { method: "POST" });

describe("POST /api/agent/envelope/:envelopeId/reraise", () => {
  it("returns 401 with no session", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(request(), context("env-1"))).status).toBe(401);
    expect(reraiseMock).not.toHaveBeenCalled();
  });

  it("returns 400 with an empty envelopeId", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const { POST } = await import("./route");
    expect((await POST(request(), context(""))).status).toBe(400);
  });

  it("re-raises as the authenticated user and returns only the new request's id and status", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    reraiseMock.mockResolvedValue({ ok: true, data: { id: "env-2", status: "proposed", argsJson: { secret: true } } });
    const { POST } = await import("./route");
    const res = await POST(request(), context("env-1"));
    expect(reraiseMock).toHaveBeenCalledWith("env-1", "u1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ envelope: { id: "env-2", status: "proposed" } });
  });

  it("maps a refusal to its status", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    reraiseMock.mockResolvedValue({ ok: false, error: "not yours", httpStatus: 403 });
    const { POST } = await import("./route");
    const res = await POST(request(), context("env-1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "FORBIDDEN", message: "not yours" });
  });
});
