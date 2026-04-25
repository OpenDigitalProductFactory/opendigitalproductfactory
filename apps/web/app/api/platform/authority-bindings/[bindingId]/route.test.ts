import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockAuth,
  mockCan,
  mockGetAuthorityBinding,
  mockGetAuthorityBindingEvidence,
  mockUpdateAuthorityBinding,
  mockCreateAuthorizationDecisionLog,
} =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockCan: vi.fn(),
    mockGetAuthorityBinding: vi.fn(),
    mockGetAuthorityBindingEvidence: vi.fn(),
    mockUpdateAuthorityBinding: vi.fn(),
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
  getAuthorityBindingEvidence: mockGetAuthorityBindingEvidence,
}));

vi.mock("@/lib/authority/binding-editor", () => ({
  updateAuthorityBinding: mockUpdateAuthorityBinding,
}));

vi.mock("@/lib/governance-data", () => ({
  createAuthorizationDecisionLog: mockCreateAuthorizationDecisionLog,
}));

import { GET, PATCH } from "./route";

function makeReq(method: "GET" | "PATCH", body?: unknown): NextRequest {
  return new Request("http://test/api/platform/authority-bindings/AB-000001", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockCan.mockReset();
  mockGetAuthorityBinding.mockReset();
  mockGetAuthorityBindingEvidence.mockReset();
  mockUpdateAuthorityBinding.mockReset();
  mockCreateAuthorizationDecisionLog.mockReset();

  mockAuth.mockResolvedValue({
    user: {
      id: "user-1",
      platformRole: "HR-000",
      isSuperuser: true,
    },
  });
  mockCan.mockReturnValue(true);
  mockGetAuthorityBinding.mockResolvedValue({
    bindingId: "AB-000001",
    name: "Finance workspace controller",
    scopeType: "route",
    status: "active",
    resourceType: "route",
    resourceRef: "/finance",
    approvalMode: "proposal-required",
    sensitivityCeiling: null,
    appliedAgent: null,
    subjects: [],
    grants: [],
  });
  mockGetAuthorityBindingEvidence.mockResolvedValue([]);
  mockUpdateAuthorityBinding.mockResolvedValue({
    bindingId: "AB-000001",
  });
});

describe("PATCH /api/platform/authority-bindings/[bindingId]", () => {
  it("updates a binding through the shared editor path", async () => {
    const response = await PATCH(
      makeReq("PATCH", {
        name: "Finance workspace controller",
        subjects: [{ subjectType: "platform-role", subjectRef: "HR-500", relation: "allowed" }],
      }),
      { params: Promise.resolve({ bindingId: "AB-000001" }) },
    );

    expect(response.status).toBe(200);
    expect(mockUpdateAuthorityBinding).toHaveBeenCalledWith(
      "AB-000001",
      expect.objectContaining({
        name: "Finance workspace controller",
        subjects: [{ subjectType: "platform-role", subjectRef: "HR-500", relation: "allowed" }],
      }),
    );
    expect(mockCreateAuthorizationDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRef: "user-1",
        actionKey: "authority_binding.update",
        authorityBindingRef: "AB-000001",
        routeContext: "/finance",
        decision: "allow",
      }),
    );
  });

  it("rejects unauthorized edits", async () => {
    mockCan.mockReturnValue(false);

    const response = await PATCH(makeReq("PATCH", { name: "Finance workspace controller" }), {
      params: Promise.resolve({ bindingId: "AB-000001" }),
    });

    expect(response.status).toBe(403);
  });
});

describe("GET /api/platform/authority-bindings/[bindingId]", () => {
  it("returns the normalized binding payload with evidence", async () => {
    const response = await GET(makeReq("GET"), {
      params: Promise.resolve({ bindingId: "AB-000001" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      binding: expect.objectContaining({ bindingId: "AB-000001" }),
      evidence: [],
    });
  });
});
