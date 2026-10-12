import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, update, ingestBacklogItem } = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  ingestBacklogItem: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { improvementSignal: { upsert, update } } }));
vi.mock("@/lib/operate/backlog-ingest", () => ({ ingestBacklogItem }));

import { createOrTouchImprovementSignal } from "./signals";

type Row = { signalId: string; recurrenceCount: number; backlogItemId: string | null; evidence: unknown; title: string };
const input = { sourceType: "platform_issue_report", sourceId: "PIR-ONE", title: "One observation" };

// Small persistence adapter exercises outcomes across repeated/concurrent calls.
// SQL uniqueness/atomicity still requires the shared integration gate.
function memoryStore(seed?: Row) {
  const rows = new Map<string, Row>();
  if (seed) rows.set(JSON.stringify([input.sourceType, input.sourceId]), { ...seed });
  upsert.mockImplementation(async ({ where, create, update }) => {
    const key = JSON.stringify([where.sourceType_sourceId.sourceType, where.sourceType_sourceId.sourceId]);
    const prior = rows.get(key);
    if (prior) {
      const count = prior.recurrenceCount + (update.recurrenceCount?.increment ?? 0);
      Object.assign(prior, update, { recurrenceCount: count });
      return { ...prior };
    }
    const row = { recurrenceCount: 1, backlogItemId: null, ...create } as Row;
    rows.set(key, row);
    return { ...row };
  });
  update.mockImplementation(async ({ where, data }) => {
    const key = JSON.stringify([where.sourceType_sourceId.sourceType, where.sourceType_sourceId.sourceId]);
    const row = rows.get(key);
    if (!row) throw new Error("missing signal");
    const count = row.recurrenceCount + (data.recurrenceCount?.increment ?? 0);
    Object.assign(row, data, { recurrenceCount: count });
    return { ...row };
  });
  return rows;
}

describe("createOrTouchImprovementSignal", () => {
  beforeEach(() => { upsert.mockReset(); update.mockReset(); ingestBacklogItem.mockReset(); });

  it.each(["workroom-flow-bottleneck", "curator-finding"])("preserves existing persistent-observer intake for %s", async (sourceType) => {
    const rows = memoryStore();
    ingestBacklogItem.mockResolvedValue({ itemId: "BI-PERSISTENT" });
    const observation = { ...input, sourceType };
    await createOrTouchImprovementSignal(observation);
    await createOrTouchImprovementSignal(observation);
    expect(ingestBacklogItem).not.toHaveBeenCalled();
    expect(await createOrTouchImprovementSignal(observation)).toMatchObject({ backlogItemId: "BI-PERSISTENT", isNew: false });
    await createOrTouchImprovementSignal(observation);
    expect(ingestBacklogItem).toHaveBeenCalledTimes(1);
    expect([...rows.values()][0]?.recurrenceCount).toBe(4);
  });

  it("recovers one unique-key collision using the same source identity", async () => {
    memoryStore({ signalId: "IS-WINNER", recurrenceCount: 1, backlogItemId: null, evidence: {}, title: input.title });
    upsert.mockRejectedValueOnce(Object.assign(new Error("unique collision"), { code: "P2002" }));
    expect(await createOrTouchImprovementSignal(input)).toEqual({ signalId: "IS-WINNER", isNew: false });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastSeenAt: expect.any(Date) } }));
  });

  it("does not claim collision recovery when the exact source winner is absent", async () => {
    memoryStore();
    upsert.mockRejectedValueOnce(Object.assign(new Error("unique collision"), { code: "P2002" }));
    await expect(createOrTouchImprovementSignal(input)).rejects.toThrow("missing signal");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(ingestBacklogItem).not.toHaveBeenCalled();
  });

  it("keeps failed observer intake available for a later projection", async () => {
    memoryStore();
    const fileBacklogItem = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ itemId: "BI-RECOVERED" });
    const observation = { ...input, sourceType: "workroom-flow-bottleneck" };
    for (let n = 0; n < 3; n += 1) await createOrTouchImprovementSignal(observation, { fileBacklogItem });
    expect(fileBacklogItem).toHaveBeenCalledTimes(1);
    expect(await createOrTouchImprovementSignal(observation, { fileBacklogItem })).toMatchObject({ backlogItemId: "BI-RECOVERED" });
    await createOrTouchImprovementSignal(observation, { fileBacklogItem });
    expect(fileBacklogItem).toHaveBeenCalledTimes(2);
  });

  it("does not turn ten deliveries of one source into independent recurrence or backlog work", async () => {
    const rows = memoryStore({ signalId: "IS-REPLAY", recurrenceCount: 1, backlogItemId: null, evidence: {}, title: input.title });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await createOrTouchImprovementSignal(input);
      expect(result).toEqual({ signalId: "IS-REPLAY", isNew: false });
    }
    expect([...rows.values()][0]?.recurrenceCount).toBe(1);
    expect(ingestBacklogItem).not.toHaveBeenCalled();
  });

  it("creates a source with its original evidence and attribution", async () => {
    const rows = memoryStore();
    const result = await createOrTouchImprovementSignal({ ...input, evidence: { count: 3 }, agentId: "AGT-1", threadId: "thread-1", routeContext: "/customer" });
    expect(result.isNew).toBe(true);
    expect([...rows.values()]).toEqual([expect.objectContaining({ signalId: result.signalId, evidence: { count: 3 }, agentId: "AGT-1", threadId: "thread-1", routeContext: "/customer", recurrenceCount: 1 })]);
  });

  it("preserves evidence, title and ambiguous historical counts rather than backfilling or filing", async () => {
    const original = { signalId: "IS-OLD", recurrenceCount: 37, backlogItemId: null, evidence: { original: true }, title: "Original" };
    const rows = memoryStore(original);
    await createOrTouchImprovementSignal({ ...input, evidence: { replacement: true } });
    expect([...rows.values()][0]).toEqual(expect.objectContaining(original));
    expect([...rows.values()][0]).toHaveProperty("lastSeenAt", expect.any(Date));
    expect(ingestBacklogItem).not.toHaveBeenCalled();
  });

  it("returns an existing backlink without re-filing", async () => {
    memoryStore({ signalId: "IS-LINKED", recurrenceCount: 8, backlogItemId: "BI-EXISTING", evidence: {}, title: input.title });
    expect(await createOrTouchImprovementSignal(input)).toEqual({ signalId: "IS-LINKED", isNew: false, backlogItemId: "BI-EXISTING" });
    expect(ingestBacklogItem).not.toHaveBeenCalled();
  });

  it("adapter-simulated concurrent deliveries converge on one identity and one new result", async () => {
    const rows = memoryStore();
    const results = await Promise.all(Array.from({ length: 10 }, () => createOrTouchImprovementSignal(input)));
    expect(rows.size).toBe(1);
    expect(new Set(results.map((r) => r.signalId)).size).toBe(1);
    expect(results.filter((r) => r.isNew)).toHaveLength(1);
    expect([...rows.values()][0]?.recurrenceCount).toBe(1);
  });

  it("keeps different source identities distinct", async () => {
    const rows = memoryStore();
    await createOrTouchImprovementSignal(input);
    await createOrTouchImprovementSignal({ ...input, sourceId: "PIR-TWO" });
    await createOrTouchImprovementSignal({ ...input, sourceType: "user_correction" });
    expect(rows.size).toBe(3);
  });

  it("propagates persistence failure without claiming a recorded signal", async () => {
    upsert.mockRejectedValue(new Error("database unavailable"));
    await expect(createOrTouchImprovementSignal(input)).rejects.toThrow("database unavailable");
  });
});
