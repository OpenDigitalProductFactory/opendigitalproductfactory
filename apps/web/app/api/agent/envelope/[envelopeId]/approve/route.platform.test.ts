// Approval convergence A3 (BI-C8EC05C9, spec D3): the approve route checks for
// a platform-completed request FIRST (AC-DISPATCH), runs it through the
// platform runner, and records `approval_outcome` exactly once. Every envelope
// without the marker takes the external path exactly as before (AC-INERT).
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const approveEnvelopeMock = vi.fn();
const runExternalMock = vi.fn();
const runPlatformMock = vi.fn();
const recordOutcomeMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/coworker/envelope-actions", () => ({ approveEnvelope: (...args: unknown[]) => approveEnvelopeMock(...args) }));
vi.mock("@/lib/coworker/approval-outcome-store", () => ({ recordApprovalOutcome: (...args: unknown[]) => recordOutcomeMock(...args) }));
vi.mock("@/lib/coworker/approved-request-run", () => ({
  runApprovedExternalRequest: (...args: unknown[]) => runExternalMock(...args),
  runApprovedPlatformRequest: (...args: unknown[]) => runPlatformMock(...args),
}));

const context = { params: Promise.resolve({ envelopeId: "env-1" }) };
const request = () => new Request("http://localhost:3000/api/agent/envelope/env-1/approve", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  approveEnvelopeMock.mockResolvedValue({ ok: true, envelope: { id: "env-1", status: "approved" } });
  recordOutcomeMock.mockResolvedValue(undefined);
  runExternalMock.mockResolvedValue({ status: "not-run", reason: "task-bound", message: "resumes with its task" });
});

describe("POST /api/agent/envelope/:envelopeId/approve — platform-completed requests", () => {
  it("AC-INERT: without the marker, the external path runs exactly as before", async () => {
    runPlatformMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const body = await (await POST(request(), context)).json();
    expect(runPlatformMock).toHaveBeenCalledWith("env-1");
    expect(runExternalMock).toHaveBeenCalledOnce();
    expect(body.execution).toEqual({ status: "not-run", reason: "task-bound", message: "resumes with its task" });
    expect(recordOutcomeMock).toHaveBeenCalledOnce();
    expect(recordOutcomeMock).toHaveBeenCalledWith("env-1", "u1", body.execution);
  });

  it("AC-DISPATCH: a marked request runs on the platform runner and never reaches the external task resume", async () => {
    runPlatformMock.mockResolvedValue({ status: "executed", message: "Triage ran.", entityId: "TRIAGE-1" });
    const { POST } = await import("./route");
    const body = await (await POST(request(), context)).json();
    expect(runPlatformMock.mock.invocationCallOrder[0]).toBeLessThan(recordOutcomeMock.mock.invocationCallOrder[0]!);
    expect(runExternalMock).not.toHaveBeenCalled();
    expect(body.execution).toEqual({ status: "executed", message: "Triage ran.", entityId: "TRIAGE-1" });
    expect(recordOutcomeMock).toHaveBeenCalledOnce();
  });

  it("records a settled run as its recorded outcome, once", async () => {
    runPlatformMock.mockResolvedValue({ status: "settled", outcome: "failed", message: "Refused before it ran." });
    const { POST } = await import("./route");
    await POST(request(), context);
    expect(recordOutcomeMock).toHaveBeenCalledOnce();
    expect(recordOutcomeMock).toHaveBeenCalledWith("env-1", "u1", { status: "failed", message: "Refused before it ran." });
  });

  it("a runner that throws is reported as failed, never as an error that invites another approval", async () => {
    runPlatformMock.mockRejectedValue(new Error("db unavailable"));
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect((await response.json()).execution).toEqual({ status: "failed", message: "db unavailable" });
    expect(runExternalMock).not.toHaveBeenCalled();
  });
});
