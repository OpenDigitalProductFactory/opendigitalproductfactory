import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  RELATION_TYPES,
  RelationTypeError,
  assertRelationWrite,
  getRelationType,
  isGenericRelationName,
  lintRelationVocabulary,
  toRelationType,
  type RelationTypeDef,
} from "./relation-vocabulary";
import { findRelationVocabularyViolations, findUnmigratedRelationTypes } from "./relation-vocabulary-guard";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The 20 rel_type values live on the dev install on 2026-10-27 (design §2.1). */
const LIVE_TYPES = [
  "DEFINES", "IMPORTS", "HAS_FIELD", "TESTED_BY", "BELONGS_TO", "ASSOCIATED_WITH", "DEPENDS_ON",
  "RELATES_TO", "IMPACTS", "IMPLEMENTS_ROUTE", "CATEGORIZED_AS", "MEMBER_OF", "LINKS_TO", "CHILD_OF",
  "HOSTS", "RUNS_ON", "CONNECTS_TO", "MONITORS", "ROUTES_THROUGH", "DOC_REFERENCES",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs|sql)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("relation vocabulary registry (AC-TRV-1)", () => {
  it("is sound: UPPER_SNAKE unique keys, labels, inverse, meaning, domain, range, no generic active name", () => {
    expect(lintRelationVocabulary()).toEqual([]);
  });

  it("registers every rel_type live on the dev install and every MENTIONS writer target", () => {
    for (const key of [...LIVE_TYPES, "MENTIONS", "HAS_FOREIGN_KEY_TO", "PART_OF"]) {
      expect(getRelationType(key), key).toBeDefined();
    }
  });

  it("keeps the generic legacy types out of active use", () => {
    for (const key of ["ASSOCIATED_WITH", "RELATES_TO", "DOC_REFERENCES", "REFERENCES"]) {
      expect(getRelationType(key)?.status, key).not.toBe("active");
    }
  });

  it("flags generic names", () => {
    for (const name of ["ASSOCIATED_WITH", "RELATED_TO", "relates_to", "LINKED_TO", "REFERENCES", "OTHER"]) {
      expect(isGenericRelationName(name), name).toBe(true);
    }
    for (const name of ["LINKS_TO", "DATA_ASSOCIATION", "CONNECTS_TO", "HAS_FIELD", "MENTIONS"]) {
      expect(isGenericRelationName(name), name).toBe(false);
    }
  });

  it("lint refuses a generic active entry and a dangling replacement", () => {
    const bad: RelationTypeDef[] = [
      { key: "RELATED_TO", label: "x", inverseLabel: "x", meaning: "x", relationClass: "semantic", domain: ["A"], range: ["B"], status: "active" },
      { key: "OLD_THING", label: "x", inverseLabel: "x", meaning: "x", relationClass: "semantic", domain: ["A"], range: ["B"], status: "deprecated", replacedBy: "NOWHERE", ownerItem: "BI-1" },
    ];
    expect(lintRelationVocabulary(bad)).toEqual([
      "RELATED_TO: generic relation name",
      "OLD_THING: replacedBy NOWHERE is not registered",
    ]);
  });
});

describe("assertRelationWrite (AC-TRV-2)", () => {
  it("accepts a registered active type", () => {
    expect(assertRelationWrite("DEPENDS_ON").key).toBe("DEPENDS_ON");
  });

  it("refuses an unregistered type", () => {
    expect(() => assertRelationWrite("RELATED_TO")).toThrow(RelationTypeError);
    try {
      assertRelationWrite("RELATED_TO");
    } catch (e) {
      expect((e as RelationTypeError).code).toBe("unregistered");
    }
  });

  it("refuses a retired type and names its replacement", () => {
    expect(() => assertRelationWrite("REFERENCES")).toThrow(/retired; write USES_SYMBOL/);
  });

  it("refuses a missing required prop", () => {
    expect(() => assertRelationWrite("HAS_FOREIGN_KEY_TO", { fieldName: "owner" })).toThrow(/requires prop "fkFields"/);
    expect(assertRelationWrite("HAS_FOREIGN_KEY_TO", { fieldName: "owner", fkFields: "ownerId" }).key).toBe("HAS_FOREIGN_KEY_TO");
  });

  it("refuses a quarantined type without its qualifier", () => {
    const registry = new Map<string, RelationTypeDef>([
      ["WEAK_TRACE", { key: "WEAK_TRACE", label: "traces", inverseLabel: "traced by", meaning: "m", relationClass: "semantic", domain: ["A"], range: ["B"], status: "active", quarantine: { requiredQualifier: "traceKind", allowed: ["refines", "allocates"] } }],
    ]);
    expect(() => assertRelationWrite("WEAK_TRACE", {}, registry)).toThrow(/requires qualifier "traceKind"/);
    expect(() => assertRelationWrite("WEAK_TRACE", { traceKind: "related" }, registry)).toThrow(RelationTypeError);
    expect(assertRelationWrite("WEAK_TRACE", { traceKind: "refines" }, registry).key).toBe("WEAK_TRACE");
  });

  it("toRelationType narrows dynamic strings and refuses unknown or retired ones", () => {
    expect(toRelationType("HOSTS")).toBe("HOSTS");
    expect(() => toRelationType("hosts")).toThrow(RelationTypeError);
    expect(() => toRelationType("REFERENCES")).toThrow(/retired/);
  });
});

describe("relation-vocabulary guard (AC-TRV-3)", () => {
  it("fails a fixture that adds RELATED_TO to a seed and a writer", () => {
    const violations = findRelationVocabularyViolations([
      { path: "packages/db/src/seed-ea-fixture.ts", text: `const t = [\n  { slug: "related", neoType: "RELATED_TO" },\n];` },
      { path: "packages/db/src/sync-fixture.ts", text: `await upsertGraphEdge(a.id, b.id, "RELATED_TO", {});\nawait upsertGraphEdge(a, b, "HOSTS");` },
      { path: "apps/web/lib/build/code-graph/types.ts", text: `export type CodeGraphEdgeKind =\n  | "DEFINES"\n  | "REFERENCES";` },
    ]);
    expect(violations.map((v) => `${v.path} ${v.key}`)).toEqual([
      "packages/db/src/seed-ea-fixture.ts:2 RELATED_TO",
      "packages/db/src/sync-fixture.ts:1 RELATED_TO",
      "apps/web/lib/build/code-graph/types.ts:3 REFERENCES",
    ]);
    expect(violations[0].problem).toMatch(/generic relation name/);
  });

  it("passes on the current tree", () => {
    const files = ["packages/db/src", "apps/web/lib", "apps/web/app", "scripts"].flatMap((d) =>
      walk(join(REPO_ROOT, d)).map((path) => ({ path: relative(REPO_ROOT, path), text: readFileSync(path, "utf8") })),
    );
    expect(files.length).toBeGreaterThan(100);
    expect(findRelationVocabularyViolations(files)).toEqual([]);
  });
});

describe("graph_relation_type migrations (AC-TRV-4)", () => {
  it("insert a row for every registered type, so the FK accepts every registered write", () => {
    const dir = join(REPO_ROOT, "packages/db/prisma/migrations");
    const sql = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        try {
          return readFileSync(join(dir, e.name, "migration.sql"), "utf8");
        } catch {
          return "";
        }
      });
    expect(findUnmigratedRelationTypes(sql)).toEqual([]);
    expect(RELATION_TYPES.length).toBeGreaterThanOrEqual(66);
  });
});
