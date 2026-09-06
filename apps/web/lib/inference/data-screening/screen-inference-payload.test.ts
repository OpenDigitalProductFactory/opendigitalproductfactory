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

  it("preserves development routing for benign source-code work", () => {
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Add a loading state to the component." }],
      systemPrompt: "You generate platform source code.",
      taskType: "code-gen",
      routeContext: { sensitivity: "development" },
    });

    expect(result.routeContext.sensitivity).toBe("development");
    expect(result.receipt).toMatchObject({
      declaredSensitivity: "public",
      measuredSensitivity: "public",
      sensitivityFloorApplied: true,
    });
  });

  it("escalates development routing when the payload contains governed data", () => {
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Add Jane's employee payroll record to this fixture." }],
      systemPrompt: "You generate platform source code.",
      taskType: "code-gen",
      routeContext: { sensitivity: "development" },
    });

    expect(result.routeContext).toMatchObject({
      sensitivity: "restricted",
      residencyPolicy: "local_only",
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
      // "payments-finance" dropped 2026-09-01 (BI-67CAF494). This message names
      // no payment identifier; the class appeared only because bare `payroll`
      // sat in BOTH the employee-records and payments-finance text patterns, so
      // one word produced two classes. The routing outcome below is unchanged —
      // `disciplinary` is precise and still escalates on its own.
      classifiedDataClasses: expect.arrayContaining(["employee-records"]),
      explanationCodes: expect.arrayContaining(["restricted-cannot-leave-boundary"]),
      rawPayloadStored: false,
    });
    expect(JSON.stringify(result.receipt)).not.toContain("Jane");
  });

  it("projects safe PDP versions from the live version source into the receipt", () => {
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Review employee salary notes." }],
      systemPrompt: "",
      taskType: "summarization",
      policyVersionSource: () => ({
        assetVersion: "asset-7",
        classificationVersion: "classification-9",
        authorityVersion: "authority-3",
        policyBundleVersion: "bundle-4",
      }),
    });

    expect(result.receipt.decisionVersions).toEqual([
      {
        decisionId: result.receipt.decisionIds[0],
        assetVersion: "asset-7",
        classificationVersion: "classification-9",
        authorityVersion: "authority-3",
      },
    ]);
    expect(JSON.stringify(result.receipt)).not.toContain("salary notes");
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

  it("tightens a protected customer projection to approved cloud and records its pack", () => {
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Summarize customer jane@example.test." }],
      systemPrompt: "",
      taskType: "summarization",
      routeContext: {
        sensitivity: "internal",
        residencyPolicy: "any_enabled",
      },
      appliedTransformation: {
        transformation: "tokenized",
        decisionIds: ["ddp_transform"],
        decisionVersions: [{
          decisionId: "ddp_transform",
          assetVersion: "asset-1",
          classificationVersion: "class-1",
          authorityVersion: "authority-1",
        }],
        classifiedDataClasses: ["customer-records"],
        explanationCodes: ["protected-projection"],
        obligationKinds: ["mask"],
      },
    });

    expect(result.routeContext).toMatchObject({
      sensitivity: "internal",
      residencyPolicy: "approved_cloud",
    });
    expect(result.receipt).toMatchObject({
      routeEffect: "allow",
      policyPackVersions: ["vertical-customer-records@1.0.0"],
    });
  });

  it("keeps protected legal work local-only because the pack requires review", () => {
    const result = screenInferencePayload({
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "call-legal",
          name: "review",
          arguments: { attorneyClientPrivilege: "masked-fixture" },
        }],
      }],
      systemPrompt: "",
      appliedTransformation: {
        transformation: "tokenized",
        decisionIds: ["ddp_transform"],
        decisionVersions: [{
          decisionId: "ddp_transform",
          assetVersion: "asset-1",
          classificationVersion: "class-1",
          authorityVersion: "authority-1",
        }],
        classifiedDataClasses: ["legal-privileged"],
        explanationCodes: ["protected-projection"],
        obligationKinds: ["mask"],
      },
    });

    expect(result.routeContext.residencyPolicy).toBe("local_only");
    expect(result.receipt).toMatchObject({
      policyEffect: "review",
      routeEffect: "local-only",
      policyPackVersions: ["vertical-legal-privileged@1.0.0"],
    });
  });
});

describe("a mask with nothing to redact does not fence the turn (BI-67CAF494)", () => {
  it("lets a coworker be asked for help with payroll", () => {
    // The live failure, after the vocabulary fix reduced it from restricted to
    // confidential: a mask obligation attached with no value to redact, and the
    // clamp still fenced the reviewer. RouteDecisionLog screen_2781e0797c3307ed —
    // one match, employee-record-ambiguous-term, transformation "none".
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Please review the payroll tax acquisition design." }],
      systemPrompt: "",
      taskType: "analysis",
      routeContext: { sensitivity: "internal", residencyPolicy: "any_enabled" },
    });

    expect(result.receipt.routeEffect).toBe("allow");
    expect(result.routeContext.residencyPolicy).not.toBe("local_only");
  });

  it("still fences when ONE precise match sits beside the vocabulary", () => {
    // Fails closed: a real value alongside the domain word and the clamp stands.
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Review the payroll and her salary band." }],
      systemPrompt: "",
      taskType: "analysis",
      routeContext: { sensitivity: "internal", residencyPolicy: "any_enabled" },
    });

    expect(result.receipt.routeEffect).toBe("local-only");
    expect(result.routeContext.residencyPolicy).toBe("local_only");
  });

  it("still fences when a governed hint declares the data", () => {
    // A DECLARED classification is not a guess and always outranks the heuristic.
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "Review the payroll module." }],
      systemPrompt: "",
      taskType: "analysis",
      governedData: [{
        assetId: "data:pay-run",
        fieldIds: ["data:pay-run#grossPay"],
        classificationKnown: true,
        sensitivity: "confidential",
        purpose: "service-delivery",
      }],
      routeContext: { sensitivity: "internal", residencyPolicy: "any_enabled" },
    });

    expect(result.routeContext.residencyPolicy).toBe("local_only");
  });

  it("still fences a restricted payload outright", () => {
    const result = screenInferencePayload({
      messages: [{ role: "user", content: "His SSN is on the form." }],
      systemPrompt: "",
      taskType: "analysis",
      routeContext: { sensitivity: "internal", residencyPolicy: "any_enabled" },
    });

    expect(result.routeContext.residencyPolicy).toBe("local_only");
  });
});

// BI-40EF7C44. A receipt could say a match landed at `messages[0].content` and
// nothing more — ambiguous between a real user turn and a block the coworker
// path prepended, which imply opposite fixes. `rawPayloadStored` is false by
// design, so the payload cannot be read back to settle it. A LABEL can be
// persisted where the content cannot.
describe("a receipt says WHAT the matched message was, never what it said", () => {
  const payload = (messageOrigins?: ("turn" | "thread-checkpoint" | "user-briefing")[]) =>
    screenInferencePayload({
      messages: [
        { role: "user", content: "Reconcile the payroll against the invoice." },
        { role: "user", content: "What needs my attention?" },
      ],
      ...(messageOrigins ? { messageOrigins } : {}),
      systemPrompt: "You help with operations.",
      taskType: "conversation",
      routeContext: { sensitivity: "internal" },
    });

  it("labels the match with the origin the caller declared", () => {
    const row = payload(["user-briefing", "turn"]).receipt.matchProvenance
      ?.find((m) => m.path.startsWith("messages[0]"));

    expect(row?.origin).toBe("user-briefing");
  });

  it("defaults an unlabelled message to a real turn", () => {
    const row = payload().receipt.matchProvenance
      ?.find((m) => m.path.startsWith("messages[0]"));

    expect(row?.origin).toBe("turn");
  });

  it("changes no verdict — the label is diagnostic, not an input", () => {
    const labelled = payload(["user-briefing", "turn"]);
    const unlabelled = payload();

    expect(labelled.receipt.routeEffect).toBe(unlabelled.receipt.routeEffect);
    expect(labelled.receipt.measuredSensitivity).toBe(unlabelled.receipt.measuredSensitivity);
    expect(labelled.receipt.classifiedDataClasses)
      .toEqual(unlabelled.receipt.classifiedDataClasses);
  });

  it("still stores no payload values", () => {
    const receipt = payload(["user-briefing", "turn"]).receipt;

    expect(receipt.rawPayloadStored).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain("payroll");
    expect(JSON.stringify(receipt)).not.toContain("invoice");
  });
});
