// AC-3C-SUBSHAPE-NO-WIDEN, rule by rule (GPP Phase 3c PR-3c-5, BI-8875C9DF). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §9.4.
// The corpus fixtures (d-9-sub-shape-widening, d-10-sub-shape-unresolved) are in
// drc-corpus.test.ts; these pin each clause over resolve facts given directly.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runDesignRules } from "./drc";
import { parseShapeDocument } from "./parse";
import type { GppResolution } from "./resolve";

const ALL_ON = { trigger: true, stage: true, "capability-set": true, gate: true, "advisory-consult": true, "status-transition": true, "human-checkpoint": true, evidence: true, stop: true, "escalation-boundary": true, "review-point": true, "stage-deadline": true, "parallel-split-join": true, "rework-edge": true, "sub-shape": true, "environment-boundary": true } as const;

function documentWith(grants: string[]) {
  const parsed = parseShapeDocument(readFileSync(join(__dirname, "__fixtures__", "drc", "e-not-executable-sub-shape.gpp.json"), "utf8"));
  if (!parsed.accepted) throw new Error("fixture changed");
  return { ...parsed.document, grants };
}

function resolution(subShape: NonNullable<GppResolution["stages"][number]["subShape"]>): GppResolution {
  return { shapeElementId: "shape:drc-e-sub-shape@1.0.0", stages: [{ elementId: "stage:a", stageKey: "a", principal: { kind: "role", ref: "role:shape-owner" }, subShape }] };
}

const subShapeRules = (grants: string[], subShape: Parameters<typeof resolution>[0]) =>
  runDesignRules(documentWith(grants), resolution(subShape), { directSites: new Map(), executable: ALL_ON })
    .filter((finding) => finding.rule === "D-9" || finding.rule === "D-10")
    .map((finding) => ({ rule: finding.rule, elementId: finding.elementId, path: finding.path, severity: finding.severity, message: finding.message }));

const child = { ref: "child@1.0.0", exists: true, cycle: null };

describe("D-9 sub-shape widening", () => {
  it("passes a child whose grants and stage tools sit inside the parent's", () => {
    expect(subShapeRules(["tool:read", "tool:storefront_read"], { ...child, grants: ["tool:read"], tools: [{ stageKey: "x", toolName: "list_storefront_activity" }] })).toEqual([]);
  });

  it("refuses a child with a grant the parent does not hold, naming it", () => {
    const [finding, ...rest] = subShapeRules(["tool:read"], { ...child, grants: ["tool:read", "tool:workroom_evidence_write"], tools: [] });
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ rule: "D-9", elementId: "stage:a", path: "/stages/0/subShape", severity: "error" });
    expect(finding?.message).toContain("grants the parent does not hold (workroom_evidence_write)");
  });

  it("refuses a child stage tool outside the parent's grants, naming the stage and tool", () => {
    const [finding] = subShapeRules(["tool:read"], { ...child, grants: [], tools: [{ stageKey: "x", toolName: "list_customer_accounts" }] });
    expect(finding?.rule).toBe("D-9");
    expect(finding?.message).toContain("stage tools outside the parent's grants (x:list_customer_accounts)");
  });

  it("reads a capability class as the runtime does: a parent's class covers the grants it expands to", () => {
    expect(subShapeRules(["tool:read", "tool:write-internal"], { ...child, grants: ["tool:workroom_evidence_write"], tools: [] })).toEqual([]);
  });

  it("is not evaluated without the child's facts (a source that cannot read it), and never reported as a pass", () => {
    expect(subShapeRules([], child)).toEqual([]);
  });
});

describe("D-10 sub-shape resolution", () => {
  it("refuses a reference that names no registered version", () => {
    expect(subShapeRules(["tool:read"], { ref: "nowhere@1.0.0", exists: false, cycle: null })).toEqual([
      expect.objectContaining({ rule: "D-10", elementId: "stage:a", path: "/stages/0/subShape", severity: "error" }),
    ]);
  });

  it("refuses a cycle in the sub-shape call graph, naming the path, before any widening check", () => {
    const [finding, ...rest] = subShapeRules([], { ...child, grants: ["tool:anything"], tools: [], cycle: ["drc-e-sub-shape@1.0.0", "child@1.0.0", "drc-e-sub-shape@1.0.0"] });
    expect(rest).toEqual([]);
    expect(finding?.rule).toBe("D-10");
    expect(finding?.message).toContain("drc-e-sub-shape@1.0.0 -> child@1.0.0 -> drc-e-sub-shape@1.0.0");
  });
});
