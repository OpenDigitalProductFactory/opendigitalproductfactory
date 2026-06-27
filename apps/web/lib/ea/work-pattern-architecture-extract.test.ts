import { describe, expect, it } from "vitest";
import {
  GAP_PACKAGE_KEY,
  buildWorkPatternArchitectureModel,
  safePatternKey,
} from "./work-pattern-architecture-extract";

describe("buildWorkPatternArchitectureModel", () => {
  it("emits the governed adaptive playbooks package and core elements", () => {
    const model = buildWorkPatternArchitectureModel();

    expect(model.elements.find((element) => element.sysmlKey === GAP_PACKAGE_KEY)).toMatchObject({
      typeSlug: "package",
      name: "Governed Adaptive Playbooks",
    });
    expect(model.elements.find((element) => element.sysmlKey === "gap:req:no-self-activation")).toMatchObject({
      typeSlug: "requirement",
    });
    expect(model.elements.find((element) => element.sysmlKey === "gap:part:observer")).toMatchObject({
      typeSlug: "part_definition",
    });
    expect(model.elements.find((element) => element.sysmlKey === "gap:part:promotion-ladder")).toMatchObject({
      typeSlug: "part_definition",
    });
  });

  it("represents the promotion ladder as a part_definition containing states", () => {
    const model = buildWorkPatternArchitectureModel();
    const states = ["observed", "candidate", "approved", "active", "retired"];

    for (const state of states) {
      expect(model.elements.find((element) => element.sysmlKey === `gap:state:${state}`)).toMatchObject({
        typeSlug: "state",
      });
      expect(model.relationships).toContainEqual({
        fromKey: "gap:part:promotion-ladder",
        toKey: `gap:state:${state}`,
        relSlug: "contains",
      });
    }
  });

  it("emits observed pattern actions and verification cases", () => {
    const model = buildWorkPatternArchitectureModel({
      observedPatterns: [
        {
          patternKey: "tool-surface|overload",
          name: "Tool surface overload",
          sourceKey: "apps/web/lib/tak/pattern-observer.ts",
          codeAllocationKey: "gap:part:observer",
        },
      ],
    });
    const safeKey = safePatternKey("tool-surface|overload");

    expect(model.elements.find((element) => element.sysmlKey === `gap:act:${safeKey}`)).toMatchObject({
      typeSlug: "action",
      properties: expect.objectContaining({
        sourceKey: "apps/web/lib/tak/pattern-observer.ts",
        stableId: "ACT-GAP-tool-surface-overload",
      }),
    });
    expect(model.elements.find((element) => element.sysmlKey === `gap:vc:${safeKey}`)).toMatchObject({
      typeSlug: "verification_case",
    });
    expect(model.relationships).toContainEqual({
      fromKey: `gap:act:${safeKey}`,
      toKey: "gap:part:observer",
      relSlug: "allocates",
    });
  });

  it("uses only seeded SysML relationship slugs", () => {
    const model = buildWorkPatternArchitectureModel({
      observedPatterns: [{ patternKey: "x", name: "X" }],
    });
    const allowed = new Set(["contains", "satisfies", "verifies", "allocates", "traces"]);

    expect(model.relationships.every((rel) => allowed.has(rel.relSlug))).toBe(true);
    expect(model.crossLayerRelationships?.every((rel) => allowed.has(rel.relSlug))).toBe(true);
    expect(model.relationships.some((rel) => rel.relSlug === "sysml_allocates")).toBe(false);
  });
});
