import { describe, expect, it, vi } from "vitest";

import { classifyDeterministicAuthorityRefusal } from "./coworker-tool-authority-gate";
import {
  deriveAllowedRouteContexts,
  deriveCoworkerApprovalPolicy,
  deriveCoworkerAuthoritySubject,
  resolveBoundInitiativeReviewBinding,
  resolveBoundInitiativeReviewItem,
  resolveInitiativeAuthorityContext,
  resolveTrustedInitiativeItemId,
  resolveSteering,
} from "./resolve-coworker-tool-authority";

describe("explicit owner approval floor", () => {
  it.each([
    { connectionDelegation: { authorityBindingId: "consent", agentId: "agent" } },
    { roomAuthority: { actionBoundary: "preauthorized", memberOfRoom: true } },
    { initiativeReviewBinding: {} as never },
    { taskRunId: "TR-SCHED-1", toolName: "record_execution_evidence", roomMandatedTools: ["record_execution_evidence"] },
    { taskRunId: "TR-SCHED-1", agentId: "AGT-WS-PLATFORM", toolName: "create_knowledge_article" },
  ])("withholds automatic steering when the current policy explicitly requires approval: %j", extra => {
    const input = { initiativeReviewBinding: null, roomAuthority: null, agentId: "agent", ...extra, hitlPolicy: " Always " };
    expect(resolveSteering({ ...input, hitlPolicy: null })).not.toBe("none");
    expect(resolveSteering(input)).toBe("none");
  });
});

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

  it("ignores a minted itemId on create_backlog_item and keeps it for existing-item tools", () => {
    expect(deriveCoworkerAuthoritySubject({ itemId: "BI-NEW" }, "create_backlog_item"))
      .toEqual({ kind: "platform", id: "dpf" });
    expect(deriveCoworkerAuthoritySubject({ itemId: "BI-NEW", employeeId: "EMP-1" }, "create_backlog_item"))
      .toEqual({ kind: "employee", id: "EMP-1" });
    expect(deriveCoworkerAuthoritySubject({ itemId: "BI-NEW" }, "get_backlog_item"))
      .toEqual({ kind: "backlog-item", id: "BI-NEW" });
    expect(deriveCoworkerAuthoritySubject({ itemId: "BI-NEW" }, "update_backlog_item"))
      .toEqual({ kind: "backlog-item", id: "BI-NEW" });
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

  // BI-5FDE148A: a caller-chosen id on create is the id being minted. Looking it
  // up and throwing "does not exist" made every retry fail the same way.
  it("does not look up a caller-chosen itemId when creating a backlog item", async () => {
    const minted = "BI-5FDE148A";
    const db = {
      backlogItem: {
        findUnique: async (args: unknown) => {
          const itemId = (args as { where?: { itemId?: string } }).where?.itemId;
          if (itemId === minted) throw new Error("findUnique must not look up the id being minted");
          return null;
        },
      },
    };
    await expect(resolveInitiativeAuthorityContext({
      params: { itemId: minted, title: "new" },
      toolName: "create_backlog_item",
      authenticatedOrganizationId: null,
      db,
    })).resolves.toEqual({
      subject: { kind: "platform", id: "dpf" },
      organizationId: null,
    });
    await expect(resolveInitiativeAuthorityContext({
      params: { itemId: minted },
      toolName: "create_backlog_item",
      authenticatedOrganizationId: "org-canonical",
      db,
    })).resolves.toEqual({
      subject: { kind: "platform", id: "dpf" },
      organizationId: "org-canonical",
    });
  });

  it("fails closed when a non-create tool names an item that does not exist", async () => {
    for (const toolName of ["get_backlog_item", "update_backlog_item"] as const) {
      const seen: string[] = [];
      const db = {
        backlogItem: {
          findUnique: async (args: unknown) => {
            seen.push((args as { where?: { itemId?: string } }).where?.itemId ?? "");
            return null;
          },
        },
      };
      const error = await resolveInitiativeAuthorityContext({
        params: { itemId: "BI-MISSING" },
        toolName,
        authenticatedOrganizationId: "org-canonical",
        db,
      }).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("does not exist");
      expect(classifyDeterministicAuthorityRefusal(error)).toBe("authority_subject_not_found");
      expect(seen).toEqual(["BI-MISSING"]);
    }
  });

  it("classifies an organization mismatch and a missing organization context as settled refusals", async () => {
    const mismatch = await resolveInitiativeAuthorityContext({
      params: { itemId: "BI-F0715C9C" },
      toolName: "get_backlog_item",
      authenticatedOrganizationId: "org-canonical",
      db: { backlogItem: { findUnique: async () => ({ itemId: "BI-F0715C9C", organizationId: "org-other" }) } },
    }).then(() => null, (caught: unknown) => caught);
    expect(classifyDeterministicAuthorityRefusal(mismatch)).toBe("authority_binding_mismatch");

    const missingOrg = await resolveInitiativeAuthorityContext({
      params: { itemId: "BI-F0715C9C" },
      toolName: "update_backlog_item",
      authenticatedOrganizationId: null,
      db: { backlogItem: { findUnique: async () => ({ itemId: "BI-F0715C9C", organizationId: "org-canonical" }) } },
    }).then(() => null, (caught: unknown) => caught);
    expect(classifyDeterministicAuthorityRefusal(missingOrg)).toBe("authority_scope_missing");
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
    expect(resolveBoundInitiativeReviewBinding(task, "record_initiative_evidence"))
      .toMatchObject({ itemId: "BI-47ACE2C7", artifactRef });
  });

  // Observed 2026-09-06. summon_coworker persists the initiativeReviewBinding key
  // unconditionally, so an ORDINARY dispatch that has no review binding at all
  // arrives with the key present and JSON null. `=== undefined` slipped past it,
  // the parse of null failed, and the authority gate rejected every governed tool
  // with "verified authority context is unavailable". A compliance coworker asked
  // to research a statutory rate loaded its tools and then had search_public_web
  // refused twice — failing closed on the absence of something that was never
  // required. mcp-task-capacity-resume.ts already treated null and undefined
  // alike; this gate did not.
  it("treats a persisted null binding as no binding, not as an invalid one", () => {
    const ordinaryDispatch = {
      ...task,
      a2aMetadata: {
        trigger: "external-mcp",
        sourceRef: { kind: "mcp-token", id: "PAT-BI47" },
        initiativeReviewBinding: null,
      },
    };
    expect(resolveBoundInitiativeReviewItem(ordinaryDispatch, "search_public_web")).toBeNull();
    expect(() => resolveBoundInitiativeReviewItem(ordinaryDispatch, "search_public_web")).not.toThrow();
  });

  it("still treats an absent binding key as no binding", () => {
    const noKey = {
      ...task,
      a2aMetadata: {
        trigger: "external-mcp",
        sourceRef: { kind: "mcp-token", id: "PAT-BI47" },
      },
    };
    expect(resolveBoundInitiativeReviewItem(noKey, "search_public_web")).toBeNull();
  });

  // The fix must not soften the real guard: a binding that is PRESENT and
  // malformed is still a fail-closed error, because that is a review dispatch
  // whose identity cannot be trusted.
  it("still fails closed on a present but unparseable binding", () => {
    const malformed = {
      ...task,
      a2aMetadata: {
        trigger: "external-mcp",
        sourceRef: { kind: "mcp-token", id: "PAT-BI47" },
        initiativeReviewBinding: { writerToolName: "record_initiative_evidence" },
      },
    };
    expect(() => resolveBoundInitiativeReviewItem(malformed, "record_initiative_evidence"))
      .toThrow("invalid immutable initiative review binding");
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

  it("classifies binding, scope, and invalid-review failures as settled refusals", () => {
    const refusalOf = (run: () => void) => {
      try {
        run();
      } catch (error) {
        return classifyDeterministicAuthorityRefusal(error);
      }
      throw new Error("expected a resolution refusal");
    };
    expect(refusalOf(() => resolveBoundInitiativeReviewItem(task, "record_initiative_design_review")))
      .toBe("authority_binding_mismatch");
    expect(refusalOf(() => resolveBoundInitiativeReviewItem({
      ...task,
      a2aMetadata: {
        trigger: "external-mcp",
        sourceRef: { kind: "mcp-token", id: "PAT-BI47" },
        initiativeReviewBinding: { writerToolName: "record_initiative_evidence" },
      },
    }, "record_initiative_evidence"))).toBe("authority_binding_mismatch");
    expect(refusalOf(() => resolveBoundInitiativeReviewItem({
      ...task,
      authorityScope: ["tool:read_source_at_version", "tool:record_initiative_evidence"],
    }, "record_initiative_evidence"))).toBe("authority_scope_missing");
    expect(refusalOf(() => resolveBoundInitiativeReviewItem({
      ...task,
      a2aMetadata: { ...task.a2aMetadata, trigger: "interactive" },
    }, "record_initiative_evidence"))).toBe("authority_binding_mismatch");
    expect(classifyDeterministicAuthorityRefusal(new Error("connect ETIMEDOUT"))).toBeNull();
    expect(classifyDeterministicAuthorityRefusal(new Error('relation "BacklogItem" does not exist'))).toBeNull();
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

  it("routes an exact server-bound initiative review through action-specific policy authority", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 2,
      hitlPolicy: "side-effects",
      serverBoundInitiativeReview: true,
    })).toBe("side-effects");
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 3,
      hitlPolicy: "none",
      serverBoundInitiativeReview: true,
    })).toBe("side-effects");
  });

  it("does not let a tier-1 reviewer identity bypass the action-specific authority seam", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 1,
      hitlPolicy: "side-effects",
      serverBoundInitiativeReview: true,
    })).toBe("all");
  });

  it("keeps a bound review subject to the reviewer's configured side-effect policy", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 1,
      hitlPolicy: "side-effects",
      serverBoundInitiativeReview: true,
    })).toBe("all");
  });

  it("keeps ordinary side effects behind the coworker's configured approval policy", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 2,
      hitlPolicy: "side-effects",
      serverBoundInitiativeReview: false,
    })).toBe("side-effects");
  });

  it("does not override an explicit always-approve reviewer policy", () => {
    expect(deriveCoworkerApprovalPolicy({
      hitlTierDefault: 1,
      hitlPolicy: "always",
      serverBoundInitiativeReview: true,
    })).toBe("all");
  });
});

describe("resolveTrustedInitiativeItemId (BI-099A0BA3, security review L1)", () => {
  const task = (taskRunId: string) => ({ taskRunId, parentTaskRunId: null, authorityScope: [], a2aMetadata: {} });

  it("takes an external run's subject from its bound packet", async () => {
    const loadStewardItemId = vi.fn();
    await expect(resolveTrustedInitiativeItemId({
      task: task("TR-MCP-1"), toolName: "record_initiative_evidence", boundItemId: "BI-BOUND", loadStewardItemId,
    })).resolves.toBe("BI-BOUND");
    expect(loadStewardItemId).not.toHaveBeenCalled();
  });

  it("takes a steward run's subject from the packet the platform issued its room, never from model arguments", async () => {
    const loadStewardItemId = vi.fn(async () => "BI-ROUTED");
    await expect(resolveTrustedInitiativeItemId({
      task: task("TR-SCHED-ABCD1234"), toolName: "record_initiative_evidence", boundItemId: null, loadStewardItemId,
    })).resolves.toBe("BI-ROUTED");
    expect(loadStewardItemId).toHaveBeenCalledWith("TR-SCHED-ABCD1234", "record_initiative_evidence");
  });

  it("takes a platform review run's subject from the review the platform issued its room (BI-AA47C672)", async () => {
    const loadStewardItemId = vi.fn(async () => "BI-MERGED");
    await expect(resolveTrustedInitiativeItemId({
      task: task("TR-SCHED-PIR00001"), toolName: "record_initiative_post_implementation_review", boundItemId: null, loadStewardItemId,
    })).resolves.toBe("BI-MERGED");
    expect(loadStewardItemId).toHaveBeenCalledWith("TR-SCHED-PIR00001", "record_initiative_post_implementation_review");
  });

  it("asks nothing for another tool or a non-scheduled run", async () => {
    const loadStewardItemId = vi.fn(async () => "BI-ROUTED");
    await expect(resolveTrustedInitiativeItemId({ task: task("TR-SCHED-1"), toolName: "record_workroom_evidence", boundItemId: null, loadStewardItemId })).resolves.toBeNull();
    await expect(resolveTrustedInitiativeItemId({ task: task("TR-CHAT-1"), toolName: "record_initiative_evidence", boundItemId: null, loadStewardItemId })).resolves.toBeNull();
    await expect(resolveTrustedInitiativeItemId({ task: null, toolName: "record_initiative_evidence", boundItemId: null, loadStewardItemId })).resolves.toBeNull();
    expect(loadStewardItemId).not.toHaveBeenCalled();
  });
});

// Approval convergence A3 (BI-C8EC05C9, spec D2 S2): under a propose boundary
// no policy projection may approve on a person's behalf. The flag is
// server-only context; nothing a caller sends can set it.
describe("proposeBoundaryAuthority", () => {
  it("passes the boundary through and forbids policy projection under it", async () => {
    const { proposeBoundaryAuthority } = await import("./resolve-coworker-tool-authority");
    expect(proposeBoundaryAuthority({ proposeBoundary: true }, "side-effects")).toEqual({ proposeBoundary: true, policyProjectionAllowed: false });
    expect(proposeBoundaryAuthority({ proposeBoundary: true }, "always")).toEqual({ proposeBoundary: true, policyProjectionAllowed: false });
  });

  it("changes nothing without it", async () => {
    const { proposeBoundaryAuthority } = await import("./resolve-coworker-tool-authority");
    expect(proposeBoundaryAuthority(undefined, "side-effects")).toEqual({ policyProjectionAllowed: true });
    expect(proposeBoundaryAuthority({}, " Always ")).toEqual({ policyProjectionAllowed: false });
    expect(proposeBoundaryAuthority({ proposeBoundary: false }, null)).toEqual({ policyProjectionAllowed: true });
  });
});
