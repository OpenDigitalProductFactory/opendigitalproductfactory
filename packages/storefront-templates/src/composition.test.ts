import { describe, expect, it } from "vitest";
import { mergeActivationProfiles } from "./composition";
import type { ActivationProfile, CapabilityOverride, SeededConfigurationItemType } from "./types";

const base: ActivationProfile = {
  profileType: "standard",
  modules: ["projects"],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
};

const override = (
  capabilityKey: string,
  applicability: CapabilityOverride["applicability"],
): CapabilityOverride => ({ capabilityKey, applicability, reason: "test" });

const itemType = (key: string, label = key): SeededConfigurationItemType => ({
  key,
  label,
  technologySourceType: "commercial",
});

describe("mergeActivationProfiles", () => {
  it("throws on empty input", () => {
    expect(() => mergeActivationProfiles([])).toThrow("mergeActivationProfiles: empty");
  });

  it("returns primary unchanged when there are no secondaries", () => {
    const result = mergeActivationProfiles([base]);
    expect(result).toBe(base);
  });

  it("unions modules from primary and secondary", () => {
    const secondary: ActivationProfile = {
      ...base,
      modules: ["billing-readiness", "integrations"],
    };
    const result = mergeActivationProfiles([base, secondary]);
    expect(result.modules).toContain("projects");
    expect(result.modules).toContain("billing-readiness");
    expect(result.modules).toContain("integrations");
    expect(result.modules).toHaveLength(3);
  });

  it("deduplicates modules shared across profiles", () => {
    const secondary: ActivationProfile = { ...base, modules: ["projects", "lifecycle-signals"] };
    const result = mergeActivationProfiles([base, secondary]);
    const projectsCount = result.modules.filter((m) => m === "projects").length;
    expect(projectsCount).toBe(1);
    expect(result.modules).toContain("lifecycle-signals");
  });

  describe("monotonic escalation", () => {
    it("escalates billingReadinessMode when any secondary requires prepared-not-prescribed", () => {
      const secondary: ActivationProfile = {
        ...base,
        billingReadinessMode: "prepared-not-prescribed",
      };
      const result = mergeActivationProfiles([base, secondary]);
      expect(result.billingReadinessMode).toBe("prepared-not-prescribed");
    });

    it("keeps none when no profile requires prepared-not-prescribed", () => {
      const secondary: ActivationProfile = { ...base, billingReadinessMode: "none" };
      const result = mergeActivationProfiles([base, secondary]);
      expect(result.billingReadinessMode).toBe("none");
    });

    it("escalates customerGraph when any secondary requires separate-customer-projection", () => {
      const secondary: ActivationProfile = {
        ...base,
        customerGraph: "separate-customer-projection",
      };
      const result = mergeActivationProfiles([base, secondary]);
      expect(result.customerGraph).toBe("separate-customer-projection");
    });

    it("escalates estateSeparation when any secondary requires strict", () => {
      const secondary: ActivationProfile = { ...base, estateSeparation: "strict" };
      const result = mergeActivationProfiles([base, secondary]);
      expect(result.estateSeparation).toBe("strict");
    });

    it("escalates correctly across three profiles", () => {
      const p1: ActivationProfile = { ...base, billingReadinessMode: "none" };
      const p2: ActivationProfile = { ...base, customerGraph: "none" };
      const p3: ActivationProfile = {
        ...base,
        billingReadinessMode: "prepared-not-prescribed",
        customerGraph: "separate-customer-projection",
        estateSeparation: "strict",
      };
      const result = mergeActivationProfiles([p1, p2, p3]);
      expect(result.billingReadinessMode).toBe("prepared-not-prescribed");
      expect(result.customerGraph).toBe("separate-customer-projection");
      expect(result.estateSeparation).toBe("strict");
    });
  });

  describe("capabilityOverrides", () => {
    it("returns no overrides when neither profile has any", () => {
      const secondary: ActivationProfile = { ...base, modules: ["billing-readiness"] };
      const result = mergeActivationProfiles([base, secondary]);
      expect(result.capabilityOverrides).toBeUndefined();
    });

    it("includes all primary overrides", () => {
      const primary: ActivationProfile = {
        ...base,
        capabilityOverrides: [override("partner-channel", "required")],
      };
      const secondary: ActivationProfile = { ...base, modules: ["billing-readiness"] };
      const result = mergeActivationProfiles([primary, secondary]);
      expect(result.capabilityOverrides?.map((o) => o.capabilityKey)).toEqual(["partner-channel"]);
    });

    it("primary wins on key conflict", () => {
      const primary: ActivationProfile = {
        ...base,
        capabilityOverrides: [override("partner-channel", "not-applicable")],
      };
      const secondary: ActivationProfile = {
        ...base,
        capabilityOverrides: [override("partner-channel", "required")],
      };
      const result = mergeActivationProfiles([primary, secondary]);
      const found = result.capabilityOverrides?.find((o) => o.capabilityKey === "partner-channel");
      expect(found?.applicability).toBe("not-applicable");
      expect(result.capabilityOverrides).toHaveLength(1);
    });

    it("secondary adds overrides for keys not in primary", () => {
      const primary: ActivationProfile = {
        ...base,
        capabilityOverrides: [override("partner-channel", "not-applicable")],
      };
      const secondary: ActivationProfile = {
        ...base,
        capabilityOverrides: [override("rental-fleet", "required")],
      };
      const result = mergeActivationProfiles([primary, secondary]);
      expect(result.capabilityOverrides).toHaveLength(2);
      expect(result.capabilityOverrides?.map((o) => o.capabilityKey)).toContain("rental-fleet");
    });
  });

  describe("seeded catalogue entries", () => {
    it("unions seededServiceCategories", () => {
      const primary: ActivationProfile = {
        ...base,
        seededServiceCategories: ["consulting", "strategy"],
      };
      const secondary: ActivationProfile = {
        ...base,
        seededServiceCategories: ["strategy", "training"],
      };
      const result = mergeActivationProfiles([primary, secondary]);
      expect(result.seededServiceCategories).toContain("consulting");
      expect(result.seededServiceCategories).toContain("strategy");
      expect(result.seededServiceCategories).toContain("training");
      const strategyCount = (result.seededServiceCategories ?? []).filter(
        (c) => c === "strategy",
      ).length;
      expect(strategyCount).toBe(1);
    });

    it("deduplicates seededConfigurationItemTypes by key with primary winning", () => {
      const primary: ActivationProfile = {
        ...base,
        seededConfigurationItemTypes: [itemType("project-type", "Project Type")],
      };
      const secondary: ActivationProfile = {
        ...base,
        seededConfigurationItemTypes: [
          itemType("project-type", "Secondary Label"),
          itemType("build-stage"),
        ],
      };
      const result = mergeActivationProfiles([primary, secondary]);
      const found = result.seededConfigurationItemTypes?.find((t) => t.key === "project-type");
      expect(found?.label).toBe("Project Type");
      expect(result.seededConfigurationItemTypes?.some((t) => t.key === "build-stage")).toBe(true);
    });
  });

  it("preserves primary scalar fields not explicitly merged", () => {
    const primary: ActivationProfile = {
      ...base,
      profileType: "managed-service-provider",
    };
    const secondary: ActivationProfile = { ...base, modules: ["integrations"] };
    const result = mergeActivationProfiles([primary, secondary]);
    expect(result.profileType).toBe("managed-service-provider");
  });

  it("composes process semantics monotonically with primary resource precedence", () => {
    const primary: ActivationProfile = {
      ...base,
      processProfile: {
        catalogModes: ["priced"],
        subjectTypes: ["patient-profile"],
        housesSubjects: false,
        schedulesSubjects: true,
        resourceKinds: [
          { kindSlug: "table", capacityUnit: "seats", maxCapacity: 100 },
        ],
      },
    };
    const secondary: ActivationProfile = {
      ...base,
      processProfile: {
        catalogModes: ["donation", "unpriced"],
        subjectTypes: ["animal", "patient-profile"],
        housesSubjects: true,
        schedulesSubjects: false,
        resourceKinds: [
          { kindSlug: "table", capacityUnit: "covers", maxCapacity: 20 },
          { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
        ],
      },
    };

    expect(mergeActivationProfiles([primary, secondary]).processProfile).toEqual({
      catalogModes: ["priced", "donation", "unpriced"],
      subjectTypes: ["patient-profile", "animal"],
      housesSubjects: true,
      schedulesSubjects: true,
      resourceKinds: [
        { kindSlug: "table", capacityUnit: "seats", maxCapacity: 100 },
        { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
      ],
    });
  });
});
