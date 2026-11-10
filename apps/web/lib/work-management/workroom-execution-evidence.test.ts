import { describe, expect, it, vi } from "vitest";
import { loadWorkroomExecutionEvidence } from "./workroom-execution-evidence";
vi.mock("@dpf/db", () => ({ prisma: {}, Prisma: {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  join: (values: unknown[]) => values,
} }));

const now = new Date("2026-09-21T00:00:00Z");
const rooms = [{ id: "room-row", capsuleId: "WC-ROOM" }];
const event = (id: string) => ({ id, workCapsuleId: "room-row", kind: "verification",
  summary: "Recorded check", recordedAt: now });

function evidenceQueries(requirementRows: Record<string, unknown>[] = []) {
  return vi.fn().mockImplementation(async (query: TemplateStringsArray | { strings: readonly string[] }) => {
    const parts = Array.isArray(query) ? query : (query as { strings: readonly string[] }).strings;
    const sql = parts.join("");
    if (sql.includes("WITH rooms AS")) return [];
    if (sql.includes("SELECT receipt.* FROM (VALUES")) return requirementRows;
    throw new Error("Unexpected SQL category in execution evidence fixture");
  });
}

describe("loadWorkroomExecutionEvidence", () => {
  it("retains current-source requirement evidence beyond the recent activity window", async () => {
    const room = { ...rooms[0], repositoryFullName: "org/repo", headSha: "a".repeat(40),
      scopeClaims: [{ workShape: "delivery-medium@1.0.0" }] };
    const receipt = { ...event("older-required-receipt"), kind: "evidence-recorded", payload: {
      kind: "pr-gate", stageKey: "implement", outcome: "completed",
      sourceBinding: { version: 1, capsuleId: room.capsuleId, repositoryFullName: room.repositoryFullName,
        headSha: room.headSha, definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate" },
    } };
    const recent = Array.from({ length: 21 }, (_, i) => ({ ...event(`newer-${i}`), kind: "note" }));
    const db = { workroomActivity: { findMany: vi.fn().mockResolvedValue(recent) },
      $queryRaw: evidenceQueries([receipt]) };
    const result = await loadWorkroomExecutionEvidence(db, [room], now);
    expect(result.activities).toHaveLength(20);
    expect(result.partial).toBe(true);
    expect(result.receipts).toEqual([expect.objectContaining({ status: "observed", rawRef: {
      table: "WorkroomActivity", id: receipt.id }, processEvidence: {
      definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate", relationship: "required-evidence",
    } })]);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    const candidateQuery = db.$queryRaw.mock.calls.find(([query]) => Array.isArray(query));
    const requirementQuery = db.$queryRaw.mock.calls.find(([query]) => !Array.isArray(query));
    expect(candidateQuery?.[0].join("")).toContain("WITH rooms AS");
    expect(candidateQuery?.slice(1)).toEqual([["WC-ROOM"]]);
    expect(requirementQuery?.[0].strings.join("")).toContain("SELECT receipt.* FROM (VALUES");
    expect(requirementQuery?.[0].values[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ values: ["room-row", expect.stringContaining('"capsuleId":"WC-ROOM"')] }),
    ]));
    // The same immutable receipt in both lanes is shown once.
    db.workroomActivity.findMany.mockResolvedValue([receipt]);
    expect((await loadWorkroomExecutionEvidence(db, [room], now)).receipts).toHaveLength(1);
    // The adapter still rejects stale source and foreign-room bindings.
    expect((await loadWorkroomExecutionEvidence(db, [{ ...room, headSha: "b".repeat(40) }], now))
      .receipts.every(receipt => !receipt.processEvidence)).toBe(true);
    expect((await loadWorkroomExecutionEvidence(db, [{ ...room, id: "other-row", capsuleId: "WC-OTHER" }], now))
      .receipts.every(receipt => !receipt.processEvidence)).toBe(true);
    db.$queryRaw.mockRejectedValue(new Error("source unavailable"));
    const unavailable = await loadWorkroomExecutionEvidence(db, [room], now);
    expect(unavailable.partial).toBe(true);
    expect(unavailable.receipts).toHaveLength(1);
  });

  it("binds a journal record to its current versioned requirement without granting a verdict", async () => {
    const room = { ...rooms[0], repositoryFullName: "org/repo", headSha: "a".repeat(40),
      scopeClaims: [{ workShape: "delivery-medium@1.0.0" }] };
    const row = { ...event("bound-1"), kind: "evidence-recorded", payload: {
      kind: "pr-gate", stageKey: "implement", outcome: "completed",
      sourceBinding: { version: 1, capsuleId: "WC-ROOM", repositoryFullName: "org/repo",
        headSha: room.headSha, definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate" },
    } };
    const db = { workroomActivity: { findMany: vi.fn().mockResolvedValue([row]) },
      $queryRaw: evidenceQueries() };
    const result = await loadWorkroomExecutionEvidence(db, [room], now);
    expect(result.receipts[0]).toMatchObject({ status: "observed", processEvidence: {
      definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate", relationship: "required-evidence",
    } });
    const stale = await loadWorkroomExecutionEvidence(db, [{ ...room, headSha: "b".repeat(40) }], now);
    expect(stale.receipts[0].processEvidence).toBeUndefined();
    expect(stale.receipts[0].status).toBe("observed");
  });
  it("does not read unrelated execution when there are no rooms", async () => {
    const findMany = vi.fn();
    const queryRaw = evidenceQueries();
    const result = await loadWorkroomExecutionEvidence({ workroomActivity: { findMany }, $queryRaw: queryRaw }, [], now);
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(result).toMatchObject({ activities: [], receipts: [], partial: false });
  });

  it("marks truncated history partial and keeps a bounded observed evidence window", async () => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 21 }, (_, i) => event(`event-${i}`)));
    const result = await loadWorkroomExecutionEvidence({ workroomActivity: { findMany },
      $queryRaw: evidenceQueries() }, rooms, now);
    expect(findMany).toHaveBeenCalledWith({ where: { workCapsuleId: { in: ["room-row"] } },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 21 });
    expect(result.partial).toBe(true);
    expect(result.activities).toHaveLength(20);
    expect(result.receipts).toHaveLength(20);
    expect(result.receipts.every(receipt => receipt.status === "observed")).toBe(true);
    expect(result.receipts[0].sourceRef.id).toBe("WC-ROOM");
  });

  it("preserves journal evidence when the reviewer source fails", async () => {
    const queryRaw = evidenceQueries().mockRejectedValue(new Error("unavailable"));
    const result = await loadWorkroomExecutionEvidence({
      workroomActivity: { findMany: vi.fn().mockResolvedValue([event("event-1")]) },
      $queryRaw: queryRaw,
    }, rooms, now);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw.mock.calls[0]?.[0].join("")).toContain("WITH rooms AS");
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([["WC-ROOM"]]);
    expect(result.partial).toBe(true);
    expect(result.receipts).toHaveLength(1);
    expect(result.attentionReason).toContain("could not be read");
  });

  it("distinguishes an unavailable journal from a successfully read empty history", async () => {
    const queryRaw = evidenceQueries();
    expect((await loadWorkroomExecutionEvidence({ $queryRaw: queryRaw }, rooms, now)).partial).toBe(true);
    expect((await loadWorkroomExecutionEvidence({ $queryRaw: queryRaw,
      workroomActivity: { findMany: vi.fn().mockResolvedValue([]) } }, rooms, now)).partial).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const call of queryRaw.mock.calls) {
      expect(call[0].join("")).toContain("WITH rooms AS");
      expect(call.slice(1)).toEqual([["WC-ROOM"]]);
    }
    // Missing the new query port must still fail closed, independently of an empty journal.
    expect((await loadWorkroomExecutionEvidence({
      workroomActivity: { findMany: vi.fn().mockResolvedValue([]) },
    }, rooms, now)).partial).toBe(true);
  });
});
