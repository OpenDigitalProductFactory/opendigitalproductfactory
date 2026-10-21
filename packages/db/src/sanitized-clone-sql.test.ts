import { describe, expect, it } from "vitest";

import {
  buildSanitizedInsertStatements,
  prepareInsertParameter,
  quoteIdentifier,
  type ColumnTypeInfo,
  type SanitizedInsertPolicy,
} from "./sanitized-clone-sql";

const types = new Map<string, ColumnTypeInfo>();
const build = (rows: Record<string, unknown>[], policy?: Partial<SanitizedInsertPolicy>) =>
  [...buildSanitizedInsertStatements("Example", rows, types, policy)];

describe("bounded sanitized insert SQL", () => {
  it("inserts an entire 50-row cursor batch with one statement, preserving first-conflict order", () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({ id: index < 2 ? "duplicate" : String(index), value: `value-${index}` }));
    const result = build(rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.values).toEqual(rows.flatMap(row => [row.id, row.value]));
    expect(result[0]!.sql).toMatch(/^INSERT INTO "Example" \("id", "value"\) VALUES \(\$1, \$2\), \(\$3, \$4\)/);
    expect(result[0]!.sql).toContain("($99, $100) ON CONFLICT DO NOTHING");
  });

  it("starts fresh placeholders when the default 50-row limit splits 51 rows", () => {
    const result = build(Array.from({ length: 51 }, (_, id) => ({ id })));
    expect(result.map(statement => statement.values.length)).toEqual([50, 1]);
    expect(result[1]).toEqual({ sql: 'INSERT INTO "Example" ("id") VALUES ($1) ON CONFLICT DO NOTHING', values: [50] });
  });

  it("splits only contiguous ordered column sets, keeping omitted defaults distinct from null", () => {
    const result = build([
      { id: "first", optional: undefined }, { id: "second", optional: null },
      { id: "third" }, { id: "fourth" },
      { optional: "fifth", id: "fifth" },
      { id: "sixth", optional: "sixth" },
    ]);
    expect(result.map(statement => statement.values)).toEqual([
      ["first", null, "second", null], ["third", "fourth"], ["fifth", "fifth"], ["sixth", "sixth"],
    ]);
    expect(result[1]!.sql).toBe('INSERT INTO "Example" ("id") VALUES ($1), ($2) ON CONFLICT DO NOTHING');
    expect(result[2]!.sql).toContain('("optional", "id")');
  });

  it("obeys the actual parameter count and restarts numbering per statement", () => {
    const result = build([{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 6 }], { maxParameters: 4 });
    expect(result.map(statement => statement.values)).toEqual([[1, 2, 3, 4], [5, 6]]);
    expect(result[1]!.sql).toContain("VALUES ($1, $2)");
  });

  it("accepts a full policy-bound row and refuses one row that exceeds its parameter limit", () => {
    expect(build([{ a: 1, b: 2 }], { maxParameters: 2 })).toHaveLength(1);
    expect(() => build([{ a: 1, b: 2, c: 3 }], { maxParameters: 2 })).toThrow(/parameter/i);
  });

  it("does not allow a single row over PostgreSQL's 65,535-parameter ceiling", () => {
    const row = Object.fromEntries(Array.from({ length: 65_536 }, (_, index) => [`p${index}`, index]));
    expect(() => build([row])).toThrow(/parameter/i);
  });

  it("accepts exactly 65,535 parameters, including values that serialize to SQL null", () => {
    const row = Object.fromEntries(Array.from({ length: 65_535 }, (_, index) => [`p${index}`, index % 2 ? null : undefined]));
    const result = build([row]);
    expect(result).toHaveLength(1);
    expect(result[0]!.values).toHaveLength(65_535);
    expect(result[0]!.values.every(value => value === null)).toBe(true);
    expect(result[0]!.sql).toContain("$65535) ON CONFLICT DO NOTHING");
    expect(result[0]!.sql).not.toContain("$65536");
  });

  it("accepts the maximum 500-row policy and keeps its following row separate", () => {
    const result = build(Array.from({ length: 501 }, (_, id) => ({ id })), { maxRows: 500 });
    expect(result.map(statement => statement.values.length)).toEqual([500, 1]);
  });

  it("counts UTF-8 bytes and flushes only when the payload target would be exceeded", () => {
    const result = build([{ text: "é" }, { text: "é" }, { text: "é" }], { maxPayloadBytes: 4 });
    expect(result.map(statement => statement.values)).toEqual([["é", "é"], ["é"]]);
  });

  it("keeps a byte-oversized row alone, without dropping or rejecting it", () => {
    const result = build([{ text: "x" }, { text: "oversized" }, { text: "y" }], { maxPayloadBytes: 4 });
    expect(result.map(statement => statement.values)).toEqual([["x"], ["oversized"], ["y"]]);
  });

  it("uses the default 1 MiB prepared payload target", () => {
    const text = "x".repeat(524_288);
    const result = build([{ text }, { text }, { text: "tail" }]);
    expect(result.map(statement => statement.values.length)).toEqual([2, 1]);
    expect(result[1]!.values).toEqual(["tail"]);
  });

  it("measures prepared JSON and array literals, not unescaped source strings", () => {
    const columnTypes = new Map<string, ColumnTypeInfo>([["json", { dataType: "jsonb", udtName: "jsonb" }], ["arr", { dataType: "ARRAY", udtName: "_text" }]]);
    const rows = [{ json: "é", arr: ["a"] }, { json: "é", arr: ["b"] }];
    // Each prepared row is 4 bytes of JSON + 5 bytes of the array literal.
    const result = [...buildSanitizedInsertStatements("Example", rows, columnTypes, { maxPayloadBytes: 17 })];
    expect(result.map(statement => statement.values)).toEqual([['"é"', '{"a"}'], ['"é"', '{"b"}']]);
  });

  it("counts buffers as raw bytes, not their JSON representation", () => {
    const a = Buffer.from([0, 1]), b = Buffer.from([2, 3]), c = Buffer.from([4]);
    expect(build([{ payload: a }, { payload: b }, { payload: c }], { maxPayloadBytes: 4 }).map(statement => statement.values)).toEqual([[a, b], [c]]);
  });

  it("counts remaining objects by JSON serialization and primitive strings conservatively", () => {
    const map = new Map<string, ColumnTypeInfo>([["value", { dataType: "USER-DEFINED", udtName: "custom" }]]);
    const result = [...buildSanitizedInsertStatements("Example", [{ value: { a: 1 } }, { value: { a: 2 } }], map, { maxPayloadBytes: 13 })];
    expect(result.map(statement => statement.values)).toEqual([[{ a: 1 }], [{ a: 2 }]]);
    expect(build([{ value: 123 }, { value: false }, { value: null }], { maxPayloadBytes: 8 }).map(statement => statement.values)).toEqual([[123, false], [null]]);
  });

  it("counts Dates conservatively without replacing the exact Date passed to pg", () => {
    const date = new Date("2026-10-21T12:34:56.000Z");
    const result = build([{ value: date }, { value: date }], { maxPayloadBytes: Buffer.byteLength(String(date)) });
    expect(result).toHaveLength(2);
    expect(result[0]!.values[0]).toBe(date);
  });

  it("is lazy and does not prepare every later statement before yielding the first", () => {
    let lateReads = 0;
    const late = { get value() { lateReads++; return "later"; } };
    const generator = buildSanitizedInsertStatements("Example", [{ value: "first" }, { value: "second" }, late], types, { maxRows: 1 });
    expect(lateReads).toBe(0);
    expect(generator.next().value!.values).toEqual(["first"]);
    expect(lateReads).toBe(0);
    expect(generator.next().value!.values).toEqual(["second"]);
    expect(lateReads).toBe(0);
    expect(generator.next().value!.values).toEqual(["later"]);
    expect(lateReads).toBe(1);
  });

  it("emits no SQL for an empty cursor batch", () => {
    expect(build([])).toEqual([]);
  });

  it("validates policy even for an empty cursor batch", () => {
    expect(() => build([], { maxRows: 0 })).toThrow(/policy/i);
  });

  it.each([
    { maxRows: 0 }, { maxRows: 501 }, { maxRows: 1.5 }, { maxRows: Number.NaN },
    { maxParameters: 0 }, { maxParameters: 65_536 }, { maxParameters: Number.POSITIVE_INFINITY }, { maxParameters: 1.5 },
    { maxPayloadBytes: 0 }, { maxPayloadBytes: -1 }, { maxPayloadBytes: 1.5 }, { maxPayloadBytes: Number.NaN },
    { maxPayloadBytes: Number.MAX_SAFE_INTEGER + 1 },
  ])("refuses invalid bounds before producing SQL: %j", policy => {
    expect(() => build([{ value: "bounded" }], policy)).toThrow(/policy|bound|integer/i);
  });
});

describe("existing parameter conversion compatibility", () => {
  it.each([
    [null, undefined, "$7", null], [undefined, undefined, "$7", null],
    [["read", "write"], { dataType: "jsonb", udtName: "jsonb" }, "$7::jsonb", '["read","write"]'],
    [{ a: 1 }, { dataType: "json", udtName: "json" }, "$7::json", '{"a":1}'],
    [[3001, 5433], { dataType: "ARRAY", udtName: "_int4" }, '$7::"int4"[]', '{"3001","5433"}'],
    [["open"], { dataType: "ARRAY", udtName: '_Life"cycle' }, '$7::"Life""cycle"[]', '{"open"}'],
    [["a\\b", 'c"d'], undefined, "$7::text[]", '{"a\\\\b","c\\"d"}'],
    [{ a: [1, 2] }, undefined, "$7::jsonb", '{"a":[1,2]}'],
  ] as const)("preserves placeholder and prepared value for case %#", (value, type, placeholder, prepared) => {
    expect(prepareInsertParameter(value, type, 7)).toEqual({ placeholder, value: prepared });
  });

  it("preserves Decimal-like numeric conversion, Buffer and Date identity", () => {
    const numeric = { toString: () => "12.3400" };
    expect(prepareInsertParameter(numeric, { dataType: "numeric", udtName: "numeric" }, 3)).toEqual({ placeholder: "$3", value: "12.3400" });
    const buffer = Buffer.from([0, 255]), date = new Date("2026-10-21T00:00:00Z");
    expect(prepareInsertParameter(buffer, { dataType: "bytea", udtName: "bytea" }, 4).value).toBe(buffer);
    expect(prepareInsertParameter(date, { dataType: "timestamp without time zone", udtName: "timestamp" }, 5).value).toBe(date);
  });

  it("quotes hostile table/column/catalog identifiers and never places values in SQL", () => {
    const table = 'Data"; DROP TABLE x;--', column = 'value"name', value = "'); DELETE FROM y;--";
    const result = [...buildSanitizedInsertStatements(table, [{ [column]: value }], types)];
    expect(quoteIdentifier(table)).toBe('"Data""; DROP TABLE x;--"');
    expect(result).toEqual([{ sql: 'INSERT INTO "Data""; DROP TABLE x;--" ("value""name") VALUES ($1) ON CONFLICT DO NOTHING', values: [value] }]);
  });

  it("retains per-column casts as parameter numbers advance across rows", () => {
    const map = new Map<string, ColumnTypeInfo>([["doc", { dataType: "jsonb", udtName: "jsonb" }], ["ports", { dataType: "ARRAY", udtName: "_int4" }]]);
    const result = [...buildSanitizedInsertStatements("Example", [{ doc: { a: 1 }, ports: [80] }, { doc: [2], ports: [443] }], map)];
    expect(result).toEqual([{ sql: 'INSERT INTO "Example" ("doc", "ports") VALUES ($1::jsonb, $2::"int4"[]), ($3::jsonb, $4::"int4"[]) ON CONFLICT DO NOTHING', values: ['{"a":1}', '{"80"}', '[2]', '{"443"}'] }]);
  });
});
