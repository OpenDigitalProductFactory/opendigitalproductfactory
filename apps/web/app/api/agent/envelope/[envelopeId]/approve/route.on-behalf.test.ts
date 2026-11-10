// BI-7BCC87BB (plan B8, AC-OVERRIDE): the approve route passes an on-behalf
// decision through only with the admin capability the user-management surface
// checks (manage_users, lib/actions/users.ts), runs the approved call as the
// owner whose authority is lent, records the outcome against the owner's
// request with the admin as the actor, and says who decided for whom.
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const approveEnvelopeMock = vi.fn();
const describeMock = vi.fn();
const runPlatformMock = vi.fn();
const runExternalMock = vi.fn();
const recordOutcomeMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/coworker/approval-outcome-store", () => ({
  recordApprovalOutcome: (...args: unknown[]) => recordOutcomeMock(...args),
}));
vi.mock("@/lib/coworker/envelope-actions", () => ({
  approveEnvelope: (...args: unknown[]) => approveEnvelopeMock(...args),
  describeOnBehalfDecision: (...args: unknown[]) => describeMock(...args),
}));
vi.mock("@/lib/coworker/approved-request-run", () => ({
  runApprovedExternalRequest: (...args: unknown[]) => runExternalMock(...args),
  runApprovedPlatformRequest: (...args: unknown[]) => runPlatformMock(...args),
}));

const ENVELOPE = {
  id: "env-1", status: "approved", delegatingUserId: "owner-1",
  argsJson: { humanApproval: { userId: "admin-1", approvedAt: "x", by: "admin-1", onBehalfOf: "owner-1", reason: "Owner is away." } },
};

function request(body?: unknown) {
  return new Request("http://localhost:3000/api/agent/envelope/env-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = { params: Promise.resolve({ envelopeId: "env-1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  recordOutcomeMock.mockResolvedValue(undefined);
  runPlatformMock.mockResolvedValue({ status: "executed", message: "Triage ran.", entityId: "RUN-1" });
  approveEnvelopeMock.mockResolvedValue({ ok: true, envelope: ENVELOPE });
  describeMock.mockResolvedValue({ decision: "approved", by: "admin@x.test", onBehalfOf: "owner@x.test", reason: "Owner is away." });
});

describe("POST approve on someone's behalf", () => {
  it("an admin (manage_users) asking on someone's behalf passes the reason and the capability through", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", platformRole: "HR-000", isSuperuser: false } });
    const { POST } = await import("./route");
    const response = await POST(request({ onBehalf: true, reason: "Owner is away." }), context);
    expect(response.status).toBe(200);
    expect(approveEnvelopeMock).toHaveBeenCalledWith("env-1", "admin-1", { reason: "Owner is away.", callerIsAdmin: true });
  });

  it("a person without manage_users asking on someone's behalf is passed through as not an admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u-2", platformRole: "HR-300", isSuperuser: false } });
    approveEnvelopeMock.mockResolvedValue({ ok: false, reason: "not the delegating user", httpStatus: 403 });
    const { POST } = await import("./route");
    const response = await POST(request({ onBehalf: true, reason: "x" }), context);
    expect(response.status).toBe(403);
    expect(approveEnvelopeMock).toHaveBeenCalledWith("env-1", "u-2", { reason: "x", callerIsAdmin: false });
    expect(runPlatformMock).not.toHaveBeenCalled();
  });

  it("records the outcome against the owner's request, with the admin as the actor, and says who decided for whom", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", platformRole: null, isSuperuser: true } });
    const { POST } = await import("./route");
    const body = await (await POST(request({ onBehalf: true, reason: "Owner is away." }), context)).json();
    expect(runPlatformMock).toHaveBeenCalledWith("env-1");
    expect(recordOutcomeMock).toHaveBeenCalledWith(
      "env-1", "owner-1", { status: "executed", message: "Triage ran.", entityId: "RUN-1" }, undefined, "admin-1",
    );
    expect(body.onBehalf).toEqual({ decision: "approved", by: "admin@x.test", onBehalfOf: "owner@x.test", reason: "Owner is away." });
  });

  it("a request with no body keeps the delegate call exactly as before", async () => {
    authMock.mockResolvedValue({ user: { id: "owner-1", platformRole: null, isSuperuser: false } });
    approveEnvelopeMock.mockResolvedValue({ ok: true, envelope: { ...ENVELOPE, argsJson: {} } });
    describeMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const body = await (await POST(request(), context)).json();
    expect(approveEnvelopeMock).toHaveBeenCalledWith("env-1", "owner-1");
    expect(recordOutcomeMock).toHaveBeenCalledWith("env-1", "owner-1", expect.objectContaining({ status: "executed" }));
    expect(body.onBehalf).toBeUndefined();
  });
});
