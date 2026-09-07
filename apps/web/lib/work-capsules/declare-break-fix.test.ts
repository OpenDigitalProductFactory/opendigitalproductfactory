import { describe, expect, it, vi } from "vitest";

import { BREAK_FIX_SHAPE_REF, declareBreakFix, findMissedPir } from "./declare-break-fix";

const now = new Date("2026-09-06T23:00:00Z");
const human = { userId: "user-1", agentId: null, principalId: "PRN-1" };

function db(overrides: {
  item?: unknown; room?: unknown; openRooms?: unknown[]; history?: unknown[];
} = {}) {
  return {
    backlogItem: { findFirst: vi.fn().mockResolvedValue("item" in overrides ? overrides.item : { id: "row-1", itemId: "BI-ONE", status: "open" }) },
    backlogItemActivity: {
      findMany: vi.fn().mockResolvedValue(overrides.history ?? []),
      create: vi.fn().mockResolvedValue({ id: "act-1" }),
    },
    workroom: {
      findFirst: vi.fn().mockResolvedValue("room" in overrides ? overrides.room : { id: "r1", capsuleId: "WC-ONE", scopeClaims: [{ kind: "path", value: "apps/web", intent: "edit" }] }),
      findMany: vi.fn().mockResolvedValue(overrides.openRooms ?? []),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("declareBreakFix (BI-F2FEC1EB)", () => {
  it("records the declaration, binds the break-fix shape on the room and sets the 48h PIR deadline", async () => {
    const store = db();
    const result = await declareBreakFix({ db: store, itemId: "BI-ONE", reason: "pregate hook never ran on main", actor: human, now });
    expect(result).toMatchObject({ ok: true, capsuleId: "WC-ONE", itemId: "BI-ONE", pirDueAt: "2026-09-08T23:00:00.000Z" });
    expect(store.workroom.update.mock.calls[0]?.[0]).toMatchObject({
      where: { capsuleId: "WC-ONE" },
      data: { scopeClaims: [
        { kind: "path", value: "apps/web", intent: "edit" },
        expect.objectContaining({ workShape: BREAK_FIX_SHAPE_REF, source: "declared", declaredByUserId: "user-1" }),
      ] },
    });
    expect(store.backlogItemActivity.create.mock.calls[0]?.[0]).toMatchObject({
      data: { backlogItemId: "row-1", kind: "break_fix_declared", payload: expect.objectContaining({ schemaVersion: 1, declaredByUserId: "user-1", pirDueAt: "2026-09-08T23:00:00.000Z" }) },
    });
  });

  it("is human-only by default (decision 2)", async () => {
    const result = await declareBreakFix({ db: db(), itemId: "BI-ONE", reason: "x", actor: { ...human, agentId: "AGT-OPS" }, now });
    expect(result).toMatchObject({ ok: false, error: "break_fix_declaration_human_only" });
  });

  it("refuses a second break-fix while one is open (WIP 1 per installation)", async () => {
    const store = db({ openRooms: [{ capsuleId: "WC-OTHER", backlogItemId: "BI-TWO", scopeClaims: [{ workShape: BREAK_FIX_SHAPE_REF, recordedAt: "x" }] }] });
    const result = await declareBreakFix({ db: store, itemId: "BI-ONE", reason: "x", actor: human, now });
    expect(result).toMatchObject({ ok: false, error: "break_fix_wip_exceeded", data: { open: [{ capsuleId: "WC-OTHER", backlogItemId: "BI-TWO" }] } });
    expect(store.workroom.update).not.toHaveBeenCalled();
  });

  it("refuses when the declarer's earlier break-fix missed its PIR", async () => {
    const history = [
      { id: "a", backlogItemId: "row-old", kind: "break_fix_declared", gateKey: null, recordedAt: new Date("2026-09-01T00:00:00Z"), payload: { schemaVersion: 1, declaredAt: "2026-09-01T00:00:00.000Z", pirDueAt: "2026-09-03T00:00:00.000Z", declaredByUserId: "user-1" } },
    ];
    const result = await declareBreakFix({ db: db({ history }), itemId: "BI-ONE", reason: "x", actor: human, now });
    expect(result).toMatchObject({ ok: false, error: "break_fix_pir_missed", data: { backlogItemId: "row-old" } });
    expect(findMissedPir([...history, { id: "b", backlogItemId: "row-old", kind: "initiative_gate_receipt", gateKey: "post-implementation-review", recordedAt: now, payload: {} }], now)).toBeNull();
  });

  it("needs a live Workroom and refuses a double declaration", async () => {
    expect(await declareBreakFix({ db: db({ room: null }), itemId: "BI-ONE", reason: "x", actor: human, now })).toMatchObject({ ok: false, error: "workroom_required" });
    const already = db({ room: { id: "r1", capsuleId: "WC-ONE", scopeClaims: [{ workShape: BREAK_FIX_SHAPE_REF, recordedAt: "x" }] } });
    expect(await declareBreakFix({ db: already, itemId: "BI-ONE", reason: "x", actor: human, now })).toMatchObject({ ok: false, error: "already_declared" });
  });
});
