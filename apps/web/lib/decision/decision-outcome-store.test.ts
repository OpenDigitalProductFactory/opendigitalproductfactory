import { describe, expect, it, vi } from "vitest";

import { recordDecisionOutcome, type DecisionOutcomeDb } from "./decision-outcome-store";
import { SEALED_IMMUTABLE_FIELDS } from "./decision-chain";

type UpdateArgs = { where: { interactionId: string }; data: Record<string, unknown> };

type LedgerUpsertArgs = {
  where: { ledgerId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function makeDb(
  row: Record<string, unknown> | null,
  ledgerImpl?: (args: LedgerUpsertArgs) => Promise<unknown>,
) {
  const update = vi.fn(async (_args: UpdateArgs) => ({}));
  const upsert = vi.fn(ledgerImpl ?? (async (_args: LedgerUpsertArgs) => ({})));
  const db = {
    decisionInteraction: {
      findUnique: vi.fn(async () => row),
      update,
    },
    decisionShadowLedger: { upsert },
  } as unknown as DecisionOutcomeDb;
  return { db, update, upsert };
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
      // This fixture names no coworker, so there is no ledger row to complete.
      shadowLedger: expect.objectContaining({ written: false, reason: "no-agent" }),
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

  // BI-6082C235: the outcome half of the decision's shadow-ledger row is
  // filled from the same resolution slice 1 records, in the same call.
  describe("shadow ledger", () => {
    const attributed = {
      ...recommended,
      agentId: "AGT-EXT-CODEX",
      domainClass: "kernel-consult",
      riskTier: "low",
      outcomeType: "recommend",
      rationale: "a is simpler",
      taskRunId: null,
      subjectKind: null,
      subjectRef: null,
    };

    it("completes the coworker's ledger row with the actual decision and agreement", async () => {
      const { db, upsert } = makeDb(attributed);
      const result = await recordDecisionOutcome({
        db,
        interactionId: "DI-1",
        chosenOptionId: "b",
        resolvedBy: "agent",
        rationale: "override",
        now: new Date("2026-10-03T00:00:00.000Z"),
      });

      expect(result).toMatchObject({
        recorded: true,
        shadowLedger: { written: true, ledgerId: "DSL-DI-1", agreement: false },
      });
      expect(upsert).toHaveBeenCalledTimes(1);
      const args = upsert.mock.calls[0]![0];
      expect(args.where).toEqual({ ledgerId: "DSL-DI-1" });
      expect(args.update).toMatchObject({
        actualDecision: { chosenOptionId: "b", disposition: "overridden" },
        outcome: { disposition: "overridden", resolvedBy: "agent", resolvedAt: "2026-10-03T00:00:00.000Z" },
        agreement: false,
      });
      expect(args.create).toMatchObject({ agentId: "AGT-EXT-CODEX", agreement: false, autonomyLevel: "shadow" });
    });

    it("keeps agreement null on the ledger for an unresolved report", async () => {
      const { db, upsert } = makeDb(attributed);
      await recordDecisionOutcome({
        db,
        interactionId: "DI-1",
        chosenOptionId: null,
        resolvedBy: "agent",
        rationale: "dropped",
      });
      expect(upsert.mock.calls[0]![0].update).toMatchObject({ agreement: null });
    });

    it("still records the outcome when the ledger write fails, and says so", async () => {
      const { db, update } = makeDb(attributed, async () => {
        throw new Error("ledger down");
      });
      const result = await recordDecisionOutcome({
        db,
        interactionId: "DI-1",
        chosenOptionId: "a",
        resolvedBy: "agent",
        rationale: "",
      });
      expect(update).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        recorded: true,
        shadowLedger: { written: false, reason: "write-failed", detail: "ledger down" },
      });
    });

    it("does not touch the ledger when the outcome is refused", async () => {
      const { db, upsert } = makeDb({ ...attributed, recommendedOptionId: null });
      await recordDecisionOutcome({
        db,
        interactionId: "DI-1",
        chosenOptionId: "a",
        resolvedBy: "agent",
        rationale: "",
      });
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
