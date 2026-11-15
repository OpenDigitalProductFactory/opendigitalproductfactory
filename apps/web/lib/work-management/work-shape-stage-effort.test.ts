// Phase G (BI-B3BBF9AD) — effort tier per work-shape stage.
// Spec: docs/superpowers/specs/2026-10-01-stage-effort-tier-design.md (§5, §6).
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { WORK_SHAPE_STAGE_EFFORTS, type WorkShapeStageEffort } from "@dpf/validators/gpp/work-shape-contracts";
import { describe, expect, it } from "vitest";

import { decompile, lowerToDefinition } from "@/lib/gpp/shape-language/dpf-toolkit";
import type { EffortLevel } from "@/lib/tak/effort-warrant";
import { diffWorkShapeBinding } from "./work-shape-binding-diff";
import { listWorkShapes, resolveStageEffort, type WorkShapeDefinition, type WorkShapeStage } from "./work-shapes";

const stage = (over: Partial<WorkShapeStage>): WorkShapeStage => ({
  key: "s",
  title: "S",
  accountablePrincipalRef: "agent:x",
  advance: { kind: "status-change", condition: "done" },
  evidence: [],
  ...over,
});
const governed = { kind: "governed-decision" as const, condition: "decided", decisionScope: "outbound-customer-communication" as const };

/** Stages of standing (cadence) shapes that an agent runs without a governed decision: each must declare a tier (AC-G5). */
function undeclaredOwedStages(shapes: readonly WorkShapeDefinition[]): string[] {
  return shapes.flatMap(shape => !shape.triggers.includes("cadence") ? [] : shape.stages
    .filter(s => s.accountablePrincipalRef.startsWith("agent:") && s.advance.kind !== "governed-decision" && s.effort === undefined)
    .map(s => `${shape.key}@${shape.version}/${s.key}`));
}

/** A governed-decision stage that declares a tier below high says something the runtime will not do (AC-G8). */
function governedDeclaredBelowHigh(shapes: readonly WorkShapeDefinition[]): string[] {
  return shapes.flatMap(shape => shape.stages
    .filter(s => s.advance.kind === "governed-decision" && s.effort !== undefined && s.effort !== "high")
    .map(s => `${shape.key}@${shape.version}/${s.key}`));
}

describe("one effort vocabulary", () => {
  it("the portable contract and the app's EffortLevel name the same four tiers", () => {
    const appToContract: WorkShapeStageEffort = "low" as EffortLevel;
    const contractToApp: EffortLevel = "high" as WorkShapeStageEffort;
    expect([appToContract, contractToApp]).toEqual(["low", "high"]);
    expect([...WORK_SHAPE_STAGE_EFFORTS]).toEqual(["minimal", "low", "medium", "high"]);
  });
});

describe("resolveStageEffort", () => {
  it("returns the declared tier for a status-change stage", () => {
    expect(resolveStageEffort(stage({ effort: "low" }))).toBe("low");
    expect(resolveStageEffort(stage({ effort: "medium" }))).toBe("medium");
  });

  it("returns null for an undeclared stage, so the caller behaves as before (AC-G3)", () => {
    expect(resolveStageEffort(stage({}))).toBeNull();
    expect(resolveStageEffort(null)).toBeNull();
    expect(resolveStageEffort(undefined)).toBeNull();
  });

  it("is always high for a governed decision, whatever it declares (AC-G2)", () => {
    expect(resolveStageEffort(stage({ advance: governed }))).toBe("high");
    expect(resolveStageEffort(stage({ advance: governed, effort: "low" }))).toBe("high");
    expect(resolveStageEffort(stage({ advance: governed, effort: "minimal" }))).toBe("high");
  });
});

describe("declared stage effort across the registry (Phase G guard)", () => {
  it("declares a tier on every agent-run, non-governed stage of every standing shape (AC-G5)", () => {
    expect(undeclaredOwedStages(listWorkShapes())).toEqual([]);
  });

  it("never declares a governed-decision stage below high, document-compiled shapes included (AC-G8)", () => {
    expect(governedDeclaredBelowHigh(listWorkShapes())).toEqual([]);
    for (const shape of listWorkShapes()) {
      for (const s of shape.stages) {
        if (s.advance.kind === "governed-decision") expect(resolveStageEffort(s), `${shape.key}/${s.key}`).toBe("high");
      }
    }
  });

  it("the guards fail on seeded violations", () => {
    const seeded: WorkShapeDefinition = {
      ...listWorkShapes().find(shape => shape.key === "inquiry-response-watch")!,
    };
    const lowGoverned = { ...seeded, stages: seeded.stages.map(s => s.advance.kind === "governed-decision" ? { ...s, effort: "low" as const } : s) };
    expect(governedDeclaredBelowHigh([lowGoverned])).toEqual(["inquiry-response-watch@1.0.0/send"]);
    const undeclared = { ...seeded, stages: seeded.stages.map(({ effort: _effort, ...s }) => s) };
    expect(undeclaredOwedStages([undeclared])).toEqual(["inquiry-response-watch@1.0.0/draft"]);
  });

  it("is routing metadata, not reach: a stage that only gains a tier leaves the binding unchanged (§6 item 6)", () => {
    for (const shape of listWorkShapes()) {
      if (!shape.stages.some(s => s.effort !== undefined)) continue;
      const undeclared = { ...shape, stages: shape.stages.map(({ effort: _effort, ...s }) => s) };
      expect(diffWorkShapeBinding(undeclared, shape).classification, shape.key).toBe("unchanged");
    }
  });
});

describe("effort through the GPP compiler (AC-G7)", () => {
  it("round-trips losslessly and is never invented for an undeclared stage", () => {
    const definition: WorkShapeDefinition = {
      ...listWorkShapes().find(shape => shape.key === "inquiry-response-watch")!,
    };
    const { document } = decompile(definition);
    expect(document.stages.find(s => s.key === "draft")?.effort).toBe("medium");
    expect(Object.hasOwn(document.stages.find(s => s.key === "send")!, "effort")).toBe(false);
    const lowered = lowerToDefinition(document);
    expect(lowered.stages.map(s => s.effort)).toEqual(definition.stages.map(s => s.effort));
    expect(canonicalJson(decompile(lowered).document)).toBe(canonicalJson(document));
  });
});
