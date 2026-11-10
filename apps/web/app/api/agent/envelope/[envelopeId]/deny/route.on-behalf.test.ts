// BI-7BCC87BB (plan B8, AC-OVERRIDE): declining on someone's behalf follows
// the same rule as approving — the manage_users capability, a reason, and a
// response that says who decided for whom.
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const denyEnvelopeMock = vi.fn();
const describeMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/coworker/envelope-actions", () => ({
  denyEnvelope: (...args: unknown[]) => denyEnvelopeMock(...args),
  describeOnBehalfDecision: (...args: unknown[]) => describeMock(...args),
}));

function request(body?: unknown) {
  return new Request("http://localhost:3000/api/agent/envelope/env-1/deny", {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = { params: Promise.resolve({ envelopeId: "env-1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  denyEnvelopeMock.mockResolvedValue({ ok: true, envelope: { id: "env-1", status: "declined", argsJson: {} } });
  describeMock.mockResolvedValue({ decision: "declined", by: "admin@x.test", onBehalfOf: "owner@x.test", reason: "Not wanted." });
});

describe("POST deny on someone's behalf", () => {
  it("passes the reason and whether the caller holds manage_users", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", platformRole: "HR-000", isSuperuser: false } });
    const { POST } = await import("./route");
    const body = await (await POST(request({ onBehalf: true, reason: "Not wanted." }), context)).json();
    expect(denyEnvelopeMock).toHaveBeenCalledWith("env-1", "admin-1", { reason: "Not wanted.", callerIsAdmin: true });
    expect(body.onBehalf).toEqual({ decision: "declined", by: "admin@x.test", onBehalfOf: "owner@x.test", reason: "Not wanted." });
  });

  it("keeps the delegate's own decline call unchanged", async () => {
    authMock.mockResolvedValue({ user: { id: "owner-1", platformRole: null, isSuperuser: false } });
    describeMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const body = await (await POST(request(), context)).json();
    expect(denyEnvelopeMock).toHaveBeenCalledWith("env-1", "owner-1");
    expect(body.onBehalf).toBeUndefined();
  });
});
