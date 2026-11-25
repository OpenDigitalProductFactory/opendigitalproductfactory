import { describe, expect, it } from "vitest";
import { classifyInferencePayload } from "./classify-payload";
import { screenInferencePayload } from "./screen-inference-payload";

function contacts(content: string) {
  return classifyInferencePayload({ systemPrompt: "", messages: [{ role: "user", content }] })
    .matches.filter((match) => match.reason === "contact-detail");
}

describe("source quantities and dependency references are not customer contacts", () => {
  const gitFixture = 'git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "fixture"]);';

  it("recognizes synthetic Git configuration in the observed review diff", () => {
    expect(contacts(gitFixture)).toEqual([]);
    const result = screenInferencePayload({
      systemPrompt: "Review the committed source change.",
      messages: [{ role: "user", content: `const fixture = () => { ${gitFixture} };` }],
      taskType: "build-review",
      routeContext: { sensitivity: "internal", allowedProviders: ["openai", "local"] },
    });
    expect(result.receipt.classifiedDataClasses).toContain("source-code");
    expect(result.receipt.classifiedDataClasses).not.toContain("customer-records");
    expect(result.routeContext.allowedProviders).toContain("openai");
    expect(result.routeContext.residencyPolicy).not.toBe("local_only");
  });

  it.each([
    '"user.email=jane@example.invalid"',
    '"user.email=test@example.invalid.attacker.com"',
    '"user.email=test@company.com"',
    '"customer.email=test@example.invalid"',
    '"user.email=test@example.invalid+suffix"',
    '"user.email=test@example.invalid" // customer jane@company.com',
    '"user.email=test@example.invalid" // call 4155550132',
    'Customer: test@example.invalid',
  ])("retains contact evidence outside the synthetic Git fixture span: %s", (line) => {
    expect(contacts(line)).toHaveLength(1);
  });

  it("does not widen an explicit local boundary for a Git fixture", () => {
    const result = screenInferencePayload({
      systemPrompt: "",
      messages: [{ role: "user", content: gitFixture }],
      routeContext: { sensitivity: "internal", residencyPolicy: "local_only" },
    });
    expect(result.routeContext.residencyPolicy).toBe("local_only");
  });

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

describe("placeholder accounts on reserved domains are not customer contacts (BI-9F620FE1 follow-up)", () => {
  it.each([
    'email: "admin@dpf.local",',
    'const walker = { email: "walk@dpf.local" };',
    'to: "user1@example.test"',
    'from: "noreply@example.org"',
    'actor: "automation@dpf.local"',
    'owner: "test@example.com"',
    // RFC 2606 reserves example.com and every subdomain of it.
    'from: "noreply@mail.example.com"',
  ])("does not classify %s", (line) => {
    expect(contacts(line)).toEqual([]);
  });

  it.each([
    '"user.email=jane@example.invalid"',
    "jane.doe@example.com",
    "Customer: test@example.invalid",
    '"customer.email=admin@dpf.local"',
    "contact: walk@dpf.local",
    'email: "admin@company.com"',
    'email: "admin@dpf.local.example.org.evil.io"',
    'email: "admin@dpf.local+tag"',
    'email: "admin@dpf.local" // customer jane@company.com',
    // .local carries real internal mail; only the platform's fixture domain is exempt.
    'email: "admin@corp.local"',
    'email: "admin@company.local"',
    // Two-word customer labels keep their context.
    "contact email: walk@dpf.local",
    "customer contact = admin@dpf.local",
  ])("still classifies a person, customer context, real domain or adjacent contact: %s", (line) => {
    expect(contacts(line)).toHaveLength(1);
  });

  it("keeps a review diff with fixture accounts eligible for external routing", () => {
    const result = screenInferencePayload({
      systemPrompt: "Review the committed source change.",
      messages: [{ role: "user", content: 'const provenance = { email: "admin@dpf.local", userAgent: "Mozilla/5.0" };' }],
      taskType: "build-review",
      routeContext: { sensitivity: "internal", allowedProviders: ["anthropic-sub", "local"] },
    });
    expect(result.receipt.classifiedDataClasses).not.toContain("customer-records");
    expect(result.routeContext.residencyPolicy).not.toBe("local_only");
  });
});

describe("review fixture mailbox contact screening", () => {
  const address = (local: string, domain = "example.test") => `${local}@${domain}`;
  const reviewRecipient = address("review");
  const realRecipient = address("review", "mail.company.com");
  const personShaped = address("jane.doe");

  it("leaves the exact inbox approval fixture eligible for permitted external review", () => {
    const result = screenInferencePayload({
      systemPrompt: "Review the committed source change.",
      messages: [{ role: "user", content: `const approval = { payment: { amount: 125, currency: "USD", recipient: "${reviewRecipient}" } };` }],
      taskType: "build-review",
      routeContext: { sensitivity: "development", allowedProviders: ["openai", "local"] },
      sourceCodeProvenance: { repository: "OpenDigitalProductFactory/opendigitalproductfactory", visibility: "public" },
    });
    expect(result.receipt.classifiedDataClasses).not.toContain("customer-records");
    expect(result.routeContext.residencyPolicy).not.toBe("local_only");
  });

  const sourceCodeProvenance = { repository: "OpenDigitalProductFactory/opendigitalproductfactory", visibility: "public" } as const;
  const reviewContacts = (content: string) => classifyInferencePayload({
    systemPrompt: "", messages: [{ role: "user", content }], taskType: "build-review", sourceCodeProvenance,
  }).matches.filter((match) => match.reason === "contact-detail");

  it("keeps the same quoted text classified outside qualified source review", () => {
    const content = `recipient: "${reviewRecipient}"`;
    expect(contacts(content)).toHaveLength(1);
    for (const context of [{ taskType: "build-review" }, { sourceCodeProvenance }]) {
      expect(classifyInferencePayload({ ...context, systemPrompt: "", messages: [{ role: "user", content }] })
        .matches.filter((match) => match.reason === "contact-detail")).toHaveLength(1);
    }
  });

  it("keeps the exception exact and preserves adjacent contact evidence", () => {
    expect(reviewContacts(`recipient: "${reviewRecipient}"`)).toHaveLength(0);
    for (const text of [
      reviewRecipient,
      `Customer recipient: "${reviewRecipient}"`,
      `Customer contact: ${reviewRecipient}`,
      `recipient: "${reviewRecipient}.evil.test"`,
      `recipient: "${address("review1")}"`,
      `recipient: "${address("review", "other.test")}"`,
      `recipient: "${realRecipient}"`,
      `recipient: "${reviewRecipient}" and actual contact ${personShaped}`,
    ]) expect(reviewContacts(text)).toHaveLength(1);
  });

  it("never overrides an explicit local-only route", () => {
    const result = screenInferencePayload({
      systemPrompt: "",
      messages: [{ role: "user", content: `const recipient = "${reviewRecipient}";` }],
      routeContext: { sensitivity: "internal", residencyPolicy: "local_only" },
    });
    expect(result.routeContext.residencyPolicy).toBe("local_only");
  });
});
