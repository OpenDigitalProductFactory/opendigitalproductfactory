import { beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";

const mocks = vi.hoisted(() => ({
  envelope: vi.fn(), receipt: vi.fn(), history: vi.fn(), create: vi.fn(), update: vi.fn(), rooms: vi.fn(), room: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  coworkerActionEnvelope: { findUnique: mocks.envelope },
  backlogItem: { findFirst: vi.fn(async () => ({ id: "row-1", itemId: "BI-ONE" })) },
  backlogItemActivity: { findFirst: mocks.receipt, findMany: mocks.history, create: mocks.create },
  workroom: { findFirst: mocks.room, findMany: mocks.rooms, update: mocks.update },
} }));
vi.mock("./handler-actor", () => ({ workCapsuleActor: vi.fn(async () => ({ userId: "u1", agentId: "AGT-CODEX", principalId: "p1" })) }));

import { declareBreakFixTool } from "./declare-break-fix-tool";

const params = { itemId: "BI-ONE", reason: "Live review routing fails on main." };
const context = { agentId: "AGT-CODEX", approvedAuthorityEnvelopeId: "env-1" };
function envelope(over: Record<string, unknown> = {}) {
  return {
    id: "env-1", manifestActionId: "declare_break_fix", delegatingUserId: "u1", coworkerAgentId: "AGT-CODEX",
    status: "approved", resolvedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    inputFingerprint: fingerprintCoworkerInput(params),
    argsJson: { humanApproval: { userId: "u1", approvedAt: new Date().toISOString() } }, ...over,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.envelope.mockResolvedValue(envelope());
  mocks.receipt.mockResolvedValue(null);
  mocks.history.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "activity-1" });
  mocks.rooms.mockResolvedValue([]);
  mocks.room.mockResolvedValue({ id: "r1", capsuleId: "WC-ONE", scopeClaims: [] });
});

describe("human-approved break-fix declaration", () => {
  it("executes the exact approved call and retains both identities in its declaration", async () => {
    const result = await declareBreakFixTool(params, "u1", context);
    expect(result.success).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: "break_fix_declared", payload: expect.objectContaining({ declaredByUserId: "u1", actingAgentId: "AGT-CODEX", approvalEnvelopeId: "env-1" }),
    }) }));
  });

  it.each([
    ["missing envelope", null],
    ["unreserved", envelope({ resolvedAt: null })],
    ["expired", envelope({ expiresAt: new Date(0) })],
    ["already executed", envelope({ status: "executed" })],
    ["different human", envelope({ delegatingUserId: "someone-else" })],
    ["different coworker", envelope({ coworkerAgentId: "AGT-OTHER" })],
    ["different tool", envelope({ manifestActionId: "other_tool" })],
    ["different input", envelope({ inputFingerprint: "wrong" })],
    ["policy-only approval", envelope({ argsJson: { policyProjection: {} } })],
    ["wrong approving person", envelope({ argsJson: { humanApproval: { userId: "someone-else", approvedAt: new Date().toISOString() } } })],
    ["malformed human decision", envelope({ argsJson: { humanApproval: { userId: "u1", approvedAt: "invalid" } } })],
    ["future human decision", envelope({ argsJson: { humanApproval: { userId: "u1", approvedAt: new Date(Date.now() + 86_400_000).toISOString() } } })],
  ])("refuses %s", async (_label, row) => {
    mocks.envelope.mockResolvedValue(row);
    expect(await declareBreakFixTool(params, "u1", context)).toMatchObject({ success: false, error: "break_fix_declaration_human_only" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not accept an envelope supplied in model-controlled arguments", async () => {
    expect(await declareBreakFixTool({ ...params, approvedAuthorityEnvelopeId: "env-1" }, "u1", { agentId: "AGT-CODEX" })).toMatchObject({ success: false, error: "break_fix_declaration_human_only" });
    expect(mocks.envelope).not.toHaveBeenCalled();
  });

  it("keeps the WIP-1 limit after human approval", async () => {
    mocks.rooms.mockResolvedValue([{ capsuleId: "WC-OTHER", backlogItemId: "BI-OTHER", scopeClaims: [{ workShape: "delivery-break-fix@1.0.0" }] }]);
    expect(await declareBreakFixTool(params, "u1", context)).toMatchObject({ success: false, error: "break_fix_wip_exceeded" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not confuse a claimed shape with the audited declaration", async () => {
    mocks.room.mockResolvedValue({ id: "r1", capsuleId: "WC-ONE", scopeClaims: [{ workShape: "delivery-break-fix@1.0.0", source: "declared" }] });
    expect(await declareBreakFixTool(params, "u1", context)).toMatchObject({ success: true });
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("keeps the missed-PIR refusal after human approval", async () => {
    mocks.history.mockResolvedValue([{ id: "old", backlogItemId: "row-old", kind: "break_fix_declared", recordedAt: new Date(0),
      payload: { schemaVersion: 1, declaredAt: new Date(0).toISOString(), pirDueAt: new Date(1).toISOString(), declaredByUserId: "u1" } }]);
    expect(await declareBreakFixTool(params, "u1", context)).toMatchObject({ success: false, error: "break_fix_pir_missed" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not attribute another person's old declaration to the current declarer", async () => {
    mocks.history.mockResolvedValue([{ id: "old", backlogItemId: "row-1", kind: "break_fix_declared", recordedAt: new Date(0),
      payload: { schemaVersion: 1, capsuleId: "WC-OLD", declaredAt: new Date(0).toISOString(), pirDueAt: new Date(1).toISOString(), declaredByUserId: "someone-else" } }]);
    expect(await declareBreakFixTool(params, "u1", context)).toMatchObject({ success: true });
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});
