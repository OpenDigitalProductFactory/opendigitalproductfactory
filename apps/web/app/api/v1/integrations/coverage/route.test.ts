import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthenticateRequest, mockGetMatrixByOrg, mockOrgFindFirst } = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockGetMatrixByOrg: vi.fn(),
  mockOrgFindFirst: vi.fn(),
}));

vi.mock("@/lib/api/auth-middleware", () => ({
  authenticateRequest: mockAuthenticateRequest,
}));

vi.mock("@/lib/actions/integration-coverage", () => ({
  getMatrixByOrg: mockGetMatrixByOrg,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findFirst: mockOrgFindFirst,
    },
  },
}));

import { GET } from "./route";

function makeRequest() {
  return new Request("http://test/api/v1/integrations/coverage", {
    method: "GET",
  });
}

beforeEach(() => {
  mockAuthenticateRequest.mockReset();
  mockGetMatrixByOrg.mockReset();
  mockOrgFindFirst.mockReset();
});

describe("GET /api/v1/integrations/coverage", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    mockAuthenticateRequest.mockRejectedValue(new Error("Unauthorized"));

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(mockGetMatrixByOrg).not.toHaveBeenCalled();
  });

  it("returns a JSON coverage matrix for an authenticated request", async () => {
    mockAuthenticateRequest.mockResolvedValue({
      user: {
        id: "user-1",
        email: "admin@example.com",
        type: "admin",
        platformRole: "owner_operator",
        isSuperuser: false,
        organizationId: "org-1",
      },
      capabilities: [],
      authContext: {
        principalId: null,
        principalAliases: [],
        population: "workforce",
        platformRole: "owner_operator",
        isSuperuser: false,
        employeeId: null,
        managerScope: null,
        teamIds: [],
        accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
        sensitivityClearance: ["public"],
        authentication: {
          source: "session",
          methods: [],
          contextClassReference: null,
        },
        actingHumanUserId: "user-1",
        actingAgentId: null,
        delegationGrantIds: [],
        grantedCapabilities: [],
      },
    });
    mockOrgFindFirst.mockResolvedValue({ id: "org-1" });
    mockGetMatrixByOrg.mockResolvedValue([]);

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual([]);
    expect(mockGetMatrixByOrg).toHaveBeenCalledWith("org-1");
  });
});
