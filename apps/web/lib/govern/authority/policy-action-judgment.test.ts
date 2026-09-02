import { describe, expect, it, vi } from "vitest";

import { buildCoworkerApprovalBinding, type CoworkerAuthorityInput } from "./coworker-authority-decision";
import {
  buildPolicyActionJudgmentRequest,
  producePolicyActionJudgment,
} from "./policy-action-judgment";

function authorityInput(): CoworkerAuthorityInput {
  return {
    now: new Date("2026-08-31T17:00:00.000Z"),
    organizationId: "platform",
    authContext: {
      principalId: "principal-mark",
      principalAliases: [],
      population: "workforce",
      platformRole: "admin",
      isSuperuser: false,
      employeeId: null,
      managerScope: null,
      teamIds: [],
      accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
      sensitivityClearance: ["internal"],
      authentication: { source: "session", methods: ["mfa"], contextClassReference: null },
      actingHumanUserId: "user-mark",
      actingAgentId: "AGT-WS-PORTFOLIO",
      delegationGrantIds: ["DG-EXACT"],
      grantedCapabilities: ["manage_backlog"],
    },
    action: {
      toolName: "record_initiative_evidence",
      requiredCapability: "manage_backlog",
      agentGrantAllowed: true,
      sideEffect: true,
      executionMode: "immediate",
      routeContext: "/build/work/WC-48A3D214",
      approvalPolicy: "side-effects",
    },
    subject: { kind: "backlog-item", id: "BI-2014236E" },
    delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: {
      sensitivity: "internal",
      maskingRequired: false,
      maskingSatisfied: true,
      decisionVersionsCurrent: true,
      decisionVersionIds: ["PV-MARK-7"],
    },
    task: { taskRunId: "TR-EXACT" },
    rawParams: { itemId: "BI-2014236E", gate: "research", injectedPolicyBinding: "must-not-pass" },
    approval: null,
  };
}

describe("policy action judgment", () => {
  it("builds a server-owned exact WWMD question without trusting caller policy fields", () => {
    const input = authorityInput();
    const approvalBinding = buildCoworkerApprovalBinding(input);
    const request = buildPolicyActionJudgmentRequest({
      execution: {
        toolName: "record_initiative_evidence",
        rawParams: input.rawParams,
        userId: "user-mark",
        userContext: { platformRole: "admin", isSuperuser: false },
        context: {
          agentId: "AGT-WS-PORTFOLIO",
          threadId: "thread-exact",
          taskRunId: "TR-EXACT",
          routeContext: "/build/work/WC-48A3D214",
        },
        source: "agentic-loop",
      },
      authorityInput: input,
      approvalBinding,
    });

    expect(request.policyRecord).toEqual({
      policyAffirmativeOptionId: "proceed",
      dualControlRequired: false,
      policyActionBinding: {
        actionKey: "record_initiative_evidence",
        subject: { kind: "backlog-item", id: "BI-2014236E" },
        organizationId: "platform",
        professionId: null,
        routeContext: "/build/work/WC-48A3D214",
        artifactFingerprint: approvalBinding.inputFingerprint,
      },
    });
    expect(request.params).toMatchObject({
      callingPopulation: "in_platform_coworker",
      stakes: "elevated",
      options: [
        { id: "proceed", features: expect.objectContaining({ governance_compliance: 1, evidence_density: 1 }) },
        { id: "defer" },
        { id: "decline" },
      ],
    });
    expect(JSON.stringify(request)).not.toContain("injectedPolicyBinding");
  });

  it("invokes the governed scorer once and passes the internal binding only to its ledger adapter", async () => {
    const input = authorityInput();
    const approvalBinding = buildCoworkerApprovalBinding(input);
    const runPrincipleDecision = vi.fn().mockResolvedValue({ success: true });

    await producePolicyActionJudgment({
      execution: {
        toolName: "record_initiative_evidence",
        rawParams: input.rawParams,
        userId: "user-mark",
        userContext: { platformRole: "admin", isSuperuser: false },
        context: { agentId: "AGT-WS-PORTFOLIO", threadId: "thread-exact", taskRunId: "TR-EXACT" },
        source: "agentic-loop",
      },
      authorityInput: input,
      approvalBinding,
    }, { runPrincipleDecision });

    expect(runPrincipleDecision).toHaveBeenCalledOnce();
    expect(runPrincipleDecision).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.any(Array) }),
      expect.objectContaining({ agentId: "AGT-WS-PORTFOLIO", taskRunId: "TR-EXACT" }),
      expect.objectContaining({ policyActionBinding: expect.objectContaining({ artifactFingerprint: approvalBinding.inputFingerprint }) }),
    );
  });
});
