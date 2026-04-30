import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findMany: vi.fn(),
    },
    principalAlias: {
      findMany: vi.fn(),
    },
    agentModelConfig: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

import {
  listAgentIdentitySnapshots,
  summarizeAgentIdentitySnapshots,
} from "./agent-identity-snapshot";

describe("listAgentIdentitySnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a shared identity-authority snapshot with AIDoc projection data", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        id: "1",
        agentId: "build-specialist",
        name: "Build Specialist",
        status: "active",
        lifecycleStage: "production",
        sensitivity: "internal",
        hitlTierDefault: 2,
        humanSupervisorId: "HR-300",
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
          { label: "repo-grounding", taskType: "analysis" },
          { label: "build-phase-implementation", taskType: "code_generation" },
        ],
        toolGrants: [
          { grantKey: "registry_read" },
          { grantKey: "backlog_write" },
          { grantKey: "sandbox_execute" },
        ],
      },
      {
        id: "2",
        agentId: "unlinked-agent",
        name: "Unlinked Agent",
        status: "draft",
        lifecycleStage: "incubation",
        sensitivity: "internal",
        hitlTierDefault: 1,
        humanSupervisorId: null,
        executionConfig: null,
        governanceProfile: null,
        skills: [],
        toolGrants: [],
      },
    ] as never);
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
      {
        aliasType: "agent",
        aliasValue: "build-specialist",
        principalId: "PRN-000002",
      },
      {
        aliasType: "gaid",
        aliasValue: "gaid:priv:dpf.internal:build-specialist",
        principalId: "PRN-000002",
      },
    ] as never);
    vi.mocked(prisma.agentModelConfig.findMany).mockResolvedValue([
      {
        agentId: "build-specialist",
        minimumTier: "strong",
        pinnedProviderId: "openai",
        pinnedModelId: "gpt-5.2",
        budgetClass: "quality_first",
      },
    ] as never);

    const snapshots = await listAgentIdentitySnapshots();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      agentId: "build-specialist",
      linkedPrincipalId: "PRN-000002",
      gaid: "gaid:priv:dpf.internal:build-specialist",
      validationState: "validated",
      authorizationClasses: ["observe", "create", "update", "execute"],
    });
    expect(snapshots[0].operatingProfileFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshots[0].toolSurfaceCount).toBeGreaterThan(0);
    expect(snapshots[1]).toMatchObject({
      agentId: "unlinked-agent",
      linkedPrincipalId: null,
      gaid: null,
      validationState: "unlinked",
      authorizationClasses: [],
      operatingProfileFingerprint: null,
    });
  });
});

describe("summarizeAgentIdentitySnapshots", () => {
  it("summarizes projection coverage and portable authorization vocabulary", () => {
    const summary = summarizeAgentIdentitySnapshots([
      {
        id: "1",
        agentId: "build-specialist",
        name: "Build Specialist",
        status: "active",
        lifecycleStage: "production",
        humanSupervisorId: "HR-300",
        linkedPrincipalId: "PRN-000002",
        gaid: "gaid:priv:dpf.internal:build-specialist",
        aidoc: {
          gaid: "gaid:priv:dpf.internal:build-specialist",
        } as never,
        authorizationClasses: ["observe", "execute"],
        operatingProfileFingerprint: "fingerprint-1",
        validationState: "validated",
        toolSurfaceCount: 4,
        promptClassRefCount: 2,
      },
      {
        id: "2",
        agentId: "planner",
        name: "Planner",
        status: "inactive",
        lifecycleStage: "staged",
        humanSupervisorId: null,
        linkedPrincipalId: "PRN-000003",
        gaid: "gaid:priv:dpf.internal:planner",
        aidoc: {
          gaid: "gaid:priv:dpf.internal:planner",
        } as never,
        authorizationClasses: ["observe", "analyze"],
        operatingProfileFingerprint: "fingerprint-2",
        validationState: "stale",
        toolSurfaceCount: 2,
        promptClassRefCount: 1,
      },
      {
        id: "3",
        agentId: "unlinked",
        name: "Unlinked",
        status: "draft",
        lifecycleStage: "incubation",
        humanSupervisorId: null,
        linkedPrincipalId: null,
        gaid: null,
        aidoc: null,
        authorizationClasses: [],
        operatingProfileFingerprint: null,
        validationState: "unlinked",
        toolSurfaceCount: 0,
        promptClassRefCount: 0,
      },
    ]);

    expect(summary).toMatchObject({
      totalAgents: 3,
      linkedAgents: 2,
      projectedAgents: 2,
      unlinkedAgents: 1,
      validatedAgents: 1,
      staleAgents: 1,
    });
    expect(summary.portableAuthorizationClassCount).toBe(3);
  });
});
