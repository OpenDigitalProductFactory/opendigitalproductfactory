import { describe, expect, it } from "vitest";
import { buildSkillToolchainModel, SKILL_TOOLCHAIN_PACKAGE_KEY, type SkillFact } from "./skill-toolchain-extract";

function mk(p: Partial<SkillFact> & { skillId: string }): SkillFact {
  return {
    name: `Skill ${p.skillId}`,
    description: "desc",
    category: "general",
    status: "active",
    riskBand: "low",
    taskType: "conversation",
    capability: null,
    userInvocable: true,
    agentInvocable: true,
    allowedTools: [],
    composesFrom: [],
    assignmentCount: 0,
    ...p,
  };
}

const SKILLS: SkillFact[] = [
  mk({ skillId: "a", category: "ops", composesFrom: ["b", "missing", "a"] }), // → traces a→b only
  mk({ skillId: "b", category: "ops" }),
  mk({ skillId: "c", category: "ai", status: "deprecated" }), // excluded
  mk({ skillId: "d", category: "ai", assignmentCount: 5 }),
  mk({ skillId: "e", category: "gone", status: "deprecated" }), // category vanishes
];

describe("buildSkillToolchainModel", () => {
  const model = buildSkillToolchainModel(SKILLS);
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));

  it("projects live skills as part_definitions under category packages; deprecated excluded", () => {
    expect(byKey.get(SKILL_TOOLCHAIN_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get("skilltool:cat:ops")?.typeSlug).toBe("package");
    expect(byKey.get("skilltool:cat:ai")?.typeSlug).toBe("package");
    expect(byKey.get("skilltool:skill:a")?.typeSlug).toBe("part_definition");
    expect(byKey.get("skilltool:skill:d")?.typeSlug).toBe("part_definition");
    // deprecated skill + its now-empty category are absent
    expect(byKey.get("skilltool:skill:c")).toBeUndefined();
    expect(byKey.get("skilltool:skill:e")).toBeUndefined();
    expect(byKey.get("skilltool:cat:gone")).toBeUndefined();
    // root(1) + categories(ops, ai = 2) + skills(a, b, d = 3) = 6
    expect(model.elements).toHaveLength(6);
  });

  it("carries deterministic source keys and structured properties", () => {
    const d = byKey.get("skilltool:skill:d");
    expect(d?.properties?.sourceKey).toBe("SkillDefinition#d");
    expect(d?.properties?.assignmentCount).toBe(5);
    expect(byKey.get(SKILL_TOOLCHAIN_PACKAGE_KEY)?.properties?.skillCount).toBe(3);
  });

  it("emits composesFrom as traces edges, only to live known skills (self/unknown dropped)", () => {
    const traces = model.relationships.filter((r) => r.relSlug === "traces");
    expect(traces).toEqual([{ fromKey: "skilltool:skill:a", toKey: "skilltool:skill:b", relSlug: "traces" }]);
  });

  it("contains each category under root and each skill under its category", () => {
    const contains = model.relationships.filter((r) => r.relSlug === "contains");
    // root→ops, root→ai (2) + ops→a, ops→b, ai→d (3) = 5
    expect(contains).toHaveLength(5);
    expect(contains).toContainEqual({ fromKey: SKILL_TOOLCHAIN_PACKAGE_KEY, toKey: "skilltool:cat:ops", relSlug: "contains" });
    expect(contains).toContainEqual({ fromKey: "skilltool:cat:ai", toKey: "skilltool:skill:d", relSlug: "contains" });
  });

  it("declares its types and re-derives cleanly via soft-remove", () => {
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition"]);
    expect(model.relTypeSlugs).toEqual(["contains", "traces"]);
    expect(model.softRemovePrefix).toBe("skilltool:");
  });

  it("is order-independent (sorted) so a no-op run cannot thrash", () => {
    const shuffled = buildSkillToolchainModel([...SKILLS].reverse());
    expect(shuffled.elements.map((e) => e.sysmlKey)).toEqual(model.elements.map((e) => e.sysmlKey));
    expect(shuffled.relationships).toEqual(model.relationships);
  });
});
