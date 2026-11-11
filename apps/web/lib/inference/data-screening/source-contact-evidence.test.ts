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
    // BI-D286C3C5: drive-sequential-golden.json seeds are BASE_SEED + index * 1000 + n.
    '       "seed": 2289472767,',
    '+      "seed": 2289477767',
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
    '"seed": "4155550132"',
    '"seedPhone": 4155550132',
    '"seed": 2289472767, // call 4155550132',
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
