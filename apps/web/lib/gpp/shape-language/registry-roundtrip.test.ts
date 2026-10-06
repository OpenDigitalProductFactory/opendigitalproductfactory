// The registry-wide losslessness, report and determinism suite (PR-3a-4,
// BI-6DA17863). Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §7.4 (L1, L2, R) and
// §12 (AC-SCHEMA, AC-LOSSLESS, AC-DETERMINISM in-memory precursor); plan:
// docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3a-4).
//
// PR-3a-3 proved the mechanism on one representative per family. This suite
// proves it over EVERY definition the registry holds: every current shape
// (listWorkShapes()) and every frozen prior version (WORK_SHAPE_PRIOR_VERSIONS).
// The case list is derived from those two sources, never hardcoded, so a shape
// or prior version added later enters every check below with no edit here.
//
// 1. AC-SCHEMA: every decompiled document passes gppShapeDocumentSchema.
// 2. L1, field for field: legacy(lower(decompile(S))) equals legacy(S) under
//    canonical JSON AND has equal own-key sets at every object node (canonical JSON
//    cannot tell an absent key from one set to `undefined`, and emitted
//    TypeScript would show the difference). legacy(S) is S for every
//    hand-declared shape; a compiled shape (PR-3b-6) already carries its
//    ratified gate, which the projection drops on both sides.
// 3. L2: decompile(lower(D)) equals D for each decompiled document D.
// 4. R: every field L1 drops appears in buildRatificationReport, and the
//    report over the whole registry must equal the committed, sorted
//    apps/web/lib/gpp/generated/gate-ratification-report.json (written by
//    `pnpm --filter web build:gpp-shapes` since PR-3b-5; it replaced the
//    PR-3a-4 snapshot so the report has one committed home).
// 5. Determinism, in memory: decompile and lowerToDefinition give byte-identical
//    output across two runs and across copies of the input whose object keys
//    are reversed or shuffled by a seeded PRNG (no property-testing package is
//    a dependency; plan §"Constraints"). PR-3b-5 extends this to generated
//    TypeScript bytes (AC-DETERMINISM proper).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { getWorkShape, listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { serializeStableJson } from "../../../scripts/registry-generator-support";
import { decompile } from "./decompile";
import { lowerToDefinition } from "./emit";
import { gppShapeDocumentSchema, type GppShapeDocument } from "./gpp-shape-schema";
import { legacyDroppedFields, legacyProjection } from "./legacy";
import { buildRatificationReport } from "./ratification-report";
import { reversedKeys, seedFor, SHUFFLE_SALTS, shuffledKeys } from "./__fixtures__/key-order";

type JsonObject = Record<string, unknown>;

const CURRENT_SHAPES: readonly WorkShapeDefinition[] = listWorkShapes();
const PRIOR_SHAPES: readonly WorkShapeDefinition[] = WORK_SHAPE_PRIOR_VERSIONS;

/** Every definition the registry holds: current first, then prior versions. */
const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...CURRENT_SHAPES, ...PRIOR_SHAPES];

function shapeId(definition: WorkShapeDefinition): string {
  return `${definition.key}@${definition.version}`;
}

const CASES: ReadonlyArray<[id: string, definition: WorkShapeDefinition]> = ALL_DEFINITIONS.map(
  (definition) => [shapeId(definition), definition],
);

/** The first path at which two values differ in their own-key sets, or null. */
function firstOwnKeyDifference(left: unknown, right: unknown, path = "$"): string | null {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path;
    if (left.length !== right.length) return `${path}.length`;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstOwnKeyDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (left && typeof left === "object" && right && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join("\0") !== rightKeys.join("\0")) {
      return `${path} {${leftKeys.join(",")}} vs {${rightKeys.join(",")}}`;
    }
    for (const key of leftKeys) {
      const difference = firstOwnKeyDifference((left as JsonObject)[key], (right as JsonObject)[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return null;
}

/** The first path at which two plain-JSON values differ in value or key set, or null. */
function firstDifference(left: unknown, right: unknown, path = "$"): string | null {
  const keyDifference = firstOwnKeyDifference(left, right, path);
  if (keyDifference) return keyDifference;
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (left && typeof left === "object" && right && typeof right === "object") {
    for (const key of Object.keys(left).sort()) {
      const difference = firstDifference((left as JsonObject)[key], (right as JsonObject)[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return Object.is(left, right) ? null : `${path}: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`;
}


/** Bytes that depend on insertion order (JSON.stringify) and bytes that do not (canonicalJson). */
function bytes(value: unknown): { ordered: string; canonical: string } {
  return { ordered: JSON.stringify(value), canonical: canonicalJson(value) };
}

describe("registry-wide suite: the case list is the registry", () => {
  it("covers exactly every current shape and every prior version, each once", () => {
    // Derived, not hardcoded: a new shape or prior version raises both sides.
    expect(CASES.length).toBe(listWorkShapes().length + WORK_SHAPE_PRIOR_VERSIONS.length);
    expect(CASES.length).toBeGreaterThan(0);
    expect(new Set(CASES.map(([id]) => id)).size).toBe(CASES.length);
  });

  it("every current shape is the registry's own object for its key, and no prior version shadows a current one", () => {
    for (const definition of CURRENT_SHAPES) expect(getWorkShape(definition.key)).toBe(definition);
    for (const definition of PRIOR_SHAPES) expect(getWorkShape(definition.key)?.version).not.toBe(definition.version);
  });
});

describe.each(CASES)("registry-wide suite: %s", (id, definition) => {
  it("AC-SCHEMA: the decompiled document passes gppShapeDocumentSchema", () => {
    const result = gppShapeDocumentSchema.safeParse(decompile(definition).document);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it("L1: lower(decompile(S)) equals S under the legacy projection, field for field", () => {
    const projected = legacyProjection(lowerToDefinition(decompile(definition).document));
    const original = legacyProjection(definition);

    expect(firstDifference(projected, original)).toBeNull();
    expect(firstOwnKeyDifference(projected, original)).toBeNull();
    expect(canonicalJson(projected)).toBe(canonicalJson(original));
  });

  it("L2: decompile(lower(D)) equals D for the decompiled document", () => {
    const { document } = decompile(definition);
    const again = decompile(lowerToDefinition(document)).document;

    expect(firstDifference(again, document)).toBeNull();
    expect(canonicalJson(again)).toBe(canonicalJson(document));
  });

  it("R: every field the legacy projection drops is listed in the ratification report", () => {
    const lowered = lowerToDefinition(decompile(definition).document);
    const report = buildRatificationReport([definition]);
    const expected = legacyDroppedFields(lowered).map((row) => ({ shape: id, ...row }));

    for (const row of expected) expect(report.dropped).toContainEqual(row);
    expect(report.dropped).toHaveLength(expected.length);
  });

  it("R: every governed stage is reported, and every unratified one is awaiting ratification", () => {
    const report = buildRatificationReport([definition]);
    const governed = definition.stages.filter((stage) => stage.advance.kind === "governed-decision");

    expect(report.governedStages.map((row) => row.stage).sort()).toEqual(governed.map((stage) => stage.key).sort());
    expect(report.awaitingRatification.map((row) => row.stage).sort()).toEqual(
      [...decompile(definition).awaitingRatification].sort(),
    );
  });

  it("determinism: decompile is byte-identical across runs and across reversed or seeded-shuffled key order", () => {
    const first = bytes(decompile(definition));
    expect(bytes(decompile(definition))).toEqual(first);
    expect(bytes(decompile(reversedKeys(definition)))).toEqual(first);
    for (const salt of SHUFFLE_SALTS) {
      expect(bytes(decompile(shuffledKeys(definition, seedFor(id, salt))))).toEqual(first);
    }
  });

  it("determinism: lowerToDefinition is byte-identical across runs and across reversed or seeded-shuffled key order", () => {
    const document: GppShapeDocument = decompile(definition).document;
    const first = bytes(lowerToDefinition(document));
    expect(bytes(lowerToDefinition(document))).toEqual(first);
    expect(bytes(lowerToDefinition(reversedKeys(document)))).toEqual(first);
    for (const salt of SHUFFLE_SALTS) {
      expect(bytes(lowerToDefinition(shuffledKeys(document, seedFor(id, salt))))).toEqual(first);
    }
  });
});

describe("registry-wide suite: the ratification report", () => {
  it("is independent of input order", () => {
    const forward = serializeStableJson(buildRatificationReport(ALL_DEFINITIONS));
    expect(serializeStableJson(buildRatificationReport([...ALL_DEFINITIONS].reverse()))).toBe(forward);
  });

  it("lists every governed stage of the registry and drops nothing while no scope is ratified", () => {
    const report = buildRatificationReport(ALL_DEFINITIONS);
    const governedCount = ALL_DEFINITIONS.reduce(
      (count, definition) => count + definition.stages.filter((s) => s.advance.kind === "governed-decision").length,
      0,
    );

    expect(report.governedStages).toHaveLength(governedCount);
    expect(report.dropped).toEqual(
      report.governedStages
        .filter((row) => row.status === "ratified")
        .map((row) => expect.objectContaining({ shape: row.shape, stage: row.stage, field: "advance.gate" })),
    );
    expect(report.awaitingRatification).toEqual(report.governedStages.filter((row) => row.status !== "ratified"));
  });

  it("matches the committed generated report (apps/web/lib/gpp/generated/gate-ratification-report.json)", () => {
    // PR-3b-5: the generator writes this file and `check:gpp-shapes` guards it;
    // it replaced the PR-3a-4 snapshot, so the report has one committed home.
    expect(readFileSync(join(__dirname, "..", "generated", "gate-ratification-report.json"), "utf8")).toBe(
      serializeStableJson(buildRatificationReport(ALL_DEFINITIONS)),
    );
  });
});
