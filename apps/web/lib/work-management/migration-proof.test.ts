// AC-NODISRUPT for the GPP Phase 3b proof migration (PR-3b-6, BI-6DA17863).
// Design: docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §4.5 (the worked example), §7.4 (L1, R), §7.5 (where things live), §10
// (migration without behaviour change), §12 (AC-NODISRUPT); plan:
// docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3b-6, "Spec refinements" 4 and 5).
//
// inquiry-response-watch@1.0.0 is now compiled from
// shape-documents/inquiry-response-watch.gpp.json instead of hand-declared.
// The definition as it was hand-declared is pinned as a fixture captured from
// the registry before the migration (byte-identical to origin/main's literal):
// __fixtures__/inquiry-response-watch@1.0.0.pre-migration.json, with the
// registry's key order beside it. Against that fixture:
//
// 1. getWorkShape and getWorkShapeVersion return the compiled definition, and
//    it equals the fixture under canonicalJson(legacyProjection(·)) with equal
//    own-key sets at every node.
// 2. The only key it adds is stages[1].advance.gate, equal to the ratified
//    GATE_RATIFICATION entry (DI-BEEAF36D0244) and to the committed
//    ratification report's `dropped` row.
// 3. diffWorkShapeBinding(fixture, migrated) is `unchanged` with no rows:
//    adding a typed gate is a making-explicit change.
// 4. listWorkShapes() keys are in the pre-migration order.
// 5. readWorkShapeDefinitionContract(migrated) equals the fixture's contract
//    apart from the gate.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";

import { GATE_RATIFICATION } from "@/lib/gpp/shape-language/gate-ratification";
import { legacyProjection } from "@/lib/gpp/shape-language/legacy";

import { INQUIRY_RESPONSE_WATCH_1_0_0 } from "./generated/inquiry-response-watch.shape.generated";
import { INQUIRY_RESPONSE_WATCH_SHAPE_KEY } from "./standing-operations-shapes";
import { diffWorkShapeBinding } from "./work-shape-binding-diff";
import {
  getWorkShape,
  getWorkShapeVersion,
  listWorkShapes,
  readWorkShapeDefinitionContract,
  type WorkShapeDefinition,
} from "./work-shapes";

const FIXTURES = join(__dirname, "__fixtures__");
const REPORT = join(__dirname, "../gpp/generated/gate-ratification-report.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const PRE_MIGRATION = readJson<WorkShapeDefinition>(join(FIXTURES, "inquiry-response-watch@1.0.0.pre-migration.json"));
const PRE_MIGRATION_KEYS = readJson<string[]>(join(FIXTURES, "work-shape-keys.pre-migration.json"));
/** Shapes registered after PR-3b-R/6, in registry order (BI-C1781121: acceptance-verification). */
const REGISTERED_AFTER_MIGRATION: readonly string[] = ["acceptance-verification"];

function migrated(): WorkShapeDefinition {
  const definition = getWorkShape(INQUIRY_RESPONSE_WATCH_SHAPE_KEY);
  if (!definition) throw new Error("inquiry-response-watch is not registered");
  return definition;
}

/** Every own-key path at which the two values differ, as `path {left keys} vs {right keys}`. */
function ownKeyDifferences(left: unknown, right: unknown, path = "$"): string[] {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return [path];
    if (left.length !== right.length) return [`${path}.length`];
    return left.flatMap((item, index) => ownKeyDifferences(item, right[index], `${path}[${index}]`));
  }
  if (left && typeof left === "object" && right && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    const here = leftKeys.join("\0") === rightKeys.join("\0") ? [] : [`${path} {${leftKeys.join(",")}} vs {${rightKeys.join(",")}}`];
    const shared = leftKeys.filter((key) => rightKeys.includes(key));
    return [
      ...here,
      ...shared.flatMap((key) =>
        ownKeyDifferences((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}.${key}`),
      ),
    ];
  }
  return [];
}

describe("AC-NODISRUPT: inquiry-response-watch@1.0.0 compiled from its shape document", () => {
  it("the registry serves the generated definition, by reference, for the key and the exact version", () => {
    expect(getWorkShape(INQUIRY_RESPONSE_WATCH_SHAPE_KEY)).toBe(INQUIRY_RESPONSE_WATCH_1_0_0);
    expect(getWorkShapeVersion(INQUIRY_RESPONSE_WATCH_SHAPE_KEY, "1.0.0")).toBe(INQUIRY_RESPONSE_WATCH_1_0_0);
  });

  it("1. equals the pre-migration definition under the legacy projection, with equal own-key sets", () => {
    for (const definition of [migrated(), getWorkShapeVersion(INQUIRY_RESPONSE_WATCH_SHAPE_KEY, "1.0.0")]) {
      if (!definition) throw new Error("getWorkShapeVersion returned null");
      const projected = legacyProjection(definition);
      expect(canonicalJson(projected)).toBe(canonicalJson(PRE_MIGRATION));
      expect(ownKeyDifferences(projected, PRE_MIGRATION)).toEqual([]);
    }
  });

  it("2. the only added key is stages[1].advance.gate: the ratified entry and the report's dropped row", () => {
    const definition = migrated();
    expect(ownKeyDifferences(definition, PRE_MIGRATION)).toEqual([
      "$.stages[1].advance {condition,decisionScope,gate,kind} vs {condition,decisionScope,kind}",
    ]);
    const send = definition.stages[1];
    if (send.advance.kind !== "governed-decision") throw new Error("send must be governed");

    const entry = GATE_RATIFICATION["outbound-customer-communication"];
    expect(entry?.status).toBe("ratified");
    expect(entry?.status === "ratified" ? entry.decisionId : null).toBe("DI-BEEAF36D0244");
    expect(send.advance.gate).toEqual(entry?.proposed);

    const report = readJson<{ dropped: Array<{ shape: string; stage: string; field: string; value: unknown }> }>(REPORT);
    expect(report.dropped.filter((row) => row.shape === "inquiry-response-watch@1.0.0")).toEqual([
      { shape: "inquiry-response-watch@1.0.0", stage: "send", field: "advance.gate", value: send.advance.gate },
    ]);
  });

  it("3. the binding diff against the pre-migration definition is unchanged, with no rows", () => {
    const diff = diffWorkShapeBinding(PRE_MIGRATION, migrated());
    expect(diff.changes).toEqual([]);
    expect(diff.classification).toBe("unchanged");
  });

  it("4. listWorkShapes() keeps the pre-migration key order", () => {
    // Shapes registered after the migration are appended, never interleaved.
    expect(listWorkShapes().map((shape) => shape.key)).toEqual([...PRE_MIGRATION_KEYS, ...REGISTERED_AFTER_MIGRATION]);
  });

  it("5. the definition contract runtime consumers read equals the pre-migration one apart from the gate", () => {
    const contract = readWorkShapeDefinitionContract(migrated());
    const before = readWorkShapeDefinitionContract(PRE_MIGRATION);
    expect(canonicalJson({ ...contract, stages: legacyProjection(migrated()).stages })).toBe(canonicalJson(before));
    expect(ownKeyDifferences(contract, before)).toEqual([
      "$.stages[1].advance {condition,decisionScope,gate,kind} vs {condition,decisionScope,kind}",
    ]);
  });
});
