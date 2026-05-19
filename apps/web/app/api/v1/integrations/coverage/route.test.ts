import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthenticateRequest, mockGetMatrixByOrg } = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockGetMatrixByOrg: vi.fn(),
}));

vi.mock("@/lib/api/auth-middleware", () => ({
  authenticateRequest: mockAuthenticateRequest,
}));

vi.mock("@/lib/actions/integration-coverage", () => ({
  getMatrixByOrg: mockGetMatrixByOrg,
}));

import { GET } from "./route";

function makeRequest() {
  return new Request( "http://test/api/v1/integrations/coverage", {
    method: "GET",
  });
}

beforeEach(() => {
  mockAuthenticateRequest.mockReset();
  mockGetMatrixByOrg.mockReset();
});

describe("GET /api/v1/integrations/coverage", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

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
      authContext: { organizationId: "org-1" },
    });
    mockGetMatrixByOrg.mockResolvedValue([]);

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual([]);
    expect(mockGetMatrixByOrg).toHaveBeenCalledWith("org-1");
  });
});
