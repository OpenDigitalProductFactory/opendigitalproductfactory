import { describe, it, expect } from "vitest";
import { buildFilterSql, buildLexicalSql, hashToNumber } from "./pgvector-store";

describe("pgvector-store buildFilterSql (filter DSL → SQL)", () => {
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

describe("pgvector-store hashToNumber (stable ids)", () => {
  it("is deterministic and non-negative", () => {
    expect(hashToNumber("wiki-page:BI-1")).toBe(hashToNumber("wiki-page:BI-1"));
    expect(hashToNumber("anything")).toBeGreaterThanOrEqual(0);
  });
});

describe("pgvector-store buildLexicalSql (embedding-free fallback, BI-MCP-EFF-4F823E5B)", () => {
  it("scores each row by how many terms appear in any searched field", () => {
    const { sql, params } = buildLexicalSql("platform-knowledge", ["wiki", "backlinks"], ["title", "contentPreview"], undefined, 5);
    expect(params).toEqual(["platform-knowledge", "%wiki%", "%backlinks%"]);
    expect(sql).toContain("payload->>'title' ILIKE $2");
    expect(sql).toContain("payload->>'contentPreview' ILIKE $3");
    expect(sql).toContain("/ 2.0");
    expect(sql).toContain("LIMIT 5");
  });

  it("treats LIKE wildcards in a term as literal text", () => {
    const { params } = buildLexicalSql("c", ["100%_done\\"], ["title"], undefined, 5);
    expect(params[1]).toBe("%100\\%\\_done\\\\%");
  });

  it("appends the vector filter after the term parameters", () => {
    const { sql, params } = buildLexicalSql("c", ["a"], ["title"], { must: [{ key: "entityType", match: { value: "epic" } }] }, 5);
    expect(params).toEqual(["c", "%a%", '"epic"']);
    expect(sql).toContain("payload->'entityType' = $3::jsonb");
  });
});
