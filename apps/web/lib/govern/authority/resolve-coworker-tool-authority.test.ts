import { describe, expect, it } from "vitest";

import {
  deriveAllowedRouteContexts,
  deriveCoworkerApprovalPolicy,
  deriveCoworkerAuthoritySubject,
} from "./resolve-coworker-tool-authority";

describe("deriveAllowedRouteContexts", () => {
  it("keeps surface-agnostic and wildcard tools route-neutral", () => {
    expect(deriveAllowedRouteContexts(undefined)).toBeUndefined();
    expect(deriveAllowedRouteContexts("*")).toBeUndefined();
  });

  it("binds a screen-specific tool to its declared route context", () => {
    expect(deriveAllowedRouteContexts("/platform/identity")).toEqual([
      "/platform/identity",
    ]);
  });
});

describe("deriveCoworkerAuthoritySubject", () => {
  it("derives a record subject from server-recognized identifier fields", () => {
    expect(
      deriveCoworkerAuthoritySubject({
        employeeId: " EMP-100 ",
        promptSubject: "EMP-999",
      }),
    ).toEqual({ kind: "employee", id: "EMP-100" });
  });

  it("does not treat unrecognized caller claims as authority scope", () => {
    expect(
      deriveCoworkerAuthoritySubject({
        promptSubject: "principal:PRN-SECRET",
        authorityOverride: true,
      }),
    ).toEqual({ kind: "platform", id: "dpf" });
  });
});

describe("deriveCoworkerApprovalPolicy", () => {
  it.each([
    [{ hitlTierDefault: 0, hitlPolicy: "none" }, "all"],
    [{ hitlTierDefault: 1, hitlPolicy: "none" }, "all"],
    [{ hitlTierDefault: 2, hitlPolicy: "none" }, "side-effects"],
    [
      {
        hitlTierDefault: 3,
        hitlPolicy: "proposal_for_external_writes",
      },
      "side-effects",
    ],
    [{ hitlTierDefault: 3, hitlPolicy: "none" }, "none"],
  ] as const)("maps %j to %s", (input, expected) => {
    expect(deriveCoworkerApprovalPolicy(input)).toBe(expected);
  });
});
