import { describe, it, expect } from "vitest";
import { buildFilterSql, hashToNumber } from "./pgvector-store";

describe("pgvector-store buildFilterSql (Qdrant filter DSL → SQL)", () => {
  it("returns empty string for an empty filter", () => {
    const params: unknown[] = [];
    expect(buildFilterSql({}, params)).toBe("");
    expect(params).toEqual([]);
  });

  it("translates a single must/match:value to scalar-or-array equality", () => {
    const params: unknown[] = ["seed"];
    const sql = buildFilterSql(
      { must: [{ key: "entityId", match: { value: "pg-1" } }] },
      params,
    );
    expect(sql).toBe(
      "AND (payload->'entityId' = $2::jsonb OR payload->'entityId' @> $2::jsonb)",
    );
    // JSON-encoded so scalar equality and array-containment both work.
    expect(params[1]).toBe('"pg-1"');
  });

  it("ANDs multiple must clauses", () => {
    const params: unknown[] = [];
    const sql = buildFilterSql(
      {
        must: [
          { key: "entityType", match: { value: "wiki" } },
          { key: "status", match: { value: "published" } },
        ],
      },
      params,
    );
    expect(sql).toContain(" AND ");
    expect(sql.startsWith("AND ")).toBe(true);
    expect(params).toEqual(['"wiki"', '"published"']);
  });

  it("translates match:{any} to an OR of containment checks", () => {
    const params: unknown[] = [];
    const sql = buildFilterSql(
      { must: [{ key: "pageKind", match: { any: ["stance", "heuristic"] } }] },
      params,
    );
    expect(sql).toContain(" OR ");
    expect(params).toEqual(['"stance"', '"heuristic"']);
  });

  it("wraps should clauses in an OR group", () => {
    const params: unknown[] = [];
    const sql = buildFilterSql(
      {
        should: [
          { key: "ring", match: { value: "a" } },
          { key: "ring", match: { value: "b" } },
        ],
      },
      params,
    );
    // should → single OR-grouped clause
    expect(sql).toMatch(/^AND \(.* OR .*\)$/);
  });

  it("negates must_not clauses (AND of NOTs) so excluded rows drop out", () => {
    const params: unknown[] = [];
    const sql = buildFilterSql(
      {
        must: [{ key: "userId", match: { value: "u1" } }],
        must_not: [{ key: "threadId", match: { value: "t1" } }],
      },
      params,
    );
    // must first, then the negated must_not clause.
    expect(sql).toContain("NOT (payload->'threadId'");
    expect(sql).toMatch(/AND .*userId.* AND NOT /);
    expect(params).toEqual(['"u1"', '"t1"']);
  });

  it("supports must_not with no must (pure exclusion)", () => {
    const params: unknown[] = [];
    const sql = buildFilterSql(
      { must_not: [{ key: "threadId", match: { value: "t1" } }] },
      params,
    );
    expect(sql.startsWith("AND NOT ")).toBe(true);
    expect(params).toEqual(['"t1"']);
  });

  it("translates match:{value:null} to absent-or-json-null", () => {
    const params: unknown[] = [];
    const sql = buildFilterSql(
      { must: [{ key: "parent", match: { value: null } }] },
      params,
    );
    expect(sql).toContain("NOT (payload ? 'parent')");
    expect(sql).toContain("'null'::jsonb");
    expect(params).toEqual([]); // null needs no bound param
  });

  it("escapes single quotes in keys (no SQL injection via key)", () => {
    const params: unknown[] = [];
    const sql = buildFilterSql(
      { must: [{ key: "o'brien", match: { value: "x" } }] },
      params,
    );
    expect(sql).toContain("payload->'o''brien'");
  });
});

describe("pgvector-store hashToNumber (parity with qdrant.ts)", () => {
  it("is deterministic and non-negative", () => {
    expect(hashToNumber("wiki-page:BI-1")).toBe(hashToNumber("wiki-page:BI-1"));
    expect(hashToNumber("anything")).toBeGreaterThanOrEqual(0);
  });
});
