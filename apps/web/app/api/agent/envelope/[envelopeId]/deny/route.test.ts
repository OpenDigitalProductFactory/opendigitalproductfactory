// Tests for POST /api/agent/envelope/:envelopeId/deny. Mirrors the
// approve route's contract — auth gate, param extraction, action
// dispatch, error → http-status mapping. The interesting branches that
// don't apply to approve (e.g. deny is terminal whereas approve isn't)
// are covered at the state-machine layer in envelope-state-machine.test.ts.
//
// BI-0F9C291C / EP-COWORKER-INTERACTIVITY.

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const denyEnvelopeMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/coworker/envelope-actions", () => ({
  denyEnvelope: (...args: unknown[]) => denyEnvelopeMock(...args),
}));

beforeEach(() => {
  authMock.mockReset();
  denyEnvelopeMock.mockReset();
});

function makeContext(envelopeId: string) {
  return { params: Promise.resolve({ envelopeId }) };
}

function makeRequest() {
  return new Request("http://localhost:3000/api/agent/envelope/env-1/deny", {
    method: "POST",
  });
}

describe("POST /api/agent/envelope/:envelopeId/deny", () => {
  it("returns 401 with no session", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));
    expect(res.status).toBe(401);
    expect(denyEnvelopeMock).not.toHaveBeenCalled();
  });

  it("returns 400 with empty envelopeId", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext(""));
    expect(res.status).toBe(400);
  });

  it("dispatches denyEnvelope with the authenticated user id on success", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const envelope = { id: "env-1", status: "declined", resolvedAt: new Date() };
    denyEnvelopeMock.mockResolvedValue({ ok: true, envelope });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));

    expect(denyEnvelopeMock).toHaveBeenCalledWith("env-1", "u1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.envelope.status).toBe("declined");
  });

  it("maps a state-machine refusal (e.g. already-terminal envelope) to 409", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    denyEnvelopeMock.mockResolvedValue({
      ok: false,
      reason: "Envelope is already in a terminal status (executed); no further transitions are allowed.",
      httpStatus: 409,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));
    expect(res.status).toBe(409);
  });

  it("maps a delegating-user mismatch to 403", async () => {
    authMock.mockResolvedValue({ user: { id: "u-attacker" } });
    denyEnvelopeMock.mockResolvedValue({
      ok: false,
      reason: "User u-attacker cannot act on envelope env-1 — delegating user is u-owner.",
      httpStatus: 403,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));
    expect(res.status).toBe(403);
  });
});
