import { describe, expect, it } from "vitest";

import type { DataExecutablePolicy } from "@/lib/govern/data/executable-policies";
import { classifyInferencePayload } from "./classify-payload";
import { evaluateInferenceDispatchPolicy } from "./evaluate-inference-policy";

function classifyPrompt(systemPrompt: string) {
  return classifyInferencePayload({
    systemPrompt,
    messages: [{ role: "user", content: "Help with this request." }],
  });
}

describe("evaluateInferenceDispatchPolicy", () => {
  it("allows external dispatch when no governed or sensitive payload is detected", () => {
    const result = evaluateInferenceDispatchPolicy({
      organizationId: "org-1",
      classification: classifyPrompt("Draft a friendly public event announcement."),
      destinationClass: "external-service",
      purpose: "coworker-assistance",
    });

    expect(result.pepKind).toBe("inference-dispatch");
    expect(result.effect).toBe("allow");
    expect(result.decisionIds).toEqual([]);
    expect(result.explanationCodes).toEqual(["no-governed-payload-detected"]);
  });

  it("denies restricted external dispatch and keeps raw values out of the result", () => {
    const secretCanary = ["sk", "test", "restrictedpayload12345"].join("-");
    const classification = classifyInferencePayload({
      systemPrompt: "Summarize this integration incident.",
      messages: [{ role: "user", content: `The leaked provider token was ${secretCanary}.` }],
    });

    const result = evaluateInferenceDispatchPolicy({
      organizationId: "org-1",
      classification,
      destinationClass: "external-service",
      purpose: "security-and-fraud",
    });

    expect(result.effect).toBe("deny");
    expect(result.explanationCodes).toContain("restricted-cannot-leave-boundary");
    expect(JSON.stringify(result)).not.toContain(secretCanary);
  });

  it("denies unknown governed data before external dispatch", () => {
    const governedData = [{
      assetId: "data:customer-account",
      fieldIds: ["data:customer-account#emailAddress"],
      classificationKnown: false,
      purpose: "customer-support",
    }];
    const classification = classifyInferencePayload({
      systemPrompt: "Explain this customer escalation.",
      messages: [{ role: "user", content: "The account has conflicting history." }],
      governedData,
    });

    const result = evaluateInferenceDispatchPolicy({
      organizationId: "org-1",
      classification,
      governedData,
      destinationClass: "external-service",
      purpose: "customer-support",
    });

    expect(result.effect).toBe("deny");
    expect(result.explanationCodes).toContain("unknown-context-high-risk");
    expect(JSON.stringify(result)).not.toContain("emailAddress");
  });

  it("allows confidential external dispatch only when policy obligations are enforceable", () => {
    const policies: DataExecutablePolicy[] = [{
      id: "confidential-ai-export-with-controls",
      version: "1",
      precedenceLevel: "organization-policy",
      match: {
        actions: ["export"],
        sensitivities: ["confidential"],
        destinations: ["external-service"],
        purposes: ["customer-support"],
      },
      effect: "allow-with-obligations",
      obligations: [
        { kind: "mask", profileId: "default-confidential" },
        { kind: "destination", allowedClasses: ["external-service"] },
        { kind: "log-use", evidenceClass: "inference-dispatch", minimumRetentionClass: "telemetry-bounded" },
      ],
      explanationCode: "confidential-ai-export-controlled",
      effectiveFrom: "2026-07-26",
    }];

    const result = evaluateInferenceDispatchPolicy({
      organizationId: "org-1",
      classification: classifyPrompt("Help with customer jane@example.test and her support case."),
      destinationClass: "external-service",
      purpose: "customer-support",
      policies,
    });

    expect(result.effect).toBe("allow-with-obligations");
    expect(result.obligations.map((obligation) => obligation.kind).sort()).toEqual([
      "destination",
      "log-use",
      "mask",
    ]);
  });

  it("fails closed when a policy attaches an obligation inference dispatch cannot enforce", () => {
    const policies: DataExecutablePolicy[] = [{
      id: "bad-dispatch-obligation",
      version: "1",
      precedenceLevel: "organization-policy",
      match: {
        actions: ["export"],
        sensitivities: ["confidential"],
        destinations: ["external-service"],
      },
      effect: "allow-with-obligations",
      obligations: [{ kind: "delete-derived-copy", contractIds: ["contract-1"], deadlineSeconds: 60 }],
      explanationCode: "bad-obligation",
      effectiveFrom: "2026-07-26",
    }];

    const result = evaluateInferenceDispatchPolicy({
      organizationId: "org-1",
      classification: classifyPrompt("Help with customer jane@example.test and her support case."),
      destinationClass: "external-service",
      purpose: "customer-support",
      policies,
    });

    expect(result.effect).toBe("deny");
    expect(result.explanationCodes).toContain("inference-pep-obligation-unenforceable");
  });

  it("allows protected clinical data only with pack obligations and version evidence", () => {
    const classification = classifyInferencePayload({
      systemPrompt: "",
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "call-health",
          name: "summarize",
          arguments: { patientDiagnosis: "masked-fixture" },
        }],
      }],
    });

    const result = evaluateInferenceDispatchPolicy({
      organizationId: "org-1",
      classification,
      destinationClass: "external-service",
      transformation: "tokenized",
    });

    expect(result.effect).toBe("allow-with-obligations");
    expect(result.obligations.map((obligation) => obligation.kind)).toContain("log-use");
    expect(result.policyPackVersions).toContain("vertical-health-phi@1.0.0");
  });

  it.each([
    ["legal-privileged", "attorneyClientPrivilege", "review"],
    ["youth-sensitive", "parentalConsent", "review"],
    ["safety-sensitive", "threatAssessment", "review"],
    ["criminal-justice", "criminalJusticeInformation", "deny"],
    ["secrets-credentials", "accessToken", "deny"],
  ] as const)(
    "keeps protected %s data behind its %s boundary",
    (dataClass, field, expectedEffect) => {
      const classification = classifyInferencePayload({
        systemPrompt: "",
        messages: [{
          role: "assistant",
          content: "",
          toolCalls: [{
            id: "call-boundary",
            name: "inspect",
            arguments: { [field]: "regulated-fixture" },
          }],
        }],
      });

      const result = evaluateInferenceDispatchPolicy({
        organizationId: "org-1",
        classification,
        destinationClass: "external-service",
        transformation: "tokenized",
      });

      expect(classification.dataClasses).toContain(dataClass);
      expect(result.effect).toBe(expectedEffect);
      expect(result.policyPackVersions).toContain(`vertical-${dataClass}@1.0.0`);
    },
  );

  it("combines mixed-class decisions by strongest effect instead of pack order", () => {
    const classification = classifyInferencePayload({
      systemPrompt: "",
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "call-mixed",
          name: "inspect",
          arguments: {
            customerEmail: "masked@example.test",
            attorneyClientPrivilege: "privileged-fixture",
          },
        }],
      }],
    });

    const result = evaluateInferenceDispatchPolicy({
      organizationId: "org-1",
      classification,
      destinationClass: "external-service",
      transformation: "masked",
    });

    expect(result.effect).toBe("review");
    expect(result.decisions).toHaveLength(2);
    expect(result.policyPackVersions).toEqual([
      "vertical-customer-records@1.0.0",
      "vertical-legal-privileged@1.0.0",
    ]);
  });
});
