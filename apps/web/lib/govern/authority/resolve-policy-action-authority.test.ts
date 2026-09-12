import { describe, expect, it, vi } from "vitest";

import { buildCoworkerApprovalBinding, type CoworkerAuthorityInput } from "./coworker-authority-decision";
import { resolveAndPersistPolicyActionAuthority } from "./resolve-policy-action-authority";

describe("resolveAndPersistPolicyActionAuthority", () => {
  it("loads the sealed decision, current profile provenance, and exact action binding server-side", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const authorityInput: CoworkerAuthorityInput = {
      now,
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
      task: {
        taskRunId: "TR-BOUND",
        initiativeReviewBinding: {
          writerToolName: "record_initiative_design_review",
          itemId: "BI-F0715C9C",
          gate: "spec-approval",
          workroomRef: {
            kind: "workroom-head",
            workroomId: "WC-BOUND",
            repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
            branchName: "fix/wwmd-exact-bound-receipts",
            headSha: "abc123",
          },
          artifactRef: {
            kind: "repo-blob-at-commit",
            repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
            commitSha: "abc123",
            path: "docs/superpowers/specs/exact-bound.md",
            providerBlobId: "blob-abc123",
          },
        },
      },
      rawParams: { decision: "pass", findings: [], resolvedFindingRefs: [] },
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
          organizationId: "platform",
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
          organizationId: "platform",
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
        organizationId: null,
        policyVersion: "PV-7",
        rationale: expect.objectContaining({
          interactionId: "DI-BOUND-YES",
          contributionLedger: [{ principleId: "P-1", contribution: 3.1 }],
          artifactFingerprint: approvalBinding.inputFingerprint,
          approvalBindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
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
          organizationId: "platform",
          routeContext: "/tool/record_initiative_design_review",
        },
        source: "agentic-loop",
      },
      authorityInput,
      approvalBinding,
    }, db as never);

    expect(declined).toMatchObject({
      outcome: "not-authorized",
      explanation: expect.stringContaining("explicitly declined"),
    });
    expect(authorizationCreate).toHaveBeenCalledTimes(1);

    // BI-9C384562: the live DEV shape — a sealed, high-confidence, autonomy-
    // eligible yes whose policy version nobody has ratified. The projector
    // must not root autonomy in an unsigned policy, so this falls to the
    // human; ratifying the version once (decision-perspective-ratify.ts) is
    // what turns the same row into an approval.
    decisionFind.mockResolvedValue([{
      ...decisionRow,
      profileVersion: { versionId: "PV-7", promotedByPrincipalId: null },
    }]);
    const unratified = await resolveAndPersistPolicyActionAuthority({
      execution: {
        toolName: "record_initiative_design_review",
        rawParams: authorityInput.rawParams,
        userId: "user-mark",
        userContext: { platformRole: "admin", isSuperuser: false },
        context: {
          agentId: "AGT-WS-DEV",
          organizationId: "platform",
          routeContext: "/tool/record_initiative_design_review",
        },
        source: "agentic-loop",
      },
      authorityInput,
      approvalBinding,
    }, db as never, { produceJudgment: vi.fn().mockResolvedValue(undefined) });
    expect(unratified).toMatchObject({
      outcome: "not-authorized",
      explanation: expect.stringContaining("Human decision required"),
    });
    expect(authorizationCreate).toHaveBeenCalledTimes(1);
    decisionFind.mockResolvedValue([decisionRow]);

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
          organizationId: "platform",
          routeContext: "/tool/record_initiative_design_review",
        },
        source: "agentic-loop",
      },
      authorityInput,
      approvalBinding,
    }, db as never);

    expect(dualControl).toMatchObject({
      outcome: "not-authorized",
      explanation: expect.stringContaining("distinct human approver"),
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
          organizationId: "platform",
          routeContext: "/tool/record_initiative_design_review",
        },
        source: "agentic-loop",
      },
      authorityInput,
      approvalBinding,
    }, db as never);

    expect(uncertain).toMatchObject({
      outcome: "not-authorized",
      explanation: expect.stringContaining("missing a current, explicit"),
    });
    expect(authorizationCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { decision: "pass", findings: [] },
    { decision: "fail", findings: [{ issue: "The measured default remains unspecified.", severity: "important",
      evidence: { blobId: "blob-abc123", startLine: 79, endLine: 79, quote: "Default: TBD" } }] },
  ])("produces and projects exact WWMD authority to record $decision evidence", async (assessment) => {
    const now = new Date("2026-08-31T17:00:00.000Z");
    const authorityInput: CoworkerAuthorityInput = {
      now,
      organizationId: "platform",
      authContext: {
        principalId: "principal-mark", principalAliases: [], population: "workforce" as const,
        platformRole: "admin", isSuperuser: false, employeeId: null, managerScope: null,
        teamIds: [], accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
        sensitivityClearance: ["internal"],
        authentication: { source: "session" as const, methods: ["mfa"], contextClassReference: null },
        actingHumanUserId: "user-mark", actingAgentId: "AGT-WS-PORTFOLIO",
        delegationGrantIds: [], grantedCapabilities: ["manage_backlog"],
      },
      action: {
        toolName: "record_initiative_evidence", requiredCapability: "manage_backlog",
        agentGrantAllowed: true, sideEffect: true, executionMode: "immediate" as const,
        routeContext: "/build/work/WC-48A3D214", approvalPolicy: "side-effects" as const,
      },
      subject: { kind: "backlog-item" as const, id: "BI-2014236E" },
      delegation: null, integration: { required: false, state: "not-required" as const },
      dataPolicy: { sensitivity: "internal" as const, maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true, decisionVersionIds: ["PV-7"] },
      task: {
        taskRunId: "TR-EXACT",
        initiativeReviewBinding: {
          writerToolName: "record_initiative_evidence",
          itemId: "BI-2014236E",
          gate: "research",
          workroomRef: {
            kind: "workroom-head",
            workroomId: "WC-48A3D214",
            repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
            branchName: "fix/wwmd-exact-bound-receipts",
            headSha: "abc123",
          },
          artifactRef: {
            kind: "repo-blob-at-commit",
            repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
            commitSha: "abc123",
            path: "docs/superpowers/specs/exact-bound.md",
            providerBlobId: "blob-abc123",
          },
        },
      },
      rawParams: { ...assessment, resolvedFindingRefs: [] }, approval: null,
    };
    const approvalBinding = buildCoworkerApprovalBinding(authorityInput);
    const exactRow = {
      interactionId: "DI-PRODUCED", gateKey: "kernel-consult", outcomeType: "recommend",
      recommendedOptionId: "proceed", riskTier: "low", principleConflict: false,
      sources: [{ source: "standing-policy" }], createdAt: new Date("2026-08-31T16:59:00.000Z"),
      sealedAt: new Date("2026-08-31T16:59:01.000Z"), chainEntryHash: "sealed",
      profile: { profileId: "mark-dpf-platform", kind: "platform", scope: {}, ownerOrganizationId: null, ownerPrincipalId: "principal-mark", currentVersionId: "PV-7" },
      profileVersion: { versionId: "PV-7", promotedByPrincipalId: "principal-mark" },
      outcomePayload: {
        verdict: "proceed", signalUsable: true, autonomyEligible: true,
        recommendationConfidence: "high", featureCoverageWeak: false,
        sensitivityUnstable: false, commandmentConflict: false,
        policyAffirmativeOptionId: "proceed", dualControlRequired: false,
        policyActionBinding: {
          actionKey: "record_initiative_evidence", subject: { kind: "backlog-item", id: "BI-2014236E" },
          organizationId: "platform", professionId: null, routeContext: "/build/work/WC-48A3D214",
          artifactFingerprint: approvalBinding.inputFingerprint,
        },
      },
    };
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([exactRow]);
    const produceJudgment = vi.fn().mockResolvedValue(undefined);
    const db = {
      decisionInteraction: { findMany }, delegationGrant: { findFirst: vi.fn() },
      $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
        authorizationDecisionLog: { create: vi.fn().mockResolvedValue({ decisionId: "AUTH-WWMD" }) },
        coworkerActionEnvelope: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "ENV-WWMD" }), updateMany: vi.fn() },
      })),
    };
    const execution = {
      toolName: "record_initiative_evidence", rawParams: authorityInput.rawParams,
      userId: "user-mark", userContext: { platformRole: "admin", isSuperuser: false },
      context: { agentId: "AGT-WS-PORTFOLIO", routeContext: "/build/work/WC-48A3D214" },
      source: "agentic-loop" as const,
    };

    const result = await resolveAndPersistPolicyActionAuthority(
      { execution, authorityInput, approvalBinding }, db as never, { produceJudgment },
    );

    expect(produceJudgment).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ outcome: "approved", envelopeId: "ENV-WWMD" });

    produceJudgment.mockClear();
    findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{
      ...exactRow,
      outcomeType: "decline",
      outcomePayload: { ...exactRow.outcomePayload, verdict: "decline" },
    }]);
    const declined = await resolveAndPersistPolicyActionAuthority(
      { execution, authorityInput, approvalBinding }, db as never, { produceJudgment },
    );
    expect(produceJudgment).toHaveBeenCalledOnce();
    expect(declined).toMatchObject({ outcome: "not-authorized", explanation: expect.stringContaining("explicitly declined") });

    produceJudgment.mockClear();
    findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{
      ...exactRow,
      outcomePayload: {
        ...exactRow.outcomePayload,
        policyActionBinding: {
          ...exactRow.outcomePayload.policyActionBinding,
          artifactFingerprint: "different-artifact",
        },
      },
    }]);
    const mismatched = await resolveAndPersistPolicyActionAuthority(
      { execution, authorityInput, approvalBinding }, db as never, { produceJudgment },
    );
    expect(produceJudgment).toHaveBeenCalledOnce();
    expect(mismatched).toMatchObject({ outcome: "not-authorized", explanation: expect.stringContaining("WWMD did not produce") });
  });
});
