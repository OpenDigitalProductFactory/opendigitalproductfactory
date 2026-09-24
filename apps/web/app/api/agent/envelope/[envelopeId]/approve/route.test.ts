// Tests for POST /api/agent/envelope/:envelopeId/approve. Mock the auth
// session and envelope-actions; verify the route's contract: auth gate,
// param extraction, error → http-status mapping, success body.
//
// BI-0F9C291C / EP-COWORKER-INTERACTIVITY.

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const approveEnvelopeMock = vi.fn();
const runApprovedMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/coworker/envelope-actions", () => ({
  approveEnvelope: (...args: unknown[]) => approveEnvelopeMock(...args),
}));

vi.mock("@/lib/coworker/approved-request-run", () => ({
  runApprovedExternalRequest: (...args: unknown[]) => runApprovedMock(...args),
}));

beforeEach(() => {
  authMock.mockReset();
  approveEnvelopeMock.mockReset();
  runApprovedMock.mockReset();
  runApprovedMock.mockResolvedValue({ status: "not-run", reason: "task-bound", message: "resumes with its task" });
});

function makeContext(envelopeId: string) {
  return { params: Promise.resolve({ envelopeId }) };
}

function makeRequest() {
  return new Request("http://localhost:3000/api/agent/envelope/env-1/approve", {
    method: "POST",
  });
}

describe("POST /api/agent/envelope/:envelopeId/approve", () => {
  it("returns 401 when there is no session", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(approveEnvelopeMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no user.id", async () => {
    authMock.mockResolvedValue({ user: { email: "x@y" } });
    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when envelopeId is empty", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext(""));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "envelopeId required" });
    expect(approveEnvelopeMock).not.toHaveBeenCalled();
  });

  it("calls approveEnvelope with the authenticated user id and returns the envelope on success", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const envelope = { id: "env-1", status: "approved", coworkerAgentId: "AGT-X" };
    approveEnvelopeMock.mockResolvedValue({ ok: true, envelope });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));

    expect(approveEnvelopeMock).toHaveBeenCalledWith("env-1", "u1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      envelope,
      execution: { status: "not-run", reason: "task-bound", message: "resumes with its task" },
    });
  });

  it("runs the approved request once after recording the approval (BI-12E5DD91)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    approveEnvelopeMock.mockResolvedValue({ ok: true, envelope: { id: "env-1", status: "approved" } });
    runApprovedMock.mockResolvedValue({ status: "executed", message: "Created BI-1." });

    const { POST } = await import("./route");
    const body = await (await POST(makeRequest(), makeContext("env-1"))).json();

    expect(runApprovedMock).toHaveBeenCalledOnce();
    expect(runApprovedMock).toHaveBeenCalledWith("env-1");
    expect(body.execution).toEqual({ status: "executed", message: "Created BI-1." });
  });

  it("never runs anything when the approval itself is refused", async () => {
    authMock.mockResolvedValue({ user: { id: "u2" } });
    approveEnvelopeMock.mockResolvedValue({ ok: false, reason: "not the delegating user", httpStatus: 403 });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));

    expect(res.status).toBe(403);
    expect(runApprovedMock).not.toHaveBeenCalled();
  });

  it("reports a run that throws as failed while keeping the recorded approval", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    approveEnvelopeMock.mockResolvedValue({ ok: true, envelope: { id: "env-1", status: "approved" } });
    runApprovedMock.mockRejectedValue(new Error("db down"));

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));

    expect(res.status).toBe(200);
    expect((await res.json()).execution).toEqual({ status: "failed", message: "db down" });
  });

  it("maps a state-machine refusal to the action's httpStatus + reason", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    approveEnvelopeMock.mockResolvedValue({
      ok: false,
      reason: "Envelope is already in a terminal status (declined); no further transitions are allowed.",
      httpStatus: 409,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/terminal/);
  });

  it("maps not-found from the action layer to 404", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    approveEnvelopeMock.mockResolvedValue({
      ok: false,
      reason: "Envelope env-X not found.",
      httpStatus: 404,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-X"));
    expect(res.status).toBe(404);
  });

  it("maps a delegating-user mismatch to 403", async () => {
    authMock.mockResolvedValue({ user: { id: "u-attacker" } });
    approveEnvelopeMock.mockResolvedValue({
      ok: false,
      reason: "User u-attacker cannot act on envelope env-1 — delegating user is u-owner.",
      httpStatus: 403,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), makeContext("env-1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/cannot act/);
  });
});
