import { describe, expect, it } from "vitest";

import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

import {
  buildCoworkerApprovalBinding,
  evaluateCoworkerAuthority,
  type CoworkerAuthorityInput,
} from "./coworker-authority-decision";

function auth(
  overrides: Partial<EffectiveAuthContext> = {},
): EffectiveAuthContext {
  return {
    principalId: "PRN-HUMAN",
    principalAliases: [],
    population: "workforce",
    platformRole: "HR-200",
    isSuperuser: false,
    employeeId: "EMP-MANAGER",
    managerScope: {
      directReportIds: ["EMP-REPORT"],
      indirectReportIds: [],
    },
    teamIds: ["TEAM-OPS"],
    accountScope: {
      accountIds: ["ACCOUNT-1"],
      contactIds: [],
      partnerAccountIds: [],
    },
    sensitivityClearance: ["public", "internal", "confidential"],
    authentication: {
      source: "session",
      methods: ["pwd", "mfa"],
      contextClassReference: "urn:dpf:mfa",
    },
    actingHumanUserId: "USER-1",
    actingAgentId: "AGT-CHILD",
    delegationGrantIds: ["DG-1"],
    grantedCapabilities: ["view_employee", "manage_employee"],
    ...overrides,
  };
}

function base(
  overrides: Partial<CoworkerAuthorityInput> = {},
): CoworkerAuthorityInput {
  return {
    authContext: auth(),
    action: {
      toolName: "update_employee",
      requiredCapability: "manage_employee",
      agentGrantAllowed: true,
      sideEffect: true,
      executionMode: "immediate",
      routeContext: "/people",
      approvalPolicy: "side-effects",
    },
    subject: { kind: "employee", id: "EMP-REPORT" },
    delegation: {
      chainId: "CHAIN-1",
      status: "active",
      originUserId: "USER-1",
      currentAgentId: "AGT-CHILD",
      authorityScope: ["manage_employee"],
    },
    integration: { required: false, state: "not-required" },
    dataPolicy: {
      sensitivity: "confidential",
      maskingRequired: false,
      maskingSatisfied: true,
      decisionVersionsCurrent: true,
    },
    task: {
      taskRunId: "TASK-CHILD",
      parentTaskRunId: "TASK-PARENT",
    },
    rawParams: { employeeId: "EMP-REPORT", title: "Lead" },
    ...overrides,
  };
}

describe("evaluateCoworkerAuthority", () => {
  it("allows an authorized low-impact read without manufacturing approval work", () => {
    const decision = evaluateCoworkerAuthority(
      base({
        action: {
          toolName: "query_employee",
          requiredCapability: "view_employee",
          agentGrantAllowed: true,
          sideEffect: false,
          executionMode: "immediate",
          routeContext: "/people",
          approvalPolicy: "side-effects",
        },
        delegation: {
          chainId: "CHAIN-1",
          status: "active",
          originUserId: "USER-1",
          currentAgentId: "AGT-CHILD",
          authorityScope: ["view_employee"],
        },
        rawParams: { employeeId: "EMP-REPORT" },
      }),
    );

    expect(decision).toMatchObject({
      outcome: "allow",
      reasonCode: "authorized",
      nextAction: "execute",
    });
  });

  it("allows an authorized immediate read even when the coworker's coarse policy is all", () => {
    const decision = evaluateCoworkerAuthority(
      base({
        action: {
          toolName: "read_source_at_version",
          requiredCapability: "view_employee",
          agentGrantAllowed: true,
          sideEffect: false,
          executionMode: "immediate",
          routeContext: "/build/work/WC-7FF8A505",
          approvalPolicy: "all",
        },
        delegation: {
          chainId: "CHAIN-1",
          status: "active",
          originUserId: "USER-1",
          currentAgentId: "AGT-CHILD",
          authorityScope: ["view_employee"],
        },
        rawParams: {
          path: "docs/superpowers/specs/initiative-readiness-design.md",
          version: "45d2c191",
        },
      }),
    );

    expect(decision).toMatchObject({
      outcome: "allow",
      reasonCode: "authorized",
      nextAction: "execute",
    });
  });

  it("keeps proposal execution approval-gated even when it is not marked as a side effect", () => {
    const decision = evaluateCoworkerAuthority(
      base({
        action: {
          toolName: "propose_employee_update",
          requiredCapability: "manage_employee",
          agentGrantAllowed: true,
          sideEffect: false,
          executionMode: "proposal",
          routeContext: "/people",
          approvalPolicy: "none",
        },
      }),
    );

    expect(decision).toMatchObject({
      outcome: "require-approval",
      reasonCode: "approval-required",
    });
  });

  it.each<[string, Partial<EffectiveAuthContext>, string]>([
    ["missing human", { actingHumanUserId: null }, "human-identity-missing"],
    ["missing agent", { actingAgentId: null }, "agent-identity-missing"],
    [
      "human capability",
      { grantedCapabilities: ["view_employee"] },
      "human-capability-denied",
    ],
  ])("denies when %s authority is absent", (_label, context, reasonCode) => {
    const decision = evaluateCoworkerAuthority(
      base({ authContext: auth(context) }),
    );

    expect(decision).toMatchObject({
      outcome: "deny",
      reasonCode,
      nextAction: "request-authority",
    });
  });

  it("denies when the coworker grant does not authorize the tool", () => {
    const decision = evaluateCoworkerAuthority(
      base({
        action: { ...base().action, agentGrantAllowed: false },
      }),
    );

    expect(decision).toMatchObject({
      outcome: "deny",
      reasonCode: "agent-grant-denied",
    });
  });

  it.each([
    [
      "inactive chain",
      { status: "completed" as const },
      "delegation-inactive",
    ],
    [
      "wrong human root",
      { originUserId: "USER-OTHER" },
      "delegation-origin-mismatch",
    ],
    [
      "wrong child",
      { currentAgentId: "AGT-SIBLING" },
      "delegation-agent-mismatch",
    ],
    [
      "narrowed scope",
      { authorityScope: ["view_employee"] },
      "delegation-scope-denied",
    ],
  ])("denies a %s", (_label, delegationOverride, reasonCode) => {
    const decision = evaluateCoworkerAuthority(
      base({
        delegation: {
          ...base().delegation!,
          ...delegationOverride,
        },
      }),
    );

    expect(decision).toMatchObject({ outcome: "deny", reasonCode });
  });

  it("allows a manager subject but denies a peer even when they share a team", () => {
    expect(evaluateCoworkerAuthority(base()).outcome).toBe("require-approval");

    const peer = evaluateCoworkerAuthority(
      base({
        subject: { kind: "employee", id: "EMP-PEER" },
        authContext: auth({ teamIds: ["TEAM-OPS"] }),
      }),
    );
    expect(peer).toMatchObject({
      outcome: "deny",
      reasonCode: "subject-scope-denied",
    });
  });

  it("denies a backlog subject until its canonical organization is resolved", () => {
    const withoutOrganization = evaluateCoworkerAuthority(base({
      subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      organizationId: null,
    }));
    expect(withoutOrganization).toMatchObject({
      outcome: "deny",
      reasonCode: "subject-scope-denied",
    });

    const withOrganization = evaluateCoworkerAuthority(base({
      subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      organizationId: "org-canonical",
    }));
    expect(withOrganization.outcome).toBe("require-approval");
  });

  it.each([
    [
      "disconnected integration",
      { integration: { required: true, state: "disconnected" as const } },
      "integration-unavailable",
    ],
    [
      "insufficient clearance",
      {
        authContext: auth({
          sensitivityClearance: ["public", "internal"],
        }),
      },
      "sensitivity-clearance-denied",
    ],
    [
      "unmet masking",
      {
        dataPolicy: {
          ...base().dataPolicy,
          maskingRequired: true,
          maskingSatisfied: false,
        },
      },
      "masking-obligation-unmet",
    ],
    [
      "stale policy",
      {
        dataPolicy: {
          ...base().dataPolicy,
          decisionVersionsCurrent: false,
        },
      },
      "policy-version-stale",
    ],
  ])("denies for %s", (_label, override, reasonCode) => {
    expect(
      evaluateCoworkerAuthority(base(override as Partial<CoworkerAuthorityInput>)),
    ).toMatchObject({ outcome: "deny", reasonCode });
  });

  it("does not let provider fallback, prompt content, or caller sensitivity lower policy", () => {
    const decision = evaluateCoworkerAuthority(
      base({
        untrustedClaims: {
          promptRequestedApprovalBypass: true,
          providerFallbackRequested: true,
          callerSensitivity: "public",
        },
        dataPolicy: {
          ...base().dataPolicy,
          sensitivity: "restricted",
        },
      }),
    );

    expect(decision).toMatchObject({
      outcome: "deny",
      reasonCode: "sensitivity-clearance-denied",
    });
  });

  it("requires approval for an authorized side effect and returns a privacy-safe binding", () => {
    const decision = evaluateCoworkerAuthority(base());

    expect(decision).toMatchObject({
      outcome: "require-approval",
      reasonCode: "approval-required",
      nextAction: "request-approval",
      approvalBinding: {
        actingHumanUserId: "USER-1",
        actingAgentId: "AGT-CHILD",
        chainId: "CHAIN-1",
        taskRunId: "TASK-CHILD",
        toolName: "update_employee",
        subject: { kind: "employee", id: "EMP-REPORT" },
        routeContext: "/people",
      },
    });
    expect(decision.explanation).not.toContain("Lead");
    expect(JSON.stringify(decision)).not.toContain("employeeId");
  });

  it("allows the exact active approval binding", () => {
    const input = base();
    const binding = buildCoworkerApprovalBinding(input);

    const decision = evaluateCoworkerAuthority({
      ...input,
      approval: {
        status: "approved",
        expiresAt: new Date(Date.now() + 60_000),
        binding,
      },
    });

    expect(decision).toMatchObject({
      outcome: "allow",
      reasonCode: "authorized",
      nextAction: "execute",
    });
  });

  it.each([
    ["tool", { toolName: "delete_employee" }],
    ["route", { routeContext: "/finance" }],
    ["child task", { taskRunId: "TASK-SIBLING" }],
    ["delegation chain", { chainId: "CHAIN-OTHER" }],
  ])("denies approval replay for another %s", (_label, bindingOverride) => {
    const input = base();
    const binding = {
      ...buildCoworkerApprovalBinding(input),
      ...bindingOverride,
    };

    const decision = evaluateCoworkerAuthority({
      ...input,
      approval: {
        status: "approved",
        expiresAt: new Date(Date.now() + 60_000),
        binding,
      },
    });

    expect(decision).toMatchObject({
      outcome: "deny",
      reasonCode: "approval-binding-mismatch",
    });
  });

  it("denies expired approval and changed parameters", () => {
    const input = base();
    const binding = buildCoworkerApprovalBinding(input);

    expect(
      evaluateCoworkerAuthority({
        ...input,
        approval: {
          status: "approved",
          expiresAt: new Date(Date.now() - 1),
          binding,
        },
      }),
    ).toMatchObject({
      outcome: "deny",
      reasonCode: "approval-expired",
    });

    expect(
      evaluateCoworkerAuthority({
        ...input,
        rawParams: { employeeId: "EMP-REPORT", title: "Director" },
        approval: {
          status: "approved",
          expiresAt: new Date(Date.now() + 60_000),
          binding,
        },
      }),
    ).toMatchObject({
      outcome: "deny",
      reasonCode: "approval-binding-mismatch",
    });
  });
});
