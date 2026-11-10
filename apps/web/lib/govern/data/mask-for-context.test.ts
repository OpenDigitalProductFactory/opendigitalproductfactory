import { describe, expect, it } from "vitest";

import type { DataPolicyDecision } from "./policy-decision";
import {
  ContextMaskAuthorizationError,
  ContextMaskMaterialityError,
  applyContextTransform,
  maskForContext,
} from "./mask-for-context";
import { readRehydrationTokenMap } from "./rehydration-token-vault";
import type { RehydrationAuthorizationBinding } from "./rehydration-token-vault";

function maskingDecision(): DataPolicyDecision {
  return {
    decisionId: "decision-mask-1",
    organizationId: "org-test",
    effect: "allow-with-obligations",
    obligations: [{ kind: "mask", profileId: "default-confidential" }],
    explanationCode: "confidential-masked-before-projection",
    matchedPolicyVersions: ["confidential-projection-mask@1"],
    assetVersion: "asset-v1",
    classificationVersion: "classification-v1",
    authorityVersion: "authority-v1",
    inputHash: "input-hash",
    replay: "single-use",
  };
}

describe("applyContextTransform", () => {
  it.each([
    ["omit", "secret", undefined],
    ["redact", "secret", "[REDACTED]"],
    ["partial", "123456789", "[PARTIAL:6789]"],
    ["aggregate", ["a", "b", "c"], "[AGGREGATED:3]"],
    ["pass-through", "safe", "safe"],
  ] as const)("applies %s", (transform, value, expected) => {
    expect(applyContextTransform(value, transform)).toBe(expected);
  });

  it("uses one stable opaque token for repeated values", () => {
    const first = applyContextTransform("ada@example.com", "tokenize");
    const second = applyContextTransform("ada@example.com", "tokenize");

    expect(first).toMatch(/^\[DPF_TOKEN_[A-F0-9]{12}\]$/);
    expect(second).toBe(first);
    expect(first).not.toContain("ada");
  });
});

describe("maskForContext", () => {
  it.each([
    ["context-omit", undefined],
    ["context-redact", "[REDACTED]"],
    ["context-partial", "[PARTIAL:6789]"],
    ["context-tokenize", expect.stringMatching(/^\[DPF_TOKEN_/)],
    ["context-aggregate", "[AGGREGATED:9]"],
    ["context-pass-through", "123456789"],
  ] as const)("applies PDP profile %s at a nested classifier path", (profileId, expected) => {
    const decision = {
      ...maskingDecision(),
      obligations: [{ kind: "mask" as const, profileId }],
    };
    const result = maskForContext(
      { customer: { accountNumber: "123456789" } },
      {
        decision,
        detailUse: "replaceable",
        matches: [{
          dataClass: "payments-finance",
          path: "customer.accountNumber",
          reason: "payment-or-finance-field",
          confidence: "inferred",
        }],
      },
    );
    expect(result.value.customer.accountNumber).toEqual(expected);
  });

  it("transforms nested message, tool argument, tool result, schema, and system-prompt values", () => {
    const rawEmail = "ada@example.com";
    const rawSecret = "sk-super-secret-123456";
    const result = maskForContext(
      {
        systemPrompt: `Help ${rawEmail}; never repeat ${rawSecret}`,
        messages: [
          { role: "user", content: `Contact ${rawEmail}` },
          {
            role: "assistant",
            content: [{
              type: "tool_use",
              name: "lookup_customer",
              input: { email: rawEmail, apiKey: rawSecret },
            }],
          },
          {
            role: "tool",
            content: `{"customerEmail":"${rawEmail}","authorization":"${rawSecret}"}`,
          },
        ],
        tools: [{
          name: "lookup_customer",
          parameters: {
            properties: {
              email: { example: rawEmail },
              apiKey: { example: rawSecret },
            },
          },
        }],
      },
      {
        decision: maskingDecision(),
        detailUse: "replaceable",
        matches: [
          { dataClass: "customer-records", path: "systemPrompt", reason: "contact-detail", confidence: "deterministic" },
          { dataClass: "secrets-credentials", path: "systemPrompt", reason: "secret-shaped-token", confidence: "deterministic" },
          { dataClass: "customer-records", path: "messages[0].content", reason: "contact-detail", confidence: "deterministic" },
          { dataClass: "customer-records", path: "messages[1].content[0].input.email", reason: "contact-detail", confidence: "deterministic" },
          { dataClass: "secrets-credentials", path: "messages[1].content[0].input.apiKey", reason: "secret-field-name", confidence: "inferred" },
          { dataClass: "customer-records", path: "messages[2].content", reason: "contact-detail", confidence: "deterministic" },
          { dataClass: "secrets-credentials", path: "messages[2].content", reason: "secret-shaped-token", confidence: "deterministic" },
          { dataClass: "customer-records", path: "tools[0].parameters.properties.email.example", reason: "contact-detail", confidence: "deterministic" },
          { dataClass: "secrets-credentials", path: "tools[0].parameters.properties.apiKey.example", reason: "secret-field-name", confidence: "inferred" },
        ],
      },
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(rawEmail);
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).toContain("[DPF_TOKEN_");
    expect(serialized).toContain("[REDACTED]");
    expect(result.transformation).toBe("tokenized");
    expect(result.rehydrationHandle).toMatch(/^rehydration_[a-f0-9]{24}$/);
    expect(result).not.toHaveProperty("tokenMap");
  });

  it("refuses caller-shaped masking without a PDP mask obligation", () => {
    const decision = { ...maskingDecision(), obligations: [] };
    expect(() =>
      maskForContext(
        { email: "ada@example.com" },
        {
          decision,
          detailUse: "replaceable",
          matches: [
            { dataClass: "customer-records", path: "email", reason: "contact-detail", confidence: "deterministic" },
          ],
        },
      ),
    ).toThrow(ContextMaskAuthorizationError);
  });

  it.each(["material", "unknown"] as const)(
    "refuses a misleading transform when sensitive detail use is %s",
    (detailUse) => {
      expect(() =>
        maskForContext(
          { email: "ada@example.com" },
          {
            decision: maskingDecision(),
            detailUse,
            matches: [
              { dataClass: "customer-records", path: "email", reason: "contact-detail", confidence: "deterministic" },
            ],
          },
        ),
      ).toThrow(ContextMaskMaterialityError);
    },
  );

  it("fails closed when a sensitive classifier match has no safe transform", () => {
    expect(() =>
      maskForContext(
        { notes: "Employee salary needs review" },
        {
          decision: maskingDecision(),
          detailUse: "replaceable",
          matches: [
            { dataClass: "employee-records", path: "notes", reason: "employee-record-text", confidence: "inferred" },
          ],
        },
      ),
    ).toThrow(/no safe transform/i);
  });

  it("tokenizes finance identifiers without retaining the raw value", () => {
    const raw = "Invoice account 4455661122";
    const result = maskForContext(
      { notes: raw },
      {
        decision: maskingDecision(),
        detailUse: "replaceable",
        matches: [
          { dataClass: "payments-finance", path: "notes", reason: "payment-or-finance-text", confidence: "inferred" },
        ],
      },
    );
    expect(JSON.stringify(result)).not.toContain("4455661122");
    expect(JSON.stringify(result)).toContain("[DPF_TOKEN_");
  });

  it("keeps a legacy token map unbound and therefore non-rehydratable", () => {
    const result = maskForContext(
      { email: "ada@example.com" },
      {
        decision: maskingDecision(),
        detailUse: "replaceable",
        matches: [
          { dataClass: "customer-records", path: "email", reason: "contact-detail", confidence: "deterministic" },
        ],
      },
    );
    const read = readRehydrationTokenMap(result.rehydrationHandle ?? "");

    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    expect([...read.tokens.values()][0]?.bindings).toEqual([]);
  });

  it("marks a repeated token non-rehydratable when any occurrence lacks a path binding", () => {
    const raw = "ada@example.com";
    const binding: RehydrationAuthorizationBinding = {
      expectedActor: {
        principalId: "PRN-1",
        actingHumanUserId: "user-1",
        actingAgentId: null,
        delegationGrantId: null,
      },
      purpose: "customer-support",
      surface: "private-customer",
      subject: { kind: "account", id: "account-1" },
      sensitivity: "confidential",
      decisionVersions: [{
        decisionId: "decision-mask-1",
        assetVersion: "asset-v1",
        classificationVersion: "classification-v1",
        authorityVersion: "authority-v1",
      }],
      dataClasses: ["customer-records"],
      pathPrefixes: ["customer"],
    };
    const result = maskForContext(
      { customer: { email: raw }, unrelated: { email: raw } },
      {
        decision: maskingDecision(),
        detailUse: "replaceable",
        rehydrationBindings: [binding],
        matches: [
          { dataClass: "customer-records", path: "customer.email", reason: "contact-detail", confidence: "deterministic" },
          { dataClass: "customer-records", path: "unrelated.email", reason: "contact-detail", confidence: "deterministic" },
        ],
      },
    );
    const read = readRehydrationTokenMap(result.rehydrationHandle ?? "");

    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    expect([...read.tokens.values()][0]).toMatchObject({
      bindings: [binding],
      hasUnboundOccurrence: true,
    });
  });
});

// BI-0064680C. The guard now measures what the transform DID, not what the
// caller declared, so the tokenized projection the platform already built is
// reachable without every caller first asserting materiality it cannot know.
describe("materiality is decided by reversibility, not by declaration", () => {
  const boundBinding = (pathPrefixes?: string[]): RehydrationAuthorizationBinding => ({
    expectedActor: {
      principalId: "PRN-1",
      actingHumanUserId: "user-1",
      actingAgentId: null,
      delegationGrantId: null,
    },
    purpose: "customer-support",
    surface: "private-customer",
    subject: { kind: "account", id: "account-1" },
    sensitivity: "confidential",
    decisionVersions: [{
      decisionId: "decision-mask-1",
      assetVersion: "asset-v1",
      classificationVersion: "classification-v1",
      authorityVersion: "authority-v1",
    }],
    dataClasses: ["customer-records"],
    ...(pathPrefixes ? { pathPrefixes } : {}),
  });

  const contactMatch = {
    dataClass: "customer-records" as const,
    path: "customer.email",
    reason: "contact-detail",
    confidence: "deterministic" as const,
  };

  it("allows an undeclared turn when every value is tokenized and bound", () => {
    const result = maskForContext(
      { customer: { email: "ada@example.com" } },
      {
        decision: maskingDecision(),
        detailUse: "unknown",
        rehydrationBindings: [boundBinding()],
        matches: [contactMatch],
      },
    );

    expect(result.transformation).toBe("tokenized");
    expect(result.value.customer.email).toMatch(/^\[DPF_TOKEN_/);
    expect(result.rehydrationHandle).toMatch(/^rehydration_/);
  });

  it("still refuses an undeclared turn when no binding can restore the value", () => {
    expect(() =>
      maskForContext(
        { customer: { email: "ada@example.com" } },
        {
          decision: maskingDecision(),
          detailUse: "unknown",
          matches: [contactMatch],
        },
      )
    ).toThrow(ContextMaskMaterialityError);
  });

  it("still refuses an undeclared turn when a binding does not cover the path", () => {
    expect(() =>
      maskForContext(
        { customer: { email: "ada@example.com" } },
        {
          decision: maskingDecision(),
          detailUse: "unknown",
          rehydrationBindings: [boundBinding(["somewhere-else"])],
          matches: [contactMatch],
        },
      )
    ).toThrow(ContextMaskMaterialityError);
  });

  it("still refuses an undeclared turn for a one-way redaction", () => {
    expect(() =>
      maskForContext(
        { note: "the key is sk-abcdefghijklmnop" },
        {
          decision: maskingDecision(),
          detailUse: "unknown",
          rehydrationBindings: [boundBinding()],
          matches: [{
            dataClass: "secrets-credentials",
            path: "note",
            reason: "secret-shaped-token",
            confidence: "deterministic",
          }],
        },
      )
    ).toThrow(ContextMaskMaterialityError);
  });

  it("still refuses an undeclared turn for a lossy PDP profile", () => {
    expect(() =>
      maskForContext(
        { customer: { accountNumber: "123456789" } },
        {
          decision: {
            ...maskingDecision(),
            obligations: [{ kind: "mask" as const, profileId: "context-partial" }],
          },
          detailUse: "unknown",
          rehydrationBindings: [boundBinding()],
          matches: [{
            dataClass: "payments-finance",
            path: "customer.accountNumber",
            reason: "payment-or-finance-field",
            confidence: "inferred",
          }],
        },
      )
    ).toThrow(ContextMaskMaterialityError);
  });

  it("leaves a declared-replaceable turn free to use a lossy transform", () => {
    const result = maskForContext(
      { note: "the key is sk-abcdefghijklmnop" },
      {
        decision: maskingDecision(),
        detailUse: "replaceable",
        matches: [{
          dataClass: "secrets-credentials",
          path: "note",
          reason: "secret-shaped-token",
          confidence: "deterministic",
        }],
      },
    );

    expect(result.value.note).toContain("[REDACTED]");
    expect(result.value.note).not.toContain("sk-abcdefghijklmnop");
  });
});
