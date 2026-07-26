// apps/web/lib/govern/data/policy-enforcement.test.ts
import { describe, expect, it } from "vitest";
import {
  PepCapabilityError,
  assertBundleEnforceable,
  assertObligationsEnforceable,
  canPepEnforce,
  isDecisionStillFresh,
} from "./policy-enforcement";
import { DATA_EXECUTABLE_POLICIES } from "./executable-policies";
import type { DataPolicyDecision } from "./policy-decision";

describe("PEP capability matrix", () => {
  it("lets a projection PEP enforce delete-derived-copy but a read PEP not", () => {
    expect(canPepEnforce("projection", "delete-derived-copy")).toBe(true);
    expect(canPepEnforce("high-risk-read", "delete-derived-copy")).toBe(false);
  });

  it("treats inference dispatch as a destination-enforcing PEP", () => {
    expect(canPepEnforce("inference-dispatch", "destination")).toBe(true);
    expect(canPepEnforce("inference-dispatch", "mask")).toBe(true);
    expect(canPepEnforce("inference-dispatch", "log-use")).toBe(true);
    expect(canPepEnforce("inference-dispatch", "human-approval")).toBe(true);
    expect(canPepEnforce("inference-dispatch", "delete-derived-copy")).toBe(false);
    expect(canPepEnforce("coworker-context", "destination")).toBe(false);
  });

  it("throws when obligations exceed what a PEP can enforce", () => {
    expect(() =>
      assertObligationsEnforceable("coworker-context", [
        { kind: "human-approval", authorityRole: "steward", separationOfDuties: true },
      ]),
    ).toThrow(PepCapabilityError);
  });

  it("accepts obligations within the PEP's matrix", () => {
    expect(() =>
      assertObligationsEnforceable("coworker-context", [{ kind: "mask", profileId: "p" }]),
    ).not.toThrow();
  });

  it("confirms every default-bundle obligation is enforceable by some PEP", () => {
    expect(() => assertBundleEnforceable(DATA_EXECUTABLE_POLICIES)).not.toThrow();
  });
});

describe("TOCTOU freshness guard", () => {
  const decision = {
    assetVersion: "a1",
    classificationVersion: "c1",
    authorityVersion: "auth1",
  } as DataPolicyDecision;

  it("is fresh when all versions still match", () => {
    expect(
      isDecisionStillFresh(decision, {
        assetVersion: "a1",
        classificationVersion: "c1",
        authorityVersion: "auth1",
      }),
    ).toBe(true);
  });

  it("is stale when any version drifted", () => {
    expect(
      isDecisionStillFresh(decision, {
        assetVersion: "a1",
        classificationVersion: "c2",
        authorityVersion: "auth1",
      }),
    ).toBe(false);
  });
});
