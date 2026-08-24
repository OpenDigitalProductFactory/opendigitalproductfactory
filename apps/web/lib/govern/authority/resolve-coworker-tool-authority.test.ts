import { describe, expect, it } from "vitest";

import {
  deriveAllowedRouteContexts,
  deriveCoworkerApprovalPolicy,
  deriveCoworkerAuthoritySubject,
  resolveInitiativeAuthorityContext,
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

  it("preserves the canonical backlog item instead of collapsing it to platform scope", () => {
    expect(deriveCoworkerAuthoritySubject({
      itemId: " BI-F0715C9C ",
      organizationId: "caller-org",
    })).toEqual({ kind: "backlog-item", id: "BI-F0715C9C" });
  });
});

describe("resolveInitiativeAuthorityContext", () => {
  it("derives organization authority server-side from the governed item", async () => {
    const db = {
      backlogItem: {
        findUnique: async () => ({ itemId: "BI-F0715C9C", organizationId: "org-canonical" }),
      },
    };
    await expect(resolveInitiativeAuthorityContext({
      params: { itemId: "BI-F0715C9C", organizationId: "caller-org" },
      authenticatedOrganizationId: "org-canonical",
      db,
    })).resolves.toEqual({
      subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      organizationId: "org-canonical",
    });
  });

  it("uses the canonical platform authority scope for an organizationless platform item", async () => {
    const db = {
      backlogItem: {
        findUnique: async () => ({ itemId: "BI-F0715C9C", organizationId: null }),
      },
    };
    await expect(resolveInitiativeAuthorityContext({
      params: { itemId: "BI-F0715C9C", organizationId: "caller-org" },
      authenticatedOrganizationId: null,
      db,
    })).resolves.toEqual({
      subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      organizationId: "platform",
    });
  });

  it("fails closed when the governed organization does not match the authenticated organization", async () => {
    const db = {
      backlogItem: {
        findUnique: async () => ({ itemId: "BI-F0715C9C", organizationId: "org-other" }),
      },
    };
    await expect(resolveInitiativeAuthorityContext({
      params: { itemId: "BI-F0715C9C" },
      authenticatedOrganizationId: "org-canonical",
      db,
    })).rejects.toThrow("does not match the authenticated organization");
  });

  it("does not broaden an organizationless caller from the backlog item's organization", async () => {
    const db = {
      backlogItem: {
        findUnique: async () => ({ itemId: "BI-F0715C9C", organizationId: "org-canonical" }),
      },
    };
    await expect(resolveInitiativeAuthorityContext({
      params: { itemId: "BI-F0715C9C" },
      authenticatedOrganizationId: null,
      db,
    })).rejects.toThrow("requires an authenticated organization context");
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
