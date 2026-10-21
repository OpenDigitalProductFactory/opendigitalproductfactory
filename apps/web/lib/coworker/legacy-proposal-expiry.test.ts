// BI-753D69A9 — legacy AgentActionProposal rows expire under the envelope
// lifetime rule (WWMD DI-738A194A7A61). Status change only; no row is deleted.

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { DURABLE_APPROVAL_LIFETIME_MS } from "./approval-lifetime";
import {
  LEGACY_PROPOSAL_EXPIRY_DECISION_REF,
  LEGACY_PROPOSAL_EXPIRY_EXCLUDED_ACTIONS,
  expireLapsedLegacyProposals,
  type LegacyProposalExpiryDb,
} from "./legacy-proposal-expiry";
import { LEAVE_DECISION_ACTION } from "@/lib/workforce/leave/leave-decision-proposal-contract";
import { PROACTIVITY_CHANGE_ACTION } from "@/lib/proactivity/proactivity-change-proposal";

const NOW = new Date("2026-10-21T06:00:00.000Z");

type Row = { id: string; proposalId: string; threadId: string; agentId: string; actionType: string; proposedAt: Date };

function row(n: number, ageDays: number, actionType = "run_discovery_triage"): Row {
  return {
    id: `cuid-${n}`,
    proposalId: `AP-${n}`,
    threadId: `thread-${n}`,
    agentId: `agent-${n}`,
    actionType,
    proposedAt: new Date(NOW.getTime() - ageDays * 86_400_000),
  };
}

function makeDb(pending: Row[], opts: { casCount?: (id: string) => number } = {}) {
  const store = new Map(pending.map((r) => [r.id, { ...r, status: "proposed" }]));
  const findMany = vi.fn(async (args: { where: { status?: string; proposedAt: { lt: Date }; actionType: { notIn: string[] }; id?: { notIn: string[] } }; take: number }) => {
    const { where, take } = args;
    return [...store.values()]
      .filter((r) => r.status === "proposed")
      .filter((r) => r.proposedAt < where.proposedAt.lt)
      .filter((r) => !where.actionType.notIn.includes(r.actionType))
      .filter((r) => !(where.id?.notIn ?? []).includes(r.id))
      .sort((a, b) => a.proposedAt.getTime() - b.proposedAt.getTime())
      .slice(0, take)
      .map(({ status: _s, ...rest }) => rest);
  });
  const updateMany = vi.fn(async (args: { where: { id: string; status: string }; data: { status: string; decidedAt: Date } }) => {
    const forced = opts.casCount?.(args.where.id);
    if (forced !== undefined) return { count: forced };
    const r = store.get(args.where.id);
    if (!r || r.status !== args.where.status) return { count: 0 };
    r.status = args.data.status;
    return { count: 1 };
  });
  const logCreate = vi.fn(async (_args: { data: Record<string, any> }) => ({}));
  const messageCreate = vi.fn(async (_args: { data: Record<string, any> }) => ({}));
  const tx = {
    agentActionProposal: { updateMany },
    authorizationDecisionLog: { create: logCreate },
    agentMessage: { create: messageCreate },
  };
  const db = {
    agentActionProposal: { findMany },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as LegacyProposalExpiryDb;
  return { db, store, findMany, updateMany, logCreate, messageCreate };
}

describe("expireLapsedLegacyProposals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("expires proposed rows older than the durable approval lifetime and leaves younger rows pending", async () => {
    const { db, store } = makeDb([row(1, 8), row(2, 60), row(3, 6)]);
    const result = await expireLapsedLegacyProposals(db, { now: NOW });
    expect(result.expired).toBe(2);
    expect(store.get("cuid-1")?.status).toBe("expired");
    expect(store.get("cuid-2")?.status).toBe("expired");
    expect(store.get("cuid-3")?.status).toBe("proposed");
  });

  it("uses the durable approval lifetime constant as the cutoff, not a literal", async () => {
    const { db, findMany } = makeDb([]);
    await expireLapsedLegacyProposals(db, { now: NOW });
    const where = findMany.mock.calls[0][0].where;
    expect(where.proposedAt.lt.getTime()).toBe(NOW.getTime() - DURABLE_APPROVAL_LIFETIME_MS);
    expect(where.status).toBe("proposed");
  });

  it("compare-and-sets on id and status proposed, and records decidedAt", async () => {
    const { db, updateMany } = makeDb([row(1, 9)]);
    await expireLapsedLegacyProposals(db, { now: NOW });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "cuid-1", status: "proposed" },
      data: { status: "expired", decidedAt: NOW },
    });
  });

  it("writes one system AuthorizationDecisionLog row per expiry naming the rule, the proposal and the decision", async () => {
    const { db, logCreate } = makeDb([row(1, 9)]);
    await expireLapsedLegacyProposals(db, { now: NOW });
    expect(logCreate).toHaveBeenCalledTimes(1);
    const data = logCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actionKey: "run_discovery_triage",
      objectRef: "AP-1",
      actorType: "system",
      decision: "deny",
    });
    expect(data.decisionId).toMatch(/^DEC-/);
    expect(data.rationale).toMatchObject({
      proposalId: "AP-1",
      rule: "approval-lifetime",
      lifetimeMs: DURABLE_APPROVAL_LIFETIME_MS,
      decisionRef: "DI-738A194A7A61",
    });
    expect(LEGACY_PROPOSAL_EXPIRY_DECISION_REF).toBe("DI-738A194A7A61");
  });

  it("writes one system message in the proposal's thread saying nothing ran", async () => {
    const { db, messageCreate } = makeDb([row(1, 9)]);
    await expireLapsedLegacyProposals(db, { now: NOW });
    expect(messageCreate).toHaveBeenCalledTimes(1);
    const data = messageCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ threadId: "thread-1", role: "system", agentId: "agent-1" });
    expect(data.content).toContain("run_discovery_triage");
    expect(data.content).toContain("expired");
    expect(data.content).toContain("nothing ran");
  });

  it("is idempotent: a row another writer already settled gets no log and no message", async () => {
    const { db, logCreate, messageCreate } = makeDb([row(1, 9)], { casCount: () => 0 });
    const result = await expireLapsedLegacyProposals(db, { now: NOW });
    expect(result.expired).toBe(0);
    expect(result.alreadySettled).toBe(1);
    expect(logCreate).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("a second run expires nothing", async () => {
    const { db } = makeDb([row(1, 9), row(2, 30)]);
    await expireLapsedLegacyProposals(db, { now: NOW });
    const again = await expireLapsedLegacyProposals(db, { now: NOW });
    expect(again.expired).toBe(0);
  });

  it("excludes leave-decision and proactivity-change proposals", async () => {
    expect(LEGACY_PROPOSAL_EXPIRY_EXCLUDED_ACTIONS).toEqual([LEAVE_DECISION_ACTION, PROACTIVITY_CHANGE_ACTION]);
    const { db, store } = makeDb([row(1, 30, LEAVE_DECISION_ACTION), row(2, 30, PROACTIVITY_CHANGE_ACTION), row(3, 30)]);
    const result = await expireLapsedLegacyProposals(db, { now: NOW });
    expect(result.expired).toBe(1);
    expect(store.get("cuid-1")?.status).toBe("proposed");
    expect(store.get("cuid-2")?.status).toBe("proposed");
    expect(store.get("cuid-3")?.status).toBe("expired");
  });

  it("processes in bounded batches and stops at the batch cap", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 1, 10 + i));
    const { db, findMany, store } = makeDb(rows);
    const result = await expireLapsedLegacyProposals(db, { now: NOW, batchSize: 2, maxBatches: 3 });
    expect(findMany).toHaveBeenCalledTimes(3);
    for (const call of findMany.mock.calls) expect(call[0].take).toBe(2);
    expect(result.expired).toBe(6);
    expect(result.truncated).toBe(true);
    expect([...store.values()].filter((r) => r.status === "proposed")).toHaveLength(1);
  });

  it("a row whose write throws is counted, skipped, and not retried in the same run", async () => {
    const { db, findMany } = makeDb([row(1, 9), row(2, 9)]);
    type TxFn = (fn: unknown) => Promise<unknown>;
    const realTx = (db as unknown as { $transaction: Mock<TxFn> }).$transaction;
    const impl = realTx.getMockImplementation()!;
    realTx.mockImplementation(async (fn: unknown) => {
      if (realTx.mock.calls.length === 1) throw new Error("db unavailable");
      return impl(fn);
    });
    const result = await expireLapsedLegacyProposals(db, { now: NOW, batchSize: 1 });
    expect(result.failed).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.errors[0]).toContain("db unavailable");
    const lastWhere = findMany.mock.calls.at(-1)![0].where;
    expect(lastWhere.id?.notIn).toEqual(["cuid-1"]);
  });
});
