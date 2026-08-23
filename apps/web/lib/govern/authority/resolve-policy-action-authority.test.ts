import { describe, expect, it, vi } from "vitest";

import { buildCoworkerApprovalBinding, type CoworkerAuthorityInput } from "./coworker-authority-decision";
import { resolveAndPersistPolicyActionAuthority } from "./resolve-policy-action-authority";

describe("resolveAndPersistPolicyActionAuthority", () => {
  it("loads the sealed decision, current profile provenance, and exact action binding server-side", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const authorityInput: CoworkerAuthorityInput = {
      now,
      organizationId: "org-canonical",
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
        actingAgentId: "AGT-WS-DEV",
        delegationGrantIds: [],
        grantedCapabilities: ["manage_backlog"],
      },
      action: {
        toolName: "record_initiative_design_review",
        requiredCapability: "manage_backlog",
        agentGrantAllowed: true,
        sideEffect: true,
        executionMode: "immediate",
        routeContext: "/tool/record_initiative_design_review",
        approvalPolicy: "side-effects",
      },
      subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      delegation: null,
      integration: { required: false, state: "not-required" },
      dataPolicy: {
        sensitivity: "internal",
        maskingRequired: false,
        maskingSatisfied: true,
        decisionVersionsCurrent: true,
        decisionVersionIds: ["PV-7"],
      },
      task: null,
      rawParams: { itemId: "BI-F0715C9C", commitSha: "abc123" },
      approval: null,
    };
    const approvalBinding = buildCoworkerApprovalBinding(authorityInput);
    const decisionRow = {
      interactionId: "DI-BOUND-YES",
      gateKey: "kernel-consult",
      outcomeType: "recommend",
      recommendedOptionId: "proceed",
      riskTier: "medium",
      principleConflict: false,
      sources: [{ source: "standing-policy" }],
      createdAt: new Date("2026-08-23T11:55:00.000Z"),
      sealedAt: new Date("2026-08-23T11:55:01.000Z"),
      chainEntryHash: "sha256:sealed",
      profile: {
        profileId: "MARK_DPF_PLATFORM_PROFILE",
        kind: "platform",
        scope: {},
        ownerOrganizationId: null,
        ownerPrincipalId: "principal-mark",
        currentVersionId: "PV-7",
      },
      profileVersion: { versionId: "PV-7", promotedByPrincipalId: "principal-mark" },
      outcomePayload: {
        recommendedOptionId: "proceed",
        verdict: "proceed",
        signalUsable: true,
        autonomyEligible: true,
        recommendationConfidence: "high",
        featureCoverageWeak: false,
        sensitivityUnstable: false,
        commandmentConflict: false,
        policyAffirmativeOptionId: "proceed",
        topContributors: [{ principleId: "P-1", contribution: 3.1 }],
        policyActionBinding: {
          actionKey: "record_initiative_design_review",
          subject: { kind: "backlog-item", id: "BI-F0715C9C" },
          organizationId: "org-canonical",
          professionId: null,
          routeContext: "/tool/record_initiative_design_review",
          artifactFingerprint: approvalBinding.inputFingerprint,
        },
      },
    };
    const decisionFind = vi.fn().mockResolvedValue([decisionRow]);
    const authorizationCreate = vi.fn().mockResolvedValue({ decisionId: "ignored" });
    const envelopeCreate = vi.fn().mockResolvedValue({ id: "ENV-POLICY" });
    const db = {
      decisionInteraction: { findMany: decisionFind },
      delegationGrant: { findFirst: vi.fn() },
      $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
        authorizationDecisionLog: { create: authorizationCreate },
        coworkerActionEnvelope: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: envelopeCreate,
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      })),
    };

    const result = await resolveAndPersistPolicyActionAuthority({
      execution: {
        toolName: "record_initiative_design_review",
        rawParams: authorityInput.rawParams,
        userId: "user-mark",
        userContext: { platformRole: "admin", isSuperuser: false },
        context: {
          agentId: "AGT-WS-DEV",
          organizationId: "org-canonical",
          routeContext: "/tool/record_initiative_design_review",
        },
        source: "agentic-loop",
      },
      authorityInput,
      approvalBinding,
    }, db as never);

    expect(result).toMatchObject({ outcome: "approved", envelopeId: "ENV-POLICY" });
    expect(decisionFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sealedAt: { not: null } }),
    }));
    expect(authorizationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-canonical",
        policyVersion: "PV-7",
        rationale: expect.objectContaining({ interactionId: "DI-BOUND-YES" }),
      }),
    }));

    decisionFind.mockResolvedValueOnce([{
      ...decisionRow,
      outcomeType: "decline",
      outcomePayload: {
        ...decisionRow.outcomePayload,
        verdict: "decline",
      },
    }]);
    const declined = await resolveAndPersistPolicyActionAuthority({
      execution: {
        toolName: "record_initiative_design_review",
        rawParams: authorityInput.rawParams,
        userId: "user-mark",
        userContext: { platformRole: "admin", isSuperuser: false },
        context: {
          agentId: "AGT-WS-DEV",
          organizationId: "org-canonical",
          routeContext: "/tool/record_initiative_design_review",
        },
        source: "agentic-loop",
      },
      authorityInput,
      approvalBinding,
    }, db as never);

    expect(declined).toMatchObject({
      outcome: "denied",
      reasonCode: "policy-declined",
    });
    expect(authorizationCreate).toHaveBeenCalledTimes(1);

    decisionFind.mockResolvedValueOnce([{
      ...decisionRow,
      outcomePayload: {
        ...decisionRow.outcomePayload,
        dualControlRequired: true,
      },
    }]);
    const dualControl = await resolveAndPersistPolicyActionAuthority({
      execution: {
        toolName: "record_initiative_design_review",
        rawParams: authorityInput.rawParams,
        userId: "user-mark",
        userContext: { platformRole: "admin", isSuperuser: false },
        context: {
          agentId: "AGT-WS-DEV",
          organizationId: "org-canonical",
          routeContext: "/tool/record_initiative_design_review",
        },
        source: "agentic-loop",
      },
      authorityInput,
      approvalBinding,
    }, db as never);

    expect(dualControl).toMatchObject({
      outcome: "resolution-required",
      reasonCode: "dual-control-required",
    });
    expect(authorizationCreate).toHaveBeenCalledTimes(1);

    decisionFind.mockResolvedValueOnce([{
      ...decisionRow,
      interactionId: "DI-NEWEST-UNCERTAIN",
      createdAt: new Date("2026-08-23T11:59:00.000Z"),
      outcomePayload: {
        ...decisionRow.outcomePayload,
        signalUsable: false,
      },
    }, decisionRow]);
    const uncertain = await resolveAndPersistPolicyActionAuthority({
      execution: {
        toolName: "record_initiative_design_review",
        rawParams: authorityInput.rawParams,
        userId: "user-mark",
        userContext: { platformRole: "admin", isSuperuser: false },
        context: {
          agentId: "AGT-WS-DEV",
          organizationId: "org-canonical",
          routeContext: "/tool/record_initiative_design_review",
        },
        source: "agentic-loop",
      },
      authorityInput,
      approvalBinding,
    }, db as never);

    expect(uncertain).toEqual({ outcome: "not-authorized" });
    expect(authorizationCreate).toHaveBeenCalledTimes(1);
  });
});
