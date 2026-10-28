// packages/db/src/relation-vocabulary-guard.ts
// Source scan behind the relation-vocabulary guard (BI-85389A35). Pure: callers
// pass file paths and text, so the same check runs over the real tree in CI and
// over fixtures in tests.

import { getRelationType, isGenericRelationName, RELATION_TYPES } from "./relation-vocabulary";

export type SourceFile = { path: string; text: string };
export type RelationVocabularyViolation = { path: string; key: string; problem: string };

/** Relation-type literals that reach graph_edge, by where they appear. */
const LITERAL_SITES: Array<{ name: string; applies: (path: string) => boolean; pattern: RegExp }> = [
  // EaRelationshipType seeds: neoType is projected verbatim into graph_edge.
  { name: "EA neoType", applies: (p) => /seed-ea-[^/]*\.ts$/.test(p), pattern: /neoType:\s*"([^"]+)"/g },
  // Direct writers.
  {
    name: "upsertGraphEdge literal",
    applies: (p) => /\.(ts|tsx|mts|mjs)$/.test(p),
    pattern: /upsertGraphEdge\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*[^,()]+(?:\([^()]*\))?\s*,\s*"([^"]+)"/g,
  },
  // Inline SQL writers.
  {
    name: "graph_edge INSERT literal",
    applies: (p) => /\.(ts|tsx|mts|mjs|sql)$/.test(p),
    pattern: /INSERT INTO graph_edge[^;]*?VALUES\s*\([^,]+,\s*[^,]+,\s*'([^']+)'/g,
  },
];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function codeGraphEdgeKinds(text: string): Array<{ key: string; index: number }> {
  const block = /export type CodeGraphEdgeKind\s*=([^;]+);/.exec(text);
  if (!block) return [];
  const out: Array<{ key: string; index: number }> = [];
  const bodyStart = block.index + block[0].indexOf(block[1]);
  for (const m of block[1].matchAll(/"([^"]+)"/g)) out.push({ key: m[1], index: bodyStart + (m.index ?? 0) });
  return out;
}

function check(path: string, key: string, line: number, site: string, out: RelationVocabularyViolation[]): void {
  const where = `${path}:${line}`;
  const def = getRelationType(key);
  if (!def) {
    out.push({
      path: where,
      key,
      problem: isGenericRelationName(key)
        ? `${site} "${key}" is a generic relation name; name what the relation means`
        : `${site} "${key}" is not in the relation vocabulary`,
    });
  } else if (def.status === "retired") {
    out.push({ path: where, key, problem: `${site} "${key}" is retired${def.replacedBy ? `; use ${def.replacedBy}` : ""}` });
  }
}

/** Every relation-type literal in `files` must be a registered, non-retired key. */
export function findRelationVocabularyViolations(files: readonly SourceFile[]): RelationVocabularyViolation[] {
  const out: RelationVocabularyViolation[] = [];
  for (const file of files) {
    const path = file.path.replace(/\\/g, "/");
    if (/\.test\.|__tests__|relation-vocabulary/.test(path)) continue;
    for (const site of LITERAL_SITES) {
      if (!site.applies(path)) continue;
      for (const m of file.text.matchAll(site.pattern)) check(path, m[1], lineOf(file.text, m.index ?? 0), site.name, out);
    }
    if (path.endsWith("code-graph/types.ts")) {
      for (const k of codeGraphEdgeKinds(file.text)) check(path, k.key, lineOf(file.text, k.index), "CodeGraphEdgeKind", out);
    }
  }
  return out;
}

/** Registry keys that no migration inserts into graph_relation_type: the FK would refuse their writes. */
export function findUnmigratedRelationTypes(migrationSql: readonly string[]): string[] {
  const migrated = new Set<string>();
  for (const sql of migrationSql) {
    for (const block of sql.matchAll(/INSERT INTO "graph_relation_type"[^;]*;/g)) {
      for (const row of block[0].matchAll(/\(\s*'([A-Z][A-Z0-9_]*)'/g)) migrated.add(row[1]);
    }
  }
  return RELATION_TYPES.map((d) => d.key).filter((k) => !migrated.has(k));
}
