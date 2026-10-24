// BI-12E5DD91 / BI-78D3CF1E — a decision after the window closed expires the
// request instead of approving or declining it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, updateMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: { coworkerActionEnvelope: { findUnique, update, updateMany } },
}));

import { approveEnvelope, denyEnvelope, cancelEnvelope } from "./envelope-actions";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "env-1", coworkerAgentId: "AGT-EXT-CODEX", delegatingUserId: "user-1", threadId: "t",
    chatMessageId: null, manifestActionId: "create_backlog_item", argsJson: {}, rationale: "r",
    status: "proposed", createdAt: new Date(), resolvedAt: null,
    expiresAt: new Date(Date.now() + 60_000), ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset(); update.mockReset(); updateMany.mockReset();
  update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...row(), ...args.data }));
  updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.restoreAllMocks());

describe("envelope decisions honour the decision window", () => {
  it.each([
    ["approve", approveEnvelope],
    ["decline", denyEnvelope],
  ] as const)("cannot %s when expiry crosses between the read and write", async (_name, decide) => {
    const start = Date.now();
    const expiresAt = new Date(start + 1);
    findUnique.mockResolvedValue(row({ expiresAt }));
    // The initial freshness check passes, but the write starts at expiry.
    vi.spyOn(Date, "now").mockReturnValueOnce(start).mockReturnValue(start + 1);
    updateMany.mockImplementation(async ({ where }) => ({
      count: where.OR?.some((condition: { expiresAt: { gt: Date } | null }) =>
        condition.expiresAt && expiresAt <= condition.expiresAt.gt) ? 0 : 1,
    }));
    expect(await decide("env-1", "user-1")).toMatchObject({ ok: false, httpStatus: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["approve after cancellation", approveEnvelope, "proposed", "cancelled", true],
    ["approve a resolved proposal", approveEnvelope, "proposed", "proposed", true],
    ["decline after approval", denyEnvelope, "proposed", "approved", false],
    ["cancel after reservation", cancelEnvelope, "approved", "approved", true],
    ["cancel after execution", cancelEnvelope, "approved", "executed", true],
  ] as const)("does not %s over a concurrent decision or reservation (%s → %s)", async (_name, decide, seenStatus, currentStatus, reserved) => {
    // The caller read an old snapshot; another request won before its write.
    findUnique.mockResolvedValue(row({ status: seenStatus }));
    const live = row({ status: currentStatus, resolvedAt: reserved ? new Date() : null });
    const original = { ...live };
    update.mockImplementation(async ({ data }) => Object.assign(live, data));
    updateMany.mockImplementation(async ({ where, data }) => {
      if (where.status !== live.status || (where.resolvedAt === null && live.resolvedAt !== null)) return { count: 0 };
      Object.assign(live, data);
      return { count: 1 };
    });
    expect(await decide("env-1", "user-1")).toMatchObject({ ok: false, httpStatus: 409 });
    expect(live).toEqual(original);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["decline", denyEnvelope, "proposed", "declined"],
    ["cancel proposal", cancelEnvelope, "proposed", "cancelled"],
    ["cancel before execution", cancelEnvelope, "approved", "cancelled"],
  ] as const)("can %s an unresolved request", async (_name, decide, status, resultStatus) => {
    findUnique.mockResolvedValue(row({ status }));
    expect(await decide("env-1", "user-1")).toMatchObject({
      ok: true, envelope: { status: resultStatus, resolvedAt: expect.any(Date) },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "env-1", status, resolvedAt: null,
        ...(resultStatus === "declined" ? { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] } : {}),
      },
      data: { status: resultStatus, resolvedAt: expect.any(Date) },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("approves inside the window", async () => {
    findUnique.mockResolvedValue(row({ approvalBindingFingerprint: "binding-1", argsJson: { approvalBinding: { toolName: "create_backlog_item" } } }));
    const result = await approveEnvelope("env-1", "user-1");
    expect(result).toMatchObject({ ok: true, envelope: { status: "approved" } });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "env-1", status: "proposed", resolvedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }, data: expect.objectContaining({
      status: "approved",
      argsJson: { approvalBinding: { toolName: "create_backlog_item" }, humanApproval: { userId: "user-1", approvedAt: expect.any(String) } },
    }) });
  });

  // BI-F4EB23C1 — a second press after the card reconciled cannot approve twice.
  it("records one approval when two decisions overlap", async () => {
    findUnique.mockResolvedValue(row());
    updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await approveEnvelope("env-1", "user-1");
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it.each([
    { target: "customer-1", action: "open" },
    { approvalBinding: { toolName: "a-tool-argument" } },
  ])("preserves raw screen-action arguments on approval: %j", async (argsJson) => {
    findUnique.mockResolvedValue(row({ argsJson, approvalBindingFingerprint: null }));
    expect(await approveEnvelope("env-1", "user-1")).toMatchObject({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "env-1", status: "proposed", resolvedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }, data: { status: "approved" } });
  });

  it.each([
    ["approve", approveEnvelope],
    ["decline", denyEnvelope],
  ] as const)("refuses to %s a lapsed request and settles it as expired", async (_label, decide) => {
    findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1) }));
    const result = await decide("env-1", "user-1");
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(!result.ok && result.reason).toMatch(/expired/);
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "env-1", resolvedAt: null }),
      data: expect.objectContaining({ status: "expired" }),
    }));
  });

  it("checks the delegating person before anything about the window", async () => {
    findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1) }));
    const result = await approveEnvelope("env-1", "someone-else");
    expect(result).toMatchObject({ ok: false, httpStatus: 403 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
