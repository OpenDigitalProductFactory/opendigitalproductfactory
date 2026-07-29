import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROFESSION_LOCAL_AXES,
  assertProfessionLocalAxisIntegrity,
  localAxesFor,
  localAxisKey,
  projectLocalAxisVector,
  type ProfessionLocalAxis,
} from "./profession-local-axes";

// BI-106C2585 Phase 1. The registry is the substrate a profession uses to
// declare its own trade-off axes without inflating the shared spine. These
// tests pin the invariants that keep it commensurable — above all that a local
// axis always rolls up onto the spine and can never amplify a principle by
// projecting at full weight onto several targets.

const REGISTRY_PROFESSIONS: ReadonlySet<string> = new Set(
  (
    JSON.parse(
      readFileSync(join(__dirname, "../../../docs/professions/registry.json"), "utf8"),
    ) as { families: Array<{ professionKey: string }> }
  ).families.map((f) => f.professionKey),
);

// A worked example — NOT added to the shipped registry (which stays empty until
// a real corpus scores an axis), but exercised here so the machinery is proven
// end-to-end. Cost-framed (BI-72E8FF05): it projects onto human_cognitive_load,
// a COST spine axis, so the local axis must score the deficit — how much the
// hierarchy resists parsing — never the clarity. The earlier benefit-framed
// `hierarchy_clarity` version rolled 0.9 "clearer" through as 0.9 "more
// cognitive load" and scored exactly backwards.
const EXAMPLE: ProfessionLocalAxis = {
  profession: "ux-design",
  key: "ux-design/hierarchy_flatness",
  kind: "cost",
  highMeans: "the option makes the visual hierarchy HARDER to parse at a glance",
  projectsOnto: ["human_cognitive_load"],
  source: "nng/visual-hierarchy",
};

describe("PROFESSION_LOCAL_AXES registry", () => {
  it("ships empty — machinery lands before any axis scores", () => {
    expect(PROFESSION_LOCAL_AXES).toHaveLength(0);
  });

  it("passes integrity against the real profession registry (empty is valid)", () => {
    expect(() => assertProfessionLocalAxisIntegrity(REGISTRY_PROFESSIONS)).not.toThrow();
  });

  it("accepts a well-formed axis", () => {
    expect(() =>
      assertProfessionLocalAxisIntegrity(REGISTRY_PROFESSIONS, [EXAMPLE]),
    ).not.toThrow();
  });
});

describe("assertProfessionLocalAxisIntegrity — the rules that keep axes commensurable", () => {
  const check = (a: Partial<ProfessionLocalAxis>) =>
    assertProfessionLocalAxisIntegrity(REGISTRY_PROFESSIONS, [{ ...EXAMPLE, ...a }]);

  it("rejects an axis owned by a non-existent profession", () => {
    expect(() => check({ profession: "wizard", key: "wizard/x" })).toThrow(/professionKey/);
  });

  it("rejects a bare (non-namespaced) key", () => {
    expect(() => check({ key: "hierarchy_flatness" })).toThrow(/namespaced/);
  });

  it("rejects a key namespaced under a different profession than it claims", () => {
    expect(() => check({ key: "finance/hierarchy_flatness" })).toThrow(/namespaced/);
  });

  it("rejects shadowing a spine axis name", () => {
    expect(() => check({ key: "ux-design/human_cognitive_load" })).toThrow(/spine axis/);
  });

  it("rejects an unsourced axis — the WSID provenance invariant holds", () => {
    expect(() => check({ source: "  " })).toThrow(/provenance/);
  });

  it("rejects an axis with no projection", () => {
    expect(() => check({ projectsOnto: [] })).toThrow(/no projection/);
  });

  it("rejects a projection onto a profession-local target (must hit the spine)", () => {
    // schema_grounding is profession-local as of BI-AA7D80FE.
    expect(() => check({ projectsOnto: ["schema_grounding"] })).toThrow(/terminate on the spine/);
  });

  it("rejects a duplicate key", () => {
    expect(() =>
      assertProfessionLocalAxisIntegrity(REGISTRY_PROFESSIONS, [EXAMPLE, EXAMPLE]),
    ).toThrow(/Duplicate/);
  });

  // BI-72E8FF05: projection preserves sign, so kind must match every target's
  // polarity — otherwise a scorer's 0.9 "more of a good thing" arrives on a
  // cost axis asserting 0.9 "more of a bad thing", silently backwards.
  it("rejects a benefit axis projecting onto a cost spine axis", () => {
    expect(() =>
      check({
        key: "ux-design/hierarchy_clarity",
        kind: "benefit",
        highMeans: "the option makes the visual hierarchy easier to parse",
        projectsOnto: ["human_cognitive_load"],
      }),
    ).toThrow(/declared "benefit" but projects onto "human_cognitive_load", a cost/);
  });

  it("rejects a cost axis projecting onto a benefit spine axis", () => {
    expect(() =>
      check({ projectsOnto: ["long_term_maintainability"] }),
    ).toThrow(/declared "cost" but projects onto "long_term_maintainability", a benefit/);
  });

  it("rejects mixed-polarity projection targets — one axis cannot be both", () => {
    expect(() =>
      check({ projectsOnto: ["human_cognitive_load", "long_term_maintainability"] }),
    ).toThrow(/Polarity must match/);
  });
});

describe("projectLocalAxisVector — roll-up onto the spine", () => {
  const reg = [EXAMPLE];

  it("passes spine axes through untouched", () => {
    expect(
      projectLocalAxisVector("ux-design", { human_cognitive_load: 0.7, blast_radius: -0.2 }, reg),
    ).toEqual({ human_cognitive_load: 0.7, blast_radius: -0.2 });
  });

  it("rolls a local axis onto its declared spine target", () => {
    expect(projectLocalAxisVector("ux-design", { "ux-design/hierarchy_flatness": 0.8 }, reg)).toEqual({
      human_cognitive_load: 0.8,
    });
  });

  it("sums when a local axis and its spine target are both scored", () => {
    const out = projectLocalAxisVector(
      "ux-design",
      { human_cognitive_load: 0.3, "ux-design/hierarchy_flatness": 0.4 },
      reg,
    );
    expect(out.human_cognitive_load).toBeCloseTo(0.7);
  });

  it("splits weight across targets so roll-up cannot amplify a principle", () => {
    // Both targets are cost spine axes, matching the axis's cost kind — the
    // polarity-coherence invariant holds for multi-target projections too.
    const multi: ProfessionLocalAxis = {
      ...EXAMPLE,
      key: "ux-design/interaction_drag",
      projectsOnto: ["human_cognitive_load", "blast_radius"],
    };
    const out = projectLocalAxisVector("ux-design", { "ux-design/interaction_drag": 0.6 }, [multi]);
    expect(out.human_cognitive_load).toBeCloseTo(0.3);
    expect(out.blast_radius).toBeCloseTo(0.3);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBeCloseTo(0.6);
  });

  it("preserves sign, so a cost axis stays a cost after roll-up", () => {
    const cost: ProfessionLocalAxis = {
      ...EXAMPLE,
      key: "ux-design/clutter",
      kind: "cost",
      projectsOnto: ["human_cognitive_load"],
    };
    const out = projectLocalAxisVector("ux-design", { "ux-design/clutter": -0.5 }, [cost]);
    expect(out.human_cognitive_load).toBeCloseTo(-0.5);
  });

  it("drops a local axis that belongs to a DIFFERENT profession", () => {
    // Commensurability boundary: another profession's axis is not in scope, so
    // it does not silently leak into this profession's roll-up.
    expect(projectLocalAxisVector("finance", { "ux-design/hierarchy_flatness": 0.9 }, reg)).toEqual({});
  });

  it("ignores keys that are neither spine nor a known local axis", () => {
    expect(projectLocalAxisVector("ux-design", { not_a_thing: 0.9 }, reg)).toEqual({});
  });
});

describe("helpers", () => {
  it("localAxisKey namespaces consistently", () => {
    expect(localAxisKey("ux-design", "hierarchy_flatness")).toBe("ux-design/hierarchy_flatness");
  });

  it("localAxesFor returns only the named profession's axes", () => {
    const other: ProfessionLocalAxis = { ...EXAMPLE, profession: "finance", key: "finance/x" };
    expect(localAxesFor("ux-design", [EXAMPLE, other])).toEqual([EXAMPLE]);
  });
});
