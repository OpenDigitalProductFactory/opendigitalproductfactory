import { describe, expect, it } from "vitest";
import { buildIntegrationModel, INTEGRATION_PACKAGE_KEY, type IntegrationFact } from "./integration-bridge-extract";

const integrations: IntegrationFact[] = [
  { integrationId: "adp", provider: "adp", status: "configured", lastTestedAt: null, certExpiresAt: null },
  { integrationId: "qb", provider: "quickbooks", status: "error", lastTestedAt: "2026-01-01T00:00:00.000Z", certExpiresAt: null },
];

describe("buildIntegrationModel", () => {
  const model = buildIntegrationModel(integrations);
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));

  it("projects each configured integration as a connected-application part", () => {
    expect(byKey.get(INTEGRATION_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get("integration:app:adp")?.typeSlug).toBe("part_definition");
    expect(byKey.get("integration:app:qb")?.properties?.provider).toBe("quickbooks");
    expect(byKey.get("integration:app:qb")?.properties?.status).toBe("error");
    expect(byKey.get("integration:app:qb")?.properties?.layer).toBe("integration");
    expect(model.elements).toHaveLength(3); // pkg + 2 apps
  });

  it("contains each connected app under the package", () => {
    const contains = model.relationships.filter((r) => r.relSlug === "contains");
    expect(contains).toHaveLength(2);
    expect(contains).toContainEqual({ fromKey: INTEGRATION_PACKAGE_KEY, toKey: "integration:app:adp", relSlug: "contains" });
  });

  it("declares rule-valid types and a soft-remove prefix", () => {
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition"]);
    expect(model.relTypeSlugs).toEqual(["contains"]);
    expect(model.softRemovePrefix).toBe("integration:");
  });
});
