// The producer the conformance gate was waiting for (BI-E0728215).
//
// Measured before this existed: 124 AI coworkers, 0 with any coordination
// authority, 0 dispatches ever. Not because the platform was configured wrong —
// `coordinatorEligibility` had no producer at all, so the check read undefined,
// defaulted to "unknown", and refused every AI overseer on every tick forever.

import { describe, expect, it } from "vitest";

import {
  COORDINATION_RESOURCE_TYPE,
  COORDINATION_SCOPE_TYPE,
  JSI_QUALIFICATION_MODELS,
  jsiSchemePresent,
  resolveAuthorityBindingEligibility,
  resolveCoordinatorEligibility,
  resolveJsiEligibility,
  type CoordinationBindingRow,
} from "./coordinator-eligibility";

const coordination = (over: Partial<CoordinationBindingRow> = {}): CoordinationBindingRow => ({
  status: "active",
  scopeType: COORDINATION_SCOPE_TYPE,
  resourceType: COORDINATION_RESOURCE_TYPE,
  resourceRef: "dependency-advisory-watch",
  ...over,
});

describe("resolveAuthorityBindingEligibility", () => {
  it("is eligible with an active coordination binding for the shape", () => {
    expect(resolveAuthorityBindingEligibility("dependency-advisory-watch", [coordination()])).toBe(
      "eligible",
    );
  });

  it("reports ABSENT, not unknown, when it looked and found none", () => {
    // The whole point. "unknown" told the operator nothing and named no remedy;
    // "absent" says a binding is missing and creating one resolves it.
    expect(resolveAuthorityBindingEligibility("dependency-advisory-watch", [])).toBe("absent");
  });

  it("does NOT accept a route binding as coordination authority", () => {
    // The option the kernel rejected (DI-F8C8042FBB5D): an agent bound to
    // /platform has page access, not authority to drive a room to verdict.
    const routeBinding = coordination({ scopeType: "route", resourceType: "route", resourceRef: "/platform" });
    expect(resolveAuthorityBindingEligibility("dependency-advisory-watch", [routeBinding])).toBe(
      "absent",
    );
  });

  it("does not accept a binding for a different shape", () => {
    const other = coordination({ resourceRef: "payables-watch" });
    expect(resolveAuthorityBindingEligibility("dependency-advisory-watch", [other])).toBe("absent");
  });

  it("distinguishes suspended from absent, because the remedy differs", () => {
    // Reinstate vs grant. Collapsing them would send the operator to the wrong fix.
    expect(
      resolveAuthorityBindingEligibility("dependency-advisory-watch", [
        coordination({ status: "suspended" }),
      ]),
    ).toBe("suspended");
  });

  it("treats a draft binding as absent — authority is not granted until it is active", () => {
    expect(
      resolveAuthorityBindingEligibility("dependency-advisory-watch", [
        coordination({ status: "draft" }),
      ]),
    ).toBe("absent");
  });

  it("prefers an active binding when several exist for the shape", () => {
    expect(
      resolveAuthorityBindingEligibility("dependency-advisory-watch", [
        coordination({ status: "suspended" }),
        coordination({ status: "active" }),
      ]),
    ).toBe("eligible");
  });

  it("is unknown — not absent — when the room claims no shape", () => {
    // Nothing was looked up, so nothing was found to be missing. Saying "absent"
    // here would name a remedy that does not apply.
    expect(resolveAuthorityBindingEligibility(null, [])).toBe("unknown");
  });
});

describe("resolveJsiEligibility", () => {
  it("is not-applicable when the platform has no qualification scheme", () => {
    // DI-FF4A015CF917. No JSI qualification model exists in the schema, so
    // requiring one denies every coworker on every install permanently. A gate
    // that can never pass is not a safeguard.
    expect(resolveJsiEligibility({ schemePresent: false })).toBe("not-applicable");
  });

  it("still blocks a coworker who fails a scheme that DOES exist", () => {
    // The control stays real. This is the difference between the recommended
    // option and simply deleting the check (which scored 0.713).
    expect(resolveJsiEligibility({ schemePresent: true, qualified: false })).toBe("absent");
  });

  it("is eligible for a coworker qualified under a present scheme", () => {
    expect(resolveJsiEligibility({ schemePresent: true, qualified: true })).toBe("eligible");
  });

  it("reports stale qualification distinctly from absent", () => {
    expect(resolveJsiEligibility({ schemePresent: true, qualified: true, stale: true })).toBe("stale");
  });

  it("is unknown when a scheme exists but the lookup returned nothing", () => {
    expect(resolveJsiEligibility({ schemePresent: true })).toBe("unknown");
  });
});

describe("jsiSchemePresent", () => {
  it("is false against a client with no qualification model — today's platform", () => {
    expect(jsiSchemePresent({ workroom: {}, principal: {}, authorityBinding: {} })).toBe(false);
  });

  it("becomes true the moment a qualification model exists, with no code change", () => {
    // The tripwire: detection is from the substrate, not a constant, so the gate
    // turns real on its own rather than waiting for someone to remember.
    for (const model of JSI_QUALIFICATION_MODELS) {
      expect(jsiSchemePresent({ [model]: {} })).toBe(true);
    }
  });
});

describe("resolveCoordinatorEligibility", () => {
  it("produces the state today's platform actually has: absent authority, N/A qualification", () => {
    expect(
      resolveCoordinatorEligibility({
        shapeKey: "dependency-advisory-watch",
        bindings: [],
        schemePresent: false,
      }),
    ).toEqual({ authorityBinding: "absent", jsi: "not-applicable" });
  });

  it("produces a fully eligible overseer once the binding exists", () => {
    expect(
      resolveCoordinatorEligibility({
        shapeKey: "dependency-advisory-watch",
        bindings: [coordination()],
        schemePresent: false,
      }),
    ).toEqual({ authorityBinding: "eligible", jsi: "not-applicable" });
  });
});
