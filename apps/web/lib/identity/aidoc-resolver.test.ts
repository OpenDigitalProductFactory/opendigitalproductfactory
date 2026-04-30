import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    principalAlias: {
      findFirst: vi.fn(),
    },
    agent: {
      findUnique: vi.fn(),
    },
    agentModelConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

import { resolveAIDocForAgent, resolveInternalAIDoc } from "./aidoc-resolver";

describe("resolveInternalAIDoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("projects a private AIDoc from the live agent identity and operating state", async () => {
    vi.mocked(prisma.principalAlias.findFirst)
      .mockResolvedValueOnce({
        principalId: "principal-1",
        aliasValue: "gaid:priv:dpf.internal:build-specialist",
        principal: {
          principalId: "PRN-000002",
          displayName: "Build Specialist",
          status: "active",
        },
      } as never)
      .mockResolvedValueOnce({
        aliasValue: "build-specialist",
      } as never);

    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      agentId: "build-specialist",
      name: "Build Specialist",
      status: "active",
      sensitivity: "internal",
      hitlTierDefault: 2,
      lifecycleStage: "production",
      executionConfig: {
        defaultModelId: "gpt-5.2",
        executionType: "sandbox",
        temperature: 0.2,
        maxTokens: 12000,
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
          capability: "build_promote",
          taskType: "code_generation",
        },
        {
          label: "repo-grounding",
          capability: "file_read",
          taskType: "analysis",
        },
      ],
      toolGrants: [
        { grantKey: "backlog_write" },
        { grantKey: "registry_read" },
        { grantKey: "sandbox_execute" },
      ],
    } as never);
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue({
      minimumTier: "strong",
      pinnedProviderId: "openai",
      pinnedModelId: "gpt-5.2",
      budgetClass: "quality_first",
    } as never);

    const aidoc = await resolveInternalAIDoc("gaid:priv:dpf.internal:build-specialist");

    expect(aidoc).not.toBeNull();
    expect(aidoc).toMatchObject({
      gaid: "gaid:priv:dpf.internal:build-specialist",
      subject_type: "agent",
      subject_name: "Build Specialist",
      principal_ref: "PRN-000002",
      issuer: "dpf.internal",
      status: "active",
      exposure_state: "private",
      validation_state: "validated",
      lifecycle_stage: "production",
      data_sensitivity_profile: "internal",
      hitl_profile: {
        default_tier: 2,
        policy: "proposal_for_external_writes",
        autonomy_level: "bounded",
      },
      model_binding: {
        default_model_id: "gpt-5.2",
        execution_type: "sandbox",
        pinned_model_id: "gpt-5.2",
        pinned_provider_id: "openai",
      },
      authorization_classes: ["observe", "create", "update", "execute"],
    });

    expect(aidoc!.tool_surface).toEqual(
      expect.arrayContaining([
        "create_backlog_item",
        "update_backlog_item_status",
        "record_execution_evidence",
        "launch_sandbox",
      ]),
    );
    expect(aidoc!.prompt_class_refs).toEqual([
      "analysis:repo-grounding",
      "code_generation:build-phase-implementation",
    ]);
    expect(aidoc!.operating_profile_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the same operating profile fingerprint for equivalent material state", async () => {
    const gaidAlias = {
      principalId: "principal-1",
      aliasValue: "gaid:priv:dpf.internal:build-specialist",
      principal: {
        principalId: "PRN-000002",
        displayName: "Build Specialist",
        status: "active",
      },
    };
    const agentAlias = { aliasValue: "build-specialist" };

    vi.mocked(prisma.principalAlias.findFirst)
      .mockResolvedValueOnce(gaidAlias as never)
      .mockResolvedValueOnce(agentAlias as never)
      .mockResolvedValueOnce(gaidAlias as never)
      .mockResolvedValueOnce(agentAlias as never);

    vi.mocked(prisma.agent.findUnique)
      .mockResolvedValueOnce({
        agentId: "build-specialist",
        name: "Build Specialist",
        status: "active",
        sensitivity: "internal",
        hitlTierDefault: 3,
        lifecycleStage: "production",
        executionConfig: {
          defaultModelId: "gpt-5.2",
          executionType: "sandbox",
          temperature: 0.2,
          maxTokens: 12000,
        },
        governanceProfile: {
          autonomyLevel: "bounded",
          hitlPolicy: "proposal_for_external_writes",
          allowDelegation: true,
          maxDelegationRiskBand: "medium",
        },
        skills: [
          { label: "repo-grounding", capability: "file_read", taskType: "analysis" },
          {
            label: "build-phase-implementation",
            capability: "build_promote",
            taskType: "code_generation",
          },
        ],
        toolGrants: [
          { grantKey: "sandbox_execute" },
          { grantKey: "backlog_write" },
          { grantKey: "registry_read" },
        ],
      } as never)
      .mockResolvedValueOnce({
        agentId: "build-specialist",
        name: "Build Specialist",
        status: "active",
        sensitivity: "internal",
        hitlTierDefault: 3,
        lifecycleStage: "production",
        executionConfig: {
          defaultModelId: "gpt-5.2",
          executionType: "sandbox",
          temperature: 0.2,
          maxTokens: 12000,
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
            capability: "build_promote",
            taskType: "code_generation",
          },
          { label: "repo-grounding", capability: "file_read", taskType: "analysis" },
        ],
        toolGrants: [
          { grantKey: "registry_read" },
          { grantKey: "backlog_write" },
          { grantKey: "sandbox_execute" },
        ],
      } as never);
    vi.mocked(prisma.agentModelConfig.findUnique)
      .mockResolvedValueOnce({
        minimumTier: "strong",
        pinnedProviderId: "openai",
        pinnedModelId: "gpt-5.2",
        budgetClass: "quality_first",
      } as never)
      .mockResolvedValueOnce({
        pinnedModelId: "gpt-5.2",
        budgetClass: "quality_first",
        minimumTier: "strong",
        pinnedProviderId: "openai",
      } as never);

    const first = await resolveInternalAIDoc("gaid:priv:dpf.internal:build-specialist");
    const second = await resolveInternalAIDoc("gaid:priv:dpf.internal:build-specialist");

    expect(first?.operating_profile_fingerprint).toBe(second?.operating_profile_fingerprint);
  });

  it("resolves an agent-scoped lookup through the synced GAID alias", async () => {
    vi.mocked(prisma.principalAlias.findFirst)
      .mockResolvedValueOnce({
        principalId: "principal-1",
      } as never)
      .mockResolvedValueOnce({
        aliasValue: "gaid:priv:dpf.internal:build-specialist",
      } as never)
      .mockResolvedValueOnce({
        principalId: "principal-1",
        aliasValue: "gaid:priv:dpf.internal:build-specialist",
        principal: {
          principalId: "PRN-000002",
          displayName: "Build Specialist",
          status: "active",
        },
      } as never)
      .mockResolvedValueOnce({
        aliasValue: "build-specialist",
      } as never);

    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      agentId: "build-specialist",
      name: "Build Specialist",
      status: "active",
      sensitivity: "internal",
      hitlTierDefault: 3,
      lifecycleStage: "production",
      executionConfig: null,
      governanceProfile: null,
      modelConfig: null,
      skills: [],
      toolGrants: [{ grantKey: "registry_read" }],
    } as never);
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null);

    const aidoc = await resolveAIDocForAgent("build-specialist");

    expect(aidoc?.gaid).toBe("gaid:priv:dpf.internal:build-specialist");
    expect(aidoc?.authorization_classes).toEqual(["observe"]);
  });
});
