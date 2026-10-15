// The DRC over the shape registry (PR-3b-3, BI-6DA17863). Informational, not
// the AC (plan PR-3b-3: "drc-registry.test.ts is informational"). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.2, §10; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-3; risk R3: "the
// DRC refuses some decompiled current shapes ... This is expected").
//
// 1. The proof shape, inquiry-response-watch, decompiled with a TEST-ONLY
//    ratified gate for its scope (the real table ratifies nothing; PR-3b-R is
//    the founder's), passes the DRC with no error and no warning.
// 2. Across every registry definition (current and frozen prior, counted from
//    the registry), the DRC agrees with the runtime's own rules and finds
//    nothing else. Findings are not snapshotted (they would churn as shapes
//    change); instead each one is re-derived here independently:
//    - D-4 exactly on the governed stages that declare no decision-record
//      (the delivery shapes complete on delivery receipts instead);
//    - C-1 exactly on the agent stages of cadence shapes that declare no tools
//      and are not on KNOWN_STAGE_TOOL_GAPS (the frozen prior versions of
//      shapes whose current version gained tools; the gap list covers
//      current versions only).
//    Every other rule is silent on every registry shape. PR-3b-5's
//    `--report` lists the per-shape findings.

import { beforeAll, describe, expect, it } from "vitest";

import { KNOWN_STAGE_TOOL_GAPS, stageToolGapKey } from "@/lib/work-management/stage-tool-gaps";
import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { decompile } from "./decompile";
import type { GppDiagnostic } from "./diagnostics";
import { runDesignRules } from "./drc";
import { GATE_RATIFICATION, type GateRatificationEntry } from "./gate-ratification";
import { resolveShapeDocument, type GppResolveSources } from "./resolve";
import { defaultResolveSources, liveDirectExecuteSites } from "./resolve-sources";

const PROOF_SCOPE = "outbound-customer-communication";
const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];

let sources: GppResolveSources;
let directSites: ReadonlyMap<string, readonly string[]>;
beforeAll(() => {
  sources = defaultResolveSources();
  directSites = liveDirectExecuteSites();
}, 120_000);

const actionable = (findings: readonly GppDiagnostic[]) =>
  findings.filter((finding) => finding.severity === "error" || finding.severity === "warning");

describe("the proof shape passes the DRC with a test-only ratified gate", () => {
  it("inquiry-response-watch has no error and no warning", async () => {
    const entry = GATE_RATIFICATION[PROOF_SCOPE];
    if (!entry) throw new Error(`${PROOF_SCOPE} is missing from the ratification table`);
    const testTable: Record<string, GateRatificationEntry> = {
      ...GATE_RATIFICATION,
      [PROOF_SCOPE]: { status: "ratified", proposed: entry.proposed, basis: entry.basis, decisionId: "DI-000000000000", ratifiedAt: "2026-10-02" },
    };
    const definition = listWorkShapes().find((shape) => shape.key === "inquiry-response-watch");
    if (!definition) throw new Error("inquiry-response-watch is not registered");
    const { document, awaitingRatification } = decompile(definition, { ratification: testTable });
    expect(awaitingRatification).toEqual([]);
    const findings = runDesignRules(document, await resolveShapeDocument(document, sources), { ratification: testTable, directSites });
    expect(actionable(findings)).toEqual([]);
    // The standing reports are still there: nothing is reported as passed that was not evaluated.
    expect(findings.filter((finding) => finding.severity === "not-evaluated").map((finding) => finding.code).sort()).toEqual(["C-5", "C-7/SANDBOX-CONTAINMENT"]);
  });
});

describe("registry-wide, the DRC agrees with the runtime's own rules and finds nothing else", () => {
  it("counts the registry from its sources", () => {
    expect(ALL_DEFINITIONS.length).toBe(listWorkShapes().length + WORK_SHAPE_PRIOR_VERSIONS.length);
    expect(ALL_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it("every finding is D-4 or C-1, on exactly the stages the runtime's rules name", async () => {
    const gaps = new Set(KNOWN_STAGE_TOOL_GAPS.map((gap) => stageToolGapKey(gap.shapeKey, gap.stageKey)));
    const actual: string[] = [];
    const derived: string[] = [];
    for (const definition of ALL_DEFINITIONS) {
      const id = `${definition.key}@${definition.version}`;
      const { document } = decompile(definition);
      const findings = runDesignRules(document, await resolveShapeDocument(document, sources), { directSites });
      for (const finding of actionable(findings)) actual.push(`${id} ${finding.rule} ${finding.elementId} ${finding.severity}`);
      for (const stage of definition.stages) {
        if (stage.advance.kind === "governed-decision" && !stage.evidence.includes("decision-record")) {
          derived.push(`${id} D-4 stage:${stage.key} error`);
        }
        if (
          definition.triggers.includes("cadence") &&
          stage.accountablePrincipalRef.startsWith("agent:") &&
          (stage.tools ?? []).length === 0 &&
          !gaps.has(stageToolGapKey(definition.key, stage.key))
        ) {
          derived.push(`${id} C-1 stage:${stage.key} error`);
        }
      }
    }
    expect(actual.sort()).toEqual(derived.sort());
  }, 60_000);

  it("no current shape has a C-1 finding: the parity test's rule holds for every current version", async () => {
    for (const definition of listWorkShapes()) {
      const { document } = decompile(definition);
      const findings = runDesignRules(document, await resolveShapeDocument(document, sources), { directSites });
      expect(findings.filter((finding) => finding.rule === "C-1"), definition.key).toEqual([]);
    }
  }, 60_000);
});
