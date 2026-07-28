import { describe, expect, it } from "vitest";

import { classifyInferencePayload } from "./classify-payload";
import type { ChatMessage } from "@/lib/inference/ai-inference";

describe("classifyInferencePayload", () => {
  it("detects secrets, customer, employee, finance, and source-code data without echoing raw values", () => {
    const providerKeyCanary = ["sk", "test", "1234567890abcdef"].join("-");
    const mcpTokenCanary = ["dpfmcp", "secret", "1234567890"].join("_");
    const messages: ChatMessage[] = [
      {
        role: "user",
        content:
          "Please debug this customer issue for pat@example.com. " +
          `Employee salary is 125000 and the Stripe key is ${providerKeyCanary}.`,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect the JavaScript snippet." },
          {
            type: "tool_use",
            id: "tool-1",
            name: "inspect_code",
            input: {
              source: `const token = '${mcpTokenCanary}';`,
              routingNumber: "021000021",
            },
          },
        ],
      },
    ];

    const result = classifyInferencePayload({
      messages,
      systemPrompt: "You are helping with customer support and payroll triage.",
      tools: [
        {
          type: "function",
          function: {
            name: "lookupCustomer",
            description: "Look up customer payment and support records.",
          },
        },
      ],
      taskType: "tool-action",
    });

    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataClasses).toEqual([
      "customer-records",
      "employee-records",
      "payments-finance",
      "secrets-credentials",
      "source-code",
    ]);
    expect(result.receipt.rawPayloadStored).toBe(false);
    expect(result.receipt.detectedClasses).toEqual(result.dataClasses);
    expect(result.matches.map((match) => match.dataClass)).toEqual(
      expect.arrayContaining([
        "customer-records",
        "employee-records",
        "payments-finance",
        "secrets-credentials",
        "source-code",
      ]),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("pat@example.com");
    expect(serialized).not.toContain(providerKeyCanary);
    expect(serialized).not.toContain(mcpTokenCanary);
    expect(serialized).not.toContain("021000021");
  });

  it("adds unknown-governed-data when governed classification is missing", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "Summarize the attached governed export." }],
      systemPrompt: "",
      taskType: "summarization",
      governedData: [
        {
          assetId: "asset-customer-export",
          classificationKnown: false,
          purpose: "coworker-assistance",
        },
      ],
    });

    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataClasses).toContain("unknown-governed-data");
    expect(result.matches).toContainEqual(
      expect.objectContaining({
        dataClass: "unknown-governed-data",
        path: "governedData[0]",
        reason: "governed-classification-missing",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("asset-customer-export");
  });

  it("returns a stable low-risk receipt for benign internal work", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "Draft a friendly announcement about next week's team lunch." }],
      systemPrompt: "Be concise.",
      taskType: "creative",
    });

    expect(result.overallSensitivity).toBe("internal");
    expect(result.dataClasses).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.receipt).toEqual(
      expect.objectContaining({
        rawPayloadStored: false,
        detectedClasses: [],
        matchCount: 0,
        transformation: "none",
      }),
    );
    expect(result.receipt.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not mistake instruction vocabulary or ordinary prose for live governed data", () => {
    const result = classifyInferencePayload({
      messages: [
        {
          role: "user",
          content:
            "Certification probe. Use a read-only tool, then let me know what evidence you found.",
        },
      ],
      systemPrompt:
        "You help an employee understand the platform. " +
        "Let me know when the review is complete and explain which class is responsible.",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("internal");
    expect(result.dataClasses).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it("hashes tool declarations without treating their schema vocabulary as live data", () => {
    const withSensitiveSchemaNames = classifyInferencePayload({
      messages: [{ role: "user", content: "Check whether the workspace is ready." }],
      systemPrompt: "Use an appropriate read-only tool.",
      tools: [{
        type: "function",
        function: {
          name: "inspect_employee_record",
          description: "Inspect payment, credential, and customer record metadata.",
          parameters: {
            type: "object",
            properties: {
              password: { type: "string" },
              employeeEmail: { type: "string" },
            },
          },
        },
      }],
      taskType: "conversation",
    });
    const withoutTools = classifyInferencePayload({
      messages: [{ role: "user", content: "Check whether the workspace is ready." }],
      systemPrompt: "Use an appropriate read-only tool.",
      taskType: "conversation",
    });

    expect(withSensitiveSchemaNames.overallSensitivity).toBe("internal");
    expect(withSensitiveSchemaNames.dataClasses).toEqual([]);
    expect(withSensitiveSchemaNames.matches).toEqual([]);
    expect(withSensitiveSchemaNames.receipt.inputHash).not.toBe(
      withoutTools.receipt.inputHash,
    );
  });

  it("continues to classify sensitive values in executed tool-call arguments", () => {
    const result = classifyInferencePayload({
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "call-1",
          name: "lookup",
          arguments: { password: "not-a-real-value" },
        }],
      }],
      systemPrompt: "",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataClasses).toContain("secrets-credentials");
    expect(result.matches).toContainEqual(expect.objectContaining({
      path: "messages[0].toolCalls[0].arguments.password",
      reason: "secret-field-name",
    }));
  });

  it.each([
    ["health-phi", "patientDiagnosis", "Type 1 diabetes"],
    ["payments-finance", "bankAccountNumber", "000123456789"],
    ["legal-privileged", "attorneyClientPrivilege", "litigation strategy"],
    ["criminal-justice", "criminalJusticeInformation", "NCIC criminal history"],
    ["safety-sensitive", "threatAssessment", "protected shelter location"],
    ["youth-sensitive", "parentalConsent", "child under 13"],
    ["employee-records", "employeeDiscipline", "manager-only note"],
    ["source-code", "sourceCode", "export function privateHandler() {}"],
    ["secrets-credentials", "accessToken", "not-a-real-credential"],
    ["customer-records", "customerEmail", "case-owner@example.test"],
  ] as const)(
    "detects the %s acceptance fixture without retaining its value",
    (dataClass, field, value) => {
      const result = classifyInferencePayload({
        messages: [{
          role: "assistant",
          content: "",
          toolCalls: [{
            id: "call-regulated-fixture",
            name: "inspect_governed_record",
            arguments: { [field]: value },
          }],
        }],
        systemPrompt: "",
        taskType: "tool-action",
      });

      expect(result.dataClasses).toContain(dataClass);
      expect(JSON.stringify(result)).not.toContain(value);
    },
  );
});
