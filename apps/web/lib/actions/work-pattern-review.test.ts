import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRequireCapability, mockRevalidatePath } = vi.hoisted(() => ({
  mockPrisma: {
    coworkerCapabilityNeed: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    decisionInteraction: {
      create: vi.fn(),
    },
    businessContext: {
      findFirst: vi.fn(),
    },
    storefrontConfig: {
      findFirst: vi.fn(),
    },
    regulatoryAutonomyPolicy: {
      findMany: vi.fn(),
    },
    decisionShadowLedger: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    coworkerActionEnvelope: {
      create: vi.fn(),
      update: vi.fn(),
    },
    trustState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    workCase: {
      update: vi.fn(),
    },
    workItem: {
      create: vi.fn(),
      update: vi.fn(),
    },
    skillDefinition: {
      update: vi.fn(),
    },
    promptTemplate: {
      update: vi.fn(),
    },
    backlogItem: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockRequireCapability: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/actions/shared/guards", () => ({
  requireCapability: mockRequireCapability,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import {
  recordWorkPatternReview,
  resolveWorkPatternCaseProposal,
} from "./work-pattern-review";

function shadowTrials(count = 20) {
  return Array.from({ length: count }, (_, index) => ({
    trialId: `S-${index + 1}`,
    riskClass: "internal-reversible",
    candidateDecision: "file grant need",
    actualDecision: index === count - 1 && count >= 20 ? "defer" : "file grant need",
    outcome: index === count - 1 && count >= 20 ? "missed" : "accepted",
    agreement: !(index === count - 1 && count >= 20),
    toolCallDelta: -2,
    failureDelta: -1,
    manualTouchDelta: 0,
    contextTokenDelta: -900,
    reviewFailureDelta: 0,
    observedAt: "2026-06-28T10:30:00.000Z",
  }));
}

function needRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "need-row-1",
    needId: "NEED-1",
    agentId: "build-specialist",
    kind: "grant",
    severity: "important",
    status: "submitted",
    need: "Missing sandbox lease grant",
    blocks: "Repeated grant denials block verification.",
    evidenceJson: {
      patternKey: "grant-denial|build-specialist|/build",
      activityClass: "work-pattern.grant-denial",
      decisionScope: "platform-wwmd",
      riskClass: "internal-reversible",
      currentAutonomyLevel: "shadow",
      shadowTrials: shadowTrials(),
      taskRunId: "TR-1",
      toolExecutionId: "TE-1",
    },
    readinessJson: {
      readyForReview: true,
      readyForCaseActivation: false,
      blockers: ["pattern-status-not-approved-or-active"],
    },
    linkedBacklogItemId: "BI-1",
    assessment: {
      routeContext: "/build",
    },
    ...overrides,
  };
}

function caseBoundNeedRow(overrides: Record<string, unknown> = {}) {
  return needRow({
    evidenceJson: {
      patternKey: "case-proposal|build-specialist|backlog-item",
      decisionScope: "company-wwwd",
      riskClass: "internal-reversible",
      currentAutonomyLevel: "shadow",
      shadowTrials: shadowTrials(),
      taskRunId: "TR-1",
      toolExecutionId: "TE-1",
      workCaseRef: "backlog-item:BI-123",
      workPattern: {
        patternKey: "case-proposal|build-specialist|backlog-item",
        status: "approved",
        scope: "case-transition",
        version: 1,
        source: "human-review",
        decisionScope: "company-wwwd",
        evidence: [{ workCaseRef: "backlog-item:BI-123", taskRunId: "TR-1" }],
        candidate: {
          kind: "other",
          need: "Suggest the next Work Case move",
          blocks: "The coworker repeatedly asks what to do next.",
          fingerprint: "fp-case-proposal",
        },
        workCaseBinding: {
          caseType: "backlog-item",
          transitionKey: "request-input",
          governedActionKey: "propose",
          authorityMode: "autonomous",
          sponsorPrincipalId: "prn_user_1",
          receiptPolicy: "governed-action",
        },
        observedAt: "2026-06-28T11:00:00.000Z",
      },
    },
    readinessJson: {
      readyForReview: true,
      readyForCaseActivation: true,
      blockers: [],
    },
    ...overrides,
  });
}

function form(action: string) {
  const data = new FormData();
  data.set("needId", "NEED-1");
  data.set("agentId", "build-specialist");
  data.set("action", action);
  data.set("note", "Approve only for sandbox lease filing.");
  return data;
}

function resolutionForm(action: string) {
  const data = new FormData();
  data.set("needId", "NEED-1");
  data.set("agentId", "build-specialist");
  data.set("action", action);
  data.set("note", "Resolve the Work Case proposal without live mutation.");
  return data;
}

function stagedCaseNeedRow(overrides: Record<string, unknown> = {}) {
  return caseBoundNeedRow({
    readinessJson: {
      readyForReview: true,
      readyForCaseActivation: true,
      blockers: [],
      activationProposed: true,
      workPatternReview: {
        action: "approve",
        status: "approved-candidate",
        needId: "NEED-1",
        agentId: "build-specialist",
        patternKey: "case-proposal|build-specialist|backlog-item",
        routeContext: "/build",
        riskClass: "internal-reversible",
        decisionScope: "company-wwwd",
        decisionInteractionId: "DI-REVIEW001",
        reviewerUserId: "user-1",
        reviewedAt: "2026-06-28T12:00:00.000Z",
        reviewerNote: "Approve as a Work Case proposal only.",
        blockers: ["activation-candidate-awaits-governed-promotion"],
        activationProposed: true,
        activationCandidate: {
          state: "candidate",
          activationAllowed: false,
          patternKey: "case-proposal|build-specialist|backlog-item",
          agentId: "build-specialist",
          routeContext: "/build",
          riskClass: "internal-reversible",
          decisionScope: "company-wwwd",
          currentAutonomyLevel: "shadow",
          proposedAutonomyLevel: "propose",
          evidenceSummary: {
            samples: 20,
            agreements: 19,
            agreementRate: 0.95,
          },
          blockers: ["activation-candidate-awaits-governed-promotion"],
        },
        caseStaging: {
          status: "stageable",
          activationAllowed: false,
          liveMutationAllowed: false,
          caseRef: {
            caseId: "backlog-item:BI-123",
            sourceType: "backlog-item",
            sourceId: "BI-123",
          },
          action: "propose",
          transitionId: "work-pattern:backlog-item:BI-123:propose:DI-REVIEW001",
          stagedTransition: {
            transitionId: "work-pattern:backlog-item:BI-123:propose:DI-REVIEW001",
            action: "propose",
            status: "proposed",
            caseState: "awaiting-decision",
            a2aStatus: "input-required",
            terminal: false,
            committable: false,
            sourceRef: {
              kind: "decision-interaction",
              id: "DI-REVIEW001",
              status: "proposed",
            },
            reason: "Transition propose is proposed and waiting for approve/edit/reject/respond.",
            nextAction: "Resolve staged transition",
          },
          enforcementMode: "governed-action",
          requiredReceiptKind: "governed-action",
          receiptCoverage: "required-before-commit",
          blockers: ["receipt-required-before-commit"],
          proposalRail: {
            kind: "coworker-action-envelope-preview",
            envelopeStatus: "proposed",
            manifestActionId: "work-case.propose",
            argsJson: {
              caseRef: "backlog-item:BI-123",
              action: "propose",
            },
            rationale: "Stage Work Case proposal from approved Living Playbook candidate.",
          },
        },
      },
    },
    ...overrides,
  });
}

describe("reviewWorkPatternAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCapability.mockResolvedValue({ userId: "user-1" });
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(needRow());
    mockPrisma.coworkerCapabilityNeed.update.mockResolvedValue({});
    mockPrisma.decisionInteraction.create.mockImplementation(async ({ data }) => ({
      id: "decision-row-1",
      ...data,
    }));
    mockPrisma.businessContext.findFirst.mockResolvedValue({
      operatesIn: ["eu"],
      sellsTo: [],
      employsIn: [],
      dataResidency: [],
      industry: "legacy-industry",
    });
    mockPrisma.storefrontConfig.findFirst.mockResolvedValue({
      archetype: { category: "professional-services" },
    });
    mockPrisma.regulatoryAutonomyPolicy.findMany.mockResolvedValue([
      {
        policyId: "RAP-GLOBAL-WORK-PATTERN",
        policyKey: "global-work-pattern",
        version: 1,
        status: "active",
        industry: null,
        jurisdiction: "global",
        jurisdictionBasis: "global",
        activityClass: "work-pattern.grant-denial",
        maxAutonomyLevel: "propose",
        humanControlRequired: true,
        requiredEvidence: ["decision-shadow-ledger", "operator-review"],
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveUntil: null,
      },
    ]);
    mockPrisma.decisionShadowLedger.upsert.mockResolvedValue({});
    mockPrisma.decisionShadowLedger.findMany.mockResolvedValue(
      shadowTrials().map((trial) => ({
        ledgerId: `DI-LEDGER:${trial.trialId}`,
        agreement: trial.agreement,
        observedAt: new Date(trial.observedAt),
      })),
    );
    mockPrisma.trustState.findUnique.mockResolvedValue(null);
    mockPrisma.trustState.upsert.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  });

  it("records approval as a DecisionInteraction and scoped activation candidate", async () => {
    await expect(recordWorkPatternReview(form("approve"))).resolves.toMatchObject({
      status: "recorded",
      action: "approve",
      needId: "NEED-1",
    });

    expect(mockRequireCapability).toHaveBeenCalledWith("manage_platform");
    expect(mockPrisma.decisionInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        domainClass: "risk-assessment",
        routeContext: "/platform/ai/agent/build-specialist",
        outcomeType: "recommend",
        riskTier: "medium",
        humanOutcome: expect.objectContaining({
          type: "work-pattern-review",
          action: "approve",
          clearsGate: false,
          resolverUserId: "user-1",
        }),
      }),
    });
    expect(mockPrisma.coworkerCapabilityNeed.update).toHaveBeenCalledWith({
      where: { needId: "NEED-1" },
      data: expect.objectContaining({
        status: "accepted",
        reviewerNote: "Approve only for sandbox lease filing.",
        readinessJson: expect.objectContaining({
          activationProposed: true,
          workPatternReview: expect.objectContaining({
            action: "approve",
            status: "approved-candidate",
            activationCandidate: expect.objectContaining({
              activationAllowed: false,
              proposedAutonomyLevel: "propose",
            }),
          }),
        }),
        evidenceJson: expect.objectContaining({
          decisionInteractionId: expect.stringMatching(/^DI-[A-F0-9]{12}$/),
        }),
      }),
    });
    expect(mockPrisma.regulatoryAutonomyPolicy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active" }),
      }),
    );
    expect(mockPrisma.decisionShadowLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ledgerId: expect.stringMatching(/^DI-[A-F0-9]{12}:S-1$/) },
        create: expect.objectContaining({
          agentId: "build-specialist",
          activityType: "work-pattern.grant-denial",
          riskClass: "internal-reversible",
          autonomyLevel: "shadow",
          taskRunId: "TR-1",
          toolExecutionId: "TE-1",
          regulatoryPolicyId: "RAP-GLOBAL-WORK-PATTERN",
          regulatoryEvidence: expect.objectContaining({
            ceiling: "propose",
            matchedPolicyIds: ["RAP-GLOBAL-WORK-PATTERN"],
            requiredEvidence: ["decision-shadow-ledger", "operator-review"],
          }),
        }),
      }),
    );
    expect(mockPrisma.trustState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          agentId: "build-specialist",
          activityType: "work-pattern.grant-denial",
          riskClass: "internal-reversible",
          regulatoryCeiling: "propose",
          sampleCount: 20,
          agreementCount: 19,
        }),
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/ai/agent/build-specialist");
  });

  it("uses DB-resolved regulatory ceilings instead of stale evidence JSON during approval", async () => {
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(
      needRow({
        evidenceJson: {
          ...needRow().evidenceJson,
          currentAutonomyLevel: "propose",
          regulatoryCeiling: "autopilot",
        },
      }),
    );

    await expect(recordWorkPatternReview(form("approve"))).rejects.toThrow(
      "approval_requires_promotable_shadow_evidence",
    );

    expect(mockPrisma.regulatoryAutonomyPolicy.findMany).toHaveBeenCalled();
    expect(mockPrisma.decisionInteraction.create).not.toHaveBeenCalled();
    expect(mockPrisma.decisionShadowLedger.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.trustState.upsert).not.toHaveBeenCalled();
  });

  it("records approved case-bound candidates as staged Work Case proposals", async () => {
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(caseBoundNeedRow());

    await expect(recordWorkPatternReview(form("approve"))).resolves.toMatchObject({
      status: "recorded",
      action: "approve",
      needId: "NEED-1",
    });

    expect(mockPrisma.decisionInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        evidenceBundle: expect.objectContaining({
          workPatternReview: expect.objectContaining({
            caseStaging: expect.objectContaining({
              status: "stageable",
              action: "propose",
              receiptCoverage: "required-before-commit",
              stagedTransition: expect.objectContaining({
                caseState: "awaiting-decision",
                a2aStatus: "input-required",
                committable: false,
              }),
            }),
          }),
        }),
        outcomePayload: expect.objectContaining({
          workPatternReview: expect.objectContaining({
            caseStaging: expect.objectContaining({
              status: "stageable",
              requiredReceiptKind: "governed-action",
            }),
          }),
        }),
      }),
    });
    expect(mockPrisma.coworkerCapabilityNeed.update).toHaveBeenCalledWith({
      where: { needId: "NEED-1" },
      data: expect.objectContaining({
        readinessJson: expect.objectContaining({
          activationProposed: true,
          workPatternReview: expect.objectContaining({
            caseStaging: expect.objectContaining({
              status: "stageable",
              activationAllowed: false,
              liveMutationAllowed: false,
              receiptCoverage: "required-before-commit",
            }),
          }),
        }),
      }),
    });
    expect(mockPrisma.coworkerActionEnvelope.create).not.toHaveBeenCalled();
    expect(mockPrisma.workCase.update).not.toHaveBeenCalled();
    expect(mockPrisma.workItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.workItem.update).not.toHaveBeenCalled();
  });

  it("records blocked case proposal guardrails when Work Case metadata is incomplete", async () => {
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(
      caseBoundNeedRow({
        evidenceJson: {
          ...caseBoundNeedRow().evidenceJson,
          workPattern: {
            ...(caseBoundNeedRow().evidenceJson as Record<string, unknown>).workPattern as Record<string, unknown>,
            workCaseBinding: {
              caseType: "backlog-item",
              governedActionKey: "propose",
              authorityMode: "autonomous",
              receiptPolicy: "governed-action",
            },
          },
        },
      }),
    );

    await recordWorkPatternReview(form("approve"));

    const update = mockPrisma.coworkerCapabilityNeed.update.mock.calls[0]![0];
    expect(update.data.readinessJson.workPatternReview.caseStaging).toMatchObject({
      status: "blocked",
      receiptCoverage: "blocked",
      blockers: expect.arrayContaining(["missing-sponsor-principal"]),
    });
  });

  it("records rejection without creating an activation candidate", async () => {
    await expect(recordWorkPatternReview(form("reject"))).resolves.toMatchObject({
      status: "recorded",
      action: "reject",
    });

    const update = mockPrisma.coworkerCapabilityNeed.update.mock.calls[0]![0];
    expect(update.data.status).toBe("discarded");
    expect(update.data.readinessJson.workPatternReview).toMatchObject({
      action: "reject",
      status: "rejected",
      activationCandidate: null,
    });
    expect(update.data.readinessJson.activationProposed).toBe(false);
  });

  it("records deferral as a deferred decision", async () => {
    await expect(recordWorkPatternReview(form("defer"))).resolves.toMatchObject({
      status: "recorded",
      action: "defer",
    });

    expect(mockPrisma.decisionInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcomeType: "defer",
        humanOutcome: expect.objectContaining({
          action: "defer",
          clearsGate: false,
        }),
      }),
    });
    expect(mockPrisma.coworkerCapabilityNeed.update.mock.calls[0]![0].data.status).toBe("deferred");
  });

  it("fails approval before writes when shadow evidence is not promotable", async () => {
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(
      needRow({
        evidenceJson: {
          patternKey: "grant-denial|build-specialist|/build",
          decisionScope: "platform-wwmd",
          riskClass: "internal-reversible",
          currentAutonomyLevel: "shadow",
          shadowTrials: shadowTrials(5),
        },
      }),
    );

    await expect(recordWorkPatternReview(form("approve"))).rejects.toThrow(
      "approval_requires_promotable_shadow_evidence",
    );

    expect(mockPrisma.decisionInteraction.create).not.toHaveBeenCalled();
    expect(mockPrisma.coworkerCapabilityNeed.update).not.toHaveBeenCalled();
  });

  it("does not write when authorization fails", async () => {
    mockRequireCapability.mockRejectedValue(new Error("Unauthorized"));

    await expect(recordWorkPatternReview(form("approve"))).rejects.toThrow("Unauthorized");

    expect(mockPrisma.coworkerCapabilityNeed.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.decisionInteraction.create).not.toHaveBeenCalled();
  });

  it("does not mutate live Work Cases, skills, prompts, grants, or backlog", async () => {
    await recordWorkPatternReview(form("approve"));

    expect(mockPrisma.trustState.upsert).toHaveBeenCalled();
    expect(mockPrisma.coworkerActionEnvelope.create).not.toHaveBeenCalled();
    expect(mockPrisma.coworkerActionEnvelope.update).not.toHaveBeenCalled();
    expect(mockPrisma.workCase.update).not.toHaveBeenCalled();
    expect(mockPrisma.workItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.workItem.update).not.toHaveBeenCalled();
    expect(mockPrisma.skillDefinition.update).not.toHaveBeenCalled();
    expect(mockPrisma.promptTemplate.update).not.toHaveBeenCalled();
    expect(mockPrisma.backlogItem.update).not.toHaveBeenCalled();
  });

  it("records approved Work Case proposal resolution without committing the case", async () => {
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(stagedCaseNeedRow());

    await expect(resolveWorkPatternCaseProposal(resolutionForm("approve"))).resolves.toMatchObject({
      status: "recorded",
      action: "approve",
      needId: "NEED-1",
    });

    expect(mockPrisma.decisionInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        domainClass: "risk-assessment",
        routeContext: "/platform/ai/agent/build-specialist",
        outcomeType: "recommend",
        evidenceBundle: expect.objectContaining({
          workPatternCaseProposalResolution: expect.objectContaining({
            status: "approved-awaiting-receipt",
            commitAllowed: false,
            receiptCoverage: "required-before-commit",
          }),
        }),
        humanOutcome: expect.objectContaining({
          type: "work-pattern-case-proposal-resolution",
          action: "approve",
          clearsGate: false,
        }),
      }),
    });
    const update = mockPrisma.coworkerCapabilityNeed.update.mock.calls[0]![0];
    expect(update).toMatchObject({
      where: { needId: "NEED-1" },
      data: {
        readinessJson: expect.objectContaining({
          workPatternReview: expect.objectContaining({
            caseStaging: expect.objectContaining({
              status: "stageable",
              resolution: expect.objectContaining({
                status: "approved-awaiting-receipt",
                action: "approve",
                commitAllowed: false,
              }),
            }),
          }),
        }),
        evidenceJson: expect.objectContaining({
          caseProposalResolutionDecisionInteractionId: expect.stringMatching(/^DI-[A-F0-9]{12}$/),
        }),
      },
    });
    expect(update.data.status).toBeUndefined();
    expect(mockPrisma.coworkerActionEnvelope.create).not.toHaveBeenCalled();
    expect(mockPrisma.workCase.update).not.toHaveBeenCalled();
    expect(mockPrisma.workItem.update).not.toHaveBeenCalled();
  });

  it("records rejected and deferred Work Case proposal resolutions", async () => {
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(stagedCaseNeedRow());

    await resolveWorkPatternCaseProposal(resolutionForm("reject"));
    expect(mockPrisma.coworkerCapabilityNeed.update.mock.calls[0]![0].data.readinessJson)
      .toMatchObject({
        workPatternReview: {
          action: "approve",
          caseStaging: {
            resolution: {
              status: "rejected",
              action: "reject",
              commitAllowed: false,
              receiptCoverage: "not-required",
            },
          },
        },
      });

    vi.clearAllMocks();
    mockRequireCapability.mockResolvedValue({ userId: "user-1" });
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(stagedCaseNeedRow());
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

    await resolveWorkPatternCaseProposal(resolutionForm("defer"));
    expect(mockPrisma.coworkerCapabilityNeed.update.mock.calls[0]![0].data.readinessJson)
      .toMatchObject({
        workPatternReview: {
          action: "approve",
          caseStaging: {
            resolution: {
              status: "deferred",
              action: "defer",
              commitAllowed: false,
              receiptCoverage: "not-required",
            },
          },
        },
      });
  });

  it("refuses case proposal resolution before writes when no stageable proposal exists", async () => {
    mockPrisma.coworkerCapabilityNeed.findUnique.mockResolvedValue(needRow());

    await expect(resolveWorkPatternCaseProposal(resolutionForm("approve"))).rejects.toThrow(
      "work_pattern_case_proposal_not_stageable",
    );

    expect(mockPrisma.decisionInteraction.create).not.toHaveBeenCalled();
    expect(mockPrisma.coworkerCapabilityNeed.update).not.toHaveBeenCalled();
  });
});
