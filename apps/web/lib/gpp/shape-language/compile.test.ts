// The compile pipeline (PR-3b-4, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.1 (parse → schema → resolve → design rules → emit), §7.2 ("errors stop
// emission"), §6.4 (binding revision), §10 (migration without behaviour
// change); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-4).
//
// 1. Refusal: every DRC fixture whose seeded finding is an error is refused
//    with no module; the two warning fixtures compile and carry the warning;
//    a parse or schema failure is refused before resolve.
// 2. AC-NODISRUPT's diff precondition: for every registry definition S,
//    diffWorkShapeBinding(S, S) and diffWorkShapeBinding(S, compile(S)) are
//    `unchanged`, with nothing ratified (no gate), with the real ratification
//    table (a gate on each ratified scope) and with every scope test-ratified (a typed gate on every governed advance). The
//    reverse direction drops gates, so its only rows are gate/binding removals.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { diffWorkShapeBinding } from "@/lib/work-management/work-shape-binding-diff";
import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { compileShapeDocument, shapeDocumentDigest } from "./compile";
import { decompile } from "./decompile";
import { GATE_RATIFICATION, type GateRatificationEntry } from "./gate-ratification";
import { gppLayoutSchema } from "./gpp-layout-schema";
import { legacyProjection } from "./legacy";
import type { GppResolveSources } from "./resolve";
import { defaultResolveSources, liveDirectExecuteSites } from "./resolve-sources";

const DRC_DIR = join(__dirname, "__fixtures__", "drc");
type Expected = { rule: string; elementId: string };
const EXPECTED = JSON.parse(readFileSync(join(DRC_DIR, "expected.json"), "utf8")) as Record<string, Expected>;
const DRC_RATIFICATION = JSON.parse(readFileSync(join(DRC_DIR, "ratification.json"), "utf8")) as Record<string, GateRatificationEntry>;
const VIOLATIONS = Object.keys(EXPECTED).sort();
const WARNING_RULES = new Set(["C-9", "W-ORPHAN-LAYOUT"]);
const PASSING = readdirSync(DRC_DIR).filter((name) => name.startsWith("pass-") && name.endsWith(".gpp.json")).sort();
const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];

const ALL_RATIFIED: Readonly<Record<string, GateRatificationEntry>> = Object.fromEntries(
  Object.entries(GATE_RATIFICATION).map(([scope, entry]) => [
    scope,
    { status: "ratified", proposed: entry.proposed, basis: entry.basis, decisionId: "DI-000000000000", ratifiedAt: "2026-10-02" },
  ]),
);

/** The production table with every ratification withdrawn: no typed gate anywhere. */
const NOTHING_RATIFIED: Readonly<Record<string, GateRatificationEntry>> = Object.fromEntries(
  Object.entries(GATE_RATIFICATION).map(([scope, entry]) => [scope, { status: "proposed", proposed: entry.proposed, basis: entry.basis }]),
);

let sources: GppResolveSources;
let directSites: ReadonlyMap<string, readonly string[]>;
beforeAll(() => {
  sources = defaultResolveSources();
  directSites = liveDirectExecuteSites();
}, 120_000);

function compileFixture(name: string) {
  const layoutFile = join(DRC_DIR, name.replace(/\.gpp\.json$/, ".layout.json"));
  const layout = existsSync(layoutFile) ? gppLayoutSchema.parse(JSON.parse(readFileSync(layoutFile, "utf8"))) : undefined;
  return compileShapeDocument(readFileSync(join(DRC_DIR, name), "utf8"), sources, {
    sourcePath: `fixtures/${name}`,
    ratification: DRC_RATIFICATION,
    directSites,
    ...(layout ? { layout } : {}),
  });
}

describe("compile refuses a document with any error finding, and emits nothing", () => {
  it.each(VIOLATIONS.filter((name) => !WARNING_RULES.has(EXPECTED[name]?.rule ?? "")))("%s", async (name) => {
    const expected = EXPECTED[name] as Expected;
    const result = await compileFixture(name);
    expect(result.accepted).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["accepted", "diagnostics"]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ rule: expected.rule, elementId: expected.elementId, severity: "error" }));
  });

  it.each(VIOLATIONS.filter((name) => WARNING_RULES.has(EXPECTED[name]?.rule ?? "")))("%s compiles and carries its warning", async (name) => {
    const expected = EXPECTED[name] as Expected;
    const result = await compileFixture(name);
    if (!result.accepted) throw new Error(`${name} was refused: ${JSON.stringify(result.diagnostics)}`);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ rule: expected.rule, elementId: expected.elementId, severity: "warning" }));
    expect(result.module).toContain("as const satisfies WorkShapeDefinition;");
  });

  it.each(PASSING)("%s compiles", async (name) => {
    const result = await compileFixture(name);
    expect(result.accepted).toBe(true);
  });

  it("refuses unparseable text and a schema-invalid document before resolve", async () => {
    let resolved = false;
    const watching: GppResolveSources = {
      ...sources,
      grantsFor: (agentId) => {
        resolved = true;
        return sources.grantsFor(agentId);
      },
    };
    const bad = await compileShapeDocument("{ not json", watching, { sourcePath: "x" });
    expect(bad.accepted).toBe(false);
    expect(bad.diagnostics.length).toBeGreaterThan(0);

    const valid = JSON.parse(readFileSync(join(DRC_DIR, "pass-gated-irreversible-stage.gpp.json"), "utf8")) as Record<string, unknown>;
    const unknownField = await compileShapeDocument(JSON.stringify({ ...valid, owner: "someone" }), watching, { sourcePath: "x" });
    expect(unknownField.accepted).toBe(false);
    expect(unknownField.diagnostics.map((finding) => finding.path)).toContain("/owner");
    expect(resolved).toBe(false);
  });

  it("the digest ignores key order and whitespace, and changes with content", async () => {
    const text = readFileSync(join(DRC_DIR, "pass-gated-irreversible-stage.gpp.json"), "utf8");
    const first = await compileShapeDocument(text, sources, { sourcePath: "x", ratification: DRC_RATIFICATION, directSites });
    const value = JSON.parse(text) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    const second = await compileShapeDocument(JSON.stringify(reordered), sources, { sourcePath: "x", ratification: DRC_RATIFICATION, directSites });
    if (!first.accepted || !second.accepted) throw new Error("expected both to compile");
    expect(second.digest).toBe(first.digest);
    expect(second.module).toBe(first.module);
    expect(shapeDocumentDigest({ ...first.document, title: "Another title" })).not.toBe(first.digest);
  });
});

describe("AC-NODISRUPT precondition: the binding diff is unchanged for every registry shape", () => {
  it("every registry definition against itself", () => {
    for (const definition of ALL_DEFINITIONS) {
      const diff = diffWorkShapeBinding(definition, definition);
      expect(diff.classification, `${definition.key}@${definition.version}`).toBe("unchanged");
      expect(diff.changes).toEqual([]);
    }
  });

  it.each([
    ["nothing ratified (no typed gate)", NOTHING_RATIFIED],
    ["the real ratification table (typed gates on ratified scopes only)", GATE_RATIFICATION],
    ["every scope test-ratified (a typed gate on each governed advance)", ALL_RATIFIED],
  ] as const)("every registry definition against its compiled form, with %s", async (_label, ratification) => {
    let compiled = 0;
    const refused: string[] = [];
    for (const definition of ALL_DEFINITIONS) {
      const id = `${definition.key}@${definition.version}`;
      const { document } = decompile(definition, { ratification });
      const result = await compileShapeDocument(JSON.stringify(document), sources, { sourcePath: `${definition.key}.gpp.json`, ratification, directSites });
      if (!result.accepted) {
        refused.push(id);
        continue;
      }
      compiled += 1;
      const emitted = result.definition as WorkShapeDefinition;
      // The registry value before any typed gate: the definition itself for a
      // hand-declared shape; a compiled one (PR-3b-6) minus its ratified gate.
      const baseline = legacyProjection(definition);
      const diff = diffWorkShapeBinding(baseline, emitted);
      expect(diff.changes, id).toEqual([]);
      expect(diff.classification, id).toBe("unchanged");
      // The reverse (compiled -> original) drops any typed gate, which is a
      // widening row by design; with no gate it must stay unchanged.
      const reverse = diffWorkShapeBinding(emitted, baseline);
      expect(reverse.changes.every((row) => row.kind === "gate-removed" || row.kind === "binding-removed"), id).toBe(true);
      if (!emitted.stages.some((stage) => stage.advance.kind === "governed-decision" && stage.advance.gate)) {
        expect(reverse.classification, id).toBe("unchanged");
      }
      // And the emitted definition is the registry value under the legacy projection.
      expect(canonicalJson(legacyProjection(emitted)), id).toBe(canonicalJson(baseline));
    }
    expect(compiled + refused.length).toBe(ALL_DEFINITIONS.length);
    // drc-registry.test.ts derives the refusals (D-4 on delivery shapes, C-1 on frozen priors); most compile.
    expect(compiled).toBeGreaterThan(refused.length);
  }, 300_000);
});
