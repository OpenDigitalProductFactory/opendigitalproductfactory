// BI-7BCC87BB (plan B8, AC-OVERRIDE; founder answer to waiver W6): the person
// whose authority is lent decides first, and an admin who is not that person
// can decide in their place with a recorded reason. A non-admin who is not the
// delegate is still refused, and the delegate path is unchanged.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, updateMany, createAuthorizationDecisionLog } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  createAuthorizationDecisionLog: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: { coworkerActionEnvelope: { findUnique, update, updateMany } },
}));
vi.mock("@/lib/governance-data", () => ({ createAuthorizationDecisionLog }));

import { approveEnvelope, denyEnvelope, readOnBehalfDecision } from "./envelope-actions";

const BINDING = { toolName: "run_discovery_triage" };

function row(over: Record<string, unknown> = {}) {
  return {
    id: "env-1", coworkerAgentId: "AGT-OPS", delegatingUserId: "owner-1", threadId: "t",
    chatMessageId: null, manifestActionId: "run_discovery_triage",
    argsJson: { approvalBinding: BINDING }, approvalBindingFingerprint: "fp-1", rationale: "r",
    status: "proposed", createdAt: new Date(), resolvedAt: null,
    expiresAt: new Date(Date.now() + 60_000), ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset(); update.mockReset(); updateMany.mockReset(); createAuthorizationDecisionLog.mockReset();
  update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...row(), ...args.data }));
  updateMany.mockResolvedValue({ count: 1 });
  createAuthorizationDecisionLog.mockResolvedValue(undefined);
  findUnique.mockResolvedValue(row());
});

describe("approve on someone's behalf (AC-OVERRIDE)", () => {
  it("an admin who is not the delegate approves with a reason; the marker names both people and the reason", async () => {
    const result = await approveEnvelope("env-1", "admin-1", { reason: "  Owner left the company.  ", callerIsAdmin: true });

    expect(result).toMatchObject({ ok: true, envelope: { status: "approved" } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "env-1", status: "proposed" },
      data: {
        status: "approved",
        argsJson: {
          approvalBinding: BINDING,
          humanApproval: {
            userId: "admin-1", approvedAt: expect.any(String),
            by: "admin-1", onBehalfOf: "owner-1", reason: "Owner left the company.",
          },
        },
      },
    });
  });

  it("writes an audit row naming the admin as actor and the owner as the person decided for", async () => {
    await approveEnvelope("env-1", "admin-1", { reason: "Owner is away.", callerIsAdmin: true });
    expect(createAuthorizationDecisionLog).toHaveBeenCalledWith({
      actorType: "user",
      actorRef: "admin-1",
      humanContextRef: "owner-1",
      actionKey: "coworker_envelope.approve_on_behalf",
      objectRef: "env-1",
      decision: "allow",
      rationale: { by: "admin-1", onBehalfOf: "owner-1", reason: "Owner is away.", toolName: "run_discovery_triage", coworkerAgentId: "AGT-OPS" },
    });
  });

  it("refuses an admin with no reason, before any write", async () => {
    for (const reason of ["", "   "]) {
      const result = await approveEnvelope("env-1", "admin-1", { reason, callerIsAdmin: true });
      expect(result).toMatchObject({ ok: false, httpStatus: 400 });
      expect(!result.ok && result.reason).toMatch(/reason/i);
    }
    expect(updateMany).not.toHaveBeenCalled();
    expect(createAuthorizationDecisionLog).not.toHaveBeenCalled();
  });

  it("still refuses a non-admin who is not the delegate, even with a reason", async () => {
    const result = await approveEnvelope("env-1", "someone-else", { reason: "I think it is fine.", callerIsAdmin: false });
    expect(result).toMatchObject({ ok: false, httpStatus: 403 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(createAuthorizationDecisionLog).not.toHaveBeenCalled();
  });

  it("still refuses anyone who is not the delegate and asks for no override", async () => {
    const result = await approveEnvelope("env-1", "admin-1");
    expect(result).toMatchObject({ ok: false, httpStatus: 403 });
  });

  it("leaves the delegate path unchanged: no override record, no audit row", async () => {
    await approveEnvelope("env-1", "owner-1", { reason: "ignored", callerIsAdmin: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "env-1", status: "proposed" },
      data: { status: "approved", argsJson: { approvalBinding: BINDING, humanApproval: { userId: "owner-1", approvedAt: expect.any(String) } } },
    });
    expect(createAuthorizationDecisionLog).not.toHaveBeenCalled();
  });

  it("refuses an override on a screen-action envelope, whose arguments must stay verbatim", async () => {
    findUnique.mockResolvedValue(row({ approvalBindingFingerprint: null, argsJson: { target: "customer-1" } }));
    const result = await approveEnvelope("env-1", "admin-1", { reason: "Owner is away.", callerIsAdmin: true });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("a lapsed request still expires instead of being decided on someone's behalf", async () => {
    findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1) }));
    const result = await approveEnvelope("env-1", "admin-1", { reason: "Owner is away.", callerIsAdmin: true });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(createAuthorizationDecisionLog).not.toHaveBeenCalled();
  });
});

describe("decline on someone's behalf (AC-OVERRIDE)", () => {
  it("an admin who is not the delegate declines with a reason, recorded on the request and in the audit", async () => {
    const result = await denyEnvelope("env-1", "admin-1", { reason: "Not wanted any more.", callerIsAdmin: true });
    expect(result).toMatchObject({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "env-1" },
      data: {
        status: "declined",
        resolvedAt: expect.any(Date),
        argsJson: {
          approvalBinding: BINDING,
          humanDecline: { by: "admin-1", onBehalfOf: "owner-1", reason: "Not wanted any more.", declinedAt: expect.any(String) },
        },
      },
    });
    expect(createAuthorizationDecisionLog).toHaveBeenCalledWith(expect.objectContaining({
      actorRef: "admin-1", humanContextRef: "owner-1", actionKey: "coworker_envelope.decline_on_behalf",
      rationale: expect.objectContaining({ reason: "Not wanted any more." }),
    }));
  });

  it("refuses a non-admin non-delegate and an admin with no reason", async () => {
    expect(await denyEnvelope("env-1", "someone-else", { reason: "x", callerIsAdmin: false })).toMatchObject({ ok: false, httpStatus: 403 });
    expect(await denyEnvelope("env-1", "admin-1", { reason: " ", callerIsAdmin: true })).toMatchObject({ ok: false, httpStatus: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves the delegate decline unchanged", async () => {
    await denyEnvelope("env-1", "owner-1");
    expect(update).toHaveBeenCalledWith({ where: { id: "env-1" }, data: { status: "declined", resolvedAt: expect.any(Date) } });
  });
});

describe("readOnBehalfDecision", () => {
  it("reads an approval or a decline made on someone's behalf, and nothing for the delegate's own decision", () => {
    expect(readOnBehalfDecision({ humanApproval: { userId: "a", approvedAt: "2026-10-07T00:00:00.000Z", by: "a", onBehalfOf: "o", reason: "away" } }))
      .toEqual({ decision: "approved", by: "a", onBehalfOf: "o", reason: "away" });
    expect(readOnBehalfDecision({ humanDecline: { by: "a", onBehalfOf: "o", reason: "no", declinedAt: "2026-10-07T00:00:00.000Z" } }))
      .toEqual({ decision: "declined", by: "a", onBehalfOf: "o", reason: "no" });
    expect(readOnBehalfDecision({ humanApproval: { userId: "o", approvedAt: "2026-10-07T00:00:00.000Z" } })).toBeNull();
    expect(readOnBehalfDecision(null)).toBeNull();
  });
});
