import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/identity/aidoc-resolver", () => ({
  resolveAIDocForAgent: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { resolveAIDocForAgent } from "@/lib/identity/aidoc-resolver";

import { resolveInternalAgentCard } from "./agent-card-service";

describe("resolveInternalAgentCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
