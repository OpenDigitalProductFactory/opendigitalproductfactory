import { describe, expect, it } from "vitest";
import { screenInferencePayload } from "./screen-inference-payload";

describe("screenInferencePayload", () => {
  it("leaves ordinary payloads eligible for normal routing", () => {
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Draft a short welcome note." }],
      systemPrompt: "You help with ordinary writing.",
      taskType: "creative",
      routeContext: { sensitivity: "internal" },
    });

    expect(result.routeContext).toMatchObject({ sensitivity: "internal" });
    expect(result.routeContext.residencyPolicy).toBeUndefined();
    expect(result.receipt).toMatchObject({
      policyEffect: "allow",
      routeEffect: "allow",
      classifiedDataClasses: [],
      rawPayloadStored: false,
    });
  });

  it("constrains restricted external payloads to local-only routing without storing raw values", () => {
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Review employee payroll and disciplinary notes for Jane." }],
      systemPrompt: "You help with employee records.",
      taskType: "summarization",
      routeContext: {
        sensitivity: "internal",
        residencyPolicy: "any_enabled",
        allowedProviders: [" openai ", "openai", "local"],
      },
    });

    expect(result.routeContext).toMatchObject({
      sensitivity: "restricted",
      residencyPolicy: "local_only",
      allowedProviders: ["local"],
    });
    expect(result.receipt).toMatchObject({
      schemaVersion: "inference-data-screen/v1",
      policyEffect: "deny",
      routeEffect: "local-only",
      classifiedDataClasses: expect.arrayContaining(["employee-records", "payments-finance"]),
      explanationCodes: expect.arrayContaining(["restricted-cannot-leave-boundary"]),
      rawPayloadStored: false,
    });
    expect(JSON.stringify(result.receipt)).not.toContain("Jane");
  });

  it("treats activity governed-data hints without classification as unknown governed payload", () => {
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Summarize the selected records." }],
      systemPrompt: "",
      taskType: "summarization",
      activityContract: {
        activityId: "activity-1",
        parentRef: { taskRunId: "task-1" },
        activityClass: "summarize",
        title: "Summarize selected records",
        distributionShape: "center",
        riskClass: "medium",
        successShape: "text",
        contextPolicy: "retrieval",
        tokenEnvelope: {
          maxInputTokens: 1000,
          maxOutputTokens: 500,
          compression: "summarize",
        },
        evaluationPolicy: {
          evaluator: "human-acceptance",
          minimumSignal: "accepted",
        },
        requestContractHints: {},
        governedData: {
          assetIds: ["data:customer-account"],
          processingPurpose: "service-delivery",
        },
      },
    });

    expect(result.routeContext).toMatchObject({
      sensitivity: "restricted",
      residencyPolicy: "local_only",
    });
    expect(result.receipt.classifiedDataClasses).toContain("unknown-governed-data");
    expect(JSON.stringify(result.receipt)).not.toContain("selected records");
  });
});
