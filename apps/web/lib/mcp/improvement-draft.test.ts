import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { submitImprovementDraft, type ImprovementDraftDatabase } from "./improvement-draft";

const effects = vi.hoisted(() => ({ intake: vi.fn(), index: vi.fn() }));
vi.mock("@/lib/operate/backlog-ingest", () => ({
  ingestBacklogItem: (...args: unknown[]) => effects.intake(...args),
  improvementCategoryToWorkType: () => "bug",
}));
vi.mock("@/lib/semantic-memory", () => ({ storePlatformKnowledge: (...args: unknown[]) => effects.index(...args) }));

const input = { title: "Learning", description: "Measured friction", category: "performance" };
const context = { agentId: "agent-a", routeContext: "/build", threadId: "thread-a" };

function database() {
  const rows = new Map<string, Record<string, unknown>>();
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => row[key] === value);
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    backlogItem: { findMany: vi.fn().mockResolvedValue([]) },
    agentThread: { findFirst: vi.fn().mockResolvedValue({ id: "thread-a" }) },
    improvementProposal: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].find(row => matches(row, where)) ?? null),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].find(row => matches(row, where)) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Record<string, unknown> = { status: "proposed", backlogItemId: null, ...data };
        rows.set(String(row.proposalId), row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { proposalId: string }; data: Record<string, unknown> }) => {
        const row = { ...rows.get(where.proposalId), ...data };
        rows.set(where.proposalId, row);
        return row;
      }),
    },
  };
  const client = { $transaction: vi.fn(async (work: (value: Prisma.TransactionClient) => Promise<unknown>) => work(tx as unknown as Prisma.TransactionClient)) };
  return { rows, tx, client, db: client as unknown as ImprovementDraftDatabase };
}

beforeEach(() => {
  vi.clearAllMocks();
  effects.intake.mockResolvedValue({ itemId: "IMP-1" });
  effects.index.mockResolvedValue(undefined);
});

describe("internal learning draft persistence", () => {
  it("reuses exact normalized pending content and never repeats completed intake or indexing", async () => {
    const state = database();
    const first = await submitImprovementDraft(input, "owner-a", context, state.db);
    await vi.waitFor(() => expect(effects.index).toHaveBeenCalledTimes(1));
    const repeat = await submitImprovementDraft({ ...input, title: " Learning " }, "owner-a", context, state.db);
    expect(repeat).toMatchObject({ entityId: first.entityId, data: { reused: true, backlogItemId: "IMP-1", projectionPending: false } });
    expect(state.rows.size).toBe(1);
    expect(state.tx.improvementProposal.create).toHaveBeenCalledTimes(1);
    expect(effects.intake).toHaveBeenCalledTimes(1);
    expect(effects.index).toHaveBeenCalledTimes(1);
    expect(state.tx.improvementProposal.create.mock.calls[0][0].data.conversationExcerpt).toBeNull();
  });

  it("keeps user, actor, route, thread and complete submitted content in the identity", async () => {
    const state = database();
    await submitImprovementDraft(input, "owner-a", context, state.db);
    await submitImprovementDraft(input, "owner-b", context, state.db);
    await submitImprovementDraft(input, "owner-a", { ...context, agentId: "agent-b" }, state.db);
    await submitImprovementDraft(input, "owner-a", { ...context, routeContext: "/operate" }, state.db);
    await submitImprovementDraft(input, "owner-a", { ...context, threadId: "thread-b" }, state.db);
    await submitImprovementDraft({ ...input, description: "Different finding" }, "owner-a", context, state.db);
    await submitImprovementDraft({ ...input, observedFriction: "Explicit evidence" }, "owner-a", context, state.db);
    expect(state.rows.size).toBe(7);
  });

  it("treats omitted and blank optional evidence as the same pending draft", async () => {
    const state = database();
    const first = await submitImprovementDraft(input, "owner-a", context, state.db);
    expect(await submitImprovementDraft({ ...input, observedFriction: "  " }, "owner-a", context, state.db)).toMatchObject({ entityId: first.entityId, data: { reused: true } });
    expect(state.rows.size).toBe(1);
  });

  it("refuses a missing, foreign or cancelled current thread before any write", async () => {
    const state = database();
    state.tx.agentThread.findFirst.mockResolvedValue(null);
    expect(await submitImprovementDraft(input, "owner-a", context, state.db)).toMatchObject({ success: false, error: "learning_context_unavailable" });
    expect(state.tx.agentThread.findFirst).toHaveBeenCalledWith({ where: { id: "thread-a", userId: "owner-a", cancelledAt: null }, select: { id: true } });
    expect(state.rows.size).toBe(0);
    expect(effects.intake).not.toHaveBeenCalled();
    expect(effects.index).not.toHaveBeenCalled();
  });

  it("does not revive a reviewed draft", async () => {
    const state = database();
    const first = await submitImprovementDraft(input, "owner-a", context, state.db);
    state.rows.get(first.entityId!)!.status = "reviewed";
    const next = await submitImprovementDraft(input, "owner-a", context, state.db);
    expect(next.entityId).not.toBe(first.entityId);
    expect(state.rows.get(first.entityId!)!.status).toBe("reviewed");
    expect(state.rows.size).toBe(2);
  });

  it("recovers a missing intake projection using the same durable proposal", async () => {
    const state = database();
    effects.intake.mockRejectedValueOnce(new Error("projection unavailable"));
    const first = await submitImprovementDraft(input, "owner-a", context, state.db);
    expect(first).toMatchObject({ success: true, data: { projectionPending: true, backlogItemId: null } });
    const recovered = await submitImprovementDraft(input, "owner-a", context, state.db);
    expect(recovered).toMatchObject({ entityId: first.entityId, data: { reused: true, backlogItemId: "IMP-1", projectionPending: false } });
    await submitImprovementDraft(input, "owner-a", context, state.db);
    expect(effects.intake).toHaveBeenCalledTimes(2);
    expect(state.rows.size).toBe(1);
    expect(state.tx.improvementProposal.create).toHaveBeenCalledTimes(1);
    expect(effects.intake.mock.calls[1][0].origin).toEqual({ kind: "improvement", id: first.entityId });
  });

  it("relinks a legacy completed intake origin without filing or counting the same work again", async () => {
    const state = database();
    effects.intake.mockRejectedValueOnce(new Error("old link interruption"));
    const first = await submitImprovementDraft(input, "owner-a", context, state.db);
    state.tx.backlogItem.findMany.mockResolvedValue([{ itemId: "IMP-ALREADY-DONE", submittedById: "owner-a", agentId: "agent-a" }]);
    expect(await submitImprovementDraft(input, "owner-a", context, state.db)).toMatchObject({ entityId: first.entityId, data: { reused: true, backlogItemId: "IMP-ALREADY-DONE", projectionPending: false } });
    expect(effects.intake).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ itemId: "IMP-FOREIGN", submittedById: "other-owner", agentId: "agent-a" }],
    [{ itemId: "IMP-FOREIGN", submittedById: "owner-a", agentId: "other-agent" }],
    [{ itemId: "IMP-A", submittedById: "owner-a", agentId: "agent-a" }, { itemId: "IMP-B", submittedById: "owner-a", agentId: "agent-a" }],
  ])("parks mismatched or ambiguous legacy origins without another intake: %j", async (...origins) => {
    const state = database();
    effects.intake.mockRejectedValueOnce(new Error("old link interruption"));
    await submitImprovementDraft(input, "owner-a", context, state.db);
    state.tx.backlogItem.findMany.mockResolvedValue(origins);
    expect(await submitImprovementDraft(input, "owner-a", context, state.db)).toMatchObject({ data: { backlogItemId: null, projectionPending: true } });
    expect(effects.intake).toHaveBeenCalledTimes(1);
    expect(state.tx.improvementProposal.update).not.toHaveBeenCalled();
  });

  it("retries only a database-confirmed rollback with a bounded attempt count", async () => {
    const state = database();
    state.client.$transaction.mockRejectedValueOnce({ code: "P2034" }).mockRejectedValueOnce({ code: "40001" });
    expect(await submitImprovementDraft(input, "owner-a", context, state.db)).toMatchObject({ success: true });
    expect(state.client.$transaction).toHaveBeenCalledTimes(4);
    expect(state.tx.improvementProposal.create).toHaveBeenCalledTimes(1);
  });

  it("does not automatically replay a transaction after an uncertain commit acknowledgement", async () => {
    const state = database();
    state.client.$transaction.mockImplementationOnce(async work => {
      await work(state.tx as unknown as Prisma.TransactionClient);
      throw new Error("connection lost after commit");
    });
    await expect(submitImprovementDraft(input, "owner-a", context, state.db)).rejects.toThrow("connection lost");
    expect(state.client.$transaction).toHaveBeenCalledTimes(1);
    expect(state.rows.size).toBe(1);
    const sameId = [...state.rows.keys()][0];
    expect(await submitImprovementDraft(input, "owner-a", context, state.db)).toMatchObject({ entityId: sameId, data: { reused: true, backlogItemId: "IMP-1" } });
    expect(state.tx.improvementProposal.create).toHaveBeenCalledTimes(1);
  });

  it("does not treat a unique-key failure as authority for a blind replay", async () => {
    const state = database();
    state.client.$transaction.mockRejectedValueOnce({ code: "P2002" });
    await expect(submitImprovementDraft(input, "owner-a", context, state.db)).rejects.toMatchObject({ code: "P2002" });
    expect(state.client.$transaction).toHaveBeenCalledTimes(1);
    expect(state.rows.size).toBe(0);
  });

  it("retains the low-severity reference-document intake suppression", async () => {
    const state = database();
    expect(await submitImprovementDraft({ ...input, title: "[reference-doc] Clarify help", severity: "low" }, "owner-a", context, state.db)).toMatchObject({ success: true, data: { backlogItemId: null, projectionPending: false } });
    expect(effects.intake).not.toHaveBeenCalled();
  });

  it("does not report committed intake as pending when optional indexing fails afterwards", async () => {
    const state = database();
    effects.intake.mockImplementationOnce(async (_input, ports: { indexKnowledge(value: { entityId: string; title: string; content: string }): void }) => {
      ports.indexKnowledge({ entityId: "IMP-1", title: input.title, content: input.description });
      return { itemId: "IMP-1" };
    });
    const result = await submitImprovementDraft(input, "owner-a", context, state.db, { indexKnowledge: () => { throw new Error("index unavailable"); } });
    expect(result).toMatchObject({ success: true, data: { backlogItemId: "IMP-1", projectionPending: false } });
    expect(state.rows.values().next().value?.backlogItemId).toBe("IMP-1");
  });
});
