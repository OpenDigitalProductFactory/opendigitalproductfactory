import { describe, expect, it, vi } from "vitest";

import {
  persistPolicyAuthorityProjection,
  projectPolicyAuthority,
  type PolicyAuthorityProjectionInput,
} from "./policy-authority-projector";

const now = new Date("2026-08-23T12:00:00.000Z");

function eligible(
  overrides: Partial<PolicyAuthorityProjectionInput> = {},
): PolicyAuthorityProjectionInput {
  return {
    now,
    binding: {
      gate: "wwmd",
      actionKey: "record_initiative_design_review",
      affirmativeOptionId: "proceed",
      subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      organizationId: "org-1",
      professionId: null,
      routeContext: "/tool/record_initiative_design_review",
      artifactFingerprint: "sha256:design-tree",
      actingHumanUserId: "user-mark",
      actingAgentId: "AGT-WS-DEV",
      humanRootPrincipalId: "principal-mark",
      delegationRequired: true,
      maximumRiskTier: "medium",
      dualControlRequired: false,
    },
    approvalBinding: {
      actingHumanUserId: "user-mark",
      actingAgentId: "AGT-WS-DEV",
      chainId: "chain-1",
      taskRunId: "task-1",
      toolName: "record_initiative_design_review",
      subject: { kind: "backlog-item", id: "BI-F0715C9C" },
      routeContext: "/tool/record_initiative_design_review",
      inputFingerprint: "sha256:design-tree",
      sensitivity: "internal",
      decisionVersionFingerprint: "sha256:policy-version",
    },
    judgment: {
      interactionId: "DI-YES",
      gateKey: "kernel-consult",
      profileId: "MARK_DPF_PLATFORM_PROFILE",
      profileKind: "platform",
      profileOwnerOrganizationId: null,
      profileOwnerPrincipalId: "principal-mark",
      profileCurrentVersionId: "PV-7",
      profileVersionId: "PV-7",
      versionPromotedByPrincipalId: "principal-mark",
      outcomeType: "recommend",
      recommendedOptionId: "proceed",
      verdict: "proceed",
      signalUsable: true,
      autonomyEligible: true,
      recommendationConfidence: "high",
      featureCoverageWeak: false,
      sensitivityUnstable: false,
      commandmentConflict: false,
      riskTier: "medium",
      createdAt: new Date("2026-08-23T11:55:00.000Z"),
      sealedAt: new Date("2026-08-23T11:55:01.000Z"),
      chainEntryHash: "sha256:decision",
      evidenceRefs: ["evidence:1"],
      contributionLedger: [{ principleId: "P-1", contribution: 4.2 }],
      actionBinding: {
        actionKey: "record_initiative_design_review",
        subject: { kind: "backlog-item", id: "BI-F0715C9C" },
        organizationId: "org-1",
        professionId: null,
        routeContext: "/tool/record_initiative_design_review",
        artifactFingerprint: "sha256:design-tree",
      },
    },
    delegation: {
      grantId: "DG-1",
      status: "active",
      grantorUserId: "user-mark",
      granteeAgentId: "AGT-WS-DEV",
      validFrom: new Date("2026-08-23T00:00:00.000Z"),
      expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
      riskBand: "high",
      workflowKey: "record_initiative_design_review",
      objectRef: "backlog-item:BI-F0715C9C",
      maxUses: 1,
      useCount: 0,
    },
    ...overrides,
  };
}

describe("projectPolicyAuthority", () => {
  it.each([
    ["wwmd", "kernel-consult", "platform"],
    ["wwwd", "org-business", "organization"],
    ["wsid", "profession", "profession"],
  ] as const)("projects an explicit eligible %s yes", (gate, gateKey, profileKind) => {
    const base = eligible();
    const result = projectPolicyAuthority(eligible({
      binding: {
        ...base.binding,
        gate,
        organizationId: gate === "wwwd" ? "org-1" : base.binding.organizationId,
        professionId: gate === "wsid" ? "profession-1" : null,
      },
      judgment: {
        ...base.judgment,
        gateKey,
        profileKind,
        profileOwnerOrganizationId: gate === "wwwd" ? "org-1" : null,
        profileOwnerProfessionId: gate === "wsid" ? "profession-1" : null,
        actionBinding: {
          ...base.judgment.actionBinding!,
          professionId: gate === "wsid" ? "profession-1" : null,
        },
      },
    }));

    expect(result).toMatchObject({
      outcome: "allow",
      interactionId: "DI-YES",
      profileVersionId: "PV-7",
      maxUses: 1,
    });
    if (result.outcome === "allow") {
      expect(result.expiresAt.getTime()).toBeGreaterThan(now.getTime());
      expect(result.auditEvidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it.each([
    ["decline", { judgment: { outcomeType: "decline", verdict: "decline" } }, "policy-declined"],
    ["defer", { judgment: { outcomeType: "defer", verdict: null } }, "policy-resolution-required"],
    ["escalate", { judgment: { outcomeType: "escalate", verdict: "uncertain" } }, "policy-resolution-required"],
    ["tie", { judgment: { verdict: "uncertain" } }, "policy-resolution-required"],
    ["advisory", { judgment: { autonomyEligible: false } }, "policy-resolution-required"],
    ["unusable", { judgment: { signalUsable: false } }, "policy-resolution-required"],
    ["unstable", { judgment: { sensitivityUnstable: true } }, "policy-resolution-required"],
    ["weak coverage", { judgment: { featureCoverageWeak: true } }, "policy-resolution-required"],
    ["conflict", { judgment: { commandmentConflict: true } }, "policy-conflict"],
    ["unsealed", { judgment: { sealedAt: null, chainEntryHash: null } }, "policy-resolution-required"],
  ] as const)("fails closed for %s judgment evidence", (_name, patch, reasonCode) => {
    const input = eligible();
    const result = projectPolicyAuthority({
      ...input,
      judgment: { ...input.judgment, ...patch.judgment },
    });
    expect(result).toMatchObject({ reasonCode });
    expect(result.outcome).not.toBe("allow");
  });

  it("does not treat a DecisionInteraction id as authority when exact binding evidence is missing", () => {
    const input = eligible();
    expect(projectPolicyAuthority({
      ...input,
      judgment: { ...input.judgment, actionBinding: null },
    })).toMatchObject({ outcome: "resolve", reasonCode: "policy-resolution-required" });
  });

  it("fails closed when a WSID profile has no server-resolved profession owner", () => {
    const input = eligible();
    expect(projectPolicyAuthority({
      ...input,
      binding: { ...input.binding, gate: "wsid", professionId: "profession-1" },
      judgment: {
        ...input.judgment,
        gateKey: "profession",
        profileKind: "profession",
        profileOwnerProfessionId: null,
        actionBinding: { ...input.judgment.actionBinding!, professionId: "profession-1" },
      },
    })).toMatchObject({ outcome: "deny", reasonCode: "policy-provenance-invalid" });
  });

  it.each([
    ["actionKey", "other_action"],
    ["organizationId", "org-2"],
    ["routeContext", "/other"],
    ["artifactFingerprint", "sha256:other"],
  ] as const)("denies a %s binding mismatch", (field, value) => {
    const input = eligible();
    expect(projectPolicyAuthority({
      ...input,
      judgment: {
        ...input.judgment,
        actionBinding: { ...input.judgment.actionBinding!, [field]: value },
      },
    })).toMatchObject({ outcome: "deny", reasonCode: "binding-mismatch" });
  });

  it("requires a distinct human only when the resolved risk floor requires dual control", () => {
    const input = eligible();
    const baseline = projectPolicyAuthority(input);
    expect(baseline.outcome).toBe("allow");
    const approvalBindingFingerprint = baseline.outcome === "allow"
      ? baseline.approvalBindingFingerprint
      : "unreachable";
    expect(projectPolicyAuthority({
      ...input,
      binding: { ...input.binding, dualControlRequired: true },
    })).toMatchObject({ outcome: "resolve", reasonCode: "dual-control-required" });
    expect(projectPolicyAuthority({
      ...input,
      binding: { ...input.binding, dualControlRequired: true },
      independentHumanApproval: {
        principalId: "principal-reviewer",
        approvedAt: new Date("2026-08-23T11:59:00.000Z"),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        approvalBindingFingerprint,
      },
    })).toMatchObject({ outcome: "allow" });
    expect(projectPolicyAuthority({
      ...input,
      binding: { ...input.binding, dualControlRequired: true },
      independentHumanApproval: {
        principalId: "principal-reviewer",
        approvedAt: new Date("2026-08-23T11:59:00.000Z"),
        expiresAt: now,
        approvalBindingFingerprint: "wrong-binding",
      },
    })).toMatchObject({ outcome: "resolve", reasonCode: "dual-control-required" });
  });

  it("fails closed for stale policy, expired/revoked delegation, risk excess, and replay", () => {
    const input = eligible();
    const cases: PolicyAuthorityProjectionInput[] = [
      { ...input, judgment: { ...input.judgment, profileCurrentVersionId: "PV-8" } },
      { ...input, delegation: { ...input.delegation!, status: "revoked" } },
      { ...input, delegation: { ...input.delegation!, expiresAt: now } },
      { ...input, judgment: { ...input.judgment, riskTier: "high" } },
      { ...input, delegation: { ...input.delegation!, useCount: 1 } },
    ];
    for (const candidate of cases) {
      expect(projectPolicyAuthority(candidate).outcome).not.toBe("allow");
    }
  });
});

describe("persistPolicyAuthorityProjection", () => {
  it("appends the allow log and approved exact-call envelope in one transaction", async () => {
    const projection = projectPolicyAuthority(eligible());
    expect(projection.outcome).toBe("allow");
    const authorizationCreate = vi.fn().mockResolvedValue({ decisionId: "AUTH-1" });
    const envelopeCreate = vi.fn().mockResolvedValue({ id: "ENV-1" });
    const db = {
      $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
        authorizationDecisionLog: { create: authorizationCreate },
        coworkerActionEnvelope: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: envelopeCreate,
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      })),
    };

    const result = await persistPolicyAuthorityProjection({
      db: db as never,
      projection: projection as Extract<typeof projection, { outcome: "allow" }>,
      approvalBinding: eligible().approvalBinding,
      threadId: "thread-1",
    });

    expect(result).toEqual({
      authorityDecisionId: expect.stringMatching(/^AUTH-/),
      envelopeId: "ENV-1",
      reused: false,
    });
    expect(authorizationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        decision: "allow",
        organizationId: "org-1",
        policyVersion: "PV-7",
      }),
    }));
    expect(envelopeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "approved",
        authorityDecisionId: result.authorityDecisionId,
        approvalBindingFingerprint: expect.any(String),
      }),
    }));
  });

  it("keeps the platform sentinel in the exact binding but never writes it as a tenant foreign key", async () => {
    const platformInput = eligible();
    platformInput.binding.organizationId = "platform";
    platformInput.judgment.actionBinding = {
      ...platformInput.judgment.actionBinding!,
      organizationId: "platform",
    };
    const projection = projectPolicyAuthority(platformInput);
    expect(projection).toMatchObject({ outcome: "allow", organizationId: "platform" });
    const authorizationCreate = vi.fn().mockResolvedValue({ decisionId: "AUTH-PLATFORM" });
    const db = {
      $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
        authorizationDecisionLog: { create: authorizationCreate },
        coworkerActionEnvelope: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "ENV-PLATFORM" }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      })),
    };

    await persistPolicyAuthorityProjection({
      db: db as never,
      projection: projection as Extract<typeof projection, { outcome: "allow" }>,
      approvalBinding: platformInput.approvalBinding,
      threadId: "thread-platform",
    });

    expect(authorizationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: null }),
    }));
  });
});
