import { describe, expect, it, vi } from "vitest";

import { buildCoworkerApprovalBinding, type CoworkerAuthorityInput } from "./coworker-authority-decision";
import {
  buildPolicyActionJudgmentRequest,
  routinePolicyActionEligibility,
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
  const workroomRef = {
    kind: "workroom-head" as const,
    workroomId: "WC-48A3D214",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    branchName: "fix/wwmd-exact-bound-receipts",
    headSha: "f5681171c826a328c6795dfbdac8868efc2e4506",
  };
  const artifactRef = {
    kind: "repo-blob-at-commit" as const,
    repositoryFullName: workroomRef.repositoryFullName,
    commitSha: workroomRef.headSha,
    path: "docs/superpowers/specs/wwmd-exact-bound-receipts.md",
    providerBlobId: "blob-1",
  };

  function routine(overrides: Record<string, unknown> = {}) {
    const input = authorityInput();
    input.task = {
      taskRunId: "TR-EXACT",
      initiativeReviewBinding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-2014236E",
        gate: "research",
        workroomRef: { ...workroomRef },
        artifactRef: { ...artifactRef },
      },
    };
    input.rawParams = {
      decision: "pass",
      reason: "The named-ref reproduction and evidence pass.",
      findings: [],
      resolvedFindingRefs: [],
      ...overrides,
    };
    return input;
  }

  it("admits only an exact-bound finding-free platform receipt pass", () => {
    expect(routinePolicyActionEligibility(routine())).toEqual({ eligible: true });
  });

  it.each([
    ["finding-bearing pass", { findings: [{ issue: "Unresolved", severity: "important" }] }, "findings-present"],
    ["failed review", { decision: "fail" }, "non-pass-decision"],
    ["not-applicable review", { decision: "not-applicable" }, "non-pass-decision"],
  ])("escalates a %s", (_name, rawPatch, reason) => {
    expect(routinePolicyActionEligibility(routine(rawPatch))).toEqual({ eligible: false, reason });
  });

  it("escalates missing and mismatched immutable Workroom bindings", () => {
    const missing = routine();
    delete missing.task?.initiativeReviewBinding?.workroomRef;
    expect(routinePolicyActionEligibility(missing)).toEqual({ eligible: false, reason: "workroom-binding-required" });

    const mismatch = routine();
    mismatch.task!.initiativeReviewBinding!.artifactRef.commitSha = "different-head";
    expect(routinePolicyActionEligibility(mismatch)).toEqual({ eligible: false, reason: "workroom-binding-mismatch" });
  });

  it("escalates cross-scope, customer-business, external, and non-immediate actions", () => {
    const customerBusiness = routine();
    customerBusiness.organizationId = "org-customer";
    expect(routinePolicyActionEligibility(customerBusiness)).toEqual({ eligible: false, reason: "platform-scope-required" });

    const external = routine();
    external.integration = { required: true, state: "connected" };
    expect(routinePolicyActionEligibility(external)).toEqual({ eligible: false, reason: "internal-action-required" });

    const proposed = routine();
    proposed.action.executionMode = "proposal";
    expect(routinePolicyActionEligibility(proposed)).toEqual({ eligible: false, reason: "immediate-action-required" });

    const destructive = routine();
    destructive.action.consequence = "irreversible";
    expect(routinePolicyActionEligibility(destructive)).toEqual({ eligible: false, reason: "consequential-action-requires-human" });

    const always = routine();
    always.action.policyProjectionAllowed = false;
    expect(routinePolicyActionEligibility(always)).toEqual({ eligible: false, reason: "operator-policy-requires-approval" });
  });

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
    const input = routine();
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
