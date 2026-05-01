import { describe, expect, it } from "vitest";
import { defaultGovernanceFor, defaultPromotionPolicyFor } from "./taxonomy-governance-defaults";

describe("defaultPromotionPolicyFor", () => {
  it("foundational root node gets mode:auto", () => {
    expect(defaultPromotionPolicyFor("foundational")).toEqual({ mode: "auto" });
  });

  it("foundational subtree gets mode:auto", () => {
    expect(defaultPromotionPolicyFor("foundational/compute/servers")).toEqual({ mode: "auto" });
    expect(defaultPromotionPolicyFor("foundational/data_and_storage_management/database")).toEqual({
      mode: "auto",
    });
  });

  it("foundational/network_management/* gets classifyAs: 'infrastructure_endpoint'", () => {
    expect(defaultPromotionPolicyFor("foundational/network_management/network_connectivity")).toEqual({
      mode: "auto",
      classifyAs: "infrastructure_endpoint",
    });
    expect(defaultPromotionPolicyFor("foundational/network_management")).toEqual({
      mode: "auto",
      classifyAs: "infrastructure_endpoint",
    });
  });

  it("non-foundational roots get mode:manual (no auto-discovery feed yet)", () => {
    expect(defaultPromotionPolicyFor("for_employees/devices/laptops")).toEqual({ mode: "manual" });
    expect(defaultPromotionPolicyFor("manufacturing_and_delivery/process")).toEqual({
      mode: "manual",
    });
    expect(defaultPromotionPolicyFor("products_and_services_sold/widget")).toEqual({
      mode: "manual",
    });
  });
});

describe("defaultGovernanceFor", () => {
  it("wraps the policy under .promotion", () => {
    expect(defaultGovernanceFor("foundational/compute/servers")).toEqual({
      promotion: { mode: "auto" },
    });
  });

  it("includes classifyAs when applicable", () => {
    expect(defaultGovernanceFor("foundational/network_management/access_point")).toEqual({
      promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" },
    });
  });
});
