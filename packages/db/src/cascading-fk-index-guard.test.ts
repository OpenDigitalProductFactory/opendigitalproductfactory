import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Invariant: every relation field declaring ON DELETE CASCADE or SET NULL must
 * have an index whose LEADING column is that relation's local FK column.
 *
 * Why this guard exists. Postgres must locate a parent's referencing children
 * before it may delete that parent. With no suitable index it seq-scans the
 * whole child table ONCE PER DELETED PARENT ROW. On this operator install
 * that turned the nightly retention sweep into a 74-minute, two-core, ZERO-rows-
 * deleted stall: DiscoveredRelationship held two unindexed CASCADE FKs to
 * DiscoveredItem, so each deleted item scanned a 566k-row table twice (~231 full
 * scans per 10 seconds, measured). The raw discovery log then grew unbounded --
 * the very outcome the model's `@dpf retention=30d` tag exists to prevent.
 *
 * A composite index counts ONLY when the FK column is its first column, which is
 * the same rule the planner applies.
 */

const schemaDir = resolve(import.meta.dirname, "../prisma/schema");

interface RelationField {
  model: string;
  fkColumns: string[];
  onDelete: string;
  line: string;
}

/** Leading column of each @@index / @@unique / @id / @unique on a model. */
interface ModelIndexes {
  leading: Set<string>;
}

const RELATION_RE = /@relation\(([^)]*)\)/;
const FIELDS_RE = /fields:\s*\[([^\]]*)\]/;
const ON_DELETE_RE = /onDelete:\s*(\w+)/;
const BLOCK_INDEX_RE = /@@(?:index|unique)\(\s*\[([^\]]*)\]/;

function parseModels(source: string): Map<string, { body: string[] }> {
  const models = new Map<string, { body: string[] }>();
  let current: string | null = null;
  let body: string[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const start = /^model\s+(\w+)\s*\{/.exec(line);
    if (start) {
      current = start[1];
      body = [];
      continue;
    }
    if (current && line === "}") {
      models.set(current, { body });
      current = null;
      continue;
    }
    if (current) body.push(line);
  }
  return models;
}

function indexesOf(body: string[]): ModelIndexes {
  const leading = new Set<string>();
  for (const line of body) {
    if (line.startsWith("//")) continue;
    const block = BLOCK_INDEX_RE.exec(line);
    if (block) {
      const first = block[1].split(",")[0]?.trim().replace(/\(.*$/, "");
      if (first) leading.add(first);
      continue;
    }
    // Field-level @id / @unique also create a usable single-column index.
    const field = /^(\w+)\s+\S+.*@(?:id|unique)\b/.exec(line);
    if (field) leading.add(field[1]);
  }
  return { leading };
}

function cascadingRelations(model: string, body: string[]): RelationField[] {
  const out: RelationField[] = [];
  for (const line of body) {
    if (line.startsWith("//")) continue;
    const rel = RELATION_RE.exec(line);
    if (!rel) continue;
    const args = rel[1];
    const onDelete = ON_DELETE_RE.exec(args)?.[1];
    if (!onDelete || (onDelete !== "Cascade" && onDelete !== "SetNull")) continue;
    const fields = FIELDS_RE.exec(args)?.[1];
    if (!fields) continue;
    out.push({
      model,
      fkColumns: fields.split(",").map((f) => f.trim()).filter(Boolean),
      onDelete,
      line,
    });
  }
  return out;
}

/**
 * Pre-existing gaps, recorded so they are VISIBLE rather than silently deferred
 * (AGENTS.md §4). This list is a ratchet: it may shrink, never grow. A new
 * cascading FK without a leading-column index fails the guard immediately.
 *
 * None is at incident scale today -- the four that were (the DiscoveredItem and
 * DiscoveryRun cascades) are fixed in this change. Burn-down is tracked in the
 * backlog; delete an entry here in the same PR that adds its index.
 */
const KNOWN_GAPS = new Set<string>([
  // EMPTY, and it should stay that way (BI-402CB8FE closed all 39 original
  // entries). The invariant now holds with no exemptions: a new cascading FK
  // must arrive with a leading-column index. If you are about to add an entry
  // here, add the index instead -- the cost is one btree, and the alternative
  // is a seq scan of the whole child table once per deleted parent row.
]);

interface RawViolation {
  key: string;
  message: string;
}

const rawViolations: RawViolation[] = [];
for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".prisma"))) {
  const models = parseModels(readFileSync(resolve(schemaDir, file), "utf8"));
  for (const [model, { body }] of models) {
    const { leading } = indexesOf(body);
    for (const rel of cascadingRelations(model, body)) {
      const first = rel.fkColumns[0];
      if (leading.has(first)) continue;
      rawViolations.push({
        key: `${model}.${first}`,
        message:
          `${file} ${model}.${first} (onDelete: ${rel.onDelete}) has no index with ` +
          `${first} as its leading column`,
      });
    }
  }
}

/** Violations that are NOT on the recorded ratchet -- these fail the build. */
const violations = rawViolations
  .filter((v) => !KNOWN_GAPS.has(v.key))
  .map((v) => v.message);

describe("cascading FK index guard", () => {
  it("indexes every ON DELETE CASCADE / SET NULL foreign key", () => {
    expect(violations).toEqual([]);
  });

  it("covers the DiscoveredRelationship FKs that caused the retention stall", () => {
    const schema = readFileSync(resolve(schemaDir, "asset-intelligence.prisma"), "utf8");
    expect(schema).toContain("@@index([fromDiscoveredItemId])");
    expect(schema).toContain("@@index([toDiscoveredItemId])");
    expect(schema).toContain("@@index([lastConfirmedRunId])");
  });

it("keeps the known-gap ratchet honest: every entry is still a real gap", () => {
    // A stale allowlist entry hides a regression. If an index was added, the
    // entry must be deleted in that same PR.
    const stillMissing = new Set(rawViolations.map((v) => v.key));
    const stale = [...KNOWN_GAPS].filter((g) => !stillMissing.has(g));
    expect(stale).toEqual([]);
  });

  it("parsed a realistic number of models (guard is not silently vacuous)", () => {
    const total = readdirSync(schemaDir)
      .filter((f) => f.endsWith(".prisma"))
      .reduce((n, f) => n + parseModels(readFileSync(resolve(schemaDir, f), "utf8")).size, 0);
    expect(total).toBeGreaterThan(50);
  });
});
