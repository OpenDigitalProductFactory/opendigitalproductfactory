import { describe, expect, it } from "vitest";
import { evaluateScopedAdvice, type ScopedAdviceInput, type JudgmentDomainPort } from "./scoped-advice.js";

const reference = { id: "synthetic-context", revision: "1", digest: "digest-1" };
const domain: JudgmentDomainPort = {
  validateFeatures: (options) => options.flatMap((o) =>
    Object.keys(o.features).filter((key) => !["benefit", "effort", "quality"].includes(key)).map((key) => `unknown feature ${key}`)),
};
function input(): ScopedAdviceInput {
  return {
    owner: { scope: "wwwd", id: "synthetic-org" },
    subject: { id: "customer-report", revision: "1" },
    context: {
      owner: { scope: "wwwd", id: "synthetic-org" }, reference, currentReference: reference, status: "current",
      principles: [{ reference: { ...reference, id: "cost" }, currentReference: { ...reference, id: "cost" }, status: "current",
        principle: { id: "cost", name: "Cost magnitudes are worse when higher", tier: "core", weight: 1,
          dimensionVector: { benefit: 1, effort: -1, quality: 1 } } }],
    },
    options: [
      { id: "fast", description: "Higher preference but ineligible", features: { benefit: 1, effort: 0, quality: 1 } },
      { id: "bounded", description: "Eligible customer report", features: { benefit: .8, effort: .2, quality: .8 } },
    ],
    eligibility: [
      { optionId: "fast", eligible: false, reasons: ["outside approved data boundary"], constraintReferences: [reference] },
      { optionId: "bounded", eligible: true, reasons: [], constraintReferences: [reference] },
    ],
  };
}
const codes = (value: ScopedAdviceInput, port: JudgmentDomainPort | undefined = domain) =>
  evaluateScopedAdvice(value, port).diagnostics.map((d) => d.code);

describe("scoped-advice/0.1 intentional validation (raw scoring remains unchanged)", () => {
  it("filters hard ineligibility before preference and never grants admission", () => {
    const original = input();
    const before = JSON.stringify(original);
    const result = evaluateScopedAdvice(original, domain);
    expect(result.status).toBe("advice");
    expect(result.evaluation?.recommendation?.optionId).toBe("bounded");
    expect(result.evaluation?.scores.map((s) => s.optionId)).toEqual(["bounded"]);
    expect(result.authority).toBe("advisory-only");
    expect(result).not.toHaveProperty("allowed");
    expect(result).not.toHaveProperty("permit");
    expect(result.contextReference).toEqual(reference);
    expect(result.excludedOptions[0]?.reasons).toEqual(["outside approved data boundary"]);
    expect(JSON.stringify(original)).toBe(before);
  });
  it.each(["wwmd", "wwwd", "wsid"] as const)("retains exact %s owner and producing gate", (scope) => {
    const value = input();
    value.owner = { scope, id: `synthetic-${scope}` };
    value.context!.owner = { ...value.owner };
    value.subject.producingGateId = "profession-gate-17";
    const result = evaluateScopedAdvice(value, domain);
    expect(result.status).toBe("advice");
    expect(result.owner).toEqual(value.owner);
    expect(result.subject).toEqual(value.subject);
    expect(result.feedback).toBe(scope === "wsid" ? "unsupported" : "owner-capture-required");
  });
  it("holds absent owner context and rejects cross-scope or cross-org fallback", () => {
    const value = input();
    value.context = null;
    expect(codes(value)).toContain("missing-context");
    value.context = input().context;
    value.context!.owner.scope = "wwmd";
    expect(codes(value)).toContain("owner-context-mismatch");
    value.context!.owner = { scope: "wwwd", id: "other-org" };
    expect(codes(value)).toContain("owner-context-mismatch");
  });
  it.each(["context", "principle"] as const)("holds stale and revoked %s refs", (kind) => {
    const value = input();
    const source = kind === "context" ? value.context! : value.context!.principles[0]!;
    source.currentReference = { ...source.reference, revision: "2" };
    expect(codes(value)).toContain("stale-context");
    source.currentReference = { ...source.reference, digest: "changed" };
    expect(codes(value)).toContain("stale-context");
    source.currentReference = source.reference;
    source.status = "revoked";
    expect(codes(value)).toContain("revoked-context");
  });
  it("requires WSID producing gate and explicit eligibility for every option", () => {
    const value = input();
    value.owner.scope = "wsid";
    value.context!.owner = { ...value.owner };
    expect(codes(value)).toContain("missing-producing-gate");
    value.subject.producingGateId = "gate";
    value.eligibility.pop();
    expect(codes(value)).toContain("invalid-eligibility");
  });
  it("holds all-ineligible choices rather than scoring constraints as preferences", () => {
    const value = input();
    value.eligibility[1]!.eligible = false;
    value.eligibility[1]!.reasons = ["budget unavailable"];
    const result = evaluateScopedAdvice(value, domain);
    expect(result.status).toBe("held");
    expect(result.evaluation).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toContain("no-eligible-options");
  });
  it("reuses canonical trimmed-id validation and rejects duplicate principles", () => {
    const value = input();
    value.options[1]!.id = " fast ";
    expect(codes(value)).toContain("invalid-option-identity");
    value.options = input().options;
    value.context!.principles.push(value.context!.principles[0]!);
    expect(codes(value)).toContain("duplicate-principle");
  });
  it.each([NaN, Infinity, -Infinity, -0.1, 1.1])("rejects nonfinite/out-of-range feature %s", (number) => {
    const value = input(); value.options[0]!.features.benefit = number;
    expect(codes(value)).toContain("invalid-number");
    expect(evaluateScopedAdvice(value, domain).evaluation).toBeUndefined();
  });
  it("bounds weight, vectors, embeddings, config and collection sizes", () => {
    const value = input();
    value.context!.principles[0]!.principle.weight = 2;
    expect(codes(value)).toContain("invalid-number");
    value.context = input().context;
    value.context!.principles[0]!.principle.dimensionVector.effort = -2;
    expect(codes(value)).toContain("invalid-number");
    value.context = input().context;
    value.options[0]!.embedding = [Infinity];
    expect(codes(value)).toContain("invalid-number");
    value.options = input().options;
    value.config = { tieMargin: -1, minFeatureKeys: 1.5 };
    expect(codes(value)).toContain("invalid-config");
    value.config = undefined;
    value.options = Array.from({ length: 65 }, (_, i) => ({ ...input().options[0]!, id: String(i) }));
    expect(codes(value)).toContain("size-limit");
  });
  it("requires the host's catalog validator and propagates domain failures", () => {
    expect(evaluateScopedAdvice(input()).diagnostics.map((d) => d.code)).toContain("missing-domain-validator");
    const value = input(); value.options[0]!.features.newPolicy = .5;
    expect(codes(value)).toContain("domain-features-invalid");
    expect(codes(input(), { validateFeatures: () => { throw new Error("unavailable"); } })).toContain("domain-validator-unavailable");
  });
  it("holds an empty principle corpus without inventing a favorable default", () => {
    const value = input(); value.context!.principles = [];
    expect(codes(value)).toContain("missing-principles");
  });
  it.each([null, undefined, [], 7])("holds malformed top-level request %s without inventing ownership", (value) => {
    const result = evaluateScopedAdvice(value as unknown as ScopedAdviceInput, domain);
    expect(result.status).toBe("held");
    expect(result.owner).toBeUndefined();
    expect(result.evaluation).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toContain("invalid-input");
  });
  it("holds missing references, malformed corpus/options and ambiguous eligibility", () => {
    const value = input();
    value.context!.reference = { ...value.context!.reference, digest: "" };
    expect(codes(value)).toContain("invalid-reference");
    value.context = input().context;
    value.context!.principles[0] = null as never;
    expect(evaluateScopedAdvice(value, domain).status).toBe("held");
    value.context = input().context;
    value.options[0] = null as never;
    expect(codes(value)).toContain("invalid-option-identity");
    value.options = input().options;
    value.eligibility[1]!.optionId = "fast";
    expect(codes(value)).toContain("invalid-eligibility");
  });
  it.each([
    { tieMargin: NaN }, { semanticFallbackWarnRatio: 2 }, { commandmentConflictThreshold: -1 },
    { sensitivityEpsilon: 0 }, { stakes: "unknown" }, { extra: 1 },
  ])("holds invalid new-boundary config %s", (config) => {
    const value = input(); value.config = config as never;
    expect(codes(value)).toContain("invalid-config");
  });
});
