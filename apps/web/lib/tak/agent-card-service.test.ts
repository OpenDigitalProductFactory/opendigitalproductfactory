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
    coworkerActionEnvelope: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
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

describe("Agent Card canonical grant projection", () => {
  const record = (agentId: string, grants: string[], revoked: string[] = []) => ({
    agentId, name: agentId, description: null, status: "active", lifecycleStage: "production",
    sensitivity: "internal", hitlTierDefault: 1, executionConfig: null, governanceProfile: null,
    skills: [], toolGrants: grants.map(grantKey => ({ grantKey })),
    toolGrantRevocations: revoked.map(grantKey => ({ grantKey })),
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([]);
    vi.mocked(prisma.coworkerActionEnvelope.findMany).mockResolvedValue([]);
    vi.mocked(prisma.coworkerActionEnvelope.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([]);
    vi.mocked(resolveAIDocForAgent).mockResolvedValue(null);
  });
  it("preserves alias identities while projecting only their canonical persisted authority in one batch", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      record("external-codex", ["admin_write"]),
      record("AGT-EXT-CODEX", ["registry_read", "release_plan_read"], ["release_plan_read"]),
    ] as never);
    const cards = await listInternalAgentCards();
    expect(cards.map(card => card.agentId)).toEqual(["external-codex", "AGT-EXT-CODEX"]);
    for (const card of cards) {
      expect(card.toolGrants).toEqual(["registry_read"]);
      expect(card.extensions.tak.authority.toolGrantCount).toBe(1);
      expect(card.exposedTools.length).toBeGreaterThan(0);
    }
    expect(prisma.agent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.agent.findUnique).not.toHaveBeenCalled();
  });
  it("resolves a single alias card through the same canonical grant and revocation state", async () => {
    vi.mocked(prisma.agent.findUnique).mockImplementation((async (input: { where: { agentId?: string } }) => (
      input.where.agentId === "AGT-EXT-CODEX"
        ? record("AGT-EXT-CODEX", ["registry_read", "admin_write"], ["admin_write"])
        : record("external-codex", ["admin_write"])
    )) as never);
    const card = await resolveInternalAgentCard("external-codex");
    expect(card?.agentId).toBe("external-codex");
    expect(card?.toolGrants).toEqual(["registry_read"]);
  });
  it("never uses a granted alias as the missing canonical owner's authority", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([record("external-codex", ["admin_write"])] as never);
    const [card] = await listInternalAgentCards();
    expect(card.toolGrants).toEqual([]);
    expect(card.exposedTools).toEqual([]);
  });
  it("surfaces a failed authoritative card read", async () => {
    vi.mocked(prisma.agent.findMany).mockRejectedValue(new Error("authority unavailable"));
    await expect(listInternalAgentCards()).rejects.toThrow("authority unavailable");
  });
  it("intersects a present AIDoc with current authority, including legacy implied grants", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      record("external-codex", ["admin_write"]),
      record("AGT-EXT-CODEX", ["backlog_write"]),
    ] as never);
    vi.mocked(resolveAIDocForAgent).mockResolvedValue({
      tool_surface: ["record_execution_evidence", "not_a_registered_tool", "set_agent_tool_grants"],
      authorization_classes: [],
    } as never);
    const cards = await listInternalAgentCards();
    for (const card of cards) expect(card.exposedTools).toEqual(["record_execution_evidence"]);
    expect(resolveAIDocForAgent).toHaveBeenCalledWith("external-codex", undefined, ["backlog_write"]);
    expect(prisma.agent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.agent.findUnique).not.toHaveBeenCalled();
  });
  it("does not revive advertised tools when the canonical owner is missing", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([record("external-codex", ["admin_write"])] as never);
    vi.mocked(resolveAIDocForAgent).mockResolvedValue({ tool_surface: ["record_execution_evidence"], authorization_classes: [] } as never);
    expect((await listInternalAgentCards())[0].exposedTools).toEqual([]);
  });
});

describe("resolveInternalAgentCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.coworkerActionEnvelope.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.coworkerActionEnvelope.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
  });

  it("projects an internal Agent Card with TAK and GAID supervisor metadata", async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      agentId: "identity-test-agent",
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
      toolGrantRevocations: [],
      toolGrants: [
        { grantKey: "sandbox_execute" },
        { grantKey: "backlog_write" },
        { grantKey: "registry_read" },
      ],
    } as never);

    vi.mocked(resolveAIDocForAgent).mockResolvedValue({
      gaid: "gaid:priv:dpf.internal:identity-test-agent",
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

    const card = await resolveInternalAgentCard("identity-test-agent", {
      routeContext: "/build",
      actingPrincipalRef: "PRN-HUMAN-1",
      actingPrincipalGaid: "gaid:priv:dpf.internal:mark",
    });

    expect(card).toMatchObject({
      schemaVersion: "dpf.agent-card.v1",
      agentId: "identity-test-agent",
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
            agentId: "identity-test-agent",
            routeContext: "/build",
            actingPrincipalRef: "PRN-HUMAN-1",
            actingPrincipalGaid: "gaid:priv:dpf.internal:mark",
            agentGaid: "gaid:priv:dpf.internal:identity-test-agent",
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
          gaid: "gaid:priv:dpf.internal:identity-test-agent",
          aidocRef: "gaid:priv:dpf.internal:identity-test-agent",
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
      toolGrantRevocations: [],
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
        agentId: "identity-test-agent",
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
        toolGrantRevocations: [],
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
        toolGrantRevocations: [],
        toolGrants: [{ grantKey: "registry_read" }],
      },
    ] as never);
    vi.mocked(resolveAIDocForAgent).mockImplementation(async (agentId) =>
      agentId === "identity-test-agent"
        ? ({
            gaid: "gaid:priv:dpf.internal:identity-test-agent",
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

    expect(cards.map((card) => card.agentId)).toEqual(["identity-test-agent", "planner"]);
    expect(cards[0]).toMatchObject({
      agentId: "identity-test-agent",
      exposedTools: ["launch_sandbox", "run_sandbox_tests"],
      extensions: {
        tak: {
          authority: {
            routeContext: "/platform/audit/authority",
            actingPrincipalRef: "PRN-HUMAN-1",
            agentGaid: "gaid:priv:dpf.internal:identity-test-agent",
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
        agentId: "identity-test-agent",
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
        toolGrantRevocations: [],
        toolGrants: [{ grantKey: "sandbox_execute" }],
      },
    ] as never);
    vi.mocked(resolveAIDocForAgent).mockResolvedValue(null);
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([
      {
        id: "prop-row-2",
        proposalId: "PROP-002",
        threadId: "thread-2",
        messageId: "msg-2",
        agentId: "identity-test-agent",
        actionType: "register_digital_product_from_build",
        parameters: {},
        proposedAt: new Date("2026-05-20T15:00:00Z"),
      },
      {
        id: "prop-row-1",
        proposalId: "PROP-001",
        threadId: "thread-1",
        messageId: "msg-1",
        agentId: "identity-test-agent",
        actionType: "deploy_feature",
        parameters: {},
        proposedAt: new Date("2026-05-19T15:00:00Z"),
      },
    ] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([
      {
        id: "tool-exec-2",
        agentId: "identity-test-agent",
        toolName: "run_sandbox_tests",
        createdAt: new Date("2026-05-20T16:00:00Z"),
        receipt: {
          id: "receipt-2",
          toolExecutionId: "tool-exec-2",
          receiptKind: "sandbox-test-run",
          receiptStatus: "valid",
          executionStatus: "succeeded",
          expiresAt: new Date("2026-06-20T16:00:01Z"),
          createdAt: new Date("2026-05-20T16:00:01Z"),
        },
      },
      {
        id: "tool-exec-1",
        agentId: "identity-test-agent",
        toolName: "launch_sandbox",
        createdAt: new Date("2026-05-19T16:00:00Z"),
        receipt: {
          id: "receipt-1",
          toolExecutionId: "tool-exec-1",
          receiptKind: "sandbox-command",
          receiptStatus: "valid",
          executionStatus: "succeeded",
          expiresAt: new Date("2026-06-19T16:00:01Z"),
          createdAt: new Date("2026-05-19T16:00:01Z"),
        },
      },
    ] as never);

    const [card] = await listInternalAgentCards();

    expect(card.extensions.tak.authority.supervisorDecisionState).toEqual({
      pendingProposalCount: 2,
      latestPendingProposal: {
        approvalId: "prop-row-2",
        proposalId: "PROP-002",
        threadId: "thread-2",
        messageId: "msg-2",
        actionType: "register_digital_product_from_build",
        actionLabel: "Register digital product from build",
        actionSummary: "Proposed action register_digital_product_from_build.",
        actionDetails: [],
        proposedAt: "2026-05-20T15:00:00.000Z",
        decisionEndpoint: "/api/v1/governance/approvals/prop-row-2",
      },
      // BI-7BCC87BB (DI-FFD78D222548): envelopes are counted beside proposals; none here.
      pendingEnvelopeCount: 0,
      latestPendingEnvelope: null,
      latestPendingKind: "proposal",
      recentReceiptCount: 2,
      latestReceipt: {
        receiptId: "receipt-2",
        toolExecutionId: "tool-exec-2",
        toolName: "run_sandbox_tests",
        receiptKind: "sandbox-test-run",
        receiptStatus: "valid",
        executionStatus: "succeeded",
        expiresAt: "2026-06-20T16:00:01.000Z",
        createdAt: "2026-05-20T16:00:01.000Z",
        journalHref: "/platform/audit/journal?executionId=tool-exec-2&receiptId=receipt-2",
      },
    });
    expect(prisma.agentActionProposal.findMany).toHaveBeenCalledWith({
      where: {
        agentId: { in: ["identity-test-agent"] },
        status: "proposed",
      },
      orderBy: { proposedAt: "desc" },
      select: {
        id: true,
        proposalId: true,
        threadId: true,
        messageId: true,
        agentId: true,
        actionType: true,
        parameters: true,
        proposedAt: true,
      },
    });
    expect(prisma.toolExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agentId: { in: ["identity-test-agent"] },
          receipt: { isNot: null },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("projects activity-routing proposal details into supervisor decision state", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        agentId: "activity-routing-governor",
        name: "Activity Routing Governor",
        description: null,
        status: "active",
        lifecycleStage: "production",
        sensitivity: "internal",
        hitlTierDefault: 2,
        executionConfig: null,
        governanceProfile: null,
        skills: [],
        toolGrantRevocations: [],
        toolGrants: [],
      },
    ] as never);
    vi.mocked(resolveAIDocForAgent).mockResolvedValue(null);
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([
      {
        id: "prop-route-1",
        proposalId: "harness-action:code-edit:glm.mixed.code-edit.provisional:zai-coding:glm-5.2:promote",
        threadId: "thread-routing",
        messageId: "msg-routing",
        agentId: "activity-routing-governor",
        actionType: "activity_harness_confidence_override",
        parameters: {
          kind: "activity-harness-confidence-override",
          activityClass: "code-edit",
          harnessRecipeKey: "glm.mixed.code-edit.provisional",
          providerId: "zai-coding",
          modelId: "glm-5.2",
          confidence: "trusted",
        },
        proposedAt: new Date("2026-06-28T20:00:00Z"),
      },
    ] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([]);

    const [card] = await listInternalAgentCards();

    expect(card.extensions.tak.authority.supervisorDecisionState.latestPendingProposal).toMatchObject({
      actionType: "activity_harness_confidence_override",
      actionLabel: "Activity routing tuning",
      actionSummary: "Set code-edit / glm.mixed.code-edit.provisional on zai-coding/glm-5.2 to trusted.",
      actionDetails: [
        { label: "Activity", value: "code-edit" },
        { label: "Harness", value: "glm.mixed.code-edit.provisional" },
        { label: "Provider", value: "zai-coding" },
        { label: "Model", value: "glm-5.2" },
        { label: "Confidence", value: "trusted" },
      ],
    });
  });
});
