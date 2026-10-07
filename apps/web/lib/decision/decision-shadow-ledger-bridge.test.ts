import { describe, expect, it, vi } from "vitest";

import {
  resolveDecisionAgentId,
  syncDecisionShadowLedger,
  type DecisionAgentLookupDb,
  type DecisionShadowLedgerDb,
} from "./decision-shadow-ledger-bridge";
import type { BridgeableDecisionRow } from "./decision-shadow-ledger-mapping";

type UpsertArgs = {
  where: { ledgerId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function ledgerDb(impl?: (args: UpsertArgs) => Promise<unknown>) {
  const rows = new Map<string, Record<string, unknown>>();
  const upsert = vi.fn(
    impl ??
      (async (args: UpsertArgs) => {
        const existing = rows.get(args.where.ledgerId);
        const next = existing ? { ...existing, ...args.update } : { ...args.create };
        rows.set(args.where.ledgerId, next);
        return next;
      }),
  );
  return { db: { decisionShadowLedger: { upsert } } as DecisionShadowLedgerDb, upsert, rows };
}

function agentDb(present: string[]) {
  const findMany = vi.fn(async (args: { where: { agentId: { in: string[] } } }) =>
    args.where.agentId.in.filter((id) => present.includes(id)).map((agentId) => ({ agentId })),
  );
  return { db: { agent: { findMany } } as unknown as DecisionAgentLookupDb, findMany };
}

const decision: BridgeableDecisionRow = {
  interactionId: "DI-1",
  agentId: "AGT-EXT-CLAUDE",
  domainClass: "kernel-consult",
  riskTier: "low",
  outcomeType: "recommend",
  recommendedOptionId: "a",
  options: ["a", "b"],
  rationale: "a is simpler",
  chosenOptionId: null,
  humanOutcome: null,
  taskRunId: null,
  autonomous: true,
  subjectKind: null,
  subjectRef: null,
};

const followed = {
  type: "kernel-consult-resolution",
  disposition: "followed",
  resolvedBy: "agent",
  recommendedOptionId: "a",
  chosenOptionId: "a",
  agreement: true,
  rationale: "",
  resolvedAt: "2026-10-02T00:00:00.000Z",
};

describe("resolveDecisionAgentId", () => {
  it("returns the canonical coworker when its row exists", async () => {
    const { db } = agentDb(["AGT-WS-BUILD", "build-specialist"]);
    await expect(resolveDecisionAgentId(db, "build-specialist")).resolves.toBe("AGT-WS-BUILD");
  });

  it("falls back to the recorded id when only it exists", async () => {
    const { db } = agentDb(["build-specialist"]);
    await expect(resolveDecisionAgentId(db, "build-specialist")).resolves.toBe("build-specialist");
  });

  it("records null for an id no Agent row carries, rather than a dangling reference", async () => {
    const { db } = agentDb([]);
    await expect(resolveDecisionAgentId(db, "AGT-GHOST")).resolves.toBeNull();
  });

  it("records null when no id was supplied, without a lookup", async () => {
    const { db, findMany } = agentDb(["AGT-1"]);
    await expect(resolveDecisionAgentId(db, null)).resolves.toBeNull();
    await expect(resolveDecisionAgentId(db, "   ")).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("records null when the lookup fails, rather than blocking the decision", async () => {
    const db = { agent: { findMany: vi.fn(async () => { throw new Error("db down"); }) } } as unknown as DecisionAgentLookupDb;
    await expect(resolveDecisionAgentId(db, "AGT-1")).resolves.toBeNull();
  });
});

describe("syncDecisionShadowLedger", () => {
  it("writes one shadow row attributable to the coworker", async () => {
    const { db, upsert, rows } = ledgerDb();
    const outcome = await syncDecisionShadowLedger(db, decision);

    expect(outcome).toEqual({ written: true, ledgerId: "DSL-DI-1", agreement: null });
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0]![0];
    expect(args.where).toEqual({ ledgerId: "DSL-DI-1" });
    expect(args.create).toMatchObject({
      ledgerId: "DSL-DI-1",
      agentId: "AGT-EXT-CLAUDE",
      activityType: "governed_decision_kernel_consult",
      riskClass: "internal-reversible",
      autonomyLevel: "shadow",
      decisionInteractionId: "DI-1",
      sourceKind: "governed-decision",
      agreement: null,
    });
    // A nullable Json column cannot take a bare null; an unknown outcome is an
    // absent value, not a stored JSON null.
    expect(args.create).not.toHaveProperty("actualDecision");
    expect(args.create).not.toHaveProperty("outcome");
    expect(rows.size).toBe(1);
  });

  it("never writes a decision twice: a second sync updates the same row", async () => {
    const { db, rows } = ledgerDb();
    await syncDecisionShadowLedger(db, decision);
    await syncDecisionShadowLedger(db, decision);
    await syncDecisionShadowLedger(db, { ...decision, chosenOptionId: "a", humanOutcome: followed });
    expect(rows.size).toBe(1);
    expect(rows.get("DSL-DI-1")).toMatchObject({ agreement: true, actualDecision: { chosenOptionId: "a" } });
  });

  it("leaves a row untouched when re-synced without a resolution", async () => {
    const { db, upsert } = ledgerDb();
    await syncDecisionShadowLedger(db, decision);
    expect(upsert.mock.calls[0]![0].update).toEqual({});
  });

  it("fills the outcome half once the resolution is known", async () => {
    const { db, upsert } = ledgerDb();
    const outcome = await syncDecisionShadowLedger(db, { ...decision, chosenOptionId: "a", humanOutcome: followed });
    expect(outcome).toEqual({ written: true, ledgerId: "DSL-DI-1", agreement: true });
    const { update } = upsert.mock.calls[0]![0];
    expect(Object.keys(update).sort()).toEqual(["actualDecision", "agreement", "metadata", "outcome", "reconciledAt"]);
    expect(update.reconciledAt).toEqual(new Date("2026-10-02T00:00:00.000Z"));
  });

  it("refuses without writing when the decision has no coworker", async () => {
    const { db, upsert } = ledgerDb();
    await expect(syncDecisionShadowLedger(db, { ...decision, agentId: null })).resolves.toMatchObject({
      written: false,
      reason: "no-agent",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses without writing when the domain class is unmapped", async () => {
    const { db, upsert } = ledgerDb();
    await expect(syncDecisionShadowLedger(db, { ...decision, domainClass: "novel" })).resolves.toMatchObject({
      written: false,
      reason: "unmapped-domain-class",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of throwing", async () => {
    const { db } = ledgerDb(async () => {
      throw new Error("unique violation");
    });
    await expect(syncDecisionShadowLedger(db, decision)).resolves.toMatchObject({
      written: false,
      reason: "write-failed",
      detail: "unique violation",
    });
  });
});
