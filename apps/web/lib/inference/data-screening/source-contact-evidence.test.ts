import { describe, expect, it } from "vitest";
import { classifyInferencePayload } from "./classify-payload";
import { screenInferencePayload } from "./screen-inference-payload";

function contacts(content: string) {
  return classifyInferencePayload({ systemPrompt: "", messages: [{ role: "user", content }] })
    .matches.filter((match) => match.reason === "contact-detail");
}

describe("source quantities and dependency references are not customer contacts", () => {
  it.each([
    '     "memoryBytes": 17179869184,',
    '+    "admissionReserveBytes": 17179869184,',
    '-      "observedHighWaterBytes": 8589934592,',
    '-      "safetyMarginBytes": 2147483648',
    '  decode-uri-component@0.5.0: patches/decode-uri-component@0.5.0.patch',
  ])("does not classify the observed review artifact line %s", (line) => {
    expect(contacts(line)).toEqual([]);
  });

  it.each([
    "Call 4155550132",
    "Call +1 415-555-0132",
    'const customerPhone = 4155550132;',
    '"memoryBytes": "4155550132"',
    '"phone": 4155550132',
    "jane.doe@example.com",
    "Customer contact: jane@company.patch",
    "patches/jane@1.2.3.patch.example.com",
    '"customerPhoneBytes": 4155550132',
  ])("retains actual or ambiguous contact evidence: %s", (line) => {
    expect(contacts(line)).toHaveLength(1);
  });

  it("checks remaining text on an otherwise exempt line", () => {
    expect(contacts('"memoryBytes": 17179869184, // contact jane@example.com')).toHaveLength(1);
    expect(contacts('patches/decode-uri-component@0.5.0.patch — call 4155550132')).toHaveLength(1);
  });

  it("does not exempt a whole source block or payload", () => {
    expect(contacts('```json\n"memoryBytes": 17179869184,\n"phone": 4155550132\n```')).toHaveLength(1);
    expect(contacts('Signed-off-by: Developer <dev@example.com>\npatches/decode-uri-component@0.5.0.patch\nCustomer: jane@example.com')).toHaveLength(1);
  });

  const reviewSource = 'export const budget = {\n"memoryBytes": 17179869184,\n};\npatches/decode-uri-component@0.5.0.patch';

  it("keeps ordinary source review eligible for external routing", () => {
    const result = screenInferencePayload({
      systemPrompt: "Review the committed source change.",
      messages: [{ role: "user", content: reviewSource }],
      taskType: "build-review",
      routeContext: { sensitivity: "internal", allowedProviders: ["openai", "local"] },
    });
    expect(result.receipt.routeEffect).toBe("allow");
    expect(result.receipt.classifiedDataClasses).not.toContain("customer-records");
    expect(result.routeContext.allowedProviders).toContain("openai");
    expect(result.routeContext.residencyPolicy).not.toBe("local_only");
  });

  it("retains an explicit local-only constraint on the same source", () => {
    const result = screenInferencePayload({
      systemPrompt: "",
      messages: [{ role: "user", content: reviewSource }],
      routeContext: { sensitivity: "internal", residencyPolicy: "local_only" },
    });
    expect(result.routeContext.residencyPolicy).toBe("local_only");
  });

  it("still constrains customer data beside source-code quantities", () => {
    const result = screenInferencePayload({
      systemPrompt: "",
      messages: [{ role: "user", content: `${reviewSource}\nCustomer: jane@example.com` }],
      routeContext: { sensitivity: "internal" },
    });
    expect(result.receipt.classifiedDataClasses).toContain("customer-records");
    expect(result.routeContext.residencyPolicy).toBe("local_only");
  });
});
