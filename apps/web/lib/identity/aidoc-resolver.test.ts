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

import { projectInternalAIDoc, resolveAIDocForAgent, resolveInternalAIDoc } from "./aidoc-resolver";

describe("AIDoc canonical authority", () => {
  const agent = (agentId: string, grants: string[], revoked: string[] = []) => ({
    agentId, name: "Alias identity", status: "active", sensitivity: "internal", hitlTierDefault: 2,
    lifecycleStage: "production", executionConfig: null, governanceProfile: null,
    skills: [{ label: "alias-skill", taskType: "analysis" }],
    toolGrants: grants.map(grantKey => ({ grantKey })),
    toolGrantRevocations: revoked.map(grantKey => ({ grantKey })),
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.principalAlias.findFirst)
      .mockResolvedValueOnce({ principalId: "principal-1", principal: { principalId: "PRN-ALIAS" } } as never)
      .mockResolvedValueOnce({ aliasValue: "external-codex" } as never);
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null);
  });
  it("uses canonical persisted grants and revocations while retaining the alias identity", async () => {
    vi.mocked(prisma.agent.findUnique).mockImplementation((async (input: { where: { agentId?: string } }) => (
      input.where.agentId === "AGT-EXT-CODEX"
        ? agent("AGT-EXT-CODEX", ["registry_read", "backlog_write"], ["backlog_write"])
        : agent("external-codex", ["admin_write"])
    )) as never);
    const aidoc = await resolveInternalAIDoc("gaid:priv:dpf.internal:alias");
    expect(aidoc?.subject_name).toBe("Alias identity");
    expect(aidoc?.principal_ref).toBe("PRN-ALIAS");
    expect(aidoc?.prompt_class_refs).toEqual(["analysis:alias-skill"]);
    expect(aidoc?.authorization_classes).toEqual(["observe"]);
    expect(aidoc?.tool_surface).not.toContain("record_execution_evidence");
    expect(prisma.agent.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { agentId: "AGT-EXT-CODEX" } }));
  });
  it("fails closed when the canonical owner is missing", async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce(agent("external-codex", ["admin_write"]) as never).mockResolvedValueOnce(null);
    const aidoc = await resolveInternalAIDoc("gaid:priv:dpf.internal:alias");
    expect(aidoc?.tool_surface).toEqual([]);
    expect(aidoc?.authorization_classes).toEqual([]);
  });
  it("does not treat raw alias grants as authority in a pure projection", () => {
    const aidoc = projectInternalAIDoc({ gaid: "gaid:priv:dpf.internal:alias", principalRef: "PRN-ALIAS", agent: agent("external-codex", ["admin_write"]), modelConfig: null });
    expect(aidoc.tool_surface).toEqual([]);
    expect(aidoc.authorization_classes).toEqual([]);
  });
  it.each([{ authorityGrants: [] }, { authorityGrants: ["backlog_write"] }])("reuses batch authority $authorityGrants without another owner read", async ({ authorityGrants }) => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue(agent("external-codex", ["admin_write"]) as never);
    const aidoc = await resolveInternalAIDoc("gaid:priv:dpf.internal:alias", undefined, authorityGrants);
    expect(prisma.agent.findUnique).toHaveBeenCalledTimes(1);
    expect(aidoc?.authorization_classes).toEqual(authorityGrants.length ? ["create", "update"] : []);
    expect(aidoc?.tool_surface.includes("record_execution_evidence")).toBe(authorityGrants.length > 0);
  });
  it("fingerprints effective authority rather than revoked or retired grants", () => {
    const base = { gaid: "gaid:priv:dpf.internal:codex", principalRef: "PRN-CODEX", modelConfig: null };
    const first = projectInternalAIDoc({ ...base, agent: agent("AGT-EXT-CODEX", ["registry_read", "admin_write"], ["admin_write"]) });
    const second = projectInternalAIDoc({ ...base, agent: agent("AGT-EXT-CODEX", ["registry_read"]) });
    expect(first.operating_profile_fingerprint).toBe(second.operating_profile_fingerprint);
    const changed = projectInternalAIDoc({ ...base, agent: agent("AGT-EXT-CODEX", ["registry_read", "backlog_write"]) });
    expect(changed.operating_profile_fingerprint).not.toBe(second.operating_profile_fingerprint);
  });
});

describe("resolveInternalAIDoc", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("projects a private AIDoc from the live agent identity and operating state", async () => {
    vi.mocked(prisma.principalAlias.findFirst)
      .mockResolvedValueOnce({
        principalId: "principal-1",
        aliasValue: "gaid:priv:dpf.internal:identity-test-agent",
        principal: {
          principalId: "PRN-000002",
          displayName: "Build Specialist",
          status: "active",
        },
      } as never)
      .mockResolvedValueOnce({
        aliasValue: "identity-test-agent",
      } as never);

    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      agentId: "identity-test-agent",
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
      toolGrantRevocations: [],
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

    const aidoc = await resolveInternalAIDoc("gaid:priv:dpf.internal:identity-test-agent");

    expect(aidoc).not.toBeNull();
    expect(aidoc).toMatchObject({
      gaid: "gaid:priv:dpf.internal:identity-test-agent",
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
      aliasValue: "gaid:priv:dpf.internal:identity-test-agent",
      principal: {
        principalId: "PRN-000002",
        displayName: "Build Specialist",
        status: "active",
      },
    };
    const agentAlias = { aliasValue: "identity-test-agent" };

    vi.mocked(prisma.principalAlias.findFirst)
      .mockResolvedValueOnce(gaidAlias as never)
      .mockResolvedValueOnce(agentAlias as never)
      .mockResolvedValueOnce(gaidAlias as never)
      .mockResolvedValueOnce(agentAlias as never);

    vi.mocked(prisma.agent.findUnique)
      .mockResolvedValueOnce({
        agentId: "identity-test-agent",
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
        toolGrantRevocations: [],
      toolGrants: [
          { grantKey: "sandbox_execute" },
          { grantKey: "backlog_write" },
          { grantKey: "registry_read" },
        ],
      } as never)
      .mockResolvedValueOnce({
        agentId: "identity-test-agent",
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
        toolGrantRevocations: [],
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

    const first = await resolveInternalAIDoc("gaid:priv:dpf.internal:identity-test-agent");
    const second = await resolveInternalAIDoc("gaid:priv:dpf.internal:identity-test-agent");

    expect(first?.operating_profile_fingerprint).toBe(second?.operating_profile_fingerprint);
  });

  it("resolves an agent-scoped lookup through the synced GAID alias", async () => {
    vi.mocked(prisma.principalAlias.findFirst)
      .mockResolvedValueOnce({
        principalId: "principal-1",
      } as never)
      .mockResolvedValueOnce({
        aliasValue: "gaid:priv:dpf.internal:identity-test-agent",
      } as never)
      .mockResolvedValueOnce({
        principalId: "principal-1",
        aliasValue: "gaid:priv:dpf.internal:identity-test-agent",
        principal: {
          principalId: "PRN-000002",
          displayName: "Build Specialist",
          status: "active",
        },
      } as never)
      .mockResolvedValueOnce({
        aliasValue: "identity-test-agent",
      } as never);

    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      agentId: "identity-test-agent",
      name: "Build Specialist",
      status: "active",
      sensitivity: "internal",
      hitlTierDefault: 3,
      lifecycleStage: "production",
      executionConfig: null,
      governanceProfile: null,
      modelConfig: null,
      skills: [],
      toolGrantRevocations: [],
      toolGrants: [{ grantKey: "registry_read" }],
    } as never);
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null);

    const aidoc = await resolveAIDocForAgent("identity-test-agent");

    expect(aidoc?.gaid).toBe("gaid:priv:dpf.internal:identity-test-agent");
    expect(aidoc?.authorization_classes).toEqual(["observe"]);
  });
});
