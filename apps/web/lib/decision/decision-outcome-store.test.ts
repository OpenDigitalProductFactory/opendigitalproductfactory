import { describe, expect, it, vi } from "vitest";

import { recordDecisionOutcome, type DecisionOutcomeDb } from "./decision-outcome-store";
import { SEALED_IMMUTABLE_FIELDS } from "./decision-chain";

type UpdateArgs = { where: { interactionId: string }; data: Record<string, unknown> };

function makeDb(row: Record<string, unknown> | null) {
  const update = vi.fn(async (_args: UpdateArgs) => ({}));
  const db = {
    decisionInteraction: {
      findUnique: vi.fn(async () => row),
      update,
    },
  } as unknown as DecisionOutcomeDb;
  return { db, update };
}

const recommended = {
  interactionId: "DI-1",
  recommendedOptionId: "a",
  chosenOptionId: null,
  humanOutcome: null,
  options: ["a", "b"],
  autonomous: false,
};

describe("recordDecisionOutcome", () => {
  it("writes the chosen option and the resolution payload", async () => {
    const { db, update } = makeDb(recommended);

    const result = await recordDecisionOutcome({
      db,
      interactionId: "DI-1",
      chosenOptionId: "b",
      resolvedBy: "agent",
      rationale: "the cheaper option loses the audit trail",
      now: new Date("2026-09-22T00:00:00.000Z"),
    });

    expect(result).toEqual({
      recorded: true,
      disposition: "overridden",
      agreement: false,
      interactionId: "DI-1",
    });
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0]![0].data;
    expect(data.chosenOptionId).toBe("b");
    expect(data.humanOutcome).toMatchObject({
      type: "kernel-consult-resolution",
      disposition: "overridden",
      resolvedBy: "agent",
      recommendedOptionId: "a",
      agreement: false,
      resolvedAt: "2026-09-22T00:00:00.000Z",
    });
  });

  it("writes ONLY the two columns the trust envelope leaves mutable", async () => {
    // The row is sealed into an append-only hash chain. If this write ever
    // touched a sealed field, every recorded decision would become forgeable
    // after the fact, so the guarantee is asserted against the real list rather
    // than restated here.
    const { db, update } = makeDb(recommended);

    await recordDecisionOutcome({
      db,
      interactionId: "DI-1",
      chosenOptionId: "a",
      resolvedBy: "human",
      rationale: "followed",
    });

    const data = update.mock.calls[0]![0].data;
    expect(Object.keys(data).sort()).toEqual(["chosenOptionId", "humanOutcome"]);
    for (const field of SEALED_IMMUTABLE_FIELDS) {
      expect(data).not.toHaveProperty(field);
    }
  });

  it("records an unresolved decision as a row rather than leaving it absent", async () => {
    const { db, update } = makeDb(recommended);

    const result = await recordDecisionOutcome({
      db,
      interactionId: "DI-1",
      chosenOptionId: null,
      resolvedBy: "agent",
      rationale: "the work was cancelled before either option was taken",
    });

    expect(result).toMatchObject({ recorded: true, disposition: "unresolved", agreement: null });
    const data = update.mock.calls[0]![0].data;
    expect(data.chosenOptionId).toBeNull();
    expect(data.humanOutcome).toMatchObject({ disposition: "unresolved", agreement: null });
  });

  it("refuses an unknown interactionId without writing", async () => {
    const { db, update } = makeDb(null);

    const result = await recordDecisionOutcome({
      db,
      interactionId: "DI-missing",
      chosenOptionId: "a",
      resolvedBy: "human",
      rationale: "",
    });

    expect(result).toMatchObject({ recorded: false, reason: "not-found" });
    expect(update).not.toHaveBeenCalled();
  });

  it("passes the rule refusals through and writes nothing", async () => {
    for (const [row, reason] of [
      [{ ...recommended, recommendedOptionId: null }, "no-recommendation"],
      [{ ...recommended, chosenOptionId: "b" }, "already-resolved"],
    ] as const) {
      const { db, update } = makeDb(row);
      const result = await recordDecisionOutcome({
        db,
        interactionId: "DI-1",
        chosenOptionId: "a",
        resolvedBy: "human",
        rationale: "",
      });
      expect(result).toMatchObject({ recorded: false, reason });
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("treats a malformed options column as an empty menu, so no choice validates", async () => {
    // Refusing is the safe direction: accepting an option we cannot check would
    // record an agreement signal against a menu nobody can reconstruct.
    const { db, update } = makeDb({ ...recommended, options: "not-an-array" });

    const result = await recordDecisionOutcome({
      db,
      interactionId: "DI-1",
      chosenOptionId: "a",
      resolvedBy: "human",
      rationale: "",
    });

    expect(result).toMatchObject({ recorded: false, reason: "option-not-offered" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a failed write as unrecorded rather than implying success", async () => {
    const { db } = makeDb(recommended);
    db.decisionInteraction.update = vi.fn(async () => {
      throw new Error("db down");
    });

    const result = await recordDecisionOutcome({
      db,
      interactionId: "DI-1",
      chosenOptionId: "a",
      resolvedBy: "agent",
      rationale: "",
    });

    expect(result).toMatchObject({ recorded: false, reason: "write-failed", detail: "db down" });
  });
});
