import { expect, it, vi } from "vitest";

import {
  buildCoworkerApprovalBinding,
  type CoworkerAuthorityInput,
} from "./govern/authority/coworker-authority-decision";
import {
  governedExecuteTool,
  type _setGovernanceForTests,
} from "./mcp-governed-execute";

type AuditRow = Record<string, unknown>;
type GovernanceOverrides = Parameters<typeof _setGovernanceForTests>[0];

type AuthorityCaseHarness = {
  applyOverrides(overrides: GovernanceOverrides): void;
  authorityInput(
    overrides?: Partial<CoworkerAuthorityInput>,
  ): CoworkerAuthorityInput;
  normalUser: {
    platformRole: string;
    isSuperuser: boolean;
  };
  executeMock(): unknown;
  authorityRows(): AuditRow[];
  auditRows(): AuditRow[];
  approvalEnvelopeCreate(): unknown;
  approvalTaskResume(): unknown;
  approvalEnvelopeFinalize(): unknown;
};

export function registerCoworkerAuthorityCases(
  harness: AuthorityCaseHarness,
): void {
  it("evaluates and records every coworker tool action at the universal seam", async () => {
    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { status: "open" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", routeContext: "/ops" },
      source: "agentic-loop",
    });

    expect(result.success).toBe(true);
    expect(harness.executeMock()).toHaveBeenCalledOnce();
    expect(harness.authorityRows()).toHaveLength(1);
    expect(harness.authorityRows()[0]).toMatchObject({
      actorType: "ai-coworker",
      actorRef: "AGT-100",
      humanContextRef: "user-1",
      actionKey: "query_backlog",
      decision: "allow",
      routeContext: "/ops",
      sensitivityLevel: "internal",
    });
  });

  it("records the server-resolved initiative organization and backlog subject", async () => {
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => harness.authorityInput({
        organizationId: "org-canonical",
        subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      }),
    });

    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { itemId: "BI-F0715C9C", organizationId: "caller-org" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", organizationId: "org-canonical" },
      source: "agentic-loop",
    });

    expect(result.success).toBe(true);
    expect(harness.authorityRows().at(-1)).toMatchObject({
      organizationId: "org-canonical",
      objectRef: "backlog-item:BI-F0715C9C",
    });
  });

  it("persists platform initiative scope without a tenant organization foreign key", async () => {
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => harness.authorityInput({
        organizationId: "platform",
        subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      }),
    });

    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { itemId: "BI-F0715C9C" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100" },
      source: "agentic-loop",
    });

    expect(result.success).toBe(true);
    expect(harness.authorityRows().at(-1)).toMatchObject({
      organizationId: null,
      objectRef: "backlog-item:BI-F0715C9C",
      rationale: { authorityOrganizationScope: "platform" },
    });
  });

  it("denies without executing when universal authority rejects the action", async () => {
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () =>
        harness.authorityInput({
          authContext: {
            ...harness.authorityInput().authContext,
            grantedCapabilities: ["view_platform"],
          },
          action: {
            ...harness.authorityInput().action,
            toolName: "create_backlog_item",
            requiredCapability: "manage_backlog",
            sideEffect: true,
            approvalPolicy: "side-effects",
          },
        }),
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "private title" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", routeContext: "/ops" },
      source: "agentic-loop",
    });

    expect(result).toMatchObject({
      success: false,
      error: "authority_denied",
      governance: {
        rejected: "authority_denied",
        authorityReason: "human-capability-denied",
      },
    });
    expect(harness.executeMock()).not.toHaveBeenCalled();
    expect(harness.authorityRows().at(-1)).toMatchObject({
      decision: "deny",
      rationale: { reasonCode: "human-capability-denied" },
    });
    expect(JSON.stringify(harness.authorityRows())).not.toContain(
      "private title",
    );
  });

  it("rejects a missing agent grant and audits the denial", async () => {
    harness.applyOverrides({
      resolveAgentGrants: async () => ["registry_read"],
      isAllowedByGrants: () => false,
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "x", type: "product", source: "user-request" },
      userId: "u",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100" },
      source: "rest",
    });

    expect(result).toMatchObject({
      success: false,
      error: "authority_denied",
      governance: { authorityReason: "agent-grant-denied" },
    });
    expect(harness.executeMock()).not.toHaveBeenCalled();
    expect(harness.auditRows()).toHaveLength(1);
    expect(harness.auditRows()[0]).toMatchObject({
      success: false,
      toolName: "create_backlog_item",
    });
  });

  it("returns a bounded approval requirement without executing", async () => {
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () =>
        harness.authorityInput({
          action: {
            ...harness.authorityInput().action,
            toolName: "create_backlog_item",
            requiredCapability: "manage_backlog",
            sideEffect: true,
            approvalPolicy: "side-effects",
          },
          rawParams: { title: "private title" },
        }),
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "private title" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: {
        agentId: "AGT-100",
        routeContext: "/ops",
        taskRunId: "TASK-1",
      },
      source: "agentic-loop",
    });

    expect(result).toMatchObject({
      success: false,
      error: "approval_required",
      governance: {
        rejected: "approval_required",
        authorityReason: "approval-required",
      },
      data: {
        envelopeId: "ENV-1",
        approvalBinding: {
          actingHumanUserId: "user-1",
          actingAgentId: "AGT-100",
          toolName: "create_backlog_item",
        },
      },
    });

    // BI-7561687F: the model must tell a wait apart from a refusal. When it
    // could not, coworkers filed tech debt asking for tools that already exist —
    // record_initiative_evidence had 139 successful executions at the time.
    expect(result.message).toContain("waiting for a person to approve it");
    expect(result.message).toContain("ENV-1");
    expect(result.message).toContain("is available to you");
    expect(result.message).toContain("calling it again will not advance it");
    expect(result.message).not.toContain("rejected:");
    expect(harness.executeMock()).not.toHaveBeenCalled();
    expect(harness.approvalEnvelopeCreate()).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("private title");
    expect(harness.authorityRows().at(-1)).toMatchObject({
      decision: "require-approval",
    });
  });

  it("runs a routine write under the human's OAuth consent with no envelope and records why (BI-12E5DD91)", async () => {
    const steered = harness.authorityInput({
      action: {
        ...harness.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "all",
      },
      steering: "connection-delegation",
    });
    harness.applyOverrides({ resolveCoworkerAuthorityInput: async () => steered });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "requested by the human" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: {
        agentId: "AGT-100",
        authSource: "oauth",
        connectionDelegation: { authorityBindingId: "binding-row-1", agentId: "AGT-100" },
      },
      source: "external-jsonrpc",
    });

    expect(result.success).toBe(true);
    expect(harness.executeMock()).toHaveBeenCalledOnce();
    expect(harness.approvalEnvelopeCreate()).not.toHaveBeenCalled();
    expect(harness.authorityRows().at(-1)).toMatchObject({
      decision: "allow",
      authorityBindingId: "binding-row-1",
      rationale: expect.objectContaining({
        escalationReason: "steered-by-connection-delegation",
        escalationSteering: "connection-delegation",
        damaging: false,
      }),
    });
  });

  it("still puts an authority-changing write to a person under the same consent (BI-12E5DD91)", async () => {
    const damaging = harness.authorityInput({
      action: {
        ...harness.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "all",
        consequence: "authority",
      },
      steering: "connection-delegation",
    });
    harness.applyOverrides({ resolveCoworkerAuthorityInput: async () => damaging });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "grant change" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: {
        agentId: "AGT-100",
        connectionDelegation: { authorityBindingId: "binding-row-1", agentId: "AGT-100" },
      },
      source: "external-jsonrpc",
    });

    expect(result).toMatchObject({ success: false, error: "approval_required" });
    expect(harness.executeMock()).not.toHaveBeenCalled();
    expect(harness.approvalEnvelopeCreate()).toHaveBeenCalledWith(expect.objectContaining({
      explanation: expect.stringContaining("changes someone's authority"),
    }));
    expect(harness.authorityRows().at(-1)).toMatchObject({
      decision: "require-approval",
      rationale: expect.objectContaining({ escalationReason: "damaging-consequence" }),
    });
  });

  it("puts the unresolved WWMD residue on the human decision card", async () => {
    const pending = harness.authorityInput({
      action: {
        ...harness.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "side-effects",
      },
    });
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => pending,
      policyAuthorityProjectionAttempt: async () => ({
        outcome: "not-authorized" as const,
        explanation: "Human decision required: commandment conflict.",
      }),
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "bounded exception" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", taskRunId: "TASK-EXCEPTION" },
      source: "agentic-loop",
    });

    expect(result).toMatchObject({
      success: false,
      error: "approval_required",
      message: expect.stringContaining("Human decision required: commandment conflict."),
    });
    expect(harness.approvalEnvelopeCreate()).toHaveBeenCalledWith(expect.objectContaining({
      // BI-12E5DD91: the stored reason also names the escalation branch.
      explanation: expect.stringMatching(/^Human decision required: commandment conflict\. \S/),
    }));
    expect(harness.executeMock()).not.toHaveBeenCalled();
  });

  it("consumes a server-projected exact-call policy authorization before execution", async () => {
    const pending = harness.authorityInput({
      organizationId: "org-canonical",
      action: {
        ...harness.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "side-effects",
      },
      rawParams: { title: "policy-authorized" },
    });
    const projected = vi.fn(async () => ({
      outcome: "approved" as const,
      authorityDecisionId: "AUTH-POLICY",
      envelopeId: "ENV-POLICY",
      expiresAt: new Date(Date.now() + 60_000),
    }));
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => pending,
      policyAuthorityProjectionAttempt: projected,
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "policy-authorized" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", organizationId: "org-canonical" },
      source: "agentic-loop",
    });

    expect(result.success).toBe(true);
    expect(projected).toHaveBeenCalledWith(expect.objectContaining({
      execution: expect.objectContaining({ toolName: "create_backlog_item" }),
      authorityInput: expect.objectContaining({ organizationId: "org-canonical" }),
      approvalBinding: expect.objectContaining({ toolName: "create_backlog_item" }),
    }));
    expect(harness.approvalEnvelopeCreate()).not.toHaveBeenCalled();
    expect(harness.approvalEnvelopeFinalize()).toHaveBeenCalledWith("ENV-POLICY", true);
  });

  it("rejects replay when the policy-derived single-use envelope is already reserved", async () => {
    const pending = harness.authorityInput({
      organizationId: "org-canonical",
      action: {
        ...harness.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "side-effects",
      },
      rawParams: { title: "policy-replay" },
    });
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => pending,
      policyAuthorityProjectionAttempt: async () => ({
        outcome: "approved" as const,
        authorityDecisionId: "AUTH-POLICY",
        envelopeId: "ENV-POLICY",
        expiresAt: new Date(Date.now() + 60_000),
      }),
      policyAuthorityEnvelopeReserve: async () => false,
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "policy-replay" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", organizationId: "org-canonical" },
      source: "agentic-loop",
    });

    expect(result).toMatchObject({
      success: false,
      error: "authority_evidence_unavailable",
      governance: { rejected: "authority_evidence_unavailable" },
    });
    expect(harness.executeMock()).not.toHaveBeenCalled();
    expect(harness.approvalEnvelopeFinalize()).not.toHaveBeenCalled();
  });

  it("fails closed when the exact-bound owning policy explicitly declines", async () => {
    const pending = harness.authorityInput({
      organizationId: "org-canonical",
      action: {
        ...harness.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "side-effects",
      },
      rawParams: { title: "policy-declined" },
    });
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => pending,
      policyAuthorityProjectionAttempt: async () => ({
        outcome: "denied" as const,
        reasonCode: "policy-declined" as const,
        explanation: "The owning policy judgment explicitly declined this action.",
      }),
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "policy-declined" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", organizationId: "org-canonical" },
      source: "agentic-loop",
    });

    expect(result).toMatchObject({
      success: false,
      error: "authority_denied",
      governance: {
        rejected: "authority_denied",
        authorityReason: "policy-declined",
      },
    });
    expect(harness.executeMock()).not.toHaveBeenCalled();
    expect(harness.approvalEnvelopeCreate()).not.toHaveBeenCalled();
    expect(harness.authorityRows().at(-1)).toMatchObject({
      decision: "deny",
      rationale: expect.objectContaining({ reasonCode: "policy-declined" }),
    });
  });

  it("does not substitute the initiating-human approval path for a dual-control floor", async () => {
    const pending = harness.authorityInput({
      organizationId: "org-canonical",
      action: {
        ...harness.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "side-effects",
      },
      rawParams: { title: "dual-control" },
    });
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => pending,
      policyAuthorityProjectionAttempt: async () => ({
        outcome: "resolution-required" as const,
        reasonCode: "dual-control-required" as const,
        explanation: "This action requires a fresh distinct-human approval bound to the exact call.",
      }),
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "dual-control" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", organizationId: "org-canonical" },
      source: "agentic-loop",
    });

    expect(result).toMatchObject({
      success: false,
      error: "authority_denied",
      governance: {
        rejected: "authority_denied",
        authorityReason: "dual-control-required",
      },
    });
    expect(harness.executeMock()).not.toHaveBeenCalled();
    expect(harness.approvalEnvelopeCreate()).not.toHaveBeenCalled();
  });

  it("resumes and finalizes only the exact task bound to an approved call", async () => {
    const pending = harness.authorityInput({
      action: {
        ...harness.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "side-effects",
      },
      task: { taskRunId: "TASK-1", parentTaskRunId: "TASK-PARENT" },
      rawParams: { title: "approved title" },
    });
    const binding = buildCoworkerApprovalBinding(pending);
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => ({
        ...pending,
        approval: {
          envelopeId: "ENV-APPROVED",
          status: "approved",
          expiresAt: new Date(Date.now() + 60_000),
          binding,
        },
      }),
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "approved title" },
      userId: "user-1",
      userContext: harness.normalUser,
      context: {
        agentId: "AGT-100",
        routeContext: "/ops",
        taskRunId: "TASK-1",
      },
      source: "agentic-loop",
    });

    expect(result.success).toBe(true);
    expect(harness.approvalTaskResume()).toHaveBeenCalledWith("TASK-1");
    expect(harness.approvalTaskResume()).not.toHaveBeenCalledWith(
      "TASK-SIBLING",
    );
    expect(harness.approvalEnvelopeFinalize()).toHaveBeenCalledWith(
      "ENV-APPROVED",
      true,
    );
  });

  it("fails closed when authority evidence cannot be recorded", async () => {
    harness.applyOverrides({
      authorizationDecisionCreate: async () => {
        throw new Error("decision store unavailable");
      },
    });

    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100" },
      source: "agentic-loop",
    });

    expect(result).toMatchObject({
      success: false,
      error: "authority_evidence_unavailable",
    });
    expect(harness.executeMock()).not.toHaveBeenCalled();
  });

  it("keeps direct human REST calls on the existing capability seam", async () => {
    harness.applyOverrides({
      resolveCoworkerAuthorityInput: async () => {
        throw new Error("must not resolve coworker authority");
      },
    });

    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "user-1",
      userContext: harness.normalUser,
      source: "rest",
    });

    expect(result.success).toBe(true);
    expect(harness.authorityRows()).toHaveLength(0);
  });
}
