import { describe, expect, it } from "vitest";

import {
  deriveAllowedRouteContexts,
  deriveCoworkerApprovalPolicy,
  deriveCoworkerAuthoritySubject,
  resolveBoundInitiativeReviewItem,
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
  it("derives an organization-owned initiative from a validated server-bound review", async () => {
    const db = {
      backlogItem: {
        findUnique: async () => ({ itemId: "BI-F0715C9C", organizationId: "org-canonical" }),
      },
    };
    await expect(resolveInitiativeAuthorityContext({
      params: { decision: "pass", organizationId: "caller-org" },
      trustedBoundItemId: "BI-F0715C9C",
      authenticatedOrganizationId: null,
      db,
    })).resolves.toEqual({
      subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      organizationId: "org-canonical",
    });
  });

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

describe("resolveBoundInitiativeReviewItem", () => {
  const artifactRef = {
    kind: "repo-blob-at-commit",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    commitSha: "2e9f97d2d5ccb5f97b60e0991c34820a83cc1ec0",
    path: "docs/superpowers/specs/design.md",
    providerBlobId: "5ac674c03be1b21a335ea5b8607125f830e673a5",
  };
  const task = {
    taskRunId: "TR-MCP-BI47",
    parentTaskRunId: null,
    authorityScope: [
      "backlog-item:BI-47ACE2C7",
      "tool:read_source_at_version",
      "tool:record_initiative_evidence",
    ],
    a2aMetadata: {
      trigger: "external-mcp",
      sourceRef: { kind: "mcp-token", id: "PAT-BI47" },
      initiativeReviewBinding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-47ACE2C7",
        gate: "research",
        artifactRef,
      },
    },
  };

  it("accepts only the exact writer and exact persisted item/tool scope", () => {
    expect(resolveBoundInitiativeReviewItem(task, "record_initiative_evidence"))
      .toBe("BI-47ACE2C7");
  });

  it("fails closed when the executing writer differs from the immutable binding", () => {
    expect(() => resolveBoundInitiativeReviewItem(task, "record_initiative_design_review"))
      .toThrow("writer tool does not match");
  });

  it("leaves immutable reader authority unchanged on the same review TaskRun", () => {
    expect(resolveBoundInitiativeReviewItem(task, "read_source_at_version"))
      .toBeNull();
  });

  it("fails closed when exact backlog or writer scope is missing", () => {
    expect(() => resolveBoundInitiativeReviewItem({
      ...task,
      authorityScope: ["tool:read_source_at_version", "tool:record_initiative_evidence"],
    }, "record_initiative_evidence")).toThrow("backlog-item:BI-47ACE2C7");
  });

  it("does not trust initiative binding metadata on a non-external TaskRun", () => {
    expect(() => resolveBoundInitiativeReviewItem({
      ...task,
      a2aMetadata: { ...task.a2aMetadata, trigger: "interactive" },
    }, "record_initiative_evidence")).toThrow("external MCP TaskRun");
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

  it("does not add a second human approval to an exact server-bound independent review", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 2,
      hitlPolicy: "side-effects",
      serverBoundIndependentReview: true,
    })).toBe("none");
  });

  it("treats the exact server-bound review as the approval even for a tier-1 reviewer", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 1,
      hitlPolicy: "side-effects",
      serverBoundIndependentReview: true,
    })).toBe("none");
  });

  it("keeps ordinary side effects behind the coworker's configured approval policy", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 2,
      hitlPolicy: "side-effects",
      serverBoundIndependentReview: false,
    })).toBe("side-effects");
  });

  it("does not override an explicit always-approve reviewer policy", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 1,
      hitlPolicy: "always",
      serverBoundIndependentReview: true,
    })).toBe("all");
  });
});
