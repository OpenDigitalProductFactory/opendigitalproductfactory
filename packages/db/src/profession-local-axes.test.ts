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
// end-to-end. `hierarchy_clarity` is the spec's own example: a ux-design axis
// that rolls up onto human_cognitive_load.
const EXAMPLE: ProfessionLocalAxis = {
  profession: "ux-design",
  key: "ux-design/hierarchy_clarity",
  kind: "benefit",
  highMeans: "the option makes the visual hierarchy easier to parse at a glance",
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
    expect(() => check({ key: "hierarchy_clarity" })).toThrow(/namespaced/);
  });

  it("rejects a key namespaced under a different profession than it claims", () => {
    expect(() => check({ key: "finance/hierarchy_clarity" })).toThrow(/namespaced/);
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
});

describe("projectLocalAxisVector — roll-up onto the spine", () => {
  const reg = [EXAMPLE];

  it("passes spine axes through untouched", () => {
    expect(
      projectLocalAxisVector("ux-design", { human_cognitive_load: 0.7, blast_radius: -0.2 }, reg),
    ).toEqual({ human_cognitive_load: 0.7, blast_radius: -0.2 });
  });

  it("rolls a local axis onto its declared spine target", () => {
    expect(projectLocalAxisVector("ux-design", { "ux-design/hierarchy_clarity": 0.8 }, reg)).toEqual({
      human_cognitive_load: 0.8,
    });
  });

  it("sums when a local axis and its spine target are both scored", () => {
    const out = projectLocalAxisVector(
      "ux-design",
      { human_cognitive_load: 0.3, "ux-design/hierarchy_clarity": 0.4 },
      reg,
    );
    expect(out.human_cognitive_load).toBeCloseTo(0.7);
  });

  it("splits weight across targets so roll-up cannot amplify a principle", () => {
    const multi: ProfessionLocalAxis = {
      ...EXAMPLE,
      key: "ux-design/legibility",
      projectsOnto: ["human_cognitive_load", "long_term_maintainability"],
    };
    const out = projectLocalAxisVector("ux-design", { "ux-design/legibility": 0.6 }, [multi]);
    expect(out.human_cognitive_load).toBeCloseTo(0.3);
    expect(out.long_term_maintainability).toBeCloseTo(0.3);
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
    expect(projectLocalAxisVector("finance", { "ux-design/hierarchy_clarity": 0.9 }, reg)).toEqual({});
  });

  it("ignores keys that are neither spine nor a known local axis", () => {
    expect(projectLocalAxisVector("ux-design", { not_a_thing: 0.9 }, reg)).toEqual({});
  });
});

describe("helpers", () => {
  it("localAxisKey namespaces consistently", () => {
    expect(localAxisKey("ux-design", "hierarchy_clarity")).toBe("ux-design/hierarchy_clarity");
  });

  it("localAxesFor returns only the named profession's axes", () => {
    const other: ProfessionLocalAxis = { ...EXAMPLE, profession: "finance", key: "finance/x" };
    expect(localAxesFor("ux-design", [EXAMPLE, other])).toEqual([EXAMPLE]);
  });
});
