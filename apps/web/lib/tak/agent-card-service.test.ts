import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    agentActionProposal: {
      findMany: vi.fn(),
    },
    toolExecution: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/identity/aidoc-resolver", () => ({
  resolveAIDocForAgent: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { resolveAIDocForAgent } from "@/lib/identity/aidoc-resolver";

import { listInternalAgentCards, resolveInternalAgentCard } from "./agent-card-service";

describe("resolveInternalAgentCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
  });

  it("projects an internal Agent Card with TAK and GAID supervisor metadata", async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      agentId: "build-specialist",
      name: "Build Specialist",
      description: "Implements governed Build Studio changes.",
      status: "active",
      lifecycleStage: "production",
      sensitivity: "internal",
      hitlTierDefault: 2,
      executionConfig: {
        executionType: "sandbox",
        defaultModelId: "gpt-5.2",
      },
      governanceProfile: {
        autonomyLevel: "bounded",
        hitlPolicy: "proposal_for_external_writes",
        allowDelegation: true,
        maxDelegationRiskBand: "medium",
      },
      skills: [
        {
          label: "build-phase-implementation",
          taskType: "code_generation",
          capability: "build_promote",
        },
        {
          label: "repo-grounding",
          taskType: "analysis",
          capability: "file_read",
        },
      ],
      toolGrants: [
        { grantKey: "sandbox_execute" },
        { grantKey: "backlog_write" },
        { grantKey: "registry_read" },
      ],
    } as never);

    vi.mocked(resolveAIDocForAgent).mockResolvedValue({
      gaid: "gaid:priv:dpf.internal:build-specialist",
      issuer: "dpf.internal",
      subject_type: "agent",
      subject_name: "Build Specialist",
      principal_ref: "PRN-AGENT-1",
      status: "active",
      exposure_state: "private",
      validation_state: "validated",
      lifecycle_stage: "production",
      data_sensitivity_profile: "internal",
      model_binding: {
        default_model_id: "gpt-5.2",
        pinned_provider_id: "openai",
        pinned_model_id: "gpt-5.2",
        minimum_tier: "strong",
        budget_class: "quality_first",
        execution_type: "sandbox",
        temperature: 0.2,
        max_tokens: 12000,
      },
      hitl_profile: {
        default_tier: 2,
        policy: "proposal_for_external_writes",
        autonomy_level: "bounded",
        allow_delegation: true,
        max_delegation_risk_band: "medium",
      },
      prompt_class_refs: ["analysis:repo-grounding", "code_generation:build-phase-implementation"],
      tool_surface: ["launch_sandbox", "record_execution_evidence", "run_sandbox_tests"],
      authorization_classes: ["observe", "create", "update", "execute"],
      operating_profile_fingerprint: "a".repeat(64),
    } as never);

    const card = await resolveInternalAgentCard("build-specialist", {
      routeContext: "/build",
      actingPrincipalRef: "PRN-HUMAN-1",
      actingPrincipalGaid: "gaid:priv:dpf.internal:mark",
    });

    expect(card).toMatchObject({
      schemaVersion: "dpf.agent-card.v1",
      agentId: "build-specialist",
      name: "Build Specialist",
      description: "Implements governed Build Studio changes.",
      status: "active",
      lifecycleStage: "production",
      interfaces: ["mcp", "a2a-internal", "task-run", "supervisor-control"],
      capabilities: ["build_promote", "file_read"],
      toolGrants: ["backlog_write", "registry_read", "sandbox_execute"],
      exposedTools: ["launch_sandbox", "record_execution_evidence", "run_sandbox_tests"],
      extensions: {
        tak: {
          sensitivity: "internal",
          hitlTier: 2,
          hitlPolicy: "proposal_for_external_writes",
          autonomyLevel: "bounded",
          allowDelegation: true,
          maxDelegationRiskBand: "medium",
          operatingProfileFingerprint: "a".repeat(64),
          authority: {
            agentId: "build-specialist",
            routeContext: "/build",
            actingPrincipalRef: "PRN-HUMAN-1",
            actingPrincipalGaid: "gaid:priv:dpf.internal:mark",
            agentGaid: "gaid:priv:dpf.internal:build-specialist",
            aidocValidationState: "validated",
            operatingProfileFingerprint: "a".repeat(64),
            hitlTier: 2,
            hitlPolicy: "proposal_for_external_writes",
            sensitivity: "internal",
            toolGrantCount: 3,
            exposedToolCount: 3,
            authorizationClasses: ["observe", "create", "update", "execute"],
            requiresApprovalForSideEffects: true,
          },
        },
        gaid: {
          gaid: "gaid:priv:dpf.internal:build-specialist",
          aidocRef: "gaid:priv:dpf.internal:build-specialist",
          authorizationClasses: ["observe", "create", "update", "execute"],
          validationState: "validated",
        },
      },
    });

    expect(card!.skills).toEqual([
      { label: "build-phase-implementation", taskType: "code_generation", capability: "build_promote" },
      { label: "repo-grounding", taskType: "analysis", capability: "file_read" },
    ]);
    expect(card!.securitySchemes.map((scheme) => scheme.id)).toEqual([
      "dpf-capability",
      "agent-grant",
      "hitl",
      "mcp-token",
    ]);
    expect(card!.securityRequirements).toEqual([
      "user capability must allow the requested action",
      "agent grant must allow the requested tool",
      "route context must expose the requested capability",
      "side-effecting work may require HITL proposal approval",
    ]);
    expect(card!.extensions.tak.authority.limitations).toContain(
      "side-effecting actions require proposal or review before execution",
    );
  });

  it("degrades explicitly when an agent has no GAID or AIDoc projection", async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      agentId: "planner",
      name: "Planner",
      description: null,
      status: "active",
      lifecycleStage: "production",
      sensitivity: "internal",
      hitlTierDefault: 3,
      executionConfig: null,
      governanceProfile: null,
      skills: [],
      toolGrants: [{ grantKey: "registry_read" }],
    } as never);
    vi.mocked(resolveAIDocForAgent).mockResolvedValue(null);

    const card = await resolveInternalAgentCard("planner", {
      routeContext: "/portfolio",
    });

    expect(card).toMatchObject({
      agentId: "planner",
      description: null,
      exposedTools: expect.arrayContaining(["search_portfolio_context"]),
      extensions: {
        tak: {
          hitlTier: 3,
          hitlPolicy: null,
          authority: {
            routeContext: "/portfolio",
            agentGaid: null,
            aidocValidationState: "unlinked",
            operatingProfileFingerprint: null,
            authorizationClasses: [],
            requiresApprovalForSideEffects: false,
          },
        },
        gaid: {
          gaid: null,
          aidocRef: null,
          authorizationClasses: [],
          validationState: "unlinked",
        },
      },
    });
    expect(card!.extensions.tak.authority.limitations).toContain(
      "agent has no resolved GAID/AIDoc projection",
    );
  });

  it("lists internal Agent Cards for supervisor authority surfaces", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        agentId: "build-specialist",
        name: "Build Specialist",
        description: "Implements governed Build Studio changes.",
        status: "active",
        lifecycleStage: "production",
        sensitivity: "internal",
        hitlTierDefault: 2,
        executionConfig: {
          executionType: "sandbox",
          defaultModelId: "gpt-5.2",
        },
        governanceProfile: {
          autonomyLevel: "bounded",
          hitlPolicy: "proposal_for_external_writes",
          allowDelegation: true,
          maxDelegationRiskBand: "medium",
        },
        skills: [
          {
            label: "build-phase-implementation",
            taskType: "code_generation",
            capability: "build_promote",
          },
        ],
        toolGrants: [{ grantKey: "sandbox_execute" }],
      },
      {
        agentId: "planner",
        name: "Planner",
        description: null,
        status: "active",
        lifecycleStage: "production",
        sensitivity: "internal",
        hitlTierDefault: 3,
        executionConfig: null,
        governanceProfile: null,
        skills: [],
        toolGrants: [{ grantKey: "registry_read" }],
      },
    ] as never);
    vi.mocked(resolveAIDocForAgent).mockImplementation(async (agentId) =>
      agentId === "build-specialist"
        ? ({
            gaid: "gaid:priv:dpf.internal:build-specialist",
            issuer: "dpf.internal",
            subject_type: "agent",
            subject_name: "Build Specialist",
            principal_ref: "PRN-AGENT-1",
            status: "active",
            exposure_state: "private",
            validation_state: "validated",
            lifecycle_stage: "production",
            data_sensitivity_profile: "internal",
            model_binding: {
              default_model_id: "gpt-5.2",
              pinned_provider_id: "openai",
              pinned_model_id: "gpt-5.2",
              minimum_tier: "strong",
              budget_class: "quality_first",
              execution_type: "sandbox",
              temperature: 0.2,
              max_tokens: 12000,
            },
            hitl_profile: {
              default_tier: 2,
              policy: "proposal_for_external_writes",
              autonomy_level: "bounded",
              allow_delegation: true,
              max_delegation_risk_band: "medium",
            },
            prompt_class_refs: ["code_generation:build-phase-implementation"],
            tool_surface: ["launch_sandbox", "run_sandbox_tests"],
            authorization_classes: ["observe", "execute"],
            operating_profile_fingerprint: "b".repeat(64),
          } as never)
        : null,
    );

    const cards = await listInternalAgentCards({
      routeContext: "/platform/audit/authority",
      actingPrincipalRef: "PRN-HUMAN-1",
    });

    expect(cards.map((card) => card.agentId)).toEqual(["build-specialist", "planner"]);
    expect(cards[0]).toMatchObject({
      agentId: "build-specialist",
      exposedTools: ["launch_sandbox", "run_sandbox_tests"],
      extensions: {
        tak: {
          authority: {
            routeContext: "/platform/audit/authority",
            actingPrincipalRef: "PRN-HUMAN-1",
            agentGaid: "gaid:priv:dpf.internal:build-specialist",
            aidocValidationState: "validated",
            exposedToolCount: 2,
            authorizationClasses: ["observe", "execute"],
          },
        },
      },
    });
    expect(cards[1]).toMatchObject({
      agentId: "planner",
      extensions: {
        gaid: {
          gaid: null,
          validationState: "unlinked",
        },
      },
    });
    expect(prisma.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { name: "asc" },
      }),
    );
  });

  it("adds pending proposal and receipt state for supervisor decisions", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        agentId: "build-specialist",
        name: "Build Specialist",
        description: "Implements governed Build Studio changes.",
        status: "active",
        lifecycleStage: "production",
        sensitivity: "internal",
        hitlTierDefault: 2,
        executionConfig: null,
        governanceProfile: {
          autonomyLevel: "bounded",
          hitlPolicy: "proposal_for_external_writes",
          allowDelegation: true,
          maxDelegationRiskBand: "medium",
        },
        skills: [],
        toolGrants: [{ grantKey: "sandbox_execute" }],
      },
    ] as never);
    vi.mocked(resolveAIDocForAgent).mockResolvedValue(null);
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([
      {
        proposalId: "PROP-002",
        agentId: "build-specialist",
        actionType: "register_digital_product_from_build",
        proposedAt: new Date("2026-05-20T15:00:00Z"),
      },
      {
        proposalId: "PROP-001",
        agentId: "build-specialist",
        actionType: "deploy_feature",
        proposedAt: new Date("2026-05-19T15:00:00Z"),
      },
    ] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([
      {
        id: "tool-exec-2",
        agentId: "build-specialist",
        toolName: "run_sandbox_tests",
        createdAt: new Date("2026-05-20T16:00:00Z"),
        receipt: {
          id: "receipt-2",
          toolExecutionId: "tool-exec-2",
          receiptStatus: "valid",
          executionStatus: "succeeded",
          createdAt: new Date("2026-05-20T16:00:01Z"),
        },
      },
      {
        id: "tool-exec-1",
        agentId: "build-specialist",
        toolName: "launch_sandbox",
        createdAt: new Date("2026-05-19T16:00:00Z"),
        receipt: {
          id: "receipt-1",
          toolExecutionId: "tool-exec-1",
          receiptStatus: "valid",
          executionStatus: "succeeded",
          createdAt: new Date("2026-05-19T16:00:01Z"),
        },
      },
    ] as never);

    const [card] = await listInternalAgentCards();

    expect(card.extensions.tak.authority.supervisorDecisionState).toEqual({
      pendingProposalCount: 2,
      latestPendingProposal: {
        proposalId: "PROP-002",
        actionType: "register_digital_product_from_build",
        proposedAt: "2026-05-20T15:00:00.000Z",
      },
      recentReceiptCount: 2,
      latestReceipt: {
        receiptId: "receipt-2",
        toolExecutionId: "tool-exec-2",
        toolName: "run_sandbox_tests",
        receiptStatus: "valid",
        executionStatus: "succeeded",
        createdAt: "2026-05-20T16:00:01.000Z",
      },
    });
    expect(prisma.agentActionProposal.findMany).toHaveBeenCalledWith({
      where: {
        agentId: { in: ["build-specialist"] },
        status: "proposed",
      },
      orderBy: { proposedAt: "desc" },
      select: {
        proposalId: true,
        agentId: true,
        actionType: true,
        proposedAt: true,
      },
    });
    expect(prisma.toolExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agentId: { in: ["build-specialist"] },
          receipt: { isNot: null },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});
