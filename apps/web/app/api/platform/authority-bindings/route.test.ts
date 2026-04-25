import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockCan,
  mockGetAuthorityBinding,
  mockBuildDraftAuthorityBindingFromWarning,
  mockCreateAuthorityBinding,
  mockCreateAuthorizationDecisionLog,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockGetAuthorityBinding: vi.fn(),
  mockBuildDraftAuthorityBindingFromWarning: vi.fn(),
  mockCreateAuthorityBinding: vi.fn(),
  mockCreateAuthorizationDecisionLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/authority/bindings", () => ({
  getAuthorityBinding: mockGetAuthorityBinding,
}));

vi.mock("@/lib/authority/bootstrap-bindings", () => ({
  buildDraftAuthorityBindingFromWarning: mockBuildDraftAuthorityBindingFromWarning,
}));

vi.mock("@/lib/authority/binding-editor", () => ({
  createAuthorityBinding: mockCreateAuthorityBinding,
}));

vi.mock("@/lib/governance-data", () => ({
  createAuthorizationDecisionLog: mockCreateAuthorizationDecisionLog,
}));

import { POST } from "./route";

beforeEach(() => {
  mockAuth.mockReset();
  mockCan.mockReset();
  mockGetAuthorityBinding.mockReset();
  mockBuildDraftAuthorityBindingFromWarning.mockReset();
  mockCreateAuthorityBinding.mockReset();
  mockCreateAuthorizationDecisionLog.mockReset();

  mockAuth.mockResolvedValue({
    user: {
      id: "user-1",
      platformRole: "HR-000",
      isSuperuser: true,
    },
  });
  mockCan.mockReturnValue(true);
  mockGetAuthorityBinding.mockResolvedValue(null);
  mockBuildDraftAuthorityBindingFromWarning.mockResolvedValue({
    bindingId: "AB-ROUTE-SETUP-ONBOARDING-COO",
    name: "Review /setup authority binding",
    scopeType: "route",
    status: "draft",
    resourceType: "route",
    resourceRef: "/setup",
    approvalMode: "none",
    appliedAgentId: "onboarding-coo",
    subjects: [{ subjectType: "team", subjectRef: "TEAM-ONBOARD", relation: "owner" }],
    grants: [],
    authorityScope: {
      bootstrapWarning: {
        reason: "ungated-route",
        requestedAgentId: "onboarding-coo",
      },
    },
  });
  mockCreateAuthorityBinding.mockResolvedValue({
    bindingId: "AB-ROUTE-SETUP-ONBOARDING-COO",
  });
});

describe("POST /api/platform/authority-bindings", () => {
  it("creates a draft binding from a low-confidence warning", async () => {
    const response = await POST(
      new Request("http://test/api/platform/authority-bindings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftFromWarning: {
            resourceRef: "/setup",
            agentId: "onboarding-coo",
            reason: "ungated-route",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockBuildDraftAuthorityBindingFromWarning).toHaveBeenCalledWith({
      resourceRef: "/setup",
      agentId: "onboarding-coo",
      reason: "ungated-route",
    });
    expect(mockCreateAuthorityBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "AB-ROUTE-SETUP-ONBOARDING-COO",
        status: "draft",
      }),
    );
    expect(mockCreateAuthorizationDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey: "authority_binding.create",
        authorityBindingRef: "AB-ROUTE-SETUP-ONBOARDING-COO",
        decision: "allow",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      bindingId: "AB-ROUTE-SETUP-ONBOARDING-COO",
      created: true,
    });
  });

  it("returns an existing binding instead of duplicating the draft", async () => {
    mockGetAuthorityBinding.mockResolvedValue({
      bindingId: "AB-ROUTE-SETUP-ONBOARDING-COO",
      name: "Review /setup authority binding",
    });

    const response = await POST(
      new Request("http://test/api/platform/authority-bindings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftFromWarning: {
            resourceRef: "/setup",
            agentId: "onboarding-coo",
            reason: "ungated-route",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCreateAuthorityBinding).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      bindingId: "AB-ROUTE-SETUP-ONBOARDING-COO",
      created: false,
    });
  });
});
