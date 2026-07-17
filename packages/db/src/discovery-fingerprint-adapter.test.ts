import { describe, expect, it } from "vitest";
import { matchInventoryEntity, type AdapterRule } from "./discovery-fingerprint-adapter";

const baseRule: AdapterRule = {
  id: "r_1",
  ruleKey: "rule.foundational.postgres",
  status: "active",
  matchExpression: {
    all: [{ type: "contains", path: "image", value: "postgres" }],
  },
  requiredEvidenceFamilies: ["container_image"],
  taxonomyNodeId: "tn_db",
  identityConfidence: 0.9,
  taxonomyConfidence: 0.85,
  resolvedIdentity: {
    kind: "software",
    name: "PostgreSQL",
    vendor: "PostgreSQL Global Development Group",
    model: "PostgreSQL",
    deviceClass: "relational_database",
  },
};

const obsPostgres = {
  evidenceFamilies: ["container_image"],
  normalizedEvidence: { image: "postgres:16-alpine" },
};

describe("matchInventoryEntity", () => {
  it("returns null when no rules match", () => {
    const noMatchRule: AdapterRule = {
      ...baseRule,
      matchExpression: { all: [{ type: "exact", path: "image", value: "redis" }] },
    };
    expect(matchInventoryEntity(obsPostgres, { rules: [noMatchRule] })).toBeNull();
  });

  it("returns the matched rule's identity + taxonomy", () => {
    const result = matchInventoryEntity(obsPostgres, { rules: [baseRule] });
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("r_1");
    expect(result!.ruleKey).toBe("rule.foundational.postgres");
    expect(result!.taxonomyNodeId).toBe("tn_db");
    expect(result!.resolvedIdentity.vendor).toBe("PostgreSQL Global Development Group");
    expect(result!.resolvedIdentity.name).toBe("PostgreSQL");
    expect(result!.resolvedIdentity.deviceClass).toBe("relational_database");
    expect(result!.combinedConfidence).toBeCloseTo(1.75);
  });

  it("carries the rule's catalogIdentityId through the match (BI-27EE2AF7)", () => {
    const linked: AdapterRule = { ...baseRule, catalogIdentityId: "ci_postgres" };
    expect(matchInventoryEntity(obsPostgres, { rules: [linked] })!.catalogIdentityId).toBe("ci_postgres");
    // A rule not yet linked to the identity spine yields a null catalogIdentityId.
    expect(matchInventoryEntity(obsPostgres, { rules: [baseRule] })!.catalogIdentityId).toBeNull();
  });

  it("returns the highest-combined-confidence match when multiple match", () => {
    const lowConfRule: AdapterRule = {
      ...baseRule,
      id: "r_low",
      ruleKey: "rule.generic.db",
      identityConfidence: 0.5,
      taxonomyConfidence: 0.5,
      taxonomyNodeId: "tn_generic_db",
      resolvedIdentity: { kind: "software", name: "Generic Database", deviceClass: "database" },
    };
    const result = matchInventoryEntity(obsPostgres, { rules: [lowConfRule, baseRule] });
    expect(result!.ruleId).toBe("r_1");
    expect(result!.taxonomyNodeId).toBe("tn_db");
  });

  it("ignores rules whose status is not 'active'", () => {
    const draftRule: AdapterRule = { ...baseRule, status: "draft" };
    const deprecatedRule: AdapterRule = { ...baseRule, id: "r_dep", status: "deprecated" };
    expect(matchInventoryEntity(obsPostgres, { rules: [draftRule, deprecatedRule] })).toBeNull();
  });

  it("respects requiredEvidenceFamilies — rule whose required family is absent does not match", () => {
    const ruleNeedsBanner: AdapterRule = {
      ...baseRule,
      requiredEvidenceFamilies: ["banner_grab"],
    };
    // observation only has "container_image", not "banner_grab"
    expect(matchInventoryEntity(obsPostgres, { rules: [ruleNeedsBanner] })).toBeNull();
  });

  it("returns null when rules list is empty", () => {
    expect(matchInventoryEntity(obsPostgres, { rules: [] })).toBeNull();
  });

  it("carries the resolvedIdentity through, omitting absent optional fields", () => {
    const partialRule: AdapterRule = {
      ...baseRule,
      resolvedIdentity: { kind: "device", name: "Acme Thing", vendor: "Acme" },
    };
    const result = matchInventoryEntity(obsPostgres, { rules: [partialRule] });
    expect(result!.resolvedIdentity.vendor).toBe("Acme");
    expect(result!.resolvedIdentity.model).toBeUndefined();
    expect(result!.resolvedIdentity.deviceClass).toBeUndefined();
  });

  it("breaks ties by preferring the earlier rule in the input list", () => {
    const firstRule: AdapterRule = {
      ...baseRule,
      id: "r_first",
      ruleKey: "rule.first",
      identityConfidence: 0.5,
      taxonomyConfidence: 0.5,
    };
    const secondRule: AdapterRule = {
      ...baseRule,
      id: "r_second",
      ruleKey: "rule.second",
      identityConfidence: 0.5,
      taxonomyConfidence: 0.5,
    };
    // Both match obsPostgres; both have combinedConfidence = 1.0. First wins.
    const result = matchInventoryEntity(obsPostgres, { rules: [firstRule, secondRule] });
    expect(result!.ruleId).toBe("r_first");
    // Reversing the order flips the winner — confirms tiebreak is positional.
    const reversed = matchInventoryEntity(obsPostgres, { rules: [secondRule, firstRule] });
    expect(reversed!.ruleId).toBe("r_second");
  });

  it("returns a match with taxonomyNodeId: null for identity-only rules (taxonomy gap)", () => {
    const identityOnlyRule: AdapterRule = {
      ...baseRule,
      id: "r_identity_only",
      ruleKey: "rule.identity_only",
      taxonomyNodeId: null,
      taxonomyConfidence: 0,
    };
    const result = matchInventoryEntity(obsPostgres, { rules: [identityOnlyRule] });
    expect(result).not.toBeNull();
    expect(result!.taxonomyNodeId).toBeNull();
    expect(result!.resolvedIdentity.vendor).toBe("PostgreSQL Global Development Group");
    // Combined confidence still derived from sum, just with taxonomy=0.
    expect(result!.combinedConfidence).toBeCloseTo(0.9);
  });
});
