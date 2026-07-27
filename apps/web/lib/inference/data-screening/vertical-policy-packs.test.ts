import { describe, expect, it } from "vitest";

import { assertBundleEnforceable } from "@/lib/govern/data/policy-enforcement";
import { aiWorkloadDataBindingFor } from "@/lib/routing/provider-suitability/workload-profile";
import type { InferenceDataClass } from "./types";
import {
  VERTICAL_SENSITIVE_DATA_POLICY_PACKS,
  getVerticalSensitiveDataPolicyPack,
  policyPackVersionsForClasses,
  verticalSensitiveDataPoliciesForClasses,
} from "./vertical-policy-packs";

const EXPECTED_CLASSES: InferenceDataClass[] = [
  "criminal-justice",
  "customer-records",
  "employee-records",
  "health-phi",
  "legal-privileged",
  "payments-finance",
  "public-sector-records",
  "regulated-decisioning",
  "safety-sensitive",
  "secrets-credentials",
  "security-logs",
  "source-code",
  "student-records",
  "unknown-governed-data",
  "youth-sensitive",
];

describe("vertical sensitive-data policy packs", () => {
  it("covers every governed inference class with one unique versioned pack", () => {
    expect(VERTICAL_SENSITIVE_DATA_POLICY_PACKS.map((pack) => pack.dataClass).sort())
      .toEqual(EXPECTED_CLASSES);
    expect(new Set(VERTICAL_SENSITIVE_DATA_POLICY_PACKS.map((pack) => pack.id)).size)
      .toBe(VERTICAL_SENSITIVE_DATA_POLICY_PACKS.length);
    expect(new Set(VERTICAL_SENSITIVE_DATA_POLICY_PACKS.map(
      (pack) => `${pack.id}@${pack.version}`,
    )).size).toBe(VERTICAL_SENSITIVE_DATA_POLICY_PACKS.length);
  });

  it("reuses the canonical provider-suitability profile for every known workload class", () => {
    for (const pack of VERTICAL_SENSITIVE_DATA_POLICY_PACKS) {
      if (pack.dataClass === "unknown-governed-data") continue;
      const binding = aiWorkloadDataBindingFor(pack.dataClass);
      expect(pack.assetId).toBe(binding.assetId);
      expect(pack.sensitivity).toBe(binding.sensitivity);
      expect(pack.categories).toEqual(binding.categories);
    }
  });

  it("keeps credentials, criminal-justice information, and unknown data off external providers", () => {
    for (const dataClass of [
      "criminal-justice",
      "secrets-credentials",
      "unknown-governed-data",
    ] as const) {
      expect(getVerticalSensitiveDataPolicyPack(dataClass)).toMatchObject({
        publicProviderEligibility: "never",
        protectedExternalEffect: "deny",
      });
    }
  });

  it("requires review for legal, youth, safety, public-sector, and regulated decisions", () => {
    for (const dataClass of [
      "legal-privileged",
      "youth-sensitive",
      "safety-sensitive",
      "public-sector-records",
      "regulated-decisioning",
    ] as const) {
      expect(getVerticalSensitiveDataPolicyPack(dataClass)).toMatchObject({
        publicProviderEligibility: "never",
        protectedExternalEffect: "review",
      });
    }
  });

  it("provides enforceable policies and stable version evidence without duplicates", () => {
    const policies = verticalSensitiveDataPoliciesForClasses(EXPECTED_CLASSES);
    expect(() => assertBundleEnforceable(policies)).not.toThrow();
    expect(new Set(policies.map((policy) => policy.id)).size).toBe(policies.length);
    expect(policyPackVersionsForClasses([
      "health-phi",
      "health-phi",
      "customer-records",
    ])).toEqual([
      "vertical-customer-records@1.0.0",
      "vertical-health-phi@1.0.0",
    ]);
  });

  it("carries authority, retention, masking, refusal, and provider-evidence guidance", () => {
    for (const pack of VERTICAL_SENSITIVE_DATA_POLICY_PACKS) {
      expect(pack.authorityRefs.length).toBeGreaterThan(0);
      expect(pack.retentionPromptCode).toMatch(/^retention-/);
      expect(pack.refusalCode).toMatch(/^boundary-/);
      expect(pack.maskingEligibility).toMatch(/^(allowed|conditional|prohibited)$/);
      expect(pack.requiredProviderEvidence.length).toBeGreaterThan(0);
    }
  });
});
