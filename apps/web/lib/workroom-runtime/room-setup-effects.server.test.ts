import { describe, expect, it, vi } from "vitest";

// BI-C64EDA33 PR 3 (AC-5): a room's setup is owed in the transaction that made
// the room, as an outbox effect, and run (and retried) by the effect worker.

const anchor = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ workItemId: "wi-1" })));
vi.mock("@/lib/work-capsules/capsule-workitem-anchor.server", () => ({ ensureCapsuleWorkItemAnchorWithPrisma: anchor }));

import { executeRoomSetupEffect, oweRoomSetup } from "./room-setup-effects.server";
import type { EffectSqlDb } from "./workroom-effect-store";

function recordingDb() {
  const inserts: unknown[][] = [];
  return {
    inserts,
    db: { $queryRaw: async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("?").includes(`INSERT INTO "WorkroomEffect"`)) inserts.push(values);
      return [] as T;
    } } as EffectSqlDb,
  };
}

describe("room setup owed by a claim or adoption", () => {
  it("is one anchor effect, not process-bound, keyed so a repeated claim owes it once", async () => {
    const { db, inserts } = recordingDb();
    const input = { roomRowId: "row-1", capsuleId: "WC-1", backlogItemId: "BI-1", title: "Work on BI-1", source: "claim" as const };
    await oweRoomSetup(db, input);
    await oweRoomSetup(db, input);
    // [id, roomRowId, commandKey, ordinal, kind, processBound, sessionGeneration, payload, now]
    expect(inserts.map((v) => [v[1], v[2], v[3], v[4], v[5], v[6]])).toEqual([
      ["row-1", "room-setup:claim:WC-1:BI-1", 0, "ensure-workitem-anchor", false, null],
      ["row-1", "room-setup:claim:WC-1:BI-1", 0, "ensure-workitem-anchor", false, null],
    ]);
    // The same command key and ordinal: the store's ON CONFLICT keeps one row (workroom-effect-store.pg.test.ts).
    expect(JSON.parse(String(inserts[0]![7]))).toEqual({ capsuleId: "WC-1", backlogItemId: "BI-1", title: "Work on BI-1" });
  });

  it("runs the anchor when the worker reaches it, and a failure is thrown for the worker to retry", async () => {
    await expect(executeRoomSetupEffect({ kind: "ensure-workitem-anchor", payload: { capsuleId: "WC-1", backlogItemId: "BI-1", title: "t" } }))
      .resolves.toEqual({ anchored: true });
    expect(anchor).toHaveBeenCalledWith({ capsuleId: "WC-1", backlogItemId: "BI-1", title: "t" });
    anchor.mockRejectedValueOnce(new Error("queue table locked"));
    await expect(executeRoomSetupEffect({ kind: "ensure-workitem-anchor", payload: { capsuleId: "WC-1", backlogItemId: null, title: "t" } }))
      .rejects.toThrow("queue table locked");
  });
});
