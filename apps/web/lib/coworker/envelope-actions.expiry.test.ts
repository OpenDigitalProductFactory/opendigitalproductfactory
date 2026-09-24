// BI-12E5DD91 / BI-78D3CF1E — a decision after the window closed expires the
// request instead of approving or declining it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, updateMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: { coworkerActionEnvelope: { findUnique, update, updateMany } },
}));

import { approveEnvelope, denyEnvelope } from "./envelope-actions";

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

describe("envelope decisions honour the decision window", () => {
  it("approves inside the window", async () => {
    findUnique.mockResolvedValue(row());
    const result = await approveEnvelope("env-1", "user-1");
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledOnce();
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
