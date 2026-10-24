import { describe, expect, it, vi } from "vitest";

import { expireLapsedEnvelopes } from "./envelope-expiry";
import { TERMINAL_STATUSES, canTransition } from "./envelope-state-machine";

const NOW = new Date("2026-09-12T20:00:00.000Z");

function dbWith(rows: Array<{ id: string; status: string }>, count = rows.length) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const updateMany = vi.fn().mockResolvedValue({ count });
  return {
    db: { coworkerActionEnvelope: { findMany, updateMany } },
    findMany,
    updateMany,
  };
}

describe("expireLapsedEnvelopes (BI-410ACCB8)", () => {
  it("settles a proposed envelope whose window closed unanswered", async () => {
    const { db, updateMany } = dbWith([{ id: "e1", status: "proposed" }]);
    await expect(expireLapsedEnvelopes(db, NOW)).resolves.toEqual({ expired: 1, skipped: 0 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "expired", resolvedAt: NOW } }),
    );
  });

  it("settles an approved envelope too — approval is not execution", async () => {
    const { db } = dbWith([{ id: "e1", status: "approved" }]);
    await expect(expireLapsedEnvelopes(db, NOW)).resolves.toEqual({ expired: 1, skipped: 0 });
  });

  it("only reads envelopes already past their window, never one still open", async () => {
    const { db, findMany } = dbWith([]);
    await expireLapsedEnvelopes(db, NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          resolvedAt: null,
          expiresAt: { lte: NOW, not: null },
        }),
      }),
    );
  });

  it("re-asserts the precondition at write time, so a late human answer wins", async () => {
    // Between the read and the write a person may decide. The update must not
    // overwrite their answer.
    const { db, updateMany } = dbWith([{ id: "e1", status: "proposed" }]);
    await expireLapsedEnvelopes(db, NOW);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["proposed", "approved"] }, resolvedAt: null }),
      }),
    );
  });

  it("never drags a settled envelope back out of a terminal status", async () => {
    const settled = TERMINAL_STATUSES.filter((s) => s !== "expired").map((status, i) => ({
      id: `t${i}`,
      status,
    }));
    const { db, updateMany } = dbWith(settled, 0);
    await expect(expireLapsedEnvelopes(db, NOW)).resolves.toEqual({
      expired: 0,
      skipped: settled.length,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does nothing, and touches nothing, when none have lapsed", async () => {
    const { db, updateMany } = dbWith([]);
    await expect(expireLapsedEnvelopes(db, NOW)).resolves.toEqual({ expired: 0, skipped: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("bounds one pass so a backlog cannot monopolise the transaction", async () => {
    const { db, findMany } = dbWith([]);
    await expireLapsedEnvelopes(db, NOW, 50);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it("agrees with the state machine about what expiry is reachable from", () => {
    // The sweep's LAPSABLE set and the transition table must not drift apart.
    expect(canTransition("proposed", "expired")).toBe(true);
    expect(canTransition("approved", "expired")).toBe(true);
    expect(canTransition("executed", "expired")).toBe(false);
    expect(canTransition("declined", "expired")).toBe(false);
  });
});
