import { describe, expect, it, vi } from "vitest";
import { readBoundedActivity } from "./bounded-activity-read";

const room = { id: "room-row", capsuleId: "WC-1", activitySequence: 251 };
const row = (sequence: number) => ({ id: `activity-${sequence}`, sequence, kind: "evidence-recorded",
  summary: `Evidence ${sequence}`, summaryShortened: false, recordedAt: new Date("2026-10-19T16:00:00Z"),
  recordedById: "user-1", recordedByAgentId: "AGT-EXT-CODEX", toolExecutionId: null });

function fixture(rows = [row(1), row(2)], allowed = true) {
  const query = vi.fn(async () => rows);
  return { query, canRead: vi.fn(async () => allowed), hasLegacy: vi.fn(async () => false),
    db: { $queryRaw: query }, room };
}

describe("bounded Workroom activity read", () => {
  it("returns whole ordered metadata records and usable detail calls without loading raw payloads", async () => {
    const f = fixture();
    const result = await readBoundedActivity(f, { afterSequence: 0, activityLimit: 1 });
    expect(result).toMatchObject({ success: true, data: { log: { afterSequence: 0, throughSequence: 251,
      nextAfterSequence: 1, hasMore: true, representation: "metadata", payloadsDelivered: false,
      activity: [{ id: "activity-1", sequence: 1, detail: { toolName: "get_workroom",
        arguments: { capsuleId: "WC-1", activityMode: "bounded", activityId: "activity-1" } } }] } } });
    const sql = (f.query.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?");
    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).toContain('left("summary"');
    expect(sql).not.toMatch(/SELECT[\s\S]*"payload"/i);
  });

  it("does not read history without current content admission", async () => {
    const f = fixture([], false);
    expect(await readBoundedActivity(f, { afterSequence: 0 })).toMatchObject({ success: false,
      error: "workroom_content_access_required" });
    expect(f.query).not.toHaveBeenCalled();
  });

  it("withholds data if content admission is revoked during the read", async () => {
    const f = fixture();
    f.canRead.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await readBoundedActivity(f, { afterSequence: 0 });
    expect(result).toMatchObject({ success: false, error: "workroom_content_access_required" });
    expect(JSON.stringify(result)).not.toContain("Evidence 1");
  });

  it("reports sequence loss and legacy coverage explicitly instead of claiming full history", async () => {
    const f = fixture([row(3)]);
    f.hasLegacy.mockResolvedValue(true);
    expect(await readBoundedActivity(f, { afterSequence: 0 })).toMatchObject({ data: { log: {
      incomplete: true, reason: "sequence-gap", legacyRowsPresent: true, nextAfterSequence: 0 } } });
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", {}, Infinity])("refuses invalid numeric cursor %j before reading", async afterSequence => {
    const f = fixture();
    expect(await readBoundedActivity(f, { afterSequence })).toMatchObject({ success: false, error: "invalid_activity_read" });
    expect(f.query).not.toHaveBeenCalled();
  });

  it("keeps large exact row identity unadvanced when the minimum envelope cannot fit", async () => {
    const f = fixture([{ ...row(1), id: "x".repeat(6_000) }]);
    expect(await readBoundedActivity(f, { afterSequence: 0 })).toMatchObject({ success: false,
      error: "activity_page_budget_exceeded", data: { log: { nextAfterSequence: 0 } } });
  });

  it("enumerates 251 metadata records once over the same upper bound, with adaptive native-sized pages", async () => {
    const f = fixture();
    const rows = Array.from({ length: 251 }, (_, i) => ({ ...row(i + 1), summary: '"\\\n🙂'.repeat(25) }));
    f.query.mockImplementation(async (...args: unknown[]) => {
      const values = args.slice(1);
      return rows.filter(r => r.sequence > (values[1] as number) && r.sequence <= (values[2] as number))
        .slice(0, values[3] as number);
    });
    const ids: string[] = [];
    let afterSequence = 0;
    for (let page = 0; page < 252; page++) {
      const result = await readBoundedActivity(f, { afterSequence, throughSequence: 251 });
      expect(result.success).toBe(true);
      expect(JSON.stringify(result).length).toBeLessThan(4000);
      const log = (result.data as { log: { activity: { id: string }[]; nextAfterSequence: number; hasMore: boolean } }).log;
      ids.push(...log.activity.map(r => r.id));
      if (!log.hasMore) break;
      expect(log.nextAfterSequence).toBeGreaterThan(afterSequence);
      afterSequence = log.nextAfterSequence;
    }
    expect(ids).toEqual(rows.map(r => r.id));
    expect(new Set(ids).size).toBe(251);
  });

  it("uses a minimal exact record when escaped summary text cannot fit", async () => {
    const f = fixture([{ ...row(1), summary: "\u0001".repeat(512), summaryShortened: true }]);
    f.room.activitySequence = 1;
    const result = await readBoundedActivity(f, { afterSequence: 0 });
    expect(result).toMatchObject({ success: true, data: { log: { nextAfterSequence: 1,
      activity: [{ id: "activity-1", summaryDeferred: true, summaryDetail: { arguments: { activityField: "summary" } } }] } } });
  });

  it("reads an exact selected JSON null distinctly from an absent path", async () => {
    const f = fixture();
    f.query.mockResolvedValue([{ ...row(1), valueExists: true, valueOversized: false, value: null }] as never);
    expect(await readBoundedActivity(f, { activityId: "activity-1", payloadPath: ["result", "decision"] })).toMatchObject({
      success: true, data: { detail: { value: null, selectedValueComplete: true, fullActivityDelivered: false } },
    });
    f.query.mockResolvedValue([{ ...row(1), valueExists: false, value: null }] as never);
    expect(await readBoundedActivity(f, { activityId: "activity-1", payloadPath: ["missing"] })).toMatchObject({
      success: false, error: "activity_value_not_found",
    });
  });

  it("binds the exact room, row and path as SQL values, including hostile-looking keys", async () => {
    const f = fixture();
    f.query.mockResolvedValue([{ ...row(1), valueExists: true, value: { headSha: "1".repeat(40) } }] as never);
    const path = ["'); DROP TABLE x; --", "original"];
    const result = await readBoundedActivity(f, { activityId: "activity-1", payloadPath: path });
    expect(result.success).toBe(true);
    const call = f.query.mock.calls[0] as unknown as unknown[];
    expect((call[0] as TemplateStringsArray).join("?")).not.toContain(path[0]);
    expect(call).toContain(JSON.stringify(path));
    expect(call).toContain("room-row");
    expect(call).toContain("activity-1");
  });

  it("withholds an oversized node and a foreign activity without fabricating full detail", async () => {
    const f = fixture();
    f.query.mockResolvedValue([{ ...row(1), valueExists: true, valueOversized: true, value: null }] as never);
    expect(await readBoundedActivity(f, { activityId: "activity-1" })).toMatchObject({
      success: false, error: "activity_value_budget_exceeded", data: { log: { nextAfterSequence: 0 } },
    });
    f.query.mockResolvedValue([]);
    expect(await readBoundedActivity(f, { activityId: "foreign-row" })).toMatchObject({ success: false, error: "activity_not_found" });
  });

  it.each([
    { activityId: "" }, { activityId: "x".repeat(201) }, { activityId: "x", payloadPath: [3] },
    { activityId: "x", payloadPath: Array(17).fill("key") }, { activityId: "x", activityField: "summary", payloadPath: [] },
    { throughSequence: 252 }, { activityLimit: 21 }, { afterSequence: 10, throughSequence: 9 },
  ])("refuses invalid detail/range %j before querying", async params => {
    const f = fixture();
    expect(await readBoundedActivity(f, params)).toMatchObject({ success: false, error: "invalid_activity_read" });
    expect(f.query).not.toHaveBeenCalled();
  });
});
