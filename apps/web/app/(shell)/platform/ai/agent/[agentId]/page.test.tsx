import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: { findFirst: vi.fn() },
    agentModelConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    modelProvider: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    // WS2 Capabilities-editor data (catalog skills assigned + full catalog):
    skillAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    skillDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    coworkerService: { findMany: vi.fn().mockResolvedValue([]) },
    organization: {
      findFirst: vi.fn().mockResolvedValue({ id: "org-1" }),
    },
    storefrontConfig: {
      findUnique: vi.fn().mockResolvedValue({
        archetype: {
          archetypeId: "restaurant",
          category: "food-hospitality",
        },
      }),
    },
    // loadCoworkerRecord facet queries (HRIS surface):
    // findFirst also backs the WS4 posture-inheritance read (golden-triangle persistence).
    decisionPerspectiveProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    wikiPage: { findMany: vi.fn().mockResolvedValue([]) },
    voiceProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    decisionInteraction: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: any }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/platform/ai/agent/AGT-001",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("notFound"); },
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  getAgentGaidMap: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "u1", platformRole: "admin", isSuperuser: true } }),
}));

vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  can: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/coworker-service-catalog/route-readiness", () => ({
  loadCoworkerRoutingReadinessSnapshot: vi.fn().mockResolvedValue({
    endpoints: [],
    policyRules: [],
    overrides: [],
    capacityByProvider: new Map(),
    localOnlyInference: false,
  }),
  projectCoworkerRouteReadiness: vi.fn().mockResolvedValue({
    ready: true,
    reason: "A configured route satisfies this coworker's requirements.",
    providerId: "openai",
    modelId: "gpt-ready",
  }),
  parseCoworkerServiceReadinessProbe: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/coworker-lifecycle/lifecycle-gate", () => ({
  evaluateLifecycleGate: vi.fn().mockResolvedValue({
    allowed: true,
    reason: "Lifecycle policy allows dispatch.",
  }),
}));

vi.mock("@/components/platform/AgentModelRoutingCard", () => ({
  AgentModelRoutingCard: () => null,
}));

vi.mock("@/components/platform/coworker-record/CapabilitiesEditor", () => ({
  CapabilitiesEditor: () => null,
}));

vi.mock("@/components/platform/coworker-record/RecordActionsMenu", () => ({
  RecordActionsMenu: () => null,
}));

vi.mock("@/components/golden-triangle/CoworkerPriorityControl", () => ({
  CoworkerPriorityControl: () => null,
}));

vi.mock("@/lib/tak/work-pattern-read-model", () => ({
  getWorkPatternReadModel: vi.fn().mockResolvedValue({
    generatedAt: new Date("2026-06-28T12:00:00.000Z"),
    window: {
      since: new Date("2026-05-29T12:00:00.000Z"),
      until: new Date("2026-06-28T12:00:00.000Z"),
    },
    summary: {
      totalPatterns: 2,
      totalObservedRuns: 3,
      openNeedCount: 1,
      readyForReviewCount: 1,
      candidateOnlyCount: 0,
    },
    patterns: [
      {
        patternKey: "grant-denial|hr-specialist|/build",
        agentId: "hr-specialist",
        routeContext: "/build",
        riskClass: "medium-risk",
        status: "observed",
        scope: "route",
        version: 1,
        source: "observer",
        decisionScope: "platform-wwmd",
        observedRuns: 3,
        completedRuns: 2,
        failedRuns: 1,
        outcomeCounts: { completed: 2, failed: 1 },
        latestObservedAt: new Date("2026-06-28T10:24:00.000Z"),
        latestTaskRunId: "TR-3",
        evidenceRefs: [{ taskRunId: "TR-3", toolExecutionId: "TE-3" }],
        candidate: {
          kind: "grant",
          need: "Missing sandbox lease grant",
          blocks: "Repeated grant denials blocked local integration verification.",
          fingerprint: "fp-grant",
          evaluationMethod: "deterministic-pattern-observer",
        },
        candidateNeedKinds: ["grant"],
        linkedNeedIds: ["NEED-1"],
        openNeedCount: 1,
        readiness: {
          readyForReview: true,
          readyForCaseActivation: false,
          blockers: ["pattern-status-not-approved-or-active"],
        },
        activationProposed: false,
        reviewState: null,
        activationCandidate: null,
        shadowEvaluation: {
          samples: 20,
          agreements: 19,
          agreementRate: 0.95,
          riskClass: "internal-reversible",
          currentLevel: "shadow",
          trustRecommendation: {
            action: "promote",
            from: "shadow",
            to: "propose",
            reason: "agreement 95% >= 90% over 20 samples",
          },
          decision: "approve-narrower-scope",
          activationAllowed: false,
          improvementTotals: {
            toolCallDelta: -40,
            failureDelta: -20,
            manualTouchDelta: 0,
            contextTokenDelta: -18000,
            reviewFailureDelta: 0,
          },
          blockers: [],
        },
        experiment: {
          label: "Testing a better method",
          lifecycle: "running",
          validPairCount: 0,
          resultSummary: "Candidate and baseline are still running.",
          evidenceOrigin: "hermetic-replay",
          moreEvidenceNeeded: true,
          invalidPairReasons: [],
          methodVariants: ["baseline", "candidate"],
          modelVariants: ["model-a", "model-b"],
          installScope: "canonical",
          taskCorpusVersion: "1",
          oracleVersion: "1",
          promotionPolicyVersion: 1,
          freshnessAt: "2026-06-28T11:30:00.000Z",
          experimentRunId: "WPR-1",
          experimentDefinitionKey: "WPD-1",
        },
      },
      {
        patternKey: "prompt-refinement|hr-specialist|/build",
        agentId: "hr-specialist",
        routeContext: "/build",
        riskClass: "internal-reversible",
        status: "candidate",
        scope: "route",
        version: 1,
        source: "observer",
        decisionScope: "platform-wwmd",
        observedRuns: 1,
        completedRuns: 1,
        failedRuns: 0,
        outcomeCounts: { completed: 1 },
        latestObservedAt: new Date("2026-06-28T10:44:00.000Z"),
        latestTaskRunId: "TR-4",
        evidenceRefs: [{ decisionInteractionId: "DI-REVIEW001", capabilityNeedId: "NEED-2" }],
        candidate: {
          kind: "prompt",
          need: "Prompt should ask for the sandbox lease evidence first",
          blocks: "The coworker repeats extra context requests before filing the evidence.",
          fingerprint: "fp-prompt",
          evaluationMethod: "capability-need-review",
        },
        candidateNeedKinds: ["prompt"],
        linkedNeedIds: ["NEED-2"],
        openNeedCount: 0,
        readiness: {
          readyForReview: true,
          readyForCaseActivation: false,
          blockers: ["activation-candidate-awaits-governed-promotion"],
        },
        activationProposed: true,
        reviewState: {
          action: "approve",
          status: "approved-candidate",
          needId: "NEED-2",
          agentId: "hr-specialist",
          patternKey: "prompt-refinement|hr-specialist|/build",
          routeContext: "/build",
          riskClass: "internal-reversible",
          decisionScope: "platform-wwmd",
          decisionInteractionId: "DI-REVIEW001",
          reviewerUserId: "user-1",
          reviewedAt: "2026-06-28T11:00:00.000Z",
          reviewerNote: "Approve only as a candidate.",
          blockers: ["activation-candidate-awaits-governed-promotion"],
          activationProposed: true,
          activationCandidate: {
            state: "candidate",
            activationAllowed: false,
            patternKey: "prompt-refinement|hr-specialist|/build",
            agentId: "hr-specialist",
            routeContext: "/build",
            riskClass: "internal-reversible",
            decisionScope: "platform-wwmd",
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
        activationCandidate: {
          state: "candidate",
          activationAllowed: false,
          patternKey: "prompt-refinement|hr-specialist|/build",
          agentId: "hr-specialist",
          routeContext: "/build",
          riskClass: "internal-reversible",
          decisionScope: "platform-wwmd",
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
        shadowEvaluation: null,
      },
      {
        patternKey: "case-approved|hr-specialist|/build",
        agentId: "hr-specialist",
        routeContext: "/build",
        riskClass: "internal-reversible",
        status: "candidate",
        scope: "case-transition",
        version: 1,
        source: "human-review",
        decisionScope: "company-wwwd",
        observedRuns: 1,
        completedRuns: 1,
        failedRuns: 0,
        outcomeCounts: { completed: 1 },
        latestObservedAt: new Date("2026-06-28T10:54:00.000Z"),
        latestTaskRunId: "TR-5",
        evidenceRefs: [{ decisionInteractionId: "DI-RESOLVE001", capabilityNeedId: "NEED-3" }],
        candidate: {
          kind: "other",
          need: "Case proposal already approved",
          blocks: "The proposal is waiting for receipt evidence before commit.",
          fingerprint: "fp-case-approved",
          evaluationMethod: "capability-need-review",
        },
        candidateNeedKinds: ["other"],
        linkedNeedIds: ["NEED-3"],
        openNeedCount: 0,
        readiness: {
          readyForReview: true,
          readyForCaseActivation: true,
          blockers: ["activation-candidate-awaits-governed-promotion"],
        },
        activationProposed: true,
        reviewState: {
          action: "approve",
          status: "approved-candidate",
          needId: "NEED-3",
          agentId: "hr-specialist",
          patternKey: "case-approved|hr-specialist|/build",
          routeContext: "/build",
          riskClass: "internal-reversible",
          decisionScope: "company-wwwd",
          decisionInteractionId: "DI-REVIEW003",
          reviewerUserId: "user-1",
          reviewedAt: "2026-06-28T11:20:00.000Z",
          reviewerNote: "Approve as a proposal.",
          blockers: ["activation-candidate-awaits-governed-promotion"],
          activationProposed: true,
          activationCandidate: {
            state: "candidate",
            activationAllowed: false,
            patternKey: "case-approved|hr-specialist|/build",
            agentId: "hr-specialist",
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
              caseId: "backlog-item:BI-456",
              sourceType: "backlog-item",
              sourceId: "BI-456",
            },
            action: "propose",
            transitionId: "work-pattern:backlog-item:BI-456:propose:DI-REVIEW003",
            stagedTransition: {
              transitionId: "work-pattern:backlog-item:BI-456:propose:DI-REVIEW003",
              action: "propose",
              status: "proposed",
              caseState: "awaiting-decision",
              a2aStatus: "input-required",
              terminal: false,
              committable: false,
              sourceRef: {
                kind: "decision-interaction",
                id: "DI-REVIEW003",
                status: "proposed",
              },
              reason: "Transition propose is proposed and waiting for approve/edit/reject/respond.",
              nextAction: "Resolve staged transition",
            },
            enforcementMode: "governed-action",
            requiredReceiptKind: "governed-action",
            receiptCoverage: "required-before-commit",
            blockers: ["receipt-required-before-commit"],
            resolution: {
              status: "approved-awaiting-receipt",
              action: "approve",
              activationAllowed: false,
              liveMutationAllowed: false,
              commitAllowed: false,
              decisionInteractionId: "DI-RESOLVE001",
              resolverUserId: "user-1",
              resolvedAt: "2026-06-28T11:25:00.000Z",
              note: "Approved for governed action path.",
              stagedTransition: {
                transitionId: "work-pattern:backlog-item:BI-456:propose:DI-REVIEW003",
                action: "propose",
                status: "approved",
                caseState: "active",
                a2aStatus: "working",
                terminal: true,
                committable: true,
                sourceRef: {
                  kind: "decision-interaction",
                  id: "DI-RESOLVE001",
                  status: "approved",
                },
                reason: "Transition propose is approved and ready to commit.",
                nextAction: "Commit approved transition",
              },
              receiptCoverage: "required-before-commit",
              receiptId: null,
              blockers: ["receipt-required-before-commit"],
            },
          },
        },
        activationCandidate: null,
        caseStaging: null,
        shadowEvaluation: null,
      },
    ],
  }),
}));

vi.mock("@/lib/coworker-self-assessment/review-service", () => ({
  getCoworkerCapabilityNeedReview: vi.fn().mockResolvedValue({
    summary: {
      total: 1,
      byStatus: { submitted: 1 },
      bySeverity: { important: 1 },
      byKind: { grant: 1 },
    },
    filterOptions: {
      statuses: ["submitted"],
      severities: ["important"],
      kinds: ["grant"],
    },
    needs: [
      {
        needId: "NEED-1",
        assessmentId: "CSA-1",
        agentId: "hr-specialist",
        coworkerName: "HR Specialist",
        coworkerSlug: "hr-specialist",
        coworkerTier: 2,
        valueStream: "operate",
        kind: "grant",
        severity: "important",
        status: "submitted",
        need: "Missing sandbox lease grant",
        blocks: "The coworker cannot claim local integration evidence without the grant.",
        evidencePreview: "patternKey: grant-denial|hr-specialist|/build",
        readinessPreview: "readyForReview: true",
        linkedBacklogItemId: "BI-1",
        linkedBacklogItemTitle: "Grant sandbox lease capability",
        linkedBacklogItemStatus: "open",
        duplicateOfId: null,
        duplicateOfNeed: null,
        duplicateCount: 0,
        reviewerNote: null,
        assessmentVerdict: "gaps",
        assessmentConfidence: "medium",
        missionSummary: "Observed repeated work-pattern friction.",
        capabilitySummary: "Missing sandbox lease grant",
        routeContext: "/build",
        trigger: "work-pattern-observer",
        createdAtLabel: "Jun 28, 2026",
        updatedAtLabel: "Jun 28, 2026",
      },
    ],
  }),
}));

import { prisma } from "@dpf/db";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";

describe("AgentDetailPage", () => {
  it("shows the GAID identity reference for the selected coworker", async () => {
    vi.mocked(prisma.agent.findFirst).mockResolvedValue({
      id: "agent-db-1",
      agentId: "hr-specialist",
      slugId: "hr-specialist",
      name: "HR Specialist",
      displayName: "HR Specialist",
      kind: "specialist",
      tier: 2,
      type: "specialist",
      description: "HR help",
      status: "active",
      valueStream: "operate",
      sensitivity: "restricted",
      humanSupervisorId: "HR-100",
      escalatesTo: null,
      delegatesTo: [],
      lifecycleStage: "production",
      hitlTierDefault: 2,
      portfolio: null,
      executionConfig: null,
      skills: [],
      toolGrants: [],
      performanceProfiles: [],
      degradationMappings: [],
      promptContext: null,
      governanceProfile: null,
      coworkerAssessments: [],
      ownerships: [],
    } as never);
    vi.mocked(getAgentGaidMap).mockResolvedValue(
      new Map([["hr-specialist", "gaid:priv:dpf.internal:hr-specialist"]]),
    );

    const { default: AgentDetailPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AgentDetailPage({ params: Promise.resolve({ agentId: "hr-specialist" }) }),
    );

    expect(html).toContain("GAID:");
    expect(html).toContain("gaid:priv:dpf.internal:hr-specialist");
  });

  it("shows the coworker's Needs & Playbooks record with living playbook candidates", async () => {
    vi.mocked(prisma.agent.findFirst).mockResolvedValue({
      id: "agent-db-1",
      agentId: "hr-specialist",
      slugId: "hr-specialist",
      name: "HR Specialist",
      displayName: "HR Specialist",
      kind: "specialist",
      tier: 2,
      type: "specialist",
      description: "HR help",
      status: "active",
      valueStream: "operate",
      sensitivity: "restricted",
      humanSupervisorId: "HR-100",
      escalatesTo: null,
      delegatesTo: [],
      lifecycleStage: "production",
      hitlTierDefault: 2,
      portfolio: null,
      executionConfig: null,
      skills: [],
      toolGrants: [],
      performanceProfiles: [],
      degradationMappings: [],
      promptContext: null,
      governanceProfile: null,
      coworkerAssessments: [],
      ownerships: [],
    } as never);
    vi.mocked(getAgentGaidMap).mockResolvedValue(new Map());

    const { default: AgentDetailPage } = await import("./page");
    const html = renderToStaticMarkup(
      await AgentDetailPage({ params: Promise.resolve({ agentId: "hr-specialist" }) }),
    );

    expect(html).toContain("Capabilities");
    expect(html).toContain("Living Playbooks");
    expect(html).toContain("Missing sandbox lease grant");
    expect(html).toContain("Shadow evidence");
    expect(html).toContain("Testing a better method");
    expect(html).toContain("0 valid pairs");
    expect(html).toContain("More comparable evidence is needed");
    expect(html).toContain("Experiment evidence details");
    expect(html).toContain("95% agreement");
    expect(html).toContain("approve narrower scope");
    expect(html).toContain("Approve candidate");
    expect(html).toContain("Defer");
    expect(html).toContain("Reject");
    expect(html).toContain("Decision recorded");
    expect(html).toContain("activation candidate");
    expect(html).toContain("Work Case proposal staged");
    expect(html).toContain("receipt required before commit");
    expect(html).toContain("Approve proposal");
    expect(html).toContain("Approved - receipt evidence needed");
    expect(html).toContain("Attach receipt evidence");
    expect(html).toContain("TER-LP-NEED-3-DI-RESOLVE001");
    expect(html).not.toContain("Activate playbook");
    expect(html).not.toContain("scaffold");
    expect(html).not.toContain("ReceiptEnvelope");
    expect(html).not.toContain("DecisionInteraction");
    expect(html).not.toContain("CoworkerActionEnvelope");
  });

});
