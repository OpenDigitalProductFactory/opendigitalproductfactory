// Approval convergence A3 (BI-C8EC05C9, spec D8): the dual-read readers count
// and list converted envelopes (those whose park row carries the platform
// marker) beside legacy proposals. None exists yet, so every count and list is
// exactly today's.
import { describe, expect, it, vi } from "vitest";

import { CONVERTED_ENVELOPE_WHERE, countPendingApprovalRequests } from "./converted-approval-requests";

describe("converted approval requests", () => {
  it("are identified by the marker on their park row, never by a column a caller sets", () => {
    expect(CONVERTED_ENVELOPE_WHERE).toEqual({
      toolExecutions: { some: { parameters: { path: ["_approvalResume", "v"], equals: 1 } } },
    });
  });

  it("the pending count is proposals plus live converted envelopes (parity: 0 converted today)", async () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const db = {
      agentActionProposal: { count: vi.fn(async () => 46) },
      coworkerActionEnvelope: { count: vi.fn(async () => 0) },
    };
    await expect(countPendingApprovalRequests(db, now)).resolves.toBe(46);
    expect(db.agentActionProposal.count).toHaveBeenCalledWith({ where: { status: "proposed" } });
    expect(db.coworkerActionEnvelope.count).toHaveBeenCalledWith({
      where: { status: "proposed", expiresAt: { gt: now }, ...CONVERTED_ENVELOPE_WHERE },
    });
  });
});
