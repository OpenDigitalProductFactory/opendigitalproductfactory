import { describe, expect, it } from "vitest";

import { claimSweep, emptySweepCheckpoint, type SweepCheckpoint } from "./acceptance-sweep-checkpoint";
import { withAcceptanceSweepWrite, type SweepFenceClient } from "./acceptance-sweep-fence";

const start = Date.parse("2026-10-12T18:00:00Z");
function database(checkpoint: SweepCheckpoint) {
  let state = checkpoint;
  let clock = start;
  let active = true;
  let effects: string[] = [];
  let transactions = 0;
  const statements: string[] = [];
  const db = {
    async $transaction<T>(work: (tx: SweepFenceClient & { write(value: string): void }) => Promise<T>) {
      transactions++;
      const staged = [...effects];
      const tx = {
        async $queryRawUnsafe(query: string) {
          statements.push(query);
          if (query.includes("FOR UPDATE")) return [{ taskConfig: { acceptanceSweep: state }, isActive: active }];
          return [{ now: new Date(clock) }];
        },
        write(value: string) { staged.push(value); },
      };
      const result = await work(tx);
      effects = staged;
      return result;
    },
  };
  return {
    db, statements,
    state(value: SweepCheckpoint) { state = value; },
    clock(value: number) { clock = value; },
    disable() { active = false; },
    effects: () => effects,
    transactions: () => transactions,
  };
}

describe("acceptance sweep write fence", () => {
  it("uses the locked transaction client and validates ownership again before returning", async () => {
    const a = claimSweep(emptySweepCheckpoint(), "owner-a", start);
    const db = database(a.checkpoint);
    await withAcceptanceSweepWrite(db.db, "acceptance-sweep-daily", a.claim, async tx => tx.write("snapshot"));
    expect(db.effects()).toEqual(["snapshot"]);
    expect(db.statements[0]).toContain("statement_timeout");
    expect(db.statements[1]).toContain("FOR UPDATE");
    expect(db.statements.filter(q => q.includes("clock_timestamp")).length).toBe(2);
    expect(db.transactions()).toBe(1);
  });

  it.each(["snapshot", "route", "terminal", "cursor", "schedule", "terminal-audit-retry"])("rejects a stale %s callback after recovery", async port => {
    const a = claimSweep(emptySweepCheckpoint(), "owner-a", start);
    const b = claimSweep(a.checkpoint, "owner-b", start + 300_000);
    const db = database(b.checkpoint);
    db.clock(start + 300_001);
    let called = false;
    await expect(withAcceptanceSweepWrite(db.db, "acceptance-sweep-daily", a.claim, async tx => {
      called = true;
      tx.write(port);
    })).rejects.toThrow("ownership lost");
    expect(called).toBe(false);
    expect(db.effects()).toEqual([]);
  });

  it("rolls back a callback that exceeds its lease", async () => {
    const a = claimSweep(emptySweepCheckpoint(), "owner-a", start);
    const db = database(a.checkpoint);
    await expect(withAcceptanceSweepWrite(db.db, "acceptance-sweep-daily", a.claim, async tx => {
      tx.write("must-roll-back");
      db.clock(start + 300_000);
    })).rejects.toThrow("ownership lost");
    expect(db.effects()).toEqual([]);
  });

  it("refuses writes after the operator disables the task", async () => {
    const a = claimSweep(emptySweepCheckpoint(), "owner-a", start);
    const db = database(a.checkpoint);
    db.disable();
    await expect(withAcceptanceSweepWrite(db.db, "acceptance-sweep-daily", a.claim, async tx => tx.write("route")))
      .rejects.toThrow("disabled");
    expect(db.effects()).toEqual([]);
  });
});
