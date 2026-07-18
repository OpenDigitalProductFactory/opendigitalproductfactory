// apps/web/lib/govern/data/policy-decision.test.ts
import { describe, expect, it } from "vitest";
import { evaluateDataPolicy, type PolicyEvaluationContext } from "./policy-decision";
import type { DataExecutablePolicy } from "./executable-policies";

function ctx(overrides: Partial<PolicyEvaluationContext> = {}): PolicyEvaluationContext {
  return {
    organizationId: "org-1",
    action: "read",
    asset: "data:widget",
    purpose: "service-delivery",
    classification: { known: true, sensitivity: "internal", categories: ["operational"] },
    environmentKnown: true,
    assetVersion: "a1",
    classificationVersion: "c1",
    authorityVersion: "auth1",
    policyBundleVersion: "b1",
    ...overrides,
  };
}

describe("fail-closed on unknown context", () => {
  it("denies a high-risk action when classification is unknown", () => {
    const d = evaluateDataPolicy(
      ctx({ action: "delete", classification: { known: false } }),
    );
    expect(d.effect).toBe("deny");
    expect(d.explanationCode).toBe("unknown-context-high-risk");
  });

  it("routes a low-risk unknown read to review, never allow", () => {
    const d = evaluateDataPolicy(ctx({ action: "read", classification: { known: false } }));
    expect(d.effect).toBe("review");
  });

  it("denies when the environment is unknown for a high-risk action", () => {
    const d = evaluateDataPolicy(ctx({ action: "export", environmentKnown: false }));
    expect(d.effect).toBe("deny");
  });
});

describe("hard constraints and precedence", () => {
  it("denies prohibited-storage writes as a hard backstop", () => {
    const d = evaluateDataPolicy(
      ctx({
        action: "write",
        classification: { known: true, collectionRule: "prohibited" },
      }),
    );
    expect(d.effect).toBe("deny");
    expect(d.explanationCode).toBe("prohibited-storage");
  });

  it("denies restricted data leaving to an external destination", () => {
    const d = evaluateDataPolicy(
      ctx({
        action: "project",
        destination: "external-service",
        classification: { known: true, sensitivity: "restricted" },
      }),
    );
    expect(d.effect).toBe("deny");
    expect(d.explanationCode).toBe("restricted-cannot-leave-boundary");
  });

  it("lets a stronger deny outrank a weaker allow regardless of array order", () => {
    const policies: DataExecutablePolicy[] = [
      {
        id: "weak-allow",
        version: "1",
        precedenceLevel: "organization-policy",
        match: { actions: ["read"] },
        effect: "allow",
        explanationCode: "weak-allow",
        effectiveFrom: "2026-07-17",
      },
      {
        id: "strong-deny",
        version: "1",
        precedenceLevel: "mandatory-authority",
        match: { actions: ["read"] },
        effect: "deny",
        explanationCode: "strong-deny",
        effectiveFrom: "2026-07-17",
      },
    ];
    const d = evaluateDataPolicy(ctx({ action: "read" }), policies);
    expect(d.effect).toBe("deny");
    expect(d.explanationCode).toBe("strong-deny");
  });
});

describe("allow-with-obligations", () => {
  it("masks confidential data before projection", () => {
    const d = evaluateDataPolicy(
      ctx({
        action: "project",
        destination: "internal-store",
        classification: { known: true, sensitivity: "confidential", categories: ["content"] },
      }),
    );
    expect(d.effect).toBe("allow-with-obligations");
    expect(d.obligations.some((o) => o.kind === "mask")).toBe(true);
  });
});

describe("no matching policy", () => {
  it("routes a low-risk read with no policy to review", () => {
    const d = evaluateDataPolicy(ctx({ action: "read" }, []));
    expect(d.effect).toBe("review");
  });

  it("denies a high-risk MDM read with no matching policy", () => {
    const d = evaluateDataPolicy(
      ctx({ classification: { known: true, masterDataDomain: "customer-account" } }, []),
    );
    expect(d.effect).toBe("deny");
  });
});

describe("replay + caching + determinism", () => {
  it("marks side-effecting decisions single-use with no reusable cache key", () => {
    const d = evaluateDataPolicy(ctx({ action: "write" }));
    expect(d.replay).toBe("single-use");
    expect(d.cacheKey).toBeUndefined();
  });

  it("allows a reusable cache key only for non-MDM reads", () => {
    const read = evaluateDataPolicy(ctx({ action: "read" }));
    expect(read.replay).toBe("read-cacheable");
    expect(read.cacheKey).toBeDefined();

    const mdmRead = evaluateDataPolicy(
      ctx({ action: "read", classification: { known: true, masterDataDomain: "supplier" } }),
    );
    expect(mdmRead.cacheKey).toBeUndefined();
  });

  it("produces a deterministic decision id/hash for identical input", () => {
    expect(evaluateDataPolicy(ctx()).decisionId).toBe(evaluateDataPolicy(ctx()).decisionId);
  });
});
