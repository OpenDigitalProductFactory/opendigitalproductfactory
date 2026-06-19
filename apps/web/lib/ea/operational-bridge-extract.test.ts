import { describe, expect, it } from "vitest";
import { buildOperationalGraphModel, OPERATIONAL_PACKAGE_KEY, serviceOf, type RuntimeTargetFact } from "./operational-bridge-extract";

function t(p: Partial<RuntimeTargetFact> & { targetId: string }): RuntimeTargetFact {
  return {
    kind: "portal", status: "healthy", serviceName: "portal", containerName: null,
    hostUrl: null, serviceVersion: null, port: null, lastHeartbeatAt: null, ...p,
  };
}

const TARGETS: RuntimeTargetFact[] = [
  t({ targetId: "a", serviceName: "portal" }),
  t({ targetId: "b", serviceName: "portal" }),
  t({ targetId: "c", serviceName: "sandbox", kind: "sandbox" }),
  t({ targetId: "d", serviceName: null, kind: "edge" }), // service derived from kind
];

describe("buildOperationalGraphModel", () => {
  const model = buildOperationalGraphModel(TARGETS);
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));

  it("groups actual runtime instances under their logical service", () => {
    expect(byKey.get(OPERATIONAL_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get("operational:service:portal")?.typeSlug).toBe("part_definition");
    expect(byKey.get("operational:service:sandbox")?.typeSlug).toBe("part_definition");
    expect(byKey.get("operational:service:edge")?.typeSlug).toBe("part_definition"); // from kind
    expect(byKey.get("operational:instance:a")?.typeSlug).toBe("part_usage");
    expect(byKey.get("operational:instance:a")?.properties?.refinementLevel).toBe("actual");
    expect(byKey.get("operational:instance:a")?.properties?.layer).toBe("operational");
    // pkg + 3 services + 4 instances = 8
    expect(model.elements).toHaveLength(8);
  });

  it("contains services under the package and instances under their service", () => {
    const contains = model.relationships.filter((r) => r.relSlug === "contains");
    expect(contains).toContainEqual({ fromKey: OPERATIONAL_PACKAGE_KEY, toKey: "operational:service:portal", relSlug: "contains" });
    expect(contains).toContainEqual({ fromKey: "operational:service:portal", toKey: "operational:instance:a", relSlug: "contains" });
    expect(contains).toHaveLength(7); // 3 service + 4 instance
  });

  it("declares rule-valid types and a soft-remove prefix", () => {
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition", "part_usage"]);
    expect(model.relTypeSlugs).toEqual(["contains", "traces"]);
    expect(model.softRemovePrefix).toBe("operational:");
  });

  it("traces each actual instance to the RuntimeTarget data-model element (cross-layer)", () => {
    // one traces edge per instance → prisma:model:RuntimeTarget; resolved by the applier
    expect(model.crossLayerRelationships).toEqual([
      { fromKey: "operational:instance:d", toKey: "prisma:model:RuntimeTarget", relSlug: "traces" }, // service "edge"
      { fromKey: "operational:instance:a", toKey: "prisma:model:RuntimeTarget", relSlug: "traces" },
      { fromKey: "operational:instance:b", toKey: "prisma:model:RuntimeTarget", relSlug: "traces" },
      { fromKey: "operational:instance:c", toKey: "prisma:model:RuntimeTarget", relSlug: "traces" },
    ]);
  });

  it("serviceOf falls back to kind when serviceName is blank", () => {
    expect(serviceOf(t({ targetId: "x", serviceName: null, kind: "edge" }))).toBe("edge");
    expect(serviceOf(t({ targetId: "y", serviceName: "  ", kind: "edge" }))).toBe("edge");
    expect(serviceOf(t({ targetId: "z", serviceName: "portal" }))).toBe("portal");
  });

  it("is order-independent so a no-op run cannot thrash", () => {
    const reversed = buildOperationalGraphModel([...TARGETS].reverse());
    expect(reversed.elements.map((e) => e.sysmlKey)).toEqual(model.elements.map((e) => e.sysmlKey));
  });
});
