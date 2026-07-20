import { describe, expect, it } from "vitest";

import { PROVIDER_COMPLIANCE_SOURCE_REGISTRY } from "@dpf/db/provider-compliance-source-registry";
import {
  validateProviderComplianceAnswer,
  type ProviderComplianceAnswerDraft,
} from "./provider-compliance-answer";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function draft(
  over: Partial<ProviderComplianceAnswerDraft> = {},
): ProviderComplianceAnswerDraft {
  return {
    directAnswer: "Only if the connected business account is verified.",
    practicalMeaning: "Keep customer records local until the account evidence is reviewed.",
    appliesTo: {
      providerId: "openai",
      service: "api-platform",
      accountClass: "business-team",
      jurisdiction: "uk",
      region: "uk",
      workload: "customer-records",
      dataClasses: ["personal-data"],
    },
    evidenceClaims: [
      {
        claimId: "claim-1",
        claim: "OpenAI states that API inputs and outputs are not used for training by default.",
        sourceKey: "openai/business-data-privacy",
        sourceClaimId: "openai-business-no-training-default",
        material: true,
      },
    ],
    organizationFactsUsed: [
      { fact: "The operator selected business account.", origin: "declared" },
      { fact: "The API credential passed a connectivity check.", origin: "technically-verified" },
    ],
    missingFacts: [],
    recommendation: "Review the account-scoped agreement before enabling customer records.",
    safeInterimBehavior: "Keep customer records local or blocked.",
    requiredReviewer: "privacy-or-procurement-owner",
    proposedPostureChange: null,
    ...over,
  };
}

describe("validateProviderComplianceAnswer", () => {
  it("substantiates a direct answer only from an exact authoritative source claim", () => {
    const result = validateProviderComplianceAnswer(draft(), { now: NOW });

    expect(result.answer.answerState).toBe("substantiated");
    expect(result.answer.directAnswer).toMatch(/^Only if/);
    expect(result.answer.evidenceClaims).toHaveLength(1);
    expect(result.answer.evidenceClaims[0]).toMatchObject({
      publisher: "OpenAI",
      sourceClaimId: "openai-business-no-training-default",
      authority: "first-party",
    });
    expect(result.answer.organizationFactsUsed.map((fact) => fact.origin)).toEqual([
      "declared",
      "technically-verified",
    ]);
  });

  it.each(["Maybe", "Probably", "It depends"])(
    "replaces a non-contract direct answer starting with %s",
    (directAnswer) => {
      const result = validateProviderComplianceAnswer(draft({ directAnswer }), { now: NOW });
      expect(result.answer.answerState).toBe("cannot_substantiate");
      expect(result.answer.directAnswer).toBe("Cannot confirm this yet.");
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid-direct-answer" }));
    },
  );

  it.each([
    ["unknown source", { sourceKey: "missing/source" }, "missing-source"],
    ["unsupported claim", { sourceClaimId: "not-in-the-source" }, "citation-mismatch"],
    ["wrong provider", { appliesTo: { ...draft().appliesTo, providerId: "anthropic" } }, "provider-mismatch"],
    ["wrong service", { appliesTo: { ...draft().appliesTo, service: "chatgpt-consumer" } }, "service-mismatch"],
    ["wrong account", { appliesTo: { ...draft().appliesTo, accountClass: "personal" } }, "account-mismatch"],
  ])("withholds a material claim for %s", (_label, mutation, issueCode) => {
    const base = draft();
    const answer = "appliesTo" in mutation
      ? draft({ appliesTo: mutation.appliesTo })
      : draft({
          evidenceClaims: [{ ...base.evidenceClaims[0]!, ...mutation }],
        });
    const result = validateProviderComplianceAnswer(answer, { now: NOW });

    expect(result.answer.answerState).toBe("cannot_substantiate");
    expect(result.answer.evidenceClaims).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: issueCode }));
    expect(result.answer.safeInterimBehavior).toMatch(/local|blocked/i);
  });

  it("withholds stale provider terms and requests corpus repair", () => {
    const staleSources = {
      ...PROVIDER_COMPLIANCE_SOURCE_REGISTRY,
      "openai/business-data-privacy": {
        ...PROVIDER_COMPLIANCE_SOURCE_REGISTRY["openai/business-data-privacy"],
        retrievedAt: "2025-01-01",
      },
    };
    const result = validateProviderComplianceAnswer(draft(), {
      now: NOW,
      sources: staleSources,
    });

    expect(result.answer.answerState).toBe("cannot_substantiate");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "stale-source" }));
    expect(result.gapReasons).toContain("stale-source");
  });

  it("treats an operator declaration as context, never proof of account entitlement", () => {
    const result = validateProviderComplianceAnswer(
      draft({
        evidenceClaims: [],
        organizationFactsUsed: [
          { fact: "The owner says this is an enterprise account.", origin: "declared" },
        ],
      }),
      { now: NOW },
    );

    expect(result.answer.answerState).toBe("cannot_substantiate");
    expect(result.answer.organizationFactsUsed[0]?.origin).toBe("declared");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "missing-material-evidence" }));
  });

  it("downgrades a partly grounded answer to conditional and asks one smallest question", () => {
    const result = validateProviderComplianceAnswer(
      draft({
        missingFacts: ["The connected account class is not technically verified."],
        followUpQuestion: "Is this credential linked to the reviewed business API organization?",
      }),
      { now: NOW },
    );

    expect(result.answer.answerState).toBe("conditional");
    expect(result.answer.directAnswer).toMatch(/^Only if/);
    expect(result.answer.followUpQuestion).toBe(
      "Is this credential linked to the reviewed business API organization?",
    );
  });

  it("surfaces conflicting current evidence instead of choosing a convenient source", () => {
    const sources = {
      ...PROVIDER_COMPLIANCE_SOURCE_REGISTRY,
      "test/terms-a": {
        ...PROVIDER_COMPLIANCE_SOURCE_REGISTRY["openai/business-data-privacy"],
        sourceKey: "test/terms-a",
        claims: [{
          ...PROVIDER_COMPLIANCE_SOURCE_REGISTRY["openai/business-data-privacy"].claims[0],
          claimId: "terms-a",
          conflictKey: "training-treatment",
          position: "excluded",
        }],
      },
      "test/terms-b": {
        ...PROVIDER_COMPLIANCE_SOURCE_REGISTRY["openai/business-data-privacy"],
        sourceKey: "test/terms-b",
        claims: [{
          ...PROVIDER_COMPLIANCE_SOURCE_REGISTRY["openai/business-data-privacy"].claims[0],
          claimId: "terms-b",
          conflictKey: "training-treatment",
          position: "included",
        }],
      },
    };
    const evidenceClaims = [
      { claimId: "a", claim: "Training excluded.", sourceKey: "test/terms-a", sourceClaimId: "terms-a", material: true },
      { claimId: "b", claim: "Training included.", sourceKey: "test/terms-b", sourceClaimId: "terms-b", material: true },
    ];
    const result = validateProviderComplianceAnswer(draft({ evidenceClaims }), { now: NOW, sources });

    expect(result.answer.answerState).toBe("cannot_substantiate");
    expect(result.answer.evidenceClaims).toEqual([]);
    expect(result.gapReasons).toContain("conflicting-evidence");
  });

  it("never applies a proposed provider-posture change from an answer", () => {
    const result = validateProviderComplianceAnswer(
      draft({ proposedPostureChange: { effect: "allow", providerId: "openai" } }),
      { now: NOW },
    );

    expect(result.answer.proposedPostureChange).toEqual({ effect: "allow", providerId: "openai" });
    expect(result.policyMutationAllowed).toBe(false);
  });

  it.each([
    ["customer", "customer-records"],
    ["employment", "employee-records"],
    ["health", "health-records"],
    ["finance", "financial-records"],
    ["public sector", "public-sector-records"],
  ])("grounds the %s golden case in the applicable EU legal claim", (_label, workload) => {
    const result = validateProviderComplianceAnswer(draft({
      appliesTo: {
        ...draft().appliesTo,
        jurisdiction: "eu",
        region: "eu",
        workload,
      },
      evidenceClaims: [{
        claimId: `eu-${workload}`,
        claim: "A binding processor contract is required for this processing.",
        sourceKey: "eu/gdpr-controller-processor-and-transfers",
        sourceClaimId: "eu-controller-processor-contract-required",
        material: true,
      }],
    }), { now: NOW });

    expect(result.answer.answerState).toBe("substantiated");
    expect(result.answer.evidenceClaims[0]?.publisher).toBe("European Union");
  });

  it.each([
    ["personal provider account", { accountClass: "personal" }, "account-mismatch"],
    ["similarly named consumer service", { service: "chatgpt-consumer" }, "service-mismatch"],
  ])("abstains for the adversarial %s case", (_label, scope, issueCode) => {
    const result = validateProviderComplianceAnswer(draft({
      appliesTo: { ...draft().appliesTo, ...scope },
    }), { now: NOW });
    expect(result.answer.answerState).toBe("cannot_substantiate");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: issueCode }));
  });

  it("treats local-only operation as a safety posture, not proof of compliance", () => {
    const result = validateProviderComplianceAnswer(draft({
      appliesTo: { ...draft().appliesTo, providerId: "local", service: "local-model", accountClass: "local" },
      evidenceClaims: [],
      directAnswer: "Cannot confirm this yet.",
      missingFacts: ["Applicable law and operational controls still require review."],
    }), { now: NOW });
    expect(result.answer.answerState).toBe("cannot_substantiate");
    expect(result.policyMutationAllowed).toBe(false);
  });
});
