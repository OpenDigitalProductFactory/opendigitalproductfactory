import { describe, expect, it } from "vitest";
import { buildCoworkerAuthorityModel, COWORKER_PACKAGE_KEY, type RegistryAgent } from "./coworker-authority-extract";

const AGENTS: RegistryAgent[] = [
  { agent_id: "AGT-ORCH-000", agent_name: "coo", tier: "orchestrator", value_stream: "cross-cutting", delegates_to: ["AGT-100", "AGT-UNKNOWN"], escalates_to: "HR-000", config_profile: { tool_grants: ["a", "b"] } },
  { agent_id: "AGT-100", agent_name: "portfolio", tier: "orchestrator", value_stream: "strategy", delegates_to: ["AGT-101"], escalates_to: "AGT-ORCH-000" },
  { agent_id: "AGT-101", agent_name: "spec", tier: "specialist", value_stream: "strategy" },
];

describe("buildCoworkerAuthorityModel", () => {
  const model = buildCoworkerAuthorityModel(AGENTS);
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));
  const connects = model.relationships.filter((r) => r.relSlug === "connects");

  it("emits a package plus one part_definition per coworker", () => {
    expect(byKey.get(COWORKER_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get("coworker:agent:AGT-100")?.typeSlug).toBe("part_definition");
    expect(model.elements).toHaveLength(4); // pkg + 3 agents
  });

  it("contains every coworker under the package", () => {
    const contains = model.relationships.filter((r) => r.relSlug === "contains" && r.fromKey === COWORKER_PACKAGE_KEY);
    expect(contains).toHaveLength(3);
  });

  it("draws delegation/escalation edges only to known registry agents", () => {
    expect(connects).toContainEqual({ fromKey: "coworker:agent:AGT-ORCH-000", toKey: "coworker:agent:AGT-100", relSlug: "connects" });
    expect(connects).toContainEqual({ fromKey: "coworker:agent:AGT-100", toKey: "coworker:agent:AGT-101", relSlug: "connects" });
    expect(connects).toContainEqual({ fromKey: "coworker:agent:AGT-100", toKey: "coworker:agent:AGT-ORCH-000", relSlug: "connects" });
    expect(connects).toHaveLength(3);
  });

  it("skips edges to unknown agents and to human supervisors (HR-*)", () => {
    const targets = connects.map((c) => c.toKey);
    expect(targets).not.toContain("coworker:agent:AGT-UNKNOWN");
    expect(targets.some((t) => t.includes("HR-"))).toBe(false);
  });

  it("captures authority attributes (tier, value stream, grant count) as properties", () => {
    const coo = byKey.get("coworker:agent:AGT-ORCH-000");
    expect(coo?.properties).toMatchObject({ tier: "orchestrator", valueStream: "cross-cutting", grantCount: 2 });
  });

  it("declares the element/relationship types and soft-remove prefix it needs", () => {
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition"]);
    expect(model.relTypeSlugs).toEqual(["contains", "connects"]);
    expect(model.softRemovePrefix).toBe("coworker:");
  });
});
