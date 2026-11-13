import { clampToolResultForModel, DEFAULT_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import type { ToolResult } from "@/lib/mcp-tool-types";

// BI-3CE72645: this is an explicit metadata/selected-value view. It never
// consumes the legacy raw-log cursor on behalf of evidence the caller did not see.
const PAGE_LIMIT = 20;
const DETAIL_BYTES = 2_048;
const PAGE_CHARS = DEFAULT_TOOL_RESULT_CHAR_CAP - 600;
type Row = { id: string; sequence: number | null; kind: string; summary: string;
  summaryShortened: boolean; identityOversized?: boolean; recordedAt: Date | string;
  recordedById: string | null; recordedByAgentId: string | null; toolExecutionId: string | null;
  value?: unknown; valueText?: string | null; valueExists?: boolean; valueOversized?: boolean; valueType?: string };
type Reader = {
  db: { $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> };
  room: { id: string; capsuleId: string; activitySequence: number };
  canRead(): Promise<boolean>;
  hasLegacy(): Promise<boolean>;
};

const position = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function fits(result: ToolResult) {
  const serialized = JSON.stringify(result);
  return serialized.length <= PAGE_CHARS && Buffer.byteLength(serialized, "utf8") <= PAGE_CHARS
    && !clampToolResultForModel(result, { maxChars: PAGE_CHARS, toolName: "get_workroom" }).truncated;
}

function refusal(error: string, message: string, capsuleId: string, afterSequence = 0): ToolResult {
  return { success: false, error, message, data: {
    page: { version: 1, readKind: "workroom-activity", disposition: "refused" },
    log: { nextAfterSequence: afterSequence, incomplete: true },
    recovery: { toolName: "get_workroom", arguments: { capsuleId, activityMode: "bounded", afterSequence } },
  } };
}

function validDetail(params: Record<string, unknown>) {
  return typeof params.activityId === "string" && params.activityId.length > 0 && params.activityId.length <= 200
    && (params.activityField === undefined || params.activityField === "payload" || params.activityField === "summary")
    && (params.payloadPath === undefined || (Array.isArray(params.payloadPath) && params.payloadPath.length <= 16
      && params.payloadPath.every(key => typeof key === "string" && key.length <= 200)))
    && !(params.activityField === "summary" && params.payloadPath !== undefined);
}

async function selectedValueIsExact(db: Reader["db"], row: Row) {
  const decodedText = JSON.stringify(row.value);
  if (typeof row.valueText !== "string" || typeof decodedText !== "string"
    || Buffer.byteLength(row.valueText, "utf8") > DETAIL_BYTES || Buffer.byteLength(decodedText, "utf8") > DETAIL_BYTES) return false;
  // Compare the selected snapshot, not a second activity read. PostgreSQL JSONB
  // equality preserves numeric meaning that a JavaScript decoder may round.
  const proof = await db.$queryRaw`SELECT ${row.valueText}::jsonb = ${decodedText}::jsonb AS "exact"`;
  return (proof[0] as { exact?: boolean } | undefined)?.exact === true;
}

/** All SQL values are bound parameters. No full payload is selected by the metadata query. */
export async function readBoundedActivity(reader: Reader, params: Record<string, unknown>): Promise<ToolResult> {
  const { db, room } = reader;
  const after = params.afterSequence ?? 0;
  const through = params.throughSequence ?? room.activitySequence;
  const limit = params.activityLimit ?? 5;
  const detail = params.activityId !== undefined;
  const invalid = !position(after) || !position(through) || (through as number) > room.activitySequence
    || (after as number) > (through as number) || !position(limit) || (limit as number) < 1 || (limit as number) > PAGE_LIMIT
    || (detail ? !validDetail(params) : params.payloadPath !== undefined || params.activityField !== undefined);
  if (invalid) return refusal("invalid_activity_read", "Use valid sequence bounds, activityLimit 1..20, and an exact activityId for detail.", room.capsuleId);
  const afterSequence = after as number;
  if (!await reader.canRead()) return refusal("workroom_content_access_required", "Current content admission is required.", room.capsuleId, afterSequence);

  if (detail) {
    // JSON path elements are JSON-encoded as one SQL parameter, never SQL code.
    // A bounded selected node still passes the normal classifier/mask/sanitizer;
    // encoding raw fragments here would hide sensitive values from that boundary.
    const path = JSON.stringify(params.payloadPath ?? []);
    const summary = params.activityField === "summary";
    const rows = await db.$queryRaw`
      WITH selected AS (
        SELECT left("id", 201) AS "id", "sequence", left("kind", 129) AS "kind",
          (length("id") > 200 OR length("kind") > 128) AS "identityOversized",
          CASE WHEN ${summary} THEN to_jsonb("summary")
            ELSE "payload" #> ARRAY(SELECT jsonb_array_elements_text(${path}::jsonb)) END AS "value"
        FROM "WorkCapsuleActivity" WHERE "workCapsuleId" = ${room.id} AND "id" = ${params.activityId}
      )
      SELECT "id", "sequence", "kind", "identityOversized", "value" IS NOT NULL AS "valueExists", jsonb_typeof("value") AS "valueType",
        COALESCE(octet_length("value"::text) > ${DETAIL_BYTES}, false) AS "valueOversized",
        CASE WHEN octet_length("value"::text) <= ${DETAIL_BYTES} THEN "value" ELSE NULL END AS "value",
        CASE WHEN octet_length("value"::text) <= ${DETAIL_BYTES} THEN "value"::text ELSE NULL END AS "valueText"
      FROM selected` as Row[];
    if (!await reader.canRead()) return refusal("workroom_content_access_required", "Current content admission is required.", room.capsuleId, afterSequence);
    const row = rows[0];
    if (!row) return refusal("activity_not_found", "No readable activity with that ID exists in this Workroom.", room.capsuleId, afterSequence);
    if (row.identityOversized) return refusal("activity_identity_budget_exceeded", "Exact activity identity cannot fit; no shortened identity is reported.", room.capsuleId, afterSequence);
    if (!row.valueExists) return refusal("activity_value_not_found", "The selected payload path does not exist.", room.capsuleId, afterSequence);
    if (row.valueOversized) return refusal("activity_value_budget_exceeded",
      row.valueType === "object" || row.valueType === "array"
        ? "The selected value exceeds the detail budget. Select a narrower payloadPath; this value has not been delivered."
        : "The oversized scalar is retained but undelivered. No bounded scalar reader is available; do not repeat the same read or infer complete evidence.",
      room.capsuleId, afterSequence);
    const exact = await selectedValueIsExact(db, row);
    if (!await reader.canRead()) return refusal("workroom_content_access_required", "Current content admission is required.", room.capsuleId, afterSequence);
    if (!exact) return refusal("activity_value_precision_unsupported",
      "The selected value cannot be delivered without changing its JSON numeric meaning. It remains retained but undelivered. No exact scalar reader is available; do not infer complete evidence.",
      room.capsuleId, afterSequence);
    const result: ToolResult = { success: true, message: "Selected activity value; this is not a full activity receipt.", data: {
      capsuleId: room.capsuleId, activity: { id: row.id, sequence: row.sequence, kind: row.kind },
      detail: { field: summary ? "summary" : "payload", path: params.payloadPath ?? [], value: row.value,
        representation: "selected-value", selectedValueComplete: true, fullActivityDelivered: false },
      page: { version: 1, readKind: "workroom-activity", disposition: "detail" },
    } };
    return fits(result) ? result : refusal("activity_page_budget_exceeded", "The selected value and exact identity cannot fit this envelope. No partial value is returned.", room.capsuleId, afterSequence);
  }

  const rows = await db.$queryRaw`
    SELECT left("id", 201) AS "id", "sequence", left("kind", 129) AS "kind",
      left("summary", 512) AS "summary", length("summary") > 512 AS "summaryShortened",
      "recordedAt", left("recordedById", 201) AS "recordedById",
      left("recordedByAgentId", 201) AS "recordedByAgentId", left("toolExecutionId", 201) AS "toolExecutionId",
      (length("id") > 200 OR length("kind") > 128 OR length("recordedById") > 200
        OR length("recordedByAgentId") > 200 OR length("toolExecutionId") > 200) IS TRUE AS "identityOversized"
    FROM "WorkCapsuleActivity"
    WHERE "workCapsuleId" = ${room.id} AND "sequence" > ${afterSequence} AND "sequence" <= ${through}
    ORDER BY "sequence" ASC LIMIT ${(limit as number) + 1}` as Row[];
  const legacyRowsPresent = await reader.hasLegacy();
  if (!await reader.canRead()) return refusal("workroom_content_access_required", "Current content admission is required.", room.capsuleId, afterSequence);
  const selected: Record<string, unknown>[] = [];
  const envelope = (gap = false): ToolResult => {
    const last = selected.length ? selected.at(-1)!.sequence as number : afterSequence;
    const hasMore = gap || last < (through as number);
    return { success: true, message: "Workroom activity metadata; payload evidence is deferred to detail reads.", data: {
      capsuleId: room.capsuleId,
      log: { afterSequence, throughSequence: through, nextAfterSequence: gap ? afterSequence : last,
        activity: gap ? [] : selected, hasMore, representation: "metadata", payloadsDelivered: false,
        coverage: "sequenced-activity", legacyRowsPresent, incomplete: gap || legacyRowsPresent,
        ...(gap ? { reason: "sequence-gap" } : {}), metadataRangeComplete: !hasMore },
      page: { version: 1, readKind: "workroom-activity", disposition: gap ? "incomplete" : hasMore ? "more" : "complete" },
    } };
  };
  for (const row of rows.slice(0, limit as number)) {
    const expected = afterSequence + selected.length + 1;
    if (row.sequence !== expected) return envelope(true);
    if (row.identityOversized) return refusal("activity_identity_budget_exceeded", "Exact activity identity cannot fit; the cursor is unchanged.", room.capsuleId, afterSequence);
    const { value: _value, valueText: _text, valueExists: _exists, valueOversized: _oversized, identityOversized: _identity, ...metadata } = row;
    const projected = { ...metadata, payloadDeferred: true,
      detail: { toolName: "get_workroom", arguments: { capsuleId: room.capsuleId, activityMode: "bounded", activityId: row.id } } };
    selected.push(projected);
    if (!fits(envelope())) {
      selected.pop();
      if (selected.length) break;
      const { summary: _summary, summaryShortened: _shortened, ...identity } = projected;
      selected.push({ ...identity, summaryDeferred: true, summaryDetail: { toolName: "get_workroom",
        arguments: { capsuleId: room.capsuleId, activityMode: "bounded", activityId: row.id, activityField: "summary" } } });
      if (!fits(envelope())) selected.pop();
      break;
    }
  }
  if (!selected.length && rows.length) return refusal("activity_page_budget_exceeded", "Exact metadata cannot fit; the cursor is unchanged.", room.capsuleId, afterSequence);
  if (rows.length <= (limit as number) && selected.length === rows.length
    && (selected.at(-1)?.sequence ?? afterSequence) !== through) return envelope(true);
  const result = envelope();
  return fits(result) ? result : refusal("activity_page_budget_exceeded", "Exact metadata cannot fit; the cursor is unchanged.", room.capsuleId, afterSequence);
}
