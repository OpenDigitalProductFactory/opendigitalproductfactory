import { describe, expect, it, vi } from "vitest";
import { readBoundedActivity } from "./bounded-activity-read";
import { clampToolResultForModel } from "@/lib/tak/tool-result-budget";
import type { DataPolicyDecision } from "@/lib/govern/data/policy-decision";

const room = { id: "room-row", capsuleId: "WC-1", activitySequence: 251 };
const row = (sequence: number) => ({ id: `activity-${sequence}`, sequence, kind: "evidence-recorded",
  summary: `Evidence ${sequence}`, summaryShortened: false, recordedAt: new Date("2026-10-19T16:00:00Z"),
  recordedById: "user-1", recordedByAgentId: "AGT-EXT-CODEX", toolExecutionId: null });

function fixture(rows = [row(1), row(2)], allowed = true) {
  const query = vi.fn(async () => rows);
  return { query, canRead: vi.fn(async () => allowed), hasLegacy: vi.fn(async () => false),
    db: { $queryRaw: query }, room: { ...room } };
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
    f.query.mockResolvedValueOnce([{ ...row(1), valueExists: true, valueOversized: false, value: null, valueText: "null" }] as never)
      .mockResolvedValueOnce([{ exact: true }] as never);
    expect(await readBoundedActivity(f, { activityId: "activity-1", payloadPath: ["result", "decision"] })).toMatchObject({
      success: true, data: { detail: { value: null, selectedValueComplete: true, fullActivityDelivered: false } },
    });
    f.query.mockResolvedValue([{ ...row(1), valueExists: false, value: null }] as never);
    expect(await readBoundedActivity(f, { activityId: "activity-1", payloadPath: ["missing"] })).toMatchObject({
      success: false, error: "activity_value_not_found",
    });
  });

  it.each([
    "9007199254740993", "0.1234567890123456789", "1e-400", "1e400",
    '{"nested":[9007199254740993]}',
  ])("withholds a selected value changed by JSON number decoding: %s", async valueText => {
    const f = fixture();
    f.query.mockResolvedValueOnce([{ ...row(1), valueExists: true, valueText, value: JSON.parse(valueText) }] as never)
      .mockResolvedValueOnce([{ exact: false }] as never);
    const result = await readBoundedActivity(f, { activityId: "activity-1", afterSequence: 7 });
    expect(result).toMatchObject({ success: false, error: "activity_value_precision_unsupported",
      data: { log: { nextAfterSequence: 7, incomplete: true } } });
    expect(JSON.stringify(result)).not.toContain("selectedValueComplete");
    expect(JSON.stringify(result)).not.toContain("valueText");
  });

  it.each(["9007199254740992", "0.1", "0", "null", '{"nested":[9007199254740992,0.1]}'])
    ("delivers a typed selected value whose JSON numeric meaning is exact: %s", async valueText => {
      const f = fixture();
      const value = JSON.parse(valueText);
      f.query.mockResolvedValueOnce([{ ...row(1), valueExists: true, value, valueText }] as never)
        .mockResolvedValueOnce([{ exact: true }] as never);
      const result = await readBoundedActivity(f, { activityId: "activity-1" });
      expect(result).toMatchObject({ success: true, data: { detail: { value, selectedValueComplete: true } } });
      expect(JSON.stringify(result)).not.toContain("valueText");
      expect(f.query.mock.calls[1]?.slice(1)).toEqual([valueText, JSON.stringify(value)]);
    });

  it.each([{ proof: [] }, { proof: [{ exact: null }] }, { proof: [{ exact: "true" }] }])("refuses missing or invalid exactness proof %j", async ({ proof }) => {
    const f = fixture();
    f.query.mockResolvedValueOnce([{ ...row(1), valueExists: true, value: 1, valueText: "1" }] as never)
      .mockResolvedValueOnce(proof as never);
    expect(await readBoundedActivity(f, { activityId: "activity-1" })).toMatchObject({
      success: false, error: "activity_value_precision_unsupported",
    });
  });

  it.each([true, false])("rechecks admission after the exactness query, even when exact=%s", async exact => {
    const f = fixture();
    f.query.mockResolvedValueOnce([{ ...row(1), valueExists: true, value: { private: "retained" }, valueText: '{"private":"retained"}' }] as never)
      .mockResolvedValueOnce([{ exact }] as never);
    f.canRead.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await readBoundedActivity(f, { activityId: "activity-1", afterSequence: 7 });
    expect(result).toMatchObject({ success: false, error: "workroom_content_access_required", data: { log: { nextAfterSequence: 7 } } });
    expect(JSON.stringify(result)).not.toContain("retained");
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it("keeps an exact selected object visible to the normal context-mask boundary without exposing internal text", async () => {
    const f = fixture();
    const value = { customerEmail: "ada@example.com", amount: 0.1 };
    f.query.mockResolvedValueOnce([{ ...row(1), valueExists: true, value, valueText: JSON.stringify(value) }] as never)
      .mockResolvedValueOnce([{ exact: true }] as never);
    const result = await readBoundedActivity(f, { activityId: "activity-1" });
    expect(result).toMatchObject({ success: true, data: { detail: { value } } });
    const decision: DataPolicyDecision = {
      decisionId: "decision-selected-value-mask", organizationId: "org-test", inputHash: "input",
      effect: "allow-with-obligations", obligations: [{ kind: "mask", profileId: "default-confidential" }],
      matchedPolicyVersions: ["confidential-projection-mask@1"], assetVersion: "a1", classificationVersion: "c1",
      authorityVersion: "auth1", explanationCode: "confidential-masked-before-projection", replay: "single-use",
    };
    const output = clampToolResultForModel(result, { toolName: "get_workroom", contextMask: {
      decision, detailUse: "replaceable", matches: [{ dataClass: "customer-records",
        path: "data.detail.value.customerEmail", reason: "contact-detail", confidence: "deterministic" }],
    } });
    expect(output.text).not.toContain(value.customerEmail);
    expect(output.text).not.toContain("valueText");
    expect(output.text).toContain("[DPF_TOKEN_");
    expect(output.truncated).toBe(false);
  });

  it("binds the exact room, row and path as SQL values, including hostile-looking keys", async () => {
    const f = fixture();
    const value = { headSha: "1".repeat(40) };
    f.query.mockResolvedValueOnce([{ ...row(1), valueExists: true, value, valueText: JSON.stringify(value) }] as never)
      .mockResolvedValueOnce([{ exact: true }] as never);
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
